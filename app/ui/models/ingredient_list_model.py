"""QAbstractListModel for the ingredients library.

Roles cover what every QML consumer needs: the personal-library ListView (left
panel of the Ingredients page), the Recipes editor picker, the Calendar add
dialog, and the Import dialog (which also needs `inLibrary` and the categories
to render its star + filter dropdown).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from PySide6.QtCore import QAbstractListModel, QByteArray, QModelIndex, Property, Qt

from app.domain.models import Ingredient


class IngredientListModel(QAbstractListModel):
    # Role enum — keep numbers stable across releases (QML may reference them by name only,
    # but Python tests do `data(idx, IngredientListModel.NameRole)`).
    IdRole              = Qt.ItemDataRole.UserRole + 1
    NameRole            = Qt.ItemDataRole.UserRole + 2
    SourceRole          = Qt.ItemDataRole.UserRole + 3
    SourceRefRole       = Qt.ItemDataRole.UserRole + 4
    KcalRole            = Qt.ItemDataRole.UserRole + 5
    ProteinsRole        = Qt.ItemDataRole.UserRole + 6
    CarbsRole           = Qt.ItemDataRole.UserRole + 7
    FatsRole            = Qt.ItemDataRole.UserRole + 8
    PriceEurRole        = Qt.ItemDataRole.UserRole + 9   # str (Decimal serialised)
    PriceQuantityGRole  = Qt.ItemDataRole.UserRole + 10
    PieceWeightGRole    = Qt.ItemDataRole.UserRole + 11
    InLibraryRole       = Qt.ItemDataRole.UserRole + 12
    CategoryL1Role      = Qt.ItemDataRole.UserRole + 13
    CategoryL2Role      = Qt.ItemDataRole.UserRole + 14
    InSeasonNowRole     = Qt.ItemDataRole.UserRole + 15  # C3 — bool
    BrandRole           = Qt.ItemDataRole.UserRole + 16
    # Rôles dérivés pour le groupement de la ListView (refonte UX filtres) :
    # `groupKey` est calculé en fonction du `groupBy` courant exposé par la
    # property dédiée du model. Les autres sont des labels constants par row.
    SourceLabelRole     = Qt.ItemDataRole.UserRole + 17  # "CIQUAL" / "OFF" / "Manuel"
    SeasonStatusRole    = Qt.ItemDataRole.UserRole + 18  # "🌱 De saison" / "Hors saison" / "—"
    KcalRangeRole       = Qt.ItemDataRole.UserRole + 19  # "0–100" / "100–300" / "300+"
    RayonRole           = Qt.ItemDataRole.UserRole + 20  # category_l1 ou "Sans rayon"
    GroupKeyRole        = Qt.ItemDataRole.UserRole + 21  # dynamique selon `groupBy`

    _ROLE_NAMES: dict[int, QByteArray] = {
        IdRole:             QByteArray(b"ingredientId"),
        NameRole:           QByteArray(b"name"),
        SourceRole:         QByteArray(b"source"),
        SourceRefRole:      QByteArray(b"sourceRef"),
        KcalRole:           QByteArray(b"kcal"),
        ProteinsRole:       QByteArray(b"proteins"),
        CarbsRole:          QByteArray(b"carbs"),
        FatsRole:           QByteArray(b"fats"),
        PriceEurRole:       QByteArray(b"priceEur"),
        PriceQuantityGRole: QByteArray(b"priceQuantityG"),
        PieceWeightGRole:   QByteArray(b"pieceWeightG"),
        InLibraryRole:      QByteArray(b"inLibrary"),
        CategoryL1Role:     QByteArray(b"categoryL1"),
        CategoryL2Role:     QByteArray(b"categoryL2"),
        InSeasonNowRole:    QByteArray(b"inSeasonNow"),
        BrandRole:          QByteArray(b"brand"),
        SourceLabelRole:    QByteArray(b"sourceLabel"),
        SeasonStatusRole:   QByteArray(b"seasonStatus"),
        KcalRangeRole:      QByteArray(b"kcalRange"),
        RayonRole:          QByteArray(b"rayon"),
        GroupKeyRole:       QByteArray(b"groupKey"),
    }

    def __init__(self, parent: Any = None) -> None:
        super().__init__(parent)
        self._items: list[Ingredient] = []
        # Refonte UX filtres : le groupKey de chaque row dépend de l'option
        # de groupement choisie ("source" / "rayon" / "season" / "kcal_range"
        # / "none"). Le VM appelle `set_group_by` quand le user change le
        # ComboBox — on émet un dataChanged sur le rôle GroupKey pour que la
        # ListView relève les sections.
        self._group_by: str = "none"

    def set_group_by(self, group: str) -> None:
        """Change la stratégie de groupement (string). Émet `dataChanged`
        sur le rôle GroupKey pour que la ListView re-sectionne sans reset."""
        if group == self._group_by:
            return
        self._group_by = group
        if self._items:
            top = self.index(0, 0)
            bottom = self.index(len(self._items) - 1, 0)
            self.dataChanged.emit(top, bottom, [self.GroupKeyRole])

    # -- Python-side API (used by viewmodels to push data) ----------------------

    def set_items(self, items: list[Ingredient]) -> None:
        """Full reset. Use when the entire list changes (filter, refresh)."""
        self.beginResetModel()
        self._items = list(items)
        self.endResetModel()

    def update_one(self, ing: Ingredient) -> bool:
        """In-place update of one row by `ing.id`. Émet `dataChanged` sur cette
        row uniquement — pas de reset model, pas de scintillement de la
        ListView. Retourne True si la row a été trouvée et mise à jour,
        False sinon (l'appelant fera alors un `set_items` full reset).

        Utilisé pour les save d'ingrédients existants : pas besoin de
        recharger toute la liste depuis la DB, l'update local suffit (les
        données viennent du même `IngredientRepo` qu'on viendrait de
        sauvegarder, donc cohérentes avec la DB).
        """
        if ing.id is None:
            return False
        for i, existing in enumerate(self._items):
            if existing.id == ing.id:
                self._items[i] = ing
                idx = self.index(i, 0)
                self.dataChanged.emit(idx, idx)
                return True
        return False

    def items(self) -> list[Ingredient]:
        return list(self._items)

    def item_at(self, row: int) -> Ingredient | None:
        if 0 <= row < len(self._items):
            return self._items[row]
        return None

    # -- QAbstractListModel overrides -------------------------------------------

    def rowCount(self, parent: QModelIndex | None = None) -> int:  # noqa: N802
        if parent is None:
            parent = QModelIndex()
        if parent.isValid():
            return 0
        return len(self._items)

    def data(self, index: QModelIndex, role: int = Qt.ItemDataRole.DisplayRole) -> Any:  # noqa: N802
        if not index.isValid() or not (0 <= index.row() < len(self._items)):
            return None
        ing = self._items[index.row()]
        # GroupKeyRole : dynamique selon `_group_by`
        if role == self.GroupKeyRole:
            return _compute_group_key(ing, self._group_by)
        getter = _ROLE_GETTERS.get(role)
        if getter is not None:
            return getter(ing)
        if role == Qt.ItemDataRole.DisplayRole:
            # Fallback so `model.data(index)` without a role still returns something useful.
            return ing.name
        return None

    def roleNames(self) -> dict[int, QByteArray]:  # noqa: N802
        return self._ROLE_NAMES

    @Property("QVariantMap", constant=True)
    def Roles(self) -> dict[str, int]:  # noqa: N802 (QML convention)
        """Map of role names to integer role IDs, exposed to QML so that
        `data(idx, items.Roles.name)` replaces magic numbers like `258`.

        Constant property — the inner role IDs never change at runtime, so QML
        binds once and caches."""
        return {bytes(name).decode(): role_id for role_id, name in self._ROLE_NAMES.items()}


# Dispatch dict — built once after the class definition (so we can reference
# the role constants). Each getter takes an Ingredient and returns the value
# for that role. Decimal → str so QML formats client-side via toLocaleString.
def _is_in_season_now(ing: Ingredient) -> bool:
    """C3 : True iff `ing.season_months` (CSV) contains the current month."""
    if not ing.season_months:
        return False
    from datetime import datetime
    current = datetime.now().month
    for part in ing.season_months.split(","):
        try:
            if int(part.strip()) == current:
                return True
        except ValueError:
            continue
    return False


_SOURCE_LABELS = {
    "ciqual":        "CIQUAL",
    "openfoodfacts": "OFF",
    "manual":        "Manuel",
    "lidl":          "Lidl",
}


def _kcal_range(ing: Ingredient) -> str:
    """Tranche calorique en libellé pour le groupement.
    Inconnue → "Sans valeur kcal"."""
    k = ing.kcal_per_100g
    if k is None:
        return "Sans valeur kcal"
    if k < 100:    return "0–100 kcal/100g"
    if k < 300:    return "100–300 kcal/100g"
    if k < 500:    return "300–500 kcal/100g"
    return "500+ kcal/100g"


def _season_status(ing: Ingredient) -> str:
    if not ing.season_months:
        return "—"
    return "🌱 De saison" if _is_in_season_now(ing) else "Hors saison"


def _compute_group_key(ing: Ingredient, group_by: str) -> str:
    """Clé de groupement dynamique pour la `section.property` de la ListView."""
    if group_by == "source":
        return _SOURCE_LABELS.get(ing.source.value, ing.source.value)
    if group_by == "rayon":
        return ing.category_l1 or "Sans rayon"
    if group_by == "season":
        return _season_status(ing)
    if group_by == "kcal_range":
        return _kcal_range(ing)
    return ""   # "none" → toutes les rows ont la même clé → pas de section


_ROLE_GETTERS: dict[int, Callable[[Ingredient], Any]] = {
    IngredientListModel.IdRole:             lambda i: i.id,
    IngredientListModel.NameRole:           lambda i: i.name,
    IngredientListModel.SourceRole:         lambda i: i.source.value,
    IngredientListModel.SourceRefRole:      lambda i: i.source_ref,
    IngredientListModel.KcalRole:           lambda i: i.kcal_per_100g,
    IngredientListModel.ProteinsRole:       lambda i: i.proteins_g,
    IngredientListModel.CarbsRole:          lambda i: i.carbs_g,
    IngredientListModel.FatsRole:           lambda i: i.fats_g,
    IngredientListModel.PriceEurRole:       lambda i: str(i.price_eur) if i.price_eur is not None else None,
    IngredientListModel.PriceQuantityGRole: lambda i: i.price_quantity_g,
    IngredientListModel.PieceWeightGRole:   lambda i: i.piece_weight_g,
    IngredientListModel.InLibraryRole:      lambda i: i.in_personal_library,
    IngredientListModel.CategoryL1Role:     lambda i: i.category_l1,
    IngredientListModel.CategoryL2Role:     lambda i: i.category_l2,
    IngredientListModel.InSeasonNowRole:    _is_in_season_now,
    IngredientListModel.BrandRole:          lambda i: i.brand or "",
    IngredientListModel.SourceLabelRole:    lambda i: _SOURCE_LABELS.get(i.source.value, i.source.value),
    IngredientListModel.SeasonStatusRole:   _season_status,
    IngredientListModel.KcalRangeRole:      _kcal_range,
    IngredientListModel.RayonRole:          lambda i: i.category_l1 or "Sans rayon",
    # GroupKeyRole : géré dans `data()` directement (dynamique selon group_by)
}
