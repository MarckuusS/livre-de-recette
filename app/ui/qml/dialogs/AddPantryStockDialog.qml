// Dialog d'ajout de stock au Frigo / Cellier (F1).
//
// Vraie fenêtre système (Window) — détachable, non-modale. Champs :
//   - Picker d'ingrédient (IngredientSearch — filtré sur la bibliothèque personnelle)
//   - Quantité (QuantityField — piece-aware si l'ingrédient a un piece_weight_g)
//   - Date de péremption (date field + DatePickerPopup, optionnel)
//   - Notes (optionnel)
//
// Émet `submitted({ ingredientId, quantityG, expiryIso, notes })` au clic Enregistrer.
// Le parent (PantryPage) appelle alors `pantryVM.addStock(payload)`.

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Window {
    id: root

    title: "Ajouter au stock"
    width: 580
    minimumWidth: 480
    height: 360
    minimumHeight: 320
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
                     | Qt.WindowMinMaxButtonsHint
    modality: Qt.NonModal

    // ---- API ----
    signal submitted(var payload)

    // État interne du picker
    property int _ingredientId: -1
    property string _ingredientName: ""
    property real _ingredientPieceWeight: 0

    function openCentered(parentWindow) {
        // Reset
        ingPicker.clear()
        root._ingredientId = -1
        root._ingredientName = ""
        root._ingredientPieceWeight = 0
        qtyField.grams = 0
        dateField.text = ""
        notesField.text = ""

        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        show()
        raise()
    }

    // ============================================================ Layout
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        Text {
            text: "Ajouter un article au frigo"
            color: Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXl
            font.weight: Theme.fontWeightSemiBold
        }

        GridLayout {
            Layout.fillWidth: true
            columns: 2
            rowSpacing: Theme.spaceSm
            columnSpacing: Theme.spaceMd

            // ---- Ingrédient ----
            Text {
                text: "Ingrédient :"
                color: Theme.colorText
                Layout.alignment: Qt.AlignRight | Qt.AlignTop
                Layout.topMargin: 8
            }
            IngredientSearch {
                id: ingPicker
                Layout.fillWidth: true
                Layout.maximumWidth: 380
                placeholderText: "Tape pour chercher dans ta bibliothèque…"
                onIngredientPicked: function(id, name) {
                    root._ingredientId = id
                    root._ingredientName = name
                    // Look up the piece weight from the VM so QuantityField shows
                    // a "pièce" unit when relevant (eggs, onions, garlic).
                    const d = ingredientVM ? ingredientVM.getAsDict(id) : {}
                    const pw = d && d.pieceWeightG ? d.pieceWeightG : 0
                    root._ingredientPieceWeight = pw
                    qtyField.pieceWeightG = pw
                }
            }

            // ---- Quantité ----
            Text {
                text: "Quantité :"
                color: Theme.colorText
                Layout.alignment: Qt.AlignRight
            }
            QuantityField {
                id: qtyField
                Layout.fillWidth: true
                Layout.maximumWidth: 320
                decimals: 1
            }

            // ---- Date de péremption (optionnel) ----
            Text {
                text: "Périme le :"
                color: Theme.colorText
                Layout.alignment: Qt.AlignRight
            }
            RowLayout {
                Layout.fillWidth: true
                spacing: 2
                AppTextField {
                    id: dateField
                    Layout.fillWidth: true
                    Layout.maximumWidth: 200
                    placeholderText: "YYYY-MM-DD (optionnel)"
                }
                Rectangle {
                    Layout.preferredWidth: 32
                    Layout.preferredHeight: dateField.height
                    radius: Theme.radiusSm
                    color: dateBtnMouse.containsMouse ? Theme.colorSurfaceHover : Theme.colorSurface
                    border.width: 1
                    border.color: dateBtnMouse.containsMouse ? Theme.colorBorderHover : Theme.colorBorder
                    Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                    Text {
                        anchors.centerIn: parent
                        text: "📅"
                        font.pixelSize: Theme.fontSizeMd
                    }
                    MouseArea {
                        id: dateBtnMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: datePicker.openAt(parent, dateField.text)
                    }
                }
                Item { Layout.fillWidth: true }
            }

            // ---- Notes (optionnel) ----
            Text {
                text: "Notes :"
                color: Theme.colorText
                Layout.alignment: Qt.AlignRight
            }
            AppTextField {
                id: notesField
                Layout.fillWidth: true
                Layout.maximumWidth: 380
                placeholderText: "Ex : promo Lidl, ouvert hier… (optionnel)"
            }
        }

        Item { Layout.fillHeight: true }   // spacer

        // ---- Footer ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceSm
            Item { Layout.fillWidth: true }
            AppButton {
                text: "Annuler"
                variant: "secondary"
                onClicked: root.close()
            }
            AppButton {
                text: "Enregistrer"
                variant: "primary"
                enabled: root._ingredientId > 0 && qtyField.grams > 0
                onClicked: {
                    root.submitted({
                        "ingredientId": root._ingredientId,
                        "quantityG":    qtyField.grams,
                        "expiryIso":    dateField.text.trim(),
                        "notes":        notesField.text.trim(),
                    })
                    root.close()
                }
            }
        }
    }

    // ============================================================ Mini-calendrier
    DatePickerPopup {
        id: datePicker
        onDateSelected: function(iso) { dateField.text = iso }
    }
}
