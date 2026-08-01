// Toast "Annuler" pour les opérations destructrices (U3).
//
//   UndoToast {
//     id: undoToast
//     onUndoClicked: vm.undoLastDelete()
//   }
//
//   // Quand le VM signale une suppression annulable :
//   Connections {
//     target: vm
//     function onDeletion_pending_undo(label) { undoToast.show(label) }
//   }
//
// Auto-fermeture après `timeoutMs` (5000 par défaut). Style sombre (Theme.colorText)
// avec contraste élevé pour la visibilité.

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import App

Rectangle {
    id: root

    property int timeoutMs: 5000
    property string label: ""

    signal undoClicked

    function show(text) {
        root.label = text
        root.visible = true
        autoHideTimer.restart()
    }
    function hide() {
        autoHideTimer.stop()
        root.visible = false
    }

    visible: false
    z: 100

    // Position : ancré en bas par le parent, centre horizontal
    anchors.bottom: parent ? parent.bottom : undefined
    anchors.horizontalCenter: parent ? parent.horizontalCenter : undefined
    anchors.bottomMargin: Theme.spaceXl

    color: Theme.darkMode ? Theme.colorSurface : "#1f2937"   // dark slate, lisible en light mode
    border.color: Qt.alpha("white", 0.10)
    border.width: 1
    radius: Theme.radiusMd
    width: row.implicitWidth + Theme.spaceXl * 2
    height: row.implicitHeight + Theme.spaceMd * 2
    opacity: visible ? 0.96 : 0
    Behavior on opacity { NumberAnimation { duration: Theme.durationFast } }

    Timer {
        id: autoHideTimer
        interval: root.timeoutMs
        onTriggered: root.visible = false
    }

    RowLayout {
        id: row
        anchors.centerIn: parent
        spacing: Theme.spaceMd

        Text {
            text: root.label
            color: "white"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeMd
        }
        // "Annuler" stylisé manuellement (pas AppButton — variants ne fonctionnent
        // pas bien sur fond sombre custom comme celui-ci).
        Rectangle {
            Layout.preferredHeight: 28
            Layout.preferredWidth: undoText.implicitWidth + Theme.spaceMd * 2
            color: undoMouse.containsMouse
                   ? Qt.alpha("white", 0.20)
                   : Qt.alpha("white", 0.10)
            radius: Theme.radiusSm
            Behavior on color { ColorAnimation { duration: Theme.durationFast } }

            Text {
                id: undoText
                anchors.centerIn: parent
                text: "Annuler"
                color: "white"
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
                font.weight: Theme.fontWeightSemiBold
            }
            MouseArea {
                id: undoMouse
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: {
                    root.undoClicked()
                    root.hide()
                }
            }
        }
    }
}
