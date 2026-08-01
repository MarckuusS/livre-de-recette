// Onglet 3 — Calendrier hebdomadaire : grille 7 jours × 3 slots (matin/midi/soir).
// Navigation Prev/Aujourd'hui/Next, totaux nutrition par jour + coût semaine.
//
// VM : `calendarVM` (singleton instancié Python-side).

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
import App
import "../components"
import "../dialogs"

Item {
    id: page

    readonly property var dayLabels: ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]
    // Refonte UX : les 5 slots sont TOUJOURS affichés en permanence (matin /
    // en-cas matin / midi / en-cas après-midi / soir). Avant, un toggle du
    // menu Affichage cachait les 2 en-cas par défaut — c'était confus :
    // l'utilisateur ne comprenait pas que des slots existaient. La grille
    // est wrappée dans une ScrollView verticale plus bas pour absorber la
    // hauteur supplémentaire si la fenêtre est trop courte.
    readonly property var slotKeys:   ["morning", "snack_morning", "noon", "snack_afternoon", "evening"]
    readonly property var slotLabels: ["Matin",   "10 h (en-cas)",  "Midi", "16 h (goûter)",   "Soir"]

    property var weekCost: ({ total: "0.00", missingPriceCount: 0 })
    // F9 : historique des 12 dernières semaines pour le mini-graphique.
    property var costHistory: []   // [{isoWeek, totalEur, missingCount}, ...]
    // Récap nutritionnel : 7 dicts (1 par jour, lundi → dimanche) + 1 dict
    // semaine, tous au format `_nutrition_to_dict` (kcal, proteins, …).
    property var dayTotals: [{}, {}, {}, {}, {}, {}, {}]
    property var weekTotal: ({})
    // Métadonnées de la semaine courante : pour chaque jour, son n° + mois.
    // Alimente le header de la grille ("avril 28" au-dessus de "Lundi").
    property var daysOfWeek: [{}, {}, {}, {}, {}, {}, {}]
    // U2 : panneau latéral "ingrédients rapides" pour drag-drop.
    property bool sidePanelOpen: false
    property var sidePanelIngredients: []   // peuplé par tagVM/ingredientVM
    property string sidePanelQuery: ""

    // ============================================================ Connexions VM

    Connections {
        target: calendarVM
        function onWeek_changed() { page._refreshDerived() }
        function onDeletion_pending_undo(label) { undoToast.show(label) }
    }

    UndoToast {
        id: undoToast
        onUndoClicked: calendarVM.undoLastDelete()
    }

    function _refreshDerived() {
        weekCost = calendarVM.weekCostAsDict()
        costHistory = calendarVM.costHistoryRecent(12)
        // Recalcule les 7 totaux jour + le total semaine. Le VM ouvre une
        // session par appel — pour 8 appels, c'est négligeable (<10 ms total
        // sur une semaine bien remplie).
        const days = []
        for (let d = 0; d < 7; ++d)
            days.push(calendarVM.dayTotalAsDict(d))
        dayTotals = days
        weekTotal = calendarVM.weekTotalAsDict()
        daysOfWeek = calendarVM.daysAsList()
    }

    Component.onCompleted: _refreshDerived()

    // ============================================================ Layout

    RowLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

    // Le contenu principal (navigation + grille + récap nutrition + coût +
    // historique) est wrappé dans un ScrollView : la molette fait défiler
    // l'ensemble de la page, ce qui permet de garder la grille à sa hauteur
    // naturelle (≈ 5 slots × ~90 px) et d'accéder au reste en scrollant —
    // au lieu d'avoir une mini-scrollview INTERNE à la grille qui réduisait
    // sa hauteur visible. Pour bloquer le scroll horizontal, on borne la
    // largeur du ColumnLayout à `availableWidth` du ScrollView.
    ScrollView {
        id: pageScroll
        Layout.fillWidth: true
        Layout.fillHeight: true
        clip: true
        ScrollBar.vertical: AppScrollBar { orientation: Qt.Vertical }
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

        ColumnLayout {
            id: pageContent
            // `pageScroll.availableWidth` = viewport - scrollbar. Sans cette
            // borne explicite, la ColumnLayout s'auto-dimensionne sur l'implicit
            // width des enfants au lieu de prendre toute la largeur dispo
            // (le résultat visuel : grille tassée à gauche avec un grand vide
            // à droite). Ne pas utiliser `parent.width` ici : le contentItem
            // du ScrollView dimensionne sa largeur sur son enfant → boucle.
            width: pageScroll.availableWidth
            spacing: Theme.spaceMd

        // ---- Barre de navigation ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceMd

            AppButton {
                text: "‹ Semaine précédente"
                variant: "secondary"
                onClicked: calendarVM.shiftWeek(-1)
            }
            AppButton {
                text: "Aujourd'hui"
                variant: "ghost"
                onClicked: calendarVM.setIsoWeek(_currentWeek())
            }
            AppButton {
                text: "Semaine suivante ›"
                variant: "secondary"
                onClicked: calendarVM.shiftWeek(1)
            }

            // Séparateur visuel
            Rectangle {
                Layout.preferredWidth: 1
                Layout.preferredHeight: 24
                color: Theme.colorBorder
            }

            AppButton {
                text: "📋 Copier la semaine précédente"
                variant: "ghost"
                onClicked: page._copyPreviousWeek()
            }

            // C1 — Templates : sauvegarde de la semaine courante + chargement
            // d'un template sauvé. Le bouton "Templates ▾" ouvre une popup
            // listant les templates ; clic = applique au calendrier courant.
            AppButton {
                id: templatesButton
                text: "📁 Templates ▾"
                variant: "ghost"
                onClicked: templatesPopup.openAt(templatesButton)
            }
            AppButton {
                text: "💾 Sauver semaine"
                variant: "ghost"
                enabled: calendarVM && calendarVM.currentWeekEntryCount() > 0
                onClicked: saveTemplateDialog.openCentered()
            }

            AppButton {
                text: page.sidePanelOpen ? "🗂️ ‹" : "🗂️ Drag-drop"
                variant: "ghost"
                onClicked: page._toggleSidePanel()
            }

            Item { Layout.fillWidth: true }
            Text {
                text: "Semaine " + (calendarVM ? calendarVM.isoWeek : "")
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeLg
                font.weight: Theme.fontWeightSemiBold
            }
        }

        // ---- Grille 7 × 5 ----
        // Refonte UX : les 5 slots (matin / en-cas matin / midi / en-cas
        // après-midi / soir) sont affichés en permanence. La grille prend sa
        // hauteur naturelle (5 slots × hauteur max d'une ligne, façon tableur).
        // L'overflow vertical est absorbé par le ScrollView qui englobe TOUT
        // le contenu de la page — la molette défile la page entière, on n'a
        // plus une mini-scrollview enfermée dans la grille.
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: gridContent.implicitHeight + Theme.spaceMd * 2
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorBorder

            ColumnLayout {
                id: gridContent
                anchors.fill: parent
                anchors.margins: Theme.spaceMd
                spacing: Theme.spaceXs

                // Header : "" + 7 jours. Chaque cellule jour empile la date
                // (mois + n°, en plus petit + gris) au-dessus du nom du jour.
                // La colonne label slot à gauche fait 130 px — assez large
                // pour "10 h (en-cas)" sans wrap, et calé sur la largeur du
                // libellé de nutriment dans le panneau récap en dessous.
                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spaceXs
                    Item { Layout.preferredWidth: 130 }
                    Repeater {
                        model: page.dayLabels
                        delegate: ColumnLayout {
                            Layout.fillWidth: true
                            Layout.preferredHeight: 60
                            spacing: 2
                            // Sous-titre date : "avr 28"
                            Text {
                                Layout.fillWidth: true
                                Layout.topMargin: 4
                                text: page.daysOfWeek[index] && page.daysOfWeek[index].monthShort
                                      ? (page.daysOfWeek[index].monthShort + " "
                                         + page.daysOfWeek[index].dayNumber)
                                      : ""
                                color: Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeXs
                                horizontalAlignment: Text.AlignHCenter
                            }
                            // Nom du jour
                            Text {
                                Layout.fillWidth: true
                                text: modelData
                                color: Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeMd
                                font.weight: Theme.fontWeightSemiBold
                                horizontalAlignment: Text.AlignHCenter
                            }
                        }
                    }
                }

                // 5 lignes : matin / en-cas matin / midi / en-cas après-midi
                // / soir (toujours affichées). Refonte UX façon tableur : pas
                // de hauteur fixe sur la ligne. La ligne adopte la hauteur du
                // plus grand MealSlot (= max des `implicitHeight` selon le
                // contenu). L'overflow général de la page est géré par le
                // ScrollView extérieur.
                Repeater {
                    model: page.slotKeys.length
                    delegate: RowLayout {
                        property int slotIdx: index
                        Layout.fillWidth: true
                        spacing: Theme.spaceXs

                        // Label du slot — alignement vertical centré sur la
                        // hauteur de la ligne. 130 px : largeur alignée sur la
                        // zone label du panneau récap nutritionnel en dessous,
                        // pour que les colonnes jour de la grille et du tableau
                        // s'alignent au pixel près.
                        Text {
                            Layout.preferredWidth: 130
                            Layout.fillHeight: true
                            text: page.slotLabels[slotIdx]
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeMd
                            font.weight: Theme.fontWeightSemiBold
                            horizontalAlignment: Text.AlignRight
                            verticalAlignment: Text.AlignVCenter
                            wrapMode: Text.WordWrap
                        }
                        // 7 cellules. `Layout.fillHeight: true` propage la
                        // hauteur de la ligne à toutes les cellules pour un
                        // alignement tableur garanti.
                        Repeater {
                            model: 7
                            delegate: MealSlot {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                dayOfWeek: index
                                slot: page.slotKeys[slotIdx]
                                entriesModel: calendarVM ? calendarVM.entries : null
                                onAddRequested: function(d, s) { page._openAddDialog(d, s) }
                                onEntryRemoved: function(id) { calendarVM.removeEntry(id) }
                                onIngredientDropped: function(d, s, ingId, qty) {
                                    calendarVM.addIngredient(d, s, ingId, qty)
                                }
                            }
                        }
                    }
                }
            }
        }

        // ---- Récap nutritionnel par jour ----
        // Tableau 8 nutriments (ordre UE) × 7 jours, ALIGNÉ verticalement
        // avec la grille de meals au-dessus : zone label = 130 px (même que
        // le `Layout.preferredWidth` du label slot), colonnes valeurs en
        // `Layout.fillWidth` pour partager équitablement la largeur restante
        // — donc chaque colonne du tableau se cale sous la colonne du jour
        // correspondant. Le total semaine est affiché séparément en chip
        // sous le titre (ne rentre pas dans le découpage 7 colonnes alignées).
        NutritionPanel {
            Layout.fillWidth: true
            visible: (page.weekTotal && page.weekTotal.kcal !== undefined
                                      && page.weekTotal.kcal > 0)
            title: "Apports nutritionnels par jour  ·  Semaine : "
                   + Math.round(page.weekTotal.kcal || 0) + " kcal"
            labelColumnWidth: 130
            useFlexibleColumns: true
            // Mêmes paramètres d'espacement et d'alignement que la grille
            // jour ci-dessus : spacing entre colonnes = Theme.spaceXs (sinon
            // les colonnes drift de quelques pixels au fur et à mesure), et
            // contenu centré dans chaque cellule pour s'aligner sous les
            // entêtes "Lundi"/"Mardi"/… qui sont eux-mêmes centrés.
            cellSpacing: Theme.spaceXs
            centerCells: true
            iconSize: 18
            columnTitles: page.dayLabels
            columnData: page.dayTotals
        }

        // ---- Coût semaine ----
        Rectangle {
            Layout.fillWidth: true
            radius: Theme.radiusMd
            color: Theme.colorSurface
            border.width: 1
            border.color: Theme.colorBorder
            implicitHeight: costRow.implicitHeight + Theme.spaceMd * 2

            RowLayout {
                id: costRow
                anchors.fill: parent
                anchors.margins: Theme.spaceMd
                spacing: Theme.spaceLg

                Text {
                    text: "Coût de la semaine :"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                    font.weight: Theme.fontWeightMedium
                }
                Text {
                    text: Number(parseFloat(page.weekCost.total)).toLocaleString(Qt.locale(), 'f', 2) + " €"
                    color: Theme.colorText
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeLg
                    font.weight: Theme.fontWeightSemiBold
                }
                Item { Layout.fillWidth: true }
                Text {
                    visible: page.weekCost.missingPriceCount > 0
                    text: "⚠ " + page.weekCost.missingPriceCount + " ligne(s) sans prix"
                    color: Theme.colorWarning
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                }
            }
        }

        // ---- Mini-graphique historique 12 dernières semaines (F9) ----
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: page.costHistory.length > 0 ? 110 : 0
            visible: page.costHistory.length > 0
            radius: Theme.radiusMd
            color: Theme.colorSurface
            border.width: 1
            border.color: Theme.colorBorder

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Theme.spaceSm
                spacing: 2

                RowLayout {
                    Layout.fillWidth: true
                    Text {
                        text: "Évolution sur " + page.costHistory.length + " semaine"
                              + (page.costHistory.length > 1 ? "s" : "")
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                        font.weight: Theme.fontWeightMedium
                    }
                    Item { Layout.fillWidth: true }
                    Text {
                        text: page._costHistoryStats()
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                    }
                }

                // Zone graphique : barres + labels
                Item {
                    Layout.fillWidth: true
                    Layout.fillHeight: true

                    // Barres
                    RowLayout {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.bottom: parent.bottom
                        anchors.bottomMargin: 14   // place pour les labels
                        height: parent.height - 14
                        spacing: 4

                        Repeater {
                            model: page.costHistory
                            delegate: ColumnLayout {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                spacing: 1

                                Item { Layout.fillHeight: true }   // pousse la barre vers le bas

                                // Tooltip sur survol : montre la valeur exacte
                                Text {
                                    Layout.alignment: Qt.AlignHCenter
                                    visible: barMouse.containsMouse
                                    text: Number(parseFloat(modelData.totalEur)).toLocaleString(Qt.locale(), 'f', 2) + " €"
                                    color: Theme.colorText
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeXs
                                    font.weight: Theme.fontWeightSemiBold
                                }

                                Rectangle {
                                    Layout.fillWidth: true
                                    Layout.maximumWidth: 28
                                    Layout.alignment: Qt.AlignHCenter
                                    Layout.preferredHeight: page._barHeight(modelData.totalEur)
                                    radius: 2
                                    color: modelData.isoWeek === calendarVM.isoWeek
                                           ? Theme.colorPrimary
                                           : Qt.alpha(Theme.colorPrimary, 0.45)
                                    Behavior on color { ColorAnimation { duration: Theme.durationFast } }

                                    MouseArea {
                                        id: barMouse
                                        anchors.fill: parent
                                        anchors.margins: -4   // hover area un peu plus large
                                        hoverEnabled: true
                                        cursorShape: Qt.PointingHandCursor
                                        onClicked: calendarVM.setIsoWeek(modelData.isoWeek)
                                    }
                                }
                            }
                        }
                    }

                    // Labels W-XX en bas
                    RowLayout {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.bottom: parent.bottom
                        height: 12
                        spacing: 4

                        Repeater {
                            model: page.costHistory
                            delegate: Text {
                                Layout.fillWidth: true
                                horizontalAlignment: Text.AlignHCenter
                                text: modelData.isoWeek.substring(6)  // "W18"
                                color: modelData.isoWeek === calendarVM.isoWeek
                                       ? Theme.colorPrimary
                                       : Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: 9
                                font.weight: modelData.isoWeek === calendarVM.isoWeek
                                             ? Theme.fontWeightSemiBold
                                             : Theme.fontWeightRegular
                            }
                        }
                    }
                }
            }
        }
        }   // fin ColumnLayout pageContent
    }   // fin ScrollView

    // ---- Panneau latéral "Ingrédients rapides" pour drag-drop (U2) ----
    Rectangle {
        id: sidePanel
        Layout.preferredWidth: page.sidePanelOpen ? 240 : 0
        Layout.fillHeight: true
        visible: Layout.preferredWidth > 0
        clip: true
        radius: Theme.radiusMd
        color: Theme.colorSurface
        border.width: 1
        border.color: Theme.colorBorder
        Behavior on Layout.preferredWidth {
            NumberAnimation { duration: Theme.durationNormal; easing.type: Easing.OutCubic }
        }

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: Theme.spaceMd
            spacing: Theme.spaceSm

            Text {
                text: "Drag → Calendrier"
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
                font.weight: Theme.fontWeightSemiBold
            }
            Text {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: "Glisse une chip vers une cellule pour ajouter "
                      + "100 g (ou 1 pièce si poids unitaire défini)."
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeXs
            }

            AppTextField {
                id: sidePanelSearch
                Layout.fillWidth: true
                placeholderText: "Filtrer…"
                onTextChanged: page._refreshSidePanel()
            }

            // Liste de chips dans un Flow scrollable
            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true

                Flow {
                    width: sidePanel.width - Theme.spaceMd * 2
                    spacing: Theme.spaceXs

                    Repeater {
                        model: page.sidePanelIngredients
                        delegate: DraggableIngredientChip {
                            ingredientId: modelData.id
                            ingredientName: modelData.name
                            sourceTag: modelData.source
                            pieceWeightG: modelData.pieceWeightG !== null
                                          ? modelData.pieceWeightG : 0
                        }
                    }
                }
            }
        }
    }

    }   // fin RowLayout root

    // ============================================================ Helpers F9

    function _maxCost() {
        let max = 0
        for (let i = 0; i < page.costHistory.length; i++) {
            const v = parseFloat(page.costHistory[i].totalEur)
            if (v > max) max = v
        }
        return max
    }

    function _barHeight(totalEurStr) {
        const max = page._maxCost()
        if (max <= 0) return 2
        const v = parseFloat(totalEurStr)
        // Hauteur cible : 60 px max. Min 2 px pour rester visible.
        return Math.max(2, Math.round((v / max) * 60))
    }

    function _costHistoryStats() {
        if (page.costHistory.length < 2) return ""
        let sum = 0
        for (let i = 0; i < page.costHistory.length; i++) {
            sum += parseFloat(page.costHistory[i].totalEur)
        }
        const avg = sum / page.costHistory.length
        return "Moyenne : " + avg.toLocaleString(Qt.locale(), 'f', 2) + " €"
    }

    // ============================================================ Side panel (U2)

    function _toggleSidePanel() {
        page.sidePanelOpen = !page.sidePanelOpen
        if (page.sidePanelOpen && page.sidePanelIngredients.length === 0) {
            page._refreshSidePanel()
        }
    }
    function _refreshSidePanel() {
        if (!ingredientVM) return
        const q = sidePanelSearch ? sidePanelSearch.text.trim() : ""
        if (q.length === 0) {
            // No filter: list the whole personal library (capped to 100)
            page.sidePanelIngredients = ingredientVM.searchOnce("", "personal", 100)
            // searchOnce returns [] for empty query; fallback : list via items model
            if (page.sidePanelIngredients.length === 0) {
                const out = []
                const m = ingredientVM.items
                const idRole = m.Roles.ingredientId
                const nameRole = m.Roles.name
                const srcRole = m.Roles.source
                const pieceRole = m.Roles.pieceWeightG
                for (let i = 0; i < m.rowCount(); i++) {
                    const idx = m.index(i, 0)
                    out.push({
                        "id":           m.data(idx, idRole),
                        "name":         m.data(idx, nameRole),
                        "source":       m.data(idx, srcRole),
                        "pieceWeightG": m.data(idx, pieceRole)
                    })
                }
                page.sidePanelIngredients = out
            }
        } else {
            page.sidePanelIngredients = ingredientVM.searchOnce(q, "personal", 100)
        }
    }

    // ============================================================ Raccourcis clavier (U1)

    Shortcut {
        sequence: "Ctrl+Left"
        enabled: page.visible
        context: Qt.WindowShortcut
        onActivated: calendarVM.shiftWeek(-1)
    }
    Shortcut {
        sequence: "Ctrl+Right"
        enabled: page.visible
        context: Qt.WindowShortcut
        onActivated: calendarVM.shiftWeek(1)
    }
    Shortcut {
        sequence: "Ctrl+T"
        enabled: page.visible
        context: Qt.WindowShortcut
        onActivated: calendarVM.setIsoWeek(_currentWeek())
    }

    // ============================================================ Dialog d'ajout
    // Vraie fenêtre système (Window) — détachable, déplaçable hors de l'app, non-modale.

    AddCalendarEntryDialog {
        id: addDialog
        onRecipePicked: function(day, slot, recipeId, portions) {
            calendarVM.addRecipe(day, slot, recipeId, portions)
        }
        onIngredientPicked: function(day, slot, ingId, qty) {
            calendarVM.addIngredient(day, slot, ingId, qty)
        }
    }

    function _openAddDialog(dayOfWeek, slot) {
        addDialog.openFor(dayOfWeek, slot, Window.window)
    }

    // ============================================================ Copy previous week (F7)

    AppDialog {
        id: copyConfirmDialog
        title: "Copier la semaine précédente"
        modal: true
        anchors.centerIn: Overlay.overlay
        standardButtons: Dialog.Ok | Dialog.Cancel
        width: 460

        contentItem: ColumnLayout {
            spacing: Theme.spaceMd
            Text {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
                text: "Cette semaine contient déjà des entrées. " +
                      "Les entrées de la semaine précédente vont être <b>ajoutées</b> " +
                      "(pas remplacées). Continuer ?"
                textFormat: Text.RichText
            }
        }
        onAccepted: page._doCopyPreviousWeek()
    }

    Rectangle {
        id: copyToast
        property string message: ""
        property bool isSuccess: true
        visible: false
        z: 10
        color: isSuccess ? Theme.colorSuccess : Theme.colorWarning
        radius: Theme.radiusMd
        opacity: 0.95
        anchors.bottom: parent.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottomMargin: Theme.spaceXl
        width: copyToastText.implicitWidth + Theme.spaceXl * 2
        height: copyToastText.implicitHeight + Theme.spaceMd * 2
        Text {
            id: copyToastText
            anchors.centerIn: parent
            text: copyToast.message
            color: "white"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeMd
            font.weight: Theme.fontWeightMedium
        }
        Timer { running: copyToast.visible; interval: 4000; onTriggered: copyToast.visible = false }
    }

    function _copyPreviousWeek() {
        if (!calendarVM) return
        // Si la semaine courante est déjà non vide, on demande confirmation —
        // append accidentel = doublons.
        if (calendarVM.currentWeekEntryCount() > 0) {
            copyConfirmDialog.open()
        } else {
            page._doCopyPreviousWeek()
        }
    }

    // ============================================================ Templates dialog (C1)

    // Popup d'application : liste les templates sauvés ; clic = applique.
    Popup {
        id: templatesPopup
        modal: false
        focus: true
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutsideParent

        property var _templates: []
        function openAt(anchorItem) {
            _templates = calendarVM ? calendarVM.listTemplates() : []
            const win = anchorItem.Window.window
            if (win) {
                const pt = anchorItem.mapToItem(win.contentItem, 0, anchorItem.height + 4)
                templatesPopup.parent = win.contentItem
                templatesPopup.x = Math.max(8, Math.min(pt.x, win.contentItem.width - templatesPopup.width - 8))
                templatesPopup.y = Math.max(8, pt.y)
            }
            open()
        }

        background: Rectangle {
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorBorder
        }

        contentItem: ColumnLayout {
            spacing: 0

            Text {
                Layout.preferredWidth: 320
                Layout.margins: Theme.spaceSm
                text: templatesPopup._templates.length === 0
                      ? "Aucun template sauvé. Configure une semaine puis clique « 💾 Sauver »."
                      : "Cliquez un template pour l'appliquer à la semaine courante :"
                color: templatesPopup._templates.length === 0
                       ? Theme.colorTextDisabled
                       : Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeXs
                wrapMode: Text.WordWrap
            }
            Repeater {
                model: templatesPopup._templates
                delegate: Rectangle {
                    Layout.preferredWidth: 320
                    Layout.preferredHeight: 40
                    color: rowMouse.containsMouse ? Theme.colorSurfaceHover : Theme.colorTransparent
                    Behavior on color { ColorAnimation { duration: Theme.durationFast } }

                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: Theme.spaceMd
                        anchors.rightMargin: Theme.spaceMd
                        spacing: Theme.spaceSm
                        Text {
                            Layout.fillWidth: true
                            text: modelData.name
                            color: Theme.colorText
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeMd
                        }
                        Text {
                            text: modelData.entryCount + " entrée" + (modelData.entryCount > 1 ? "s" : "")
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXs
                        }
                        Text {
                            text: "✕"
                            color: deleteMouse.containsMouse ? Theme.colorError : Qt.alpha(Theme.colorTextSecondary, 0.5)
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeMd
                            Layout.preferredWidth: 22
                            horizontalAlignment: Text.AlignHCenter
                            Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                            MouseArea {
                                id: deleteMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    calendarVM.deleteTemplate(modelData.id)
                                    templatesPopup._templates = calendarVM.listTemplates()
                                }
                            }
                        }
                    }

                    MouseArea {
                        id: rowMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            const id = modelData.id
                            templatesPopup.close()
                            // Confirmer si la semaine courante a déjà des entrées
                            if (calendarVM.currentWeekEntryCount() > 0) {
                                applyTemplateConfirm.payload = { templateId: id }
                                applyTemplateConfirm.open()
                            } else {
                                page._applyTemplate(id)
                            }
                        }
                    }
                }
            }
        }
    }

    AppConfirmDialog {
        id: applyTemplateConfirm
        mode: "save"
        title: "Appliquer un template"
        message: "Cette semaine contient déjà des entrées. Les entrées du template "
               + "vont être ajoutées (pas remplacées). Continuer ?"
        saveLabel: "Appliquer"
        discardLabel: "Annuler l'application"
        cancelLabel: "Annuler"
        onSaveRequested: page._applyTemplate(payload.templateId)
        onDiscarded: { /* discarded acts like cancel here — same effect */ }
    }

    // Dialog "Sauver template" — saisie du nom
    AppDialog {
        id: saveTemplateDialog
        title: "Sauver la semaine comme template"
        modal: true
        anchors.centerIn: Overlay.overlay
        standardButtons: Dialog.Ok | Dialog.Cancel
        width: 460

        function openCentered() {
            templateNameField.text = ""
            open()
            templateNameField.forceActiveFocus()
        }

        contentItem: ColumnLayout {
            spacing: Theme.spaceMd
            Text {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
                text: "Donne un nom à ce template (ex : « Menu hiver », « Menu vacances »). "
                    + "Si un template du même nom existe, il sera remplacé."
            }
            AppTextField {
                id: templateNameField
                Layout.fillWidth: true
                placeholderText: "Nom du template"
                onAccepted: { saveTemplateDialog.accept() }
            }
        }
        onAccepted: {
            const name = templateNameField.text.trim()
            if (!name) return
            const tpl = calendarVM.saveAsTemplate(name)
            if (tpl && tpl.name) {
                copyToast.message = "✓ Template « " + tpl.name + " » sauvé ("
                                  + tpl.entryCount + " entrée"
                                  + (tpl.entryCount > 1 ? "s" : "") + ")"
                copyToast.isSuccess = true
                copyToast.visible = true
            }
        }
    }

    function _applyTemplate(templateId) {
        const count = calendarVM.applyTemplate(templateId)
        copyToast.message = count > 0
                          ? "✓ " + count + " entrée" + (count > 1 ? "s" : "") + " appliquée"
                            + (count > 1 ? "s" : "") + " depuis le template"
                          : "Template vide — rien à appliquer"
        copyToast.isSuccess = count > 0
        copyToast.visible = true
    }

    function _doCopyPreviousWeek() {
        const count = calendarVM.copyPreviousWeek()
        if (count > 0) {
            copyToast.isSuccess = true
            copyToast.message = "✓ " + count + " entrée(s) copiée(s) depuis la semaine précédente."
        } else {
            copyToast.isSuccess = false
            copyToast.message = "La semaine précédente est vide — rien à copier."
        }
        copyToast.visible = true
    }

    function _currentWeek() {
        // ISO week courante en JS — `Date.getWeek()` n'existe pas, on calcule.
        const now = new Date()
        const target = new Date(now.valueOf())
        const dayNr = (now.getDay() + 6) % 7
        target.setDate(target.getDate() - dayNr + 3)
        const firstThursday = target.valueOf()
        target.setMonth(0, 1)
        if (target.getDay() !== 4)
            target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7)
        const week = 1 + Math.ceil((firstThursday - target) / 604800000)
        const year = new Date(firstThursday).getFullYear()
        const ww = week < 10 ? "0" + week : "" + week
        return year + "-W" + ww
    }
}
