// Dialog résultats "que cuisiner avec ce que j'ai" (F5).
//
// Refonte UX (Phase 3) : 3 sections empilées au lieu d'un seuil unique :
//   ✨ Maintenant      — recettes 100% couvertes par la sélection
//   📝 Il te manque peu — recettes où il manque ≤ 3 ingrédients
//                          (affichage des noms manquants)
//   🛒 À acheter        — top 5 ingrédients qui débloqueraient le plus de
//                          recettes parmi celles "presque-prêtes"
//
// Le dialog reçoit son contenu via `setMatchesCategorized(result, count, parent)`.
// Compat ancienne : `open(items, count, parent)` reste pour rétrocompat (mais
// affichera tout dans la section "missing" en degraded mode).

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Window {
    id: root

    title: "Recettes possibles"
    width: 720
    height: 640
    minimumWidth: 540
    minimumHeight: 420
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
                     | Qt.WindowMinMaxButtonsHint
    modality: Qt.NonModal

    property int sourceIngredientCount: 0
    property int matchThreshold: 50  // legacy — non utilisé en mode catégorisé

    // ListModels par section
    ListModel { id: readyModel }
    ListModel { id: missingModel }
    ListModel { id: shoppingModel }

    // Refonte Phase 3 : entrée principale, prend un dict { ready, missing, shopping }
    function setMatchesCategorized(result, ingredientCount, parentWindow) {
        sourceIngredientCount = ingredientCount
        readyModel.clear()
        missingModel.clear()
        shoppingModel.clear()
        if (result && result.ready) {
            for (let i = 0; i < result.ready.length; i++) readyModel.append(result.ready[i])
        }
        if (result && result.missing) {
            for (let i = 0; i < result.missing.length; i++) {
                const r = result.missing[i]
                // QML ListModel n'aime pas les arrays imbriqués → on stringifie
                missingModel.append({
                    "recipeId":     r.recipeId,
                    "name":         r.name,
                    "score":        r.score,
                    "matchCount":   r.matchCount,
                    "totalCount":   r.totalCount,
                    "missingCount": r.missingCount,
                    "missingNamesStr": (r.missingNames || []).join(", "),
                    "photoUrl":     r.photoUrl || ""
                })
            }
        }
        if (result && result.shopping) {
            for (let i = 0; i < result.shopping.length; i++) shoppingModel.append(result.shopping[i])
        }
        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        show()
        raise()
    }

    // Compat ascendante — appelé par IngredientsPage actuellement avec un array
    // simple. On dégrade en mettant tout dans `missing` pour éviter de casser
    // le flow existant si l'appelant n'a pas migré.
    function open(items, ingredientCount, parentWindow) {
        sourceIngredientCount = ingredientCount
        readyModel.clear()
        missingModel.clear()
        shoppingModel.clear()
        for (let i = 0; i < items.length; i++) {
            const r = items[i]
            const m = (r.totalCount || 0) - (r.matchCount || 0)
            const dest = m === 0 ? readyModel : missingModel
            dest.append({
                "recipeId":     r.recipeId,
                "name":         r.name,
                "score":        r.score,
                "matchCount":   r.matchCount,
                "totalCount":   r.totalCount,
                "missingCount": m,
                "missingNamesStr": "",
                "photoUrl":     r.photoUrl || ""
            })
        }
        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        show()
        raise()
    }

    // ---- Composant interne : carte recette (réutilisée par 2 sections) ----
    component RecipeCard: AppListItem {
        property bool isReady: false
        height: 80
        width: ListView.view ? ListView.view.width : 600

        content: RowLayout {
            anchors.fill: parent
            spacing: Theme.spaceMd

            // Vignette photo
            Rectangle {
                Layout.preferredWidth: 60
                Layout.preferredHeight: 60
                radius: Theme.radiusSm
                color: Theme.colorSurfaceHover
                border.width: 1
                border.color: Theme.colorBorder
                clip: true
                Image {
                    anchors.fill: parent
                    anchors.margins: 1
                    source: model.photoUrl || ""
                    fillMode: Image.PreserveAspectCrop
                    visible: source != ""
                }
                Text {
                    anchors.centerIn: parent
                    visible: !model.photoUrl
                    text: "🍽"
                    font.pixelSize: 28
                    color: Theme.colorTextDisabled
                }
            }

            // Infos texte
            ColumnLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceXs

                Text {
                    Layout.fillWidth: true
                    text: model.name
                    color: Theme.colorText
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeMd
                    font.weight: Theme.fontWeightMedium
                    elide: Text.ElideRight
                }
                Text {
                    Layout.fillWidth: true
                    text: isReady
                          ? "✓ Tous les ingrédients dispo (" + model.totalCount + ")"
                          : "Il te manque " + model.missingCount + " ingrédient"
                            + (model.missingCount > 1 ? "s" : "")
                            + (model.missingNamesStr
                               ? " : " + model.missingNamesStr
                               : "")
                    color: isReady ? Theme.colorSuccess : Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXs
                    wrapMode: Text.WordWrap
                }
            }

            // Badge score
            Rectangle {
                Layout.preferredWidth: 56
                Layout.preferredHeight: 28
                radius: Theme.radiusFull
                color: isReady
                       ? Qt.alpha(Theme.colorSuccess, 0.18)
                       : Qt.alpha(Theme.colorPrimary, 0.12)
                Text {
                    anchors.centerIn: parent
                    text: isReady ? "✓ Prêt" : Math.round(model.score * 100) + "%"
                    color: isReady ? Theme.colorSuccess : Theme.colorPrimary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                    font.weight: Theme.fontWeightSemiBold
                }
            }
        }
    }

    // ---- Layout ----
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        Text {
            text: "Recettes possibles"
            color: Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXl
            font.weight: Theme.fontWeightSemiBold
        }
        Text {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            text: "Sélection : " + root.sourceIngredientCount + " ingrédient"
                + (root.sourceIngredientCount > 1 ? "s" : "") + "."
            color: Theme.colorTextSecondary
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeSm
        }

        // ScrollView avec les 3 sections empilées
        ScrollView {
            Layout.fillWidth: true
            Layout.fillHeight: true
            clip: true
            ScrollBar.vertical: AppScrollBar { orientation: Qt.Vertical }

            ColumnLayout {
                width: parent.width
                spacing: Theme.spaceLg

                // ============== Section "Maintenant" ==============
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spaceXs
                    visible: readyModel.count > 0

                    Text {
                        text: "✨  Tu peux faire maintenant  ·  " + readyModel.count
                              + " recette" + (readyModel.count > 1 ? "s" : "")
                        color: Theme.colorSuccess
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeMd
                        font.weight: Theme.fontWeightSemiBold
                    }
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: Math.min(320, readyModel.count * 82)
                        color: Theme.colorSurface
                        radius: Theme.radiusMd
                        border.width: 1
                        border.color: Qt.alpha(Theme.colorSuccess, 0.30)
                        ListView {
                            anchors.fill: parent
                            anchors.margins: 1
                            clip: true
                            interactive: false
                            model: readyModel
                            delegate: RecipeCard { isReady: true }
                        }
                    }
                }

                // ============== Section "Manquants" ==============
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spaceXs
                    visible: missingModel.count > 0

                    Text {
                        text: "📝  Il te manque peu  ·  " + missingModel.count
                              + " recette" + (missingModel.count > 1 ? "s" : "")
                        color: Theme.colorPrimary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeMd
                        font.weight: Theme.fontWeightSemiBold
                    }
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: Math.min(360, missingModel.count * 82)
                        color: Theme.colorSurface
                        radius: Theme.radiusMd
                        border.width: 1
                        border.color: Qt.alpha(Theme.colorPrimary, 0.30)
                        ListView {
                            anchors.fill: parent
                            anchors.margins: 1
                            clip: true
                            interactive: false
                            model: missingModel
                            delegate: RecipeCard { isReady: false }
                        }
                    }
                }

                // ============== Section "Shopping suggestions" ==============
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spaceXs
                    visible: shoppingModel.count > 0

                    Text {
                        text: "🛒  À acheter pour débloquer"
                        color: Theme.colorWarning
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeMd
                        font.weight: Theme.fontWeightSemiBold
                    }
                    Text {
                        Layout.fillWidth: true
                        text: "Ces ingrédients reviennent souvent dans les recettes presque-prêtes. "
                            + "Acheter l'un d'eux suffit à rendre plusieurs recettes immédiatement faisables."
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                        wrapMode: Text.WordWrap
                    }
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: shoppingModel.count * 40 + 4
                        color: Theme.colorSurface
                        radius: Theme.radiusMd
                        border.width: 1
                        border.color: Qt.alpha(Theme.colorWarning, 0.30)
                        ListView {
                            anchors.fill: parent
                            anchors.margins: 2
                            clip: true
                            interactive: false
                            model: shoppingModel
                            delegate: Rectangle {
                                width: ListView.view ? ListView.view.width : 600
                                height: 36
                                color: shoppingMouse.containsMouse ? Theme.colorSurfaceHover : Theme.colorTransparent
                                Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                                RowLayout {
                                    anchors.fill: parent
                                    anchors.leftMargin: Theme.spaceMd
                                    anchors.rightMargin: Theme.spaceMd
                                    spacing: Theme.spaceMd
                                    Text {
                                        text: "🛒"
                                        font.pixelSize: Theme.fontSizeMd
                                    }
                                    Text {
                                        Layout.fillWidth: true
                                        text: model.name
                                        color: Theme.colorText
                                        font.family: Theme.fontFamily
                                        font.pixelSize: Theme.fontSizeSm
                                        font.weight: Theme.fontWeightMedium
                                        elide: Text.ElideRight
                                    }
                                    Text {
                                        text: "→ débloque " + model.unlockCount + " recette"
                                              + (model.unlockCount > 1 ? "s" : "")
                                        color: Theme.colorWarning
                                        font.family: Theme.fontFamily
                                        font.pixelSize: Theme.fontSizeXs
                                        font.weight: Theme.fontWeightSemiBold
                                    }
                                }
                                MouseArea {
                                    id: shoppingMouse
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    ToolTip.visible: containsMouse
                                    ToolTip.text: "Cliquer pour ouvrir cet ingrédient en édition"
                                    ToolTip.delay: 600
                                    onClicked: {
                                        const win = Window.window
                                        if (win && win.transientParent && win.transientParent.navigateToIngredient) {
                                            win.transientParent.navigateToIngredient(model.ingredientId)
                                            root.close()
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // ============== Empty state ==============
                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 200
                    visible: readyModel.count === 0 && missingModel.count === 0 && shoppingModel.count === 0
                    Text {
                        Layout.alignment: Qt.AlignHCenter
                        text: "🍳"
                        font.pixelSize: 64
                        color: Theme.colorTextDisabled
                    }
                    Text {
                        Layout.alignment: Qt.AlignHCenter
                        text: "Aucune recette ne correspond avec ces ingrédients."
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeSm
                    }
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
}
