"""Pivot widget: a QLineEdit with a dynamic-suggestion dropdown of ingredients.

Used by the Recipes editor and the Calendar slot popup to "pick from the library".
The Ingredients tab itself uses its own simpler filter — the search field there is
a list filter, not a picker.

Scope:
- 'personal' (DEFAULT for Recipes/Calendar) — only suggests entries from the user's
  personal library. CIQUAL/OFF source rows are NOT surfaced; the user is composing
  recipes from a curated set, not browsing external catalogs. The OpenFoodFacts
  fallback button is hidden in this mode.
- 'all' — searches CIQUAL + OFF cache + personal. Used when the picker doubles as
  an import workflow (currently unused; kept for future flexibility).

Behavior:
- 200 ms debounce on textChanged via QTimer.
- Each query goes through services/ingredient_search.search_local — FTS5 on the local DB.
- No HTTP call from the keystroke path (would be slow + rate-limited by OFF).
- Selecting a row emits `ingredient_picked(int)` with the ingredient id.
"""

from __future__ import annotations

from PySide6.QtCore import QPoint, Qt, QTimer, Signal
from PySide6.QtWidgets import (
    QApplication,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from app.domain.models import Ingredient
from app.services import ingredient_search
from app.services.openfoodfacts import OpenFoodFactsError
from app.ui.app_context import AppContext

_DEBOUNCE_MS = 200
_MAX_SUGGESTIONS = 20

# Compact labels shown inside suggestion items.
_SOURCE_BADGES = {
    "ciqual": "CIQUAL",
    "openfoodfacts": "OFF",
    "manual": "perso",
}


class _SuggestionPopup(QFrame):
    """Popup hosting the suggestion list + an optional 'search online' button."""

    item_picked = Signal(int)
    online_search_requested = Signal(str)

    def __init__(self, parent: QWidget) -> None:
        super().__init__(parent, Qt.WindowType.Popup)
        self.setFrameShape(QFrame.Shape.StyledPanel)
        self.setObjectName("ingredientSuggestionPopup")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)

        self.list_widget = QListWidget(self)
        self.list_widget.setUniformItemSizes(True)
        self.list_widget.itemActivated.connect(self._on_activated)
        self.list_widget.itemClicked.connect(self._on_activated)
        layout.addWidget(self.list_widget)

        self.online_button = QPushButton("Chercher en ligne (OpenFoodFacts)", self)
        self.online_button.clicked.connect(self._emit_online_search)
        self.online_button.hide()
        layout.addWidget(self.online_button)

        self.empty_label = QLabel("Aucun résultat local.", self)
        self.empty_label.setContentsMargins(8, 4, 8, 4)
        self.empty_label.hide()
        layout.addWidget(self.empty_label)

        self._current_query = ""

    def show_results(
        self,
        matches: list[Ingredient],
        query: str,
        offer_online: bool,
        empty_message: str = "Aucun résultat.",
    ) -> None:
        self._current_query = query
        self.list_widget.clear()
        for ing in matches:
            badge = _SOURCE_BADGES.get(ing.source.value, ing.source.value)
            in_lib = "🌟 " if ing.in_personal_library else ""
            label_parts = [f"{in_lib}{ing.name}", f"[{badge}]"]
            if ing.source_ref:
                label_parts.append(f"· {ing.source_ref}")
            item = QListWidgetItem(" ".join(label_parts))
            assert ing.id is not None
            item.setData(Qt.ItemDataRole.UserRole, ing.id)
            self.list_widget.addItem(item)

        self.empty_label.setText(empty_message)
        self.empty_label.setVisible(not matches)
        self.online_button.setVisible(offer_online)
        self.list_widget.setVisible(bool(matches))

        if matches:
            self.list_widget.setCurrentRow(0)

    def _on_activated(self, item: QListWidgetItem) -> None:
        ingredient_id = item.data(Qt.ItemDataRole.UserRole)
        if ingredient_id is not None:
            self.item_picked.emit(int(ingredient_id))
            self.hide()

    def _emit_online_search(self) -> None:
        if self._current_query:
            self.online_search_requested.emit(self._current_query)


