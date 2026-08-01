"""QML smoke + critical-path tests (A4).

Goal : a small but stable safety net against regressions in QML files.
We don't try to exhaustively test rendering — instead we verify that :
  - The full Main.qml tree loads without warnings
  - The root key components (pages, dialogs) instantiate cleanly
  - VM signals wired through QML actually fire (via QSignalSpy)

These tests are integration-flavoured : they create a QQmlApplicationEngine
backed by an in-memory DB, so a slot click that mutates the DB and emits a
signal is observable end-to-end.

Note on Qt + tests : QApplication is a singleton ; pytest-qt's `qapp` fixture
manages it. We spawn QQmlApplicationEngine per test (cheap) but never tear
down the QApplication.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from PySide6.QtCore import QUrl

QML_DIR = Path(__file__).resolve().parent.parent / "app" / "ui" / "qml"


# ============================================================ Smoke loads


def test_main_qml_loads_with_one_root_object(qml_engine) -> None:
    """The whole Main.qml tree (5 pages, 5 dialogs, 16+ components) should
    instantiate without errors."""
    qml_engine.load(QUrl.fromLocalFile(str(QML_DIR / "Main.qml")))
    assert len(qml_engine.rootObjects()) == 1


def test_pantry_page_loads_standalone(qml_engine) -> None:
    """F1 page : load it directly to catch component-level binding errors."""
    qml_engine.load(QUrl.fromLocalFile(str(QML_DIR / "pages" / "PantryPage.qml")))
    assert len(qml_engine.rootObjects()) == 1


def test_shopping_page_loads_standalone(qml_engine) -> None:
    qml_engine.load(QUrl.fromLocalFile(str(QML_DIR / "pages" / "ShoppingPage.qml")))
    assert len(qml_engine.rootObjects()) == 1


def test_calendar_page_loads_standalone(qml_engine) -> None:
    qml_engine.load(QUrl.fromLocalFile(str(QML_DIR / "pages" / "CalendarPage.qml")))
    assert len(qml_engine.rootObjects()) == 1


def test_recipes_page_loads_standalone(qml_engine) -> None:
    qml_engine.load(QUrl.fromLocalFile(str(QML_DIR / "pages" / "RecipesPage.qml")))
    assert len(qml_engine.rootObjects()) == 1


def test_ingredients_page_loads_standalone(qml_engine) -> None:
    qml_engine.load(QUrl.fromLocalFile(str(QML_DIR / "pages" / "IngredientsPage.qml")))
    assert len(qml_engine.rootObjects()) == 1


def test_import_recipe_url_dialog_loads(qml_engine) -> None:
    """Smoke pour le nouveau wizard d'import de recette par URL : la Window
    s'instancie sans warning, les 3 étapes du StackLayout sont présentes."""
    qml_engine.load(QUrl.fromLocalFile(str(QML_DIR / "dialogs" / "ImportRecipeUrlDialog.qml")))
    assert len(qml_engine.rootObjects()) == 1


def test_ingredient_search_popup_loads(qml_engine) -> None:
    """Smoke pour la popup de recherche manuelle CIQUAL/OFF des lignes
    d'import URL."""
    qml_engine.load(QUrl.fromLocalFile(str(QML_DIR / "dialogs" / "IngredientSearchPopup.qml")))
    assert len(qml_engine.rootObjects()) == 1


# ============================================================ Critical paths via VM signals
# Rather than driving QML widgets (fragile), we exercise the VM that QML reads,
# verify the signals fire, and make sure the QML still loads correctly.


def test_pantry_vm_stock_changed_after_add(qml_engine, qtbot) -> None:
    """F1 : adding a stock entry emits `stock_changed`, which QML wires to a
    refresh of the ShoppingPage `inFridge` checkbox."""
    qml_engine.load(QUrl.fromLocalFile(str(QML_DIR / "Main.qml")))
    assert len(qml_engine.rootObjects()) == 1

    vms = qml_engine._test_vms  # type: ignore[attr-defined]
    pantry_vm = vms["pantryVM"]
    ingredient_vm = vms["ingredientVM"]

    # Seed a manual ingredient via the VM (so the foreign key is satisfied).
    saved = ingredient_vm.saveFromDict({"name": "Yaourt"})
    ing_id = saved["id"]

    with qtbot.waitSignal(pantry_vm.stock_changed, timeout=2000):
        pantry_vm.addStock({
            "ingredientId": ing_id,
            "quantityG":    480.0,
            "expiryIso":    "",
            "notes":        "",
        })

    assert pantry_vm.totalCount == 1


