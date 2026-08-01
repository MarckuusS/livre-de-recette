"""Tab 3: weekly meal-plan calendar.

Layout:
- Top bar: ISO week label + < / > week navigation + "Semaine courante" button.
- 7 columns (Mon..Sun) x 3 rows (morning / noon / evening), each cell is a MealSlotWidget.
- Right-side panel: per-day kcal totals + week total + week cost.

Adding to a slot opens a small dialog with two ways to populate it:
  - Pick a recipe from the library (combo).
  - Pick an ingredient via the dynamic-suggestion field + quantity.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractSpinBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QDoubleSpinBox,
    QFormLayout,
    QGridLayout,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSplitter,
    QTabWidget,
    QVBoxLayout,
    QWidget,
)

from app.data.repositories import RecipeRepo
from app.domain.models import MealSlot, NutritionTotal
from app.ui.app_context import AppContext
from app.ui.viewmodels.calendar_vm import CalendarViewModel
from app.ui.widgets.ingredient_search import IngredientSearchField
from app.ui.widgets.meal_slot import DayHeader, MealSlotWidget, SlotHeader
from app.ui.widgets.quantity_field import QuantityField

DAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
SLOT_NAMES = [(MealSlot.MORNING, "Matin"), (MealSlot.NOON, "Midi"), (MealSlot.EVENING, "Soir")]


class CalendarTab(QWidget):
    def __init__(self, ctx: AppContext, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self.vm = CalendarViewModel(ctx, parent=self)
        self.vm.week_changed.connect(self._on_week_changed)

        self._slot_widgets: list[MealSlotWidget] = []  # all 21 slots, flat
        self._day_total_labels: list[QLabel] = []      # 7 labels
        self._build_ui()
        self._refresh_all()

    def _build_ui(self) -> None:
        # Top navigation bar.
        self.week_label = QLabel(self)
        self.week_label.setStyleSheet("font-size: 14pt; font-weight: 600;")

        prev_btn = QPushButton("◀  Semaine précédente", self)
        prev_btn.clicked.connect(lambda: self.vm.shift_week(-1))
        next_btn = QPushButton("Semaine suivante  ▶", self)
        next_btn.clicked.connect(lambda: self.vm.shift_week(1))
        today_btn = QPushButton("Cette semaine", self)
        today_btn.clicked.connect(self._goto_current_week)

        topbar = QHBoxLayout()
        topbar.addWidget(prev_btn)
        topbar.addWidget(today_btn)
        topbar.addWidget(next_btn)
        topbar.addStretch(1)
        topbar.addWidget(self.week_label)
        topbar.addStretch(1)

        # Grid: 1 header row + 3 slot rows, 1 row-label column + 7 day columns + 1 day-total row.
        grid_widget = QWidget(self)
        grid = QGridLayout(grid_widget)
        grid.setHorizontalSpacing(4)
        grid.setVerticalSpacing(4)

        # Day headers.
        grid.addWidget(QLabel("", grid_widget), 0, 0)  # corner
        for col, day_name in enumerate(DAY_NAMES):
            grid.addWidget(DayHeader(day_name, grid_widget), 0, col + 1)

        # Slot rows.
        for row_idx, (slot, slot_label) in enumerate(SLOT_NAMES):
            grid.addWidget(SlotHeader(slot_label, grid_widget), row_idx + 1, 0)
            for day in range(7):
                w = MealSlotWidget(self.vm, day_of_week=day, slot=slot, parent=grid_widget)
                w.add_requested.connect(self._open_add_dialog)
                grid.addWidget(w, row_idx + 1, day + 1)
                self._slot_widgets.append(w)

        # Per-day kcal totals row.
        grid.addWidget(SlotHeader("Total/jour", grid_widget), len(SLOT_NAMES) + 1, 0)
        for day in range(7):
            lbl = QLabel("—", grid_widget)
            lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
            lbl.setStyleSheet("padding: 4px; font-weight: 500;")
            grid.addWidget(lbl, len(SLOT_NAMES) + 1, day + 1)
            self._day_total_labels.append(lbl)

        for col in range(1, 8):
            grid.setColumnStretch(col, 1)
        for row in range(1, len(SLOT_NAMES) + 1):
            grid.setRowStretch(row, 1)

        # Right-side weekly summary.
        summary = QGroupBox("Semaine", self)
        summary_form = QFormLayout(summary)
        self.week_kcal_label = QLabel("—", summary)
        self.week_kcal_per_day_label = QLabel("—", summary)
        self.week_cost_label = QLabel("—", summary)
        summary_form.addRow("Énergie totale :", self.week_kcal_label)
        summary_form.addRow("Moyenne / jour :", self.week_kcal_per_day_label)
        summary_form.addRow("Coût estimé :", self.week_cost_label)

        # Compose root layout.
        body_splitter = QSplitter(Qt.Orientation.Horizontal, self)
        body_splitter.addWidget(grid_widget)
        body_splitter.addWidget(summary)
        body_splitter.setStretchFactor(0, 4)
        body_splitter.setStretchFactor(1, 1)

        root = QVBoxLayout(self)
        root.addLayout(topbar)
        root.addWidget(body_splitter, 1)

    # ----------------------------------------------------------- data flow

    def _refresh_all(self) -> None:
        self._update_week_label()
        for w in self._slot_widgets:
            w.refresh()
        self._update_totals()

    def _on_week_changed(self) -> None:
        self._refresh_all()

    def _update_week_label(self) -> None:
        iso = self.vm.iso_week
        year = int(iso[:4])
        week = int(iso[6:])
        monday = datetime.fromisocalendar(year, week, 1)
        sunday = monday + timedelta(days=6)
        self.week_label.setText(
            f"{iso}  ·  {monday.strftime('%d %b')} → {sunday.strftime('%d %b %Y')}"
        )

    def _update_totals(self) -> None:
        for day in range(7):
            total: NutritionTotal = self.vm.day_total(day)
            kcal = round(total.kcal)
            self._day_total_labels[day].setText(f"{kcal} kcal" if kcal else "—")

        week = self.vm.week_total()
        if week.kcal > 0:
            self.week_kcal_label.setText(f"{round(week.kcal)} kcal")
            self.week_kcal_per_day_label.setText(f"{round(week.kcal / 7)} kcal")
        else:
            self.week_kcal_label.setText("—")
            self.week_kcal_per_day_label.setText("—")

        cost, missing = self.vm.week_cost()
        if cost > 0 or missing == 0:
            txt = f"{cost} €"
            if missing:
                txt += f"  (prix manquant : {missing})"
            self.week_cost_label.setText(txt)
        else:
            self.week_cost_label.setText("—")

    def _goto_current_week(self) -> None:
        from app.domain.models import IsoWeek

        self.vm.set_iso_week(IsoWeek.from_date(datetime.now()).value)

    def _open_add_dialog(self, day: int, slot: object) -> None:
        # `slot` is a MealSlot — Qt typing strips the enum class through Signal.
        if not isinstance(slot, MealSlot):
            slot = MealSlot(slot)
        dialog = _AddSlotItemDialog(self.ctx, day, slot, parent=self)
        if dialog.exec() == QDialog.DialogCode.Accepted:
            picked = dialog.result
            if picked is None:
                return
            kind, target_id, qty_or_portions = picked
            if kind == "recipe":
                self.vm.add_recipe(day, slot, target_id, portions=qty_or_portions)
            else:
                self.vm.add_ingredient(day, slot, target_id, quantity_g=qty_or_portions)


class _AddSlotItemDialog(QDialog):
    """Two-tab dialog: pick a recipe OR pick an ingredient + quantity."""

    def __init__(
        self,
        ctx: AppContext,
        day: int,
        slot: MealSlot,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.ctx = ctx
        self.day = day
        self.slot = slot
        self.result: tuple[str, int, float] | None = None  # ('recipe' | 'ingredient', id, qty)
        self.setWindowTitle(f"Ajouter — {DAY_NAMES[day]} {slot.value}")
        self.resize(500, 280)

        tabs = QTabWidget(self)
        tabs.addTab(self._build_recipe_tab(), "🍽 Recette")
        tabs.addTab(self._build_ingredient_tab(), "🥕 Ingrédient")
        self._tabs = tabs

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel, self
        )
        buttons.accepted.connect(self._accept)
        buttons.rejected.connect(self.reject)

        layout = QVBoxLayout(self)
        layout.addWidget(tabs)
        layout.addWidget(buttons)

    def _build_recipe_tab(self) -> QWidget:
        page = QWidget(self)
        form = QFormLayout(page)
        self.recipe_combo = QComboBox(page)
        with self.ctx.session() as s:
            for recipe in RecipeRepo(s).list_all():
                self.recipe_combo.addItem(recipe.name, recipe.id)
        if self.recipe_combo.count() == 0:
            self.recipe_combo.addItem("(aucune recette — crée-en dans l'onglet Recettes)", None)
            self.recipe_combo.setEnabled(False)

        self.portions_spin = QDoubleSpinBox(page)
        self.portions_spin.setRange(0.25, 50.0)
        self.portions_spin.setSingleStep(0.5)
        self.portions_spin.setValue(1.0)
        self.portions_spin.setDecimals(2)
        self.portions_spin.setButtonSymbols(QAbstractSpinBox.ButtonSymbols.NoButtons)

        form.addRow("Recette :", self.recipe_combo)
        form.addRow("Portions :", self.portions_spin)
        return page

    def _build_ingredient_tab(self) -> QWidget:
        page = QWidget(self)
        form = QFormLayout(page)

        self.ingredient_search = IngredientSearchField(self.ctx, parent=page)
        self._picked_ingredient_id: int | None = None
        self._picked_label = QLabel("(aucun ingrédient sélectionné)", page)
        self.ingredient_search.ingredient_picked.connect(self._on_ingredient_picked)

        self.qty_field = QuantityField(page, default_grams=80.0, decimals=1)

        form.addRow("Rechercher :", self.ingredient_search)
        form.addRow("Sélectionné :", self._picked_label)
        form.addRow("Quantité :", self.qty_field)
        return page

    def _on_ingredient_picked(self, ingredient_id: int) -> None:
        self._picked_ingredient_id = ingredient_id
        with self.ctx.session() as s:
            from app.data.repositories import IngredientRepo

            ing = IngredientRepo(s).get(ingredient_id)
        self._picked_label.setText(ing.name if ing else f"#{ingredient_id}")

    def _accept(self) -> None:
        idx = self._tabs.currentIndex()
        if idx == 0:  # recipe
            recipe_id = self.recipe_combo.currentData()
            if recipe_id is None:
                self.reject()
                return
            self.result = ("recipe", int(recipe_id), float(self.portions_spin.value()))
        else:  # ingredient
            if self._picked_ingredient_id is None:
                # Nothing selected, just close as cancel.
                self.reject()
                return
            self.result = (
                "ingredient",
                int(self._picked_ingredient_id),
                float(self.qty_field.grams_value()),
            )
        self.accept()
