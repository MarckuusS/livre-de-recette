// Popup non-modal léger (menus, suggestions). Pour les dialogues confirmation,
// préférer AppDialog. Pour les popups d'autocomplete, ce fichier suffit.

import QtQuick
import QtQuick.Controls
import App

Popup {
    id: root

    padding: Theme.spaceXs
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutsideParent

    enter: Transition {
        ParallelAnimation {
            NumberAnimation { property: "opacity"; from: 0.0; to: 1.0; duration: Theme.durationFast; easing.type: Theme.easingEnter }
            NumberAnimation { property: "y";       from: root.y - 4; to: root.y; duration: Theme.durationFast; easing.type: Theme.easingEnter }
        }
    }
    exit: Transition {
        NumberAnimation { property: "opacity"; from: 1.0; to: 0.0; duration: Theme.durationFast; easing.type: Theme.easingExit }
    }

    background: Rectangle {
        radius: Theme.radiusMd
        color: Theme.colorSurface
        border.width: 1
        border.color: Theme.colorBorder

        // Ombre normale empilée
        Rectangle {
            z: -2
            anchors.fill: parent
            anchors.margins: -6
            radius: parent.radius + 6
            color: Qt.alpha(Theme.shadowColor, Theme.shadowOpacityNormal * 0.5)
        }
        Rectangle {
            z: -1
            anchors.fill: parent
            anchors.margins: -2
            radius: parent.radius + 2
            color: Qt.alpha(Theme.shadowColor, Theme.shadowOpacityNormal * 0.85)
        }
    }
}
