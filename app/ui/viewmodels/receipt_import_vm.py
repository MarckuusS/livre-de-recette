"""ViewModel for the receipt import dialog (Plan v3, Phase 1).

Responsabilités :
- Loader un fichier ticket (PDF ou HTML selon le parser détecté)
- Présenter chaque ligne parsed avec ses suggestions de match au QML
- Accepter les corrections de l'utilisateur (override d'un match, création
  d'un nouvel ingrédient inline)
- Commit transactionnel : `PriceHistoryRepo.add` × N + `PantryRepo.add` × M
  + `ReceiptAliasRepo.upsert` × N (corrections apprises)
  + `ImportedReceiptRepo.add` (anti-doublon)

Le buffer interne `_matched_receipt` est mutable côté Python ; QML lit/écrit
via les slots `setLineChosenIngredient`, `toggleLineAddToPantry`, etc.
"""

from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from PySide6.QtCore import Property, QObject, Signal, Slot
from PySide6.QtQml import QmlElement

from app.data.repositories import (
    ImportedReceiptRepo,
    IngredientRepo,
    PantryRepo,
    PriceHistoryRepo,
    ReceiptAliasRepo,
)
from app.domain.models import Ingredient, PantryStock, PriceHistoryEntry, Source
from app.domain.receipt import MatchedReceipt
from app.services.pricing_history_service import recompute_current_price
from app.services.receipt_matcher import match_receipt
from app.services.receipt_parser import UnknownReceiptFormat, parse_receipt
from app.ui.app_context import AppContext

QML_IMPORT_NAME = "App.ViewModels"
QML_IMPORT_MAJOR_VERSION = 1

log = logging.getLogger(__name__)


