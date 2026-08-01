// Case à cocher animée. Indicateur custom avec coche SVG-like dessinée au Canvas.

import QtQuick
import QtQuick.Controls
import App

CheckBox {
    id: root

    spacing: Theme.spaceSm
    font.family: Theme.fontFamily
    font.pixelSize: Theme.fontSizeMd

    indicator: Rectangle {
        implicitWidth: 18
        implicitHeight: 18
        x: root.leftPadding
        y: parent.height / 2 - height / 2
        radius: Theme.radiusSm
        border.width: 1.5
        border.color: !root.enabled
                      ? Theme.colorBorder
                      : root.checked
                        ? Theme.colorPrimary
                        : root.hovered
                          ? Theme.colorBorderHover
                          : Theme.colorBorder
        color: !root.enabled
               ? Theme.colorSurfaceHover
               : root.checked
                 ? Theme.colorPrimary
                 : Theme.colorSurface

        Behavior on color {
            ColorAnimation { duration: Theme.durationFast }
        }
        Behavior on border.color {
            ColorAnimation { duration: Theme.durationFast }
        }

        // Coche : trait SVG-like en Canvas
        Canvas {
            id: tick
            anchors.fill: parent
            anchors.margins: 3
            opacity: root.checked ? 1.0 : 0.0
            scale: root.checked ? 1.0 : 0.6

            Behavior on opacity { NumberAnimation { duration: Theme.durationFast; easing.type: Theme.easingEnter } }
            Behavior on scale   { NumberAnimation { duration: Theme.durationFast; easing.type: Theme.easingEnter } }

            onPaint: {
                const ctx = getContext("2d")
                ctx.reset()
                ctx.strokeStyle = Theme.colorOnPrimary
                ctx.lineWidth = 2
                ctx.lineCap = "round"
                ctx.lineJoin = "round"
                ctx.beginPath()
                ctx.moveTo(width * 0.20, height * 0.55)
                ctx.lineTo(width * 0.42, height * 0.78)
                ctx.lineTo(width * 0.82, height * 0.25)
                ctx.stroke()
            }
            Connections {
                target: Theme
                function onDarkModeChanged() { tick.requestPaint() }
            }
        }
    }

    contentItem: Text {
        text: root.text
        font: root.font
        color: root.enabled ? Theme.colorText : Theme.colorTextDisabled
        verticalAlignment: Text.AlignVCenter
        leftPadding: root.indicator.width + root.spacing
    }
}
