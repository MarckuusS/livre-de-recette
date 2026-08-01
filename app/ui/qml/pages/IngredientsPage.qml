// Onglet 1 — bibliothèque personnelle d'ingrédients.
//
// Layout : barre de recherche + bouton Importer en haut, splitter horizontal
// en bas (liste à gauche, formulaire d'édition à droite).
// Câblage Python : `ingredientVM` (context property) — ses propriétés
// `items` (QAbstractListModel), slots `setFilter`, `getAsDict`, `saveFromDict`,
// `deleteIngredient`.

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
import App
import "../components"
import "../dialogs"

Item {
    id: page

    // ---- État local : id de l'ingrédient sélectionné, +1 pour pouvoir distinguer
    //      "rien sélectionné" (-1) du nouveau (-2). ----
    property int selectedId: -1

    // F5 : ingrédients cochés pour la recherche "que cuisiner avec".
    property var selectedIngredientIds: []  // list of int

    function _toggleIngredientSelection(id) {
        const idx = page.selectedIngredientIds.indexOf(id)
        if (idx >= 0) {
            page.selectedIngredientIds = page.selectedIngredientIds.filter(function(x) { return x !== id })
        } else {
            page.selectedIngredientIds = [...page.selectedIngredientIds, id]
        }
    }
    function _clearIngredientSelection() {
        page.selectedIngredientIds = []
    }
    function _findRecipes(minMatch) {
        // Refonte UX (Phase 3) : on utilise le slot catégorisé qui retourne
        // 3 listes (ready / missing / shopping). `minMatch` n'est plus utilisé
        // — on utilise `max_missing=3` côté repo pour cadrer les "presque-prêtes".
        const result = recipeListVM.findByIngredientsCategorized(page.selectedIngredientIds, 3)
        recipeMatchDialog.setMatchesCategorized(
            result, page.selectedIngredientIds.length, Window.window,
        )
    }

    // ============================================================ Drag overlay (vers Frigo / Cellier)
    //
    // Refonte UX : un ingrédient peut être glissé depuis la liste vers
    // l'onglet "Frigo / Cellier" (la TabBar auto-switch après 300 ms de
    // hover, puis on drop sur la liste du frigo). Le visuel "fantôme" qui
    // suit la souris vit ici en overlay du `page` Item — pas dans la
    // ListView (qui aurait clip:true et l'empêcherait de sortir).

    Item {
        id: dragGhost
        z: 1000
        width: 220
        height: 32
        visible: false

        // Données portées par le drag — le DropArea cible lit ces props
        // (drop.source.ingredientId, drop.source.pieceWeightG, etc.)
        property int ingredientId: -1
        property string ingredientName: ""
        property real pieceWeightG: 0
        property string sourceTag: "manual"

        Drag.active: false
        Drag.dragType: Drag.Internal
        Drag.hotSpot.x: width / 2
        Drag.hotSpot.y: height / 2

        Rectangle {
            anchors.fill: parent
            radius: Theme.radiusFull
            color: Qt.alpha(Theme.colorPrimary, 0.92)
            border.width: 1
            border.color: Theme.colorPrimary

            Text {
                anchors.centerIn: parent
                text: "🛒  " + dragGhost.ingredientName
                color: "white"
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
                font.weight: Theme.fontWeightSemiBold
                elide: Text.ElideRight
                width: parent.width - Theme.spaceMd * 2
                horizontalAlignment: Text.AlignHCenter
            }
        }
    }

    // ============================================================ Layout racine

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        // ---- Barre supérieure : recherche + bouton importer ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceMd

            AppTextField {
                id: searchField
                Layout.fillWidth: true
                placeholderText: "Rechercher dans ma bibliothèque personnelle…"
                onTextChanged: searchDebounce.restart()
            }
            Timer {
                id: searchDebounce
                interval: 200
                repeat: false
                onTriggered: ingredientVM.setFilter(searchField.text)
            }

            AppButton {
                text: "Importer (CIQUAL / OFF)"
                variant: "secondary"
                onClicked: importDialog.openCentered(Window.window)
            }
        }

        // ---- Barre de contrôles : tri / groupement / filtres avancés ----
        // Refonte UX : le toggle "De saison" historique est remplacé par un
        // système de filtres complet géré côté VM (sources, rayons, macros,
        // toggles binaires). Le bouton "🔧 Filtres" ouvre un dialog dédié.
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceMd

            Text {
                text: "Trier :"
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
            }
            AppComboBox {
                Layout.preferredWidth: 200
                model: [
                    "Nom (A→Z)", "Nom (Z→A)",
                    "Énergie ↑", "Énergie ↓",
                    "Protéines ↑", "Protéines ↓",
                    "Glucides ↑", "Glucides ↓",
                    "Lipides ↑", "Lipides ↓",
                    "Fibres ↑", "Fibres ↓",
                    "Sel ↑", "Sel ↓",
                    "Prix ↑", "Prix ↓",
                    "Récents", "Anciens"
                ]
                readonly property var _fields: [
                    "name_asc", "name_desc",
                    "kcal_asc", "kcal_desc",
                    "proteins_asc", "proteins_desc",
                    "carbs_asc", "carbs_desc",
                    "fats_asc", "fats_desc",
                    "fiber_asc", "fiber_desc",
                    "salt_asc", "salt_desc",
                    "price_asc", "price_desc",
                    "created_desc", "created_asc"
                ]
                currentIndex: {
                    if (!ingredientVM) return 0
                    const idx = _fields.indexOf(ingredientVM.sortBy)
                    return idx >= 0 ? idx : 0
                }
                onActivated: function(idx) {
                    if (ingredientVM) ingredientVM.setSortBy(_fields[idx])
                }
            }

            Text {
                text: "Grouper :"
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
            }
            AppComboBox {
                Layout.preferredWidth: 160
                model: ["Aucun", "Source", "Rayon", "Saisonnalité", "Tranche kcal"]
                readonly property var _fields: ["none", "source", "rayon", "season", "kcal_range"]
                currentIndex: {
                    if (!ingredientVM) return 0
                    const idx = _fields.indexOf(ingredientVM.groupBy)
                    return idx >= 0 ? idx : 0
                }
                onActivated: function(idx) {
                    if (ingredientVM) ingredientVM.setGroupBy(_fields[idx])
                }
            }

            Item { Layout.fillWidth: true }

            AppButton {
                id: filtersButton
                readonly property int activeCount:
                    ingredientVM ? ingredientVM.activeFilterCount : 0
                text: activeCount > 0
                      ? "🔧 Filtres · " + activeCount
                      : "🔧 Filtres"
                variant: activeCount > 0 ? "primary" : "secondary"
                onClicked: {
                    const win = Window.window
                    if (win && win.ingredientFilterDialog) {
                        win.ingredientFilterDialog.openCentered(win)
                    }
                }
            }
        }

        // ---- Splitter principal ----
        SplitView {
            id: splitter
            Layout.fillWidth: true
            Layout.fillHeight: true
            orientation: Qt.Horizontal

            handle: Rectangle {
                implicitWidth: 5
                color: SplitHandle.pressed
                       ? Theme.colorBorderHover
                       : SplitHandle.hovered
                         ? Theme.colorBorder
                         : Theme.colorTransparent
                Behavior on color { ColorAnimation { duration: Theme.durationFast } }
            }

            // ============================================================ Panneau gauche
            ColumnLayout {
                SplitView.preferredWidth: splitter.width * 0.42
                SplitView.minimumWidth: 280
                spacing: Theme.spaceSm

                // Boutons Nouveau / Retirer
                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spaceSm
                    AppButton {
                        text: "Nouveau"
                        variant: "primary"
                        onClicked: page._loadNew()
                    }
                    AppButton {
                        text: "Retirer"
                        variant: "secondary"
                        enabled: page.selectedId > 0
                        onClicked: page._deleteCurrent()
                    }
                    Item { Layout.fillWidth: true }  // spacer
                }

                // ---- Bandeau "Trouve-moi des recettes" (F5) ----
                Rectangle {
                    Layout.fillWidth: true
                    visible: page.selectedIngredientIds.length >= 2
                    Layout.preferredHeight: visible ? findBandRow.implicitHeight + Theme.spaceMd * 2 : 0
                    color: Qt.alpha(Theme.colorPrimary, 0.08)
                    border.width: 1
                    border.color: Qt.alpha(Theme.colorPrimary, 0.30)
                    radius: Theme.radiusMd

                    RowLayout {
                        id: findBandRow
                        anchors.fill: parent
                        anchors.leftMargin: Theme.spaceMd
                        anchors.rightMargin: Theme.spaceMd
                        spacing: Theme.spaceSm

                        Text {
                            text: "🔍"
                            font.pixelSize: Theme.fontSizeLg
                        }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 0
                            Text {
                                text: page.selectedIngredientIds.length + " ingrédient"
                                      + (page.selectedIngredientIds.length > 1 ? "s" : "")
                                      + " sélectionné"
                                      + (page.selectedIngredientIds.length > 1 ? "s" : "")
                                color: Theme.colorText
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                font.weight: Theme.fontWeightSemiBold
                            }
                            Text {
                                text: "Désélectionner"
                                color: Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeXs
                                MouseArea {
                                    anchors.fill: parent
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: page._clearIngredientSelection()
                                }
                            }
                        }
                        AppButton {
                            text: "Trouver les recettes"
                            variant: "primary"
                            onClicked: page._findRecipes(0.5)
                        }
                    }
                }

                // Liste des ingrédients
                Rectangle {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    color: Theme.colorSurface
                    radius: Theme.radiusMd
                    border.width: 1
                    border.color: Theme.colorBorder

                    ListView {
                        id: ingredientsList
                        anchors.fill: parent
                        anchors.margins: 1
                        clip: true
                        model: ingredientVM ? ingredientVM.items : null
                        currentIndex: -1
                        ScrollBar.vertical: AppScrollBar {}

                        // Section header dynamique selon le `groupBy` du VM.
                        // Le rôle `groupKey` du model retourne "" quand
                        // groupBy == "none" → la section.delegate ne montre
                        // rien (height 0).
                        section.property: "groupKey"
                        section.criteria: ViewSection.FullString
                        section.delegate: Rectangle {
                            width: ListView.view.width
                            height: section ? 28 : 0
                            visible: section ? true : false
                            color: Qt.alpha(Theme.colorPrimary, 0.06)
                            Text {
                                anchors.left: parent.left
                                anchors.leftMargin: Theme.spaceMd
                                anchors.verticalCenter: parent.verticalCenter
                                text: section || ""
                                color: Theme.colorPrimary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                font.weight: Theme.fontWeightSemiBold
                                font.letterSpacing: 0.4
                            }
                        }

                        delegate: AppListItem {
                            width: ListView.view.width
                            // Filtrage moved server-side dans le VM (refonte UX
                            // filtres avancés) → tous les delegates sont visibles
                            // ; les rows non désirées sont déjà absentes du model.
                            height: 52
                            selected: index === ingredientsList.currentIndex
                            onClicked: {
                                ingredientsList.currentIndex = index
                                page._loadIngredient(model.ingredientId)
                            }

                            content: RowLayout {
                                anchors.fill: parent
                                spacing: Theme.spaceSm

                                // F5 : checkbox pour la recherche multi-ingrédient
                                AppCheckBox {
                                    Layout.alignment: Qt.AlignVCenter
                                    checked: page.selectedIngredientIds.indexOf(model.ingredientId) !== -1
                                    onClicked: page._toggleIngredientSelection(model.ingredientId)
                                }

                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: 2

                                    RowLayout {
                                        spacing: Theme.spaceSm
                                        Text {
                                            Layout.fillWidth: true
                                            text: model.name
                                        color: Theme.colorText
                                        font.family: Theme.fontFamily
                                        font.pixelSize: Theme.fontSizeMd
                                        font.weight: Theme.fontWeightMedium
                                        elide: Text.ElideRight
                                    }
                                    Rectangle {
                                        Layout.preferredHeight: 18
                                        Layout.preferredWidth: srcBadge.implicitWidth + Theme.spaceSm * 2
                                        radius: Theme.radiusSm
                                        color: model.source === "ciqual"
                                               ? Qt.alpha("#15803d", 0.14)
                                               : model.source === "openfoodfacts"
                                                 ? Qt.alpha("#1d4ed8", 0.14)
                                                 : Qt.alpha("#c2410c", 0.14)
                                        Text {
                                            id: srcBadge
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
                                    // C3 : badge "🌱 de saison" si l'ingrédient est en saison ce mois-ci
                                    Rectangle {
                                        visible: model.inSeasonNow === true
                                        Layout.preferredHeight: 18
                                        Layout.preferredWidth: seasonBadge.implicitWidth + Theme.spaceSm * 2
                                        radius: Theme.radiusSm
                                        color: Qt.alpha(Theme.colorSuccess, 0.14)
                                        Text {
                                            id: seasonBadge
                                            anchors.centerIn: parent
                                            text: "🌱 saison"
                                            color: Theme.colorSuccess
                                            font.family: Theme.fontFamily
                                            font.pixelSize: Theme.fontSizeXs
                                            font.weight: Theme.fontWeightSemiBold
                                        }
                                    }
                                    }
                                    RowLayout {
                                        spacing: Theme.spaceSm
                                        // Note : `text` est évalué même quand `visible:false`,
                                        // donc le check doit être fait DANS l'expression text
                                        // — sinon `undefined.toFixed()` → TypeError.
                                        // Couleurs nutriments (méta officielle) :
                                        //   Protéines = bleu (#0B6BBB)
                                        //   Glucides  = vert (#509938)
                                        //   Lipides   = orange (#FDA406)
                                        Text {
                                            visible: typeof model.proteins === "number"
                                            text: "P " + (typeof model.proteins === "number" ? model.proteins.toFixed(1) : "—") + "g"
                                            color: "#0B6BBB"
                                            font.family: Theme.fontFamily
                                            font.pixelSize: Theme.fontSizeXs
                                        }
                                        Text {
                                            visible: typeof model.carbs === "number"
                                            text: "G " + (typeof model.carbs === "number" ? model.carbs.toFixed(1) : "—") + "g"
                                            color: "#509938"
                                            font.family: Theme.fontFamily
                                            font.pixelSize: Theme.fontSizeXs
                                        }
                                        Text {
                                            visible: typeof model.fats === "number"
                                            text: "L " + (typeof model.fats === "number" ? model.fats.toFixed(1) : "—") + "g"
                                            color: "#FDA406"
                                            font.family: Theme.fontFamily
                                            font.pixelSize: Theme.fontSizeXs
                                        }
                                        Text {
                                            visible: model.pieceWeightG !== null && model.pieceWeightG > 0
                                            text: "● 1 pc = " + model.pieceWeightG + " g"
                                            color: Theme.colorTextSecondary
                                            font.family: Theme.fontFamily
                                            font.pixelSize: Theme.fontSizeXs
                                        }
                                        Item { Layout.fillWidth: true }
                                    }
                                }

                                // Drag handle "⠿" : glisse cet ingrédient vers
                                // l'onglet Frigo / Cellier de la TabBar (auto-
                                // switch puis drop sur la liste du frigo).
                                Rectangle {
                                    id: dragHandle
                                    Layout.preferredWidth: 28
                                    Layout.preferredHeight: 28
                                    Layout.alignment: Qt.AlignVCenter
                                    radius: Theme.radiusSm
                                    color: handleArea.containsMouse
                                           ? Qt.alpha(Theme.colorPrimary, 0.12)
                                           : Theme.colorTransparent

                                    Behavior on color { ColorAnimation { duration: Theme.durationFast } }

                                    Text {
                                        anchors.centerIn: parent
                                        text: "⠿"
                                        color: handleArea.containsMouse
                                               ? Theme.colorPrimary
                                               : Theme.colorTextSecondary
                                        font.family: Theme.fontFamily
                                        font.pixelSize: Theme.fontSizeLg
                                        font.weight: Theme.fontWeightSemiBold
                                    }

                                    MouseArea {
                                        id: handleArea
                                        anchors.fill: parent
                                        hoverEnabled: true
                                        cursorShape: Qt.OpenHandCursor
                                        drag.target: dragGhost
                                        drag.threshold: 4

                                        ToolTip.visible: containsMouse && !drag.active
                                        ToolTip.text: "Glisser vers l'onglet Frigo / Cellier pour ajouter au stock"
                                        ToolTip.delay: 600

                                        onPressed: function(mouse) {
                                            cursorShape = Qt.ClosedHandCursor
                                            // Setup le ghost : porte les infos de cet ingrédient
                                            dragGhost.ingredientId = model.ingredientId
                                            dragGhost.ingredientName = model.name
                                            dragGhost.pieceWeightG = model.pieceWeightG || 0
                                            dragGhost.sourceTag = model.source || "manual"
                                            // Place le ghost à la position globale de la souris
                                            const pt = handleArea.mapToItem(page, mouse.x, mouse.y)
                                            dragGhost.x = pt.x - dragGhost.width / 2
                                            dragGhost.y = pt.y - dragGhost.height / 2
                                            dragGhost.visible = true
                                            dragGhost.Drag.active = true
                                        }
                                        onReleased: {
                                            cursorShape = Qt.OpenHandCursor
                                            dragGhost.Drag.drop()
                                            dragGhost.Drag.active = false
                                            dragGhost.visible = false
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Empty state
                    ColumnLayout {
                        anchors.centerIn: parent
                        visible: ingredientsList.count === 0 && searchField.text.trim() === ""
                        spacing: Theme.spaceSm
                        Text {
                            Layout.alignment: Qt.AlignHCenter
                            text: "Bibliothèque vide"
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeLg
                            font.weight: Theme.fontWeightMedium
                        }
                        Text {
                            Layout.preferredWidth: 280
                            Layout.alignment: Qt.AlignHCenter
                            wrapMode: Text.WordWrap
                            horizontalAlignment: Text.AlignHCenter
                            text: "Crée un ingrédient avec « Nouveau » ou importe-en depuis CIQUAL / OpenFoodFacts."
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeSm
                        }
                    }
                }
            }

            // ============================================================ Panneau droit
            Flickable {
                SplitView.fillWidth: true
                contentWidth: width
                contentHeight: editForm.implicitHeight + Theme.spaceXl * 2
                clip: true
                ScrollBar.vertical: AppScrollBar {}

                ColumnLayout {
                    id: editForm
                    // Cap la largeur du formulaire pour éviter que les champs ne s'étirent
                    // au-delà de ~720 px sur un écran large — au-delà la lecture devient
                    // difficile. Sur un écran étroit, on prend toute la largeur dispo.
                    width: Math.min(parent.width - Theme.spaceXl, 720)
                    x: Theme.spaceLg
                    y: Theme.spaceLg
                    spacing: Theme.spaceSm

                    Text {
                        text: page.selectedId > 0 ? "Modifier l'ingrédient"
                            : page.selectedId === -2 ? "Nouvel ingrédient"
                            : "Sélectionne un ingrédient pour le modifier"
                        color: page.selectedId !== -1 ? Theme.colorText : Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXl
                        font.weight: Theme.fontWeightSemiBold
                    }

                    GridLayout {
                        Layout.fillWidth: true
                        columns: 2
                        columnSpacing: Theme.spaceMd
                        rowSpacing: Theme.spaceSm
                        enabled: page.selectedId !== -1

                        Text { text: "Nom :"; color: Theme.colorText; Layout.alignment: Qt.AlignRight }
                        AppTextField {
                            id: nameField
                            Layout.fillWidth: true
                            Layout.minimumWidth: 200
                            Layout.maximumWidth: 480
                        }

                        Text { text: "Source :"; color: Theme.colorText; Layout.alignment: Qt.AlignRight }
                        // Hyperlink vers la fiche du produit sur le site de la
                        // source (CIQUAL ou OpenFoodFacts), ouvert dans le
                        // navigateur via `Qt.openUrlExternally`. Pour `manuel`
                        // ou source vide : juste du texte sans lien.
                        Text {
                            id: sourceLabel
                            property string sourceName: "manuel"   // mis à jour par _loadIngredient
                            property string sourceRefValue: ""     // idem
                            Layout.fillWidth: true
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeMd
                            textFormat: Text.RichText
                            text: {
                                if (sourceName === "ciqual" && sourceRefValue) {
                                    return '<a style="color:#1d4ed8;" href="https://ciqual.anses.fr/#/aliments/'
                                        + encodeURIComponent(sourceRefValue) + '">ciqual ↗</a>'
                                }
                                if (sourceName === "openfoodfacts" && sourceRefValue) {
                                    return '<a style="color:#1d4ed8;" href="https://world.openfoodfacts.org/product/'
                                        + encodeURIComponent(sourceRefValue) + '">openfoodfacts ↗</a>'
                                }
                                return sourceName
                            }
                            onLinkActivated: function(link) { Qt.openUrlExternally(link) }
                            // Cursor pointer sur le lien (sans MouseArea, on
                            // utilise hoveredLink + cursorShape via HoverHandler).
                            HoverHandler {
                                cursorShape: parent.hoveredLink !== "" ? Qt.PointingHandCursor : Qt.ArrowCursor
                            }
                        }

                        Text { text: "Réf. source :"; color: Theme.colorText; Layout.alignment: Qt.AlignRight }
                        AppTextField {
                            id: sourceRefField
                            Layout.fillWidth: true
                            Layout.minimumWidth: 200
                            Layout.maximumWidth: 320
                            placeholderText: "Code CIQUAL ou code-barres EAN (optionnel)"
                        }

                        // Marque commerciale — auto-rempli depuis OFF, éditable.
                        Text { text: "Marque :"; color: Theme.colorText; Layout.alignment: Qt.AlignRight }
                        AppTextField {
                            id: brandField
                            Layout.fillWidth: true
                            Layout.minimumWidth: 200
                            Layout.maximumWidth: 320
                            placeholderText: "Ex : Pâturages, Carrefour Bio… (optionnel)"
                        }

                        // ---- Tableau nutritionnel (ordre réglementaire UE) ----
                        // Énergie → Lipides (dont saturés) → Glucides (dont sucres)
                        // → Fibres → Protéines → Sel. Chaque libellé a son picto
                        // PNG juste avant le champ de saisie (style "Lipides ⬢ 12 g").
                        // Les sous-lignes (dont saturés / dont sucres) sont grisées
                        // et en italique pour coller à la convention des étiquettes.
                        NutrientLabel { type: "energy"; text: "Énergie"; Layout.alignment: Qt.AlignRight }
                        FixedUnitField { id: kcalField; Layout.fillWidth: true; Layout.maximumWidth: 200; unitText: "kcal/100g"; maxValue: 2000 }

                        NutrientLabel { type: "fats"; text: "Lipides"; Layout.alignment: Qt.AlignRight }
                        FixedUnitField { id: fatsField; Layout.fillWidth: true; Layout.maximumWidth: 200; unitText: "g/100g" }

                        NutrientLabel { type: "saturatedFats"; text: "dont saturés"; subline: true; Layout.alignment: Qt.AlignRight }
                        FixedUnitField { id: satFatsField; Layout.fillWidth: true; Layout.maximumWidth: 200; unitText: "g/100g" }

                        NutrientLabel { type: "carbs"; text: "Glucides"; Layout.alignment: Qt.AlignRight }
                        FixedUnitField { id: carbsField; Layout.fillWidth: true; Layout.maximumWidth: 200; unitText: "g/100g" }

                        NutrientLabel { type: "sugars"; text: "dont sucres"; subline: true; Layout.alignment: Qt.AlignRight }
                        FixedUnitField { id: sugarsField; Layout.fillWidth: true; Layout.maximumWidth: 200; unitText: "g/100g" }

                        NutrientLabel { type: "fiber"; text: "Fibres"; Layout.alignment: Qt.AlignRight }
                        FixedUnitField { id: fiberField; Layout.fillWidth: true; Layout.maximumWidth: 200; unitText: "g/100g" }

                        NutrientLabel { type: "proteins"; text: "Protéines"; Layout.alignment: Qt.AlignRight }
                        FixedUnitField { id: proteinsField; Layout.fillWidth: true; Layout.maximumWidth: 200; unitText: "g/100g" }

                        NutrientLabel { type: "salt"; text: "Sel"; Layout.alignment: Qt.AlignRight }
                        FixedUnitField { id: saltField; Layout.fillWidth: true; Layout.maximumWidth: 200; unitText: "g/100g" }

                        // Séparateur visuel
                        Item { Layout.columnSpan: 2; Layout.preferredHeight: Theme.spaceSm }

                        // ---- Prix (lecture seule — auto-calculé depuis l'historique) ----
                        Text { text: "Prix (€) :"; color: Theme.colorText; Layout.alignment: Qt.AlignRight }
                        RowLayout {
                            Layout.fillWidth: true
                            Layout.maximumWidth: 360
                            spacing: Theme.spaceSm

                            // Cellule en lecture seule — affichage du prix de référence.
                            // Le prix est dérivé du dernier enregistrement de l'historique
                            // (`PriceHistoryRepo.latest_for_ingredient`). L'utilisateur ne
                            // peut plus l'éditer directement : il enregistre des observations
                            // dans le dialog ouvert par le bouton "📊 Historique".
                            Rectangle {
                                id: priceDisplay
                                Layout.fillWidth: true
                                Layout.minimumWidth: 120
                                Layout.maximumWidth: 200
                                Layout.preferredHeight: Theme.controlHeightMd
                                color: Theme.colorSurfaceHover
                                radius: Theme.radiusMd
                                border.width: 1
                                border.color: Theme.colorBorder

                                property string priceText: ""    // ex : "1,2000"

                                Text {
                                    anchors.left: parent.left
                                    anchors.leftMargin: Theme.spaceMd
                                    anchors.right: lockIcon.left
                                    anchors.rightMargin: Theme.spaceXs
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: priceDisplay.priceText || "—"
                                    color: priceDisplay.priceText ? Theme.colorText : Theme.colorTextDisabled
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeMd
                                    elide: Text.ElideRight
                                }
                                Text {
                                    id: lockIcon
                                    anchors.right: parent.right
                                    anchors.rightMargin: Theme.spaceSm
                                    anchors.verticalCenter: parent.verticalCenter
                                    text: "🔒"
                                    color: Theme.colorTextDisabled
                                    font.pixelSize: Theme.fontSizeXs
                                }
                            }

                            // Bouton "Historique" — point d'entrée unique pour modifier
                            // le prix : ouvrir l'historique, ajouter une observation,
                            // et la valeur affichée se met à jour via le signal
                            // `current_price_recomputed`.
                            AppButton {
                                id: priceHistoryButton
                                text: "📊  Historique"
                                variant: "secondary"
                                Layout.minimumWidth: 140
                                enabled: page.selectedId !== -1
                                ToolTip.visible: hovered
                                ToolTip.text: enabled
                                              ? "Saisir / consulter l'historique des prix"
                                              : "Sélectionne un ingrédient d'abord"
                                ToolTip.delay: 300
                                onClicked: priceHistoryDialog.openFor(
                                    page.selectedId,
                                    nameField.text || "(sans nom)",
                                    priceQtyDisplay.qtyValue
                                )
                            }
                        }

                        // ---- Quantité de référence (lecture seule) ----
                        Text { text: "Quantité de réf. :"; color: Theme.colorText; Layout.alignment: Qt.AlignRight }
                        Rectangle {
                            id: priceQtyDisplay
                            Layout.fillWidth: true
                            Layout.maximumWidth: 320
                            Layout.preferredHeight: Theme.controlHeightMd
                            color: Theme.colorSurfaceHover
                            radius: Theme.radiusMd
                            border.width: 1
                            border.color: Theme.colorBorder

                            property real qtyValue: 0

                            Text {
                                anchors.left: parent.left
                                anchors.leftMargin: Theme.spaceMd
                                anchors.right: qtyLockIcon.left
                                anchors.rightMargin: Theme.spaceXs
                                anchors.verticalCenter: parent.verticalCenter
                                text: priceQtyDisplay.qtyValue > 0
                                      ? Number(priceQtyDisplay.qtyValue).toLocaleString(Qt.locale(), 'f', 1) + " g"
                                      : "—"
                                color: priceQtyDisplay.qtyValue > 0 ? Theme.colorText : Theme.colorTextDisabled
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeMd
                                elide: Text.ElideRight
                            }
                            Text {
                                id: qtyLockIcon
                                anchors.right: parent.right
                                anchors.rightMargin: Theme.spaceSm
                                anchors.verticalCenter: parent.verticalCenter
                                text: "🔒"
                                color: Theme.colorTextDisabled
                                font.pixelSize: Theme.fontSizeXs
                            }
                        }

                        // ---- Hint commun aux deux cellules ----
                        Item { Layout.preferredWidth: 1; Layout.preferredHeight: 1 }   // colonne 1, vide
                        Text {
                            Layout.fillWidth: true
                            Layout.maximumWidth: 360
                            text: "Calculé automatiquement depuis le dernier prix de l'historique."
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXs
                            font.italic: true
                            wrapMode: Text.WordWrap
                        }

                        Text { text: "Poids unitaire :"; color: Theme.colorText; Layout.alignment: Qt.AlignRight }
                        FixedUnitField {
                            id: pieceWeightField
                            Layout.fillWidth: true
                            Layout.maximumWidth: 200
                            unitText: "g / pièce"
                            maxValue: 10000
                        }

                        // Poids cuit (optionnel, pour estimer le poids d'une
                        // portion servie). Convention : combien pèsent 100 g
                        // cru de cet ingrédient une fois cuit. Vide = 1:1
                        // (huiles, sel, légumes mangés crus). Les valeurs
                        // nutritionnelles restent calculées en cru.
                        Text { text: "Poids cuit :"; color: Theme.colorText; Layout.alignment: Qt.AlignRight }
                        ColumnLayout {
                            Layout.fillWidth: true
                            Layout.maximumWidth: 360
                            spacing: 4
                            FixedUnitField {
                                id: cookedWeightField
                                Layout.fillWidth: true
                                Layout.maximumWidth: 200
                                unitText: "g / 100 g cru"
                                maxValue: 1000
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "Ex : 300 pour du riz (100 g cru → 300 g cuit). "
                                    + "Optionnel — sert à estimer le poids d'une portion servie. "
                                    + "Les valeurs nutritionnelles restent par 100 g cru."
                                color: Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeXs
                                font.italic: true
                                wrapMode: Text.WordWrap
                            }
                        }

                        // ---- Refonte UX : Rayon (au lieu de Catégorie L1/L2) ----
                        // Le `category_l1` en DB stocke le rayon. La hiérarchie L1/L2
                        // a été abandonnée (trop dense). `category_l2` est forcé à
                        // null au save mais on ne le supprime pas du schéma DB pour
                        // ne pas perdre les seeds CIQUAL existants.
                        Text { text: "Rayon :"; color: Theme.colorText; Layout.alignment: Qt.AlignRight }
                        ColumnLayout {
                            Layout.fillWidth: true
                            Layout.maximumWidth: 360
                            spacing: 4

                            QtObject {
                                id: categoryFields
                                property string l1: ""    // = nom du rayon
                            }

                            AppButton {
                                Layout.fillWidth: true
                                text: categoryFields.l1
                                      ? "📁  " + categoryFields.l1
                                      : "📁  Choisir un rayon…"
                                variant: categoryFields.l1 ? "secondary" : "ghost"
                                onClicked: {
                                    const win = Window.window
                                    if (!win || !win.categoryPickerDialog) return
                                    function _onPicked(l1, _l2) {
                                        categoryFields.l1 = l1
                                        win.categoryPickerDialog.categorySelected.disconnect(_onPicked)
                                    }
                                    win.categoryPickerDialog.categorySelected.connect(_onPicked)
                                    win.categoryPickerDialog.openPicker(categoryFields.l1, "", win)
                                }
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "Impact : regroupement dans liste de courses + frigo / cellier. "
                                    + "Édite la liste via Fichier → Paramètres → Rayons d'ingrédients."
                                color: Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeXs
                                font.italic: true
                                wrapMode: Text.WordWrap
                            }
                        }

                        // ---- Phase F : Saisonnalité (12 toggles mois) ----
                        Text { text: "De saison :"; color: Theme.colorText; Layout.alignment: Qt.AlignRight }
                        ColumnLayout {
                            Layout.fillWidth: true
                            spacing: 4

                            // Liste de mois sélectionnés (1..12), partagée par les 12 boutons
                            property var selectedMonths: []

                            // Setter pratique appelé depuis _loadIngredient
                            function setFromCsv(csv) {
                                if (!csv || csv === "") {
                                    selectedMonths = []
                                    return
                                }
                                const parts = csv.toString().split(",")
                                const nums = []
                                for (let i = 0; i < parts.length; i++) {
                                    const n = parseInt(parts[i].trim(), 10)
                                    if (!isNaN(n) && n >= 1 && n <= 12) nums.push(n)
                                }
                                selectedMonths = nums
                            }
                            function toCsv() {
                                return selectedMonths.slice().sort(function(a, b) { return a - b }).join(",")
                            }
                            function toggleMonth(n) {
                                const idx = selectedMonths.indexOf(n)
                                if (idx >= 0) {
                                    selectedMonths = selectedMonths.filter(function(x) { return x !== n })
                                } else {
                                    selectedMonths = selectedMonths.concat([n])
                                }
                            }

                            id: seasonGroup

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: 2
                                Repeater {
                                    model: ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"]
                                    delegate: Rectangle {
                                        readonly property int monthNum: index + 1
                                        readonly property bool isOn: seasonGroup.selectedMonths.indexOf(monthNum) >= 0
                                        Layout.preferredWidth: 28
                                        Layout.preferredHeight: 28
                                        radius: Theme.radiusSm
                                        color: isOn ? Theme.colorSuccess
                                                    : (mouseHover.containsMouse ? Theme.colorSurfaceHover : Theme.colorTransparent)
                                        border.width: 1
                                        border.color: isOn ? Theme.colorSuccess : Theme.colorBorder
                                        Behavior on color { ColorAnimation { duration: Theme.durationFast } }

                                        Text {
                                            anchors.centerIn: parent
                                            text: modelData
                                            color: parent.isOn ? "white" : Theme.colorText
                                            font.family: Theme.fontFamily
                                            font.pixelSize: Theme.fontSizeSm
                                            font.weight: Theme.fontWeightSemiBold
                                        }
                                        MouseArea {
                                            id: mouseHover
                                            anchors.fill: parent
                                            hoverEnabled: true
                                            cursorShape: Qt.PointingHandCursor
                                            onClicked: seasonGroup.toggleMonth(parent.monthNum)
                                        }
                                    }
                                }
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "Clique sur les mois où l'ingrédient est de saison. Vide = pas de badge “🌱 saison”."
                                color: Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeXs
                                font.italic: true
                                wrapMode: Text.WordWrap
                            }
                        }

                        // Bouton Enregistrer — feedback visuel "✓ Enregistré"
                        // pendant 1.5s après un save réussi (variant success
                        // = fond vert), puis retour automatique à "primary".
                        Item { Layout.columnSpan: 1 }
                        AppButton {
                            id: saveButton
                            property bool justSaved: false
                            text: justSaved ? "✓  Enregistré" : "Enregistrer"
                            variant: justSaved ? "success" : "primary"
                            Layout.alignment: Qt.AlignLeft
                            enabled: page.selectedId !== -1
                            onClicked: {
                                const ok = page._saveCurrent()
                                if (ok) {
                                    justSaved = true
                                    saveResetTimer.restart()
                                }
                            }
                            Timer {
                                id: saveResetTimer
                                interval: 1500
                                repeat: false
                                onTriggered: saveButton.justSaved = false
                            }
                        }
                    }
                }
            }
        }
    }

    // ============================================================ Toast d'erreur

    Rectangle {
        id: errorToast
        property string message: ""
        visible: false
        color: Theme.colorError
        radius: Theme.radiusMd
        opacity: 0.95
        anchors.bottom: parent.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottomMargin: Theme.spaceXl
        width: errorText.implicitWidth + Theme.spaceXl * 2
        height: errorText.implicitHeight + Theme.spaceMd * 2

        Text {
            id: errorText
            anchors.centerIn: parent
            text: errorToast.message
            color: "white"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeMd
        }
        Timer {
            running: errorToast.visible
            interval: 4000
            onTriggered: errorToast.visible = false
        }
    }

    // ============================================================ Raccourcis clavier (U1)
    // `enabled: page.visible` garde le raccourci désactivé tant que cet onglet
    // n'est pas le courant — sinon on aurait des collisions Ctrl+N entre pages.

    Shortcut {
        sequence: "Ctrl+N"
        enabled: page.visible
        context: Qt.WindowShortcut
        onActivated: page._loadNew()
    }
    Shortcut {
        sequence: "Ctrl+S"
        enabled: page.visible && page.selectedId !== -1
        context: Qt.WindowShortcut
        // Déclenche aussi le feedback visuel "✓ Enregistré" — on utilise
        // saveButton.clicked() pour passer par le même chemin que le clic
        // souris (qui bascule justSaved + lance le timer).
        onActivated: saveButton.clicked()
    }
    Shortcut {
        sequence: "Delete"
        enabled: page.visible && page.selectedId > 0
        context: Qt.WindowShortcut
        onActivated: page._deleteCurrent()
    }
    Shortcut {
        sequence: "Ctrl+F"
        enabled: page.visible
        context: Qt.WindowShortcut
        onActivated: searchField.forceActiveFocus()
    }

    // ============================================================ Dialog d'import
    // Vraie fenêtre système (Window) — détachable, déplaçable hors de l'app, non-modale.

    ImportIngredientDialog {
        id: importDialog
        onLibraryChanged: ingredientVM.refreshList()
    }

    // ============================================================ Dialog "Trouve-moi des recettes" (F5)

    RecipeMatchDialog {
        id: recipeMatchDialog
    }

    // ============================================================ Dialog "Historique des prix" (per-ingredient)

    PriceHistoryDialog {
        id: priceHistoryDialog
        // Plus besoin de hook explicite : le viewmodel émet
        // `current_price_recomputed` après chaque add/delete dans
        // l'historique, et la Connection ci-dessous rafraîchit la cellule.
    }

    // ============================================================ Connexions VM
    Connections {
        target: ingredientVM
        function onError_emitted(message) {
            errorToast.message = message
            errorToast.visible = true
        }
        function onDeletion_pending_undo(label) {
            undoToast.show(label)
        }
        // Auto-refresh des cellules lecture seule "Prix" + "Quantité de réf."
        // après une modification de l'historique. On ne rafraîchit que si
        // l'ingrédient édité est celui qui a été recalculé.
        function onCurrent_price_recomputed(ingredientId) {
            if (ingredientId !== page.selectedId) return
            const d = ingredientVM.getAsDict(ingredientId)
            if (!d || !d.id) return
            priceDisplay.priceText = d.priceEur || ""
            priceQtyDisplay.qtyValue = d.priceQuantityG || 0
        }
        // B4 : un nom d'ingrédient saisi pour la création entre en collision
        // avec un manuel existant. On propose de basculer sur l'édition de
        // l'existant pour éviter les doublons silencieux.
        function onName_collision_detected(existingId, name) {
            collisionDialog.existingId = existingId
            collisionDialog.collidingName = name
            collisionDialog.open()
        }
    }

    // ============================================================ Collision dialog (B4)

    AppDialog {
        id: collisionDialog
        title: "Ingrédient existant"
        property int existingId: -1
        property string collidingName: ""

        ColumnLayout {
            spacing: Theme.spaceMd
            Text {
                text: "Un ingrédient nommé « " + collisionDialog.collidingName
                      + " » existe déjà dans ta bibliothèque."
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
                wrapMode: Text.WordWrap
                Layout.preferredWidth: 380
            }
            Text {
                text: "Tu peux soit éditer l'ingrédient existant (recommandé pour "
                      + "ne pas créer de doublon), soit annuler et changer le nom."
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
                wrapMode: Text.WordWrap
                Layout.preferredWidth: 380
            }
        }

        footer: RowLayout {
            spacing: Theme.spaceSm
            Item { Layout.fillWidth: true }
            AppButton {
                text: "Annuler"
                variant: "secondary"
                onClicked: collisionDialog.close()
            }
            AppButton {
                text: "Éditer l'existant"
                variant: "primary"
                onClicked: {
                    const id = collisionDialog.existingId
                    collisionDialog.close()
                    if (id > 0) {
                        // Re-sélectionne dans la liste pour cohérence visuelle
                        const m = ingredientVM.items
                        for (let i = 0; i < ingredientsList.count; i++) {
                            if (m.data(m.index(i, 0), m.Roles.ingredientId) === id) {
                                ingredientsList.currentIndex = i
                                break
                            }
                        }
                        page._loadIngredient(id)
                    }
                }
            }
            Item { Layout.preferredWidth: Theme.spaceMd }
        }
    }

    UndoToast {
        id: undoToast
        onUndoClicked: ingredientVM.undoLastDelete()
    }

    // ============================================================ Helpers métier

    function _loadIngredient(id) {
        if (!ingredientVM) return
        const d = ingredientVM.getAsDict(id)
        if (!d || !d.id) {
            _clearForm()
            page.selectedId = -1
            return
        }
        page.selectedId = id
        nameField.text = d.name || ""
        // sourceLabel.text est calculé via binding sur sourceName + sourceRefValue
        sourceLabel.sourceName = d.source || "manuel"
        sourceLabel.sourceRefValue = d.sourceRef || ""
        sourceRefField.text = d.sourceRef || ""
        brandField.text = d.brand || ""
        kcalField.value = d.kcal || 0
        proteinsField.value = d.proteins || 0
        carbsField.value = d.carbs || 0
        sugarsField.value = d.sugars || 0
        fatsField.value = d.fats || 0
        satFatsField.value = d.saturatedFats || 0
        fiberField.value = d.fiber || 0
        saltField.value = d.salt || 0
        priceDisplay.priceText = d.priceEur || ""
        priceQtyDisplay.qtyValue = d.priceQuantityG || 0
        pieceWeightField.value = d.pieceWeightG || 0
        cookedWeightField.value = d.cookedWeightPer100gRaw || 0
        // Refonte rayons : seul L1 est exposé. L2 reste en DB pour les
        // seeds CIQUAL hérités mais n'est plus modifié par l'UI.
        categoryFields.l1 = d.categoryL1 || ""
        seasonGroup.setFromCsv(d.seasonMonths || "")
    }

    function _loadNew() {
        ingredientsList.currentIndex = -1
        page.selectedId = -2
        _clearForm()
        nameField.forceActiveFocus()
    }

    function _saveCurrent() {
        // Retourne `true` si le save a réussi (id retourné par le VM),
        // `false` sinon. Le bouton "Enregistrer" utilise ce retour pour
        // basculer en feedback "✓ Enregistré" pendant 1.5s.
        if (page.selectedId === -1) return false

        // Préserve la position de scroll de la liste : `ingredientVM.refresh()`
        // côté Python fait un `beginResetModel/endResetModel`, ce qui remet la
        // ListView à 0. Sans ce snapshot/restore, l'utilisateur voit la liste
        // "sauter" à chaque save. On capte avant et on restaure après.
        const savedContentY = ingredientsList.contentY

        const payload = {
            "id":             page.selectedId > 0 ? page.selectedId : null,
            "name":           nameField.text.trim(),
            "sourceRef":      sourceRefField.text.trim() || null,
            "brand":          brandField.text.trim() || null,
            "kcal":           kcalField.value,
            "proteins":       proteinsField.value,
            "carbs":          carbsField.value,
            "sugars":         sugarsField.value,
            "fats":           fatsField.value,
            "saturatedFats":  satFatsField.value,
            "fiber":          fiberField.value,
            "salt":           saltField.value,
            // Prix + quantité de réf. : non envoyés depuis le formulaire (auto-derived
            // depuis l'historique côté Python — voir pricing_history_service). Le
            // dict_to_ing les préserve depuis l'existant en DB.
            "pieceWeightG":   pieceWeightField.value,
            "cookedWeightPer100gRaw": cookedWeightField.value || null,
            // Refonte rayons : on n'envoie plus que `categoryL1` (= rayon).
            // `categoryL2` est forcé à null pour effacer les seeds CIQUAL
            // hérités au prochain save (et nettoyer progressivement la DB
            // au fil de l'eau, sans migration brutale).
            "categoryL1":     categoryFields.l1.trim() || null,
            "categoryL2":     null,
            "seasonMonths":   seasonGroup.toCsv()
        }
        const saved = ingredientVM.saveFromDict(payload)
        if (saved && saved.id) {
            page.selectedId = saved.id
            // ListView aura été reset par refresh() ; resélectionne la ligne par id.
            const items = ingredientVM.items
            for (let i = 0; i < ingredientsList.count; i++) {
                if (items.data(items.index(i, 0), items.Roles.ingredientId) === saved.id) {
                    ingredientsList.currentIndex = i
                    break
                }
            }
            // Restaure la position de scroll capturée avant le save.
            // `Qt.callLater` laisse la ListView finir son layout post-reset
            // avant qu'on touche à `contentY`, sinon le set est ignoré.
            Qt.callLater(function() {
                if (ingredientsList.contentHeight > 0) {
                    const maxY = Math.max(0, ingredientsList.contentHeight - ingredientsList.height)
                    ingredientsList.contentY = Math.min(savedContentY, maxY)
                }
            })
            return true
        }
        return false
    }

    function _deleteCurrent() {
        if (page.selectedId <= 0) return
        ingredientVM.deleteIngredient(page.selectedId)
        page.selectedId = -1
        _clearForm()
    }

    function _clearForm() {
        nameField.text = ""
        sourceLabel.sourceName = "manuel"
        sourceLabel.sourceRefValue = ""
        sourceRefField.text = ""
        brandField.text = ""
        kcalField.clear()
        proteinsField.clear()
        carbsField.clear()
        sugarsField.clear()
        fatsField.clear()
        satFatsField.clear()
        fiberField.clear()
        saltField.clear()
        priceDisplay.priceText = ""
        priceQtyDisplay.qtyValue = 0
        pieceWeightField.clear()
        cookedWeightField.clear()
        // Refonte rayons : seul l1 (= nom du rayon) reste exposé
        categoryFields.l1 = ""
        seasonGroup.selectedMonths = []
    }
}