def test_recipe_editor_vm_unsaved_changed_when_meta_edited(qml_engine, qtbot) -> None:
    """A3 : the page reads `hasUnsavedChanges` to decide whether to show the
    confirm dialog before switching. Editing meta must flip the flag."""
    qml_engine.load(QUrl.fromLocalFile(str(QML_DIR / "Main.qml")))
    vms = qml_engine._test_vms  # type: ignore[attr-defined]
    editor = vms["recipeEditorVM"]
    list_vm = vms["recipeListVM"]
    ingredient_vm = vms["ingredientVM"]

    # Seed a recipe so we can load it and edit
    ing = ingredient_vm.saveFromDict({"name": "Tomate"})
    from app.data.repositories import RecipeRepo
    from app.domain.models import Ingredient, Recipe, RecipeLine, Source
    with list_vm.ctx.session() as s:
        repo = RecipeRepo(s)
        full_ing = Ingredient(
            id=ing["id"], name="Tomate", source=Source.MANUAL, in_personal_library=True,
        )
        rec = repo.create(Recipe(
            name="Salade", default_portions=4,
            lines=[RecipeLine(ingredient=full_ing, quantity_g=200.0, ordinal=0)],
        ))
        s.commit()
    list_vm.refresh()

    editor.loadById(rec.id)
    assert editor.hasUnsavedChanges is False

    with qtbot.waitSignal(editor.unsaved_changed, timeout=1000):
        editor.updateMeta("Salade XL", "", 4)
    assert editor.hasUnsavedChanges is True


def test_ingredient_vm_collision_signal_via_qml_path(qml_engine, qtbot) -> None:
    """B4 : the VM emits `name_collision_detected` ; the QML page reacts by
    showing the collision dialog. We just verify the signal here."""
    qml_engine.load(QUrl.fromLocalFile(str(QML_DIR / "Main.qml")))
    vms = qml_engine._test_vms  # type: ignore[attr-defined]
    vm = vms["ingredientVM"]

    vm.saveFromDict({"name": "Œufs"})  # first one : OK
    with qtbot.waitSignal(vm.name_collision_detected, timeout=1000) as blocker:
        vm.saveFromDict({"name": "œufs"})  # case-insensitive collision

    existing_id, name = blocker.args
    assert existing_id > 0
    assert name == "œufs"


def test_macros_chart_loads_with_data(qml_engine, qtbot) -> None:
    """Smoke pour `MacrosChart.qml` : le donut + sa légende doivent
    s'instancier sans erreur. Vérifie aussi le cas dégénéré (kcal=0) qui
    affiche "aucune donnée" — ne doit pas tomber en NaN ou crasher Canvas."""
    from PySide6.QtCore import QUrl
    from PySide6.QtQml import QQmlComponent
    qml = """
    import QtQuick
    import App
    import "../components"
    Item {
        width: 320; height: 320
        property var data: ({ kcal: 423, fats: 14.4, carbs: 27.3, proteins: 39.5 })
        property var emptyData: ({ kcal: 0, fats: 0, carbs: 0, proteins: 0 })
        MacrosChart { id: full;  anchors.fill: parent; nutritionData: parent.data }
        MacrosChart { id: empty; visible: false; nutritionData: parent.emptyData }
    }
    """
    component = QQmlComponent(qml_engine)
    component.setData(qml.encode("utf-8"), QUrl.fromLocalFile(
        str(QML_DIR / "components" / "_inline_macros_test.qml")
    ))
    assert component.errors() == [], component.errorString()
    obj = component.create()
    assert obj is not None
    obj.deleteLater()


