"""Numeric field with an inert unit cell rendered to its right.

Two visually distinct widgets (the spinbox + a styled QLabel) — the user types
the value in the spinbox and the unit is just a label they can't edit. This is
the natural shape for "value + fixed unit" fields like macros (g/100g) or
filter ranges (kcal/100g) where switching unit makes no sense.

Behaviour notes:

- `setSpecialValueText("")` makes the spinbox **show empty** when its value is
  zero (the default). That's the convention we use throughout the app for
  "field not set" — having "—" or "0.0 g/100g" as the resting state was
  confusing to users (they read it as a value rather than as "empty").
- `clear()` resets to zero (i.e. empty display).
- `setButtonSymbols(NoButtons)` removes the up/down arrows everywhere — the
  user always types directly.
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QAbstractSpinBox,
    QDoubleSpinBox,
    QHBoxLayout,
    QLabel,
    QWidget,
)


class FixedUnitField(QWidget):
    """A QDoubleSpinBox + a fixed unit label rendered as an adjacent cell."""

    def __init__(
        self,
        parent: QWidget | None = None,
        *,
        unit_text: str,
        max_v: float = 1000.0,
        decimals: int = 2,
    ) -> None:
        super().__init__(parent)
        self._spin = QDoubleSpinBox(self)
        self._spin.setRange(0.0, max_v)
        self._spin.setDecimals(decimals)
        self._spin.setSingleStep(0.5)
        # Empty (instead of "—") at the resting zero value — matches what users
        # expect for an "unset" filter / nutrition field.
        self._spin.setSpecialValueText("")
        self._spin.setButtonSymbols(QAbstractSpinBox.ButtonSymbols.NoButtons)

        self._unit = QLabel(unit_text, self)
        self._unit.setObjectName("unitCell")
        self._unit.setAlignment(Qt.AlignmentFlag.AlignCenter)

        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        layout.addWidget(self._spin, 1)
        layout.addWidget(self._unit)

    # Match the plain QDoubleSpinBox surface — callers don't notice the wrapping.
    def value(self) -> float:
        return self._spin.value()

    def setValue(self, v: float) -> None:
        self._spin.setValue(v)

    def clear(self) -> None:
        """Reset to zero (which displays as empty thanks to specialValueText)."""
        self._spin.setValue(0.0)

    @property
    def valueChanged(self):  # bound signal — `field.valueChanged.connect(...)` works as expected
        return self._spin.valueChanged
