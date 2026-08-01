// Spinner moderne : un arc partiel (270°) en couleur primary qui tourne
// au-dessus d'un cercle gris léger. Plus visible et plus contemporain que
// le `BusyIndicator` natif Basic style.
//
// API :
//   AppSpinner {
//       running: vm.busy
//       size: 48                 // optionnel — diamètre extérieur en px
//       arcThickness: 4          // optionnel — épaisseur du trait
//   }

import QtQuick
import App

Item {
    id: root

    property bool running: false
    property int size: 48
    property int arcThickness: 4
    property color trackColor: Qt.alpha(Theme.colorBorder, 0.4)
    property color arcColor: Theme.colorPrimary

    implicitWidth: size
    implicitHeight: size
    visible: running

    Canvas {
        id: canvas
        anchors.fill: parent

        // Angle de départ de l'arc rotatif. Animé en boucle.
        property real angleStart: 0

        onAngleStartChanged: requestPaint()

        // Re-paint quand le thème (dark mode) change ou quand running flip
        Connections {
            target: Theme
            function onDarkModeChanged() { canvas.requestPaint() }
        }
        Connections {
            target: root
            function onArcColorChanged()   { canvas.requestPaint() }
            function onTrackColorChanged() { canvas.requestPaint() }
        }

        onPaint: {
            const ctx = getContext("2d")
            ctx.reset()
            const cx = width / 2
            const cy = height / 2
            const r = Math.min(width, height) / 2 - root.arcThickness / 2 - 1
            if (r <= 0) return

            // Anneau de fond (track gris léger sur tout le cercle)
            ctx.beginPath()
            ctx.arc(cx, cy, r, 0, Math.PI * 2)
            ctx.lineWidth = root.arcThickness
            ctx.strokeStyle = root.trackColor.toString()
            ctx.stroke()

            // Arc rotatif (~270°) en couleur primary, lineCap rond
            ctx.beginPath()
            ctx.arc(cx, cy, r, angleStart, angleStart + Math.PI * 1.5)
            ctx.lineWidth = root.arcThickness
            ctx.lineCap = "round"
            ctx.strokeStyle = root.arcColor.toString()
            ctx.stroke()
        }

        NumberAnimation on angleStart {
            from: 0
            to: Math.PI * 2
            duration: 1000
            loops: Animation.Infinite
            running: root.running
        }
    }
}
