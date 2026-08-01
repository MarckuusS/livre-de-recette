"""Tab 1: personal ingredients library.

Shows ONLY entries the user has explicitly imported or created (in_personal_library=1).
CIQUAL/OFF source rows live in the local DB but are surfaced via:
  - the "Importer un ingrédient" dialog (this tab) → opens both catalogs
  - the picker in Recipes / Calendar → picking promotes to personal library

Layout: search + import on top, list on the left, edit form on the right.
"""

from __future__ import annotations

import html as html_lib
from decimal import Decimal, InvalidOperation

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QAction, QKeySequence
from PySide6.QtWidgets import (
    QAbstractSpinBox,
    QDoubleSpinBox,
    QFormLayout,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSplitter,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from app.domain.models import Ingredient, Source
from app.ui.app_context import AppContext
from app.ui.viewmodels.ingredient_vm import IngredientViewModel
from app.ui.widgets.fixed_unit_field import FixedUnitField
from app.ui.widgets.import_dialog import ImportIngredientDialog
from app.ui.widgets.quantity_field import QuantityField


# Source badges shown in the list. Tailwind-ish hues.
_SOURCE_STYLES = {
    "ciqual":        ("CIQUAL", "#15803d", "#dcfce7"),  # green: official ANSES table
    "openfoodfacts": ("OFF",    "#1d4ed8", "#dbeafe"),  # blue: community-driven
    "manual":        ("perso",  "#c2410c", "#ffedd5"),  # amber: user-created
}
# Macro chip colours — same convention as the import dialog so the user gets a
# consistent reading: P=blue, G=green, L=amber.
_COLOR_PROTEINS = "#1d4ed8"
_COLOR_CARBS = "#15803d"
_COLOR_FATS = "#a16207"
_COLOR_BADGE_NEUTRAL = "#6b7280"


def _render_ingredient_list_html(ing: Ingredient) -> str:
    """Single-line HTML card for a row in the personal library list:
    <name> [SOURCE_PILL] · P xx · G xx · L xx
    No barcode/code shown — that's editing-time info, not list-time.
    """
    label, fg, bg = _SOURCE_STYLES.get(
        ing.source.value,
        (ing.source.value, _COLOR_BADGE_NEUTRAL, "#f3f4f6"),
    )
    badge_html = (
        f'<span style="background:{bg}; color:{fg}; padding:1px 7px; '
        f'border-radius:8px; font-size:9pt; font-weight:600;">{label}</span>'
    )

    macros: list[str] = []
    if ing.proteins_g is not None:
        macros.append(
            f'<span style="color:{_COLOR_PROTEINS}; font-weight:500;">'
            f"P&nbsp;{ing.proteins_g:.1f}g</span>"
        )
    if ing.carbs_g is not None:
        macros.append(
            f'<span style="color:{_COLOR_CARBS}; font-weight:500;">'
            f"G&nbsp;{ing.carbs_g:.1f}g</span>"
        )
    if ing.fats_g is not None:
        macros.append(
            f'<span style="color:{_COLOR_FATS}; font-weight:500;">'
            f"L&nbsp;{ing.fats_g:.1f}g</span>"
        )
    sep = '<span style="color:%s;">&nbsp;·&nbsp;</span>' % _COLOR_BADGE_NEUTRAL
    macros_html = sep.join(macros)

    return (
        f'<div style="padding:1px 0;">'
        f"  <b>{html_lib.escape(ing.name)}</b>"
        f"  &nbsp;{badge_html}"
        f'  {("&nbsp;&nbsp;" + macros_html) if macros_html else ""}'
        f"</div>"
    )


# Backwards-compatible alias — the actual implementation now lives in
# app.ui.widgets.fixed_unit_field (shared with the import dialog filter panel).
_FixedUnitField = FixedUnitField

_DEBOUNCE_MS = 200


class IngredientsTab(QWidget):
    def __init__(self, ctx: AppContext, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self.vm = IngredientViewModel(ctx, parent=self)
        self.vm.items_changed.connect(self._reload_list)
        self.vm.error_emitted.connect(self._show_error)

        self._current_id: int | None = None

        self._build_ui()
        self._reload_list()

    def showEvent(self, event):  # noqa: N802 (Qt naming)
        # Catch ingredients added implicitly via the Recipes/Calendar pickers.
        super().showEvent(event)
        self.vm.refresh()

    # ------------------------------------------------------------------ UI
    def _build_ui(self) -> None:
        # Top: search bar + import button.
        self.search_edit = QLineEdit(self)
        self.search_edit.setPlaceholderText(
            "Rechercher dans ma bibliothèque personnelle..."
        )
        self.search_edit.setClearButtonEnabled(True)
        self._search_timer = QTimer(self)
        self._search_timer.setSingleShot(True)
        self._search_timer.timeout.connect(self._apply_filter)
        self.search_edit.textChanged.connect(lambda _: self._search_timer.start(_DEBOUNCE_MS))

        self.import_button = QPushButton("Importer un ingrédient (CIQUAL / OFF)", self)
        self.import_button.clicked.connect(self._open_import_dialog)

        top = QHBoxLayout()
        top.addWidget(self.search_edit, 1)
        top.addWidget(self.import_button)

        # Left: list + new/delete buttons.
        self.list_widget = QListWidget(self)
        self.list_widget.itemSelectionChanged.connect(self._on_selection_changed)

        # Empty-state message shown when the personal library has zero entries.
        self.empty_label = QLabel(
            "<b>Ta bibliothèque est vide.</b><br>"
            "Crée un ingrédient avec <i>Nouveau</i>, ou importe-en depuis CIQUAL / "
            "OpenFoodFacts via le bouton en haut à droite.<br>"
            "Tu peux aussi piocher dans CIQUAL/OFF directement depuis l'éditeur de "
            "recettes ou le calendrier — l'ingrédient sera ajouté ici automatiquement.",
            self,
        )
        self.empty_label.setWordWrap(True)
        self.empty_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty_label.setStyleSheet("color: #6b7280; padding: 18px;")
        self.empty_label.hide()

        self.new_button = QPushButton("Nouveau", self)
        self.new_button.clicked.connect(self._new_ingredient)
        self.delete_button = QPushButton("Retirer", self)
        self.delete_button.setToolTip(
            "Retire l'ingrédient de ta bibliothèque. "
            "Les entrées CIQUAL et OpenFoodFacts restent disponibles dans le catalogue."
        )
        self.delete_button.clicked.connect(self._delete_current)
        self.delete_button.setEnabled(False)

        list_buttons = QHBoxLayout()
        list_buttons.addWidget(self.new_button)
        list_buttons.addWidget(self.delete_button)
        list_buttons.addStretch(1)

        left_panel = QWidget(self)
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.addLayout(list_buttons)
        left_layout.addWidget(self.list_widget, 1)
        left_layout.addWidget(self.empty_label)

        # Right: edit form, wrapped in a scroll area so it always renders at its full
        # natural height — when the window is too short, a scrollbar appears instead
        # of compressing rows and clipping label descenders.
        right_panel = self._build_form_panel()
        right_scroll = QScrollArea(self)
        right_scroll.setWidget(right_panel)
        right_scroll.setWidgetResizable(True)
        right_scroll.setFrameShape(QFrame.Shape.NoFrame)
        right_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        splitter = QSplitter(Qt.Orientation.Horizontal, self)
        splitter.addWidget(left_panel)
        splitter.addWidget(right_scroll)
        splitter.setStretchFactor(0, 1)
        splitter.setStretchFactor(1, 2)

        root = QVBoxLayout(self)
        root.addLayout(top)
        root.addWidget(splitter, 1)

        # Ctrl+N -> New
        new_action = QAction("Nouveau", self)
        new_action.setShortcut(QKeySequence("Ctrl+N"))
        new_action.triggered.connect(self._new_ingredient)
        self.addAction(new_action)

    def _build_form_panel(self) -> QWidget:
        panel = QWidget(self)
        form = QFormLayout(panel)
        form.setLabelAlignment(Qt.AlignmentFlag.AlignRight)

        self.name_edit = QLineEdit(panel)
        self.source_label = QLabel("manuel", panel)
        self.source_ref_edit = QLineEdit(panel)
        self.source_ref_edit.setPlaceholderText("Code CIQUAL ou code-barres EAN (optionnel)")

        self.kcal_spin = _FixedUnitField(panel, unit_text="kcal/100g", max_v=2000.0)
        self.proteins_spin = _FixedUnitField(panel, unit_text="g/100g")
        self.carbs_spin = _FixedUnitField(panel, unit_text="g/100g")
        self.sugars_spin = _FixedUnitField(panel, unit_text="g/100g")
        self.fats_spin = _FixedUnitField(panel, unit_text="g/100g")
        self.sat_fats_spin = _FixedUnitField(panel, unit_text="g/100g")
        self.fiber_spin = _FixedUnitField(panel, unit_text="g/100g")
        self.salt_spin = _FixedUnitField(panel, unit_text="g/100g")

        self.price_edit = QLineEdit(panel)
        self.price_edit.setPlaceholderText("Prix en euros (ex: 3,99)")
        self.price_qty_field = QuantityField(panel, default_grams=0.0, decimals=1)

        self.notes_edit = QTextEdit(panel)
        self.notes_edit.setVisible(False)  # placeholder for future use

        self.save_button = QPushButton("Enregistrer", panel)
        self.save_button.clicked.connect(self._save_current)

        form.addRow("Nom :", self.name_edit)
        form.addRow("Source :", self.source_label)
        form.addRow("Réf. source :", self.source_ref_edit)
        form.addRow("Énergie :", self.kcal_spin)
        form.addRow("Protéines :", self.proteins_spin)
        form.addRow("Glucides :", self.carbs_spin)
        form.addRow("  dont sucres :", self.sugars_spin)
        form.addRow("Lipides :", self.fats_spin)
        form.addRow("  dont saturés :", self.sat_fats_spin)
        form.addRow("Fibres :", self.fiber_spin)
        form.addRow("Sel :", self.salt_spin)
        form.addRow("Prix (€) :", self.price_edit)
        form.addRow("Quantité de référence :", self.price_qty_field)
        form.addRow(self.save_button)
        return panel

    # ------------------------------------------------------------------ data flow

    def _reload_list(self) -> None:
        self.list_widget.blockSignals(True)
        self.list_widget.clear()
        for ing in self.vm.items:
            item = QListWidgetItem(self.list_widget)
            item.setData(Qt.ItemDataRole.UserRole, ing.id)

            label = QLabel(_render_ingredient_list_html(ing))
            label.setTextFormat(Qt.TextFormat.RichText)
            # Without this, the QLabel intercepts mouse events and breaks list selection.
            label.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
            label.setMargin(6)
            self.list_widget.setItemWidget(item, label)
            item.setSizeHint(label.sizeHint())
        self.list_widget.blockSignals(False)

        # Empty-state visibility: hide the list, show the message.
        is_empty = len(self.vm.items) == 0 and not self.search_edit.text().strip()
        self.empty_label.setVisible(is_empty)

        # Try to keep the previous selection.
        if self._current_id is not None:
            for i in range(self.list_widget.count()):
                if self.list_widget.item(i).data(Qt.ItemDataRole.UserRole) == self._current_id:
                    self.list_widget.setCurrentRow(i)
                    return
        self._current_id = None
        self._clear_form()

    def _on_selection_changed(self) -> None:
        items = self.list_widget.selectedItems()
        if not items:
            self._current_id = None
            self.delete_button.setEnabled(False)
            self._clear_form()
            return
        self._current_id = int(items[0].data(Qt.ItemDataRole.UserRole))
        self.delete_button.setEnabled(True)
        ing = self.vm.get(self._current_id)
        if ing is not None:
            self._populate_form(ing)

    def _apply_filter(self) -> None:
        self.vm.set_filter(self.search_edit.text())

    def _open_import_dialog(self) -> None:
        dialog = ImportIngredientDialog(self.ctx, parent=self)
        dialog.library_changed.connect(self.vm.refresh)
        dialog.exec()

    def _show_error(self, message: str) -> None:
        QMessageBox.warning(self, "Erreur", message)

    # ------------------------------------------------------------------ form

    def _new_ingredient(self) -> None:
        self.list_widget.clearSelection()
        self._current_id = None
        self.delete_button.setEnabled(False)
        self._clear_form()
        self.name_edit.setFocus()

    def _delete_current(self) -> None:
        if self._current_id is None:
            return
        ing = self.vm.get(self._current_id)
        if ing is None:
            return
        if ing.source == Source.MANUAL:
            message = (
                f"Supprimer définitivement '{ing.name}' ? "
                f"Cet ingrédient a été créé par toi et n'existe pas dans CIQUAL/OpenFoodFacts."
            )
        else:
            message = (
                f"Retirer '{ing.name}' de ta bibliothèque ? "
                f"Il restera disponible dans le catalogue {ing.source.value.upper()} "
                f"et tu pourras le réimporter à tout moment."
            )
        confirm = QMessageBox.question(self, "Confirmation", message)
        if confirm == QMessageBox.StandardButton.Yes:
            self.vm.delete(self._current_id)

    def _save_current(self) -> None:
        name = self.name_edit.text().strip()
        if not name:
            QMessageBox.warning(self, "Nom requis", "Le nom de l'ingrédient est obligatoire.")
            return

        price: Decimal | None = None
        price_text = self.price_edit.text().strip().replace(",", ".")
        if price_text:
            try:
                price = Decimal(price_text)
            except InvalidOperation:
                QMessageBox.warning(self, "Prix invalide", "Le prix doit être un nombre.")
                return

        # Prefer the source already loaded for an existing row; else 'manual'.
        source = Source.MANUAL
        if self._current_id is not None:
            existing = self.vm.get(self._current_id)
            if existing is not None:
                source = existing.source

        ing = Ingredient(
            id=self._current_id,
            name=name,
            source=source,
            source_ref=self.source_ref_edit.text().strip() or None,
            kcal_per_100g=_or_none(self.kcal_spin.value()),
            proteins_g=_or_none(self.proteins_spin.value()),
            carbs_g=_or_none(self.carbs_spin.value()),
            sugars_g=_or_none(self.sugars_spin.value()),
            fats_g=_or_none(self.fats_spin.value()),
            saturated_fats_g=_or_none(self.sat_fats_spin.value()),
            fiber_g=_or_none(self.fiber_spin.value()),
            salt_g=_or_none(self.salt_spin.value()),
            price_eur=price,
            price_quantity_g=_or_none(self.price_qty_field.grams_value()),
        )
        saved = self.vm.save(ing)
        self._current_id = saved.id

    def _populate_form(self, ing: Ingredient) -> None:
        self.name_edit.setText(ing.name)
        self.source_label.setText(ing.source.value)
        self.source_ref_edit.setText(ing.source_ref or "")
        self.kcal_spin.setValue(ing.kcal_per_100g or 0.0)
        self.proteins_spin.setValue(ing.proteins_g or 0.0)
        self.carbs_spin.setValue(ing.carbs_g or 0.0)
        self.sugars_spin.setValue(ing.sugars_g or 0.0)
        self.fats_spin.setValue(ing.fats_g or 0.0)
        self.sat_fats_spin.setValue(ing.saturated_fats_g or 0.0)
        self.fiber_spin.setValue(ing.fiber_g or 0.0)
        self.salt_spin.setValue(ing.salt_g or 0.0)
        self.price_edit.setText(str(ing.price_eur) if ing.price_eur is not None else "")
        self.price_qty_field.set_grams(ing.price_quantity_g or 0.0)

    def _clear_form(self) -> None:
        self.name_edit.clear()
        self.source_label.setText("manuel")
        self.source_ref_edit.clear()
        for spin in (
            self.kcal_spin,
            self.proteins_spin,
            self.carbs_spin,
            self.sugars_spin,
            self.fats_spin,
            self.sat_fats_spin,
            self.fiber_spin,
            self.salt_spin,
        ):
            spin.setValue(0.0)
        self.price_qty_field.set_grams(0.0)
        self.price_edit.clear()


def _or_none(v: float) -> float | None:
    return v if v > 0 else None
