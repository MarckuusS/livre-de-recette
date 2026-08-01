// Bouton d'onglet stylé Theme. Sélection = barre primary 2px en bas + texte
// primary, hover = fond surfaceHover discret, repos = texte secondary.
// Remplace la TabButton native (style "Basic") qui rend en noir plein.
//
// Refonte UX : ajout d'une `DropArea` magnétique. Quand on drag un ingrédient
// depuis IngredientsPage et qu'on survole un onglet, après ~300 ms l'onglet
// s'auto-sélectionne (façon macOS Mission Control / dock). L'utilisateur peut
// ensuite drop sur la liste de la page cible. Le drop final n'arrive PAS sur
// le bouton lui-même — la DropArea ne fait que switcher d'onglet.

import QtQuick
import QtQuick.Controls
import App

TabButton {
    id: root

    implicitHeight: 40
    implicitWidth: Math.max(120, contentItem.implicitWidth + Theme.spaceLg * 2)
    leftPadding: Theme.spaceLg
    rightPadding: Theme.spaceLg

    // Index de cet onglet dans la TabBar parent — utilisé par le DnD pour
    // appeler `tabBar.currentIndex = root.tabIndex`. Calculé dynamiquement.
    readonly property int tabIndex: TabBar.index

    contentItem: Text {
        text: root.text
        color: !root.enabled
               ? Theme.colorTextDisabled
               : root.checked
                 ? Theme.colorPrimary
                 : root.hovered
                   ? Theme.colorText
                   : Theme.colorTextSecondary
        font.family: Theme.fontFamily
        font.pixelSize: Theme.fontSizeMd
        font.weight: root.checked ? Theme.fontWeightSemiBold : Theme.fontWeightMedium
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
        Behavior on color {
            ColorAnimation { duration: Theme.durationFast; easing.type: Theme.easingStandard }
        }
    }

    background: Rectangle {
        color: root.checked
               ? Qt.alpha(Theme.colorPrimary, 0.06)
               : (dropArea.containsDrag
                  ? Qt.alpha(Theme.colorPrimary, 0.20)
                  : root.hovered
                    ? Theme.colorSurfaceHover
                    : Theme.colorTransparent)
        radius: 0

        Behavior on color {
            ColorAnimation { duration: Theme.durationFast; easing.type: Theme.easingStandard }
        }

        // Indicateur de sélection : barre primary 2px en bas
        Rectangle {
            anchors.bottom: parent.bottom
            anchors.left: parent.left
            anchors.right: parent.right
            height: 2
            color: Theme.colorPrimary
            visible: root.checked
        }

        // Indicateur de drag-hover : bordure primary 2px en haut, animée
        Rectangle {
            anchors.top: parent.top
            anchors.left: parent.left
            anchors.right: parent.right
            height: 2
            color: Theme.colorPrimary
            visible: dropArea.containsDrag && !root.checked
        }
    }

    // DropArea magnétique : auto-switch sur l'onglet après 300 ms de survol
    // pendant un drag. Pas de `onDropped` — le drop final est géré par la
    // page cible (PantryPage par exemple).
    DropArea {
        id: dropArea
        anchors.fill: parent

        Timer {
            id: switchTimer
            interval: 300
            repeat: false
            onTriggered: {
                // Switch l'onglet seulement si on est toujours en drag-hover
                if (dropArea.containsDrag && root.parent && root.parent.currentIndex !== undefined) {
                    root.parent.currentIndex = root.tabIndex
                }
            }
        }

        onContainsDragChanged: {
            if (containsDrag) {
                switchTimer.start()
            } else {
                switchTimer.stop()
            }
        }
    }
}