class IngredientSearchField(QWidget):
    """Public widget. Drop into a layout, connect to `ingredient_picked`."""

    ingredient_picked = Signal(int)
    online_search_failed = Signal(str)  # human-readable error string

    def __init__(
        self,
        ctx: AppContext,
        parent: QWidget | None = None,
        placeholder: str | None = None,
        scope: str = "personal",
    ) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self.scope = scope

        if placeholder is None:
            placeholder = (
                "Rechercher dans ma bibliothèque..."
                if scope == "personal"
                else "Rechercher (bibliothèque + CIQUAL + OFF en cache)..."
            )

        self._line = QLineEdit(self)
        self._line.setPlaceholderText(placeholder)
        self._line.setClearButtonEnabled(True)
        self._line.textChanged.connect(self._schedule_search)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self._line)

        self._popup = _SuggestionPopup(self)
        self._popup.item_picked.connect(self._on_picked)
        self._popup.online_search_requested.connect(self._fetch_online)

        self._timer = QTimer(self)
        self._timer.setSingleShot(True)
        self._timer.timeout.connect(self._run_search)

    # -- public API ----------------------------------------------------------

    def set_focus(self) -> None:
        self._line.setFocus()

    def clear(self) -> None:
        self._line.clear()
        self._popup.hide()

    def text(self) -> str:
        return self._line.text()

    # -- internals -----------------------------------------------------------

    def _schedule_search(self, _text: str) -> None:
        self._timer.start(_DEBOUNCE_MS)

    def _run_search(self) -> None:
        query = self._line.text().strip()
        if not query:
            self._popup.hide()
            return

        with self.ctx.session() as s:
            result = ingredient_search.search_local(
                s, query, limit=_MAX_SUGGESTIONS, scope=self.scope
            )

        # Only the 'all' scope offers a fallback to OpenFoodFacts. In 'personal' scope
        # the user must go through the explicit Import dialog instead — that's the
        # whole point of separating the personal library from external catalogs.
        offer_online = self.scope == "all" and (
            result.is_empty or result.looks_like_barcode
        )
        empty_message = (
            "Aucun ingrédient correspondant dans ta bibliothèque.\n"
            "Va dans l'onglet « Ingrédients » pour en importer ou en créer."
            if self.scope == "personal"
            else "Aucun résultat local."
        )
        self._popup.show_results(result.matches, query, offer_online, empty_message)
        self._show_popup_below_line()

    def _on_picked(self, ingredient_id: int) -> None:
        """Notify listeners. In 'all' scope this also promotes the row to the library."""
        if self.scope == "all":
            with self.ctx.session() as s:
                ingredient_search.promote_to_personal_library(s, ingredient_id)
        self.ingredient_picked.emit(ingredient_id)

    def _fetch_online(self, query: str) -> None:
        # Only reachable in scope='all' (the popup hides the button otherwise).
        try:
            with self.ctx.session() as s:
                fetched, _total = ingredient_search.fetch_from_openfoodfacts_and_cache(s, query)
        except OpenFoodFactsError as exc:
            self.online_search_failed.emit(str(exc))
            return

        self._popup.show_results(fetched, query, offer_online=False)
        if not fetched:
            self.online_search_failed.emit(
                "Aucun produit trouvé sur OpenFoodFacts pour cette recherche."
            )
        self._show_popup_below_line()

    def _show_popup_below_line(self) -> None:
        # Width matches the line edit; height capped.
        width = max(self._line.width(), 360)
        self._popup.setFixedWidth(width)
        bottom_left = self._line.mapToGlobal(QPoint(0, self._line.height()))
        self._popup.move(bottom_left)
        self._popup.adjustSize()
        # Cap height — don't let the popup overflow the screen.
        screen = QApplication.primaryScreen()
        if screen is not None:
            geo = screen.availableGeometry()
            max_h = max(150, geo.bottom() - bottom_left.y() - 20)
            if self._popup.height() > max_h:
                self._popup.resize(width, max_h)
        self._popup.show()
