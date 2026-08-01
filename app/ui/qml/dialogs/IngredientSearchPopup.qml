// Recherche manuelle d'un ingrédient pour une ligne d'import URL.
//
// VRAIE Window système (détachable, draggable, indépendante du wizard URL).
// Mêmes conventions que `ImportIngredientDialog.qml` : non-modale, peut
// être déplacée en parallèle sur un autre écran. Le thème app s'applique
// partout (pas de chrome dark Qt natif comme dans un `Dialog` interne).
//
// 3 onglets (TabBar) :
//   - Bibliothèque personnelle : FTS5 scope='personal', instantané
//   - CIQUAL (local)            : FTS5, instantané
//   - OpenFoodFacts (en ligne)  : appel HTTP, ~1-3 s, spinner pendant
//
// `initialSource` ∈ {"personal", "ciqual", "off"} pré-sélectionne le tab
// à l'ouverture pour que l'utilisateur ait son contexte direct selon son
// choix de menu.
//
// Au pick : import auto en biblio perso si nécessaire +
// `recipeUrlImportVM.setLineChosenIngredient(idx, id)` qui ajoute aussi
// l'id en tête des candidates pour que la combobox de la ligne affiche
// son nom.

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Window {
    id: root

    title: "Rechercher un ingrédient"
    width: 760
    height: 600
    minimumWidth: 600
    minimumHeight: 420
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
                     | Qt.WindowMinMaxButtonsHint
    modality: Qt.NonModal

    property int targetLineIdx: -1
    property string targetLineLabel: ""
    property string initialSource: "ciqual"
    property var results: []
    property bool searching: false

    function openFor(parentWindow, lineIdx, lineRawText, parsedName, source) {
        targetLineIdx = lineIdx
        targetLineLabel = lineRawText
        initialSource = source || "ciqual"
        queryField.text = parsedName || ""
        results = []
        errorText.text = ""
        // Mappe le source string → index du TabBar (0 perso, 1 CIQUAL, 2 OFF)
        tabBar.currentIndex = initialSource === "personal" ? 0
                            : initialSource === "off"      ? 2
                            : 1

        // Position centrée sur le parent (en général : Window du wizard URL).
        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        show()
        raise()
        // Recherche initiale auto si query non vide
        if (queryField.text.trim().length > 0) _doSearch()
    }

    function _doSearch() {
        const q = queryField.text.trim()
        if (!q) {
            results = []
            return
        }
        errorText.text = ""
        searching = true
        try {
            if (tabBar.currentIndex === 0) {
                // Biblio perso : scope='personal' — restreint aux ingrédients
                // avec in_personal_library=True. FTS5 local, instantané.
                results = ingredientVM.searchOnce(q, "personal", 50)
            } else if (tabBar.currentIndex === 1) {
                results = ingredientVM.searchBySource(q, "ciqual", 50)
            } else {
                // OFF online — bloquant, ~1-3 s. Le spinner masque l'attente.
                results = ingredientVM.fetchOnlineAndList(q, 30)
            }
        } catch (e) {
            errorText.text = String(e)
            results = []
        }
        searching = false
        if (results.length === 0 && !errorText.text)
            errorText.text = "Aucun résultat pour « " + q + " »."
    }

    function _pickResult(item) {
        if (!item || !item.id) return
        if (item.inLibrary !== true)
            ingredientVM.importExisting(item.id)
        recipeUrlImportVM.setLineChosenIngredient(root.targetLineIdx, item.id)
        root.close()
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        // ---- Header : titre + ligne ciblée ----
        Text {
            text: "Rechercher un ingrédient"
            color: Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXl
            font.weight: Theme.fontWeightSemiBold
        }
        Text {
            text: "Pour la ligne : « " + root.targetLineLabel + " »"
            color: Theme.colorTextSecondary
            font.italic: true
            font.pixelSize: Theme.fontSizeSm
            elide: Text.ElideRight
            Layout.fillWidth: true
        }

        // ---- Onglets CIQUAL / OFF ----
        TabBar {
            id: tabBar
            Layout.fillWidth: true
            background: Rectangle {
                color: Theme.colorTransparent
                Rectangle {
                    anchors.bottom: parent.bottom
                    anchors.left: parent.left
                    anchors.right: parent.right
                    height: 1
                    color: Theme.colorBorder
                }
            }
            AppTabButton { text: "Bibliothèque personnelle"; width: 220 }
            AppTabButton { text: "CIQUAL (local)";           width: 180 }
            AppTabButton { text: "OpenFoodFacts (en ligne)";  width: 220 }

            onCurrentIndexChanged: {
                if (queryField.text.trim().length > 0) _doSearch()
            }
        }

        // ---- Champ de recherche ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceSm
            AppTextField {
                id: queryField
                Layout.fillWidth: true
                placeholderText: "Tape un nom (ex: oignon, crème liquide…)"
                Keys.onReturnPressed: _doSearch()
            }
            AppButton {
                text: "Chercher"
                variant: "primary"
                enabled: !root.searching && queryField.text.trim().length > 0
                onClicked: _doSearch()
            }
        }

        // ---- Spinner pendant la recherche OFF ----
        AppSpinner {
            Layout.alignment: Qt.AlignHCenter
            running: root.searching
            size: 36
        }

        Text {
            id: errorText
            Layout.fillWidth: true
            color: Theme.colorTextSecondary
            font.italic: true
            wrapMode: Text.WordWrap
            visible: text !== ""
            text: ""
        }

        // ---- Liste des résultats ----
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: Theme.colorSurface
            border.width: 1
            border.color: Theme.colorBorder
            radius: Theme.radiusMd

            ScrollView {
                id: resultsScroll
                anchors.fill: parent
                anchors.margins: 4
                clip: true
                ScrollBar.vertical: AppScrollBar { orientation: Qt.Vertical }
                ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

                ListView {
                    width: resultsScroll.availableWidth
                    model: root.results
                    spacing: 2
                    delegate: Rectangle {
                        width: ListView.view.width
                        height: 48
                        radius: Theme.radiusSm
                        color: pickArea.containsMouse
                               ? Qt.alpha(Theme.colorPrimary, 0.10)
                               : (index % 2 === 0
                                  ? Theme.colorTransparent
                                  : Qt.alpha(Theme.colorBorder, 0.06))

                        RowLayout {
                            anchors.fill: parent
                            anchors.leftMargin: Theme.spaceMd
                            anchors.rightMargin: Theme.spaceMd
                            spacing: Theme.spaceSm

                            Rectangle {
                                Layout.preferredWidth: 60
                                Layout.preferredHeight: 22
                                radius: Theme.radiusSm
                                color: modelData.source === "ciqual"
                                       ? Qt.alpha("#15803d", 0.14)
                                       : modelData.source === "openfoodfacts"
                                         ? Qt.alpha("#1d4ed8", 0.14)
                                         : Qt.alpha("#c2410c", 0.14)
                                Text {
                                    anchors.centerIn: parent
                                    text: modelData.source === "ciqual" ? "CIQUAL"
                                        : modelData.source === "openfoodfacts" ? "OFF"
                                        : "perso"
                                    color: modelData.source === "ciqual" ? "#15803d"
                                        : modelData.source === "openfoodfacts" ? "#1d4ed8"
                                        : "#c2410c"
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeXs
                                    font.weight: Theme.fontWeightSemiBold
                                }
                            }

                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 1
                                Text {
                                    text: modelData.name
                                    color: Theme.colorText
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeMd
                                    elide: Text.ElideRight
                                    Layout.fillWidth: true
                                }
                                Text {
                                    visible: text !== ""
                                    text: (modelData.brand && modelData.brand !== "")
                                          ? modelData.brand
                                          : (modelData.categoryL1 || "")
                                    color: Theme.colorTextSecondary
                                    font.italic: true
                                    font.pixelSize: Theme.fontSizeXs
                                    elide: Text.ElideRight
                                    Layout.fillWidth: true
                                }
                            }

                            Text {
                                visible: modelData.inLibrary === true
                                text: "★"
                                color: Theme.colorWarning
                                font.pixelSize: Theme.fontSizeMd
                            }

                            AppButton {
                                Layout.preferredWidth: 100
                                text: "Choisir"
                                variant: "primary"
                                onClicked: _pickResult(modelData)
                            }
                        }

                        MouseArea {
                            id: pickArea
                            anchors.fill: parent
                            anchors.rightMargin: 110
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onDoubleClicked: _pickResult(modelData)
                        }
                    }
                }
            }
        }

        // ---- Footer : bouton Annuler ----
        RowLayout {
            Layout.fillWidth: true
            Item { Layout.fillWidth: true }
            AppButton {
                text: "Annuler"
                variant: "secondary"
                onClicked: root.close()
            }
        }
    }
}
