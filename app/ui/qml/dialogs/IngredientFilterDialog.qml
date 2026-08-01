// Dialog de filtres avancés pour la bibliothèque d'ingrédients.
//
// Ouvert depuis le bouton "🔧 Filtres" de la barre de contrôles de
// IngredientsPage. Liste exhaustive de paramètres :
//   - Sources (CIQUAL / OFF / Manuel) — multi-select
//   - Rayons — multi-select dynamique depuis categoryVM
//   - Toggles binaires : en saison / avec marque / avec poids unitaire / avec prix
//   - Plages min/max sur 6 macros : kcal, protéines, glucides, lipides, fibres, sel
//
// Les valeurs sont poussées au VM en live (pas de bouton "Appliquer") — ça
// reflète l'état "live" et l'utilisateur voit immédiatement la liste filtrée
// à droite. Le bouton "Réinitialiser" remet tout à zéro.

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Window {
    id: root

    title: "Filtres avancés — bibliothèque d'ingrédients"
    width: 720
    height: 720
    minimumWidth: 540
    minimumHeight: 480
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
                     | Qt.WindowMinMaxButtonsHint
    modality: Qt.NonModal

    property var rayonOptions: []

    function openCentered(parentWindow) {
        if (typeof categoryVM !== "undefined" && categoryVM) {
            rayonOptions = categoryVM.flatL1()
        }
        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        show()
        raise()
    }

    // ---- Helpers JS ----
    function _toggleInSet(currentList, value) {
        const idx = currentList.indexOf(value)
        if (idx >= 0) {
            return currentList.filter(function(v) { return v !== value })
        }
        return currentList.concat([value])
    }

    function _isInSet(list, value) {
        return list && list.indexOf(value) >= 0
    }

    ScrollView {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        clip: true
        ScrollBar.vertical: AppScrollBar { orientation: Qt.Vertical }

        ColumnLayout {
            width: parent.width
            spacing: Theme.spaceLg

            // ============== Header ==============
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceMd
                Text {
                    Layout.fillWidth: true
                    text: "Filtres avancés"
                    color: Theme.colorText
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXl
                    font.weight: Theme.fontWeightSemiBold
                }
                AppButton {
                    text: "↺ Réinitialiser"
                    variant: "secondary"
                    onClicked: ingredientVM.resetFilters()
                }
                AppButton {
                    text: "Fermer"
                    variant: "primary"
                    onClicked: root.close()
                }
            }

            Text {
                Layout.fillWidth: true
                text: ingredientVM
                      ? (ingredientVM.activeFilterCount > 0
                         ? ingredientVM.activeFilterCount + " filtre"
                           + (ingredientVM.activeFilterCount > 1 ? "s" : "")
                           + " actif" + (ingredientVM.activeFilterCount > 1 ? "s" : "")
                         : "Aucun filtre actif — tous les ingrédients affichés.")
                      : ""
                color: ingredientVM && ingredientVM.activeFilterCount > 0
                       ? Theme.colorPrimary : Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
                font.italic: true
            }

            // ============== Section : Sources ==============
            ColumnLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceXs

                Text {
                    text: "SOURCE"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXs
                    font.weight: Theme.fontWeightSemiBold
                    font.letterSpacing: 0.5
                }
                RowLayout {
                    spacing: Theme.spaceSm

                    Repeater {
                        model: [
                            { code: "ciqual",        label: "CIQUAL" },
                            { code: "openfoodfacts", label: "OpenFoodFacts" },
                            { code: "manual",        label: "Manuel" }
                        ]
                        delegate: AppCheckBox {
                            text: modelData.label
                            checked: ingredientVM
                                     && root._isInSet(ingredientVM.filterSources, modelData.code)
                            onClicked: {
                                const newList = root._toggleInSet(
                                    ingredientVM.filterSources, modelData.code)
                                ingredientVM.setFilterSources(newList)
                            }
                        }
                    }
                }
                Text {
                    Layout.fillWidth: true
                    text: "Aucune coche = toutes les sources affichées."
                    color: Theme.colorTextDisabled
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXs
                    font.italic: true
                }
            }

            // ============== Section : Rayons ==============
            ColumnLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceXs
                visible: root.rayonOptions.length > 0

                Text {
                    text: "RAYONS"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXs
                    font.weight: Theme.fontWeightSemiBold
                    font.letterSpacing: 0.5
                }
                Flow {
                    Layout.fillWidth: true
                    spacing: Theme.spaceXs

                    Repeater {
                        model: root.rayonOptions
                        delegate: Rectangle {
                            readonly property bool isSelected:
                                ingredientVM && root._isInSet(ingredientVM.filterRayons, modelData.name)
                            implicitWidth: rayonText.implicitWidth + Theme.spaceMd * 2
                            implicitHeight: 28
                            radius: Theme.radiusFull
                            color: isSelected ? Qt.alpha(Theme.colorPrimary, 0.18) : Theme.colorSurface
                            border.width: 1
                            border.color: isSelected ? Theme.colorPrimary : Theme.colorBorder
                            Behavior on color { ColorAnimation { duration: Theme.durationFast } }

                            Text {
                                id: rayonText
                                anchors.centerIn: parent
                                text: modelData.name
                                color: parent.isSelected ? Theme.colorPrimary : Theme.colorText
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                font.weight: parent.isSelected ? Theme.fontWeightSemiBold : Theme.fontWeightRegular
                            }
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    const newList = root._toggleInSet(
                                        ingredientVM.filterRayons, modelData.name)
                                    ingredientVM.setFilterRayons(newList)
                                }
                            }
                        }
                    }
                }
                Text {
                    Layout.fillWidth: true
                    text: "Aucune sélection = tous les rayons. Édite la liste via Fichier → Paramètres → Rayons d'ingrédients."
                    color: Theme.colorTextDisabled
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXs
                    font.italic: true
                    wrapMode: Text.WordWrap
                }
            }

            // ============== Section : Filtres rapides (toggles) ==============
            ColumnLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceXs

                Text {
                    text: "FILTRES RAPIDES"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXs
                    font.weight: Theme.fontWeightSemiBold
                    font.letterSpacing: 0.5
                }
                GridLayout {
                    Layout.fillWidth: true
                    columns: 2
                    rowSpacing: Theme.spaceXs
                    columnSpacing: Theme.spaceLg

                    AppCheckBox {
                        text: "🌱 De saison ce mois-ci"
                        checked: ingredientVM ? ingredientVM.filterInSeason : false
                        onClicked: ingredientVM.setFilterInSeason(checked)
                    }
                    AppCheckBox {
                        text: "🏷️ Avec une marque renseignée"
                        checked: ingredientVM ? ingredientVM.filterWithBrand : false
                        onClicked: ingredientVM.setFilterWithBrand(checked)
                    }
                    AppCheckBox {
                        text: "● Avec un poids unitaire défini"
                        checked: ingredientVM ? ingredientVM.filterWithPieceWeight : false
                        onClicked: ingredientVM.setFilterWithPieceWeight(checked)
                    }
                    AppCheckBox {
                        text: "💰 Avec un prix renseigné"
                        checked: ingredientVM ? ingredientVM.filterWithPrice : false
                        onClicked: ingredientVM.setFilterWithPrice(checked)
                    }
                }
            }

            // ============== Section : Macros (plages min/max) ==============
            ColumnLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceSm

                Text {
                    text: "PLAGES MACROS (min — max, par 100 g)"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXs
                    font.weight: Theme.fontWeightSemiBold
                    font.letterSpacing: 0.5
                }
                Text {
                    Layout.fillWidth: true
                    text: "Laisser un champ à 0 = pas de borne sur ce côté. Une valeur min ou max active = on n'affiche QUE les ingrédients dont la valeur est connue ET dans la plage."
                    color: Theme.colorTextDisabled
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXs
                    font.italic: true
                    wrapMode: Text.WordWrap
                }

                component MacroRow: RowLayout {
                    property string macro: ""
                    property string label: ""
                    property real maxValue: 100

                    Layout.fillWidth: true
                    spacing: Theme.spaceSm

                    Text {
                        Layout.preferredWidth: 110
                        text: label
                        color: Theme.colorText
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeSm
                    }
                    AppSpinBox {
                        id: minBox
                        Layout.preferredWidth: 110
                        decimals: 1
                        realFrom: 0
                        realTo: maxValue
                        realStep: 1
                        emptyOnZero: true
                        Component.onCompleted: realValue = ingredientVM
                                                ? ingredientVM.macroRange(macro).min : 0
                        onRealValueChanged: {
                            if (!ingredientVM) return
                            const cur = ingredientVM.macroRange(macro)
                            if (Math.abs(realValue - cur.min) > 1e-6) {
                                ingredientVM.setMacroRange(macro, realValue, cur.max)
                            }
                        }
                    }
                    Text {
                        text: "—"
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeMd
                    }
                    AppSpinBox {
                        Layout.preferredWidth: 110
                        decimals: 1
                        realFrom: 0
                        realTo: maxValue
                        realStep: 1
                        emptyOnZero: true
                        Component.onCompleted: realValue = ingredientVM
                                                ? ingredientVM.macroRange(macro).max : 0
                        onRealValueChanged: {
                            if (!ingredientVM) return
                            const cur = ingredientVM.macroRange(macro)
                            if (Math.abs(realValue - cur.max) > 1e-6) {
                                ingredientVM.setMacroRange(macro, cur.min, realValue)
                            }
                        }
                    }
                    Item { Layout.fillWidth: true }
                }

                MacroRow { macro: "kcal";     label: "Énergie";   maxValue: 2000 }
                MacroRow { macro: "fats";     label: "Lipides";   maxValue: 100  }
                MacroRow { macro: "carbs";    label: "Glucides";  maxValue: 100  }
                MacroRow { macro: "fiber";    label: "Fibres";    maxValue: 50   }
                MacroRow { macro: "proteins"; label: "Protéines"; maxValue: 100  }
                MacroRow { macro: "salt";     label: "Sel";       maxValue: 30   }
            }

            Item { Layout.preferredHeight: Theme.spaceLg }
        }
    }
}
