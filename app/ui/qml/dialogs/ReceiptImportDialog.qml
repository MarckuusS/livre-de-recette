// Dialog d'import de ticket de caisse (Plan v3, Phase 1).
//
// Vraie fenêtre système (Window) — détachable, non-modale. Workflow :
//
//   1. File picker → l'utilisateur sélectionne un PDF/HTML
//   2. Backend parse + match → expose une liste de MatchedLine
//   3. Tableau éditable : pour chaque ligne, choisir l'ingrédient (combobox
//      des suggestions + "Créer"), toggler "ajouter au frigo"
//   4. Bouton "Tout enregistrer" → commit transactionnel
//
// Le filtre "Masquer non-alimentaires" cache par défaut les lignes TVA B
// (ex : DOM LOUCHE INOX, ELEPHANT KIT DE LAVA).

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Dialogs
import App
import "../components"

Window {
    id: root

    title: "Importer un ticket de caisse"
    width: 1300
    height: 760
    minimumWidth: 1100
    minimumHeight: 560
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
                     | Qt.WindowMinMaxButtonsHint
    modality: Qt.NonModal

    // ---- État local ----
    property var linesSnapshot: []         // tableau de dicts depuis VM.linesAsList()
    property bool hideNonFood: true        // filtre par défaut : masquer TVA B

    // Largeurs de colonnes — partagées entre header et delegate pour
    // garantir un alignement pixel-perfect. Si tu modifies une largeur ici,
    // les deux côtés bougent en même temps. La colonne "Ingrédient" est
    // implicite (elle prend tout le reste = fillWidth).
    // Refonte UX : QTÉ accueille un QuantityField (SpinBox + ComboBox unité),
    // PRIX devient éditable, nouvelle colonne DLC.
    readonly property int colArticleW:  220
    readonly property int colQtyW:      250
    readonly property int colPriceW:    100
    readonly property int colExpiryW:   140
    readonly property int colBarcodeW:  150
    readonly property int colFrigoW:     54
    readonly property int colSpacing:     8

    // DatePickerPopup global pour la colonne DLC. Les cellules le partagent
    // (un seul popup à la fois) ; à l'ouverture on connecte temporairement
    // le signal dateSelected à la ligne courante.
    DatePickerPopup {
        id: expiryPicker
        property int targetLineIndex: -1
        onDateSelected: function(iso) {
            if (targetLineIndex >= 0) {
                receiptImportVM.setLineExpiry(targetLineIndex, iso)
            }
        }
    }

    // Sélection de file via FileDialog
    FileDialog {
        id: filePicker
        title: "Choisir un ticket à importer (PDF)"
        nameFilters: ["Tickets PDF (*.pdf)", "Tous (*)"]
        fileMode: FileDialog.OpenFile
        onAccepted: {
            const ok = receiptImportVM.loadFromPath(selectedFile.toString())
            if (ok) {
                root.linesSnapshot = receiptImportVM.linesAsList()
            }
        }
    }

    function openCentered(parentWindow) {
        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        receiptImportVM.reset()
        root.linesSnapshot = []
        show()
        raise()
        // Auto-ouvre le file picker (cas d'usage typique : on clique le bouton
        // "Importer", on choisit un fichier dans la foulée)
        Qt.callLater(function() { filePicker.open() })
    }

    // Phase 2 — variante : le ticket est DÉJÀ chargé dans le VM (via
    // `loadNextPending()` depuis le badge de la status bar). On ouvre
    // simplement la fenêtre sur le contenu courant, sans reset ni file picker.
    function openForPending(parentWindow) {
        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        // Le receipt est déjà chargé : on snap les lignes pour l'affichage.
        if (receiptImportVM.hasReceipt) {
            root.linesSnapshot = receiptImportVM.linesAsList()
        }
        show()
        raise()
    }

    // ============================================================ Connexions VM
    Connections {
        target: receiptImportVM
        function onReceipt_loaded() { root.linesSnapshot = receiptImportVM.linesAsList() }
        function onLine_changed(idx) {
            // Re-snap la ligne mutée (simple : on re-récupère tout)
            root.linesSnapshot = receiptImportVM.linesAsList()
        }
        function onError_emitted(msg) {
            errorToast.message = msg
            errorToast.visible = true
        }
        function onImport_completed(success, msg) {
            if (success) {
                successToast.message = msg
                successToast.visible = true
                // Petit délai puis fermeture
                Qt.callLater(function() { root.close() })
            } else {
                errorToast.message = msg
                errorToast.visible = true
            }
        }
    }

    // ============================================================ Layout
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        // ---- Header avec infos ticket ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceMd

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Text {
                    text: receiptImportVM.hasReceipt
                          ? "Ticket " + receiptImportVM.store + " · "
                            + receiptImportVM.receiptDateHuman
                          : "Importer un ticket de caisse"
                    color: Theme.colorText
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXl
                    font.weight: Theme.fontWeightSemiBold
                }
                Text {
                    visible: receiptImportVM.hasReceipt
                    text: receiptImportVM.lineCount + " ligne"
                          + (receiptImportVM.lineCount > 1 ? "s" : "")
                          + (receiptImportVM.totalEur ? "  ·  Total : " + receiptImportVM.totalEur + " €" : "")
                          + (receiptImportVM.ticketId ? "  ·  ID " + receiptImportVM.ticketId.slice(0, 12) + "…" : "")
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                }
            }
            Item { Layout.fillWidth: true }

            AppButton {
                visible: !receiptImportVM.hasReceipt
                text: "📥 Choisir un fichier…"
                variant: "primary"
                onClicked: filePicker.open()
            }
            AppButton {
                visible: receiptImportVM.hasReceipt
                text: "Changer de ticket"
                variant: "ghost"
                onClicked: filePicker.open()
            }
        }

        // ---- Bandeau anti-doublon ----
        Rectangle {
            Layout.fillWidth: true
            visible: receiptImportVM.isDuplicate
            color: Qt.alpha(Theme.colorWarning, 0.15)
            radius: Theme.radiusSm
            border.width: 1
            border.color: Theme.colorWarning
            // Hauteur basée sur le contenu + padding vertical confortable.
            // Avec `verticalCenter` sur les enfants, le bandeau est aligné.
            Layout.preferredHeight: Math.max(36, dupRow.implicitHeight + Theme.spaceLg)

            RowLayout {
                id: dupRow
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: Theme.spaceMd
                anchors.rightMargin: Theme.spaceMd
                spacing: Theme.spaceMd

                Text {
                    Layout.fillWidth: true
                    Layout.alignment: Qt.AlignVCenter
                    text: "⚠️ Ce ticket a déjà été importé. Active 'Forcer' pour ré-importer "
                        + "(crée des doublons d'historique de prix)."
                    color: Theme.colorText
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                    wrapMode: Text.WordWrap
                    verticalAlignment: Text.AlignVCenter
                }
                AppCheckBox {
                    Layout.alignment: Qt.AlignVCenter
                    text: "Forcer"
                    checked: receiptImportVM.forceImport
                    onClicked: receiptImportVM.setForceImport(checked)
                }
            }
        }

        // ---- Toolbar : filtre + actions globales ----
        RowLayout {
            Layout.fillWidth: true
            visible: receiptImportVM.hasReceipt
            spacing: Theme.spaceMd

            AppCheckBox {
                text: "Masquer les non-alimentaires (TVA B)"
                checked: root.hideNonFood
                onClicked: root.hideNonFood = checked
            }
            Item { Layout.fillWidth: true }
            Text {
                text: {
                    if (!root.linesSnapshot) return ""
                    let matched = 0, total = 0
                    for (let i = 0; i < root.linesSnapshot.length; i++) {
                        const l = root.linesSnapshot[i]
                        if (root.hideNonFood && !l.isLikelyFood) continue
                        total++
                        if (l.chosenId > 0) matched++
                    }
                    return matched + " / " + total + " ligne"
                         + (total > 1 ? "s" : "") + " mappée"
                         + (matched > 1 ? "s" : "")
                }
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
            }
        }

        // ---- Tableau des lignes ----
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            visible: receiptImportVM.hasReceipt
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorBorder
            clip: true

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Theme.spaceXs
                spacing: 0

                // Header — utilise un Item parent + Row enfant avec width
                // explicite pour aligner pixel-perfect avec le delegate.
                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 32
                    color: Theme.colorBackground
                    radius: Theme.radiusSm

                    component HeaderCell: Text {
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                        font.weight: Theme.fontWeightMedium
                        font.letterSpacing: 0.4
                        verticalAlignment: Text.AlignVCenter
                        elide: Text.ElideRight
                        height: parent.height
                    }

                    Row {
                        anchors.fill: parent
                        anchors.leftMargin: Theme.spaceMd
                        anchors.rightMargin: Theme.spaceMd
                        spacing: root.colSpacing

                        // Convention d'alignement (cohérent header ↔ delegate) :
                        //   - texte libre (article, EAN, ingrédient) : gauche
                        //   - widgets centrés (qté, DLC, frigo)      : centré
                        //   - valeurs chiffrées (prix)                : droite
                        HeaderCell { text: "ARTICLE (TICKET)";       width: root.colArticleW;  horizontalAlignment: Text.AlignLeft }
                        HeaderCell { text: "QTÉ + UNITÉ";            width: root.colQtyW;      horizontalAlignment: Text.AlignHCenter }
                        HeaderCell { text: "PRIX (€)";               width: root.colPriceW;    horizontalAlignment: Text.AlignRight }
                        HeaderCell { text: "DLC (optionnelle)";      width: root.colExpiryW;   horizontalAlignment: Text.AlignHCenter }
                        HeaderCell { text: "CODE-BARRES (EAN)";      width: root.colBarcodeW;  horizontalAlignment: Text.AlignLeft }
                        HeaderCell {
                            text: "INGRÉDIENT (CLIQUE POUR CHOISIR / CRÉER)"
                            horizontalAlignment: Text.AlignLeft
                            width: parent.width - root.colArticleW - root.colQtyW - root.colPriceW
                                   - root.colExpiryW - root.colBarcodeW - root.colFrigoW
                                   - root.colSpacing * 6
                        }
                        HeaderCell { text: "ACTION";                 width: root.colFrigoW;    horizontalAlignment: Text.AlignHCenter }
                    }
                }

                // Lignes
                ListView {
                    id: list
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    model: root.linesSnapshot
                    spacing: 1
                    boundsBehavior: Flickable.StopAtBounds
                    ScrollBar.vertical: AppScrollBar { orientation: Qt.Vertical }

                    delegate: Rectangle {
                        id: rowItem
                        width: list.width
                        height: visible ? 76 : 0
                        visible: !root.hideNonFood || modelData.isLikelyFood
                        color: (index % 2 === 0) ? Theme.colorTransparent : Qt.alpha(Theme.colorSurface, 0.5)

                        // Calcul partagé de la largeur de la cellule Ingrédient
                        // (= reste après les colonnes fixes, identique au header).
                        readonly property int ingredientCellW:
                            width - 2 * Theme.spaceMd
                                  - root.colArticleW - root.colQtyW - root.colPriceW
                                  - root.colExpiryW - root.colBarcodeW - root.colFrigoW
                                  - root.colSpacing * 6

                        // Récupère le pieceWeightG de l'ingrédient choisi pour
                        // que QuantityField propose "pièce (Xg)" si applicable.
                        readonly property real currentPieceWeightG: {
                            if (modelData.chosenId > 0) {
                                const d = ingredientVM.getAsDict(modelData.chosenId)
                                return (d && d.pieceWeightG && d.pieceWeightG > 0) ? d.pieceWeightG : 0
                            }
                            return 0
                        }

                        Row {
                            anchors.fill: parent
                            anchors.leftMargin: Theme.spaceMd
                            anchors.rightMargin: Theme.spaceMd
                            spacing: root.colSpacing

                            // ============== Cellule 1 : Article (ticket) ============
                            Item {
                                width: root.colArticleW
                                height: parent.height
                                ColumnLayout {
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.verticalCenter: parent.verticalCenter
                                    spacing: 1
                                    Text {
                                        Layout.fillWidth: true
                                        text: modelData.rawName
                                        color: Theme.colorText
                                        font.family: Theme.fontFamily
                                        font.pixelSize: Theme.fontSizeSm
                                        font.weight: Theme.fontWeightMedium
                                        elide: Text.ElideRight
                                    }
                                    Text {
                                        Layout.fillWidth: true
                                        text: "TVA " + modelData.vatCode
                                            + (!modelData.isLikelyFood ? "  ·  non-alim." : "")
                                        color: modelData.isLikelyFood ? Theme.colorTextSecondary : Theme.colorWarning
                                        font.family: Theme.fontFamily
                                        font.pixelSize: Theme.fontSizeXs
                                        elide: Text.ElideRight
                                    }
                                }
                            }

                            // ============== Cellule 2 : Qté + unité (QuantityField) =====
                            // Refonte UX : le user peut saisir la quantité réelle (g/kg/
                            // mL/L/pièce). Si > 0, alimente PantryStock.quantity_g et
                            // PriceHistory.quantity_g au commit (priorité dans la cascade).
                            Item {
                                width: root.colQtyW
                                height: parent.height
                                QuantityField {
                                    id: qtyField
                                    anchors.left: parent.left
                                    anchors.right: parent.right
                                    anchors.verticalCenter: parent.verticalCenter
                                    anchors.leftMargin: 2
                                    anchors.rightMargin: 2
                                    grams: modelData.quantityG || 0
                                    pieceWeightG: rowItem.currentPieceWeightG
                                    decimals: 0
                                    onGramsEdited: function(g) {
                                        receiptImportVM.setLineQuantityG(modelData.index, g)
                                    }
                                }
                            }

                            // ============== Cellule 3 : Prix total éditable ============
                            // Refonte UX : le prix peut être ajusté (promo, OCR…).
                            // L'édition pose un flag user_price_override sur la ligne
                            // pour qu'un changement futur de qté ne ré-écrase pas.
                            Item {
                                width: root.colPriceW
                                height: parent.height
                                AppTextField {
                                    id: priceField
                                    anchors.fill: parent
                                    anchors.topMargin: 6
                                    anchors.bottomMargin: 6
                                    anchors.leftMargin: 2
                                    anchors.rightMargin: 2
                                    horizontalAlignment: Text.AlignRight
                                    text: modelData.totalPrice
                                          ? Number(parseFloat(modelData.totalPrice)).toLocaleString(Qt.locale(), 'f', 2)
                                          : ""
                                    placeholderText: "0,00"
                                    inputMethodHints: Qt.ImhFormattedNumbersOnly
                                    onEditingFinished: {
                                        const previous = modelData.totalPrice
                                                         ? Number(parseFloat(modelData.totalPrice)).toLocaleString(Qt.locale(), 'f', 2)
                                                         : ""
                                        if (text !== previous) {
                                            receiptImportVM.setLineTotalPrice(modelData.index, text)
                                        }
                                    }
                                }
                            }

                            // ============== Cellule 4 : DLC optionnelle ===============
                            Item {
                                width: root.colExpiryW
                                height: parent.height
                                RowLayout {
                                    anchors.fill: parent
                                    anchors.topMargin: 6
                                    anchors.bottomMargin: 6
                                    spacing: 2
                                    AppTextField {
                                        id: expiryField
                                        Layout.fillWidth: true
                                        text: modelData.expiryHuman || ""
                                        placeholderText: "JJ/MM/AAAA"
                                        // Saisie manuelle : on parse au commit (validateur permissif)
                                        onEditingFinished: {
                                            const t = text.trim()
                                            if (t === "") {
                                                receiptImportVM.setLineExpiry(modelData.index, "")
                                                return
                                            }
                                            // Tolère JJ/MM/AAAA et JJ-MM-AAAA
                                            const m = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/.exec(t)
                                            if (m) {
                                                const dd = m[1].padStart(2, "0")
                                                const mm = m[2].padStart(2, "0")
                                                const yyyy = m[3]
                                                receiptImportVM.setLineExpiry(modelData.index, yyyy + "-" + mm + "-" + dd)
                                            }
                                        }
                                    }
                                    AppButton {
                                        text: "📅"
                                        variant: "ghost"
                                        Layout.preferredWidth: 32
                                        Layout.preferredHeight: 32
                                        ToolTip.visible: hovered
                                        ToolTip.text: "Ouvrir le calendrier"
                                        onClicked: {
                                            expiryPicker.targetLineIndex = modelData.index
                                            expiryPicker.openAt(this, modelData.expiryIso || "")
                                        }
                                    }
                                }
                            }

                            // ============== Cellule 5 : Code-barres (EAN) =============
                            Item {
                                width: root.colBarcodeW
                                height: parent.height
                                RowLayout {
                                    anchors.fill: parent
                                    anchors.topMargin: 4
                                    anchors.bottomMargin: 4
                                    spacing: 2
                                    AppTextField {
                                        id: eanField
                                        Layout.fillWidth: true
                                        Layout.preferredHeight: 32
                                        text: modelData.userBarcode || ""
                                        placeholderText: "EAN…"
                                        inputMethodHints: Qt.ImhDigitsOnly
                                        onEditingFinished: {
                                            if (text !== modelData.userBarcode) {
                                                receiptImportVM.setLineBarcode(modelData.index, text)
                                            }
                                        }
                                    }
                                    AppButton {
                                        text: "🔍"
                                        variant: "ghost"
                                        Layout.preferredWidth: 36
                                        Layout.preferredHeight: 32
                                        enabled: eanField.text.length >= 8
                                        ToolTip.visible: hovered
                                        ToolTip.text: "Lookup OFF + assigner"
                                        onClicked: {
                                            // S'assure que le VM a la dernière valeur
                                            receiptImportVM.setLineBarcode(modelData.index, eanField.text)
                                            receiptImportVM.lookupBarcodeAndAssign(modelData.index)
                                        }
                                    }
                                }
                            }

                            // ============== Cellule 5 : Ingrédient (cliquable) =====
                            // Toute la cellule est cliquable. Le badge "Match"
                            // est placé à droite en chip discret, dans la même
                            // cellule (plus de colonne séparée — l'utilisateur
                            // verra le score sans qu'il chevauche).
                            Rectangle {
                                id: ingredientCell
                                width: rowItem.ingredientCellW
                                height: 40
                                anchors.verticalCenter: parent.verticalCenter
                                radius: Theme.radiusSm
                                color: pickerArea.containsMouse
                                       ? Theme.colorSurfaceHover
                                       : (modelData.chosenId > 0
                                          ? Qt.alpha(Theme.colorPrimary, 0.12)
                                          : Theme.colorSurface)
                                border.width: 1
                                border.color: modelData.chosenId > 0
                                              ? Theme.colorPrimary
                                              : (pickerArea.containsMouse
                                                 ? Theme.colorBorderHover
                                                 : Theme.colorBorder)
                                Behavior on color { ColorAnimation { duration: Theme.durationFast } }

                                RowLayout {
                                    anchors.fill: parent
                                    anchors.leftMargin: Theme.spaceSm
                                    anchors.rightMargin: Theme.spaceSm
                                    spacing: Theme.spaceXs

                                    Text {
                                        Layout.fillWidth: true
                                        text: {
                                            if (modelData.chosenId > 0) {
                                                const d = ingredientVM.getAsDict(modelData.chosenId)
                                                return d && d.name ? "✓  " + d.name : "(id " + modelData.chosenId + ")"
                                            }
                                            return modelData.matchSource === "none"
                                                   ? "Cliquer pour choisir / créer…"
                                                   : "Cliquer  ·  " + (modelData.suggestionIds.length || 0)
                                                     + " suggestion"
                                                     + (modelData.suggestionIds.length > 1 ? "s" : "")
                                        }
                                        color: modelData.chosenId > 0 ? Theme.colorPrimary : Theme.colorTextSecondary
                                        font.family: Theme.fontFamily
                                        font.pixelSize: Theme.fontSizeSm
                                        font.italic: modelData.chosenId === 0
                                        font.weight: modelData.chosenId > 0 ? Theme.fontWeightMedium : Theme.fontWeightRegular
                                        elide: Text.ElideRight
                                    }

                                    // Match badge (intégré à la cellule)
                                    Rectangle {
                                        Layout.preferredWidth: matchTxt.implicitWidth + 12
                                        Layout.preferredHeight: 18
                                        visible: modelData.chosenId === 0
                                        radius: 9
                                        color: {
                                            if (modelData.matchSource === "alias" || modelData.matchSource === "source_ref") return Qt.alpha(Theme.colorSuccess, 0.18)
                                            if (modelData.matchSource === "fuzzy")
                                                return modelData.matchScore >= 0.9 ? Qt.alpha(Theme.colorSuccess, 0.18) : Qt.alpha(Theme.colorWarning, 0.18)
                                            return Qt.alpha(Theme.colorError, 0.14)
                                        }
                                        Text {
                                            id: matchTxt
                                            anchors.centerIn: parent
                                            text: {
                                                if (modelData.matchSource === "alias") return "appris"
                                                if (modelData.matchSource === "source_ref") return "ID"
                                                if (modelData.matchSource === "fuzzy") return Math.round(modelData.matchScore * 100) + "%"
                                                return "à créer"
                                            }
                                            color: {
                                                if (modelData.matchSource === "alias" || modelData.matchSource === "source_ref") return Theme.colorSuccess
                                                if (modelData.matchSource === "fuzzy")
                                                    return modelData.matchScore >= 0.9 ? Theme.colorSuccess : Theme.colorWarning
                                                return Theme.colorError
                                            }
                                            font.family: Theme.fontFamily
                                            font.pixelSize: Theme.fontSizeXs
                                            font.weight: Theme.fontWeightSemiBold
                                        }
                                    }

                                    Text {
                                        text: modelData.chosenId > 0 ? "✎" : "▾"
                                        color: Theme.colorTextSecondary
                                        font.family: Theme.fontFamily
                                        font.pixelSize: Theme.fontSizeMd
                                    }
                                }

                                MouseArea {
                                    id: pickerArea
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    onClicked: linePicker.openFor(
                                        modelData.index,
                                        modelData.rawName,
                                        modelData.suggestionIds,
                                    )
                                }
                            }

                            // ============== Cellule 6 : Action (supprimer ligne) =====
                            // Refonte UX : tout va automatiquement au frigo, donc le
                            // toggle "Frigo" n'a plus d'utilité. À la place, un bouton
                            // 🗑 permet d'écarter une ligne de l'import (ex: produit
                            // non-alim, erreur OCR, achat non destiné au stock).
                            Item {
                                width: root.colFrigoW
                                height: parent.height
                                AppButton {
                                    anchors.centerIn: parent
                                    text: "🗑"
                                    variant: "danger"
                                    width: 36
                                    height: 32
                                    ToolTip.visible: hovered
                                    ToolTip.text: "Retirer cette ligne de l'import"
                                    ToolTip.delay: 400
                                    onClicked: receiptImportVM.removeLine(modelData.index)
                                }
                            }
                        }

                        Rectangle {
                            anchors.bottom: parent.bottom
                            anchors.left: parent.left
                            anchors.right: parent.right
                            height: 1
                            color: Theme.colorBorder
                            opacity: 0.3
                        }
                    }
                }

                // Empty state
                Text {
                    visible: receiptImportVM.hasReceipt && root.linesSnapshot.length === 0
                    Layout.fillWidth: true
                    Layout.preferredHeight: 80
                    text: "Aucune ligne d'article détectée."
                    color: Theme.colorTextDisabled
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeMd
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }
            }
        }

        // ---- Footer ----
        RowLayout {
            Layout.fillWidth: true
            visible: receiptImportVM.hasReceipt
            spacing: Theme.spaceSm
            Item { Layout.fillWidth: true }
            AppButton {
                text: "Annuler"
                variant: "secondary"
                onClicked: { receiptImportVM.reset(); root.close() }
            }
            AppButton {
                text: "💾 Tout enregistrer"
                variant: "primary"
                onClicked: receiptImportVM.commitImport()
            }
        }
    }

    // ============================================================ Sub-dialog : picker d'ingrédient pour une ligne

    Window {
        id: linePicker
        title: "Choisir l'ingrédient"
        width: 640
        height: createMode ? 640 : 560
        minimumWidth: 540
        minimumHeight: 480
        // `transientParent` est essentiel sous Windows : sans lui le Window
        // peut s'afficher derrière la fenêtre principale et donner l'illusion
        // que rien ne se passe au clic. On le pointe sur le dialog d'import.
        transientParent: root
        modality: Qt.WindowModal
        flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint

        property int lineIndex: -1
        property string rawName: ""
        property var suggestions: []
        // Phase 4 — toggle entre mode "choisir" (par défaut) et mode "créer".
        property bool createMode: false

        function openFor(idx, name, suggestionIds) {
            console.log("linePicker.openFor", idx, name, "suggestions:", JSON.stringify(suggestionIds))
            lineIndex = idx
            rawName = name
            suggestions = suggestionIds || []
            createMode = false
            // `picker` peut ne pas être encore complètement initialisé au tout
            // premier openFor — on garde-fou les appels.
            if (picker && picker.clear) picker.clear()
            x = root.x + Math.max(0, (root.width - width) / 2)
            y = root.y + Math.max(0, (root.height - height) / 2)
            show()
            raise()
            requestActivate()
        }

        // Phase 4 — bascule en mode création et pré-remplit depuis le VM
        // (qui connaît la TVA, le store, et donc la catégorie probable).
        function enterCreateMode() {
            const seed = receiptImportVM.suggestCreatePayload(linePicker.lineIndex)
            createForm.fieldName       = seed.name || linePicker.rawName
            createForm.fieldEan        = seed.sourceRef || ""
            createForm.fieldCategoryL1 = seed.categoryL1 || ""
            createForm.fieldCategoryL2 = seed.categoryL2 || ""
            createForm.fieldPieceWeight = 0
            createForm.fieldPriceQty    = 0
            createForm.lookupHint       = ""
            createMode = true
        }

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: Theme.spaceLg
            spacing: Theme.spaceMd

            Text {
                text: "Pour : « " + linePicker.rawName + " »"
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
                font.weight: Theme.fontWeightMedium
                wrapMode: Text.WordWrap
                Layout.fillWidth: true
            }

            // ============================================================
            // Mode 1 : CHOISIR — suggestions + recherche libre + bouton "Créer"
            // ============================================================
            ColumnLayout {
                visible: !linePicker.createMode
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: Theme.spaceMd

                // Suggestions du matcher (top 3 fuzzy par exemple)
                ColumnLayout {
                    Layout.fillWidth: true
                    visible: linePicker.suggestions.length > 0
                    spacing: 2
                    Text {
                        text: "Suggestions :"
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                    }
                    Repeater {
                        model: linePicker.suggestions
                        delegate: AppButton {
                            Layout.fillWidth: true
                            text: {
                                const d = ingredientVM.getAsDict(modelData)
                                return d && d.name ? "→  " + d.name : "(id " + modelData + ")"
                            }
                            variant: "secondary"
                            onClicked: {
                                receiptImportVM.setLineChosenIngredient(linePicker.lineIndex, modelData)
                                linePicker.close()
                            }
                        }
                    }
                }

                // ---- Toggle de scope : personnel / catalogue complet ----
                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spaceSm
                    Text {
                        text: "Chercher dans :"
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                    }
                    AppButton {
                        text: picker.scope === "personal" ? "✓ Ma bibliothèque" : "Ma bibliothèque"
                        variant: picker.scope === "personal" ? "primary" : "ghost"
                        Layout.preferredHeight: 28
                        onClicked: picker.scope = "personal"
                    }
                    AppButton {
                        text: picker.scope === "all" ? "✓ Tout (CIQUAL + OFF en cache)" : "Tout (CIQUAL + OFF)"
                        variant: picker.scope === "all" ? "primary" : "ghost"
                        Layout.preferredHeight: 28
                        onClicked: picker.scope = "all"
                    }
                    Item { Layout.fillWidth: true }
                }

                IngredientSearch {
                    id: picker
                    Layout.fillWidth: true
                    placeholderText: scope === "personal"
                                     ? "Chercher dans ta bibliothèque…"
                                     : "Chercher dans CIQUAL + OFF (cache local)…"
                    onIngredientPicked: function(id, name) {
                        // Quand l'utilisateur pick depuis "Tout", l'ingrédient
                        // peut ne pas être en bibliothèque perso (CIQUAL/OFF
                        // catalogue brut). On le flippe automatiquement — l'acte
                        // de choisir = signifie qu'on le veut dans la lib.
                        ingredientVM.importExisting(id)
                        receiptImportVM.setLineChosenIngredient(linePicker.lineIndex, id)
                        linePicker.close()
                    }
                }

                // ---- Recherche en ligne OFF (HTTP, sur clic explicite) ----
                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 1
                    color: Theme.colorBorder
                    opacity: 0.3
                }
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spaceXs
                    Text {
                        text: "Pas trouvé ? Cherche en ligne sur OpenFoodFacts :"
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spaceSm
                        AppTextField {
                            id: offQuery
                            Layout.fillWidth: true
                            text: linePicker.rawName
                            placeholderText: "Mot-clé (auto-rempli depuis le ticket)"
                        }
                        AppButton {
                            text: offSearchBusy ? "⏳ Recherche…" : "🌐 Chercher OFF"
                            variant: "secondary"
                            enabled: !offSearchBusy && offQuery.text.trim().length >= 2
                            property bool offSearchBusy: false
                            onClicked: {
                                offSearchBusy = true
                                Qt.callLater(function() {
                                    const results = ingredientVM.fetchOnlineAndList(offQuery.text, 10)
                                    offResultsModel.clear()
                                    // On ne pousse que les champs qu'on affiche
                                    // (id, name) pour éviter les warnings QML
                                    // "kcal is undefined" sur les rôles non utilisés
                                    // mais présents dans le dict source.
                                    for (let i = 0; i < results.length; i++) {
                                        offResultsModel.append({
                                            "id":   results[i].id || 0,
                                            "name": results[i].name || "(sans nom)",
                                        })
                                    }
                                    offSearchBusy = false
                                    if (results.length === 0) {
                                        offHint.text = "Aucun résultat OFF pour « " + offQuery.text + " »"
                                    } else {
                                        offHint.text = results.length + " résultat(s) — clique pour utiliser"
                                    }
                                })
                            }
                        }
                    }
                    Text {
                        id: offHint
                        Layout.fillWidth: true
                        text: ""
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                        wrapMode: Text.WordWrap
                    }
                    ListView {
                        Layout.fillWidth: true
                        Layout.preferredHeight: Math.min(120, offResultsModel.count * 32)
                        visible: offResultsModel.count > 0
                        clip: true
                        ScrollBar.vertical: AppScrollBar {}
                        model: ListModel { id: offResultsModel }
                        delegate: Rectangle {
                            width: ListView.view.width
                            height: 30
                            color: offRowMouse.containsMouse ? Theme.colorSurfaceHover : Theme.colorTransparent
                            Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                            RowLayout {
                                anchors.fill: parent
                                anchors.leftMargin: Theme.spaceSm
                                anchors.rightMargin: Theme.spaceSm
                                spacing: Theme.spaceSm
                                Text {
                                    Layout.fillWidth: true
                                    text: model.name || "(sans nom)"
                                    color: Theme.colorText
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeSm
                                    elide: Text.ElideRight
                                }
                                Text {
                                    text: "OFF"
                                    color: "#3b82f6"   // bleu OFF
                                    font.family: Theme.fontFamily
                                    font.pixelSize: Theme.fontSizeXs
                                    font.weight: Theme.fontWeightSemiBold
                                }
                            }
                            MouseArea {
                                id: offRowMouse
                                anchors.fill: parent
                                hoverEnabled: true
                                cursorShape: Qt.PointingHandCursor
                                onClicked: {
                                    if (model.id > 0) {
                                        ingredientVM.importExisting(model.id)
                                        receiptImportVM.setLineChosenIngredient(linePicker.lineIndex, model.id)
                                        linePicker.close()
                                    }
                                }
                            }
                        }
                    }
                }

                Item { Layout.fillHeight: true }

                // Phase 4 — bascule en mode création
                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 1
                    color: Theme.colorBorder
                    opacity: 0.4
                }
                AppButton {
                    Layout.fillWidth: true
                    text: "+ Créer un nouvel ingrédient depuis cette ligne"
                    variant: "ghost"
                    onClicked: linePicker.enterCreateMode()
                }
            }

            // ============================================================
            // Mode 2 : CRÉER — mini-form inline (Phase 4)
            // ============================================================
            ColumnLayout {
                id: createForm
                visible: linePicker.createMode
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: Theme.spaceSm

                // Champs édités, exposés en propriétés pour pouvoir les piloter
                // depuis l'extérieur (enterCreateMode()).
                property string fieldName: ""
                property string fieldEan: ""
                property string fieldCategoryL1: ""
                property string fieldCategoryL2: ""
                property real   fieldPieceWeight: 0
                property real   fieldPriceQty: 0
                property string lookupHint: ""

                Text {
                    text: "Créer cet ingrédient dans ta bibliothèque :"
                    color: Theme.colorText
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                    font.weight: Theme.fontWeightMedium
                }

                // ---- Nom (requis) ----
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    Text { text: "Nom"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs }
                    AppTextField {
                        Layout.fillWidth: true
                        text: createForm.fieldName
                        onTextChanged: createForm.fieldName = text
                        placeholderText: "Ex : Yaourt nature, Concombre…"
                    }
                }

                // ---- EAN + lookup OFF ----
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 2
                    Text {
                        text: "Code-barres / EAN  (optionnel)"
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                    }
                    RowLayout {
                        Layout.fillWidth: true
                        spacing: Theme.spaceXs
                        AppTextField {
                            Layout.fillWidth: true
                            text: createForm.fieldEan
                            onTextChanged: createForm.fieldEan = text
                            placeholderText: "13 chiffres si scanné depuis le produit"
                            inputMethodHints: Qt.ImhDigitsOnly
                        }
                        AppButton {
                            text: "🔍 OFF"
                            variant: "secondary"
                            enabled: createForm.fieldEan.length >= 8
                            onClicked: {
                                const d = ingredientVM.lookupBarcodeAsDict(createForm.fieldEan)
                                if (d && d.name) {
                                    createForm.fieldName = d.name
                                    if (d.categoryL1) createForm.fieldCategoryL1 = d.categoryL1
                                    if (d.categoryL2) createForm.fieldCategoryL2 = d.categoryL2
                                    createForm.lookupHint = "✓ Trouvé sur OpenFoodFacts : " + d.name
                                } else {
                                    createForm.lookupHint = "Aucun produit OFF pour cet EAN."
                                }
                            }
                        }
                    }
                    Text {
                        visible: createForm.lookupHint.length > 0
                        text: createForm.lookupHint
                        color: createForm.lookupHint.startsWith("✓") ? Theme.colorSuccess : Theme.colorWarning
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                        Layout.fillWidth: true
                        wrapMode: Text.WordWrap
                    }
                }

                // ---- Catégorie ----
                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spaceMd
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        Text { text: "Catégorie L1"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs }
                        AppTextField {
                            Layout.fillWidth: true
                            text: createForm.fieldCategoryL1
                            onTextChanged: createForm.fieldCategoryL1 = text
                            placeholderText: "(auto si TVA A)"
                        }
                    }
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        Text { text: "Catégorie L2"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs }
                        AppTextField {
                            Layout.fillWidth: true
                            text: createForm.fieldCategoryL2
                            onTextChanged: createForm.fieldCategoryL2 = text
                            placeholderText: "Optionnel"
                        }
                    }
                }

                // ---- Poids unitaire + base prix ----
                RowLayout {
                    Layout.fillWidth: true
                    spacing: Theme.spaceMd
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        Text {
                            text: "Poids 1 pièce (g)  · optionnel"
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXs
                        }
                        AppSpinBox {
                            Layout.fillWidth: true
                            realFrom: 0; realTo: 5000; realStep: 5; decimals: 0
                            realValue: createForm.fieldPieceWeight
                            emptyOnZero: true
                            onRealValueChanged: createForm.fieldPieceWeight = realValue
                        }
                    }
                    ColumnLayout {
                        Layout.fillWidth: true
                        spacing: 2
                        Text {
                            text: "Quantité du prix (g)  · optionnel"
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXs
                        }
                        AppSpinBox {
                            Layout.fillWidth: true
                            realFrom: 0; realTo: 50000; realStep: 50; decimals: 0
                            realValue: createForm.fieldPriceQty
                            emptyOnZero: true
                            onRealValueChanged: createForm.fieldPriceQty = realValue
                        }
                    }
                }

                Text {
                    Layout.fillWidth: true
                    text: "Astuce : si tu connais le poids exact (ex : 250 g pour un yaourt) et "
                        + "le prix correspond à ce poids, renseigne « Quantité du prix » → le suivi "
                        + "€/100 g sera précis. Sinon, tu pourras affiner plus tard."
                    color: Theme.colorTextDisabled
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXs
                    wrapMode: Text.WordWrap
                }

                Item { Layout.fillHeight: true }
            }

            // ---- Footer (commun aux 2 modes) ----
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceSm

                AppButton {
                    visible: linePicker.createMode
                    text: "← Retour"
                    variant: "ghost"
                    onClicked: linePicker.createMode = false
                }
                Item { Layout.fillWidth: true }
                AppButton {
                    text: "Annuler"
                    variant: "ghost"
                    onClicked: linePicker.close()
                }
                AppButton {
                    visible: linePicker.createMode
                    text: "✓ Créer et utiliser"
                    variant: "primary"
                    enabled: createForm.fieldName.trim().length > 1
                    onClicked: {
                        const id = receiptImportVM.createIngredientFromLine({
                            "index":          linePicker.lineIndex,
                            "name":           createForm.fieldName,
                            "sourceRef":      createForm.fieldEan,
                            "categoryL1":     createForm.fieldCategoryL1,
                            "categoryL2":     createForm.fieldCategoryL2,
                            "pieceWeightG":   createForm.fieldPieceWeight,
                            "priceQuantityG": createForm.fieldPriceQty,
                        })
                        if (id > 0) {
                            // Re-fetch la liste d'ingrédients (le nouveau y apparaîtra)
                            ingredientVM.refreshList()
                            linePicker.close()
                        }
                    }
                }
            }
        }
    }

    // ============================================================ Toasts

    Rectangle {
        id: errorToast
        property string message: ""
        visible: false
        z: 10
        color: Theme.colorError
        radius: Theme.radiusMd
        opacity: 0.95
        anchors.bottom: parent.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottomMargin: Theme.spaceXl
        width: Math.min(errorText.implicitWidth + Theme.spaceXl * 2, root.width - 80)
        height: errorText.implicitHeight + Theme.spaceMd * 2
        Text {
            id: errorText
            anchors.centerIn: parent
            anchors.margins: Theme.spaceMd
            text: errorToast.message
            color: "white"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeSm
            wrapMode: Text.WordWrap
        }
        Timer { running: errorToast.visible; interval: 5000; onTriggered: errorToast.visible = false }
    }

    Rectangle {
        id: successToast
        property string message: ""
        visible: false
        z: 10
        color: Theme.colorSuccess
        radius: Theme.radiusMd
        opacity: 0.95
        anchors.bottom: parent.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottomMargin: Theme.spaceXl
        width: successText.implicitWidth + Theme.spaceXl * 2
        height: successText.implicitHeight + Theme.spaceMd * 2
        Text {
            id: successText
            anchors.centerIn: parent
            text: successToast.message
            color: "white"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeMd
            font.weight: Theme.fontWeightMedium
        }
        Timer { running: successToast.visible; interval: 3000; onTriggered: successToast.visible = false }
    }
}
