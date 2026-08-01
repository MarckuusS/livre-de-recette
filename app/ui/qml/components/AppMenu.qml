// Menu déroulant stylé Theme. Remplace `Menu` natif (qui rend en noir plein
// avec le style "Basic" forcé au démarrage). Items via délégué auto-stylé.
//
//   AppMenu {
//     title: "&Fichier"
//     Action { text: "&Quitter"; onTriggered: Qt.quit() }
//   }

import QtQuick
import QtQuick.Controls
import App

Menu {
    id: root

    delegate: MenuItem {
        id: item
        implicitHeight: 34
        leftPadding: Theme.spaceMd
        rightPadding: Theme.spaceMd

        contentItem: Text {
            // Convertit le marqueur Qt "&X" en lettre soulignée (raccourci Alt+X).
            textFormat: Text.RichText
            text: Theme.formatMnemonic(item.text)
            color: !item.enabled
                   ? Theme.colorTextDisabled
                   : item.highlighted
                     ? Theme.colorPrimary
                     : Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeMd
            font.weight: item.highlighted ? Theme.fontWeightMedium : Theme.fontWeightRegular
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight

            Behavior on color {
                ColorAnimation { duration: Theme.durationFast }
            }
        }

        background: Rectangle {
            color: item.highlighted ? Theme.colorSurfaceHover : Theme.colorTransparent
            Behavior on color { ColorAnimation { duration: Theme.durationFast } }
        }
    }

    background: Rectangle {
        implicitWidth: 220
        radius: Theme.radiusMd
        color: Theme.colorSurface
        border.width: 1
        border.color: Theme.colorBorder

        // Ombre normale empilée pour la profondeur
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
