// Recherche unifiée Ctrl+K (B6).
//
// Popup centré qui ouvre depuis n'importe quel onglet. Tape une requête →
// debounce 200 ms → trois sections affichées en parallèle :
//   - Ingrédients (`ingredientVM.searchOnce(q, "personal", 12)`)
//   - Recettes    (`recipeListVM.searchOnce(q, 12)`)
//   - Calendrier  (`calendarVM.searchOnce(q, 12)`)  — semaine courante uniquement
//
// Navigation clavier :
//   - ↑ / ↓ : navigue dans la liste plate (sections concaténées)
//   - Entrée : active la sélection (saute à l'onglet correspondant + sélectionne l'item)
//   - Esc : ferme
//
// L'activation émet `itemActivated(kind, payload)` :
//   - kind="ingredient" → payload.id : la page Ingrédients sélectionne la ligne
//   - kind="recipe"     → payload.id : la page Recettes charge la recette
//   - kind="meal_entry" → payload.{isoWeek, dayOfWeek, slot} : la page Calendrier saute à la semaine

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Popup {
    id: root

    width: 640
    height: 520
    modal: true
    focus: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutsideParent

    signal itemActivated(string kind, var payload)

    // ---- État ----
    property string _query: ""
    // Liste plate des résultats : [{kind, label, sublabel, payload}, ...]
    // Permet la navigation au clavier sans casser le tri par section.
    property var _flatResults: []
    property int _selectedIndex: 0

    function openCentered() {
        const win = parent && parent.Window ? parent.Window.window : null
        if (win) {
            x = (win.width - width) / 2
            y = (win.height - height) / 4   // un peu vers le haut
        }
        queryField.text = ""
        _flatResults = []
        _selectedIndex = 0
        open()
        queryField.forceActiveFocus()
    }

    background: Rectangle {
        color: Theme.colorSurface
        radius: Theme.radiusLg
        border.width: 1
        border.color: Theme.colorBorder
    }

    Overlay.modal: Rectangle {
        color: Theme.colorOverlay
        Behavior on opacity { NumberAnimation { duration: Theme.durationFast } }
    }

    enter: Transition {
        NumberAnimation { property: "opacity"; from: 0; to: 1; duration: Theme.durationFast }
        NumberAnimation { property: "scale";   from: 0.96; to: 1.0; duration: Theme.durationFast }
    }

    contentItem: ColumnLayout {
        spacing: Theme.spaceSm
        anchors.margins: Theme.spaceLg

        // ---- Champ de recherche ----
        AppTextField {
            id: queryField
            Layout.fillWidth: true
            placeholderText: "Rechercher dans tout — ingrédients, recettes, calendrier…"
            font.pixelSize: Theme.fontSizeLg
            onTextChanged: searchDebounce.restart()
            Keys.onUpPressed: { _selectedIndex = Math.max(0, _selectedIndex - 1) }
            Keys.onDownPressed: { _selectedIndex = Math.min(_flatResults.length - 1, _selectedIndex + 1) }
            Keys.onReturnPressed: root._activateSelected()
            Keys.onEnterPressed: root._activateSelected()
        }

        Timer {
            id: searchDebounce
            interval: 200
            repeat: false
            onTriggered: root._runSearch()
        }

        // ---- Résultats ----
        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true

            ColumnLayout {
                width: parent ? parent.width : 0
                spacing: 0

                Repeater {
                    model: root._flatResults
                    delegate: Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: modelData.kind === "section_header" ? 28 : 44
                        color: modelData.kind === "section_header"
                               ? Theme.colorBackground
                               : (index === root._selectedIndex
                                  ? Qt.alpha(Theme.colorPrimary, 0.12)
                                  : (rowMouse.containsMouse ? Theme.colorSurfaceHover : Theme.colorTransparent))
                        radius: modelData.kind === "section_header" ? 0 : Theme.radiusSm
                        Behavior on color { ColorAnimation { duration: Theme.durationFast } }

                        // Section header
                        Text {
                            visible: modelData.kind === "section_header"
                            anchors.left: parent.left
                            anchors.leftMargin: Theme.spaceMd
                            anchors.verticalCenter: parent.verticalCenter
                            text: modelData.label
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXs
                            font.weight: Theme.fontWeightSemiBold
                            font.capitalization: Font.AllUppercase
                        }

                        // Item
                        RowLayout {
                            visible: modelData.kind !== "section_header"
                            anchors.fill: parent
                            anchors.leftMargin: Theme.spaceMd
                            anchors.rightMargin: Theme.spaceMd
                            spacing: Theme.spaceMd
                            Text {
                                text: modelData.icon || ""
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeMd
                            }
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: 0
                                Text {
                                    Layout.fillWidth: true
                                    text: modelData.label
                                    color: Theme.colorText
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeMd
                                    elide: Text.ElideRight
                                }
                                Text {
                                    visible: modelData.sublabel !== ""
                                    Layout.fillWidth: true
                                    text: modelData.sublabel
                                    color: Theme.colorTextSecondary
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeXs
                                    elide: Text.ElideRight
                                }
                            }
                            Text {
                                visible: index === root._selectedIndex
                                text: "↩"
                                color: Theme.colorPrimary
                                font.pixelSize: Theme.fontSizeMd
                            }
                        }

                        MouseArea {
                            id: rowMouse
                            anchors.fill: parent
                            hoverEnabled: modelData.kind !== "section_header"
                            cursorShape: modelData.kind !== "section_header" ? Qt.PointingHandCursor : Qt.ArrowCursor
                            enabled: modelData.kind !== "section_header"
                            onClicked: {
                                root._selectedIndex = index
                                root._activateSelected()
                            }
                        }
                    }
                }

                Item {
                    Layout.fillWidth: true
                    Layout.preferredHeight: root._flatResults.length === 0 ? 80 : 0
                    visible: root._flatResults.length === 0
                    Text {
                        anchors.centerIn: parent
                        text: queryField.text.trim().length === 0
                              ? "Tape pour chercher dans tout — Ctrl+K depuis n'importe quel onglet."
                              : "Aucun résultat."
                        color: Theme.colorTextDisabled
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeMd
                    }
                }
            }
        }

        // ---- Footer ----
        Text {
            Layout.fillWidth: true
            text: "↑ / ↓ pour naviguer · Entrée pour ouvrir · Esc pour fermer"
            color: Theme.colorTextDisabled
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXs
            horizontalAlignment: Text.AlignHCenter
        }
    }

    // ============================================================ Logic

    function _runSearch() {
        const q = queryField.text.trim()
        root._query = q
        if (!q) {
            root._flatResults = []
            root._selectedIndex = 0
            return
        }
        const flat = []
        // Ingrédients
        const ings = ingredientVM.searchOnce(q, "personal", 12) || []
        if (ings.length > 0) {
            flat.push({ "kind": "section_header", "label": "🥕 Ingrédients" })
            for (let i = 0; i < ings.length; i++) {
                flat.push({
                    "kind":     "ingredient",
                    "icon":     "🥕",
                    "label":    ings[i].name,
                    "sublabel": (ings[i].source === "ciqual" ? "CIQUAL"
                              : ings[i].source === "openfoodfacts" ? "OpenFoodFacts" : "perso")
                              + (ings[i].inSeasonNow === true ? "  ·  🌱 de saison" : ""),
                    "payload":  { "id": ings[i].id },
                })
            }
        }
        // Recettes
        const recs = recipeListVM.searchOnce(q, 12) || []
        if (recs.length > 0) {
            flat.push({ "kind": "section_header", "label": "🍽 Recettes" })
            for (let i = 0; i < recs.length; i++) {
                flat.push({
                    "kind":     "recipe",
                    "icon":     "🍽",
                    "label":    recs[i].name,
                    "sublabel": recs[i].defaultPortions + " portion"
                              + (recs[i].defaultPortions > 1 ? "s" : "")
                              + "  ·  " + recs[i].lineCount + " ingrédient"
                              + (recs[i].lineCount > 1 ? "s" : ""),
                    "payload":  { "id": recs[i].id },
                })
            }
        }
        // Calendrier (semaine courante)
        const cals = calendarVM.searchOnce(q, 12) || []
        if (cals.length > 0) {
            flat.push({ "kind": "section_header", "label": "📅 Calendrier · semaine courante" })
            const dayLabels = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
            const slotLabels = { morning: "matin", noon: "midi", evening: "soir",
                                 snack_morning: "10 h", snack_afternoon: "16 h" }
            for (let i = 0; i < cals.length; i++) {
                flat.push({
                    "kind":     "meal_entry",
                    "icon":     "📅",
                    "label":    cals[i].description,
                    "sublabel": dayLabels[cals[i].dayOfWeek] + " " + (slotLabels[cals[i].slot] || cals[i].slot),
                    "payload":  {
                        "isoWeek":   cals[i].isoWeek,
                        "dayOfWeek": cals[i].dayOfWeek,
                        "slot":      cals[i].slot,
                    },
                })
            }
        }
        root._flatResults = flat
        // Place le curseur sur le premier item non-header
        for (let i = 0; i < flat.length; i++) {
            if (flat[i].kind !== "section_header") {
                root._selectedIndex = i
                return
            }
        }
        root._selectedIndex = 0
    }

    function _activateSelected() {
        if (root._selectedIndex < 0 || root._selectedIndex >= root._flatResults.length) return
        const item = root._flatResults[root._selectedIndex]
        if (!item || item.kind === "section_header") return
        root.itemActivated(item.kind, item.payload)
        root.close()
    }
}
