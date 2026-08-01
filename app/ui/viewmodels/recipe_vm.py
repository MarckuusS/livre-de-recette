"""ViewModels for the recipes tab: list + per-recipe editor.

Phase 2: list VM exposes a `RecipeListModel` and @Slot wrappers. The editor VM
keeps its existing in-memory edit-buffer pattern with its three signals
(`loaded`/`lines_changed`/`derived_changed`) and adds @Slot wrappers + Property
aliases so QML can bind the recipe meta + lines without re-implementing logic.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from PySide6.QtCore import Property, QObject, Signal, Slot
from PySide6.QtQml import QmlElement

from app.data.repositories import CookingLogRepo, IngredientRepo, RecipeRepo
from app.domain import nutrition, pricing
from app.domain.models import (
    CookingLogEntry,
    Ingredient,
    NutritionTotal,
    Recipe,
    RecipeLine,
)
from app.services.photo_service import (
    absolute_photo_path,
    delete_recipe_photo,
    save_recipe_photo,
    save_recipe_photo_from_http_url,
)
from app.ui.app_context import AppContext
from app.ui.models import RecipeListModel

QML_IMPORT_NAME = "App.ViewModels"
QML_IMPORT_MAJOR_VERSION = 1


# ----- helpers --------------------------------------------------------------


def _parse_iso_datetime(s: str | None) -> datetime:
    """Parse an ISO date / datetime string. Empty / None → now()."""
    if not s:
        return datetime.now()
    s = s.strip()
    if not s:
        return datetime.now()
    if len(s) == 10:  # "YYYY-MM-DD"
        return datetime.fromisoformat(s + "T00:00:00")
    d = datetime.fromisoformat(s.replace("Z", "+00:00").rstrip("Z"))
    if d.tzinfo is not None:
        d = d.replace(tzinfo=None)
    return d


def _cooking_log_to_dict(e: CookingLogEntry | None) -> dict[str, Any]:
    if e is None:
        return {}
    return {
        "id":            e.id,
        "recipeId":      e.recipe_id,
        "cookedAtIso":   e.cooked_at.isoformat(),
        # Pré-formatté pour QML : "01/05/2026" (locale française attendue côté UI)
        "cookedAtHuman": e.cooked_at.strftime("%d/%m/%Y"),
        "rating":        e.rating or 0,    # 0 = no rating (cleaner for QML)
        "notes":         e.notes or "",
    }


def _line_to_dict(line: RecipeLine) -> dict[str, Any]:
    """Recipe line → QML-friendly dict. Includes the nested ingredient summary,
    and the L1 category needed by B5 (auto-sort par rayon)."""
    ing = line.ingredient
    return {
        "ordinal":            line.ordinal,
        "ingredientId":       ing.id,
        "ingredientName":     ing.name,
        "ingredientSource":   ing.source.value,
        "ingredientPieceWeightG": ing.piece_weight_g,
        "categoryL1":         ing.category_l1 or "",
        "quantityG":          line.quantity_g,
        "unit":               line.unit or "",
        "notes":              line.notes or "",
    }


def _line_to_dict_scaled(line: RecipeLine, ratio: float) -> dict[str, Any]:
    """Like `_line_to_dict` but returns the displayed quantity scaled by the
    given ratio (1.0 = no scaling). Also exposes `originalQuantityG` for
    tooltip / debug display."""
    d = _line_to_dict(line)
    d["originalQuantityG"] = line.quantity_g
    if ratio != 1.0:
        d["quantityG"] = line.quantity_g * ratio
    return d


def _nutrition_to_dict(n: NutritionTotal) -> dict[str, Any]:
    return {
        "kcal":          n.kcal,
        "proteins":      n.proteins_g,
        "carbs":         n.carbs_g,
        "sugars":        n.sugars_g,
        "fats":          n.fats_g,
        "saturatedFats": n.saturated_fats_g,
        "fiber":         n.fiber_g,
        "salt":          n.salt_g,
    }


def _nutrition_scaled(n: NutritionTotal, ratio: float) -> NutritionTotal:
    """Scale every macro by the ratio. Pure transformation — no mutation."""
    if ratio == 1.0:
        return n
    return NutritionTotal(
        kcal=n.kcal * ratio,
        proteins_g=n.proteins_g * ratio,
        carbs_g=n.carbs_g * ratio,
        sugars_g=n.sugars_g * ratio,
        fats_g=n.fats_g * ratio,
        saturated_fats_g=n.saturated_fats_g * ratio,
        fiber_g=n.fiber_g * ratio,
        salt_g=n.salt_g * ratio,
    )


# ----- list viewmodel -------------------------------------------------------


@QmlElement
class RecipeListViewModel(QObject):
    items_changed = Signal()
    tag_filter_changed = Signal()
    deletion_pending_undo = Signal(str)  # label for UndoToast (U3)

    def __init__(self, ctx: AppContext | None = None, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self._model = RecipeListModel(self)
        # Active tag filter — recipe is shown if it has AT LEAST ONE of these tags.
        # Empty list → no filter.
        self._tag_filter: list[int] = []
        # U3 undo buffer: snapshot of the last deleted recipe (incl. lines + tags).
        self._last_deleted: Recipe | None = None
        if ctx is not None:
            self.refresh()

    # -- QML-facing -----------------------------------------------------------

    @Property(QObject, constant=True)
    def items(self) -> RecipeListModel:
        return self._model

    @Property("QVariantList", notify=tag_filter_changed)
    def tagFilter(self) -> list[int]:  # noqa: N802
        return list(self._tag_filter)

    @Slot()
    def refreshList(self) -> None:  # noqa: N802
        self.refresh()

    @Slot(int)
    def deleteRecipe(self, recipe_id: int) -> None:  # noqa: N802
        self.delete(recipe_id)

    @Slot(str, int, result="QVariantList")
    def searchOnce(self, query: str, limit: int = 12) -> list[dict[str, Any]]:  # noqa: N802
        """B6 : one-shot recipe search by name substring (case-insensitive,
        casefold for proper Œ/œ matching). Used by the unified Ctrl+K
        dialog. Returns up to `limit` dicts with `id`, `name`,
        `defaultPortions`, `lineCount`."""
        q = (query or "").strip().casefold()
        if self.ctx is None or not q:
            return []
        with self.ctx.session() as s:
            recipes = RecipeRepo(s).list_all()
        matches = [r for r in recipes if q in r.name.casefold()]
        return [{
            "id":               r.id,
            "name":             r.name,
            "defaultPortions":  r.default_portions,
            "lineCount":        len(r.lines),
        } for r in matches[:limit]]

    @Slot("QVariantList")
    def setTagFilter(self, tag_ids: list[int]) -> None:  # noqa: N802
        """Replace the active tag filter and refresh. Empty list → no filter."""
        new_ids = [int(x) for x in tag_ids if x is not None]
        if new_ids == self._tag_filter:
            return
        self._tag_filter = new_ids
        self.tag_filter_changed.emit()
        self.refresh()

    @Slot(int)
    def toggleTagFilter(self, tag_id: int) -> None:  # noqa: N802
        """Add the tag to the active filter if absent, remove it if present.
        Convenience for QML chip toggles."""
        if tag_id in self._tag_filter:
            self._tag_filter = [t for t in self._tag_filter if t != tag_id]
        else:
            self._tag_filter = [*self._tag_filter, tag_id]
        self.tag_filter_changed.emit()
        self.refresh()

    @Slot()
    def clearTagFilter(self) -> None:  # noqa: N802
        if self._tag_filter:
            self._tag_filter = []
            self.tag_filter_changed.emit()
            self.refresh()

    @Slot("QVariantList", float, result="QVariantList")
    def findByIngredients(self, ingredient_ids: list, min_match: float = 0.5) -> list[dict]:  # noqa: N802
        """Recipes that can be cooked from the given ingredients, sorted by
        match-score descending. See `RecipeRepo.find_by_ingredient_ids`.

        Returns a list of dicts: `{recipeId, name, score (0..1), matchCount,
        totalCount, photoUrl}`. The UI builds a result dialog from this."""
        if self.ctx is None:
            return []
        ids = [int(i) for i in ingredient_ids if i is not None]
        if not ids:
            return []
        with self.ctx.session() as s:
            matches = RecipeRepo(s).find_by_ingredient_ids(ids, min_match=min_match)
        from app.services.photo_service import absolute_photo_path
        out = []
        for r, score, match_count, total_count in matches:
            abs_photo = absolute_photo_path(r.image_path)
            out.append({
                "recipeId":   r.id,
                "name":       r.name,
                "score":      score,
                "matchCount": match_count,
                "totalCount": total_count,
                "photoUrl":   abs_photo.as_uri() if abs_photo else "",
            })
        return out

    @Slot("QVariantList", int, result="QVariantMap")
    def findByIngredientsCategorized(self, ingredient_ids: list, max_missing: int = 3) -> dict:  # noqa: N802
        """Refonte UX : 3 sections au lieu d'un seuil unique.

        Retourne un dict avec 3 clés :
        - `ready`    : recettes faisables maintenant (tous les ingrédients sont là)
        - `missing`  : recettes auxquelles il manque ≤ max_missing ingrédients,
                       avec la liste des manquants
        - `shopping` : top 5 ingrédients à acheter pour débloquer le plus de recettes
        """
        empty = {"ready": [], "missing": [], "shopping": []}
        if self.ctx is None:
            return empty
        ids = [int(i) for i in ingredient_ids if i is not None]
        if not ids:
            return empty
        with self.ctx.session() as s:
            cat = RecipeRepo(s).find_by_ingredient_ids_categorized(ids, max_missing=max_missing)

        from app.services.photo_service import absolute_photo_path

        def _recipe_to_dict(r, score, match_count, total_count, missing_ids, missing_names):
            abs_photo = absolute_photo_path(r.image_path)
            return {
                "recipeId":     r.id,
                "name":         r.name,
                "score":        score,
                "matchCount":   match_count,
                "totalCount":   total_count,
                "missingCount": len(missing_ids),
                "missingNames": missing_names,
                "photoUrl":     abs_photo.as_uri() if abs_photo else "",
            }

        return {
            "ready":   [_recipe_to_dict(*t) for t in cat["ready"]],
            "missing": [_recipe_to_dict(*t) for t in cat["missing"]],
            "shopping": [
                {"ingredientId": iid, "name": name, "unlockCount": count}
                for iid, name, count in cat["shopping"]
            ],
        }

    # -- Python-side ----------------------------------------------------------

    def refresh(self) -> None:
        if self.ctx is None:
            return
        with self.ctx.session() as s:
            recipes = RecipeRepo(s).list_all(tag_ids=self._tag_filter or None)
        self._model.set_items(recipes)
        self.items_changed.emit()

    def get(self, recipe_id: int) -> Recipe | None:
        if self.ctx is None:
            return None
        with self.ctx.session() as s:
            return RecipeRepo(s).get(recipe_id)

    def save(self, recipe: Recipe) -> Recipe:
        with self.ctx.session() as s:
            repo = RecipeRepo(s)
            saved = repo.update(recipe) if recipe.id is not None else repo.create(recipe)
        self.refresh()
        return saved

    def delete(self, recipe_id: int) -> None:
        if self.ctx is None:
            return
        with self.ctx.session() as s:
            repo = RecipeRepo(s)
            # Snapshot before deletion — full Recipe with lines + tags. U3 undo
            # restores the recipe via repo.create() (NEW id — the original is gone).
            recipe = repo.get(recipe_id)
            if recipe is None:
                return
            self._last_deleted = recipe
            repo.delete(recipe_id)
        self.refresh()
        self.deletion_pending_undo.emit(f"Recette « {recipe.name} » supprimée")

    @Slot()
    def undoLastDelete(self) -> None:  # noqa: N802
        """Restore the last deleted recipe (with its lines + tags). The new
        recipe gets a fresh id — any external reference (a calendar entry that
        pointed to the original) is NOT re-linked."""
        if self.ctx is None or self._last_deleted is None:
            return
        recipe = self._last_deleted
        # Strip the original id; create() will assign a new one.
        clean = recipe.model_copy(update={"id": None})
        with self.ctx.session() as s:
            RecipeRepo(s).create(clean)
        self._last_deleted = None
        self.refresh()


# ----- editor viewmodel -----------------------------------------------------


@QmlElement
class RecipeEditorViewModel(QObject):
    """In-memory edit buffer for one recipe. Computes nutrition/cost on demand.

    Three signals to keep QML focused on what really changed:
      - `loaded`         : full reset — only on `loadRecipe()`. View repopulates everything.
      - `lines_changed`  : the set of ingredient lines changed (add / remove). View
                           rebuilds the lines table.
      - `derived_changed`: totals / cost need to be recomputed (every mutation does
                           this). The view ONLY updates the nutrition + cost panels.
    """

    loaded = Signal()
    lines_changed = Signal()
    derived_changed = Signal()
    display_portions_changed = Signal()  # scaling override changed
    photo_changed = Signal()             # image_path mutated (set / removed)
    tags_changed = Signal()              # tag set mutated (add/remove)
    error_emitted = Signal(str)          # photo / tag errors → toast in QML
    # A3 : True iff the in-memory `_recipe` has unsaved changes (meta or lines).
    # Photo and tags auto-persist immediately on toggle, so they don't set
    # this flag. Page listens to it before switching to another recipe and
    # offers a "Save / Discard / Cancel" confirmation dialog.
    unsaved_changed = Signal()

    def __init__(self, ctx: AppContext | None = None, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self._recipe: Recipe = Recipe(name="(nouvelle recette)")
        # Scaling override: None = use default_portions; otherwise the user has
        # set a different display count and we scale all line quantities, total
        # nutrition, and total cost by `display_portions / default_portions`.
        # Per-portion values are unchanged (they're per-portion either way).
        self._display_portions: int | None = None
        # A3 : dirty flag for unsaved-changes detection. Reset on load() and
        # after saveCurrent(). Set by every buffered mutation (meta + lines).
        self._dirty: bool = False

    # -- QML-facing -----------------------------------------------------------

    @Property(str, notify=loaded)
    def recipeName(self) -> str:  # noqa: N802
        return self._recipe.name

    @Property(int, notify=loaded)
    def defaultPortions(self) -> int:  # noqa: N802
        return self._recipe.default_portions

    @Property(str, notify=loaded)
    def instructions(self) -> str:
        return self._recipe.instructions

    @Property(str, notify=photo_changed)
    def photoUrl(self) -> str:  # noqa: N802
        """`file://` URL of the recipe's photo, or empty string if none.
        Notified by `photo_changed` so QML's `Image.source` rebinds."""
        abs_path = absolute_photo_path(self._recipe.image_path)
        return abs_path.as_uri() if abs_path else ""

    @Property(bool, notify=photo_changed)
    def hasPhoto(self) -> bool:  # noqa: N802
        return absolute_photo_path(self._recipe.image_path) is not None

    @Property(int, notify=display_portions_changed)
    def displayPortions(self) -> int:  # noqa: N802
        """Effective portion count shown in the UI. Equal to `default_portions`
        unless the user set a scaling override via `setDisplayPortions`."""
        if self._display_portions is None:
            return self._recipe.default_portions
        return self._display_portions

    @Property(bool, notify=display_portions_changed)
    def isScaled(self) -> bool:  # noqa: N802
        """True iff the user is viewing the recipe at a different portion count
        than the default. UI uses this to show a 'Réinitialiser' button."""
        return (
            self._display_portions is not None
            and self._display_portions != self._recipe.default_portions
        )

    @Property(float, notify=display_portions_changed)
    def scaleRatio(self) -> float:  # noqa: N802
        """`displayPortions / defaultPortions`. Always 1.0 when not scaled."""
        return self._scale_ratio()

    @Property(bool, notify=unsaved_changed)
    def hasUnsavedChanges(self) -> bool:  # noqa: N802
        """A3 : True iff buffered (meta + lines) mutations have not yet been
        persisted via saveCurrent(). The page reads this before switching to
        another recipe and shows a confirmation dialog if needed.

        Photo (`setPhotoFromUrl`/`removePhoto`) and tags (`toggleTag`)
        auto-persist on call — they don't set this flag."""
        return self._dirty

    def _mark_dirty(self) -> None:
        """Set the dirty flag and notify QML. Called by every buffered mutation."""
        if not self._dirty:
            self._dirty = True
            self.unsaved_changed.emit()

    def _mark_clean(self) -> None:
        """Reset the dirty flag and notify. Called on load() and after a
        successful save."""
        if self._dirty:
            self._dirty = False
            self.unsaved_changed.emit()

    @Slot(int)
    def setDisplayPortions(self, portions: int) -> None:  # noqa: N802
        portions = max(1, int(portions))
        if portions == self._recipe.default_portions:
            self._display_portions = None  # back to "use default"
        else:
            self._display_portions = portions
        self.display_portions_changed.emit()
        self.derived_changed.emit()

    @Slot()
    def resetDisplayPortions(self) -> None:  # noqa: N802
        if self._display_portions is None:
            return
        self._display_portions = None
        self.display_portions_changed.emit()
        self.derived_changed.emit()

    @Slot(int)
    def loadById(self, recipe_id: int) -> None:  # noqa: N802
        if self.ctx is None or recipe_id <= 0:
            self.load(None)
            return
        with self.ctx.session() as s:
            r = RecipeRepo(s).get(recipe_id)
        self.load(r)

    @Slot()
    def loadEmpty(self) -> None:  # noqa: N802
        self.load(None)

    @Slot(str, result=bool)
    def setPhotoFromUrl(self, file_url: str) -> bool:  # noqa: N802
        """Set the recipe's photo from a local file URL (`file:///path/to.jpg`).
        Returns True on success. The recipe MUST have an `id` (already saved)
        before calling this — we name the file after the recipe id.

        QML calls this from a FileDialog after the user picks an image.
        """
        if self._recipe.id is None:
            self.error_emitted.emit("Sauvegarde la recette avant d'ajouter une photo.")
            return False
        # Strip the file:// scheme. QUrl's `toLocalFile` would be cleaner but
        # we don't want to import QUrl here just for a string strip.
        local_path = file_url
        if local_path.startswith("file:///"):
            # Windows: file:///C:/path → C:/path. Linux: file:///home/... → /home/...
            local_path = local_path[8:] if (len(local_path) > 9 and local_path[9] == ":") else local_path[7:]
        elif local_path.startswith("file://"):
            local_path = local_path[7:]
        try:
            filename = save_recipe_photo(Path(local_path), self._recipe.id)
        except FileNotFoundError as exc:
            self.error_emitted.emit(f"Fichier introuvable : {exc}")
            return False
        except Exception as exc:  # PIL UnidentifiedImageError, OSError, etc.
            self.error_emitted.emit(f"Format d'image non supporté ou erreur disque : {exc}")
            return False
        # Persist the new image_path
        self._recipe = self._recipe.model_copy(update={"image_path": filename})
        if self.ctx is not None:
            with self.ctx.session() as s:
                RecipeRepo(s).update(self._recipe)
        self.photo_changed.emit()
        return True

    @Slot(str, result=bool)
    def setPhotoFromHttpUrl(self, http_url: str) -> bool:  # noqa: N802
        """Télécharge une image depuis une URL HTTP(S) et l'attache à la
        recette courante. Utilisé par :
          - Le drag-drop d'une URL d'image (depuis un navigateur) sur
            `RecipePhotoBlock`.
          - L'auto-import d'image au commit du wizard URL (qui appelle
            directement `save_recipe_photo_from_http_url` côté service,
            sans passer par ce slot).
        Renvoie True si la photo a été enregistrée."""
        if self._recipe.id is None:
            self.error_emitted.emit("Sauvegarde la recette avant d'ajouter une photo.")
            return False
        url = (http_url or "").strip()
        if not url.lower().startswith(("http://", "https://")):
            self.error_emitted.emit("URL HTTP(S) attendue.")
            return False
        try:
            filename = save_recipe_photo_from_http_url(url, self._recipe.id)
        except Exception as exc:  # noqa: BLE001 — réseau / format / disque
            self.error_emitted.emit(
                f"Impossible de télécharger l'image : {exc}"
            )
            return False
        self._recipe = self._recipe.model_copy(update={"image_path": filename})
        if self.ctx is not None:
            with self.ctx.session() as s:
                RecipeRepo(s).update(self._recipe)
        self.photo_changed.emit()
        return True

    @Slot(result="QVariantList")
    def currentTags(self) -> list[dict[str, Any]]:  # noqa: N802
        """Tags currently attached to the recipe being edited."""
        return [
            {"id": t.id, "name": t.name, "colorHex": t.color_hex}
            for t in self._recipe.tags
        ]

    @Slot(int)
    def toggleTag(self, tag_id: int) -> None:  # noqa: N802
        """Toggle a tag on the current recipe. Persists immediately if the
        recipe has an id, otherwise stays in-memory until save."""
        if any(t.id == tag_id for t in self._recipe.tags):
            new_tags = [t for t in self._recipe.tags if t.id != tag_id]
        else:
            # Hydrate the tag from the catalog so the in-memory recipe stays consistent.
            if self.ctx is None:
                return
            from app.data.repositories import TagRepo
            with self.ctx.session() as s:
                tag = TagRepo(s).get(tag_id)
            if tag is None:
                return
            new_tags = [*self._recipe.tags, tag]
        self._recipe = self._recipe.model_copy(update={"tags": new_tags})
        # Persist immediately if the recipe is saved (avoid losing tag state on
        # navigation away from the editor).
        if self._recipe.id is not None and self.ctx is not None:
            with self.ctx.session() as s:
                RecipeRepo(s).set_tags(self._recipe.id, [t.id for t in new_tags if t.id is not None])
        self.tags_changed.emit()

    @Slot(result=bool)
    def removePhoto(self) -> bool:  # noqa: N802
        """Remove the recipe's photo (delete file + clear `image_path`)."""
        if self._recipe.id is None or not self._recipe.image_path:
            return False
        delete_recipe_photo(self._recipe.image_path)
        self._recipe = self._recipe.model_copy(update={"image_path": None})
        if self.ctx is not None:
            with self.ctx.session() as s:
                RecipeRepo(s).update(self._recipe)
        self.photo_changed.emit()
        return True

    @Slot(str, str, int)
    def updateMeta(self, name: str, instructions: str, default_portions: int) -> None:  # noqa: N802
        self.update_meta(name=name, instructions=instructions, default_portions=default_portions)

    @Slot(int, float, str)
    def addLineById(self, ingredient_id: int, quantity_g: float, notes: str = "") -> None:  # noqa: N802
        ing = self.hydrate_ingredient(self.ctx, ingredient_id) if self.ctx else None
        if ing is None:
            return
        self.add_line(ing, quantity_g, notes or None)

    @Slot(int)
    def removeLineByOrdinal(self, ordinal: int) -> None:  # noqa: N802
        self.remove_line(ordinal)

    @Slot(int, float)
    def updateLineQty(self, ordinal: int, displayed_g: float) -> None:  # noqa: N802
        """Quand le user édite une qty depuis la table, la valeur tapée est en
        unités d'affichage (donc déjà scalée si isScaled=True). On inverse le
        ratio pour stocker la quantité d'origine."""
        ratio = self._scale_ratio()
        original_g = displayed_g / ratio if ratio > 0 else displayed_g
        self.update_line_quantity(ordinal, original_g)

    @Slot(int, str)
    def updateLineNotes(self, ordinal: int, notes: str) -> None:  # noqa: N802
        self.update_line_notes(ordinal, notes)

    @Slot(int, str)
    def updateLineUnit(self, ordinal: int, unit_code: str) -> None:  # noqa: N802
        """Refonte UX (fix bug conversions d'unités) : mémorise le code d'unité
        choisi par l'utilisateur dans le QuantityField. Stocké en DB pour que
        le reload de la recette restitue exactement la même unité."""
        for line in self._recipe.lines:
            if line.ordinal == ordinal:
                line.unit = unit_code or None
                self.lines_changed.emit()
                return

    @Slot(result="QVariantList")
    def linesAsList(self) -> list[dict[str, Any]]:  # noqa: N802
        """Return the recipe lines as QML-friendly dicts, sorted by rayon
        (category_l1) then by ordinal (B5).

        Lines without a category (manual / OFF ingredients) go to the bottom
        in a "Autres" section. The `ordinal` field is preserved as a tiebreaker
        within a category — when the user rearranges manually (none for now —
        sorting is purely auto), the order stays stable across reloads.

        The QML `RecipeLinesTable` reads `categoryL1` to render section headers
        (the page no longer needs a manual drag, see B5 in the plan v2)."""
        ratio = self._scale_ratio()
        dicts = [_line_to_dict_scaled(line, ratio) for line in self._recipe.lines]
        # Sort key : empty category goes last (sorted as `~` which is ASCII 126,
        # higher than any letter). Then alphabetical category, then ordinal.
        dicts.sort(key=lambda d: (
            d.get("categoryL1") or "~~~",  # NULLs last
            d.get("ordinal", 0),
        ))
        return dicts

    @Slot(result="QVariantMap")
    def nutritionTotalAsDict(self) -> dict[str, Any]:  # noqa: N802
        total, _per_portion = self.totals()
        ratio = self._scale_ratio()
        return _nutrition_to_dict(_nutrition_scaled(total, ratio))

    @Slot(result="QVariantMap")
    def nutritionPerPortionAsDict(self) -> dict[str, Any]:  # noqa: N802
        # Per-portion is invariant under scaling — the per-portion intake stays
        # the same whether you cook for 4 or 8 people.
        _total, per_portion = self.totals()
        return _nutrition_to_dict(per_portion)

    @Slot(result="QVariantMap")
    def nutritionPer100gAsDict(self) -> dict[str, Any]:  # noqa: N802
        """Densité nutritionnelle de la recette par 100 g (poids cru — cohérent
        avec la convention CIQUAL des étiquettes nutritionnelles).

        Calcule `total / (poids_cru_g / 100)` pour chaque macro. Invariant
        au scaling : multiplier toutes les quantités par k multiplie aussi le
        total (donc le ratio reste constant). Retourne des zéros pour une
        recette vide ou sans poids (évite la division par zéro)."""
        total, _per_portion = self.totals()
        total_raw_g = sum(line.quantity_g for line in self._recipe.lines)
        if total_raw_g <= 0:
            return _nutrition_to_dict(NutritionTotal())
        factor = 100.0 / total_raw_g
        return _nutrition_to_dict(_nutrition_scaled(total, factor))

    @Slot(result="QVariantMap")
    def costInfoAsDict(self) -> dict[str, Any]:  # noqa: N802
        total_eur, missing_total = self.cost_total()
        per_portion_eur, _missing_pp = self.cost_per_portion()
        ratio = self._scale_ratio()
        scaled_total = (total_eur * Decimal(str(ratio))).quantize(Decimal("0.01"))
        return {
            "total":             str(scaled_total),
            "perPortion":        str(per_portion_eur),
            "missingPriceCount": len(missing_total),
            "lineCount":         len(self._recipe.lines),
            "displayPortions":   self.displayPortions,
            "defaultPortions":   self._recipe.default_portions,
            "isScaled":          self.isScaled,
            "scaleRatio":        ratio,
        }

    @Slot(result="QVariantMap")
    def portionWeightAsDict(self) -> dict[str, Any]:  # noqa: N802
        """Estime le poids cuit total + par portion de la recette.

        Pour chaque ligne :
            - si `ingredient.cooked_weight_per_100g_raw` est défini :
                cooked_g = quantity_g * ratio_cuisson / 100
            - sinon : cooked_g = quantity_g (1:1, hypothèse "ne boit pas d'eau")
        Le scaling courant (isScaled — l'utilisateur a ajusté `displayPortions`)
        s'applique aussi.

        Retour : `{totalCookedG, perPortionCookedG, hasAnyRatio,
        defaultPortions, displayPortions, ratiosDefinedCount, totalLines}`.
        `hasAnyRatio` permet à l'UI de distinguer un calcul "réel" (au moins
        un ingrédient a renseigné son ratio) d'un calcul "1:1 par défaut"
        à griser visuellement.
        """
        scale = self._scale_ratio()
        total_cooked = 0.0
        ratios_defined = 0
        for line in self._recipe.lines:
            qty_raw = line.quantity_g * scale
            ratio = line.ingredient.cooked_weight_per_100g_raw
            if ratio and ratio > 0:
                total_cooked += qty_raw * ratio / 100.0
                ratios_defined += 1
            else:
                total_cooked += qty_raw

        portions = max(1, self.displayPortions)
        per_portion = total_cooked / portions if total_cooked > 0 else 0.0

        return {
            "totalCookedG":        total_cooked,
            "perPortionCookedG":   per_portion,
            "hasAnyRatio":         ratios_defined > 0,
            "ratiosDefinedCount":  ratios_defined,
            "totalLines":          len(self._recipe.lines),
            "defaultPortions":     self._recipe.default_portions,
            "displayPortions":     self.displayPortions,
            "isScaled":            self.isScaled,
        }

    @Slot(result=bool)
    def saveCurrent(self) -> bool:  # noqa: N802
        if self.ctx is None or not self._recipe.name.strip():
            return False
        with self.ctx.session() as s:
            repo = RecipeRepo(s)
            if self._recipe.id is None:
                saved = repo.create(self._recipe)
            else:
                saved = repo.update(self._recipe)
        # Reload the saved recipe (with the new id if it was a create) so subsequent
        # mutations target the persisted row. `load()` resets the dirty flag.
        self.load(saved)
        return True

    # ============================================================ C2 — Cooking log

    @Slot(result="QVariantList")
    def cookingLogAsList(self) -> list[dict[str, Any]]:  # noqa: N802
        """Return the cooking log entries for the current recipe, newest
        first. Each dict has `id`, `cookedAtIso`, `cookedAtHuman`,
        `rating`, `notes`."""
        if self.ctx is None or self._recipe.id is None:
            return []
        with self.ctx.session() as s:
            entries = CookingLogRepo(s).list_for_recipe(self._recipe.id)
        return [_cooking_log_to_dict(e) for e in entries]

    @Slot(result=int)
    def cookedTimesThisMonth(self) -> int:  # noqa: N802
        """Stat shown next to the History tab : "cuisiné 3× ce mois"."""
        if self.ctx is None or self._recipe.id is None:
            return 0
        with self.ctx.session() as s:
            return CookingLogRepo(s).count_in_window(self._recipe.id, days=30)

    @Slot("QVariantMap", result="QVariantMap")
    def addCookingLog(self, payload: dict[str, Any]) -> dict[str, Any]:  # noqa: N802
        """Append a cooking log entry for the current recipe. Payload :
        `cookedAtIso` (str, optional — default = now), `rating` (int 1-5
        or 0 for "no rating"), `notes` (str | "")."""
        if self.ctx is None or self._recipe.id is None:
            return {}
        try:
            cooked_at = _parse_iso_datetime(payload.get("cookedAtIso"))
            rating_raw = payload.get("rating")
            rating = int(rating_raw) if rating_raw not in (None, "", 0) else None
            entry = CookingLogEntry(
                recipe_id=self._recipe.id,
                cooked_at=cooked_at,
                rating=rating,
                notes=(payload.get("notes") or "").strip() or None,
            )
        except Exception as exc:
            self.error_emitted.emit(str(exc))
            return {}
        with self.ctx.session() as s:
            saved = CookingLogRepo(s).add(entry)
            s.commit()
        return _cooking_log_to_dict(saved)

    @Slot(int, result=bool)
    def deleteCookingLog(self, entry_id: int) -> bool:  # noqa: N802
        if self.ctx is None or entry_id <= 0:
            return False
        with self.ctx.session() as s:
            ok = CookingLogRepo(s).delete(entry_id)
            if ok:
                s.commit()
        return ok

    # -- Python-side ----------------------------------------------------------

    @property
    def recipe(self) -> Recipe:
        return self._recipe

    def load(self, recipe: Recipe | None) -> None:
        self._recipe = recipe.model_copy(deep=True) if recipe is not None else Recipe(name="(nouvelle recette)")
        # Drop any in-flight scaling override when a new recipe is loaded.
        self._display_portions = None
        self.display_portions_changed.emit()
        self.photo_changed.emit()  # photoUrl/hasPhoto rebind for the new recipe
        self.tags_changed.emit()    # current tags refresh
        self.loaded.emit()
        self.derived_changed.emit()
        # A3 : a freshly-loaded recipe is by definition not dirty.
        self._mark_clean()

    def update_meta(self, *, name: str, instructions: str, default_portions: int) -> None:
        new_default = max(1, default_portions)
        if new_default != self._recipe.default_portions:
            # Default portions changed → drop the scaling override so the user
            # doesn't end up with a confusing implicit ratio.
            self._display_portions = None
            self.display_portions_changed.emit()
        # Detect actual change to avoid spurious dirty flags when the QML form
        # echoes the same values back (e.g. focus changes pushing identical text).
        changed = (
            name != self._recipe.name
            or instructions != self._recipe.instructions
            or new_default != self._recipe.default_portions
        )
        self._recipe = self._recipe.model_copy(
            update={
                "name": name,
                "instructions": instructions,
                "default_portions": new_default,
            }
        )
        self.derived_changed.emit()
        if changed:
            self._mark_dirty()

    # -- scaling helpers ------------------------------------------------------

    def _scale_ratio(self) -> float:
        if self._display_portions is None or self._recipe.default_portions <= 0:
            return 1.0
        return self._display_portions / self._recipe.default_portions

    def add_line(self, ingredient: Ingredient, quantity_g: float, notes: str | None = None) -> None:
        if quantity_g <= 0:
            return
        new_line = RecipeLine(
            ingredient=ingredient,
            quantity_g=quantity_g,
            notes=notes,
            ordinal=len(self._recipe.lines),
        )
        self._recipe = self._recipe.model_copy(update={"lines": [*self._recipe.lines, new_line]})
        self.lines_changed.emit()
        self.derived_changed.emit()
        self._mark_dirty()

    def remove_line(self, ordinal: int) -> None:
        new_lines = [line for line in self._recipe.lines if line.ordinal != ordinal]
        new_lines = [line.model_copy(update={"ordinal": i}) for i, line in enumerate(new_lines)]
        self._recipe = self._recipe.model_copy(update={"lines": new_lines})
        self.lines_changed.emit()
        self.derived_changed.emit()
        self._mark_dirty()

    def update_line_quantity(self, ordinal: int, quantity_g: float) -> None:
        if quantity_g <= 0:
            return
        new_lines = []
        changed = False
        for line in self._recipe.lines:
            if line.ordinal == ordinal:
                if line.quantity_g != quantity_g:
                    changed = True
                line = line.model_copy(update={"quantity_g": quantity_g})
            new_lines.append(line)
        self._recipe = self._recipe.model_copy(update={"lines": new_lines})
        self.derived_changed.emit()
        if changed:
            self._mark_dirty()

    def update_line_notes(self, ordinal: int, notes: str) -> None:
        """Met à jour la note d'une ligne. N'émet PAS de signal de re-render
        (les notes n'affectent ni la nutrition ni le coût) ; en revanche
        marque la recette comme dirty (A3) pour la confirmation à la sortie."""
        new_notes = notes.strip() or None
        new_lines = []
        changed = False
        for line in self._recipe.lines:
            if line.ordinal == ordinal:
                if line.notes != new_notes:
                    changed = True
                line = line.model_copy(update={"notes": new_notes})
            new_lines.append(line)
        self._recipe = self._recipe.model_copy(update={"lines": new_lines})
        if changed:
            self._mark_dirty()

    # -- derived values -------------------------------------------------------

    def totals(self) -> tuple[NutritionTotal, NutritionTotal]:
        return nutrition.aggregate_recipe(self._recipe)

    def cost_total(self) -> tuple[Decimal, list[RecipeLine]]:
        return pricing.recipe_cost(self._recipe)

    def cost_per_portion(self) -> tuple[Decimal, list[RecipeLine]]:
        return pricing.recipe_cost_per_portion(self._recipe)

    # -- persistence helpers --------------------------------------------------

    def hydrate_ingredient(self, ctx: AppContext, ingredient_id: int) -> Ingredient | None:
        with ctx.session() as s:
            return IngredientRepo(s).get(ingredient_id)
