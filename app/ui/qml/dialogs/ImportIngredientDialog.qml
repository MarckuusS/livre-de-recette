// Dialogue d'import : VRAIE FENÊTRE système (Window) — détachable, déplaçable
// hors de la fenêtre principale, redimensionnable. Non-modale par défaut.
//
// 2 onglets :
//   - CIQUAL (local) — recherche FTS5 avec filtres (catégorie, min/max macros),
//     tri (rang/nom/kcal/P/G/L) et pagination (25 résultats/page).
//   - OpenFoodFacts (en ligne) — recherche on-demand, simple liste limitée à 30.
//
// L'état (query, filtres, tri, page) est conservé par instance de Tab pour
// la durée du dialog — un changement d'onglet ne réinitialise pas.
//
// Ajout en bibliothèque : double-clic ou bouton "+ Ajouter" → flippe
// `in_personal_library = True` côté DB.

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Window {
    id: root

    title: "Importer un ingrédient"
    width: 920
    height: 640
    minimumWidth: 720
    minimumHeight: 480
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
                     | Qt.WindowMinMaxButtonsHint
    modality: Qt.NonModal

    signal libraryChanged()

    function openCentered(parentWindow) {
        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        show()
        raise()
    }

    property string _lastImportName: ""

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        Text {
            text: "Importer un ingrédient"
            color: Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXl
            font.weight: Theme.fontWeightSemiBold
        }

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
            AppTabButton { text: "CIQUAL (local)"; width: 180 }
            AppTabButton { text: "OpenFoodFacts (en ligne)"; width: 220 }
        }

        StackLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            currentIndex: tabBar.currentIndex

            CatalogTabRich {
                id: ciqualTab
                source: "ciqual"
                placeholderText: "Rechercher dans CIQUAL (~3 000 entrées)…"
                onResultActivated: function(id) { root._promote(id) }
                onResultsMultiActivated: function(ids) { root._promoteMany(ids, ciqualTab) }
            }
            CatalogTabSimple {
                id: offTab
                source: "openfoodfacts"
                placeholderText: "Rechercher dans OpenFoodFacts (en ligne)…"
                onResultActivated: function(id) { root._promote(id) }
                onResultsMultiActivated: function(ids) { root._promoteMany(ids, offTab) }
            }
        }

        // Confirmation post-import
        Text {
            visible: root._lastImportName !== ""
            Layout.fillWidth: true
            text: "✓ Ajouté à ta bibliothèque : " + root._lastImportName
            color: Theme.colorSuccess
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeSm
            font.weight: Theme.fontWeightMedium
        }

        RowLayout {
            Layout.fillWidth: true
            Item { Layout.fillWidth: true }
            AppButton {
                text: "Fermer"
                variant: "secondary"
                onClicked: root.close()
            }
        }
    }

    function _promote(ingredientId) {
        const saved = ingredientVM.importExisting(ingredientId)
        if (saved && saved.name) {
            _lastImportName = saved.name
            ciqualTab.markImported(ingredientId)
            offTab.markImported(ingredientId)
            libraryChanged()
        }
    }

    // B1 — Multi-import : promote plusieurs lignes en une transaction côté
    // Python (slot `importMany`), puis met à jour les badges 🌟 / boutons
    // "Déjà ajouté" sur chaque ligne, vide la sélection, et notifie la page
    // parente pour rafraîchir la bibliothèque.
    function _promoteMany(ids, tab) {
        if (!ids || ids.length === 0) return
        const count = ingredientVM.importMany(ids)
        if (count > 0) {
            for (let i = 0; i < ids.length; i++) {
                ciqualTab.markImported(ids[i])
                offTab.markImported(ids[i])
            }
            _lastImportName = count + " ingrédients"
            libraryChanged()
        }
        if (tab) tab._clearSelection()
    }

    // ============================================================ Composants

    // ---- Onglet riche : recherche locale paginée + filtres + tri (CIQUAL) ----
    component CatalogTabRich: RowLayout {
        id: tab

        property string source: "ciqual"
        property string placeholderText: "Rechercher…"
        signal resultActivated(int ingredientId)
        // B1 : sélection multiple persistée à travers les changements de page
        // / query. Le footer affiche "+ Importer (N)" et appelle
        // root._promoteMany(ids).
        property var _selectedIds: ({})
        property int _selectionCount: 0
        signal resultsMultiActivated(var ids)

        function _isSelected(id) { return _selectedIds[id] === true }
        function _toggleSelection(id) {
            const next = Object.assign({}, _selectedIds)
            if (next[id]) {
                delete next[id]
            } else {
                next[id] = true
            }
            _selectedIds = next
            _selectionCount = Object.keys(next).length
        }
        function _clearSelection() {
            _selectedIds = ({})
            _selectionCount = 0
        }
        function _selectedIdsList() {
            return Object.keys(_selectedIds).map(function(s) { return parseInt(s) })
        }
        function _selectVisible() {
            const next = Object.assign({}, _selectedIds)
            for (let i = 0; i < resultsModel.count; i++) {
                const m = resultsModel.get(i)
                if (!m.inLibrary) next[m.ingredientId] = true
            }
            _selectedIds = next
            _selectionCount = Object.keys(next).length
        }

        spacing: Theme.spaceMd

        // État persistant entre rendus (mais pas entre ouvertures du dialog —
        // pour persister cross-session il faudrait Settings / LocalStorage).
        property string _query: ""
        property string _categoryL1: ""
        property real _minKcal: 0
        property real _maxKcal: 0
        property real _minProteins: 0
        property real _maxProteins: 0
        property real _minCarbs: 0
        property real _maxCarbs: 0
        property real _minFats: 0
        property real _maxFats: 0
        property string _sortBy: "rank"
        property bool _sortDesc: false
        property int _page: 1
        property int _pageCount: 1
        property int _totalCount: 0
        property var _categories: []

        function markImported(id) {
            for (let i = 0; i < resultsModel.count; i++) {
                if (resultsModel.get(i).ingredientId === id) {
                    resultsModel.setProperty(i, "inLibrary", true)
                    return
                }
            }
        }

        function _runSearch() {
            const opts = {
                "source":      tab.source,
                "query":       tab._query,
                "categoryL1":  tab._categoryL1,
                "minKcal":     tab._minKcal,
                "maxKcal":     tab._maxKcal,
                "minProteins": tab._minProteins,
                "maxProteins": tab._maxProteins,
                "minCarbs":    tab._minCarbs,
                "maxCarbs":    tab._maxCarbs,
                "minFats":     tab._minFats,
                "maxFats":     tab._maxFats,
                "sortBy":      tab._sortBy,
                "sortDesc":    tab._sortDesc,
                "page":        tab._page,
                "pageSize":    25
            }
            const result = ingredientVM.searchCatalogPaged(opts)
            resultsModel.clear()
            for (let i = 0; i < result.matches.length; i++) {
                const m = result.matches[i]
                // Sanitize : `null` Python → `null` JS, mais champ absent →
                // `undefined`, qui passe le check !== null. On force tout
                // en number ou sentinelle pour éviter "kcal is undefined".
                resultsModel.append({
                    "ingredientId": m.id || 0,
                    "name":         m.name || "",
                    "kcal":         (typeof m.kcal === "number")     ? m.kcal     : -1,
                    "proteins":     (typeof m.proteins === "number") ? m.proteins : -1,
                    "carbs":        (typeof m.carbs === "number")    ? m.carbs    : -1,
                    "fats":         (typeof m.fats === "number")     ? m.fats     : -1,
                    "categoryL1":   m.categoryL1 || "",
                    "inLibrary":    m.inLibrary === true
                })
            }
            tab._totalCount = result.totalCount
            tab._pageCount = result.pageCount
        }

        function _resetFilters() {
            tab._categoryL1 = ""
            tab._minKcal = 0; tab._maxKcal = 0
            tab._minProteins = 0; tab._maxProteins = 0
            tab._minCarbs = 0; tab._maxCarbs = 0
            tab._minFats = 0; tab._maxFats = 0
            tab._sortBy = "rank"
            tab._sortDesc = false
            tab._page = 1
            // Sync UI : remettre les widgets à leur valeur initiale
            categoryCombo.currentIndex = 0
            kcalRange.reset()
            protRange.reset()
            carbsRange.reset()
            fatsRange.reset()
            sortCombo.currentIndex = 0
            descCheck.checked = false
            tab._runSearch()
        }

        ListModel { id: resultsModel }

        Component.onCompleted: {
            // Garde : si le context property `ingredientVM` n'est pas encore résolu
            // (cas du StackLayout instancié au load avant injection complète),
            // on diffère le runSearch — il sera trigger au premier focus de l'onglet.
            if (typeof ingredientVM !== "undefined" && ingredientVM) {
                tab._categories = ingredientVM.categoriesL1(tab.source)
                categoryCombo.model = ["(toutes catégories)"].concat(tab._categories)
                tab._runSearch()
            }
        }

        // ---------- Panneau filtres ----------
        Rectangle {
            Layout.preferredWidth: 250
            Layout.fillHeight: true
            Layout.minimumWidth: 220
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorBorder

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Theme.spaceMd
                spacing: Theme.spaceMd

                Text {
                    text: "Filtres"
                    color: Theme.colorText
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeMd
                    font.weight: Theme.fontWeightSemiBold
                }

                // Catégorie
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    Text {
                        text: "Catégorie"
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                    }
                    AppComboBox {
                        id: categoryCombo
                        Layout.fillWidth: true
                        onActivated: function(index) {
                            tab._categoryL1 = (index === 0) ? "" : tab._categories[index - 1]
                            tab._page = 1
                            tab._runSearch()
                        }
                    }
                }

                // Macros min/max — chaque paire dans son propre MacroRangeField
                MacroRangeField {
                    id: kcalRange
                    Layout.fillWidth: true
                    rangeLabel: "Énergie (kcal/100g)"
                    unit: "kcal/100g"
                    maxV: 2000
                    onMinValueChanged: { tab._minKcal = minValue; tab._page = 1; tab._runSearch() }
                    onMaxValueChanged: { tab._maxKcal = maxValue; tab._page = 1; tab._runSearch() }
                }
                MacroRangeField {
                    id: protRange
                    Layout.fillWidth: true
                    rangeLabel: "Protéines (g/100g)"
                    onMinValueChanged: { tab._minProteins = minValue; tab._page = 1; tab._runSearch() }
                    onMaxValueChanged: { tab._maxProteins = maxValue; tab._page = 1; tab._runSearch() }
                }
                MacroRangeField {
                    id: carbsRange
                    Layout.fillWidth: true
                    rangeLabel: "Glucides (g/100g)"
                    onMinValueChanged: { tab._minCarbs = minValue; tab._page = 1; tab._runSearch() }
                    onMaxValueChanged: { tab._maxCarbs = maxValue; tab._page = 1; tab._runSearch() }
                }
                MacroRangeField {
                    id: fatsRange
                    Layout.fillWidth: true
                    rangeLabel: "Lipides (g/100g)"
                    onMinValueChanged: { tab._minFats = minValue; tab._page = 1; tab._runSearch() }
                    onMaxValueChanged: { tab._maxFats = maxValue; tab._page = 1; tab._runSearch() }
                }

                // Tri
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    Text {
                        text: "Trier par"
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                    }
                    AppComboBox {
                        id: sortCombo
                        Layout.fillWidth: true
                        textRole: "label"
                        valueRole: "code"
                        model: ListModel {
                            ListElement { label: "Pertinence";  code: "rank" }
                            ListElement { label: "Nom";          code: "name" }
                            ListElement { label: "Énergie";      code: "kcal" }
                            ListElement { label: "Protéines";    code: "proteins" }
                            ListElement { label: "Glucides";     code: "carbs" }
                            ListElement { label: "Lipides";      code: "fats" }
                        }
                        onActivated: function(index) {
                            tab._sortBy = currentValue
                            tab._page = 1
                            tab._runSearch()
                        }
                    }
                    AppCheckBox {
                        id: descCheck
                        text: "Décroissant"
                        onToggled: {
                            tab._sortDesc = checked
                            tab._page = 1
                            tab._runSearch()
                        }
                    }
                }

                Item { Layout.fillHeight: true }

                AppButton {
                    Layout.fillWidth: true
                    text: "Réinitialiser"
                    variant: "ghost"
                    onClicked: tab._resetFilters()
                }
            }

        }

        // ---------- Panneau résultats ----------
        ColumnLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: Theme.spaceMd

            // Barre de recherche
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceSm
                AppTextField {
                    id: queryField
                    Layout.fillWidth: true
                    placeholderText: tab.placeholderText
                    onTextChanged: searchDebounce.restart()
                    onAccepted: { tab._query = text; tab._page = 1; tab._runSearch() }
                }
                Timer {
                    id: searchDebounce
                    interval: 250
                    repeat: false
                    onTriggered: { tab._query = queryField.text; tab._page = 1; tab._runSearch() }
                }
            }

            // Liste des résultats
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: Theme.colorSurface
                radius: Theme.radiusMd
                border.width: 1
                border.color: Theme.colorBorder

                ListView {
                    id: resultsList
                    anchors.fill: parent
                    anchors.margins: 1
                    clip: true
                    model: resultsModel
                    spacing: 0
                    ScrollBar.vertical: AppScrollBar {}

                    delegate: AppListItem {
                        width: ListView.view.width
                        height: 56
                        onDoubleClicked: tab.resultActivated(model.ingredientId)

                        content: RowLayout {
                            anchors.fill: parent
                            spacing: Theme.spaceSm

                            // B1 : checkbox de sélection multiple (cachée pour
                            // les rows déjà importés — pas d'action utile).
                            AppCheckBox {
                                visible: !model.inLibrary
                                checked: tab._isSelected(model.ingredientId)
                                onClicked: tab._toggleSelection(model.ingredientId)
                                Layout.preferredWidth: 28
                            }
                            // Réserve l'espace pour aligner les rows déjà-imports
                            // avec ceux ayant la checkbox.
                            Item {
                                visible: model.inLibrary
                                Layout.preferredWidth: 28
                            }

                            Text {
                                visible: model.inLibrary
                                text: "🌟"
                                font.pixelSize: Theme.fontSizeMd
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
                                    text: (model.kcal >= 0 ? Math.round(model.kcal) + " kcal" : "")
                                        + (model.proteins >= 0 ? "  ·  P " + model.proteins.toFixed(1) + " g" : "")
                                        + (model.carbs >= 0 ? "  ·  G " + model.carbs.toFixed(1) + " g" : "")
                                        + (model.fats >= 0 ? "  ·  L " + model.fats.toFixed(1) + " g" : "")
                                        + (model.categoryL1 ? "  ·  " + model.categoryL1 : "")
                                    color: Theme.colorTextSecondary
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeXs
                                    elide: Text.ElideRight
                                }
                            }
                            AppButton {
                                text: model.inLibrary ? "Déjà ajouté" : "+ Ajouter"
                                variant: model.inLibrary ? "ghost" : "secondary"
                                enabled: !model.inLibrary
                                onClicked: tab.resultActivated(model.ingredientId)
                            }
                        }
                    }
                }
                Text {
                    anchors.centerIn: parent
                    visible: resultsModel.count === 0
                    text: tab._totalCount === 0 && tab._query === "" && tab._categoryL1 === ""
                          ? "Tape une requête ou applique un filtre."
                          : "Aucun résultat avec ces critères."
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeMd
                }
            }

            // B1 — Multi-import : bandeau visible dès qu'il y a 1+ sélection.
            // Le compteur persiste à travers les changements de page / query
            // (le user peut chercher "tomate", cocher 3, chercher "carotte",
            // cocher 2, puis "+ Importer (5)").
            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: tab._selectionCount > 0 ? 44 : 0
                visible: tab._selectionCount > 0
                color: Qt.alpha(Theme.colorPrimary, 0.10)
                radius: Theme.radiusSm
                border.width: 1
                border.color: Theme.colorPrimary
                Behavior on Layout.preferredHeight { NumberAnimation { duration: Theme.durationFast } }

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: Theme.spaceMd
                    anchors.rightMargin: Theme.spaceMd
                    spacing: Theme.spaceMd

                    Text {
                        text: "✓ " + tab._selectionCount + " sélectionné"
                              + (tab._selectionCount > 1 ? "s" : "")
                        color: Theme.colorPrimary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeMd
                        font.weight: Theme.fontWeightMedium
                    }
                    Item { Layout.fillWidth: true }
                    AppButton {
                        text: "Sélectionner la page"
                        variant: "ghost"
                        onClicked: tab._selectVisible()
                    }
                    AppButton {
                        text: "Tout désélectionner"
                        variant: "ghost"
                        onClicked: tab._clearSelection()
                    }
                    AppButton {
                        text: "+ Importer (" + tab._selectionCount + ")"
                        variant: "primary"
                        onClicked: tab.resultsMultiActivated(tab._selectedIdsList())
                    }
                }
            }

            // Pagination footer
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceMd

                AppButton {
                    text: "‹ Précédent"
                    variant: "ghost"
                    enabled: tab._page > 1
                    onClicked: { tab._page = tab._page - 1; tab._runSearch() }
                }

                Item { Layout.fillWidth: true }

                Text {
                    text: tab._totalCount > 0
                          ? ("Page " + tab._page + " / " + tab._pageCount
                             + "  ·  " + tab._totalCount + " résultat"
                             + (tab._totalCount > 1 ? "s" : ""))
                          : "Aucun résultat"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                }

                Item { Layout.fillWidth: true }

                AppButton {
                    text: "Suivant ›"
                    variant: "ghost"
                    enabled: tab._page < tab._pageCount
                    onClicked: { tab._page = tab._page + 1; tab._runSearch() }
                }
            }
        }
    }

    // ---- Onglet simple : recherche on-demand sans filtres (OFF) ----
    component CatalogTabSimple: ColumnLayout {
        id: tab

        property string source: "openfoodfacts"
        property string placeholderText: "Rechercher…"
        signal resultActivated(int ingredientId)
        // B1 : sélection multiple (mêmes mécaniques que CatalogTabRich).
        property var _selectedIds: ({})
        property int _selectionCount: 0
        signal resultsMultiActivated(var ids)

        function _isSelected(id) { return _selectedIds[id] === true }
        function _toggleSelection(id) {
            const next = Object.assign({}, _selectedIds)
            if (next[id]) {
                delete next[id]
            } else {
                next[id] = true
            }
            _selectedIds = next
            _selectionCount = Object.keys(next).length
        }
        function _clearSelection() {
            _selectedIds = ({})
            _selectionCount = 0
        }
        function _selectedIdsList() {
            return Object.keys(_selectedIds).map(function(s) { return parseInt(s) })
        }
        function _selectVisible() {
            const next = Object.assign({}, _selectedIds)
            for (let i = 0; i < resultsModelOff.count; i++) {
                const m = resultsModelOff.get(i)
                if (!m.inLibrary) next[m.ingredientId] = true
            }
            _selectedIds = next
            _selectionCount = Object.keys(next).length
        }

        spacing: Theme.spaceMd

        function markImported(id) {
            for (let i = 0; i < resultsModelOff.count; i++) {
                if (resultsModelOff.get(i).ingredientId === id) {
                    resultsModelOff.setProperty(i, "inLibrary", true)
                    return
                }
            }
        }

        ListModel { id: resultsModelOff }

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceSm

            AppTextField {
                id: queryFieldOff
                Layout.fillWidth: true
                Layout.maximumWidth: 480
                placeholderText: tab.placeholderText
                onAccepted: tab._runSearch()
            }
            AppButton {
                id: offSearchBtn
                text: "Chercher en ligne"
                variant: "primary"
                enabled: queryFieldOff.text.trim().length >= 2
                         && (typeof networkVM === "undefined" || !networkVM || networkVM.online)
                onClicked: tab._runSearch()
            }
            Text {
                visible: typeof networkVM !== "undefined" && networkVM && !networkVM.online
                text: "⚠ OFF indisponible — réessaye plus tard"
                color: Theme.colorWarning
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
            }
            Item { Layout.fillWidth: true }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorBorder

            ListView {
                anchors.fill: parent
                anchors.margins: 1
                clip: true
                model: resultsModelOff
                spacing: 0
                ScrollBar.vertical: AppScrollBar {}

                delegate: AppListItem {
                    width: ListView.view.width
                    height: 50
                    onDoubleClicked: tab.resultActivated(model.ingredientId)
                    content: RowLayout {
                        anchors.fill: parent
                        spacing: Theme.spaceSm

                        // B1 : checkbox pour sélection multi-import
                        AppCheckBox {
                            visible: !model.inLibrary
                            checked: tab._isSelected(model.ingredientId)
                            onClicked: tab._toggleSelection(model.ingredientId)
                            Layout.preferredWidth: 28
                        }
                        Item {
                            visible: model.inLibrary
                            Layout.preferredWidth: 28
                        }

                        Text {
                            visible: model.inLibrary
                            text: "🌟"
                            font.pixelSize: Theme.fontSizeMd
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
                        }
                        AppButton {
                            text: model.inLibrary ? "Déjà ajouté" : "+ Ajouter"
                            variant: model.inLibrary ? "ghost" : "secondary"
                            enabled: !model.inLibrary
                            onClicked: tab.resultActivated(model.ingredientId)
                        }
                    }
                }
            }
            Text {
                anchors.centerIn: parent
                visible: resultsModelOff.count === 0 && !busyLabel.visible
                text: queryFieldOff.text.trim() === ""
                      ? "Tape au moins 2 caractères et clique « Chercher »."
                      : "Aucun résultat."
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
            }
            Text {
                id: busyLabel
                anchors.centerIn: parent
                visible: false
                text: "Recherche en cours…"
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
            }
        }

        function _runSearch() {
            const q = queryFieldOff.text.trim()
            resultsModelOff.clear()
            if (q.length < 2) return
            busyLabel.visible = true
            Qt.callLater(function() {
                const items = ingredientVM.fetchOnlineAndList(q, 30)
                busyLabel.visible = false
                for (let i = 0; i < items.length; i++) {
                    const it = items[i]
                    resultsModelOff.append({
                        "ingredientId": it.id,
                        "name":         it.name,
                        "inLibrary":    it.inLibrary === true
                    })
                }
            })
        }

        // B1 — bandeau multi-import (apparaît dès qu'1 résultat est coché).
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: tab._selectionCount > 0 ? 44 : 0
            visible: tab._selectionCount > 0
            color: Qt.alpha(Theme.colorPrimary, 0.10)
            radius: Theme.radiusSm
            border.width: 1
            border.color: Theme.colorPrimary
            Behavior on Layout.preferredHeight { NumberAnimation { duration: Theme.durationFast } }

            RowLayout {
                anchors.fill: parent
                anchors.leftMargin: Theme.spaceMd
                anchors.rightMargin: Theme.spaceMd
                spacing: Theme.spaceMd

                Text {
                    text: "✓ " + tab._selectionCount + " sélectionné"
                          + (tab._selectionCount > 1 ? "s" : "")
                    color: Theme.colorPrimary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeMd
                    font.weight: Theme.fontWeightMedium
                }
                Item { Layout.fillWidth: true }
                AppButton {
                    text: "Sélectionner la page"
                    variant: "ghost"
                    onClicked: tab._selectVisible()
                }
                AppButton {
                    text: "Tout désélectionner"
                    variant: "ghost"
                    onClicked: tab._clearSelection()
                }
                AppButton {
                    text: "+ Importer (" + tab._selectionCount + ")"
                    variant: "primary"
                    onClicked: tab.resultsMultiActivated(tab._selectedIdsList())
                }
            }
        }
    }

    // ---- Sous-composant : paire min/max FixedUnitField avec un label ----
    component MacroRangeField: ColumnLayout {
        property string rangeLabel: ""
        property string unit: "g/100g"
        property real maxV: 1000

        // Valeurs courantes — propagées via signals onMinValueChanged / onMaxValueChanged
        property real minValue: 0
        property real maxValue: 0

        function reset() {
            minField.clear()
            maxField.clear()
        }

        spacing: 2

        Text {
            text: rangeLabel
            color: Theme.colorTextSecondary
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXs
        }
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceXs

            FixedUnitField {
                id: minField
                Layout.fillWidth: true
                unitText: parent.parent.unit
                maxValue: parent.parent.maxV
                onValueEdited: parent.parent.minValue = value
            }
            Text {
                text: "—"
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
            }
            FixedUnitField {
                id: maxField
                Layout.fillWidth: true
                unitText: parent.parent.unit
                maxValue: parent.parent.maxV
                onValueEdited: parent.parent.maxValue = value
            }
        }
    }
}
