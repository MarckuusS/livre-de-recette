// Liste déroulante stylée. Popup avec ombre, items avec hover.

import QtQuick
import QtQuick.Controls
import QtQuick.Templates as T
import App

ComboBox {
    id: root

    implicitHeight: Theme.controlHeightMd
    implicitWidth: 140
    leftPadding: Theme.spaceMd
    rightPadding: Theme.spaceXl + Theme.spaceMd

    font.family: Theme.fontFamily
    font.pixelSize: Theme.fontSizeMd

    // ---- Indicateur (la flèche à droite) ----
    indicator: Canvas {
        id: arrow
        x: root.width - width - Theme.spaceMd
        y: (root.height - height) / 2
        width: 10
        height: 6
        contextType: "2d"

        Connections {
            target: root
            function onPressedChanged() { arrow.requestPaint() }
        }
        Connections {
            target: Theme
            function onDarkModeChanged() { arrow.requestPaint() }
        }

        onPaint: {
            const ctx = getContext("2d")
            ctx.reset()
            ctx.beginPath()
            ctx.moveTo(0, 0)
            ctx.lineTo(width, 0)
            ctx.lineTo(width / 2, height)
            ctx.closePath()
            ctx.fillStyle = root.enabled ? Theme.colorTextSecondary : Theme.colorTextDisabled
            ctx.fill()
        }
    }

    // ---- Texte affiché dans le bouton (sélection courante) ----
    contentItem: Text {
        text: root.displayText
        font: root.font
        color: root.enabled ? Theme.colorText : Theme.colorTextDisabled
        verticalAlignment: Text.AlignVCenter
        elide: Text.ElideRight
    }

    // ---- Fond du bouton ----
    background: Rectangle {
        radius: Theme.radiusMd
        color: !root.enabled
               ? Theme.colorSurfaceHover
               : root.pressed
                 ? Theme.colorSurfacePressed
                 : root.hovered
                   ? Theme.colorSurfaceHover
                   : Theme.colorSurface
        border.width: 1
        border.color: !root.enabled
                      ? Theme.colorBorder
                      : root.activeFocus || root.popup.opened
                        ? Theme.colorBorderFocus
                        : root.hovered
                          ? Theme.colorBorderHover
                          : Theme.colorBorder

        Behavior on color {
            ColorAnimation { duration: Theme.durationFast; easing.type: Theme.easingStandard }
        }
        Behavior on border.color {
            ColorAnimation { duration: Theme.durationFast; easing.type: Theme.easingStandard }
        }
    }

    // ---- Délégué pour chaque item du popup ----
    // Gère 3 cas : modèle JS string array (modelData = string), ListModel multi-rôles
    // (utilise textRole sur model[textRole]), ou modèle d'objets JS avec textRole.
    delegate: ItemDelegate {
        id: deleg
        width: ListView.view ? ListView.view.width : implicitWidth
        height: 32

        required property int index
        required property var modelData
        required property var model

        // Texte effectif à afficher : si textRole est défini, on lit cette propriété
        // sur l'item du modèle ; sinon on tombe sur modelData (string array).
        readonly property string displayText: {
            if (root.textRole && root.textRole !== "") {
                if (deleg.model && deleg.model[root.textRole] !== undefined)
                    return String(deleg.model[root.textRole])
                if (deleg.modelData && deleg.modelData[root.textRole] !== undefined)
                    return String(deleg.modelData[root.textRole])
            }
            return deleg.modelData !== undefined ? String(deleg.modelData) : ""
        }

        contentItem: Text {
            text: deleg.displayText
            font: root.font
            color: Theme.colorText
            verticalAlignment: Text.AlignVCenter
            leftPadding: Theme.spaceMd
            elide: Text.ElideRight
        }
        background: Rectangle {
            color: deleg.hovered
                   ? Theme.colorSurfaceHover
                   : deleg.index === root.currentIndex
                     ? Qt.alpha(Theme.colorPrimary, 0.10)
                     : Theme.colorTransparent
            Behavior on color {
                ColorAnimation { duration: Theme.durationFast }
            }
        }
        highlighted: root.highlightedIndex === deleg.index
    }

    // ---- Popup avec ombre stackée ----
    popup: T.Popup {
        y: root.height + 4
        width: root.width
        implicitHeight: Math.min(contentItem.implicitHeight + 2, 320)
        padding: 1

        // 3 couches d'ombre pour la profondeur (poor-man's drop-shadow QML 6)
        Rectangle {
            z: -3
            anchors.fill: parent
            anchors.margins: -8
            radius: Theme.radiusMd + 8
            color: Qt.alpha(Theme.shadowColor, Theme.shadowOpacitySubtle * 0.5)
        }
        Rectangle {
            z: -2
            anchors.fill: parent
            anchors.margins: -4
            radius: Theme.radiusMd + 4
            color: Qt.alpha(Theme.shadowColor, Theme.shadowOpacitySubtle)
        }

        contentItem: ListView {
            clip: true
            implicitHeight: contentHeight
            model: root.popup.visible ? root.delegateModel : null
            currentIndex: root.highlightedIndex
            ScrollIndicator.vertical: ScrollIndicator {}
        }

        background: Rectangle {
            radius: Theme.radiusMd
            color: Theme.colorSurface
            border.width: 1
            border.color: Theme.colorBorder
        }

        enter: Transition {
            ParallelAnimation {
                NumberAnimation { property: "opacity"; from: 0; to: 1; duration: Theme.durationFast; easing.type: Theme.easingEnter }
                NumberAnimation { property: "y"; from: root.height - 4; to: root.height + 4; duration: Theme.durationFast; easing.type: Theme.easingEnter }
            }
        }
    }
}
