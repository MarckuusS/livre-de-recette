"""Compact display of a NutritionTotal. Reused by Recipes editor and Calendar totals."""

from __future__ import annotations

from PySide6.QtWidgets import QFormLayout, QFrame, QLabel, QSizePolicy, QWidget

from app.domain.models import NutritionTotal


def _fmt_g(value: float) -> str:
    return f"{value:.1f} g"


def _fmt_kcal(value: float) -> str:
    return f"{value:.0f} kcal"


class NutritionPanel(QFrame):
    """Form-style display of macros."""

    def __init__(self, title: str = "Valeurs nutritionnelles", parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setFrameShape(QFrame.Shape.StyledPanel)
        # `Minimum` vertical policy: the panel never gets squeezed below its sizeHint.
        # Without this, a parent QFormLayout that runs out of space starts clipping
        # row content (the descender of "g" gets cut off and "0.0 g" reads "0.0 a").
        self.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Minimum)
        self._title = QLabel(title, self)
        self._title.setStyleSheet("font-weight: 600;")

        self._kcal = QLabel("—", self)
        self._proteins = QLabel("—", self)
        self._carbs = QLabel("—", self)
        self._sugars = QLabel("—", self)
        self._fats = QLabel("—", self)
        self._sat_fats = QLabel("—", self)
        self._fiber = QLabel("—", self)
        self._salt = QLabel("—", self)

        form = QFormLayout(self)
        form.addRow(self._title)
        form.addRow("Énergie :", self._kcal)
        form.addRow("Protéines :", self._proteins)
        form.addRow("Glucides :", self._carbs)
        form.addRow("  dont sucres :", self._sugars)
        form.addRow("Lipides :", self._fats)
        form.addRow("  dont saturés :", self._sat_fats)
        form.addRow("Fibres :", self._fiber)
        form.addRow("Sel :", self._salt)

    def set_total(self, total: NutritionTotal) -> None:
        self._kcal.setText(_fmt_kcal(total.kcal))
        self._proteins.setText(_fmt_g(total.proteins_g))
        self._carbs.setText(_fmt_g(total.carbs_g))
        self._sugars.setText(_fmt_g(total.sugars_g))
        self._fats.setText(_fmt_g(total.fats_g))
        self._sat_fats.setText(_fmt_g(total.saturated_fats_g))
        self._fiber.setText(_fmt_g(total.fiber_g))
        self._salt.setText(_fmt_g(total.salt_g))

    def clear(self) -> None:
        for lbl in (
            self._kcal,
            self._proteins,
            self._carbs,
            self._sugars,
            self._fats,
            self._sat_fats,
            self._fiber,
            self._salt,
        ):
            lbl.setText("—")
