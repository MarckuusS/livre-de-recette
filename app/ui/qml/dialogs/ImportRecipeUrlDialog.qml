// Wizard d'import de recette par URL — VRAIE FENÊTRE système (Window)
// détachable, draggable, non-modale (mêmes conventions que
// ImportIngredientDialog).
//
// 3 étapes pilotées par `recipeUrlImportVM.stepIndex` :
//   0 : Saisie URL + bouton Charger + spinner + erreur
//   1 : Aperçu recette + association ingrédient par ligne
//   2 : Confirmation + fermeture
//
// Sub-dialog inline (modal interne) pour la création manuelle d'un
// ingrédient quand aucun match n'est trouvé.

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Window {
    id: root

    title: "Importer une recette par URL"
    width: 1000
    height: 720
    minimumWidth: 760
    minimumHeight: 520
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
                     | Qt.WindowMinMaxButtonsHint
    modality: Qt.NonModal

    // Émis quand la commit() côté VM réussit. Le parent (RecipesPage) écoute
    // pour rafraîchir la liste de recettes et basculer sur la nouvelle.
    signal importCompleted(int recipeId)

    function openCentered(parentWindow) {
        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        recipeUrlImportVM.reset()
        urlField.text = ""
        errorBanner.text = ""
        spinner.running = false
        show()
        raise()
    }

    // --- Connexions VM ---
    Connections {
        target: recipeUrlImportVM
        function onExtraction_started() {
            spinner.running = true
            errorBanner.text = ""
        }
        function onExtraction_completed(success) {
            spinner.running = false
        }
        function onExtraction_failed(message) {
            spinner.running = false
            errorBanner.text = message
        }
        function onImport_completed(recipeId) {
            root.importCompleted(recipeId)
            // Auto-close after step-2 confirmation displayed for ~1.5 s
            confirmCloseTimer.start()
        }
        function onError_emitted(message) {
            commitError.text = message
        }
        function onLines_changed(idx) {
            linesRepeater.model = recipeUrlImportVM.linesAsList()
        }
    }
    Timer {
        id: confirmCloseTimer
        interval: 1800
        repeat: false
        onTriggered: { recipeUrlImportVM.reset(); root.close() }
    }

    StackLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        currentIndex: recipeUrlImportVM.stepIndex

        // ============================================================ ÉTAPE 0 — URL
        // Card centrée avec icône, titre, description, champ URL et CTA.
        // Le spinner moderne (AppSpinner) prend la place du bouton pendant
        // l'extraction pour donner un feedback clair sans laisser un bouton
        // grisé/vide à l'écran.
        Item {
            ColumnLayout {
                anchors.centerIn: parent
                width: Math.min(parent.width - Theme.spaceXl * 2, 580)
                spacing: Theme.spaceLg

                // Card visuelle
                Rectangle {
                    Layout.fillWidth: true
                    color: Theme.colorSurface
                    radius: Theme.radiusLg
                    border.width: 1
                    border.color: Theme.colorBorder
                    implicitHeight: cardContent.implicitHeight + Theme.spaceXl * 2

                    ColumnLayout {
                        id: cardContent
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.margins: Theme.spaceXl
                        spacing: Theme.spaceMd

                        // Pictogramme
                        Text {
                            text: "🌐"
                            font.pixelSize: 56
                            Layout.alignment: Qt.AlignHCenter
                        }
                        Text {
                            text: "Importer une recette depuis le web"
                            color: Theme.colorText
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXl
                            font.weight: Theme.fontWeightSemiBold
                            Layout.alignment: Qt.AlignHCenter
                            horizontalAlignment: Text.AlignHCenter
                        }
                        Text {
                            text: "Colle l'URL d'une page recette. L'app extrait nom, "
                                + "ingrédients, instructions et portions automatiquement."
                            Layout.fillWidth: true
                            horizontalAlignment: Text.AlignHCenter
                            color: Theme.colorTextSecondary
                            wrapMode: Text.WordWrap
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeSm
                        }

                        // Champ URL pleine largeur
                        AppTextField {
                            id: urlField
                            Layout.fillWidth: true
                            Layout.topMargin: Theme.spaceSm
                            placeholderText: "https://www.marmiton.org/recettes/recette_…"
                            enabled: !spinner.running
                            Keys.onReturnPressed: _doFetch()
                        }

                        // CTA — masqué pendant l'extraction (spinner prend le relais)
                        AppButton {
                            id: loadButton
                            visible: !spinner.running
                            text: "Charger la recette"
                            variant: "primary"
                            Layout.alignment: Qt.AlignHCenter
                            Layout.preferredWidth: 220
                            enabled: urlField.text.trim().length > 0
                            onClicked: _doFetch()
                        }

                        // Spinner moderne (arc partiel animé) — affiché pendant le fetch
                        ColumnLayout {
                            visible: spinner.running
                            Layout.alignment: Qt.AlignHCenter
                            spacing: Theme.spaceSm
                            AppSpinner {
                                id: spinner
                                Layout.alignment: Qt.AlignHCenter
                                size: 56
                                arcThickness: 5
                                running: false
                            }
                            Text {
                                Layout.alignment: Qt.AlignHCenter
                                text: "Chargement de la recette…"
                                color: Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                            }
                        }

                        // Bannière d'erreur sous la card
                        Text {
                            id: errorBanner
                            Layout.fillWidth: true
                            horizontalAlignment: Text.AlignHCenter
                            color: Theme.colorError
                            wrapMode: Text.WordWrap
                            visible: text !== ""
                            text: ""
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeSm
                        }
                    }
                }

                // Hint sous la card — sites supportés
                Text {
                    Layout.fillWidth: true
                    horizontalAlignment: Text.AlignHCenter
                    color: Theme.colorTextSecondary
                    opacity: 0.7
                    wrapMode: Text.WordWrap
                    text: "Sites supportés en natif : Marmiton, 750g, Hervé Cuisine, "
                        + "Cuisine AZ, Cuisine Actuelle, HelloFresh, etc.\n"
                        + "Les autres sites passent par un fallback Schema.org "
                        + "(peut échouer si la page n'expose pas de données structurées)."
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXs
                }
            }
        }

        // ============================================================ ÉTAPE 1 — Review
        ColumnLayout {
            spacing: Theme.spaceMd

            // Header recette éditable
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceMd
                Text { text: "Nom :"; color: Theme.colorText; Layout.alignment: Qt.AlignVCenter }
                AppTextField {
                    id: metaName
                    Layout.fillWidth: true
                    Layout.minimumWidth: 280
                    text: recipeUrlImportVM.name
                    onEditingFinished: _pushMeta()
                }
                Text { text: "Portions :"; color: Theme.colorText; Layout.alignment: Qt.AlignVCenter }
                AppSpinBox {
                    id: metaPortions
                    Layout.preferredWidth: 90
                    decimals: 0
                    realFrom: 1
                    realTo: 50
                    realValue: recipeUrlImportVM.defaultPortions
                    onRealValueChanged: _pushMeta()
                }
                Text {
                    visible: recipeUrlImportVM.prepTimeMin > 0
                    text: "≈ " + recipeUrlImportVM.prepTimeMin + " min"
                    color: Theme.colorTextSecondary
                    font.italic: true
                }
            }
            Text {
                visible: recipeUrlImportVM.sourceUrl !== ""
                text: "Source : " + recipeUrlImportVM.sourceUrl
                color: Theme.colorTextSecondary
                font.italic: true
                font.pixelSize: Theme.fontSizeXs
                elide: Text.ElideMiddle
                Layout.fillWidth: true
            }

            // Tableau des ingrédients
            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                color: Theme.colorSurface
                radius: Theme.radiusMd
                border.width: 1
                border.color: Theme.colorBorder

                ScrollView {
                    id: linesScroll
                    anchors.fill: parent
                    anchors.margins: Theme.spaceSm
                    clip: true
                    ScrollBar.vertical: AppScrollBar { orientation: Qt.Vertical }
                    ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

                    ColumnLayout {
                        width: linesScroll.availableWidth
                        spacing: 4

                        // Ligne d'entête colonnes
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: Theme.spaceSm
                            Text { Layout.preferredWidth: 220; text: "Texte original"; color: Theme.colorTextSecondary; font.pixelSize: Theme.fontSizeXs }
                            Text { Layout.fillWidth: true;  text: "Ingrédient associé"; color: Theme.colorTextSecondary; font.pixelSize: Theme.fontSizeXs }
                            Text { Layout.preferredWidth: 220; text: "Quantité"; color: Theme.colorTextSecondary; font.pixelSize: Theme.fontSizeXs }
                            Item { Layout.preferredWidth: 130 }
                        }
                        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.colorBorder; opacity: 0.5 }

                        Repeater {
                            id: linesRepeater
                            model: recipeUrlImportVM.linesAsList()
                            delegate: Rectangle {
                                Layout.fillWidth: true
                                implicitHeight: lineRow.implicitHeight + Theme.spaceSm * 2
                                color: modelData.isIgnored
                                       ? Qt.alpha(Theme.colorTextDisabled, 0.10)
                                       : (index % 2 === 0
                                          ? Theme.colorTransparent
                                          : Qt.alpha(Theme.colorBorder, 0.08))
                                radius: Theme.radiusSm
                                opacity: modelData.isIgnored ? 0.55 : 1.0

                                RowLayout {
                                    id: lineRow
                                    anchors.fill: parent
                                    anchors.margins: Theme.spaceSm
                                    spacing: Theme.spaceSm

                                    // Col 1 : raw_text + parsed_name éditable
                                    ColumnLayout {
                                        Layout.preferredWidth: 220
                                        spacing: 2
                                        Text {
                                            text: modelData.rawText
                                            color: Theme.colorTextSecondary
                                            font.italic: true
                                            font.pixelSize: Theme.fontSizeXs
                                            elide: Text.ElideRight
                                            Layout.fillWidth: true
                                        }
                                        AppTextField {
                                            Layout.fillWidth: true
                                            text: modelData.parsedName
                                            onEditingFinished: {
                                                if (text !== modelData.parsedName)
                                                    recipeUrlImportVM.setLineParsedName(modelData.idx, text)
                                            }
                                        }
                                    }

                                    // Col 2 : ComboBox candidats (ou texte "non associé")
                                    AppComboBox {
                                        id: cbCandidates
                                        Layout.fillWidth: true
                                        Layout.preferredHeight: 32
                                        // Modèle : liste de {label, id}
                                        model: {
                                            const items = []
                                            for (let i = 0; i < modelData.candidates.length; ++i) {
                                                const c = modelData.candidates[i]
                                                const tag = c.source === "manual" ? "perso"
                                                          : c.source === "ciqual" ? "CIQUAL"
                                                          : c.source === "openfoodfacts" ? "OFF" : c.source
                                                items.push({
                                                    label: c.name + "  ·  " + tag,
                                                    id:    c.id
                                                })
                                            }
                                            return items
                                        }
                                        textRole: "label"
                                        currentIndex: {
                                            for (let i = 0; i < modelData.candidates.length; ++i) {
                                                if (modelData.candidates[i].id === modelData.chosenIngredientId)
                                                    return i
                                            }
                                            return -1
                                        }
                                        displayText: modelData.chosenIngredientId > 0
                                                     ? modelData.chosenIngredientName
                                                     : "(non associé)"
                                        onActivated: {
                                            if (currentIndex >= 0 && currentIndex < model.length)
                                                recipeUrlImportVM.setLineChosenIngredient(
                                                    modelData.idx, model[currentIndex].id)
                                        }
                                        enabled: !modelData.isIgnored
                                    }

                                    // Col 3 : QuantityField (qty + unit). On
                                    // utilise `gramsEdited` (et pas
                                    // `gramsChanged`) pour ne réagir qu'aux
                                    // saisies utilisateur — ça évite une
                                    // boucle quand le VM ré-émet `lines_changed`
                                    // après un `setLineQuantityG`.
                                    QuantityField {
                                        Layout.preferredWidth: 220
                                        grams: modelData.quantityG
                                        preferredUnit: modelData.unitCode
                                        pieceWeightG: modelData.pieceWeightG
                                        enabled: !modelData.isIgnored
                                        onGramsEdited: function(g) {
                                            recipeUrlImportVM.setLineQuantityG(modelData.idx, g)
                                        }
                                        onUnitChanged: function(code) {
                                            recipeUrlImportVM.setLineUnitCode(modelData.idx, code)
                                        }
                                    }

                                    // Col 4 : actions (menu ⋮)
                                    AppButton {
                                        Layout.preferredWidth: 120
                                        text: modelData.isIgnored ? "Réactiver" : "Actions ▾"
                                        variant: modelData.isIgnored ? "secondary" : "ghost"
                                        onClicked: {
                                            if (modelData.isIgnored)
                                                recipeUrlImportVM.unignoreLine(modelData.idx)
                                            else
                                                lineMenu.openAt(this, modelData.idx,
                                                                modelData.rawText,
                                                                modelData.parsedName)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Erreur de commit
            Text {
                id: commitError
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignRight
                color: Theme.colorError
                visible: text !== ""
                wrapMode: Text.WordWrap
                font.pixelSize: Theme.fontSizeSm
                text: ""
            }

            // Footer : Précédent / Importer
            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceMd
                AppButton {
                    text: "‹ Précédent"
                    variant: "ghost"
                    onClicked: recipeUrlImportVM.goToStep0()
                }
                Item { Layout.fillWidth: true }
                AppButton {
                    text: "Importer la recette"
                    variant: "primary"
                    onClicked: {
                        commitError.text = ""
                        const r = recipeUrlImportVM.commit()
                        if (!r.success)
                            commitError.text = r.message
                    }
                }
            }
        }

        // ============================================================ ÉTAPE 2 — Confirmation
        ColumnLayout {
            spacing: Theme.spaceLg
            Item { Layout.fillHeight: true }
            Text {
                text: "✓"
                color: Theme.colorSuccess
                font.pixelSize: 64
                Layout.alignment: Qt.AlignHCenter
            }
            Text {
                text: "Recette « " + recipeUrlImportVM.name + " » importée"
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeXl
                font.weight: Theme.fontWeightSemiBold
                Layout.alignment: Qt.AlignHCenter
            }
            Text {
                text: "L'éditeur va s'ouvrir sur la nouvelle recette pour finitions "
                    + "(photo, tags, instructions affinées)."
                color: Theme.colorTextSecondary
                Layout.alignment: Qt.AlignHCenter
                Layout.maximumWidth: 500
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.WordWrap
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
            }
            AppButton {
                text: "Fermer"
                variant: "primary"
                Layout.alignment: Qt.AlignHCenter
                onClicked: { recipeUrlImportVM.reset(); root.close() }
            }
            Item { Layout.fillHeight: true }
        }
    }

    // ============================================================ Menu actions par ligne
    // 4 chemins offerts à l'utilisateur quand le matching auto est insuffisant :
    //   - Rechercher dans CIQUAL : popup avec query éditable, source = CIQUAL local
    //   - Rechercher dans OFF    : popup avec query éditable, source = OFF en ligne
    //   - Créer manuellement     : mini-form qui crée un ingrédient source=manual
    //   - Ignorer la ligne       : exclue du commit
    AppMenu {
        id: lineMenu
        property int lineIdx: -1
        property string lineRawText: ""
        property string lineParsedName: ""

        function openAt(anchorButton, idx, rawText, parsedName) {
            lineIdx = idx
            lineRawText = rawText
            lineParsedName = parsedName
            popup(anchorButton, 0, anchorButton.height)
        }

        // Note : on utilise `Action` (pas `MenuItem`) pour que le `delegate`
        // de l'AppMenu s'applique. Avec `MenuItem` direct, Qt rend les items
        // avec leur style natif (fond noir, charte qui ne match pas l'app).
        // 4 chemins offerts à l'utilisateur :
        //   - CIQUAL/OFF        : popup avec onglets CIQUAL + OFF (défaut CIQUAL)
        //   - Bibliothèque perso : popup focalisé sur la biblio personnelle
        //   - Créer manuellement : crée un ingrédient source=manual inline
        //   - Ignorer la ligne   : exclue du commit
        Action {
            text: "Rechercher dans CIQUAL/OFF…"
            onTriggered: searchPopup.openFor(
                root, lineMenu.lineIdx, lineMenu.lineRawText,
                lineMenu.lineParsedName, "ciqual")
        }
        Action {
            text: "Rechercher dans la Bibliothèque personnelle…"
            onTriggered: searchPopup.openFor(
                root, lineMenu.lineIdx, lineMenu.lineRawText,
                lineMenu.lineParsedName, "personal")
        }
        Action {
            text: "Créer manuellement…"
            onTriggered: createManualDialog.openFor(lineMenu.lineIdx, lineMenu.lineParsedName)
        }
        Action {
            text: "Ignorer cette ligne"
            onTriggered: recipeUrlImportVM.ignoreLine(lineMenu.lineIdx)
        }
    }

    // Popup de recherche manuelle CIQUAL/OFF
    IngredientSearchPopup {
        id: searchPopup
    }

    // ============================================================ Dialog interne : création manuelle
    Dialog {
        id: createManualDialog
        title: "Créer un ingrédient"
        modal: true
        anchors.centerIn: parent
        width: 460
        property int lineIdx: -1

        function openFor(idx, prefilledName) {
            lineIdx = idx
            manualName.text = prefilledName || ""
            manualCategory.text = ""
            manualKcal.realValue = 0
            open()
        }

        contentItem: ColumnLayout {
            spacing: Theme.spaceMd

            Text { text: "Nom :"; color: Theme.colorText }
            AppTextField { id: manualName; Layout.fillWidth: true }

            Text { text: "Rayon (facultatif) :"; color: Theme.colorText }
            AppTextField { id: manualCategory; Layout.fillWidth: true; placeholderText: "Ex. Épicerie" }

            Text { text: "Énergie kcal/100 g (facultatif) :"; color: Theme.colorText }
            AppSpinBox {
                id: manualKcal
                Layout.preferredWidth: 140
                decimals: 0
                realFrom: 0
                realTo: 2000
                realValue: 0
            }
        }

        footer: DialogButtonBox {
            standardButtons: DialogButtonBox.Ok | DialogButtonBox.Cancel
            onAccepted: {
                const id = recipeUrlImportVM.createManualForLine(
                    createManualDialog.lineIdx,
                    {
                        "name":         manualName.text.trim(),
                        "categoryL1":   manualCategory.text.trim(),
                        "kcalPer100g":  manualKcal.realValue > 0 ? manualKcal.realValue : null
                    }
                )
                if (id > 0) createManualDialog.close()
            }
            onRejected: createManualDialog.close()
        }
    }

    // ============================================================ Helpers JS
    function _doFetch() {
        const url = urlField.text.trim()
        if (!url) return
        recipeUrlImportVM.extractFromUrl(url)
    }
    function _pushMeta() {
        recipeUrlImportVM.updateMeta(metaName.text, "", metaPortions.realValue)
    }
}
