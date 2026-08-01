// Onglet 5 — Frigo / Cellier (F1).
//
// 3 sections dérivées de `daysUntilExpiry` :
//   - "À consommer vite"  : ≤ 5 jours (urgencyBucket = "soon")
//   - "À surveiller"      : ≤ 14 jours
//   - "En stock"          : reste, groupé par catégorie L1
//
// Saisie : bouton "+ Ajouter au stock" → AddPantryDialog (Window détachable).
// Suppression / édition : icônes inline ✕ et ✎ sur chaque carte (avec
// AppConfirmDialog pour la suppression).
//
// Lien avec la liste de courses : automatique côté Python — le service
// `aggregate_shopping_list` relit le stock à chaque refresh, et la
// ShoppingPage pré-coche "déjà au frigo" pour les ingrédients couverts.

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
import App
import App.ViewModels
import "../components"
import "../dialogs"

Item {
    id: page

    // Refonte UX (Phase D) : panneau latéral d'ingrédients pour drag-and-drop
    // direct depuis la bibliothèque vers le frigo, façon onglet Calendrier.
    property bool sidePanelOpen: false
    property var sidePanelIngredients: []   // peuplé par ingredientVM.searchOnce

    // ---- Layout racine : contenu principal + panneau latéral à droite ----
    RowLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

    ColumnLayout {
        Layout.fillWidth: true
        Layout.fillHeight: true
        spacing: Theme.spaceMd

        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceMd

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Text {
                    text: "Frigo / Cellier"
                    color: Theme.colorText
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXl
                    font.weight: Theme.fontWeightSemiBold
                }
                Text {
                    text: pantryVM
                          ? (pantryVM.totalCount === 0
                             ? "Aucun stock enregistré — clique sur Ajouter pour démarrer."
                             : pantryVM.totalCount + " article" + (pantryVM.totalCount > 1 ? "s" : "")
                               + (pantryVM.soonExpiringCount > 0
                                  ? "  ·  ⚠️ " + pantryVM.soonExpiringCount + " à consommer rapidement"
                                  : ""))
                          : ""
                    color: pantryVM && pantryVM.soonExpiringCount > 0
                           ? Theme.colorError
                           : Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                }
            }

            Item { Layout.fillWidth: true }

            // Plan v3+ — boutons d'import de tickets, déplacés depuis l'onglet
            // Liste de courses car c'est ici (au retour des courses) qu'on
            // remplit le frigo. Les dialogs vivent en global dans Main.qml.
            AppButton {
                text: "📥 Importer un ticket (PDF)"
                variant: "secondary"
                onClicked: {
                    const win = Window.window
                    if (win && win.receiptImportDialog) {
                        win.receiptImportDialog.openCentered(win)
                    }
                }
            }
            AppButton {
                text: {
                    if (typeof lidlPlusVM === "undefined" || !lidlPlusVM) return "🛒 Lidl Plus…"
                    if (!lidlPlusVM.isAvailable) return "🛒 Lidl Plus (lib manquante)"
                    if (!lidlPlusVM.isConnected) return "🛒 Configurer Lidl Plus…"
                    if (lidlPlusVM.isSyncing) return "🛒 Sync Lidl… ⏳"
                    return "🛒 Synchroniser Lidl"
                }
                variant: "secondary"
                onClicked: {
                    const win = Window.window
                    if (typeof lidlPlusVM === "undefined" || !lidlPlusVM) return
                    if (!lidlPlusVM.isAvailable || !lidlPlusVM.isConnected) {
                        if (win && win.lidlPlusSetupDialog) {
                            win.lidlPlusSetupDialog.openCentered(win)
                        }
                    } else {
                        lidlPlusVM.syncNow()
                    }
                }
            }

            AppButton {
                text: "+ Ajouter au stock"
                variant: "primary"
                onClicked: addDialog.openCentered(Window.window)
            }
            // Phase D — toggle du panneau latéral DnD
            AppButton {
                text: page.sidePanelOpen ? "🗂️ ‹" : "🗂️ Bibliothèque"
                variant: "ghost"
                ToolTip.visible: hovered && !page.sidePanelOpen
                ToolTip.text: "Glisse un ingrédient depuis ce panneau vers le frigo"
                ToolTip.delay: 600
                onClicked: page._toggleSidePanel()
            }
        }

        // ---- Phase 4 : barre de contrôles tri / filtre / groupement ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceMd

            // Filtre texte
            AppTextField {
                Layout.preferredWidth: 240
                placeholderText: "🔍 Filtrer par nom…"
                text: pantryVM ? pantryVM.filterText : ""
                onTextChanged: if (pantryVM) pantryVM.setFilter(text)
            }

            // Groupement
            Text {
                text: "Grouper :"
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
            }
            AppComboBox {
                Layout.preferredWidth: 140
                model: ["Urgence", "Rayon", "Aucun"]
                currentIndex: {
                    if (!pantryVM) return 0
                    if (pantryVM.groupBy === "urgency") return 0
                    if (pantryVM.groupBy === "category") return 1
                    return 2
                }
                onActivated: function(index) {
                    if (!pantryVM) return
                    const fields = ["urgency", "category", "none"]
                    pantryVM.setGroupBy(fields[index])
                }
            }

            // Tri
            Text {
                text: "Trier :"
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
            }
            AppComboBox {
                Layout.preferredWidth: 160
                model: ["Urgence (DLC)", "Nom (A-Z)", "Quantité ↓", "Date péremption", "Rayon"]
                currentIndex: {
                    if (!pantryVM) return 0
                    const idx = ["urgency", "name", "quantity", "expiry", "category"].indexOf(pantryVM.sortBy)
                    return idx >= 0 ? idx : 0
                }
                onActivated: function(index) {
                    if (!pantryVM) return
                    const fields = ["urgency", "name", "quantity", "expiry", "category"]
                    pantryVM.setSortBy(fields[index])
                }
            }

            Item { Layout.fillWidth: true }
        }

        // ---- Liste avec sections ----
        Rectangle {
            id: pantryListContainer
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: dropArea.containsDrag ? 2 : 1
            border.color: dropArea.containsDrag ? Theme.colorPrimary : Theme.colorBorder

            // Refonte UX — DropArea pour accueillir un ingrédient glissé depuis
            // le panneau latéral OU depuis l'onglet Ingrédients (TabBar magnétique).
            // Au drop : ouvre `quickAddPopup` avec qty + DLC pré-remplis.
            // L'utilisateur peut appuyer Entrée pour bypass le popup et valider
            // direct avec les valeurs par défaut.
            DropArea {
                id: dropArea
                anchors.fill: parent
                onDropped: function(drop) {
                    const src = drop.source
                    if (!src || src.ingredientId === undefined || src.ingredientId <= 0) {
                        return
                    }
                    const pw = src.pieceWeightG || 0
                    const defaultQty = pw > 0 ? pw : 100.0
                    quickAddPopup.openFor(
                        src.ingredientId,
                        src.ingredientName || "Ingrédient",
                        defaultQty,
                        pw,
                    )
                    drop.accept(Qt.CopyAction)
                }
            }

            // Overlay visuel pendant le drag-hover
            Rectangle {
                anchors.fill: parent
                anchors.margins: 1
                radius: Theme.radiusMd
                color: Qt.alpha(Theme.colorPrimary, 0.10)
                visible: dropArea.containsDrag
                z: 10
                Text {
                    anchors.centerIn: parent
                    text: "⬇  Lâche ici pour ajouter au frigo"
                    color: Theme.colorPrimary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeLg
                    font.weight: Theme.fontWeightSemiBold
                }
            }

            ListView {
                id: list
                anchors.fill: parent
                anchors.margins: 1
                clip: true
                model: pantryVM ? pantryVM.items : null
                spacing: 0
                ScrollBar.vertical: AppScrollBar {}

                // Phase 4 : groupement dynamique selon `pantryVM.groupBy`.
                // - "urgency"  → section sur urgencyBucket (legacy)
                // - "category" → section sur categoryL1
                // - "none"     → pas de section (chaîne vide)
                section.property: {
                    if (!pantryVM) return ""
                    if (pantryVM.groupBy === "urgency") return "urgencyBucket"
                    if (pantryVM.groupBy === "category") return "categoryL1"
                    return ""
                }
                section.criteria: ViewSection.FullString
                section.delegate: Rectangle {
                    width: ListView.view.width
                    height: section ? 36 : 0
                    visible: section ? true : false
                    color: Theme.colorBackground
                    Text {
                        anchors.left: parent.left
                        anchors.leftMargin: Theme.spaceLg
                        anchors.verticalCenter: parent.verticalCenter
                        text: {
                            // Si groupé par urgence : libellés explicites
                            if (pantryVM && pantryVM.groupBy === "urgency") {
                                if (section === "soon")  return "🔥 À consommer vite (≤ 5 jours)"
                                if (section === "watch") return "⏳ À surveiller (≤ 14 jours)"
                                return "🥫 En stock"
                            }
                            // Sinon : juste le nom de la catégorie / valeur du champ
                            return section || ""
                        }
                        color: {
                            if (pantryVM && pantryVM.groupBy === "urgency") {
                                if (section === "soon")  return Theme.colorError
                                if (section === "watch") return Theme.colorWarning
                            }
                            return Theme.colorText
                        }
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeMd
                        font.weight: Theme.fontWeightSemiBold
                    }
                }

                delegate: Rectangle {
                    width: list.width
                    height: 56
                    color: rowMouse.containsMouse ? Theme.colorSurfaceHover : Theme.colorTransparent

                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: Theme.spaceLg
                        anchors.rightMargin: Theme.spaceMd
                        spacing: Theme.spaceMd

                        // Pastille d'urgence (couleur selon jours restants)
                        Rectangle {
                            Layout.preferredWidth: 8
                            Layout.preferredHeight: 8
                            radius: 4
                            color: model.urgencyBucket === "soon"
                                   ? Theme.colorError
                                   : model.urgencyBucket === "watch"
                                     ? Theme.colorWarning
                                     : Theme.colorSuccess
                        }

                        // Nom + sous-ligne (qté + expiry + notes)
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
                            RowLayout {
                                Layout.fillWidth: true
                                spacing: Theme.spaceMd
                                Text {
                                    text: page._formatQty(model.quantityG, model.pieceWeightG)
                                    color: Theme.colorTextSecondary
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeXs
                                }
                                Text {
                                    text: page._formatExpiry(model.daysUntilExpiry, model.expiryIso)
                                    color: model.urgencyBucket === "soon"
                                           ? Theme.colorError
                                           : model.urgencyBucket === "watch"
                                             ? Theme.colorWarning
                                             : Theme.colorTextSecondary
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeXs
                                    font.weight: model.urgencyBucket !== "stock"
                                                 ? Theme.fontWeightMedium
                                                 : Theme.fontWeightRegular
                                }
                                Text {
                                    visible: model.notes !== ""
                                    text: "📝 " + model.notes
                                    color: Theme.colorTextSecondary
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeXs
                                    elide: Text.ElideRight
                                    Layout.maximumWidth: 240
                                }
                                Item { Layout.fillWidth: true }
                            }
                        }

                        // Action ✕ : suppression avec confirmation
                        Text {
                            text: "✕"
                            color: deleteMouse.containsMouse ? Theme.colorError : Qt.alpha(Theme.colorTextSecondary, 0.55)
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeMd
                            Layout.preferredWidth: 32
                            horizontalAlignment: Text.AlignHCenter
                            verticalAlignment: Text.AlignVCenter
                            Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                            MouseArea {
                                id: deleteMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                ToolTip.visible: containsMouse
                                ToolTip.text: "Retirer du stock"
                                ToolTip.delay: 400
                                onClicked: {
                                    deleteConfirm.payload = { stockId: model.stockId, name: model.name }
                                    deleteConfirm.message = "Retirer « " + model.name + " » du stock ?"
                                    deleteConfirm.open()
                                }
                            }
                        }
                    }

                    MouseArea {
                        id: rowMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        propagateComposedEvents: true
                        onClicked: function(m) { m.accepted = false }
                    }

                    // Séparateur fin entre les rangs
                    Rectangle {
                        anchors.bottom: parent.bottom
                        anchors.left: parent.left
                        anchors.right: parent.right
                        height: 1
                        color: Theme.colorBorder
                        opacity: 0.3
                    }
                }

                // Empty state
                Text {
                    visible: list.count === 0
                    anchors.centerIn: parent
                    text: "🥫\nVotre frigo est vide.\nClique « + Ajouter au stock » pour commencer."
                    horizontalAlignment: Text.AlignHCenter
                    color: Theme.colorTextDisabled
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeMd
                }
            }
        }
    }   // fin ColumnLayout principal (Phase D)

    // ---- Phase D : Panneau latéral "Bibliothèque" pour drag-drop ----
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
                text: "Drag → Frigo"
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
                font.weight: Theme.fontWeightSemiBold
            }
            Text {
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
                text: "Glisse une chip vers la liste pour ouvrir un mini-popup "
                    + "(qty + DLC). Astuce : appuie sur Entrée pour valider "
                    + "directement avec les valeurs par défaut."
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

    }   // fin RowLayout racine (Phase D)

    // ============================================================ Helpers Phase D — side panel
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
            page.sidePanelIngredients = ingredientVM.searchOnce("", "personal", 100)
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

    // ============================================================ Helpers de formatage

    function _formatQty(g, pieceWeight) {
        if (!g || g <= 0) return ""
        let base
        if (g >= 1000) {
            const kg = g / 1000
            base = Number(kg).toLocaleString(Qt.locale(), 'f', kg < 10 ? 2 : 1) + " kg"
        } else if (g >= 10) {
            base = Number(g).toLocaleString(Qt.locale(), 'f', 0) + " g"
        } else {
            base = Number(g).toLocaleString(Qt.locale(), 'f', 1) + " g"
        }
        if (pieceWeight && pieceWeight > 0) {
            const pieces = g / pieceWeight
            const pStr = Number(pieces).toLocaleString(Qt.locale(), 'f', pieces < 10 ? 1 : 0)
            return base + " · ≈ " + pStr + " pièce" + (pieces > 1 ? "s" : "")
        }
        return base
    }

    function _formatExpiry(days, iso) {
        if (days === null || days === undefined || iso === "") return "Pas de date"
        if (days < 0) return "🛑 Périmé depuis " + Math.abs(days) + "j"
        if (days === 0) return "⚠️ Périme aujourd'hui"
        if (days === 1) return "⚠️ Périme demain"
        if (days <= 5) return "⚠️ Dans " + days + " jours"
        return "Dans " + days + " jours"
    }

    // ============================================================ Dialogs

    // Toast pour le retour visuel des ajouts au frigo (drop, etc.)
    Rectangle {
        id: toast
        property string message: ""
        visible: false
        z: 100
        color: Theme.colorSuccess
        radius: Theme.radiusMd
        opacity: 0.95
        anchors.bottom: parent.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottomMargin: Theme.spaceXxl
        width: toastText.implicitWidth + Theme.spaceXl * 2
        height: toastText.implicitHeight + Theme.spaceMd * 2
        Text {
            id: toastText
            anchors.centerIn: parent
            text: toast.message
            color: "white"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeMd
            font.weight: Theme.fontWeightMedium
        }
        Timer { running: toast.visible; interval: 2500; onTriggered: toast.visible = false }
    }

    // ============================================================ Phase D — Quick-add popup
    //
    // Mini-popup contextuel ouvert au drop d'un ingrédient sur la liste du
    // frigo. Champs : quantité (avec unité via QuantityField, pré-remplie au
    // poids unitaire ou 100g) + DLC optionnelle. Touche Entrée → bypass le
    // popup et valide avec ces valeurs par défaut. Touche Échap → annule.
    Popup {
        id: quickAddPopup
        modal: true
        focus: true
        width: 380
        padding: Theme.spaceMd
        // Centré sur la fenêtre parente
        x: (page.width - width) / 2
        y: (page.height - height) / 2
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutsideParent
        background: Rectangle {
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorPrimary
        }

        property int ingredientId: -1
        property string ingredientName: ""
        property real defaultQtyG: 100
        property real pieceWeightG: 0

        function openFor(id, name, qtyG, pw) {
            ingredientId = id
            ingredientName = name
            defaultQtyG = qtyG
            pieceWeightG = pw
            qtyField.grams = qtyG
            expiryField.text = ""
            expiryField.iso = ""
            open()
            // Focus sur le bouton OK pour que Entrée valide direct
            okButton.forceActiveFocus()
        }

        function commit() {
            const result = pantryVM.addStock({
                "ingredientId": quickAddPopup.ingredientId,
                "quantityG":    qtyField.grams,
                "expiryIso":    expiryField.iso,
                "notes":        "",
            })
            if (result && result.id) {
                toast.message = "✓ " + quickAddPopup.ingredientName
                              + " ajouté au frigo (" + Math.round(qtyField.grams) + " g)"
                toast.visible = true
            }
            quickAddPopup.close()
        }

        // Bypass Entrée : valide avec les valeurs par défaut
        Keys.onReturnPressed: quickAddPopup.commit()
        Keys.onEnterPressed: quickAddPopup.commit()

        ColumnLayout {
            anchors.fill: parent
            spacing: Theme.spaceMd

            Text {
                Layout.fillWidth: true
                text: "Ajouter au frigo : " + quickAddPopup.ingredientName
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
                font.weight: Theme.fontWeightSemiBold
                wrapMode: Text.WordWrap
            }
            Text {
                Layout.fillWidth: true
                text: "Astuce : appuie sur Entrée pour valider sans toucher aux champs."
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeXs
                font.italic: true
            }

            // Quantité (QuantityField avec unité)
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Text { text: "Quantité"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs }
                QuantityField {
                    id: qtyField
                    Layout.fillWidth: true
                    grams: quickAddPopup.defaultQtyG
                    pieceWeightG: quickAddPopup.pieceWeightG
                    decimals: 1
                }
            }

            // DLC (optionnelle)
            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Text {
                    text: "Date de péremption (optionnelle)"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXs
                }
                RowLayout {
                    Layout.fillWidth: true
                    spacing: 4
                    AppTextField {
                        id: expiryField
                        Layout.fillWidth: true
                        property string iso: ""
                        placeholderText: "JJ/MM/AAAA"
                        onEditingFinished: {
                            const t = text.trim()
                            if (!t) { iso = ""; return }
                            const m = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/.exec(t)
                            if (m) {
                                iso = m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0")
                            }
                        }
                    }
                    AppButton {
                        text: "📅"
                        variant: "ghost"
                        Layout.preferredWidth: 32
                        Layout.preferredHeight: 32
                        onClicked: quickAddDatePicker.openAt(this, expiryField.iso)
                    }
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceSm
                Item { Layout.fillWidth: true }
                AppButton {
                    text: "Annuler"
                    variant: "ghost"
                    onClicked: quickAddPopup.close()
                }
                AppButton {
                    id: okButton
                    text: "✓ Ajouter"
                    variant: "primary"
                    onClicked: quickAddPopup.commit()
                }
            }
        }

        DatePickerPopup {
            id: quickAddDatePicker
            onDateSelected: function(iso) {
                expiryField.iso = iso
                // Format JJ/MM/AAAA pour affichage
                const parts = iso.split("-")
                if (parts.length === 3) {
                    expiryField.text = parts[2] + "/" + parts[1] + "/" + parts[0]
                }
            }
        }
    }

    AddPantryStockDialog {
        id: addDialog
        onSubmitted: function(payload) {
            const saved = pantryVM.addStock(payload)
            if (saved && saved.id) {
                // Notify the shopping page to refresh (the auto-coche depends on stock).
                if (typeof shoppingVM !== "undefined" && shoppingVM) {
                    shoppingVM.refreshList()
                }
            }
        }
    }

    AppConfirmDialog {
        id: deleteConfirm
        mode: "destroy"
        title: "Retirer du stock"
        confirmLabel: "Retirer"
        cancelLabel: "Annuler"
        onConfirmed: {
            const stockId = payload && payload.stockId
            if (stockId && pantryVM.deleteStock(stockId)) {
                if (typeof shoppingVM !== "undefined" && shoppingVM) {
                    shoppingVM.refreshList()
                }
            }
        }
    }
}
