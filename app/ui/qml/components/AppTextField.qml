// Champ de texte stylé. Bordure fine, focus glow, placeholder grisé.

import QtQuick
import QtQuick.Controls
import App

TextField {
    id: root

    // Largeur de référence : 200 par défaut, jamais en dessous de 120 pour rester
    // lisible. Les pages peuvent surcharger avec Layout.preferredWidth ou
    // Layout.maximumWidth pour cadrer le champ dans leur grille.
    implicitWidth: 200
    implicitHeight: Theme.controlHeightMd
    leftPadding: Theme.spaceMd
    rightPadding: Theme.spaceMd
    selectByMouse: true

    color: enabled ? Theme.colorText : Theme.colorTextDisabled
    placeholderTextColor: Theme.colorTextPlaceholder
    selectionColor: Qt.alpha(Theme.colorPrimary, 0.35)
    selectedTextColor: Theme.colorText

    font.family: Theme.fontFamily
    font.pixelSize: Theme.fontSizeMd
    font.weight: Theme.fontWeightRegular

    background: Rectangle {
        radius: Theme.radiusMd
        color: !root.enabled ? Theme.colorSurfaceHover : Theme.colorSurface
        border.width: 1
        border.color: !root.enabled
                      ? Theme.colorBorder
                      : root.activeFocus
                        ? Theme.colorBorderFocus
                        : root.hovered
                          ? Theme.colorBorderHover
                          : Theme.colorBorder

        Behavior on border.color {
            ColorAnimation { duration: Theme.durationFast; easing.type: Theme.easingStandard }
        }

        // Glow subtil au focus (anneau externe)
        Rectangle {
            anchors.fill: parent
            anchors.margins: -3
            radius: parent.radius + 3
            color: "transparent"
            border.width: 2
            border.color: Theme.colorBorderFocus
            visible: root.activeFocus
            opacity: 0.18
        }
    }
}
