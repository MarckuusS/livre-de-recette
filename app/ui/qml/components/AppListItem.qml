// Délégué de ListView stylé. Hover, sélection, padding cohérents.
//
//   AppListItem {
//     selected: index === root.currentIndex
//     onClicked: root.currentIndex = index
//     content: Text { text: model.name; color: Theme.colorText }
//   }

import QtQuick
import QtQuick.Controls
import App

ItemDelegate {
    id: root

    property bool selected: false
    default property alias content: contentSlot.data

    implicitHeight: 40
    leftPadding: Theme.spaceMd
    rightPadding: Theme.spaceMd
    topPadding: Theme.spaceSm
    bottomPadding: Theme.spaceSm

    contentItem: Item {
        id: contentSlot
        implicitWidth: childrenRect.width
        implicitHeight: childrenRect.height
    }

    background: Rectangle {
        radius: Theme.radiusSm
        color: root.selected
               ? Qt.alpha(Theme.colorPrimary, 0.12)
               : root.pressed
                 ? Theme.colorSurfacePressed
                 : root.hovered
                   ? Theme.colorSurfaceHover
                   : Theme.colorTransparent

        Behavior on color {
            ColorAnimation { duration: Theme.durationFast }
        }

        // Indicateur de sélection : barre verticale à gauche
        Rectangle {
            visible: root.selected
            width: 3
            radius: 1.5
            anchors.left: parent.left
            anchors.top: parent.top
            anchors.bottom: parent.bottom
            anchors.topMargin: 4
            anchors.bottomMargin: 4
            color: Theme.colorPrimary
        }
    }
}
