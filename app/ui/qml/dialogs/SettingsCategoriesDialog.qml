// Éditeur de rayons d'ingrédients — accessible depuis Fichier → Paramètres
// → Rayons d'ingrédients.
//
// Refonte UX : on a abandonné la hiérarchie L1 → L2 (trop dense / surcharge
// pour rien). Un seul niveau de rayons type supermarché : "Fruits & légumes",
// "Viandes", "Produits laitiers", etc. — l'utilisateur en crée autant qu'il
// veut, dans l'ordre qui lui convient.
//
// Note : la table `category_definition` garde son schéma hiérarchique en DB
// (parent_id, etc.) pour ne pas casser les seeds CIQUAL existants. Mais
// l'UI n'expose que les L1 (parent_id IS NULL). Les L2 héritées des seeds
// restent en DB silencieusement — sans impact UI.
//
// Au renommage : cascade-update automatique des Ingredient.category_l1 par
// nom (cf. CategoryRepo.rename). Au delete : les Ingredient qui pointaient
// dessus voient leur champ passer à NULL.

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Window {
    id: root

    title: "Paramètres — Rayons d'ingrédients"
    width: 640
    height: 600
    minimumWidth: 480
    minimumHeight: 380
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
                     | Qt.WindowMinMaxButtonsHint
    modality: Qt.NonModal

    property var rayons: []

    function openCentered(parentWindow) {
        if (!categoryVM) return
        rayons = categoryVM.flatL1()
        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        show()
        raise()
    }

    Connections {
        target: typeof categoryVM !== "undefined" ? categoryVM : null
        function onTree_changed() {
            root.rayons = categoryVM.flatL1()
        }
        function onError_emitted(msg) {
            errorBanner.message = msg
            errorBanner.visible = true
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        // ---- Header ----
        Text {
            text: "Rayons d'ingrédients"
            color: Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXl
            font.weight: Theme.fontWeightSemiBold
        }
        Text {
            Layout.fillWidth: true
            text: "Liste plate de rayons type supermarché (Fruits & légumes, Viandes, "
                + "Produits laitiers, etc.). Sert à grouper tes ingrédients dans la liste "
                + "de courses et le frigo. Au renommage, les ingrédients existants sont "
                + "mis à jour automatiquement. À la suppression, ils perdent leur rayon."
            color: Theme.colorTextSecondary
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeSm
            wrapMode: Text.WordWrap
        }

        // Bandeau d'erreur (auto-hide)
        Rectangle {
            id: errorBanner
            property string message: ""
            Layout.fillWidth: true
            Layout.preferredHeight: visible ? errorText.implicitHeight + Theme.spaceMd * 2 : 0
            visible: false
            color: Qt.alpha(Theme.colorError, 0.12)
            radius: Theme.radiusSm
            border.width: 1
            border.color: Theme.colorError
            Text {
                id: errorText
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: Theme.spaceMd
                anchors.rightMargin: Theme.spaceMd
                text: "⚠ " + errorBanner.message
                color: Theme.colorError
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
                wrapMode: Text.WordWrap
            }
            Timer { running: errorBanner.visible; interval: 5000; onTriggered: errorBanner.visible = false }
        }

        // ---- Action : ajouter un rayon ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceSm
            AppTextField {
                id: newRayonField
                Layout.fillWidth: true
                placeholderText: "Nouveau rayon (ex: Fruits & légumes, Viandes…)"
                onAccepted: addRayonBtn.clicked()
            }
            AppButton {
                id: addRayonBtn
                text: "+ Ajouter"
                variant: "primary"
                enabled: newRayonField.text.trim().length > 0
                onClicked: {
                    const ok = categoryVM.addL1(newRayonField.text.trim())
                    if (ok > 0) newRayonField.text = ""
                }
            }
        }

        // ---- Liste plate des rayons ----
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorBorder

            ListView {
                id: rayonList
                anchors.fill: parent
                anchors.margins: 1
                clip: true
                model: root.rayons
                spacing: 1
                ScrollBar.vertical: AppScrollBar { orientation: Qt.Vertical }

                delegate: Rectangle {
                    width: rayonList.width
                    height: 44
                    color: rowMouse.containsMouse
                           ? Theme.colorSurfaceHover
                           : Theme.colorTransparent
                    Behavior on color { ColorAnimation { duration: Theme.durationFast } }

                    MouseArea {
                        id: rowMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        acceptedButtons: Qt.NoButton
                    }

                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: Theme.spaceMd
                        anchors.rightMargin: Theme.spaceMd
                        spacing: Theme.spaceSm

                        Text {
                            text: "📁"
                            font.pixelSize: Theme.fontSizeMd
                        }
                        Text {
                            Layout.fillWidth: true
                            text: modelData.name
                            color: Theme.colorText
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeMd
                            font.weight: Theme.fontWeightMedium
                            elide: Text.ElideRight
                            verticalAlignment: Text.AlignVCenter
                        }
                        AppButton {
                            text: "Renommer"
                            variant: "secondary"
                            Layout.preferredHeight: 32
                            onClicked: renamePopup.openFor(modelData.id, modelData.name)
                        }
                        AppButton {
                            text: "Supprimer"
                            variant: "danger"
                            Layout.preferredHeight: 32
                            onClicked: deleteConfirm.openFor(modelData.id, modelData.name)
                        }
                    }

                    Rectangle {
                        anchors.bottom: parent.bottom
                        anchors.left: parent.left
                        anchors.right: parent.right
                        height: 1
                        color: Theme.colorBorder
                        opacity: 0.3
                    }
                }

                // Empty state
                Text {
                    anchors.centerIn: parent
                    visible: rayonList.count === 0
                    text: "Aucun rayon configuré.\nAjoutes-en avec le champ ci-dessus."
                    color: Theme.colorTextDisabled
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeMd
                    horizontalAlignment: Text.AlignHCenter
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            Item { Layout.fillWidth: true }
            AppButton {
                text: "Fermer"
                variant: "primary"
                onClicked: root.close()
            }
        }
    }

    // ---- Mini-popup de rename ----
    Popup {
        id: renamePopup
        modal: true
        focus: true
        width: 360
        x: (root.width - width) / 2
        y: (root.height - height) / 2
        padding: Theme.spaceMd
        background: Rectangle {
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorPrimary
        }

        property int categoryId: -1
        function openFor(id, currentName) {
            categoryId = id
            renameField.text = currentName
            open()
            renameField.forceActiveFocus()
            renameField.selectAll()
        }

        ColumnLayout {
            anchors.fill: parent
            spacing: Theme.spaceMd
            Text {
                text: "Renommer le rayon"
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
                font.weight: Theme.fontWeightSemiBold
            }
            AppTextField {
                id: renameField
                Layout.fillWidth: true
                placeholderText: "Nouveau nom"
                onAccepted: applyBtn.clicked()
            }
            RowLayout {
                Layout.fillWidth: true
                Item { Layout.fillWidth: true }
                AppButton {
                    text: "Annuler"
                    variant: "ghost"
                    onClicked: renamePopup.close()
                }
                AppButton {
                    id: applyBtn
                    text: "Renommer"
                    variant: "primary"
                    enabled: renameField.text.trim().length > 0
                    onClicked: {
                        const ok = categoryVM.rename(renamePopup.categoryId, renameField.text.trim())
                        if (ok) renamePopup.close()
                    }
                }
            }
        }
    }

    // ---- Confirm delete ----
    Popup {
        id: deleteConfirm
        modal: true
        focus: true
        width: 400
        x: (root.width - width) / 2
        y: (root.height - height) / 2
        padding: Theme.spaceMd
        background: Rectangle {
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorError
        }

        property int categoryId: -1
        property string categoryName: ""
        function openFor(id, name) {
            categoryId = id
            categoryName = name
            open()
        }

        ColumnLayout {
            anchors.fill: parent
            spacing: Theme.spaceMd
            Text {
                text: "Supprimer le rayon « " + deleteConfirm.categoryName + " » ?"
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
                font.weight: Theme.fontWeightSemiBold
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }
            Text {
                Layout.fillWidth: true
                text: "Les ingrédients qui y pointaient perdront leur rayon."
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
                wrapMode: Text.WordWrap
            }
            RowLayout {
                Layout.fillWidth: true
                Item { Layout.fillWidth: true }
                AppButton {
                    text: "Annuler"
                    variant: "ghost"
                    onClicked: deleteConfirm.close()
                }
                AppButton {
                    text: "Supprimer"
                    variant: "danger"
                    onClicked: {
                        categoryVM.delete(deleteConfirm.categoryId)
                        deleteConfirm.close()
                    }
                }
            }
        }
    }
}
