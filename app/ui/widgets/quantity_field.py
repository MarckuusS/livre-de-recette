"""Quantity input widget = numeric spinbox + unit selector.

The widget exposes its value as **grams** (the storage convention) regardless of
the unit the user selected. Switching unit converts the displayed value in place
so the underlying gram amount stays the same: 1000 g → switch to kg → reads 1 kg.

Public API:
  - `value_grams_changed(float)` : signal emitted whenever the underlying gram
                                   amount changes (typing). NOT emitted on unit
                                   switch alone — the amount is stable then.
  - `grams_value() -> float`    : current value in grams
  - `set_grams(grams, prefer_unit=None)` : set value (no signal)
  - `current_unit() -> str` / `set_unit(code)` : preserves grams
"""

from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QAbstractSpinBox,
    QComboBox,
    QDoubleSpinBox,
    QHBoxLayout,
    QWidget,
)

from app.domain.units import DEFAULT_UNIT_CODE, UNITS, from_grams, to_grams


class QuantityField(QWidget):
    value_grams_changed = Signal(float)

    def __init__(
        self,
        parent: QWidget | None = None,
        *,
        default_grams: float = 100.0,
        default_unit: str = DEFAULT_UNIT_CODE,
        max_grams: float = 1_000_000.0,
        decimals: int = 2,
    ) -> None:
        super().__init__(parent)
        self._suppress = False
        self._previous_unit_code: str = default_unit

        self._spin = QDoubleSpinBox(self)
        self._spin.setRange(0.0, max_grams)
        self._spin.setDecimals(decimals)
        self._spin.setSingleStep(1.0)
        self._spin.setButtonSymbols(QAbstractSpinBox.ButtonSymbols.NoButtons)
        self._spin.valueChanged.connect(self._on_spin_changed)

        self._unit = QComboBox(self)
        for u in UNITS:
            self._unit.addItem(u.label, u.code)
        self._unit.currentIndexChanged.connect(self._on_unit_changed)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(4)
        layout.addWidget(self._spin, 1)
        layout.addWidget(self._unit)

        self.set_grams(default_grams, prefer_unit=default_unit)

    # ------------------------------------------------------------------ public API

    def grams_value(self) -> float:
        return to_grams(self._spin.value(), self._current_unit_code())

    def set_grams(self, grams: float, *, prefer_unit: str | None = None) -> None:
        """Set the underlying gram value. Does NOT emit `value_grams_changed`."""
        self._suppress = True
        try:
            if prefer_unit is not None:
                self._set_unit_code(prefer_unit)
                self._previous_unit_code = prefer_unit
            unit = self._current_unit_code()
            self._spin.setValue(from_grams(grams, unit))
        finally:
            self._suppress = False

    def current_unit(self) -> str:
        return self._current_unit_code()

    def set_unit(self, unit_code: str) -> None:
        """Switch unit while preserving the underlying gram value."""
        if unit_code == self._current_unit_code():
            return
        self._set_unit_code(unit_code)  # triggers _on_unit_changed, which converts

    # ------------------------------------------------------------------ internals

    def _current_unit_code(self) -> str:
        code = self._unit.currentData()
        return code or DEFAULT_UNIT_CODE

    def _set_unit_code(self, unit_code: str) -> None:
        for i in range(self._unit.count()):
            if self._unit.itemData(i) == unit_code:
                self._unit.setCurrentIndex(i)
                return

    def _on_spin_changed(self, _value: float) -> None:
        if not self._suppress:
            self.value_grams_changed.emit(self.grams_value())

    def _on_unit_changed(self, _index: int) -> None:
        if self._suppress:
            return
        new_unit = self._current_unit_code()
        if new_unit == self._previous_unit_code:
            return
        # Preserve underlying grams: re-display the same physical amount in the new unit.
        # We compute grams from the OLD unit (before this change) and the spin value.
        grams = to_grams(self._spin.value(), self._previous_unit_code)
        self._suppress = True
        try:
            self._spin.setValue(from_grams(grams, new_unit))
        finally:
            self._suppress = False
        self._previous_unit_code = new_unit
        # No emit — gram amount is unchanged, this is a display-only change.
