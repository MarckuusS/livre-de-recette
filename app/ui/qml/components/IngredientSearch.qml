// Recherche d'ingrédient avec popup de suggestions debounced (200 ms).
// Cherche via `ingredientVM.searchOnce(query, scope, limit)` — n'affecte PAS la
// liste principale du panneau Ingrédients.
//
//   IngredientSearch {
//     scope: "personal"           // ou "all" pour CIQUAL+OFF cachés
//     onIngredientPicked: (id) => editorVM.addLineById(id, qty, "")
//   }

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import App

Item {
    id: root

    property string scope: "personal"
    property string placeholderText: "Rechercher un ingrédient…"
    property int debounceMs: 200
    property int maxResults: 12

    // Re-run la search quand on change de scope (ex: toggle perso ↔ tout
    // dans le picker du dialog d'import de ticket).
    onScopeChanged: if (input.text.length > 0) searchTimer.restart()

    signal ingredientPicked(int ingredientId, string ingredientName)

    implicitHeight: input.implicitHeight
    implicitWidth: 320

    AppTextField {
        id: input
        anchors.fill: parent
        placeholderText: root.placeholderText
        onTextChanged: searchTimer.restart()
        onActiveFocusChanged: {
            if (!activeFocus && !popup.activeFocus)
                Qt.callLater(popup.close)
        }
        Keys.onDownPressed: {
            if (popup.opened && resultsView.count > 0) {
                resultsView.currentIndex = Math.min(resultsView.count - 1, resultsView.currentIndex + 1)
            }
        }
        Keys.onUpPressed: {
            if (popup.opened && resultsView.count > 0) {
                resultsView.currentIndex = Math.max(0, resultsView.currentIndex - 1)
            }
        }
        Keys.onReturnPressed: {
            if (popup.opened && resultsView.currentIndex >= 0)
                _pickAt(resultsView.currentIndex)
        }
        Keys.onEscapePressed: popup.close()
    }

    Timer {
        id: searchTimer
        interval: root.debounceMs
        repeat: false
        onTriggered: _runSearch()
    }

    ListModel { id: resultsModel }

    function _runSearch() {
        const q = input.text.trim()
        resultsModel.clear()
        if (q.length < 1) {
            popup.close()
            return
        }
        if (typeof ingredientVM === "undefined" || !ingredientVM) {
            return  // VM pas encore branché (cas test)
        }
        const matches = ingredientVM.searchOnce(q, root.scope, root.maxResults)
        for (let i = 0; i < matches.length; i++) {
            // Sanitize : un dict Python avec champ None devient null JS, mais
            // un champ absent devient undefined — qui passe le check !== null.
            // On force tout en `number` ou en valeur sentinelle pour que le
            // ListModel ne râle pas ("kcal is undefined").
            const m = matches[i]
            resultsModel.append({
                "ingredientId": m.id || 0,
                "name":         m.name || "",
                "source":       m.source || "manual",
                "kcal":         (typeof m.kcal === "number") ? m.kcal : -1,
                "pieceWeightG": (typeof m.pieceWeightG === "number") ? m.pieceWeightG : 0
            })
        }
        if (resultsModel.count > 0) {
            resultsView.currentIndex = 0
            if (!popup.opened)
                popup.open()
        } else {
            popup.close()
        }
    }

    function _pickAt(index) {
        if (index < 0 || index >= resultsModel.count) return
        const item = resultsModel.get(index)
        root.ingredientPicked(item.ingredientId, item.name)
        input.clear()
        resultsModel.clear()
        popup.close()
    }

    AppPopup {
        id: popup
        x: 0
        y: input.height + 4
        width: input.width
        implicitHeight: Math.min(resultsView.contentHeight + Theme.spaceXs * 2, 280)
        padding: Theme.spaceXs

        contentItem: ListView {
            id: resultsView
            clip: true
            model: resultsModel
            currentIndex: -1
            spacing: 0
            ScrollIndicator.vertical: ScrollIndicator {}

            delegate: AppListItem {
                width: ListView.view.width
                height: 38
                selected: index === resultsView.currentIndex
                onClicked: root._pickAt(index)
                onHoveredChanged: if (hovered) resultsView.currentIndex = index

                content: RowLayout {
                    anchors.fill: parent
                    spacing: Theme.spaceSm

                    Text {
                        Layout.fillWidth: true
                        text: model.name
                        color: Theme.colorText
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeMd
                        elide: Text.ElideRight
                        verticalAlignment: Text.AlignVCenter
                    }
                    Rectangle {
                        Layout.preferredHeight: 18
                        Layout.preferredWidth: srcLabel.implicitWidth + Theme.spaceSm * 2
                        radius: Theme.radiusSm
                        color: model.source === "ciqual"
                               ? Qt.alpha("#15803d", 0.12)
                               : model.source === "openfoodfacts"
                                 ? Qt.alpha("#1d4ed8", 0.12)
                                 : Qt.alpha("#c2410c", 0.12)
                        Text {
                            id: srcLabel
                            anchors.centerIn: parent
                            text: model.source === "ciqual" ? "CIQUAL"
                                : model.source === "openfoodfacts" ? "OFF" : "perso"
                            color: model.source === "ciqual" ? "#15803d"
                                : model.source === "openfoodfacts" ? "#1d4ed8" : "#c2410c"
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXs
                            font.weight: Theme.fontWeightSemiBold
                        }
                    }
                    Text {
                        visible: model.pieceWeightG > 0
                        text: "● 1 pc = " + model.pieceWeightG + " g"
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                    }
                }
            }
        }
    }

    function clear() {
        input.clear()
        resultsModel.clear()
        popup.close()
    }
}
