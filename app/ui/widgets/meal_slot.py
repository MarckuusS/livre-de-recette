"""One cell of the weekly calendar grid: lists the entries for (day, slot) and lets you add/remove."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from app.domain.models import MealPlanEntry, MealSlot
from app.ui.viewmodels.calendar_vm import CalendarViewModel


class MealSlotWidget(QFrame):
    """One slot (e.g. Monday morning). Shows entries + an 'Add' button."""

    add_requested = Signal(int, object)  # day_of_week, MealSlot

    def __init__(
        self,
        vm: CalendarViewModel,
        day_of_week: int,
        slot: MealSlot,
        parent: QWidget | None = None,
    ) -> None:
        super().__init__(parent)
        self.setFrameShape(QFrame.Shape.StyledPanel)
        self.vm = vm
        self.day = day_of_week
        self.slot = slot

        self.list_widget = QListWidget(self)
        self.list_widget.setUniformItemSizes(False)
        self.list_widget.itemDoubleClicked.connect(self._on_item_activated)

        self.add_button = QPushButton("+ Ajouter", self)
        self.add_button.clicked.connect(lambda: self.add_requested.emit(self.day, self.slot))

        layout = QVBoxLayout(self)
        layout.setContentsMargins(6, 6, 6, 6)
        layout.setSpacing(4)
        layout.addWidget(self.list_widget, 1)

        bottom = QHBoxLayout()
        bottom.addWidget(self.add_button)
        bottom.addStretch(1)
        layout.addLayout(bottom)

        self.refresh()

    def refresh(self) -> None:
        self.list_widget.clear()
        for entry in self.vm.entries_for(self.day, self.slot):
            description = self.vm.describe_entry(entry)
            item = QListWidgetItem(description)
            item.setData(Qt.ItemDataRole.UserRole, entry.id)
            item.setToolTip("Double-clic pour supprimer")
            self.list_widget.addItem(item)

    def _on_item_activated(self, item: QListWidgetItem) -> None:
        entry_id = item.data(Qt.ItemDataRole.UserRole)
        if entry_id is None:
            return
        from PySide6.QtWidgets import QMessageBox

        confirm = QMessageBox.question(
            self,
            "Retirer du planning",
            "Retirer cet élément du planning ?",
        )
        if confirm == QMessageBox.StandardButton.Yes:
            self.vm.remove(int(entry_id))


class DayHeader(QLabel):
    """Header for one column of the calendar (day name + day total)."""

    def __init__(self, name: str, parent: QWidget | None = None) -> None:
        super().__init__(name, parent)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setStyleSheet("font-weight: 600; padding: 4px;")


class SlotHeader(QLabel):
    """Header for one row (morning / noon / evening)."""

    def __init__(self, label: str, parent: QWidget | None = None) -> None:
        super().__init__(label, parent)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setStyleSheet("font-weight: 600; padding: 4px;")
