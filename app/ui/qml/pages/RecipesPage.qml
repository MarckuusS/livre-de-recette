// Onglet 2 — Recettes : liste à gauche, éditeur à droite (meta + lignes + nutrition + coût).
//
// VMs branchés : `recipeListVM` pour la liste, `recipeEditorVM` pour l'édition.
// L'éditeur conserve sa logique d'in-memory edit buffer avec ses 3 signaux
// (`loaded` / `lines_changed` / `derived_changed`) — voir RecipeEditorViewModel.

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Dialogs
import QtQuick.Window
import App
import "../components"
import "../dialogs"

Item {
    id: page

    property int selectedId: -1

    // Snapshot QML local des lignes/cost/nutrition pour éviter de re-querier les
    // slots à chaque frame. Mis à jour quand les signaux du VM tirent.
    property var linesSnapshot: []
    property var nutritionTotal: ({ kcal: 0, proteins: 0, carbs: 0, fats: 0 })
    property var nutritionPerPortion: ({ kcal: 0, proteins: 0, carbs: 0, fats: 0 })
    property var nutritionPer100g: ({ kcal: 0, proteins: 0, carbs: 0, fats: 0 })
    property var costInfo: ({ total: "0.00", perPortion: "0.00", missingPriceCount: 0, lineCount: 0 })
    property var portionWeight: ({ totalCookedG: 0, perPortionCookedG: 0, hasAnyRatio: false, ratiosDefinedCount: 0, totalLines: 0 })

    // Scaling override (F2). Ces valeurs reflètent les Properties du viewmodel,
    // mises à jour via le signal `display_portions_changed`.
    property int displayPortions: 1
    property int defaultPortions: 1
    property bool isScaled: false
    property real scaleRatio: 1.0

    // Photo (F6). URL `file://` ou chaîne vide. Mis à jour par `photo_changed`.
    property string photoUrl: ""

    // Tags (F4). Liste des tags actuellement attachés à la recette en édition,
    // et liste de TOUS les tags disponibles (pour les chips toggle).
    property var currentTags: []      // [{id, name, colorHex}, ...]
    property var allTags: []          // pareil, depuis tagVM.listAll()

    // C2 : compteur "cuisinée X× ce mois" affiché dans le bandeau journal.
    property int cookedThisMonth: 0

    // ============================================================ Connexions VM

    Connections {
        target: recipeListVM
        function onDeletion_pending_undo(label) {
            undoToast.show(label)
        }
    }

    UndoToast {
        id: undoToast
        onUndoClicked: recipeListVM.undoLastDelete()
    }

    Connections {
        target: recipeEditorVM
        function onLoaded() {
            metaName.text = recipeEditorVM.recipeName
            metaPortions.realValue = recipeEditorVM.defaultPortions
            metaInstructions.text = recipeEditorVM.instructions
            page._refreshScaling()
            page._refreshLines()
            page._refreshDerived()
            page._refreshPhoto()
            page._refreshCookingStats()
        }
        function onLines_changed() { page._refreshLines() }
        function onDerived_changed() { page._refreshDerived() }
        function onDisplay_portions_changed() {
            page._refreshScaling()
            page._refreshLines()    // re-snap les lignes avec le nouveau ratio
            page._refreshDerived()
        }
        function onPhoto_changed() {
            page._refreshPhoto()
            // Force la liste à rafraîchir aussi pour que la vignette mute
            recipeListVM.refreshList()
        }
        function onTags_changed() {
            page._refreshTags()
            recipeListVM.refreshList()  // les filtres tag peuvent inclure/exclure
        }
        function onError_emitted(message) {
            photoErrorToast.message = message
            photoErrorToast.visible = true
        }
    }

    function _refreshLines() {
        linesSnapshot = recipeEditorVM.linesAsList()
    }

    function _refreshCookingStats() {
        page.cookedThisMonth = recipeEditorVM.cookedTimesThisMonth()
    }

    // C2 : log "cuisinée aujourd'hui" en un clic. Pas de note, pas de
    // rating — juste un timestamp (l'utilisateur peut détailler via le
    // dialog d'historique s'il veut).
    function _logCookedToday() {
        const today = new Date().toISOString().slice(0, 10)
        const saved = recipeEditorVM.addCookingLog({
            "cookedAtIso": today,
            "rating":      0,
            "notes":       "",
        })
        if (saved && saved.id) {
            page._refreshCookingStats()
            cookingToast.message = "✓ Cuisinée aujourd'hui — bon appétit !"
            cookingToast.visible = true
        }
    }

    // B5 : transforme une catégorie CIQUAL L1 (alim_grp_nom_fr) en libellé
    // de section lisible. Les ingrédients sans catégorie (manuel / OFF non
    // catégorisé) sont regroupés sous "Autres".
    function _formatRayonHeader(categoryL1) {
        if (!categoryL1 || categoryL1 === "") return "Autres"
        // CIQUAL renvoie en minuscules avec virgules — on capitalise la 1ère lettre.
        return categoryL1.charAt(0).toUpperCase() + categoryL1.slice(1)
    }
    function _refreshDerived() {
        nutritionTotal = recipeEditorVM.nutritionTotalAsDict()
        nutritionPerPortion = recipeEditorVM.nutritionPerPortionAsDict()
        nutritionPer100g = recipeEditorVM.nutritionPer100gAsDict()
        costInfo = recipeEditorVM.costInfoAsDict()
        portionWeight = recipeEditorVM.portionWeightAsDict()
    }
    function _refreshScaling() {
        page.displayPortions = recipeEditorVM.displayPortions
        page.defaultPortions = recipeEditorVM.defaultPortions
        page.isScaled = recipeEditorVM.isScaled
        page.scaleRatio = recipeEditorVM.scaleRatio
    }
    function _refreshPhoto() {
        page.photoUrl = recipeEditorVM.photoUrl
    }
    function _refreshTags() {
        page.currentTags = recipeEditorVM.currentTags()
        if (page.allTags.length === 0 && typeof tagVM !== "undefined" && tagVM) {
            page.allTags = tagVM.listAll()
        }
    }
    Component.onCompleted: {
        if (typeof tagVM !== "undefined" && tagVM) {
            page.allTags = tagVM.listAll()
        }
    }

    // ============================================================ Layout racine

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

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
                SplitView.preferredWidth: splitter.width * 0.30
                SplitView.minimumWidth: 240
                spacing: Theme.spaceSm

                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spaceSm
                    AppButton {
                        text: "Nouvelle"
                        variant: "primary"
                        onClicked: page._loadNew()
                    }
                    AppButton {
                        text: "Importer URL"
                        variant: "secondary"
                        onClicked: importUrlDialog.openCentered(Window.window)
                    }
                    AppButton {
                        text: "Supprimer"
                        variant: "secondary"
                        enabled: page.selectedId > 0
                        onClicked: page._deleteCurrent()
                    }
                    Item { Layout.fillWidth: true }
                }

                // ---- Filtre tags (F4) ----
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spaceXs
                    visible: page.allTags.length > 0

                    RowLayout {
                        Layout.fillWidth: true
                        Text {
                            text: "Filtrer :"
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXs
                            font.weight: Theme.fontWeightMedium
                        }
                        Item { Layout.fillWidth: true }
                        Text {
                            visible: recipeListVM && recipeListVM.tagFilter.length > 0
                            text: "Effacer"
                            color: Theme.colorPrimary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXs
                            font.weight: Theme.fontWeightMedium
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: recipeListVM.clearTagFilter()
                            }
                        }
                    }
                    Flow {
                        Layout.fillWidth: true
                        spacing: 3
                        Repeater {
                            model: page.allTags
                            delegate: Rectangle {
                                property bool isActive: recipeListVM
                                    && recipeListVM.tagFilter.indexOf(modelData.id) !== -1
                                radius: Theme.radiusFull
                                height: 22
                                width: filterTagText.implicitWidth + Theme.spaceMd * 1.5
                                color: isActive
                                       ? modelData.colorHex
                                       : Qt.alpha(modelData.colorHex, 0.10)
                                border.width: 1
                                border.color: isActive
                                              ? modelData.colorHex
                                              : Qt.alpha(modelData.colorHex, 0.35)
                                Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                                Text {
                                    id: filterTagText
                                    anchors.centerIn: parent
                                    text: modelData.name
                                    color: parent.isActive ? "white" : modelData.colorHex
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeXs
                                    font.weight: Theme.fontWeightMedium
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: recipeListVM.toggleTagFilter(modelData.id)
                                }
                            }
                        }
                    }
                }

                Rectangle {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    color: Theme.colorSurface
                    radius: Theme.radiusMd
                    border.width: 1
                    border.color: Theme.colorBorder

                    ListView {
                        id: recipesList
                        anchors.fill: parent
                        anchors.margins: 1
                        clip: true
                        model: recipeListVM ? recipeListVM.items : null
                        currentIndex: -1
                        ScrollBar.vertical: AppScrollBar {}

                        delegate: AppListItem {
                            width: ListView.view.width
                            height: 68
                            selected: index === recipesList.currentIndex
                            onClicked: {
                                recipesList.currentIndex = index
                                page._loadRecipe(model.recipeId)
                            }

                            content: RowLayout {
                                anchors.fill: parent
                                spacing: Theme.spaceMd

                                // Vignette photo (ou placeholder)
                                Rectangle {
                                    Layout.preferredWidth: 56
                                    Layout.preferredHeight: 56
                                    radius: Theme.radiusSm
                                    color: Theme.colorSurfaceHover
                                    border.width: 1
                                    border.color: Theme.colorBorder
                                    clip: true

                                    Image {
                                        id: thumbPhoto
                                        anchors.fill: parent
                                        anchors.margins: 1
                                        source: model.photoUrl || ""
                                        fillMode: Image.PreserveAspectCrop
                                        asynchronous: true
                                        cache: true
                                        // A2 : masque aussi en cas d'Error (fichier supprimé du disque
                                        // pendant la session). Le placeholder en dessous prend la relève.
                                        visible: source != "" && status !== Image.Error
                                    }
                                    Text {
                                        anchors.centerIn: parent
                                        visible: !model.photoUrl || thumbPhoto.status === Image.Error
                                        text: "🍽"
                                        font.pixelSize: 24
                                        color: Theme.colorTextDisabled
                                    }
                                }

                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: 1
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
                                        text: model.defaultPortions + " portion" + (model.defaultPortions > 1 ? "s" : "")
                                              + "  ·  " + model.lineCount + " ingrédient" + (model.lineCount > 1 ? "s" : "")
                                        color: Theme.colorTextSecondary
                                        font.family: Theme.fontFamily
                                        font.pixelSize: Theme.fontSizeXs
                                    }
                                }
                            }
                        }
                    }
                    Text {
                        anchors.centerIn: parent
                        visible: recipesList.count === 0
                        text: "Aucune recette\nClique sur « Nouvelle » pour commencer."
                        color: Theme.colorTextSecondary
                        horizontalAlignment: Text.AlignHCenter
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeSm
                    }
                }
            }

            // ============================================================ Panneau droit (éditeur)
            Flickable {
                SplitView.fillWidth: true
                contentWidth: width
                contentHeight: editor.implicitHeight + Theme.spaceXl * 2
                clip: true
                ScrollBar.vertical: AppScrollBar {}

                ColumnLayout {
                    id: editor
                    // Le formulaire prend toute la largeur disponible du
                    // panneau droit du SplitView. Les champs ponctuels qui
                    // n'ont pas vocation à s'étendre (nom, portions…) sont
                    // bridés individuellement par leur propre `Layout.maximumWidth` ;
                    // les lignes ingrédients et les blocs nutrition/coût
                    // utilisent toute la largeur.
                    width: parent.width - Theme.spaceLg * 2
                    x: Theme.spaceLg
                    y: Theme.spaceLg
                    spacing: Theme.spaceMd
                    enabled: page.selectedId !== -1

                    Text {
                        text: page.selectedId > 0 ? "Modifier la recette"
                            : page.selectedId === -2 ? "Nouvelle recette"
                            : "Sélectionne une recette pour l'éditer"
                        color: page.selectedId !== -1 ? Theme.colorText : Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXl
                        font.weight: Theme.fontWeightSemiBold
                    }

                    // ---- Photo de la recette (F6) — extrait en RecipePhotoBlock (A7) ----
                    RecipePhotoBlock {
                        Layout.fillWidth: true
                        visible: page.selectedId !== -1
                        photoUrl: page.photoUrl
                        selectedId: page.selectedId
                        onPhotoSaved: photoSavedToast.visible = true
                    }

                    // ---- Tags (F4) — extrait en RecipeTagsChips (A7) ----
                    RecipeTagsChips {
                        Layout.fillWidth: true
                        visible: page.selectedId !== -1
                        allTags: page.allTags
                        currentTags: page.currentTags
                    }

                    // ---- Méta ----
                    GridLayout {
                        Layout.fillWidth: true
                        columns: 2
                        columnSpacing: Theme.spaceMd
                        rowSpacing: Theme.spaceSm

                        Text { text: "Nom :"; color: Theme.colorText; Layout.alignment: Qt.AlignRight | Qt.AlignTop }
                        AppTextField {
                            id: metaName
                            Layout.fillWidth: true
                            Layout.minimumWidth: 200
                            Layout.maximumWidth: 480
                            onTextChanged: page._pushMeta()
                        }

                        Text { text: "Portions :"; color: Theme.colorText; Layout.alignment: Qt.AlignRight | Qt.AlignTop }
                        AppSpinBox {
                            id: metaPortions
                            Layout.preferredWidth: 100
                            decimals: 0
                            realFrom: 1
                            realTo: 50
                            realStep: 1
                            realValue: 1
                            onRealValueChanged: page._pushMeta()
                        }

                        Text { text: "Instructions :"; color: Theme.colorText; Layout.alignment: Qt.AlignRight | Qt.AlignTop }
                        ScrollView {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 120
                            TextArea {
                                id: metaInstructions
                                background: Rectangle {
                                    radius: Theme.radiusMd
                                    color: Theme.colorSurface
                                    border.width: 1
                                    border.color: parent.activeFocus ? Theme.colorBorderFocus : Theme.colorBorder
                                }
                                color: Theme.colorText
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeMd
                                placeholderText: "Étapes de préparation…"
                                selectByMouse: true
                                wrapMode: TextArea.Wrap
                                onTextChanged: page._pushMeta()
                            }
                        }
                    }

                    // ---- Picker pour ajouter un ingrédient ----
                    Rectangle {
                        Layout.fillWidth: true
                        radius: Theme.radiusMd
                        color: Theme.colorSurfaceHover
                        border.width: 1
                        border.color: Theme.colorBorder
                        implicitHeight: pickerRow.implicitHeight + Theme.spaceMd * 2

                        RowLayout {
                            id: pickerRow
                            anchors.fill: parent
                            anchors.margins: Theme.spaceMd
                            spacing: Theme.spaceMd

                            Text {
                                text: "Ajouter un ingrédient :"
                                color: Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                font.weight: Theme.fontWeightMedium
                            }
                            IngredientSearch {
                                id: linePicker
                                Layout.fillWidth: true
                                Layout.preferredHeight: implicitHeight
                                scope: "personal"
                                placeholderText: "Tape un nom…"
                                onIngredientPicked: function(id, name) {
                                    const qty = lineQty.grams || 100
                                    recipeEditorVM.addLineById(id, qty, "")
                                }
                            }
                            QuantityField {
                                id: lineQty
                                Layout.preferredWidth: 200
                                grams: 100
                                decimals: 1
                            }
                        }
                    }

                    // ---- Bandeau scaling (visible quand isScaled) ----
                    Rectangle {
                        Layout.fillWidth: true
                        visible: page.isScaled
                        Layout.preferredHeight: visible ? scaleBannerLabel.implicitHeight + Theme.spaceMd * 2 : 0
                        color: Qt.alpha(Theme.colorWarning, 0.10)
                        border.color: Qt.alpha(Theme.colorWarning, 0.45)
                        border.width: 1
                        radius: Theme.radiusMd

                        RowLayout {
                            anchors.fill: parent
                            anchors.leftMargin: Theme.spaceMd
                            anchors.rightMargin: Theme.spaceMd
                            spacing: Theme.spaceMd

                            Text {
                                id: scaleBannerLabel
                                Layout.fillWidth: true
                                wrapMode: Text.WordWrap
                                text: "⚠ Quantités affichées pour <b>" + page.displayPortions
                                      + " portions</b> (recette pour " + page.defaultPortions
                                      + ", facteur ×" + page.scaleRatio.toLocaleString(Qt.locale(), 'f', 2)
                                      + "). Modifier une quantité ici stocke la valeur ramenée à "
                                      + page.defaultPortions + " portions."
                                textFormat: Text.RichText
                                color: Theme.colorText
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                            }
                            AppButton {
                                text: "Réinitialiser"
                                variant: "ghost"
                                onClicked: recipeEditorVM.resetDisplayPortions()
                            }
                        }
                    }

                    // ---- Lignes de la recette ----
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: linesColumn.implicitHeight + Theme.spaceMd * 2
                        color: Theme.colorSurface
                        radius: Theme.radiusMd
                        border.width: 1
                        border.color: Theme.colorBorder

                        ColumnLayout {
                            id: linesColumn
                            anchors.fill: parent
                            anchors.margins: Theme.spaceMd
                            spacing: Theme.spaceXs

                            Text {
                                text: "Ingrédients (" + page.linesSnapshot.length + ")"
                                color: Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                font.weight: Theme.fontWeightMedium
                            }

                            Repeater {
                                model: page.linesSnapshot
                                // B5 : auto-tri par rayon. Le Python (`linesAsList`)
                                // pré-trie par (categoryL1, ordinal) ; ici on injecte
                                // un header de section quand la catégorie change
                                // d'une ligne à l'autre. Évite une vue plate où
                                // fruits / crèmerie / épicerie sèche sont mélangés.
                                delegate: ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: 2

                                    Text {
                                        Layout.fillWidth: true
                                        Layout.topMargin: index === 0 ? 0 : Theme.spaceSm
                                        visible: index === 0
                                                 || page.linesSnapshot[index - 1].categoryL1 !== modelData.categoryL1
                                        text: "▸ " + page._formatRayonHeader(modelData.categoryL1)
                                        color: Theme.colorTextSecondary
                                        font.family: Theme.fontFamily
                                        font.pixelSize: Theme.fontSizeXs
                                        font.weight: Theme.fontWeightSemiBold
                                        font.capitalization: Font.AllUppercase
                                    }

                                    RowLayout {
                                        Layout.fillWidth: true
                                        spacing: Theme.spaceSm

                                        // Nom : largeur fixe pour aligner les colonnes entre lignes.
                                        // Phase 2 : cliquable → bascule vers l'onglet Ingrédients
                                        // avec cet ingrédient pré-sélectionné en édition (utile pour
                                        // corriger rapidement macros / prix / poids unitaire).
                                        Item {
                                            Layout.preferredWidth: 220
                                            Layout.minimumWidth: 180
                                            Layout.maximumWidth: 260
                                            Layout.fillHeight: true

                                            Text {
                                                id: ingredientNameLabel
                                                anchors.fill: parent
                                                text: modelData.ingredientName
                                                color: ingredientNameMouse.containsMouse
                                                       ? Theme.colorPrimary
                                                       : Theme.colorText
                                                font.family: Theme.fontFamily
                                                font.pixelSize: Theme.fontSizeMd
                                                font.underline: ingredientNameMouse.containsMouse
                                                elide: Text.ElideRight
                                                verticalAlignment: Text.AlignVCenter
                                                Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                                            }
                                            MouseArea {
                                                id: ingredientNameMouse
                                                anchors.fill: parent
                                                hoverEnabled: true
                                                cursorShape: Qt.PointingHandCursor
                                                ToolTip.visible: containsMouse
                                                ToolTip.text: "Ouvrir l'ingrédient en édition (onglet Ingrédients)"
                                                ToolTip.delay: 600
                                                onClicked: {
                                                    const win = Window.window
                                                    if (win && win.navigateToIngredient) {
                                                        win.navigateToIngredient(modelData.ingredientId)
                                                    }
                                                }
                                            }
                                        }
                                        QuantityField {
                                            Layout.preferredWidth: 240
                                            Layout.maximumWidth: 280
                                            grams: modelData.quantityG
                                            pieceWeightG: modelData.ingredientPieceWeightG || 0
                                            decimals: 1
                                            // Refonte UX : restitue l'unité saisie pour ne pas
                                            // que le QuantityField bascule en "_piece" au reload
                                            // (cf. fix bug conversions d'unités).
                                            preferredUnit: modelData.unit || ""
                                            onGramsEdited: function(g) {
                                                recipeEditorVM.updateLineQty(modelData.ordinal, g)
                                            }
                                            onUnitChanged: function(code) {
                                                recipeEditorVM.updateLineUnit(modelData.ordinal, code)
                                            }
                                        }
                                        // Notes : champ éditable. Sauvegarde quand l'utilisateur
                                        // appuie Entrée ou perd le focus (onEditingFinished) — évite
                                        // de pousser un update à chaque keystroke.
                                        AppTextField {
                                            Layout.fillWidth: true
                                            Layout.maximumWidth: 320
                                            text: modelData.notes || ""
                                            placeholderText: "Notes (ex: « égoutter », « écraser »…)"
                                            font.pixelSize: Theme.fontSizeSm
                                            onEditingFinished: {
                                                recipeEditorVM.updateLineNotes(modelData.ordinal, text)
                                            }
                                        }
                                        Item { Layout.fillWidth: true }   // spacer pour pousser le ✕ à droite
                                        AppButton {
                                            Layout.preferredWidth: 36
                                            Layout.preferredHeight: 30
                                            text: "✕"
                                            variant: "danger"
                                            onClicked: recipeEditorVM.removeLineByOrdinal(modelData.ordinal)
                                        }
                                    }
                                }
                            }
                            Text {
                                visible: page.linesSnapshot.length === 0
                                Layout.fillWidth: true
                                text: "Aucune ligne — ajoute des ingrédients via le picker ci-dessus."
                                color: Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                horizontalAlignment: Text.AlignHCenter
                            }
                        }
                    }

                    // ---- Tableau nutritionnel + graphique macros 100 g ----
                    // Format inspiré des étiquettes alimentaires UE :
                    // ordre Énergie → Lipides → dont saturés → Glucides → dont
                    // sucres → Fibres → Protéines → Sel, en 3 colonnes de
                    // valeurs pour comparer densité (100 g) / portion / total.
                    // Le poids cuit estimé (anciennement carte dédiée) est
                    // intégré sous chaque entête de colonne — préfixe "≈"
                    // quand au moins un ingrédient a son ratio cuit renseigné,
                    // mention "(cru)" sinon (estimation 1:1 par défaut).
                    // À droite du tableau : MacrosChart (donut Lipides/Glucides
                    // /Protéines en % d'énergie) qui visualise d'un coup d'œil
                    // la composition macro de la recette par 100 g.
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spaceMd

                        NutritionPanel {
                            Layout.fillWidth: true
                            // centerCells : valeurs centrées dans la cellule pour
                            // une continuité visuelle avec les entêtes (qui sont
                            // déjà centrées). Zéro slot d'unité réservé à droite,
                            // le bloc "423 kcal" est centré sous "Pour 100 g".
                            centerCells: true
                            columnTitles: ["Pour 100 g", "Par portion", "Recette entière"]
                            columnSubtitles: [
                                "",
                                page.portionWeight.perPortionCookedG > 0
                                    ? (page.portionWeight.hasAnyRatio
                                       ? "≈ " + Math.round(page.portionWeight.perPortionCookedG) + " g cuit"
                                       : Math.round(page.portionWeight.perPortionCookedG) + " g cru")
                                    : "",
                                page.portionWeight.totalCookedG > 0
                                    ? (page.portionWeight.hasAnyRatio
                                       ? "≈ " + Math.round(page.portionWeight.totalCookedG) + " g cuit"
                                       : Math.round(page.portionWeight.totalCookedG) + " g cru")
                                    : ""
                            ]
                            columnData: [
                                page.nutritionPer100g,
                                page.nutritionPerPortion,
                                page.nutritionTotal
                            ]
                        }   // fin NutritionPanel

                        // Donut macros (Lipides / Glucides / Fibres /
                        // Protéines en % d'énergie pour 100 g) + légende
                        // détaillée incluant les 8 entrées du tableau UE.
                        // Pas de Layout.preferredHeight : on laisse le panneau
                        // se dimensionner sur son contenu (donut + 7 lignes
                        // légende), ce qui équilibre la hauteur avec le
                        // tableau à gauche.
                        MacrosChart {
                            Layout.preferredWidth: 320
                            Layout.alignment: Qt.AlignTop
                            nutritionData: page.nutritionPer100g
                            perLabel: "/ 100 g"
                        }
                    }   // fin RowLayout (tableau + graphique)

                    // ---- Panneau coût + sélecteur de portions (F2 scaling) ----
                    Rectangle {
                        Layout.fillWidth: true
                        radius: Theme.radiusMd
                        color: Theme.colorSurface
                        border.width: 1
                        border.color: page.isScaled
                                      ? Qt.alpha(Theme.colorWarning, 0.6)
                                      : Theme.colorBorder
                        implicitHeight: costColumn.implicitHeight + Theme.spaceMd * 2
                        Behavior on border.color { ColorAnimation { duration: Theme.durationFast } }

                        ColumnLayout {
                            id: costColumn
                            anchors.fill: parent
                            anchors.margins: Theme.spaceMd
                            spacing: Theme.spaceSm

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: Theme.spaceLg

                                Text {
                                    text: "Coût total :"
                                    color: Theme.colorTextSecondary
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeSm
                                    font.weight: Theme.fontWeightMedium
                                }
                                Text {
                                    text: Number(parseFloat(page.costInfo.total)).toLocaleString(Qt.locale(), 'f', 2) + " €"
                                    color: Theme.colorText
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeLg
                                    font.weight: Theme.fontWeightSemiBold
                                }
                                Text {
                                    text: "soit " + Number(parseFloat(page.costInfo.perPortion)).toLocaleString(Qt.locale(), 'f', 2) + " € / portion"
                                    color: Theme.colorTextSecondary
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeMd
                                }
                                Item { Layout.fillWidth: true }
                                Text {
                                    visible: page.costInfo.missingPriceCount > 0
                                    text: "⚠ " + page.costInfo.missingPriceCount + " ingrédient(s) sans prix"
                                    color: Theme.colorWarning
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeSm
                                }
                            }

                            // Séparateur
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.preferredHeight: 1
                                color: Theme.colorBorder
                            }

                            // ---- Ligne d'ajustement des portions ----
                            RowLayout {
                                Layout.fillWidth: true
                                spacing: Theme.spaceMd

                                Text {
                                    text: "Ajuster les portions :"
                                    color: Theme.colorTextSecondary
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeSm
                                    font.weight: Theme.fontWeightMedium
                                }
                                AppSpinBox {
                                    id: portionsScaler
                                    Layout.preferredWidth: 100
                                    decimals: 0
                                    realFrom: 1
                                    realTo: 99
                                    realStep: 1
                                    realValue: page.displayPortions
                                    onRealValueChanged: {
                                        if (Math.abs(realValue - page.displayPortions) > 0.01)
                                            recipeEditorVM.setDisplayPortions(realValue)
                                    }
                                }
                                Text {
                                    text: "portions"
                                    color: Theme.colorTextSecondary
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeMd
                                }

                                Text {
                                    visible: page.isScaled
                                    text: "× " + page.scaleRatio.toLocaleString(Qt.locale(), 'f', 2)
                                          + " (recette pour " + page.defaultPortions + ")"
                                    color: Theme.colorWarning
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeSm
                                    font.weight: Theme.fontWeightMedium
                                }

                                Item { Layout.fillWidth: true }

                                AppButton {
                                    visible: page.isScaled
                                    text: "Réinitialiser"
                                    variant: "ghost"
                                    onClicked: recipeEditorVM.resetDisplayPortions()
                                }
                            }
                        }
                    }

                    // ---- C2 — Journal de cuisson ----
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.preferredHeight: cookingRow.implicitHeight + Theme.spaceMd * 2
                        radius: Theme.radiusMd
                        color: Theme.colorSurface
                        border.width: 1
                        border.color: Theme.colorBorder
                        visible: page.selectedId > 0   // saved recipe required

                        RowLayout {
                            id: cookingRow
                            anchors.fill: parent
                            anchors.margins: Theme.spaceMd
                            spacing: Theme.spaceMd

                            Text {
                                text: "📖 Journal de cuisson"
                                color: Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                font.weight: Theme.fontWeightMedium
                            }
                            Text {
                                text: page.cookedThisMonth > 0
                                      ? "Cuisinée " + page.cookedThisMonth + "× ce mois"
                                      : "Pas encore cuisinée ce mois"
                                color: page.cookedThisMonth > 0 ? Theme.colorPrimary : Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                            }
                            Item { Layout.fillWidth: true }
                            AppButton {
                                text: "✓ Cuisinée aujourd'hui"
                                variant: "secondary"
                                onClicked: page._logCookedToday()
                            }
                            AppButton {
                                text: "Voir l'historique"
                                variant: "ghost"
                                onClicked: cookingHistoryDialog.openFor(
                                    page.selectedId, metaName.text || "(sans nom)",
                                    Window.window,
                                )
                            }
                        }
                    }

                    AppButton {
                        text: "Enregistrer la recette"
                        variant: "primary"
                        Layout.alignment: Qt.AlignLeft
                        onClicked: page._saveCurrent()
                    }
                }
            }
        }
    }

    // ============================================================ Raccourcis clavier (U1)

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
        onActivated: page._saveCurrent()
    }
    Shortcut {
        sequence: "Delete"
        enabled: page.visible && page.selectedId > 0
        context: Qt.WindowShortcut
        onActivated: page._deleteCurrent()
    }

    // ============================================================ C2 — Cooking history dialog

    CookingHistoryDialog {
        id: cookingHistoryDialog
        onEntryAdded: page._refreshCookingStats()
    }

    // ============================================================ Import recette par URL
    // Window détachable. Quand le commit réussit, on rafraîchit la liste de
    // recettes et on bascule l'éditeur sur la nouvelle recette pour finitions.
    ImportRecipeUrlDialog {
        id: importUrlDialog
        onImportCompleted: function(recipeId) {
            recipeListVM.refreshList()
            recipeEditorVM.loadById(recipeId)
        }
    }

    Rectangle {
        id: cookingToast
        property string message: ""
        visible: false
        z: 20
        color: Theme.colorSuccess
        radius: Theme.radiusMd
        anchors.bottom: parent.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottomMargin: Theme.spaceXl
        opacity: 0.95
        width: cookingToastText.implicitWidth + Theme.spaceXl * 2
        height: cookingToastText.implicitHeight + Theme.spaceMd * 2
        Text {
            id: cookingToastText
            anchors.centerIn: parent
            text: cookingToast.message
            color: "white"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeMd
            font.weight: Theme.fontWeightMedium
        }
        Timer { running: cookingToast.visible; interval: 3000; onTriggered: cookingToast.visible = false }
    }

    // ============================================================ A3 — Confirmation modifs non sauvées

    AppConfirmDialog {
        id: unsavedConfirm
        mode: "save"
        title: "Modifications non sauvées"
        message: "La recette en cours d'édition a des modifications non sauvegardées. "
               + "Veux-tu les enregistrer avant de continuer ?"
        saveLabel: "Enregistrer"
        discardLabel: "Abandonner"
        cancelLabel: "Annuler"
        onSaveRequested: {
            // Sauve la recette courante puis bascule sur la cible mémorisée.
            if (recipeEditorVM.saveCurrent()) {
                recipeListVM.refreshList()
                page._resolvePendingSwitch()
            } else {
                // Sauvegarde refusée (ex : nom vide). On annule le switch pour
                // laisser l'utilisateur corriger son formulaire.
                page._pendingSwitchId = -999
            }
        }
        onDiscarded: {
            // L'utilisateur abandonne ses modifs. On réinitialise le dirty flag
            // côté VM en rechargeant l'état sauvé, puis on bascule.
            if (page.selectedId > 0) {
                recipeEditorVM.loadById(page.selectedId)
            } else {
                recipeEditorVM.loadEmpty()
            }
            page._resolvePendingSwitch()
        }
        onCancelled: {
            page._pendingSwitchId = -999
            // Rétablir la sélection visuelle dans la ListView si elle avait
            // déjà bougé (clic accidentel). Le selectedId courant est la source de vérité.
            const m = recipeListVM.items
            for (let i = 0; i < recipesList.count; i++) {
                if (m.data(m.index(i, 0), m.Roles.recipeId) === page.selectedId) {
                    recipesList.currentIndex = i
                    break
                }
            }
        }
    }

    // ============================================================ Photo toast (F6)
    // Le FileDialog vit maintenant dans `RecipePhotoBlock` (A7) ; le toast
    // de succès reste ici pour s'afficher au-dessus de toute la page.

    Rectangle {
        id: photoSavedToast
        visible: false
        z: 20
        color: Theme.colorSuccess
        radius: Theme.radiusMd
        anchors.bottom: parent.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottomMargin: Theme.spaceXl
        opacity: 0.95
        width: photoSavedText.implicitWidth + Theme.spaceXl * 2
        height: photoSavedText.implicitHeight + Theme.spaceMd * 2
        Text {
            id: photoSavedText
            anchors.centerIn: parent
            text: "✓ Photo enregistrée"
            color: "white"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeMd
            font.weight: Theme.fontWeightMedium
        }
        Timer { running: photoSavedToast.visible; interval: 3000; onTriggered: photoSavedToast.visible = false }
    }

    Rectangle {
        id: photoErrorToast
        property string message: ""
        visible: false
        z: 20
        color: Theme.colorError
        radius: Theme.radiusMd
        anchors.bottom: parent.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottomMargin: Theme.spaceXl
        opacity: 0.95
        width: Math.min(parent.width - Theme.spaceXl * 4, photoErrorText.implicitWidth + Theme.spaceXl * 2)
        height: photoErrorText.implicitHeight + Theme.spaceMd * 2
        Text {
            id: photoErrorText
            anchors.centerIn: parent
            anchors.margins: Theme.spaceMd
            text: photoErrorToast.message
            color: "white"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeSm
            wrapMode: Text.WordWrap
        }
        Timer { running: photoErrorToast.visible; interval: 5000; onTriggered: photoErrorToast.visible = false }
    }

    // ============================================================ Helpers métier

    property bool _silenceMetaPush: false  // évite la rebondisse pendant load

    // A3 : avant tout switch (clic sur une autre recette / Nouveau / changement
    // d'onglet), si l'éditeur est dirty, on intercale une confirmation
    // [Annuler / Sauver / Abandonner]. La cible (id ou -2 = nouveau) est
    // mémorisée dans `_pendingSwitchId`.
    property int _pendingSwitchId: -999   // sentinel = aucun switch en attente

    function _loadRecipe(id) {
        if (recipeEditorVM.hasUnsavedChanges && page.selectedId !== id) {
            page._pendingSwitchId = id
            unsavedConfirm.openWith({ id: id })
            return
        }
        page.selectedId = id
        page._silenceMetaPush = true
        recipeEditorVM.loadById(id)
        page._silenceMetaPush = false
    }

    function _loadNew() {
        if (recipeEditorVM.hasUnsavedChanges) {
            page._pendingSwitchId = -2
            unsavedConfirm.openWith({ id: -2 })
            return
        }
        _doLoadNew()
    }

    function _doLoadNew() {
        recipesList.currentIndex = -1
        page.selectedId = -2
        page._silenceMetaPush = true
        recipeEditorVM.loadEmpty()
        page._silenceMetaPush = false
        metaName.forceActiveFocus()
    }

    // Réalise le switch après décision de l'utilisateur sur le dialog A3.
    function _resolvePendingSwitch() {
        const id = page._pendingSwitchId
        page._pendingSwitchId = -999
        if (id === -2) {
            _doLoadNew()
        } else if (id > 0) {
            page.selectedId = id
            page._silenceMetaPush = true
            recipeEditorVM.loadById(id)
            page._silenceMetaPush = false
            // Re-aligne la sélection visuelle de la liste si elle a divergé.
            const m = recipeListVM.items
            for (let i = 0; i < recipesList.count; i++) {
                if (m.data(m.index(i, 0), m.Roles.recipeId) === id) {
                    recipesList.currentIndex = i
                    break
                }
            }
        }
    }

    function _pushMeta() {
        if (page._silenceMetaPush) return
        if (page.selectedId === -1) return
        recipeEditorVM.updateMeta(metaName.text, metaInstructions.text, metaPortions.realValue)
    }

    function _saveCurrent() {
        if (!recipeEditorVM.saveCurrent()) {
            return
        }
        recipeListVM.refreshList()
    }

    function _deleteCurrent() {
        if (page.selectedId <= 0) return
        recipeListVM.deleteRecipe(page.selectedId)
        page.selectedId = -1
        recipeEditorVM.loadEmpty()
    }
}
