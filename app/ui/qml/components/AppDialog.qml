// Dialogue modal avec fond assombri, ombre portée, animation fade+scale.
// Utilisable comme : AppDialog { title: "..."; standardButtons: Dialog.Ok | Dialog.Cancel; ... }

import QtQuick
import QtQuick.Controls
import App

Dialog {
    id: root

    modal: true
    anchors.centerIn: parent
    padding: Theme.spaceXl

    font.family: Theme.fontFamily
    font.pixelSize: Theme.fontSizeMd

    // ---- Fond assombri (Overlay) ----
    Overlay.modal: Rectangle {
        color: Theme.colorOverlay
        Behavior on opacity { NumberAnimation { duration: Theme.durationNormal } }
    }

    // ---- Animation d'apparition ----
    enter: Transition {
        ParallelAnimation {
            NumberAnimation { property: "opacity"; from: 0.0; to: 1.0; duration: Theme.durationNormal; easing.type: Theme.easingEnter }
            NumberAnimation { property: "scale";   from: 0.94; to: 1.0; duration: Theme.durationNormal; easing.type: Theme.easingEnter }
        }
    }
    exit: Transition {
        ParallelAnimation {
            NumberAnimation { property: "opacity"; from: 1.0; to: 0.0; duration: Theme.durationFast; easing.type: Theme.easingExit }
            NumberAnimation { property: "scale";   from: 1.0; to: 0.96; duration: Theme.durationFast; easing.type: Theme.easingExit }
        }
    }

    // ---- En-tête : titre stylé ----
    header: Item {
        visible: root.title !== ""
        implicitHeight: visible ? titleLabel.implicitHeight + Theme.spaceXl : 0
        Text {
            id: titleLabel
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.leftMargin: Theme.spaceXl
            anchors.rightMargin: Theme.spaceXl
            anchors.topMargin: Theme.spaceLg
            text: root.title
            color: Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXl
            font.weight: Theme.fontWeightSemiBold
            elide: Text.ElideRight
        }
    }

    // ---- Fond + ombres empilées ----
    background: Rectangle {
        radius: Theme.radiusLg
        color: Theme.colorSurface
        border.width: 1
        border.color: Theme.colorBorder

        // Ombre élevée (3 couches concentriques)
        Rectangle {
            z: -3
            anchors.fill: parent
            anchors.margins: -16
            radius: parent.radius + 16
            color: Qt.alpha(Theme.shadowColor, Theme.shadowOpacityElevated * 0.35)
        }
        Rectangle {
            z: -2
            anchors.fill: parent
            anchors.margins: -8
            radius: parent.radius + 8
            color: Qt.alpha(Theme.shadowColor, Theme.shadowOpacityElevated * 0.55)
        }
        Rectangle {
            z: -1
            anchors.fill: parent
            anchors.margins: -3
            radius: parent.radius + 3
            color: Qt.alpha(Theme.shadowColor, Theme.shadowOpacityElevated * 0.75)
        }
    }
}
