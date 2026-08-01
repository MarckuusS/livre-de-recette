// Bloc tags de l'éditeur de recette (F4 + A7).
//
// Affiche le set de tous les tags disponibles sous forme de chips à toggle.
// Chaque chip est colorée selon `colorHex` du tag : foncée (sélectionnée)
// quand elle est attachée à la recette courante, claire (non sélectionnée)
// sinon. Clic = toggle l'attachement (slot `recipeEditorVM.toggleTag`).
//
// Inputs (set par le parent — pas de Connections internes pour rester
// stateless et testable hors page) :
//   - `allTags: var`     — tableau de { id, name, colorHex } (= tagVM.listAll())
//   - `currentTags: var` — tableau de { id, name, colorHex } (= recipeEditorVM.currentTags())
//
// Le parent rebind ces deux tableaux via les signaux loaded / tags_changed.

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import App

ColumnLayout {
    id: root

    property var allTags: []
    property var currentTags: []

    spacing: Theme.spaceXs

    Text {
        text: "Tags :"
        color: Theme.colorText
        font.family: Theme.fontFamily
        font.pixelSize: Theme.fontSizeMd
        font.weight: Theme.fontWeightMedium
    }

    Flow {
        Layout.fillWidth: true
        spacing: Theme.spaceXs

        Repeater {
            model: root.allTags
            delegate: Rectangle {
                property bool isAttached: root.currentTags.some(function(t) {
                    return t.id === modelData.id
                })
                radius: Theme.radiusFull
                height: 26
                width: tagText.implicitWidth + Theme.spaceMd * 2
                color: isAttached
                       ? modelData.colorHex
                       : Qt.alpha(modelData.colorHex, 0.15)
                border.width: 1
                border.color: isAttached
                              ? modelData.colorHex
                              : Qt.alpha(modelData.colorHex, 0.4)

                Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                Behavior on border.color { ColorAnimation { duration: Theme.durationFast } }

                Text {
                    id: tagText
                    anchors.centerIn: parent
                    text: modelData.name
                    color: parent.isAttached ? "white" : modelData.colorHex
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                    font.weight: Theme.fontWeightSemiBold
                }

                MouseArea {
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: recipeEditorVM.toggleTag(modelData.id)
                }
            }
        }
    }
}
