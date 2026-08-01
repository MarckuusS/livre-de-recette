"""Dialog for importing ingredients from CIQUAL (local catalog) or OpenFoodFacts (online).

Opened from the Ingrédients tab via "Importer un ingrédient". Two tabs (CIQUAL,
OpenFoodFacts) sharing the same skeleton:

  search bar  ───────────────────────────────────────────────
  filter panel (category + sort + numeric ranges + reset)
  result list (HTML cards, double-click = import)
  pagination footer (Précédent / Page X/Y (N résultats) / Suivant)

Each tab is represented by a `_TabUI` data bag that holds its widgets and current
`_TabState`. State (query, filters, sort, page) is preserved across reopens of the
dialog via class-level attributes, so the user doesn't lose their context when
they close/reopen during a session.
"""

from __future__ import annotations

import html as html_lib
import logging
from dataclasses import dataclass, field, replace
from typing import Callable

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QPushButton,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from app.data.repositories import SearchFilters, SearchOptions, SearchPage
from app.domain.models import Ingredient, Source
from app.services import ingredient_search
from app.services.openfoodfacts import OFF_UNSUPPORTED_SORTS, OpenFoodFactsError
from app.ui.app_context import AppContext
from app.ui.widgets.fixed_unit_field import FixedUnitField

log = logging.getLogger(__name__)

_DEBOUNCE_MS = 300
_PAGE_SIZE = 25

# Stored on each item — we use UserRole+1 so we can keep the ingredient id at UserRole.
_INGREDIENT_ROLE = Qt.ItemDataRole.UserRole + 1

# Colour palette
_COLOR_TEXT = "#1f2937"
_COLOR_BADGE = "#6b7280"
_COLOR_KCAL = "#c2410c"
_COLOR_KCAL_BG = "#ffedd5"
_COLOR_PROTEINS = "#1d4ed8"
_COLOR_CARBS = "#15803d"
_COLOR_FATS = "#a16207"
_COLOR_CATEGORY = "#7c3aed"
_COLOR_CATEGORY_BG = "#ede9fe"

_SOURCE_BADGES: dict[str, tuple[str, str, str]] = {
    "ciqual":        ("CIQUAL", "#15803d", "#dcfce7"),
    "openfoodfacts": ("OFF",    "#1d4ed8", "#dbeafe"),
    "manual":        ("perso",  "#c2410c", "#ffedd5"),
}

# Each entry: (display label, sort_by code, descending?)
# `rank` is the FTS5 relevance score — only meaningful when there's a text query.
_SORT_CHOICES: list[tuple[str, str, bool]] = [
    ("Pertinence",     "rank",     False),
    ("Nom A→Z",        "name",     False),
    ("Nom Z→A",        "name",     True),
    ("Énergie ↑",      "kcal",     False),
    ("Énergie ↓",      "kcal",     True),
    ("Protéines ↑",    "proteins", False),
    ("Protéines ↓",    "proteins", True),
    ("Glucides ↑",     "carbs",    False),
    ("Glucides ↓",     "carbs",    True),
    ("Lipides ↑",      "fats",     False),
    ("Lipides ↓",      "fats",     True),
]


def _render_ingredient_html(ing: Ingredient, *, in_library: bool) -> str:
    """Two-line HTML card. Top: star + name + source badge + category pill.
    Bottom: kcal pill + macro chips."""
    star = "🌟 " if in_library else ""
    badge_label, badge_fg, badge_bg = _SOURCE_BADGES.get(
        ing.source.value, (ing.source.value, _COLOR_BADGE, "#f3f4f6")
    )
    name = html_lib.escape(ing.name)
    badge_html = (
        f'<span style="background:{badge_bg}; color:{badge_fg}; '
        f'padding:1px 7px; border-radius:8px; font-size:9pt; font-weight:600;">{badge_label}</span>'
    )
    category_html = ""
    if ing.category_l1:
        category_html = (
            f'<span style="background:{_COLOR_CATEGORY_BG}; color:{_COLOR_CATEGORY}; '
            f'padding:1px 7px; border-radius:8px; font-size:9pt;">'
            f"{html_lib.escape(ing.category_l1)}</span>"
        )

    macros: list[str] = []
    if ing.kcal_per_100g is not None:
        macros.append(
            f'<span style="background:{_COLOR_KCAL_BG}; color:{_COLOR_KCAL}; '
            f'padding:1px 7px; border-radius:8px; font-weight:600;">'
            f"{ing.kcal_per_100g:.0f} kcal/100g</span>"
        )
    if ing.proteins_g is not None:
        macros.append(f'<span style="color:{_COLOR_PROTEINS}; font-weight:600;">P&nbsp;{ing.proteins_g:.1f}g</span>')
    if ing.fats_g is not None:
        macros.append(f'<span style="color:{_COLOR_FATS}; font-weight:600;">L&nbsp;{ing.fats_g:.1f}g</span>')
    if ing.carbs_g is not None:
        macros.append(f'<span style="color:{_COLOR_CARBS}; font-weight:600;">G&nbsp;{ing.carbs_g:.1f}g</span>')
    sep = '<span style="color:%s;">&nbsp;·&nbsp;</span>' % _COLOR_BADGE
    macros_html = sep.join(macros) or '<span style="color:#9ca3af; font-style:italic;">macros non renseignées</span>'

    return (
        f'<div style="padding:1px 0; color:{_COLOR_TEXT};">'
        f"  <div>{star}<b>{name}</b>"
        f"    &nbsp;{badge_html}"
        f"    {('&nbsp;' + category_html) if category_html else ''}"
        f"  </div>"
        f'  <div style="margin-top:2px; font-size:9pt;">{macros_html}</div>'
        f"</div>"
    )


