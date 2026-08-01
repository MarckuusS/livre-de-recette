// Bouton stylé Theme-aware. 3 variantes via property `variant`.
//
//   AppButton { text: "Enregistrer"; variant: "primary"; onClicked: ... }
//   AppButton { text: "Annuler";    variant: "secondary" }
//   AppButton { text: "Plus";       variant: "ghost" }

import QtQuick
import QtQuick.Controls
import App

Button {
    id: root

    // "primary"   = couleur de fond pleine + texte blanc
    // "secondary" = bordure + fond surface + texte primary
    // "ghost"     = pas de fond ni bordure, juste texte (style lien)
    // "danger"    = ghost en rouge (utilisé pour les actions destructrices ✕ retirer)
    // "success"   = couleur de fond verte pleine + texte blanc — utilisé pour
    //               afficher un feedback "✓ Enregistré" temporaire après une
    //               action réussie. Bascule revenir à `primary` après ~1.5s.
    property string variant: "primary"

    implicitHeight: Theme.controlHeightMd
    implicitWidth: Math.max(80, contentItem.implicitWidth + Theme.spaceLg * 2)

    leftPadding: Theme.spaceLg
    rightPadding: Theme.spaceLg

    hoverEnabled: true

    contentItem: Text {
        text: root.text
        color: !root.enabled
               ? Theme.colorTextDisabled
               : root.variant === "primary"
                 ? Theme.colorOnPrimary
                 : root.variant === "success"
                   ? Theme.colorOnPrimary   // texte blanc sur fond vert
                   : root.variant === "danger"
                     ? Theme.colorError
                     : Theme.colorPrimary // secondary, ghost
        font.family: Theme.fontFamily
        font.pixelSize: Theme.fontSizeMd
        font.weight: Theme.fontWeightMedium
        horizontalAlignment: Text.AlignHCenter
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight

        Behavior on color {
            ColorAnimation { duration: Theme.durationFast; easing.type: Theme.easingStandard }
        }
    }

    background: Rectangle {
        id: bg
        radius: Theme.radiusMd
        border.width: root.variant === "secondary" ? 1 : 0
        border.color: !root.enabled
                      ? Theme.colorBorder
                      : root.hovered
                        ? Theme.colorBorderHover
                        : Theme.colorBorder

        color: !root.enabled
               ? (root.variant === "primary" || root.variant === "success"
                  ? Theme.colorPrimaryDisabled
                  : Theme.colorTransparent)
               : root.variant === "primary"
                 ? (root.pressed ? Theme.colorPrimaryPressed
                                 : root.hovered ? Theme.colorPrimaryHover
                                                : Theme.colorPrimary)
                 : root.variant === "success"
                   ? (root.pressed ? Qt.darker(Theme.colorSuccess, 1.15)
                                   : root.hovered ? Qt.lighter(Theme.colorSuccess, 1.08)
                                                  : Theme.colorSuccess)
                 : root.variant === "danger"
                   ? (root.pressed ? Qt.alpha(Theme.colorError, 0.20)
                                   : root.hovered ? Qt.alpha(Theme.colorError, 0.10)
                                                  : Theme.colorTransparent)
                 : root.variant === "secondary"
                   ? (root.pressed ? Theme.colorSurfacePressed
                                   : root.hovered ? Theme.colorSurfaceHover
                                                  : Theme.colorSurface)
                   : (root.pressed ? Theme.colorSurfacePressed
                                   : root.hovered ? Theme.colorSurfaceHover
                                                  : Theme.colorTransparent) // ghost

        Behavior on color {
            ColorAnimation { duration: Theme.durationFast; easing.type: Theme.easingStandard }
        }
        Behavior on border.color {
            ColorAnimation { duration: Theme.durationFast; easing.type: Theme.easingStandard }
        }

        // Anneau de focus clavier (visible sans souris seulement)
        Rectangle {
            anchors.fill: parent
            anchors.margins: -3
            radius: parent.radius + 3
            color: "transparent"
            border.width: 2
            border.color: Theme.colorBorderFocus
            visible: root.activeFocus && !root.pressed
            opacity: 0.4
        }
    }
}
