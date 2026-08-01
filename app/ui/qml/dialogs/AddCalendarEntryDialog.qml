// Dialogue d'ajout au calendrier : VRAIE FENÊTRE système (Window) — détachable.
// 2 onglets (Recette via combobox / Ingrédient via picker) + Quantité.
// Émet `accepted(targetDay, targetSlot, payload)` qui est consommé par CalendarPage.

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Window {
    id: root

    title: "Ajouter au calendrier"
    width: 540
    height: 380
    minimumWidth: 420
    minimumHeight: 320
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
    modality: Qt.NonModal

    property int targetDay: 0
    property string targetSlot: "morning"

    signal recipePicked(int dayOfWeek, string slot, int recipeId, real portions)
    signal ingredientPicked(int dayOfWeek, string slot, int ingredientId, real quantityG)

    function openFor(dayOfWeek, slot, parentWindow) {
        targetDay = dayOfWeek
        targetSlot = slot
        // Centre sur la fenêtre principale
        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        // Reset état
        recipeOptions.clear()
        if (typeof recipeListVM !== "undefined" && recipeListVM) {
            const items = recipeListVM.items
            for (let i = 0; i < items.rowCount(); i++) {
                const idx = items.index(i, 0)
                recipeOptions.append({
                    "text":  items.data(idx, items.Roles.name),
                    "value": items.data(idx, items.Roles.recipeId)
                })
            }
            if (recipeOptions.count > 0) recipeCombo.currentIndex = 0
        }
        _pickedIngId = -1
        _pickedIngName = ""
        pickedLabel.text = "(aucun)"
        ingPicker.clear()
        portionsSpin.realValue = 1.0
        ingQty.grams = 80
        show()
        raise()
    }

    property int _pickedIngId: -1
    property string _pickedIngName: ""

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        Text {
            text: "Ajouter au " + _slotLabel(root.targetSlot) + " — " + _dayLabel(root.targetDay)
            color: Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXl
            font.weight: Theme.fontWeightSemiBold
        }

        TabBar {
            id: addTabs
            Layout.fillWidth: true

            background: Rectangle {
                color: Theme.colorTransparent
                Rectangle {
                    anchors.bottom: parent.bottom
                    anchors.left: parent.left
                    anchors.right: parent.right
                    height: 1
                    color: Theme.colorBorder
                }
            }
            AppTabButton { text: "🍽 Recette"; width: 160 }
            AppTabButton { text: "🥕 Ingrédient"; width: 160 }
        }

        StackLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            currentIndex: addTabs.currentIndex

            // ---- Onglet Recette ----
            ColumnLayout {
                spacing: Theme.spaceMd

                ListModel { id: recipeOptions }

                AppComboBox {
                    id: recipeCombo
                    Layout.fillWidth: true
                    Layout.maximumWidth: 320
                    textRole: "text"
                    valueRole: "value"
                    model: recipeOptions
                }
                RowLayout {
                    Layout.fillWidth: true
                    Text { text: "Portions :"; color: Theme.colorText }
                    AppSpinBox {
                        id: portionsSpin
                        Layout.preferredWidth: 100
                        decimals: 2
                        realFrom: 0.25
                        realTo: 50
                        realStep: 0.5
                        realValue: 1.0
                    }
                    Item { Layout.fillWidth: true }
                }
                Item { Layout.fillHeight: true }
            }

            // ---- Onglet Ingrédient ----
            ColumnLayout {
                spacing: Theme.spaceMd

                IngredientSearch {
                    id: ingPicker
                    Layout.fillWidth: true
                    Layout.maximumWidth: 480
                    Layout.preferredHeight: implicitHeight
                    scope: "personal"
                    onIngredientPicked: function(id, name) {
                        root._pickedIngId = id
                        root._pickedIngName = name
                        pickedLabel.text = name
                        const d = ingredientVM.getAsDict(id)
                        ingQty.pieceWeightG = d.pieceWeightG || 0
                    }
                }
                RowLayout {
                    Layout.fillWidth: true
                    Text { text: "Sélectionné :"; color: Theme.colorText }
                    Text {
                        id: pickedLabel
                        Layout.fillWidth: true
                        text: "(aucun)"
                        color: Theme.colorTextSecondary
                        elide: Text.ElideRight
                    }
                }
                RowLayout {
                    Layout.fillWidth: true
                    Text { text: "Quantité :"; color: Theme.colorText }
                    QuantityField {
                        id: ingQty
                        Layout.fillWidth: true
                        Layout.maximumWidth: 320
                        grams: 80
                        decimals: 1
                    }
                }
                Item { Layout.fillHeight: true }
            }
        }

        // ---- Boutons OK / Annuler ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceMd
            Item { Layout.fillWidth: true }
            AppButton {
                text: "Annuler"
                variant: "secondary"
                onClicked: root.close()
            }
            AppButton {
                text: "Ajouter"
                variant: "primary"
                onClicked: root._accept()
            }
        }
    }

    function _accept() {
        if (addTabs.currentIndex === 0) {
            if (recipeCombo.currentValue !== undefined && recipeCombo.currentValue !== null) {
                root.recipePicked(root.targetDay, root.targetSlot,
                                  recipeCombo.currentValue, portionsSpin.realValue)
            }
        } else {
            if (root._pickedIngId > 0) {
                root.ingredientPicked(root.targetDay, root.targetSlot,
                                      root._pickedIngId, ingQty.grams)
            }
        }
        close()
    }

    function _dayLabel(d) {
        const labels = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
        return labels[d] || ""
    }
    function _slotLabel(s) {
        return s === "morning" ? "matin" : s === "noon" ? "midi" : "soir"
    }
}