# --------------------------------------------------------------------------- #
# Filter panel — composed once per tab; emits `changed` on any modification.
# --------------------------------------------------------------------------- #


class _FilterPanel(QFrame):
    changed = Signal()

    def __init__(self, parent: QWidget, *, categories: list[str]) -> None:
        super().__init__(parent)
        self.setFrameShape(QFrame.Shape.StyledPanel)

        self.category_combo = QComboBox(self)
        self.category_combo.addItem("Toutes les catégories", "")
        for c in categories:
            self.category_combo.addItem(c, c)

        self.sort_combo = QComboBox(self)
        for label, code, desc in _SORT_CHOICES:
            self.sort_combo.addItem(label, (code, desc))

        # Each filter row uses two FixedUnitField widgets (the unit cell visually
        # separated from the value, and an empty display when the value is 0 —
        # so the panel doesn't look pre-filled with "—" on first open).
        self.min_kcal, self.max_kcal = self._range_pair(max_v=2000.0, unit="kcal/100g")
        self.min_proteins, self.max_proteins = self._range_pair(max_v=100.0, unit="g/100g")
        self.min_carbs, self.max_carbs = self._range_pair(max_v=100.0, unit="g/100g")
        self.min_fats, self.max_fats = self._range_pair(max_v=100.0, unit="g/100g")

        reset_btn = QPushButton("Réinitialiser", self)
        reset_btn.clicked.connect(self._reset)

        # Grid layout: row 0 has category + sort, rows 1-4 have min/max spin pairs.
        grid = QGridLayout(self)
        grid.setContentsMargins(8, 8, 8, 8)
        grid.setHorizontalSpacing(8)
        grid.setVerticalSpacing(6)

        grid.addWidget(QLabel("Catégorie :"), 0, 0)
        grid.addWidget(self.category_combo, 0, 1, 1, 3)
        grid.addWidget(QLabel("Trier par :"), 0, 4)
        grid.addWidget(self.sort_combo, 0, 5, 1, 2)

        for row, (label, mn, mx) in enumerate(
            [
                ("Énergie :",   self.min_kcal,     self.max_kcal),
                ("Protéines :", self.min_proteins, self.max_proteins),
                ("Glucides :",  self.min_carbs,    self.max_carbs),
                ("Lipides :",   self.min_fats,     self.max_fats),
            ],
            start=1,
        ):
            grid.addWidget(QLabel(label), row, 0)
            grid.addWidget(mn, row, 1)
            grid.addWidget(QLabel("à"), row, 2)
            grid.addWidget(mx, row, 3)
        grid.addWidget(reset_btn, 4, 5, 1, 2)

        # Wire up signals. Numeric spins debounce; combos fire immediately.
        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self.changed.emit)
        for spin in (
            self.min_kcal, self.max_kcal,
            self.min_proteins, self.max_proteins,
            self.min_carbs, self.max_carbs,
            self.min_fats, self.max_fats,
        ):
            spin.valueChanged.connect(self._schedule)
        # `currentIndexChanged` emits an int; `changed` is signal-without-args.
        # Wrap in a lambda so Qt doesn't TypeError on argument arity mismatch.
        self.category_combo.currentIndexChanged.connect(lambda _i: self.changed.emit())
        self.sort_combo.currentIndexChanged.connect(lambda _i: self.changed.emit())

    def _range_pair(self, *, max_v: float, unit: str) -> tuple[FixedUnitField, FixedUnitField]:
        return (
            FixedUnitField(self, unit_text=unit, max_v=max_v, decimals=1),
            FixedUnitField(self, unit_text=unit, max_v=max_v, decimals=1),
        )

    def _schedule(self, *_: object) -> None:
        self._timer.start(_DEBOUNCE_MS)

    def _reset(self) -> None:
        # Block signals during reset so we emit `changed` only once at the end.
        self.blockSignals(True)
        try:
            for field in (
                self.min_kcal, self.max_kcal,
                self.min_proteins, self.max_proteins,
                self.min_carbs, self.max_carbs,
                self.min_fats, self.max_fats,
            ):
                field.clear()
            self.category_combo.setCurrentIndex(0)
            self.sort_combo.setCurrentIndex(0)
        finally:
            self.blockSignals(False)
        self.changed.emit()

    # -- public API ----------------------------------------------------------
    def to_filters(self) -> SearchFilters:
        def or_none(v: float) -> float | None:
            return v if v > 0 else None
        return SearchFilters(
            min_kcal=or_none(self.min_kcal.value()),
            max_kcal=or_none(self.max_kcal.value()),
            min_proteins=or_none(self.min_proteins.value()),
            max_proteins=or_none(self.max_proteins.value()),
            min_carbs=or_none(self.min_carbs.value()),
            max_carbs=or_none(self.max_carbs.value()),
            min_fats=or_none(self.min_fats.value()),
            max_fats=or_none(self.max_fats.value()),
            category_l1=self.category_combo.currentData() or None,
        )

    def sort_settings(self) -> tuple[str, bool]:
        data = self.sort_combo.currentData()
        return data if data else ("rank", False)

    def apply_state(self, state: _TabState, categories: list[str]) -> None:
        """Restore the panel's controls from a saved state (no signal emission)."""
        self.blockSignals(True)
        try:
            self.min_kcal.setValue(state.filters.min_kcal or 0.0)
            self.max_kcal.setValue(state.filters.max_kcal or 0.0)
            self.min_proteins.setValue(state.filters.min_proteins or 0.0)
            self.max_proteins.setValue(state.filters.max_proteins or 0.0)
            self.min_carbs.setValue(state.filters.min_carbs or 0.0)
            self.max_carbs.setValue(state.filters.max_carbs or 0.0)
            self.min_fats.setValue(state.filters.min_fats or 0.0)
            self.max_fats.setValue(state.filters.max_fats or 0.0)

            cat = state.filters.category_l1 or ""
            for i in range(self.category_combo.count()):
                if self.category_combo.itemData(i) == cat:
                    self.category_combo.setCurrentIndex(i)
                    break

            for i, (_label, code, desc) in enumerate(_SORT_CHOICES):
                if code == state.sort_by and desc == state.sort_desc:
                    self.sort_combo.setCurrentIndex(i)
                    break
        finally:
            self.blockSignals(False)