@QmlElement
class ReceiptImportViewModel(QObject):
    """Drives the receipt import dialog. Stateful : owns a `_matched_receipt`
    buffer that QML mutates via slots, and commits to the DB on `commitImport`."""

    # Émis après chaque chargement (succès ou échec). QML rebind son tableau.
    receipt_loaded = Signal()
    # Émis après une mutation interne (chosen ingredient, qty edit, etc.)
    line_changed = Signal(int)   # index de la ligne mutée
    # Émis quand l'import est commit (succès ou échec). Le dialog se ferme.
    import_completed = Signal(bool, str)   # success, message
    # Émis quand le parser ne reconnaît pas le format ; QML affiche un toast.
    error_emitted = Signal(str)
    # Phase 2 — émis quand le watcher détecte un nouveau fichier OU au boot
    # quand des fichiers étaient déjà en attente. La status bar peut afficher
    # un badge "X tickets en attente — Importer".
    pending_files_changed = Signal()
    # Émis pour notifier la status bar / une notification toast d'un nouveau
    # ticket détecté pendant que l'app tourne. Distinct de `pending_files_changed`
    # qui est continu (count). Celui-ci est ponctuel (un ping).
    new_file_detected = Signal(str)   # absolute path

    def __init__(
        self, ctx: AppContext | None = None, parent: QObject | None = None,
    ) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self._matched: MatchedReceipt | None = None
        self._source_path: Path | None = None
        # Pour le commit : si l'utilisateur veut écraser un import déjà fait
        # avec le même ticket_id, il toggle ce flag depuis le dialog.
        self._force_import: bool = False
        # Phase 2 — files en attente dans le sous-dossier (au boot ou détectés
        # par le watcher en cours de session). On garde la liste ordonnée
        # par mtime pour pouvoir charger "le prochain" via `loadNextPending`.
        self._pending_files: list[Path] = []

    # ============================================================ Properties

    @Property(bool, notify=receipt_loaded)
    def hasReceipt(self) -> bool:  # noqa: N802
        return self._matched is not None

    @Property(bool, notify=receipt_loaded)
    def isDuplicate(self) -> bool:  # noqa: N802
        return self._matched is not None and self._matched.is_duplicate

    @Property(str, notify=receipt_loaded)
    def store(self) -> str:
        return self._matched.parsed.store if self._matched else ""

    @Property(str, notify=receipt_loaded)
    def receiptDateIso(self) -> str:  # noqa: N802
        if self._matched is None or self._matched.parsed.date is None:
            return ""
        return self._matched.parsed.date.isoformat()

    @Property(str, notify=receipt_loaded)
    def receiptDateHuman(self) -> str:  # noqa: N802
        if self._matched is None or self._matched.parsed.date is None:
            return ""
        return self._matched.parsed.date.strftime("%d/%m/%Y %H:%M")

    @Property(str, notify=receipt_loaded)
    def ticketId(self) -> str:  # noqa: N802
        return (self._matched.parsed.ticket_id or "") if self._matched else ""

    @Property(str, notify=receipt_loaded)
    def totalEur(self) -> str:  # noqa: N802
        if self._matched is None or self._matched.parsed.total_eur is None:
            return ""
        return str(self._matched.parsed.total_eur)

    @Property(int, notify=receipt_loaded)
    def lineCount(self) -> int:  # noqa: N802
        return len(self._matched.lines) if self._matched else 0

    @Property(bool, notify=receipt_loaded)
    def forceImport(self) -> bool:  # noqa: N802
        return self._force_import

    # ============================================================ Slots

    @Slot("QVariantMap", result=bool)
    def loadFromLidlJson(self, ticket_json: dict[str, Any]) -> bool:  # noqa: N802
        """Phase 5 — charge un ticket Lidl depuis le JSON brut renvoyé par
        l'API Lidl Plus. Pas de fichier source, juste le dict.

        Convertit via `adapt_lidl_json` puis matche normalement. Le cleanup
        Option B ne s'applique pas (rien à supprimer)."""
        if self.ctx is None:
            return False
        try:
            from app.services.receipt_parser.lidl_api_adapter import adapt_lidl_json
            parsed = adapt_lidl_json(dict(ticket_json or {}))
        except Exception as exc:   # noqa: BLE001
            log.exception("Lidl JSON adaptation failed")
            self.error_emitted.emit(f"JSON Lidl invalide : {exc}")
            return False

        if not parsed.lines:
            self.error_emitted.emit("Le ticket Lidl ne contient aucun article.")
            return False

        with self.ctx.session() as s:
            self._matched = match_receipt(s, parsed)
        # Pas de _source_path : c'est une ingestion API, pas un fichier.
        self._source_path = None
        self._force_import = False
        self.receipt_loaded.emit()
        return True

    @Slot(str, result=bool)
    def loadFromPath(self, path_str: str) -> bool:  # noqa: N802
        """Parse un fichier et résout les lignes contre la biblio.
        Retourne True si chargé, False si erreur (toast déjà émis)."""
        if self.ctx is None:
            return False
        path_str = path_str.removeprefix("file:///")
        path_str = path_str.removeprefix("file://")
        path = Path(path_str)
        try:
            parsed = parse_receipt(path)
        except UnknownReceiptFormat as exc:
            log.warning("Format de ticket non reconnu : %s", exc)
            self.error_emitted.emit(f"Format de ticket non reconnu : {exc}")
            return False
        except Exception as exc:  # noqa: BLE001
            log.exception("Erreur de parsing du ticket %s", path)
            self.error_emitted.emit(f"Erreur de parsing : {exc}")
            return False

        with self.ctx.session() as s:
            self._matched = match_receipt(s, parsed)
        self._source_path = path
        self._force_import = False
        self.receipt_loaded.emit()
        return True

    @Slot(result="QVariantList")
    def linesAsList(self) -> list[dict[str, Any]]:  # noqa: N802
        """Renvoie les lignes pour QML : un dict par ligne avec toutes les
        infos d'affichage. Le QML les pose dans un Repeater / TableView."""
        if self._matched is None:
            return []
        out = []
        for i, line in enumerate(self._matched.lines):
            out.append({
                "index":           i,
                "rawName":         line.parsed.raw_name,
                "quantity":        line.parsed.quantity,
                "unitPrice":       str(line.parsed.unit_price) if line.parsed.unit_price else "",
                "totalPrice":      str(line.parsed.total_price) if line.parsed.total_price else "",
                "vatCode":         line.parsed.vat_code,
                "isLikelyFood":    line.parsed.is_likely_food,
                "matchSource":     line.match_source,
                "matchScore":      line.match_score,
                "suggestionIds":   line.suggestions,
                "chosenId":        line.chosen_ingredient_id or 0,
                "addToPantry":     line.add_to_pantry,
                "expiryIso":       line.expiry_date.date().isoformat() if line.expiry_date else "",
                "expiryHuman":     line.expiry_date.strftime("%d/%m/%Y") if line.expiry_date else "",
                "userBarcode":     line.user_barcode,
                "quantityG":       line.quantity_g,
                "userPriceOverride": line.user_price_override,
            })
        return out

    @Slot(int, int)
    def setLineChosenIngredient(self, index: int, ingredient_id: int) -> None:  # noqa: N802
        if self._matched is None or not (0 <= index < len(self._matched.lines)):
            return
        line = self._matched.lines[index]
        line.chosen_ingredient_id = ingredient_id if ingredient_id > 0 else None
        self.line_changed.emit(index)

    @Slot(int, bool)
    def toggleLineAddToPantry(self, index: int, value: bool) -> None:  # noqa: N802
        if self._matched is None or not (0 <= index < len(self._matched.lines)):
            return
        self._matched.lines[index].add_to_pantry = value
        self.line_changed.emit(index)

    @Slot(int)
    def removeLine(self, index: int) -> None:  # noqa: N802
        """Refonte UX : retire complètement une ligne de l'import (l'utilisateur
        a décidé de ne pas l'inclure). Appelé par le bouton 🗑 de la cellule
        Action. Émet `receipt_loaded` (et non `line_changed`) car les indices
        des lignes suivantes décalent — le QML rebind son tableau complet."""
        if self._matched is None or not (0 <= index < len(self._matched.lines)):
            return
        removed = self._matched.lines.pop(index)
        log.info("Ligne retirée de l'import : %s", removed.parsed.raw_name)
        self.receipt_loaded.emit()

    @Slot(int, int)
    def setLineQuantity(self, index: int, quantity: int) -> None:  # noqa: N802
        """Permet à l'utilisateur d'ajuster la quantité du ticket (ex : le
        ticket compte 1 mais le pack contient 4 yaourts → qty=4 pour que le
        suivi €/100 g soit cohérent). Recalcule le total_price si on a un
        unit_price ET si l'utilisateur n'a pas verrouillé le prix.

        ATTENTION : ce slot manipule le compteur entier (legacy / EAN scanner).
        Pour la quantité en grammes via QuantityField, utiliser setLineQuantityG."""
        if self._matched is None or not (0 <= index < len(self._matched.lines)):
            return
        line = self._matched.lines[index]
        new_qty = max(1, int(quantity))
        if new_qty == line.parsed.quantity:
            return
        line.parsed.quantity = new_qty
        if line.parsed.unit_price is not None and not line.user_price_override:
            line.parsed.total_price = line.parsed.unit_price * Decimal(new_qty)
        self.line_changed.emit(index)

    @Slot(int, float)
    def setLineQuantityG(self, index: int, grams: float) -> None:  # noqa: N802
        """Refonte UX — l'utilisateur saisit la quantité réelle de la ligne
        EN GRAMMES via le `QuantityField` du dialog. Cette valeur prime sur
        toute autre estimation lors du commit (PriceHistory + PantryStock).

        Ne touche PAS au prix : un ticket donne le prix payé pour ce produit,
        modifier la quantité (ex : préciser "250 g" au lieu de "1 unité")
        n'invalide pas le prix."""
        if self._matched is None or not (0 <= index < len(self._matched.lines)):
            return
        line = self._matched.lines[index]
        new_g = max(0.0, float(grams))
        if abs(new_g - line.quantity_g) < 1e-6:
            return
        line.quantity_g = new_g
        self.line_changed.emit(index)

    @Slot(int, str)
    def setLineTotalPrice(self, index: int, price_str: str) -> None:  # noqa: N802
        """Refonte UX — édition manuelle du prix total d'une ligne (corriger
        une promo, un total ajusté, une erreur d'OCR…). On verrouille
        `user_price_override = True` pour éviter qu'un changement futur de qté
        ne ré-écrase ce prix corrigé."""
        if self._matched is None or not (0 <= index < len(self._matched.lines)):
            return
        line = self._matched.lines[index]
        cleaned = (price_str or "").strip().replace(",", ".").replace("€", "").strip()
        if not cleaned:
            return
        try:
            new_total = Decimal(cleaned)
        except Exception:   # noqa: BLE001
            self.error_emitted.emit(f"Prix invalide : « {price_str} »")
            return
        if new_total <= 0:
            self.error_emitted.emit("Le prix doit être strictement positif.")
            return
        line.parsed.total_price = new_total
        # Recalcule unit_price = total / qty si on a une qty cohérente
        qty = line.parsed.quantity if line.parsed.quantity > 0 else 1
        line.parsed.unit_price = new_total / Decimal(qty)
        line.user_price_override = True
        self.line_changed.emit(index)

    @Slot(int, str)
    def setLineBarcode(self, index: int, barcode: str) -> None:  # noqa: N802
        """Stocke un EAN saisi sur la ligne. Sera utilisé comme source_ref si
        l'utilisateur crée un nouvel ingrédient depuis cette ligne."""
        if self._matched is None or not (0 <= index < len(self._matched.lines)):
            return
        self._matched.lines[index].user_barcode = (barcode or "").strip()
        self.line_changed.emit(index)

    @Slot(int, result=int)
    def lookupBarcodeAndAssign(self, index: int) -> int:  # noqa: N802
        """Lit l'EAN stocké sur la ligne, fait un lookup OFF, et si trouvé :
        - cache l'ingrédient en DB (in_personal_library=True)
        - l'assigne à la ligne via chosen_ingredient_id

        Retourne l'id assigné (ou 0 si rien trouvé). Workflow rapide pour
        l'utilisateur qui scanne un code-barres : tape EAN → bouton → tout
        est fait."""
        if self.ctx is None or self._matched is None:
            return 0
        if not (0 <= index < len(self._matched.lines)):
            return 0
        line = self._matched.lines[index]
        ean = (line.user_barcode or "").strip()
        if not ean or not ean.isdigit() or len(ean) < 8:
            self.error_emitted.emit("EAN invalide (au moins 8 chiffres requis).")
            return 0

        # 1. Vérifier si on a déjà cet EAN en DB
        with self.ctx.session() as s:
            existing = IngredientRepo(s).find_by_source_ref(Source.OPENFOODFACTS, ean)
            if existing is None:
                # Cherche aussi côté Lidl (au cas où c'est un produit Lidl)
                existing = IngredientRepo(s).find_by_source_ref(Source.LIDL, ean)
            if existing is not None and existing.id is not None:
                # Déjà connu — flippe in_personal_library et assigne
                IngredientRepo(s).mark_in_personal_library(existing.id, True)
                s.commit()
                line.chosen_ingredient_id = existing.id
                self.line_changed.emit(index)
                return existing.id

        # 2. Lookup OFF en ligne
        try:
            from app.services.openfoodfacts import lookup_barcode
            ing = lookup_barcode(ean)
        except Exception as exc:   # noqa: BLE001
            log.warning("EAN lookup failed for %s: %s", ean, exc)
            self.error_emitted.emit(f"Erreur OFF : {exc}")
            return 0
        if ing is None:
            self.error_emitted.emit(f"Aucun produit OpenFoodFacts pour l'EAN {ean}.")
            return 0

        # 3. Persiste en DB et assigne à la ligne
        ing.in_personal_library = True
        with self.ctx.session() as s:
            saved = IngredientRepo(s).create(ing)
            s.commit()
        if saved.id is None:
            return 0
        line.chosen_ingredient_id = saved.id
        self.line_changed.emit(index)
        return saved.id

    @Slot(int, str)
    def setLineExpiry(self, index: int, expiry_iso: str) -> None:  # noqa: N802
        if self._matched is None or not (0 <= index < len(self._matched.lines)):
            return
        line = self._matched.lines[index]
        if not expiry_iso.strip():
            line.expiry_date = None
        else:
            try:
                line.expiry_date = datetime.fromisoformat(expiry_iso + "T00:00:00")
            except ValueError:
                log.warning("Date péremption invalide : %s", expiry_iso)
                line.expiry_date = None
        self.line_changed.emit(index)

    @Slot(bool)
    def setForceImport(self, value: bool) -> None:  # noqa: N802
        """Quand `isDuplicate=True`, l'utilisateur peut activer ce flag pour
        forcer l'import malgré tout (utile si le ticket précédent a été
        importé partiellement et qu'on veut le re-faire proprement)."""
        self._force_import = value
        self.receipt_loaded.emit()

    @Slot(int, result="QVariantMap")
    def suggestCreatePayload(self, index: int) -> dict[str, Any]:  # noqa: N802
        """Phase 4 — pré-remplit le mini-form de création d'ingrédient avec les
        infos déduites de la ligne :
        - `name` : le `raw_name` du ticket (l'utilisateur peut éditer pour
          rétablir un nom long propre, ex. "FRANUI FRAMBSE CHOCO" → "Franui
          framboise chocolat")
        - `categoryL1` : "Alimentaire" si TVA A (Intermarché/Carrefour) ou si
          store=="lidl" (la TVA Lidl est numérique mais on suppose alimentaire
          par défaut, l'utilisateur peut toujours l'enlever).
        - `sourceRef` : le `store_key` Lidl (= art_id stable) si store=="lidl",
          sinon vide (on demandera à l'utilisateur de saisir l'EAN à la main
          si le ticket Intermarché/Carrefour ne le contient pas).
        - `quantity` : la quantité du ticket (utile pour pré-remplir le poids
          unitaire si l'utilisateur connaît le format).
        """
        if self._matched is None or not (0 <= index < len(self._matched.lines)):
            return {}
        line = self._matched.lines[index]
        store = self._matched.parsed.store

        is_food = line.parsed.is_likely_food
        category_l1 = "Alimentaire" if (is_food or store == "lidl") else ""

        source_ref = line.parsed.store_key if store == "lidl" else ""

        return {
            "index": index,
            "name": line.parsed.raw_name,
            "categoryL1": category_l1,
            "categoryL2": "",
            "sourceRef": source_ref,
            "pieceWeightG": 0.0,
            "priceQuantityG": 0.0,
            "store": store,
            "vatCode": line.parsed.vat_code,
            "quantity": line.parsed.quantity,
        }

    @Slot("QVariantMap", result=int)
    def createIngredientFromLine(self, payload: dict[str, Any]) -> int:  # noqa: N802
        """Crée un nouvel ingrédient pour une ligne sans match.
        `payload` : {
            index, name (requis),
            sourceRef (optionnel, EAN ou art_id Lidl),
            categoryL1, categoryL2 (optionnels),
            pieceWeightG (optionnel, grammes par pièce),
            priceQuantityG (optionnel, base de référence pour le prix),
        }.

        Retourne l'id du nouvel ingrédient (ou 0 si erreur). Le `chosenId`
        de la ligne est automatiquement mis à jour. L'alias est aussi
        enregistré pour matcher déterministiquement les futurs imports.

        Phase 4 — extension : auto-catégorie depuis le code TVA (A → "Alimentaire"),
        EAN/poids/référence prix optionnels.
        """
        if self.ctx is None or self._matched is None:
            return 0
        index = int(payload.get("index", -1))
        name = (payload.get("name") or "").strip()
        source_ref = (payload.get("sourceRef") or "").strip() or None
        category_l1 = (payload.get("categoryL1") or "").strip() or None
        category_l2 = (payload.get("categoryL2") or "").strip() or None
        try:
            piece_weight_g = float(payload.get("pieceWeightG") or 0)
        except (TypeError, ValueError):
            piece_weight_g = 0.0
        try:
            price_quantity_g = float(payload.get("priceQuantityG") or 0)
        except (TypeError, ValueError):
            price_quantity_g = 0.0

        if not (0 <= index < len(self._matched.lines)) or not name:
            return 0

        line = self._matched.lines[index]
        store = self._matched.parsed.store

        # Pour Lidl : source = LIDL + source_ref = art_id (déterministe).
        # Pour Intermarché/Carrefour : source = MANUAL + source_ref si l'utilisateur
        # a saisi un EAN (Phase 4) ; sinon NULL et on s'appuie sur l'alias appris.
        if store == "lidl":
            ing_source = Source.LIDL
            # Si la ligne porte déjà un store_key (= art_id Lidl), on l'utilise.
            # Sinon on accepte un EAN saisi à la main par l'utilisateur.
            ing_source_ref = line.parsed.store_key or source_ref
        else:
            # Phase 4 : si l'utilisateur a saisi un EAN, on bascule la source à
            # OPENFOODFACTS pour garder la sémantique cohérente — sinon MANUAL.
            if source_ref:
                ing_source = Source.OPENFOODFACTS
                ing_source_ref = source_ref
            else:
                ing_source = Source.MANUAL
                ing_source_ref = None

        new_ing = Ingredient(
            name=name,
            source=ing_source,
            source_ref=ing_source_ref,
            in_personal_library=True,
            category_l1=category_l1,
            category_l2=category_l2,
            piece_weight_g=piece_weight_g if piece_weight_g > 0 else None,
            price_quantity_g=price_quantity_g if price_quantity_g > 0 else None,
        )

        with self.ctx.session() as s:
            saved = IngredientRepo(s).create(new_ing)
            # Pour Intermarché/Carrefour, on enregistre aussi un alias pour
            # que le store_key (nom tronqué) → ingredient soit trouvé direct
            # au prochain import.
            if store != "lidl" and saved.id is not None:
                ReceiptAliasRepo(s).upsert(
                    store=store,
                    source_key=line.parsed.store_key,
                    ingredient_id=saved.id,
                )
            s.commit()

        if saved.id is not None:
            line.chosen_ingredient_id = saved.id
            self.line_changed.emit(index)
        return saved.id or 0

    @Slot(result="QVariantMap")
    def commitImport(self) -> dict[str, Any]:  # noqa: N802
        """Commit transactionnel de toutes les lignes choisies.

        - Pour chaque ligne avec `chosen_ingredient_id` : crée une
          `PriceHistoryEntry` et appelle `recompute_current_price` (auto-update
          du prix de référence).
        - Si `add_to_pantry=True` : crée aussi un `PantryStock`.
        - Pour les lignes Intermarché / Carrefour : upsert l'alias appris.
        - En cas de duplicate : skip si `force_import=False`.
        - Ajoute le ticket en `imported_receipt`.
        - Retourne `{success, message, priceCount, pantryCount}`."""
        if self.ctx is None or self._matched is None:
            self.import_completed.emit(False, "Aucun ticket chargé.")
            return {"success": False, "message": "Aucun ticket chargé."}

        if self._matched.is_duplicate and not self._force_import:
            msg = "Ticket déjà importé. Active 'Forcer' pour ré-importer."
            self.import_completed.emit(False, msg)
            return {"success": False, "message": msg}

        parsed = self._matched.parsed
        receipt_date = parsed.date or datetime.now()

        price_count = 0
        pantry_count = 0
        with self.ctx.session() as s:
            ph_repo = PriceHistoryRepo(s)
            pantry_repo = PantryRepo(s)
            alias_repo = ReceiptAliasRepo(s)
            ing_repo = IngredientRepo(s)

            for line in self._matched.lines:
                if line.chosen_ingredient_id is None:
                    continue
                if line.parsed.unit_price is None or line.parsed.unit_price <= 0:
                    log.warning("Skip ligne sans prix valide : %r", line.parsed.raw_name)
                    continue

                # Quantity_g : un ticket ne donne pas la masse en grammes.
                # Cascade de fallback :
                #   0. `line.quantity_g` si l'utilisateur l'a saisi via le
                #      QuantityField du dialog (refonte UX) — c'est la valeur
                #      la plus fiable car explicite.
                #   1. `ingredient.price_quantity_g` si déjà défini (métrique
                #      €/100g cohérente).
                #   2. `ingredient.piece_weight_g * receipt_qty` si le produit
                #      a un poids unitaire connu (1 oeuf = 60g, etc.).
                #   3. Default 1000g (1 kg) — placeholder honnête. La métrique
                #      €/100g sera alors approximative mais l'évolution dans
                #      le temps reste interprétable (variations relatives).
                ing = ing_repo.get(line.chosen_ingredient_id)
                if line.quantity_g and line.quantity_g > 0:
                    qty_g = line.quantity_g
                elif ing and ing.price_quantity_g and ing.price_quantity_g > 0:
                    qty_g = ing.price_quantity_g
                elif ing and ing.piece_weight_g and ing.piece_weight_g > 0:
                    qty_g = ing.piece_weight_g * line.parsed.quantity
                else:
                    qty_g = 1000.0

                ph_repo.add(PriceHistoryEntry(
                    ingredient_id=line.chosen_ingredient_id,
                    price_eur=line.parsed.unit_price * Decimal(line.parsed.quantity),
                    quantity_g=qty_g,
                    store=parsed.store,
                    recorded_at=receipt_date,
                    notes=f"Import ticket — {line.parsed.raw_name}",
                ))
                recompute_current_price(s, line.chosen_ingredient_id)
                price_count += 1

                if line.add_to_pantry:
                    pantry_repo.add(PantryStock(
                        ingredient_id=line.chosen_ingredient_id,
                        quantity_g=qty_g,
                        expiry_date=line.expiry_date,
                        notes=f"Importé depuis ticket {parsed.store}",
                    ))
                    pantry_count += 1

                # Mémorise l'alias pour les futurs imports (Intermarché / Carrefour).
                # Pour Lidl, le source_ref sur l'ingrédient suffit déjà.
                if parsed.store != "lidl":
                    alias_repo.upsert(
                        store=parsed.store,
                        source_key=line.parsed.store_key,
                        ingredient_id=line.chosen_ingredient_id,
                    )

            # Ticket en anti-doublon
            if parsed.ticket_id and not self._matched.is_duplicate:
                ImportedReceiptRepo(s).add(
                    ticket_id=parsed.ticket_id,
                    store=parsed.store,
                    receipt_date=parsed.date,
                    total_eur=parsed.total_eur,
                    line_count=len(self._matched.lines),
                )
            s.commit()

        # Phase 2 — Cleanup Option B : suppression du fichier source après
        # commit réussi. On ne supprime QUE les fichiers qui sont dans le
        # sous-dossier dédié — jamais ailleurs (sécurité). Si le fichier vient
        # d'un import direct (file picker depuis n'importe où), on le laisse.
        from app.services.receipt_watcher import default_receipt_dir
        deleted_file = False
        if self._source_path is not None:
            try:
                receipt_dir = default_receipt_dir().resolve()
                src = self._source_path.resolve()
                # Vérifie que le fichier est bien sous le sous-dossier dédié
                # (évite de supprimer un PDF que l'utilisateur a importé depuis
                # ailleurs sur son disque).
                if str(src).startswith(str(receipt_dir)):
                    src.unlink(missing_ok=True)
                    deleted_file = True
                    # Retire aussi de la liste des pending si présent
                    if self._source_path in self._pending_files:
                        self._pending_files.remove(self._source_path)
                        self.pending_files_changed.emit()
                    log.info("Cleanup: deleted receipt file %s", src.name)
            except OSError as exc:
                # Pas fatal — on log mais on n'empêche pas le succès du commit
                log.warning("Could not delete receipt file %s: %s", self._source_path, exc)

        msg = (
            f"Import réussi : {price_count} prix enregistré"
            + ("s" if price_count > 1 else "")
            + (f" + {pantry_count} ajout(s) au frigo" if pantry_count > 0 else "")
            + (" · fichier supprimé" if deleted_file else "")
        )
        log.info("Receipt import committed: %s", msg)
        self.import_completed.emit(True, msg)
        return {
            "success": True, "message": msg,
            "priceCount": price_count, "pantryCount": pantry_count,
        }

    @Slot()
    def reset(self) -> None:
        """Vide le buffer (le dialog est fermé sans commit)."""
        self._matched = None
        self._source_path = None
        self._force_import = False
        self.receipt_loaded.emit()

    # ============================================================ Phase 2 — Watcher integration

    @Property(int, notify=pending_files_changed)
    def pendingFileCount(self) -> int:  # noqa: N802
        """Nombre de fichiers ticket en attente dans le sous-dossier.
        Mis à jour à chaque scan / nouveau fichier détecté."""
        return len(self._pending_files)

    @Slot()
    def rescanPending(self) -> None:  # noqa: N802
        """Re-scanne le sous-dossier pour rafraîchir la liste des fichiers en
        attente. Appelé au boot, et au cas où l'utilisateur déplace des
        fichiers manuellement."""
        from app.services.receipt_watcher import list_pending_files
        self._pending_files = list_pending_files()
        log.info("Pending receipt files: %d", len(self._pending_files))
        self.pending_files_changed.emit()

    @Slot(str)
    def onWatcherDetectedFile(self, path_str: str) -> None:  # noqa: N802
        """Slot connecté au signal `file_detected` du watcher.
        Met à jour la liste des pendings et émet `new_file_detected` pour
        que la status bar / toast affiche une notification."""
        path = Path(path_str)
        if path not in self._pending_files:
            self._pending_files.append(path)
            self.pending_files_changed.emit()
        self.new_file_detected.emit(path_str)
        log.info("Watcher detected new file: %s", path.name)

    @Slot(result=str)
    def loadNextPending(self) -> str:  # noqa: N802
        """Charge le plus ancien fichier en attente dans le buffer.
        Retourne le path chargé ou "" si aucun pending. Appelé au boot
        quand l'utilisateur clique 'Importer maintenant' sur le badge."""
        if not self._pending_files:
            return ""
        path = self._pending_files[0]
        if not path.exists():
            # Le fichier a été supprimé entre la détection et l'appel
            self._pending_files.pop(0)
            self.pending_files_changed.emit()
            return ""
        ok = self.loadFromPath(str(path))
        if ok:
            return str(path)
        # Échec → on retire de la liste pour ne pas bloquer
        self._pending_files.pop(0)
        self.pending_files_changed.emit()
        return ""

    # ============================================================ Helpers Python

    @property
    def source_path(self) -> Path | None:
        return self._source_path
