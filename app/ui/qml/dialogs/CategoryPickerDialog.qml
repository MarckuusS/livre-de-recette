// Picker de rayon en 1 étape (refonte UX — finie la hiérarchie L1/L2).
//
// Workflow simple :
//   1. L'utilisateur clique sur le bouton "Rayon" du formulaire d'un
//      ingrédient → ce dialog s'ouvre, affiche la liste plate des rayons
//      existants.
//   2. L'utilisateur clique un rayon → le dialog se ferme et émet
//      `categorySelected(rayonName, "")`. Le 2e arg reste à "" pour
//      compat avec l'ancien signal (qui acceptait L1 + L2).
//
// L'utilisateur peut aussi :
//   - Cliquer "Aucun rayon" pour effacer l'attribution
//   - Annuler
//
// Le dialog se base sur `categoryVM.flatL1()` qui retourne la liste des
// rayons (= L1 en DB, hiérarchie aplatie en UI).

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Window {
    id: root

    title: "Choisir un rayon"
    width: 460
    height: 520
    minimumWidth: 360
    minimumHeight: 320
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
    modality: Qt.ApplicationModal

    // Émis à la fin (rayonName, ""). Le 2e arg reste vide pour compat avec
    // l'ancien signal `categorySelected(l1Name, l2Name)`.
    signal categorySelected(string l1Name, string l2Name)

    // ---- État interne ----
    property string currentName: ""
    property var rayonList: []

    function openPicker(currentL1, currentL2, parentWindow) {
        if (!categoryVM) return
        currentName = currentL1 || ""
        rayonList = categoryVM.flatL1()
        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        show()
        raise()
        requestActivate()
    }

    Connections {
        target: typeof categoryVM !== "undefined" ? categoryVM : null
        function onTree_changed() {
            // Recharge si l'éditeur Paramètres est ouvert en parallèle
            // et que l'user vient d'ajouter / renommer un rayon.
            root.rayonList = categoryVM.flatL1()
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        // ---- Header ----
        Text {
            text: "Choisir un rayon"
            color: Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXl
            font.weight: Theme.fontWeightSemiBold
        }

        Text {
            Layout.fillWidth: true
            text: root.currentName
                  ? "Rayon actuel : " + root.currentName
                  : "Aucun rayon assigné. Sélectionne-en un dans la liste."
            color: Theme.colorTextSecondary
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeSm
            wrapMode: Text.WordWrap
        }

        // ---- Liste des rayons ----
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
                spacing: 1
                ScrollBar.vertical: AppScrollBar { orientation: Qt.Vertical }
                model: root.rayonList

                delegate: AppListItem {
                    width: ListView.view.width
                    height: 44
                    selected: modelData.name === root.currentName
                    onClicked: {
                        root.categorySelected(modelData.name, "")
                        root.close()
                    }
                    content: RowLayout {
                        anchors.fill: parent
                        spacing: Theme.spaceMd
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
                        }
                        Text {
                            visible: modelData.name === root.currentName
                            text: "✓"
                            color: Theme.colorPrimary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeMd
                            font.weight: Theme.fontWeightSemiBold
                        }
                    }
                }

                // Empty state
                Text {
                    anchors.centerIn: parent
                    visible: list.count === 0
                    text: "Aucun rayon configuré.\nOuvre Fichier → Paramètres → Rayons d'ingrédients pour en créer."
                    color: Theme.colorTextDisabled
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                    horizontalAlignment: Text.AlignHCenter
                }
            }
        }

        // ---- Footer ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceSm
            AppButton {
                text: "Aucun rayon"
                variant: "secondary"
                onClicked: {
                    root.categorySelected("", "")
                    root.close()
                }
            }
            Item { Layout.fillWidth: true }
            AppButton {
                text: "Annuler"
                variant: "ghost"
                onClicked: root.close()
            }
        }
    }
}