# --------------------------------------------------------------------------- #
# Pagination footer
# --------------------------------------------------------------------------- #


class _PaginationFooter(QWidget):
    prev_clicked = Signal()
    next_clicked = Signal()

    def __init__(self, parent: QWidget) -> None:
        super().__init__(parent)
        self.prev_btn = QPushButton("← Précédent", self)
        self.next_btn = QPushButton("Suivant →", self)
        self.label = QLabel("—", self)
        self.label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.label.setStyleSheet("color: #4b5563;")

        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.prev_btn)
        layout.addWidget(self.label, 1)
        layout.addWidget(self.next_btn)

        self.prev_btn.clicked.connect(self.prev_clicked.emit)
        self.next_btn.clicked.connect(self.next_clicked.emit)
        self.update_state(page=1, page_count=1, total=0)

    def update_state(self, *, page: int, page_count: int, total: int) -> None:
        if total == 0:
            self.label.setText("—")
        else:
            self.label.setText(f"Page {page} / {page_count}  ·  {total} résultat(s)")
        self.prev_btn.setEnabled(page > 1)
        self.next_btn.setEnabled(page < page_count)


def _sort_results_by_macro(items: list[Ingredient], sort_code: str) -> list[Ingredient]:
    """Re-order a list of ingredients by a macro field client-side.

    Used for OFF results when the API doesn't accept the requested sort. We can
    only sort the page we just fetched (we don't have all 10 000 hits in memory),
    but for the user it's much better than nothing — the page they SEE is now
    actually ordered by what they asked for. The status bar makes the limitation
    explicit.

    Items with a `None` value for the sort field are pushed to the end regardless
    of direction — sorting by proteins shouldn't surface entries with unknown
    proteins at the top.
    """
    base = sort_code.rsplit("_", 1)[0]  # 'proteins_desc' -> 'proteins'
    desc = sort_code.endswith("_desc")
    field_map = {
        "kcal":     lambda i: i.kcal_per_100g,
        "proteins": lambda i: i.proteins_g,
        "carbs":    lambda i: i.carbs_g,
        "fats":     lambda i: i.fats_g,
    }
    key_fn = field_map.get(base)
    if key_fn is None:
        return items

    def sort_key(ing: Ingredient) -> tuple[int, float]:
        v = key_fn(ing)
        if v is None:
            return (1, 0.0)  # NULLs last
        return (0, -v if desc else v)

    return sorted(items, key=sort_key)


