"""ViewModel for the URL recipe import wizard (3 steps).

Drives `ImportRecipeUrlDialog.qml`. State machine :

    step 0 : URL input
        |
        v  extractFromUrl() — runs on background thread
        |
    step 1 : review + per-ingredient association
        |
        v  commit() — creates Recipe + RecipeLines via RecipeRepo
        |
    step 2 : confirmation, emits import_completed(recipe_id)

The buffer is a `ResolvedRecipeImport` (mutable). QML reads the lines via
`linesAsList()` and mutates them via `setLine*` slots — same convention as
`ReceiptImportViewModel`.

Threading note : `fetch_recipe()` is sync and may take 5–10 s. We launch
it on a `threading.Thread` (daemon). Result is returned to the Qt main
thread by emitting a Qt `Signal` from the worker — Qt auto-promotes the
emission to a `QueuedConnection` because the receiver QObject lives in
the main thread, so receiving slots run safely on the Qt loop.
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from PySide6.QtCore import Property, QObject, Signal, Slot
from PySide6.QtQml import QmlElement

from app.data.repositories import IngredientRepo, RecipeRepo
from app.domain.models import Ingredient, Recipe, RecipeLine, Source
from app.domain.units import to_grams
from app.domain.url_recipe import (
    ExtractedRecipe,
    ResolvedLine,
    ResolvedRecipeImport,
)
from app.services import openfoodfacts as off
from app.services.ingredient_search import (
    fetch_from_openfoodfacts_and_cache,
    promote_to_personal_library,
    resolve_ingredient_name,
)
from app.services.photo_service import save_recipe_photo_from_http_url
from app.services.recipe_url_importer import (
    RecipeImportError,
    fetch_recipe,
)
from app.ui.app_context import AppContext

QML_IMPORT_NAME = "App.ViewModels"
QML_IMPORT_MAJOR_VERSION = 1

log = logging.getLogger(__name__)


def _ing_summary(ing: Ingredient) -> dict[str, Any]:
    """Compact dict for QML candidate combobox / chip."""
    return {
        "id":         ing.id,
        "name":       ing.name,
        "source":     ing.source.value,
        "categoryL1": ing.category_l1 or "",
        "inLibrary":  bool(ing.in_personal_library),
        "pieceWeightG": ing.piece_weight_g if ing.piece_weight_g is not None else 0.0,
    }


@QmlElement
class RecipeUrlImportViewModel(QObject):
    """Drives the URL recipe import dialog. Stateful : owns a
    `ResolvedRecipeImport` buffer that QML mutates via slots. On `commit()`
    the buffer is persisted as a regular `Recipe` and the dialog closes."""

    # --- Signals ---
    extraction_started = Signal()
    extraction_completed = Signal(bool)        # True = success → step 1
    extraction_failed = Signal(str)            # message FR
    lines_changed = Signal(int)                # idx (-1 = whole list)
    candidates_changed = Signal(int)           # ligne dont les candidates ont été re-fetchées
    import_completed = Signal(int)             # nouveau recipe_id
    error_emitted = Signal(str)
    step_changed = Signal()
    meta_changed = Signal()

    # Internal cross-thread signals — used by the worker thread to hand the
    # result back to the Qt loop. Carry `object` so Python objects pass.
    _worker_result_ready = Signal(object)      # ResolvedRecipeImport
    _worker_error_ready = Signal(str)

    def __init__(
        self,
        ctx: AppContext | None = None,
        parent: QObject | None = None,
    ) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self._step: int = 0
        self._resolved: ResolvedRecipeImport | None = None
        # Hook the worker signals to the Qt-side handlers. Qt auto-uses a
        # QueuedConnection because the worker thread != self.thread().
        self._worker_result_ready.connect(self._on_worker_done)
        self._worker_error_ready.connect(self._on_worker_failed)

    # ============================================================ Properties

    @Property(int, notify=step_changed)
    def stepIndex(self) -> int:  # noqa: N802
        return self._step

    @Property(bool, notify=meta_changed)
    def hasExtracted(self) -> bool:  # noqa: N802
        return self._resolved is not None

    @Property(str, notify=meta_changed)
    def name(self) -> str:
        return self._resolved.extracted.name if self._resolved else ""

    @Property(str, notify=meta_changed)
    def instructions(self) -> str:
        return self._resolved.extracted.instructions if self._resolved else ""

    @Property(int, notify=meta_changed)
    def defaultPortions(self) -> int:  # noqa: N802
        return self._resolved.extracted.default_portions if self._resolved else 1

    @Property(int, notify=meta_changed)
    def prepTimeMin(self) -> int:  # noqa: N802
        if self._resolved and self._resolved.extracted.prep_time_min is not None:
            return self._resolved.extracted.prep_time_min
        return 0

    @Property(str, notify=meta_changed)
    def sourceUrl(self) -> str:  # noqa: N802
        return self._resolved.extracted.source_url if self._resolved else ""

    @Property(int, notify=lines_changed)
    def lineCount(self) -> int:  # noqa: N802
        return len(self._resolved.lines) if self._resolved else 0

    # ============================================================ Step navigation

    @Slot()
    def reset(self) -> None:
        self._resolved = None
        self._set_step(0)
        self.meta_changed.emit()
        self.lines_changed.emit(-1)

    @Slot()
    def goToStep0(self) -> None:  # noqa: N802
        self._set_step(0)

    @Slot()
    def goToStep1(self) -> None:  # noqa: N802
        if self._resolved is None:
            return
        self._set_step(1)

    def _set_step(self, value: int) -> None:
        if self._step != value:
            self._step = value
            self.step_changed.emit()

    # ============================================================ Extraction

    @Slot(str)
    def extractFromUrl(self, url: str) -> None:  # noqa: N802
        """Fire-and-forget : lance le fetch dans un thread daemon. Le QML
        montre un BusyIndicator entre `extraction_started` et soit
        `extraction_completed(True)` (→ step 1) soit `extraction_failed(msg)`."""
        url = (url or "").strip()
        if not url:
            self.extraction_failed.emit("Colle une URL avant de charger.")
            return
        self.extraction_started.emit()
        thread = threading.Thread(
            target=self._do_extract,
            args=(url,),
            daemon=True,
        )
        thread.start()

    def _do_extract(self, url: str) -> None:
        """Runs on a worker thread. Must NOT touch QML or non-thread-safe
        Qt state directly — communicate back via the `_worker_*` signals."""
        try:
            extracted = fetch_recipe(url)
            if self.ctx is not None:
                with self.ctx.session() as s:
                    resolved = self._build_resolved(s, extracted)
            else:
                resolved = ResolvedRecipeImport(
                    extracted=extracted,
                    lines=[ResolvedLine(extracted=ing) for ing in extracted.ingredients],
                )
            self._worker_result_ready.emit(resolved)
        except RecipeImportError as exc:
            self._worker_error_ready.emit(str(exc))
        except Exception as exc:  # noqa: BLE001 — defensive against unknown failures
            log.exception("Unexpected error during recipe extraction")
            self._worker_error_ready.emit(f"Erreur inattendue : {exc}")

    def _build_resolved(
        self,
        session,
        extracted: ExtractedRecipe,
    ) -> ResolvedRecipeImport:
        """For each extracted ingredient, run `resolve_ingredient_name` and
        seed `ResolvedLine.candidates` + auto-pick the best candidate."""
        lines: list[ResolvedLine] = []
        for ing_extracted in extracted.ingredients:
            resolved_line = ResolvedLine(extracted=ing_extracted)
            # Initial qty/unit defaults from the parser (best-effort). When
            # qty is unknown, default to 100 g — the user adjusts.
            qty = ing_extracted.parsed_quantity or 0.0
            unit = ing_extracted.parsed_unit or "g"
            try:
                resolved_line.quantity_g = (
                    to_grams(qty, unit) if qty > 0 and unit != "_piece" else qty * 1.0
                )
            except KeyError:
                resolved_line.quantity_g = qty if qty > 0 else 100.0
            if resolved_line.quantity_g <= 0:
                resolved_line.quantity_g = 100.0
            resolved_line.unit_code = unit if unit in {"g", "kg", "ml", "cl", "dl",
                                                        "L", "c_cafe", "c_soupe",
                                                        "tasse", "pincee"} else "g"

            # Resolve candidates locally
            candidates = resolve_ingredient_name(session, ing_extracted.parsed_name)
            resolved_line.candidates = [c.id for c in candidates if c.id is not None]
            if resolved_line.candidates:
                resolved_line.chosen_ingredient_id = resolved_line.candidates[0]
            lines.append(resolved_line)
        return ResolvedRecipeImport(extracted=extracted, lines=lines)

    @Slot(object)
    def _on_worker_done(self, resolved: ResolvedRecipeImport) -> None:
        self._resolved = resolved
        self.meta_changed.emit()
        self.lines_changed.emit(-1)
        self._set_step(1)
        self.extraction_completed.emit(True)

    @Slot(str)
    def _on_worker_failed(self, message: str) -> None:
        self.extraction_failed.emit(message)
        self.extraction_completed.emit(False)

    # ============================================================ Meta editing

    @Slot(str, str, int)
    def updateMeta(self, name: str, instructions: str, portions: int) -> None:  # noqa: N802
        if self._resolved is None:
            return
        ext = self._resolved.extracted
        ext.name = (name or "").strip() or ext.name
        ext.instructions = instructions or ""
        ext.default_portions = max(1, int(portions) if portions else 1)
        self.meta_changed.emit()

    # ============================================================ Lines

    @Slot(result="QVariantList")
    def linesAsList(self) -> list[dict[str, Any]]:  # noqa: N802
        """Renders each line for QML : raw text + chosen ingredient name +
        candidates dicts + qty/unit + ignored flag."""
        if self._resolved is None or self.ctx is None:
            return []
        out: list[dict[str, Any]] = []
        with self.ctx.session() as s:
            repo = IngredientRepo(s)
            # Cache hydrated candidates for this render to avoid repeated lookups
            id_to_ing: dict[int, Ingredient] = {}
            for line in self._resolved.lines:
                for cid in line.candidates:
                    if cid not in id_to_ing:
                        ing = repo.get(cid)
                        if ing is not None:
                            id_to_ing[cid] = ing
                if line.chosen_ingredient_id and line.chosen_ingredient_id not in id_to_ing:
                    ing = repo.get(line.chosen_ingredient_id)
                    if ing is not None:
                        id_to_ing[line.chosen_ingredient_id] = ing
            for idx, line in enumerate(self._resolved.lines):
                chosen = (
                    id_to_ing.get(line.chosen_ingredient_id)
                    if line.chosen_ingredient_id else None
                )
                out.append({
                    "idx":             idx,
                    "rawText":         line.extracted.raw_text,
                    "parsedName":      line.extracted.parsed_name,
                    "candidates":      [
                        _ing_summary(id_to_ing[cid])
                        for cid in line.candidates
                        if cid in id_to_ing
                    ],
                    "chosenIngredientId":   line.chosen_ingredient_id or 0,
                    "chosenIngredientName": chosen.name if chosen else "",
                    "chosenSource":         chosen.source.value if chosen else "",
                    "pieceWeightG":         (chosen.piece_weight_g
                                             if chosen and chosen.piece_weight_g
                                             else 0.0),
                    "quantityG":            line.quantity_g,
                    "unitCode":             line.unit_code,
                    "isIgnored":            line.is_ignored,
                    "hasMatch":             line.chosen_ingredient_id is not None,
                })
        return out

    @Slot(int, int)
    def setLineChosenIngredient(self, idx: int, ingredient_id: int) -> None:  # noqa: N802
        if self._resolved is None or not (0 <= idx < len(self._resolved.lines)):
            return
        line = self._resolved.lines[idx]
        new_id = ingredient_id or None
        line.chosen_ingredient_id = new_id
        # Si l'utilisateur a choisi via la popup de recherche (CIQUAL/OFF),
        # l'id n'est probablement pas dans `candidates`. On l'y ajoute en tête
        # pour que la combobox ait un libellé à afficher (sinon elle tombe
        # sur "(non associé)") et que le binding `chosenIngredientName` du
        # `linesAsList` retourne le bon nom.
        if new_id is not None and new_id not in line.candidates:
            line.candidates = [new_id, *line.candidates]
        # If the chosen ingredient was a CIQUAL/OFF cached row, leave the
        # promotion to commit-time so the user can still revert.
        self.lines_changed.emit(idx)

    @Slot(int, float)
    def setLineQuantityG(self, idx: int, qty_g: float) -> None:  # noqa: N802
        if self._resolved is None or not (0 <= idx < len(self._resolved.lines)):
            return
        self._resolved.lines[idx].quantity_g = max(0.0, float(qty_g))
        self.lines_changed.emit(idx)

    @Slot(int, str)
    def setLineUnitCode(self, idx: int, unit_code: str) -> None:  # noqa: N802
        if self._resolved is None or not (0 <= idx < len(self._resolved.lines)):
            return
        self._resolved.lines[idx].unit_code = unit_code or "g"
        self.lines_changed.emit(idx)

    @Slot(int, str)
    def setLineParsedName(self, idx: int, name: str) -> None:  # noqa: N802
        """User edited the name → re-search candidates locally."""
        if self._resolved is None or not (0 <= idx < len(self._resolved.lines)):
            return
        line = self._resolved.lines[idx]
        line.extracted.parsed_name = name.strip()
        line.is_manual_override = True
        if self.ctx is not None and line.extracted.parsed_name:
            with self.ctx.session() as s:
                cands = resolve_ingredient_name(s, line.extracted.parsed_name)
            line.candidates = [c.id for c in cands if c.id is not None]
            line.chosen_ingredient_id = line.candidates[0] if line.candidates else None
        else:
            line.candidates = []
            line.chosen_ingredient_id = None
        self.candidates_changed.emit(idx)
        self.lines_changed.emit(idx)

    @Slot(int, str)
    def searchCandidatesForLine(self, idx: int, query: str) -> None:  # noqa: N802
        """Re-run a local search with a custom query (without touching the
        line's parsed_name). Used by the inline 'Rechercher autrement' input."""
        if self._resolved is None or not (0 <= idx < len(self._resolved.lines)):
            return
        if self.ctx is None:
            return
        q = (query or "").strip()
        if not q:
            return
        with self.ctx.session() as s:
            cands = resolve_ingredient_name(s, q)
        line = self._resolved.lines[idx]
        line.candidates = [c.id for c in cands if c.id is not None]
        if line.candidates:
            line.chosen_ingredient_id = line.candidates[0]
        self.candidates_changed.emit(idx)
        self.lines_changed.emit(idx)

    @Slot(int)
    def searchOnlineForLine(self, idx: int) -> None:  # noqa: N802
        """Hit OpenFoodFacts for this line's parsed_name. Caches results
        locally and re-runs `resolve_ingredient_name` so the new rows show
        up as candidates."""
        if self._resolved is None or not (0 <= idx < len(self._resolved.lines)):
            return
        if self.ctx is None:
            return
        line = self._resolved.lines[idx]
        query = line.extracted.parsed_name
        if not query:
            return
        try:
            with self.ctx.session() as s:
                fetch_from_openfoodfacts_and_cache(s, query, page_size=10)
                cands = resolve_ingredient_name(s, query)
        except off.OpenFoodFactsError as exc:
            self.error_emitted.emit(str(exc))
            return
        line.candidates = [c.id for c in cands if c.id is not None]
        if line.candidates and line.chosen_ingredient_id is None:
            line.chosen_ingredient_id = line.candidates[0]
        self.candidates_changed.emit(idx)
        self.lines_changed.emit(idx)

    @Slot(int)
    def ignoreLine(self, idx: int) -> None:  # noqa: N802
        """Mark the line as ignored — it won't end up in the saved Recipe."""
        if self._resolved is None or not (0 <= idx < len(self._resolved.lines)):
            return
        self._resolved.lines[idx].is_ignored = True
        self.lines_changed.emit(idx)

    @Slot(int)
    def unignoreLine(self, idx: int) -> None:  # noqa: N802
        if self._resolved is None or not (0 <= idx < len(self._resolved.lines)):
            return
        self._resolved.lines[idx].is_ignored = False
        self.lines_changed.emit(idx)

    @Slot(int, "QVariantMap", result=int)
    def createManualForLine(self, idx: int, payload: dict[str, Any]) -> int:  # noqa: N802
        """Create a new manual ingredient on the fly, attach it to this line.

        `payload` accepts at minimum `name`. Optional : `categoryL1`,
        `kcalPer100g`. Returns the newly created ingredient id (or 0 on
        failure).
        """
        if self._resolved is None or not (0 <= idx < len(self._resolved.lines)):
            return 0
        if self.ctx is None:
            return 0
        name = (payload.get("name") or "").strip()
        if not name:
            self.error_emitted.emit("Le nom de l'ingrédient est obligatoire.")
            return 0
        ing = Ingredient(
            name=name,
            source=Source.MANUAL,
            in_personal_library=True,
            category_l1=(payload.get("categoryL1") or None) or None,
            kcal_per_100g=(float(payload["kcalPer100g"])
                           if payload.get("kcalPer100g") else None),
        )
        with self.ctx.session() as s:
            saved = IngredientRepo(s).create(ing)
        if saved.id is None:
            return 0
        line = self._resolved.lines[idx]
        # Push to top of candidates and pick it
        line.candidates = [saved.id, *[c for c in line.candidates if c != saved.id]]
        line.chosen_ingredient_id = saved.id
        self.candidates_changed.emit(idx)
        self.lines_changed.emit(idx)
        return saved.id

    # ============================================================ Commit

    @Slot(result="QVariantMap")
    def commit(self) -> dict[str, Any]:
        """Persist the resolved recipe via RecipeRepo. Returns a status dict
        for QML to react. On success emits `import_completed(recipe_id)`
        and switches to step 2."""
        if self._resolved is None:
            return {"success": False, "recipeId": 0, "message": "Aucune recette à importer."}
        if self.ctx is None:
            return {"success": False, "recipeId": 0, "message": "Contexte indisponible."}

        active_lines = [ln for ln in self._resolved.lines if not ln.is_ignored]
        if not active_lines:
            return {
                "success": False, "recipeId": 0,
                "message": "Toutes les lignes sont ignorées — rien à importer.",
            }
        unmatched = [ln for ln in active_lines if ln.chosen_ingredient_id is None]
        if unmatched:
            return {
                "success": False, "recipeId": 0,
                "message": (
                    f"{len(unmatched)} ingrédient(s) non associé(s). "
                    "Utilise « Ignorer », « Créer manuellement » ou "
                    "« Chercher en ligne (OFF) » sur chaque ligne."
                ),
            }

        ext = self._resolved.extracted
        with self.ctx.session() as s:
            repo = IngredientRepo(s)
            recipe_lines: list[RecipeLine] = []
            for ordinal, ln in enumerate(active_lines):
                ing = repo.get(ln.chosen_ingredient_id)  # type: ignore[arg-type]
                if ing is None:
                    continue
                # Promote CIQUAL/OFF cached rows to personal library so they
                # show up in the user's regular ingredient list afterwards.
                if not ing.in_personal_library and ing.id is not None:
                    promoted = promote_to_personal_library(s, ing.id)
                    if promoted is not None:
                        ing = promoted
                recipe_lines.append(RecipeLine(
                    ingredient=ing,
                    quantity_g=ln.quantity_g if ln.quantity_g > 0 else 100.0,
                    unit=ln.unit_code or None,
                    notes=None,
                    ordinal=ordinal,
                ))
            recipe = Recipe(
                name=ext.name.strip() or "(recette importée)",
                instructions=ext.instructions or "",
                default_portions=max(1, ext.default_portions),
                lines=recipe_lines,
            )
            saved = RecipeRepo(s).create(recipe)
        if saved.id is None:
            return {"success": False, "recipeId": 0, "message": "Échec de la sauvegarde."}

        # Téléchargement de l'image de la recette si extraite. Best-effort :
        # une URL morte ou un format inconnu ne doit PAS faire échouer le
        # commit — on logge et on continue (l'utilisateur pourra ajouter
        # une photo manuellement plus tard).
        if ext.image_url:
            try:
                filename = save_recipe_photo_from_http_url(ext.image_url, saved.id)
                with self.ctx.session() as s:
                    saved_with_photo = saved.model_copy(update={"image_path": filename})
                    RecipeRepo(s).update(saved_with_photo)
            except Exception as exc:  # noqa: BLE001 — best-effort, on logge tout
                log.warning(
                    "Échec du téléchargement de l'image (%s) : %s — recette créée sans photo.",
                    ext.image_url, exc,
                )

        self._set_step(2)
        self.import_completed.emit(saved.id)
        return {
            "success": True,
            "recipeId": saved.id,
            "message": f"Recette « {saved.name} » importée avec {len(recipe_lines)} ingrédient(s).",
        }
