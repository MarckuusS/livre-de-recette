"""Tab 2: recipes library + editor.

Layout: left list of recipes, right editor (name, portions, instructions, lines table,
add-ingredient field with dynamic suggestions, live nutrition + cost panels).
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QAction, QKeySequence
from PySide6.QtWidgets import (
    QAbstractSpinBox,
    QDoubleSpinBox,
    QFormLayout,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QListWidget,
    QListWidgetItem,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QSplitter,
    QTableWidget,
    QTableWidgetItem,
    QTextEdit,
    QVBoxLayout,
    QWidget,
)

from app.domain.models import Recipe
from app.ui.app_context import AppContext
from app.ui.viewmodels.recipe_vm import RecipeEditorViewModel, RecipeListViewModel
from app.ui.widgets.ingredient_search import IngredientSearchField
from app.ui.widgets.nutrition_panel import NutritionPanel
from app.ui.widgets.quantity_field import QuantityField


class RecipesTab(QWidget):
    def __init__(self, ctx: AppContext, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self.list_vm = RecipeListViewModel(ctx, parent=self)
        self.editor_vm = RecipeEditorViewModel(parent=self)

        self.list_vm.items_changed.connect(self._reload_list)
        # Three handlers — see RecipeEditorViewModel docstring for the contract.
        # Hot path on every keystroke: only `_refresh_derived` runs, and it never
        # writes back to any input field or rebuilds the lines table.
        self.editor_vm.loaded.connect(self._load_into_editor)
        self.editor_vm.lines_changed.connect(self._rebuild_lines_table)
        self.editor_vm.derived_changed.connect(self._refresh_derived)

        self._current_id: int | None = None
        self._build_ui()
        self._reload_list()
        self._load_into_editor()

    # ------------------------------------------------------------------ UI
    def _build_ui(self) -> None:
        # Left: recipe list + buttons.
        self.list_widget = QListWidget(self)
        self.list_widget.itemSelectionChanged.connect(self._on_selection_changed)

        new_btn = QPushButton("Nouvelle", self)
        new_btn.clicked.connect(self._new_recipe)
        del_btn = QPushButton("Supprimer", self)
        del_btn.clicked.connect(self._delete_current)
        self._delete_btn = del_btn
        del_btn.setEnabled(False)

        list_buttons = QHBoxLayout()
        list_buttons.addWidget(new_btn)
        list_buttons.addWidget(del_btn)
        list_buttons.addStretch(1)

        left = QWidget(self)
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.addLayout(list_buttons)
        left_layout.addWidget(self.list_widget, 1)

        # Right: editor — wrapped in a scroll area so the meta form, lines table and
        # nutrition/cost panels all stay legible at any window size.
        right = self._build_editor()
        right_scroll = QScrollArea(self)
        right_scroll.setWidget(right)
        right_scroll.setWidgetResizable(True)
        right_scroll.setFrameShape(QFrame.Shape.NoFrame)
        right_scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        splitter = QSplitter(Qt.Orientation.Horizontal, self)
        splitter.addWidget(left)
        splitter.addWidget(right_scroll)
        splitter.setStretchFactor(0, 1)
        splitter.setStretchFactor(1, 3)

        root = QVBoxLayout(self)
        root.addWidget(splitter)

        # Ctrl+N shortcut for new recipe.
        new_action = QAction("Nouvelle recette", self)
        new_action.setShortcut(QKeySequence("Ctrl+N"))
        new_action.triggered.connect(self._new_recipe)
        self.addAction(new_action)

    def _build_editor(self) -> QWidget:
        editor = QWidget(self)

        # Meta form.
        meta_box = QGroupBox("Recette", editor)
        meta_form = QFormLayout(meta_box)
        self.name_edit = QLineEdit(meta_box)
        self.portions_spin = QSpinBox(meta_box)
        self.portions_spin.setRange(1, 50)
        self.portions_spin.setValue(1)
        self.portions_spin.setButtonSymbols(QAbstractSpinBox.ButtonSymbols.NoButtons)
        self.instructions_edit = QTextEdit(meta_box)
        self.instructions_edit.setPlaceholderText("Instructions de préparation…")
        self.instructions_edit.setAcceptRichText(False)
        meta_form.addRow("Nom :", self.name_edit)
        meta_form.addRow("Portions :", self.portions_spin)
        meta_form.addRow("Instructions :", self.instructions_edit)

        for w in (self.name_edit, self.portions_spin, self.instructions_edit):
            try:
                w.textChanged.connect(self._push_meta_to_vm)  # QLineEdit / QTextEdit
            except AttributeError:
                w.valueChanged.connect(self._push_meta_to_vm)  # QSpinBox

        # Ingredient picker + quantity + add.
        picker_box = QGroupBox("Ajouter un ingrédient", editor)
        self.search_field = IngredientSearchField(self.ctx, parent=picker_box)
        self.search_field.ingredient_picked.connect(self._on_ingredient_picked)
        self.search_field.online_search_failed.connect(
            lambda msg: QMessageBox.warning(self, "OpenFoodFacts", msg)
        )

        self.qty_field = QuantityField(picker_box, default_grams=100.0, decimals=1)

        picker_layout = QHBoxLayout(picker_box)
        picker_layout.addWidget(self.search_field, 1)
        picker_layout.addWidget(QLabel("Quantité :", picker_box))
        picker_layout.addWidget(self.qty_field)

        # Lines table.
        self.lines_table = QTableWidget(0, 4, editor)
        self.lines_table.setHorizontalHeaderLabels(["Ingrédient", "Quantité (g)", "Notes", ""])
        header = self.lines_table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)        # Ingrédient
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Fixed)
        self.lines_table.setColumnWidth(1, 200)                                # Quantité (val + unité)
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)        # Notes
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.Fixed)
        self.lines_table.setColumnWidth(3, 50)                                 # Delete button
        self.lines_table.verticalHeader().setVisible(False)
        self.lines_table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)

        # Save button.
        save_btn = QPushButton("Enregistrer la recette", editor)
        save_btn.clicked.connect(self._save_current)

        # Nutrition + cost panels.
        self.nutrition_total = NutritionPanel("Pour la recette entière", editor)
        self.nutrition_per_portion = NutritionPanel("Par portion", editor)

        self.cost_label = QLabel("—", editor)
        cost_box = QGroupBox("Coût", editor)
        cost_layout = QFormLayout(cost_box)
        cost_layout.addRow(self.cost_label)

        # Layout.
        side = QVBoxLayout()
        side.addWidget(self.nutrition_total)
        side.addWidget(self.nutrition_per_portion)
        side.addWidget(cost_box)
        side.addStretch(1)

        center = QVBoxLayout()
        center.addWidget(meta_box)
        center.addWidget(picker_box)
        center.addWidget(self.lines_table, 1)
        center.addWidget(save_btn)

        editor_layout = QHBoxLayout(editor)
        editor_layout.addLayout(center, 2)
        editor_layout.addLayout(side, 1)
        return editor

    # ------------------------------------------------------------------ data flow

    def _reload_list(self) -> None:
        self.list_widget.blockSignals(True)
        self.list_widget.clear()
        for recipe in self.list_vm.items:
            item = QListWidgetItem(recipe.name)
            item.setData(Qt.ItemDataRole.UserRole, recipe.id)
            self.list_widget.addItem(item)
        self.list_widget.blockSignals(False)

        if self._current_id is not None:
            for i in range(self.list_widget.count()):
                if self.list_widget.item(i).data(Qt.ItemDataRole.UserRole) == self._current_id:
                    self.list_widget.setCurrentRow(i)
                    return
        self._current_id = None

    def _on_selection_changed(self) -> None:
        items = self.list_widget.selectedItems()
        if not items:
            self._current_id = None
            self._delete_btn.setEnabled(False)
            self.editor_vm.load(None)
            return
        self._current_id = int(items[0].data(Qt.ItemDataRole.UserRole))
        self._delete_btn.setEnabled(True)
        recipe = self.list_vm.get(self._current_id)
        self.editor_vm.load(recipe)

    def _new_recipe(self) -> None:
        self.list_widget.clearSelection()
        self._current_id = None
        self._delete_btn.setEnabled(False)
        self.editor_vm.load(None)
        self.name_edit.setFocus()

    def _delete_current(self) -> None:
        if self._current_id is None:
            return
        recipe = self.list_vm.get(self._current_id)
        if recipe is None:
            return
        confirm = QMessageBox.question(
            self, "Supprimer", f"Supprimer la recette '{recipe.name}' ?"
        )
        if confirm == QMessageBox.StandardButton.Yes:
            self.list_vm.delete(self._current_id)
            self._current_id = None

    def _save_current(self) -> None:
        recipe = self.editor_vm.recipe
        if not recipe.name.strip():
            QMessageBox.warning(self, "Nom requis", "Donne un nom à la recette avant d'enregistrer.")
            return
        to_save = recipe.model_copy(update={"id": self._current_id})
        saved = self.list_vm.save(to_save)
        self._current_id = saved.id

    # ------------------------------------------------------------------ editor sync

    def _push_meta_to_vm(self) -> None:
        # Avoid re-emitting changed when we're just rebuilding the form from VM.
        if self._refreshing:
            return
        self.editor_vm.update_meta(
            name=self.name_edit.text(),
            instructions=self.instructions_edit.toPlainText(),
            default_portions=self.portions_spin.value(),
        )

    _refreshing: bool = False

    def _load_into_editor(self) -> None:
        """Full repopulate of the editor — used only when a different recipe is loaded
        (selection change, "Nouvelle", initial bootstrap). Setting values on input
        widgets here is fine because the user isn't typing into them yet."""
        recipe: Recipe = self.editor_vm.recipe
        self._refreshing = True
        try:
            self.name_edit.setText(recipe.name)
            self.portions_spin.setValue(recipe.default_portions)
            self.instructions_edit.setPlainText(recipe.instructions)
        finally:
            self._refreshing = False
        self._rebuild_lines_table()
        self._refresh_derived()

    def _rebuild_lines_table(self) -> None:
        """Rebuild the QTableWidget rows. Called when the line set changes (add/remove)
        — never when the user is just typing a new quantity (that path uses
        derived_changed only)."""
        recipe: Recipe = self.editor_vm.recipe
        self.lines_table.setRowCount(0)
        for line in recipe.lines:
            row = self.lines_table.rowCount()
            self.lines_table.insertRow(row)

            name_item = QTableWidgetItem(line.ingredient.name)
            name_item.setData(Qt.ItemDataRole.UserRole, line.ordinal)
            self.lines_table.setItem(row, 0, name_item)

            qty_field = QuantityField(
                self.lines_table, default_grams=line.quantity_g, decimals=1
            )
            ordinal = line.ordinal
            qty_field.value_grams_changed.connect(
                lambda v, o=ordinal: self.editor_vm.update_line_quantity(o, v)
            )
            self.lines_table.setCellWidget(row, 1, qty_field)

            self.lines_table.setItem(row, 2, QTableWidgetItem(line.notes or ""))

            # Minimalist red ✕ button — no green block, just a clear "remove" cue.
            # Wrapped in a transparent container so the button is centered in its cell
            # (QTableWidget aligns cell widgets top-left by default).
            remove_btn = QPushButton("✕", self.lines_table)
            remove_btn.setFixedSize(26, 26)
            remove_btn.setCursor(Qt.CursorShape.PointingHandCursor)
            remove_btn.setToolTip("Retirer cet ingrédient de la recette")
            remove_btn.setStyleSheet(
                "QPushButton {"
                " background: transparent;"
                " border: none;"
                " color: #b91c1c;"
                " font-size: 14px;"
                " font-weight: bold;"
                " padding: 0;"
                "}"
                "QPushButton:hover {"
                " background: #fee2e2;"
                " border-radius: 13px;"
                "}"
                "QPushButton:pressed {"
                " background: #fecaca;"
                "}"
            )
            remove_btn.clicked.connect(lambda _checked=False, o=ordinal: self.editor_vm.remove_line(o))

            cell = QWidget(self.lines_table)
            cell_layout = QHBoxLayout(cell)
            cell_layout.setContentsMargins(0, 0, 0, 0)
            cell_layout.addWidget(remove_btn, 0, Qt.AlignmentFlag.AlignCenter)
            self.lines_table.setCellWidget(row, 3, cell)

    def _refresh_derived(self) -> None:
        """Update the nutrition/cost panels only. MUST NOT touch any input widget or
        the lines table — runs on every keystroke."""
        recipe: Recipe = self.editor_vm.recipe

        total, per_portion = self.editor_vm.totals()
        self.nutrition_total.set_total(total)
        self.nutrition_per_portion.set_total(per_portion)

        cost, missing = self.editor_vm.cost_total()
        per_portion_cost, _ = self.editor_vm.cost_per_portion()
        if recipe.lines:
            line_count = len(recipe.lines)
            missing_count = len(missing)
            if missing_count == 0:
                self.cost_label.setText(
                    f"<b>{cost} €</b> au total · <b>{per_portion_cost} €</b> par portion"
                )
            else:
                self.cost_label.setText(
                    f"<b>{cost} €</b> au total · <b>{per_portion_cost} €</b> par portion<br>"
                    f"<i>(prix manquant pour {missing_count}/{line_count} ingrédient(s))</i>"
                )
        else:
            self.cost_label.setText("—")

    def _on_ingredient_picked(self, ingredient_id: int) -> None:
        ingredient = self.editor_vm.hydrate_ingredient(self.ctx, ingredient_id)
        if ingredient is None:
            return
        qty_g = self.qty_field.grams_value()
        self.editor_vm.add_line(ingredient, qty_g)
        self.search_field.clear()
