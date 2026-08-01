// Dialogue de restauration : VRAIE FENÊTRE système (Window) — détachable.
// Liste les sauvegardes disponibles, permet d'en restaurer une.
//
// La restauration prend une *safety backup* avant d'écraser la DB courante,
// puis demande à l'utilisateur de relancer l'app (le moteur SQLAlchemy en cours
// d'utilisation pointe vers une DB qui n'existe plus à ce moment).

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Window {
    id: root

    title: "Restaurer une sauvegarde"
    width: 580
    height: 480
    minimumWidth: 480
    minimumHeight: 360
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
    modality: Qt.NonModal

    function openCentered(parentWindow) {
        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        _refreshList()
        show()
        raise()
    }

    ListModel { id: backupsModel }
    property string _backupDir: ""
    property bool _restoreSucceeded: false
    property string _safetyBackupPath: ""

    function _refreshList() {
        backupsModel.clear()
        if (typeof backupVM === "undefined" || !backupVM) return
        _backupDir = backupVM.backupDirectory()
        const items = backupVM.listBackups()
        for (let i = 0; i < items.length; i++) {
            backupsModel.append(items[i])
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        Text {
            text: "Sauvegardes disponibles"
            color: Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXl
            font.weight: Theme.fontWeightSemiBold
        }

        Text {
            Layout.fillWidth: true
            text: "Dossier : " + root._backupDir
            color: Theme.colorTextSecondary
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXs
            elide: Text.ElideMiddle
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorBorder

            ListView {
                id: list
                anchors.fill: parent
                anchors.margins: 1
                clip: true
                model: backupsModel
                spacing: 0
                ScrollBar.vertical: AppScrollBar {}
                currentIndex: -1

                delegate: AppListItem {
                    width: ListView.view.width
                    height: 56
                    selected: index === list.currentIndex
                    onClicked: list.currentIndex = index
                    onDoubleClicked: root._confirmRestore(model.path, model.timestampHuman)

                    content: ColumnLayout {
                        anchors.fill: parent
                        spacing: 1
                        Text {
                            Layout.fillWidth: true
                            text: model.timestampHuman
                            color: Theme.colorText
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeMd
                            font.weight: Theme.fontWeightMedium
                            elide: Text.ElideRight
                        }
                        Text {
                            Layout.fillWidth: true
                            text: model.name + "  ·  " + model.humanSize
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXs
                            elide: Text.ElideRight
                        }
                    }
                }
            }

            ColumnLayout {
                anchors.centerIn: parent
                visible: backupsModel.count === 0
                spacing: Theme.spaceSm
                Text {
                    Layout.alignment: Qt.AlignHCenter
                    text: "Aucune sauvegarde"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeLg
                    font.weight: Theme.fontWeightMedium
                }
                Text {
                    Layout.preferredWidth: 320
                    Layout.alignment: Qt.AlignHCenter
                    wrapMode: Text.WordWrap
                    horizontalAlignment: Text.AlignHCenter
                    text: "Les sauvegardes sont créées automatiquement à chaque lancement de l'application. Reviens ici après quelques sessions."
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                }
            }
        }

        // ---- Indication de safety backup post-restauration ----
        Rectangle {
            Layout.fillWidth: true
            visible: root._restoreSucceeded
            color: Qt.alpha(Theme.colorSuccess, 0.10)
            border.color: Theme.colorSuccess
            border.width: 1
            radius: Theme.radiusMd
            implicitHeight: successText.implicitHeight + Theme.spaceMd * 2

            Text {
                id: successText
                anchors.fill: parent
                anchors.margins: Theme.spaceMd
                wrapMode: Text.WordWrap
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
                text: "✓ Restauration effectuée. L'état précédent a été sauvegardé dans :\n" +
                      root._safetyBackupPath +
                      "\n\nFerme et relance l'application pour appliquer la restauration."
            }
        }

        // ---- Boutons ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceMd

            AppButton {
                text: "Ouvrir le dossier"
                variant: "ghost"
                enabled: root._backupDir !== ""
                onClicked: Qt.openUrlExternally("file:///" + root._backupDir.replace(/\\/g, "/"))
            }
            Item { Layout.fillWidth: true }
            AppButton {
                text: "Fermer"
                variant: "secondary"
                onClicked: root.close()
            }
            AppButton {
                text: "Restaurer la sélection"
                variant: "primary"
                enabled: list.currentIndex >= 0 && !root._restoreSucceeded
                onClicked: {
                    const item = backupsModel.get(list.currentIndex)
                    root._confirmRestore(item.path, item.timestampHuman)
                }
            }
        }
    }

    // ============================================================ Confirmation

    AppDialog {
        id: confirmDialog
        title: "Confirmer la restauration"
        modal: true
        anchors.centerIn: Overlay.overlay
        standardButtons: Dialog.Ok | Dialog.Cancel
        width: 480

        property string targetPath: ""
        property string targetLabel: ""

        contentItem: ColumnLayout {
            spacing: Theme.spaceMd
            Text {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
                text: "Restaurer la sauvegarde du <b>" + confirmDialog.targetLabel + "</b> ?"
                textFormat: Text.RichText
            }
            Text {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
                text: "L'état actuel sera lui-même sauvegardé avant l'écrasement, " +
                      "donc cette opération est réversible. Tu devras relancer l'application " +
                      "après la restauration."
            }
        }

        onAccepted: {
            const ok = backupVM.restoreFromPath(confirmDialog.targetPath)
            if (ok) {
                root._restoreSucceeded = true
                // Le path de la safety backup est émis via le signal `restored`.
            }
        }
    }

    function _confirmRestore(path, label) {
        confirmDialog.targetPath = path
        confirmDialog.targetLabel = label
        confirmDialog.open()
    }

    // ============================================================ Connexions VM
    Connections {
        target: backupVM
        function onRestored(safetyPath) {
            root._safetyBackupPath = safetyPath
        }
        function onError_emitted(message) {
            errorToast.message = message
            errorToast.visible = true
        }
    }

    Rectangle {
        id: errorToast
        property string message: ""
        visible: false
        color: Theme.colorError
        radius: Theme.radiusMd
        anchors.bottom: parent.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottomMargin: Theme.spaceLg
        width: Math.min(parent.width - Theme.spaceXl * 2, errorTextLabel.implicitWidth + Theme.spaceXl * 2)
        height: errorTextLabel.implicitHeight + Theme.spaceMd * 2
        Text {
            id: errorTextLabel
            anchors.centerIn: parent
            text: errorToast.message
            color: "white"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeMd
        }
        Timer { running: errorToast.visible; interval: 5000; onTriggered: errorToast.visible = false }
    }
}