# --------------------------------------------------------------------------- #
# Per-tab state — persisted across reopens of the dialog (class-level on the
# ImportIngredientDialog).
# --------------------------------------------------------------------------- #


@dataclass
class _TabState:
    query: str = ""
    filters: SearchFilters = field(default_factory=SearchFilters)
    sort_by: str = "rank"
    sort_desc: bool = False
    page: int = 1


# --------------------------------------------------------------------------- #
# Main dialog
# --------------------------------------------------------------------------- #


class ImportIngredientDialog(QDialog):
    library_changed = Signal()

    # Class-level — persists across reopens during the same app session.
    _ciqual_state: _TabState = _TabState()
    _off_state: _TabState = _TabState()

    def __init__(self, ctx: AppContext, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self.setWindowTitle("Importer un ingrédient")
        self.resize(900, 700)
        self._something_imported = False

        # Build both tabs. Order matters: build the widgets first, then load state.
        self._build_ciqual_tab()
        self._build_off_tab()

        tabs = QTabWidget(self)
        tabs.addTab(self._ciqual_page, "📘 CIQUAL")
        tabs.addTab(self._off_page, "🌐 OpenFoodFacts")

        close_button = QDialogButtonBox(QDialogButtonBox.StandardButton.Close, self)
        close_button.rejected.connect(self.accept)
        close_button.accepted.connect(self.accept)

        layout = QVBoxLayout(self)
        layout.addWidget(tabs)
        layout.addWidget(close_button)

        # Restore previous state and run an initial search to populate the lists.
        self._ciqual_filter_panel.apply_state(self._ciqual_state, self._ciqual_categories)
        self._ciqual_search.setText(self._ciqual_state.query)
        self._off_filter_panel.apply_state(self._off_state, [])
        self._off_search.setText(self._off_state.query)
        self._run_ciqual_search()

    # ------------------------------------------------------------------ CIQUAL tab
    def _build_ciqual_tab(self) -> None:
        page = QWidget(self)

        self._ciqual_search = QLineEdit(page)
        self._ciqual_search.setPlaceholderText(
            "Rechercher dans CIQUAL (laisse vide pour parcourir une catégorie)..."
        )
        self._ciqual_search.setClearButtonEnabled(True)

        self._ciqual_search_timer = QTimer(self)
        self._ciqual_search_timer.setSingleShot(True)
        self._ciqual_search_timer.timeout.connect(self._on_ciqual_query_committed)
        self._ciqual_search.textChanged.connect(
            lambda _: self._ciqual_search_timer.start(_DEBOUNCE_MS)
        )

        # Load CIQUAL categories once for the dropdown.
        with self.ctx.session() as s:
            self._ciqual_categories = ingredient_search.list_local_categories(s, source=Source.CIQUAL)
        self._ciqual_filter_panel = _FilterPanel(page, categories=self._ciqual_categories)
        self._ciqual_filter_panel.changed.connect(self._on_ciqual_filters_changed)

        self._ciqual_status = QLabel("", page)
        self._ciqual_status.setStyleSheet("color: #6b7280;")

        self._ciqual_list = QListWidget(page)
        self._ciqual_list.itemActivated.connect(self._import_ciqual_item)
        self._ciqual_list.itemDoubleClicked.connect(self._import_ciqual_item)

        self._ciqual_pagination = _PaginationFooter(page)
        self._ciqual_pagination.prev_clicked.connect(lambda: self._change_page("ciqual", -1))
        self._ciqual_pagination.next_clicked.connect(lambda: self._change_page("ciqual", +1))

        layout = QVBoxLayout(page)
        layout.addWidget(self._ciqual_search)
        layout.addWidget(self._ciqual_filter_panel)
        layout.addWidget(self._ciqual_status)
        layout.addWidget(self._ciqual_list, 1)
        layout.addWidget(self._ciqual_pagination)
        self._ciqual_page = page

    def _on_ciqual_query_committed(self) -> None:
        self._ciqual_state.query = self._ciqual_search.text()
        self._ciqual_state.page = 1
        self._run_ciqual_search()

    def _on_ciqual_filters_changed(self) -> None:
        self._ciqual_state.filters = self._ciqual_filter_panel.to_filters()
        self._ciqual_state.sort_by, self._ciqual_state.sort_desc = self._ciqual_filter_panel.sort_settings()
        self._ciqual_state.page = 1
        self._run_ciqual_search()

    def _run_ciqual_search(self) -> None:
        opts = SearchOptions(
            query=self._ciqual_state.query,
            scope="all",
            source=Source.CIQUAL,
            filters=self._ciqual_state.filters,
            sort_by=self._ciqual_state.sort_by,
            sort_desc=self._ciqual_state.sort_desc,
            page=self._ciqual_state.page,
            page_size=_PAGE_SIZE,
        )
        with self.ctx.session() as s:
            page = ingredient_search.search_local_page(s, opts)
        self._render_results(self._ciqual_list, self._ciqual_status,
                             self._ciqual_pagination, page,
                             empty_label="Aucun ingrédient ne correspond aux filtres.")

    def _import_ciqual_item(self, item: QListWidgetItem) -> None:
        self._do_import(item, target_list=self._ciqual_list)

    # ------------------------------------------------------------------ OFF tab
    def _build_off_tab(self) -> None:
        page = QWidget(self)

        self._off_search = QLineEdit(page)
        self._off_search.setPlaceholderText(
            "Rechercher sur OpenFoodFacts (nom de produit ou code-barres EAN)..."
        )
        self._off_search.setClearButtonEnabled(True)
        self._off_search.returnPressed.connect(self._on_off_query_committed)

        search_btn = QPushButton("Rechercher", page)
        search_btn.clicked.connect(self._on_off_query_committed)

        top = QHBoxLayout()
        top.addWidget(self._off_search, 1)
        top.addWidget(search_btn)

        # OFF doesn't expose a simple categories list via Search-a-licious without
        # facets; leaving the dropdown empty for now (still shows "Toutes").
        self._off_filter_panel = _FilterPanel(page, categories=[])
        self._off_filter_panel.changed.connect(self._on_off_filters_changed)

        self._off_status = QLabel(
            "Saisis un nom ou un code-barres puis appuie sur Entrée.", page
        )
        self._off_status.setStyleSheet("color: #6b7280;")

        self._off_list = QListWidget(page)
        self._off_list.itemActivated.connect(self._import_off_item)
        self._off_list.itemDoubleClicked.connect(self._import_off_item)

        self._off_pagination = _PaginationFooter(page)
        self._off_pagination.prev_clicked.connect(lambda: self._change_page("off", -1))
        self._off_pagination.next_clicked.connect(lambda: self._change_page("off", +1))

        layout = QVBoxLayout(page)
        layout.addLayout(top)
        layout.addWidget(self._off_filter_panel)
        layout.addWidget(self._off_status)
        layout.addWidget(self._off_list, 1)
        layout.addWidget(self._off_pagination)
        self._off_page = page

    def _on_off_query_committed(self) -> None:
        self._off_state.query = self._off_search.text()
        self._off_state.page = 1
        self._run_off_search()

    def _on_off_filters_changed(self) -> None:
        self._off_state.filters = self._off_filter_panel.to_filters()
        self._off_state.sort_by, self._off_state.sort_desc = self._off_filter_panel.sort_settings()
        self._off_state.page = 1
        # Don't auto-run for OFF unless the user already has a query — empty query
        # + only filters would page through OFF's entire dataset.
        if self._off_state.query.strip() or self._has_any_filter(self._off_state.filters):
            self._run_off_search()

    @staticmethod
    def _has_any_filter(f: SearchFilters) -> bool:
        return any(
            v is not None
            for v in (f.min_kcal, f.max_kcal, f.min_proteins, f.max_proteins,
                     f.min_carbs, f.max_carbs, f.min_fats, f.max_fats, f.category_l1)
        )

    def _run_off_search(self) -> None:
        sort_code = self._off_sort_param()
        # OFF's API only supports product_name + popularity-style sorts. Any macro
        # sort (kcal/proteins/carbs/fats) is applied client-side on the page we
        # just received — the status bar tells the user this is page-local.
        client_sort_code = sort_code if sort_code in OFF_UNSUPPORTED_SORTS else None
        sort_hint = (
            " (tri par macro appliqué localement sur cette page — OpenFoodFacts "
            "ne supporte pas ce tri côté serveur)"
            if client_sort_code else ""
        )
        self._off_status.setText(f"Recherche en cours pour « {self._off_state.query} »...{sort_hint}")
        self._off_list.clear()
        try:
            with self.ctx.session() as s:
                results, total = ingredient_search.fetch_from_openfoodfacts_and_cache(
                    s,
                    self._off_state.query,
                    add_to_personal_library=False,
                    page=self._off_state.page,
                    page_size=_PAGE_SIZE,
                    sort_by=sort_code,
                    filters=self._off_state.filters,
                )
        except OpenFoodFactsError as exc:
            self._off_status.setText(str(exc))
            self._off_pagination.update_state(page=1, page_count=1, total=0)
            return

        # Client-side reorder for macro sorts the API can't do for us.
        if client_sort_code:
            results = _sort_results_by_macro(results, client_sort_code)

        page_obj = SearchPage(
            matches=results,
            total_count=total,
            page=self._off_state.page,
            page_size=_PAGE_SIZE,
        )
        empty_msg = "Aucun produit OpenFoodFacts ne correspond." + sort_hint
        self._render_results(self._off_list, self._off_status,
                             self._off_pagination, page_obj,
                             empty_label=empty_msg)
        # Re-emit the hint on success too (the status got overwritten by total count).
        if sort_hint and total > 0:
            self._off_status.setText(self._off_status.text() + sort_hint)

    def _off_sort_param(self) -> str | None:
        """Map (sort_by, sort_desc) to the OFF Search-a-licious sort code."""
        sb, desc = self._off_state.sort_by, self._off_state.sort_desc
        if sb == "rank":
            return None
        suffix = "_desc" if desc else "_asc"
        return f"{sb}{suffix}"

    def _import_off_item(self, item: QListWidgetItem) -> None:
        self._do_import(item, target_list=self._off_list)

    # ------------------------------------------------------------------ shared helpers
    def _render_results(
        self,
        list_widget: QListWidget,
        status_label: QLabel,
        pagination: _PaginationFooter,
        page: SearchPage,
        *,
        empty_label: str,
    ) -> None:
        list_widget.clear()
        if page.total_count == 0:
            status_label.setText(empty_label)
            pagination.update_state(page=1, page_count=1, total=0)
            return
        status_label.setText(f"{page.total_count} résultat(s) — double-clic pour importer.")
        for ing in page.matches:
            self._add_result_item(list_widget, ing)
        pagination.update_state(page=page.page, page_count=page.page_count, total=page.total_count)

    def _change_page(self, which: str, delta: int) -> None:
        if which == "ciqual":
            self._ciqual_state.page = max(1, self._ciqual_state.page + delta)
            self._run_ciqual_search()
        else:
            self._off_state.page = max(1, self._off_state.page + delta)
            self._run_off_search()

    def _do_import(self, item: QListWidgetItem, *, target_list: QListWidget) -> None:
        ingredient_id = item.data(Qt.ItemDataRole.UserRole)
        if ingredient_id is None:
            return
        with self.ctx.session() as s:
            ingredient_search.promote_to_personal_library(s, int(ingredient_id))
        self._something_imported = True
        self.library_changed.emit()
        # Re-render this item with the star.
        self._render_into(target_list, item, in_library=True)

    def _add_result_item(self, target_list: QListWidget, ing: Ingredient) -> None:
        item = QListWidgetItem(target_list)
        assert ing.id is not None
        item.setData(Qt.ItemDataRole.UserRole, ing.id)
        item.setData(_INGREDIENT_ROLE, ing)
        self._render_into(target_list, item, in_library=ing.in_personal_library)

    @staticmethod
    def _render_into(
        target_list: QListWidget,
        item: QListWidgetItem,
        *,
        in_library: bool,
    ) -> None:
        ing: Ingredient = item.data(_INGREDIENT_ROLE)
        label = QLabel(_render_ingredient_html(ing, in_library=in_library))
        label.setTextFormat(Qt.TextFormat.RichText)
        label.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        label.setMargin(6)
        target_list.setItemWidget(item, label)
        item.setSizeHint(label.sizeHint())