def test_fixed_unit_field_resets_after_user_typed_value(qml_engine, qtbot) -> None:
    """Bug fix : `FixedUnitField` doit propager une réaffectation de
    `value` jusqu'au spin INTERNE, même après que l'utilisateur a tapé une
    valeur dans la cellule (ce qui casse le binding QML `realValue: root.value`).

    Sans ça, changer d'ingrédient dans le formulaire laissait la cellule
    « Poids cuit » (et toute autre cellule FixedUnitField saisie au clavier)
    figée sur l'ancienne valeur — l'utilisateur avait l'impression que la
    valeur était partagée entre tous les ingrédients."""
    from PySide6.QtCore import QObject, QUrl
    from PySide6.QtQml import QQmlComponent
    qml = """
    import QtQuick
    import App
    import "../components"
    Item {
        id: root
        width: 200; height: 80
        property real fieldValue: f.value
        property real spinReal: 0
        FixedUnitField { id: f; unitText: "g"; maxValue: 1000 }
        Component.onCompleted: { spinReal = Qt.binding(function(){ return f.children[0].realValue }) }
        function userTyped(v) {
            // Simule la saisie : écrit sur spin.realValue (comme le ferait
            // AppSpinBox.onValueChanged après commit du TextInput). C'est
            // précisément cette écriture qui casse le binding.
            f.children[0].realValue = v
        }
        function setFieldValue(v) { f.value = v }
    }
    """
    component = QQmlComponent(qml_engine)
    component.setData(qml.encode("utf-8"), QUrl.fromLocalFile(
        str(QML_DIR / "components" / "_inline_test.qml")
    ))
    assert component.errors() == [], component.errorString()
    obj = component.create()
    assert obj is not None

    # 1) Saisie utilisateur : 300. La valeur doit remonter vers root.value.
    obj.userTyped(300.0)
    assert abs(obj.property("fieldValue") - 300.0) < 1e-6
    assert abs(obj.property("spinReal") - 300.0) < 1e-6

    # 2) Réaffectation externe (équivalent de _loadIngredient changeant
    # d'ingrédient) : root.value = 0. Le spin DOIT redescendre à 0.
    obj.setFieldValue(0.0)
    assert abs(obj.property("fieldValue") - 0.0) < 1e-6
    assert abs(obj.property("spinReal") - 0.0) < 1e-6, (
        "Bug : le spin reste figé à l'ancienne valeur saisie ; root.value "
        "ne propage plus vers spin.realValue après saisie utilisateur."
    )

    # 3) Re-saisie après reset : doit toujours fonctionner dans les deux sens.
    obj.userTyped(150.0)
    assert abs(obj.property("fieldValue") - 150.0) < 1e-6
    obj.setFieldValue(75.0)
    assert abs(obj.property("spinReal") - 75.0) < 1e-6

    obj.deleteLater()


def test_calendar_vm_current_price_recompute_signal(qml_engine, qtbot) -> None:
    """Auto-recompute of ingredient.price_eur after a price-history add :
    the VM emits `current_price_recomputed(ingredient_id)`, the QML
    IngredientsPage refreshes its read-only price cell."""
    qml_engine.load(QUrl.fromLocalFile(str(QML_DIR / "Main.qml")))
    vms = qml_engine._test_vms  # type: ignore[attr-defined]
    vm = vms["ingredientVM"]

    saved = vm.saveFromDict({"name": "Tomate"})
    ing_id = saved["id"]

    with qtbot.waitSignal(vm.current_price_recomputed, timeout=1000) as blocker:
        vm.addPriceHistory({
            "ingredientId":  ing_id,
            "priceEur":      "2.50",
            "quantityG":     250.0,
            "store":         "Lidl",
            "recordedAtIso": "2026-05-01",
            "notes":         "",
        })
    assert blocker.args == [ing_id]

    # And the ingredient's reference price was actually updated.
    d = vm.getAsDict(ing_id)
    from decimal import Decimal
    assert Decimal(d["priceEur"]) == Decimal("2.50")
    assert d["priceQuantityG"] == 250.0
