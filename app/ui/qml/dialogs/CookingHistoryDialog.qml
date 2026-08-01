// Dialog d'historique de cuisson par recette (C2).
//
// Vraie fenêtre système (Window) — détachable, non-modale. Trois sections :
//   1. Formulaire d'ajout (date / note 1-5 / notes)
//   2. Tableau chronologique inverse — délégué avec ✕ pour supprimer
//   3. Stat globale en bas : "Cuisinée X fois au total"
//
// Le dialog appelle directement les slots `recipeEditorVM.cookingLogAsList`,
// `addCookingLog`, `deleteCookingLog`. La page parente rafraîchit son
// compteur "cuisinée X ce mois" via le signal `entryAdded` quand le user
// ajoute une entrée.

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Window {
    id: root

    title: "Journal de cuisson"
    width: 720
    height: 560
    minimumWidth: 580
    minimumHeight: 420
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
                     | Qt.WindowMinMaxButtonsHint
    modality: Qt.NonModal

    // ---- API ----
    property int recipeId: -1
    property string recipeName: ""

    signal entryAdded()

    ListModel { id: historyModel }

    function openFor(id, name, parentWindow) {
        recipeId = id
        recipeName = name || ""
        title = "Journal de cuisson · " + recipeName
        _refreshHistory()

        // Reset form
        const today = new Date().toISOString().slice(0, 10)
        dateField.text = today
        notesField.text = ""
        ratingSpin.realValue = 0

        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        show()
        raise()
        notesField.forceActiveFocus()
    }

    function _refreshHistory() {
        historyModel.clear()
        if (recipeId <= 0 || !recipeEditorVM) return
        const entries = recipeEditorVM.cookingLogAsList() || []
        for (let i = 0; i < entries.length; i++) historyModel.append(entries[i])
    }

    // ============================================================ Layout
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        Text {
            text: "Journal de cuisson · " + recipeName
            color: Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXl
            font.weight: Theme.fontWeightSemiBold
        }
        Text {
            text: historyModel.count === 0
                  ? "Aucune cuisson enregistrée."
                  : "Cuisinée " + historyModel.count + " fois au total."
            color: Theme.colorTextSecondary
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeSm
        }

        // ---- Formulaire d'ajout ----
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: addForm.implicitHeight + Theme.spaceMd * 2
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorBorder

            GridLayout {
                id: addForm
                anchors.fill: parent
                anchors.margins: Theme.spaceMd
                columns: 5
                rowSpacing: Theme.spaceSm
                columnSpacing: Theme.spaceMd

                Text { text: "Date";  color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs }
                Text { text: "Note (1-5, 0 = pas de note)"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs }
                Text { text: "Notes"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs; Layout.columnSpan: 2 }
                Item { Layout.preferredWidth: 110 }

                // Ligne champs
                RowLayout {
                    Layout.preferredWidth: 170
                    spacing: 2
                    AppTextField {
                        id: dateField
                        Layout.fillWidth: true
                        placeholderText: "YYYY-MM-DD"
                    }
                    Rectangle {
                        Layout.preferredWidth: 32
                        Layout.preferredHeight: dateField.height
                        radius: Theme.radiusSm
                        color: dateBtnMouse.containsMouse ? Theme.colorSurfaceHover : Theme.colorSurface
                        border.width: 1
                        border.color: dateBtnMouse.containsMouse ? Theme.colorBorderHover : Theme.colorBorder
                        Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                        Text { anchors.centerIn: parent; text: "📅"; font.pixelSize: Theme.fontSizeMd }
                        MouseArea {
                            id: dateBtnMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: datePicker.openAt(parent, dateField.text)
                        }
                    }
                }

                AppSpinBox {
                    id: ratingSpin
                    Layout.preferredWidth: 80
                    decimals: 0
                    realFrom: 0
                    realTo: 5
                    realStep: 1
                    realValue: 0
                    emptyOnZero: false
                }

                AppTextField {
                    id: notesField
                    Layout.fillWidth: true
                    Layout.columnSpan: 2
                    placeholderText: "Optionnel — ex : « plus de sel la prochaine fois »"
                }

                AppButton {
                    text: "+ Ajouter"
                    variant: "primary"
                    Layout.preferredWidth: 110
                    enabled: dateField.text.trim().length > 0
                    onClicked: root._submitNew()
                }
            }
        }

        // ---- Tableau ----
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorBorder

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Theme.spaceXs
                spacing: 0

                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 28
                    color: Theme.colorBackground
                    radius: Theme.radiusSm
                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: Theme.spaceMd
                        anchors.rightMargin: Theme.spaceMd
                        spacing: Theme.spaceMd
                        Text { Layout.preferredWidth: 110; text: "Date";  color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs; font.weight: Theme.fontWeightMedium }
                        Text { Layout.preferredWidth: 80;  text: "Note";  color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs; font.weight: Theme.fontWeightMedium }
                        Text { Layout.fillWidth: true;     text: "Notes"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs; font.weight: Theme.fontWeightMedium }
                        Text { Layout.preferredWidth: 40 }
                    }
                }

                ListView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    model: historyModel
                    spacing: 1
                    boundsBehavior: Flickable.StopAtBounds
                    ScrollBar.vertical: AppScrollBar { orientation: Qt.Vertical }

                    delegate: Rectangle {
                        width: ListView.view.width
                        height: 32
                        color: rowMouse.containsMouse ? Theme.colorSurfaceHover : Theme.colorTransparent

                        RowLayout {
                            anchors.fill: parent
                            anchors.leftMargin: Theme.spaceMd
                            anchors.rightMargin: Theme.spaceMd
                            spacing: Theme.spaceMd

                            Text {
                                Layout.preferredWidth: 110
                                text: model.cookedAtHuman
                                color: Theme.colorText
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                verticalAlignment: Text.AlignVCenter
                            }
                            Text {
                                Layout.preferredWidth: 80
                                text: model.rating > 0
                                      ? "★".repeat(model.rating) + "☆".repeat(5 - model.rating)
                                      : "—"
                                color: model.rating > 0 ? Theme.colorWarning : Theme.colorTextDisabled
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                verticalAlignment: Text.AlignVCenter
                            }
                            Text {
                                Layout.fillWidth: true
                                text: model.notes || ""
                                color: model.notes ? Theme.colorText : Theme.colorTextDisabled
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                elide: Text.ElideRight
                                verticalAlignment: Text.AlignVCenter
                            }
                            Text {
                                Layout.preferredWidth: 40
                                text: "✕"
                                color: deleteMouse.containsMouse ? Theme.colorError : Qt.alpha(Theme.colorTextSecondary, 0.55)
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeMd
                                horizontalAlignment: Text.AlignHCenter
                                verticalAlignment: Text.AlignVCenter
                                Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                                MouseArea {
                                    id: deleteMouse
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: {
                                        if (recipeEditorVM.deleteCookingLog(model.id)) {
                                            root._refreshHistory()
                                            root.entryAdded()  // notify parent to refresh stats
                                        }
                                    }
                                }
                            }
                        }
                        MouseArea {
                            id: rowMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            propagateComposedEvents: true
                            onClicked: function(m) { m.accepted = false }
                        }
                    }

                    Text {
                        anchors.centerIn: parent
                        visible: historyModel.count === 0
                        text: "Aucune cuisson enregistrée. Ajoute la première !"
                        color: Theme.colorTextDisabled
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeMd
                    }
                }
            }
        }

        // ---- Footer ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceSm
            Item { Layout.fillWidth: true }
            AppButton { text: "Fermer"; variant: "secondary"; onClicked: root.close() }
        }
    }

    DatePickerPopup {
        id: datePicker
        onDateSelected: function(iso) { dateField.text = iso }
    }

    function _submitNew() {
        const payload = {
            "cookedAtIso": dateField.text.trim(),
            "rating":      ratingSpin.realValue,
            "notes":       notesField.text,
        }
        const saved = recipeEditorVM.addCookingLog(payload)
        if (saved && saved.id) {
            notesField.text = ""
            ratingSpin.realValue = 0
            _refreshHistory()
            root.entryAdded()
            notesField.forceActiveFocus()
        }
    }
}
