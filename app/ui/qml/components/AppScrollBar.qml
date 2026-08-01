// Barre de défilement fine, semi-transparente, fade-in au survol.

import QtQuick
import QtQuick.Controls
import App

ScrollBar {
    id: root

    implicitWidth: 10
    implicitHeight: 10
    minimumSize: 0.08
    padding: 2
    policy: ScrollBar.AsNeeded

    background: Rectangle {
        color: "transparent"
    }

    contentItem: Rectangle {
        implicitWidth: 6
        implicitHeight: 6
        radius: 4
        color: root.pressed
               ? Qt.alpha(Theme.colorTextSecondary, 0.65)
               : root.hovered || root.active
                 ? Qt.alpha(Theme.colorTextSecondary, 0.45)
                 : Qt.alpha(Theme.colorTextSecondary, 0.20)

        Behavior on color {
            ColorAnimation { duration: Theme.durationFast }
        }
    }
}
