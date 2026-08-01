"""Receipt matcher (Plan v3) : résout chaque ParsedLine en MatchedLine.

Stratégie en 3 niveaux, du plus déterministe au plus permissif :

1. **Lookup direct via `Source.LIDL` + `source_ref`** : pour les lignes
   issues de l'API Lidl, l'`art_id` est stable. Si un ingrédient existe
   déjà avec `source = LIDL` et `source_ref = art_id`, match instantané
   (score 1.0, source="source_ref").

2. **Alias appris** (`receipt_alias` table) : pour Intermarché et Carrefour.
   Si le `(store, source_key)` a déjà été validé par l'utilisateur lors
   d'un import précédent, on pré-sélectionne directement (score 1.0,
   source="alias").

3. **Fuzzy match** via `rapidfuzz` contre les noms de la bibliothèque
   personnelle. Si le score ≥ FUZZY_THRESHOLD, on suggère le top-3
   trié par similarité (source="fuzzy", score ∈ [0,1]).

4. Sinon : `match_source = "none"`. La ligne sera flaggée dans le dialog
   et l'utilisateur devra créer un nouvel ingrédient ou en sélectionner
   un manuellement.

`match_lines` charge tous les ingrédients en biblio en une seule query
pour éviter les N+1 (cf. B2 du plan v2).
"""

from __future__ import annotations

import logging

from rapidfuzz import fuzz, process
from sqlalchemy.orm import Session

from app.data.repositories import (
    ImportedReceiptRepo,
    IngredientRepo,
    ReceiptAliasRepo,
)
from app.domain.models import Source
from app.domain.receipt import MatchedLine, MatchedReceipt, ParsedLine, ParsedReceipt

log = logging.getLogger(__name__)

# Seuil de similarité fuzzy en dessous duquel on ne suggère rien — l'utilisateur
# devra créer ou choisir manuellement. Calibré pour rapidfuzz token_set_ratio :
#   - 90+ : très probable même produit ("Tomate" vs "tomate cerise")
#   - 80+ : possible ("Yaourt nature" vs "Yaourts nature 0%")
#   - <80 : trop hasardeux pour pré-sélectionner
FUZZY_THRESHOLD = 70.0   # 0-100 ; on accepte les top-3 ≥ 70 pour suggestion
FUZZY_AUTO_THRESHOLD = 90.0  # ≥ 90 : on pré-coche le best match (l'utilisateur peut décocher)

MAX_SUGGESTIONS = 3


def match_receipt(s: Session, parsed: ParsedReceipt) -> MatchedReceipt:
    """Convertit un ParsedReceipt en MatchedReceipt résolu.

    L'utilisation typique : l'UI appelle `match_receipt` une fois après le
    parsing, présente la `MatchedReceipt` à l'utilisateur dans le dialog
    de review, l'utilisateur ajuste, puis on commit.

    Marque `is_duplicate = True` si `parsed.ticket_id` existe déjà en
    `imported_receipt`. Le dialog peut alors proposer "Ignorer" / "Forcer".
    """
    ing_repo = IngredientRepo(s)
    alias_repo = ReceiptAliasRepo(s)
    imported_repo = ImportedReceiptRepo(s)

    # Pre-load la bibliothèque personnelle en une query — utilisée pour le
    # fuzzy match (rapidfuzz a besoin de la liste complète des candidats).
    library = ing_repo.list_personal()
    # Map id → name pour les lookups
    name_by_id = {ing.id: ing.name for ing in library if ing.id is not None}
    # Liste de tuples (id, name) pour rapidfuzz
    candidates = [(ing.id, ing.name) for ing in library if ing.id is not None]

    matched_lines: list[MatchedLine] = []
    for line in parsed.lines:
        matched_lines.append(_match_one(
            line=line,
            store=parsed.store,
            ing_repo=ing_repo,
            alias_repo=alias_repo,
            candidates=candidates,
            name_by_id=name_by_id,
        ))

    result = MatchedReceipt(parsed=parsed, lines=matched_lines)
    # Anti-doublon : si on a un ticket_id et qu'il existe déjà
    if parsed.ticket_id and imported_repo.exists(parsed.ticket_id):
        result.is_duplicate = True
    return result


def _match_one(
    *,
    line: ParsedLine,
    store: str,
    ing_repo: IngredientRepo,
    alias_repo: ReceiptAliasRepo,
    candidates: list[tuple[int, str]],
    name_by_id: dict[int, str],
) -> MatchedLine:
    # add_to_pantry par défaut : True pour les lignes alimentaires (TVA A
    # ou pas de code TVA — qu'on présume alim). Refonte UX : importer un
    # ticket = remplir le frigo, donc tout va au frigo par défaut, sauf les
    # lignes non-alimentaires (TVA B = 20% — éponge, brosse, etc.) que
    # l'utilisateur peut quand même cocher manuellement.
    default_pantry = line.is_likely_food

    # 1. Lookup direct par source_ref (Lidl uniquement — store_key = art_id)
    if store == "lidl":
        ing = ing_repo.find_by_source_ref(Source.LIDL, line.store_key)
        if ing is not None and ing.id is not None:
            return MatchedLine(
                parsed=line,
                suggestions=[ing.id],
                chosen_ingredient_id=ing.id,
                match_source="source_ref",
                match_score=1.0,
                add_to_pantry=default_pantry,
            )

    # 2. Alias appris (Intermarché / Carrefour ; aussi possible pour Lidl si
    #    l'utilisateur a forcé un mapping manuel)
    alias = alias_repo.find(store, line.store_key)
    if alias is not None:
        return MatchedLine(
            parsed=line,
            suggestions=[alias.ingredient_id],
            chosen_ingredient_id=alias.ingredient_id,
            match_source="alias",
            match_score=1.0,
            add_to_pantry=default_pantry,
        )

    # 3. Fuzzy match avec rapidfuzz. On utilise `token_set_ratio` qui est
    #    robuste aux ordres de mots et aux mots manquants (utile pour les
    #    noms tronqués type "FRANUI FRAMBSE CHOCO" → "Franui Framboise Chocolat").
    if not candidates:
        return MatchedLine(
            parsed=line, match_source="none", match_score=0.0,
            add_to_pantry=default_pantry,
        )

    # rapidfuzz process.extract retourne [(name, score, index), ...] trié desc.
    # `processor=str.casefold` normalise les deux côtés (input et candidats)
    # pour rendre le match insensible à la casse — sinon "YAOURT" vs "Yaourt"
    # tombe à ~7% de similarité.
    matches = process.extract(
        line.raw_name,
        [name for _id, name in candidates],
        scorer=fuzz.token_set_ratio,
        processor=str.casefold,
        limit=MAX_SUGGESTIONS,
    )
    # Garde uniquement ceux au-dessus du seuil
    above_threshold = [(name, score, idx) for name, score, idx in matches
                       if score >= FUZZY_THRESHOLD]
    if not above_threshold:
        return MatchedLine(
            parsed=line, match_source="none", match_score=0.0,
            add_to_pantry=default_pantry,
        )

    suggestion_ids = [candidates[idx][0] for _name, _score, idx in above_threshold]
    best_score = above_threshold[0][1] / 100.0
    chosen = suggestion_ids[0] if best_score >= (FUZZY_AUTO_THRESHOLD / 100.0) else None

    return MatchedLine(
        parsed=line,
        suggestions=suggestion_ids,
        chosen_ingredient_id=chosen,
        match_source="fuzzy",
        match_score=best_score,
        add_to_pantry=default_pantry,
    )
