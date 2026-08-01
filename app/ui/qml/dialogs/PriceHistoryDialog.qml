// Dialog d'historique des prix d'un ingrédient.
//
// Vraie fenêtre système (Window) — détachable, non-modale. Trois sections :
//   1. Formulaire d'ajout (date / enseigne / quantité / prix / notes) en haut
//   2. Tableau chronologique inverse (newest first) avec ✕ pour supprimer
//   3. Graphique d'évolution €/100 g sur l'axe temporel — Canvas custom
//      (cohérent avec le mini-graph F9 dans CalendarPage), tooltip au survol.
//
//   priceHistoryDialog.openFor(ingredientId, ingredientName, defaultQuantityG)
//
// Le dialog appelle directement les slots `ingredientVM.priceHistoryFor`,
// `addPriceHistory`, `deletePriceHistory`, `knownStores`, `promoteHistoryToCurrent`.
//
// Le prix de référence de l'ingrédient (`ingredient.price_eur` +
// `price_quantity_g`) est recalculé automatiquement après chaque add/delete
// d'observation : il suit toujours la plus récente entrée par `recorded_at`.
// Le viewmodel émet `current_price_recomputed(ingredientId)` que la page
// écoute pour rafraîchir ses cellules en lecture seule.

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Window {
    id: root

    title: "Historique des prix"
    width: 880
    height: 640
    minimumWidth: 720
    minimumHeight: 520
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
                     | Qt.WindowMinMaxButtonsHint
    modality: Qt.NonModal

    // ---- État ----
    property int ingredientId: -1
    property string ingredientName: ""
    property real defaultQuantityG: 0   // pré-remplit le champ Quantité (lu depuis priceQtyField)


    // ListModel chronologique ASCENDING (pour le graph) ; le tableau l'inverse à l'affichage.
    ListModel { id: historyModel }
    ListModel { id: storesModel }   // pour l'autocomplétion

    function openFor(ingId, ingName, defaultQty) {
        ingredientId = ingId
        ingredientName = ingName || ""
        defaultQuantityG = defaultQty || 0
        title = "Historique des prix · " + ingredientName

        _refreshHistory()
        _refreshStores()

        // Reset form
        const today = new Date()
        const iso = today.toISOString().slice(0, 10)
        dateField.text = iso
        storeField.editText = ""
        qtyField.value = defaultQuantityG > 0 ? defaultQuantityG : 0
        priceField.text = ""
        notesField.text = ""

        show()
        raise()
        priceField.forceActiveFocus()
    }

    function _refreshHistory() {
        historyModel.clear()
        if (ingredientId <= 0) return
        const items = ingredientVM.priceHistoryFor(ingredientId) || []
        for (let i = 0; i < items.length; i++) historyModel.append(items[i])
        chartCanvas.requestPaint()
    }

    function _refreshStores() {
        storesModel.clear()
        const stores = ingredientVM.knownStores() || []
        for (let i = 0; i < stores.length; i++) storesModel.append({ "name": stores[i] })
    }

    // ============================================================ Layout principal

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        // ---- En-tête ----
        Text {
            text: ingredientName ? ("Historique des prix · " + ingredientName) : "Historique des prix"
            color: Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXl
            font.weight: Theme.fontWeightSemiBold
        }
        Text {
            text: historyModel.count > 0
                  ? historyModel.count + " observation" + (historyModel.count > 1 ? "s" : "")
                    + " · de " + historyModel.get(0).recordedAtIso.slice(0,10)
                    + " à " + historyModel.get(historyModel.count - 1).recordedAtIso.slice(0,10)
                  : "Aucune observation enregistrée."
            color: Theme.colorTextSecondary
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeSm
        }

        // ---- Formulaire d'ajout ----
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: addForm.implicitHeight + Theme.spaceMd * 2
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorBorder

            GridLayout {
                id: addForm
                anchors.fill: parent
                anchors.margins: Theme.spaceMd
                columns: 6
                rowSpacing: Theme.spaceSm
                columnSpacing: Theme.spaceMd

                // Ligne 1 : Date / Enseigne / Quantité / Prix / Bouton
                Text { text: "Date"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs }
                Text { text: "Enseigne"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs }
                Text { text: "Quantité (g)"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs }
                Text { text: "Prix (€)"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs }
                Text { text: "Notes"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs }
                Item { Layout.preferredWidth: 100 }   // colonne du bouton, sans titre

                // Date — text field + bouton "📅" qui ouvre un mini-calendrier
                // contextuel (DatePickerPopup). La saisie clavier reste possible
                // au format YYYY-MM-DD pour les power-users.
                RowLayout {
                    Layout.preferredWidth: 170
                    spacing: 2
                    AppTextField {
                        id: dateField
                        Layout.fillWidth: true
                        placeholderText: "YYYY-MM-DD"
                    }
                    // Bouton calendrier — petit, aligné sur la hauteur du champ.
                    // Rectangle plutôt qu'AppButton pour avoir un carré exact 32×32
                    // sans le padding minimum d'AppButton (implicitWidth ≥ 80).
                    Rectangle {
                        Layout.preferredWidth: 32
                        Layout.preferredHeight: dateField.height
                        radius: Theme.radiusSm
                        color: dateBtnMouse.containsMouse ? Theme.colorSurfaceHover : Theme.colorSurface
                        border.width: 1
                        border.color: dateBtnMouse.containsMouse ? Theme.colorBorderHover : Theme.colorBorder
                        Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                        Text {
                            anchors.centerIn: parent
                            text: "📅"
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeMd
                        }
                        MouseArea {
                            id: dateBtnMouse
                            anchors.fill: parent
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: datePicker.openAt(parent, dateField.text)
                        }
                        ToolTip.visible: dateBtnMouse.containsMouse
                        ToolTip.text: "Ouvrir le calendrier"
                        ToolTip.delay: 400
                    }
                }

                // Enseigne — combobox éditable avec autocomplétion sur les
                // enseignes déjà saisies (Lidl, Auchan, Carrefour…).
                ComboBox {
                    id: storeField
                    Layout.preferredWidth: 140
                    editable: true
                    model: storesModel
                    textRole: "name"
                    delegate: ItemDelegate {
                        width: storeField.width
                        contentItem: Text {
                            text: model.name || ""
                            color: Theme.colorText
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeSm
                            verticalAlignment: Text.AlignVCenter
                            leftPadding: Theme.spaceSm
                        }
                        background: Rectangle {
                            color: hovered ? Theme.colorSurfaceHover : Theme.colorTransparent
                        }
                    }
                    background: Rectangle {
                        color: Theme.colorSurface
                        border.width: 1
                        border.color: storeField.activeFocus ? Theme.colorBorderFocus : Theme.colorBorder
                        radius: Theme.radiusSm
                    }
                    contentItem: TextField {
                        text: storeField.editText
                        onTextChanged: storeField.editText = text
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeSm
                        color: Theme.colorText
                        placeholderText: "Lidl, Auchan…"
                        placeholderTextColor: Theme.colorTextPlaceholder
                        background: Item {}
                        verticalAlignment: TextInput.AlignVCenter
                        leftPadding: Theme.spaceSm
                    }
                }

                AppSpinBox {
                    id: qtyField
                    Layout.preferredWidth: 110
                    decimals: 1
                    realFrom: 0.0
                    realTo: 100000.0
                    realStep: 10.0
                    realValue: 0.0
                    emptyOnZero: true
                }

                AppTextField {
                    id: priceField
                    Layout.preferredWidth: 100
                    placeholderText: "ex : 2,50"
                }

                AppTextField {
                    id: notesField
                    Layout.fillWidth: true
                    placeholderText: "Optionnel"
                }

                AppButton {
                    text: "+ Ajouter"
                    variant: "primary"
                    Layout.preferredWidth: 100
                    enabled: priceField.text.trim().length > 0 && qtyField.realValue > 0 && dateField.text.trim().length > 0
                    onClicked: root._submitNew()
                }
            }
        }

        // ---- Graphique évolution ----
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 180
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorBorder

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Theme.spaceMd
                spacing: Theme.spaceXs

                Text {
                    text: "Évolution (€ / 100 g)"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXs
                    font.weight: Theme.fontWeightMedium
                }

                Canvas {
                    id: chartCanvas
                    Layout.fillWidth: true
                    Layout.fillHeight: true

                    property int hoverIndex: -1   // index du point survolé (-1 = aucun)

                    onPaint: {
                        const ctx = getContext("2d")
                        ctx.reset()
                        const w = width
                        const h = height
                        const pad = 24
                        ctx.font = "11px " + Theme.fontFamily
                        ctx.textBaseline = "middle"

                        if (historyModel.count === 0) {
                            ctx.fillStyle = Theme.colorTextDisabled
                            ctx.textAlign = "center"
                            ctx.fillText("Aucune donnée — ajoute des observations pour voir l'évolution.", w/2, h/2)
                            return
                        }

                        // Compute bounds
                        const n = historyModel.count
                        const ts = []
                        const vs = []
                        for (let i = 0; i < n; i++) {
                            const item = historyModel.get(i)
                            const date = new Date(item.recordedAtIso)
                            ts.push(date.getTime())
                            vs.push(parseFloat(item.pricePer100g))
                        }
                        const tMin = ts[0]
                        const tMax = ts[n - 1]
                        let vMin = Math.min.apply(null, vs)
                        let vMax = Math.max.apply(null, vs)
                        if (vMax === vMin) { vMax = vMin + 1; vMin = Math.max(0, vMin - 1) }
                        // Ajoute 10 % de marge verticale
                        const range = vMax - vMin
                        vMin = Math.max(0, vMin - range * 0.1)
                        vMax = vMax + range * 0.1

                        // Axes
                        ctx.strokeStyle = Theme.colorBorder
                        ctx.lineWidth = 1
                        ctx.beginPath()
                        ctx.moveTo(pad, pad/2)
                        ctx.lineTo(pad, h - pad)
                        ctx.lineTo(w - pad/2, h - pad)
                        ctx.stroke()

                        // Labels Y (min / max)
                        ctx.fillStyle = Theme.colorTextSecondary
                        ctx.textAlign = "right"
                        ctx.fillText(vMax.toFixed(2) + " €", pad - 4, pad/2 + 4)
                        ctx.fillText(vMin.toFixed(2) + " €", pad - 4, h - pad - 4)

                        // Labels X (date début / fin)
                        ctx.textAlign = "left"
                        ctx.fillText(new Date(tMin).toISOString().slice(0,10), pad, h - pad/2 + 4)
                        ctx.textAlign = "right"
                        ctx.fillText(new Date(tMax).toISOString().slice(0,10), w - pad/2, h - pad/2 + 4)

                        // Helper conversion data -> screen
                        function xOf(t) {
                            if (tMin === tMax) return pad + (w - pad - pad/2 - pad) / 2
                            return pad + (t - tMin) / (tMax - tMin) * (w - pad - pad/2)
                        }
                        function yOf(v) {
                            return (h - pad) - (v - vMin) / (vMax - vMin) * (h - pad - pad/2)
                        }

                        // Trait moyen (pointillé)
                        const avg = vs.reduce(function(a,b){return a+b}, 0) / n
                        ctx.setLineDash([4, 4])
                        ctx.strokeStyle = Theme.colorTextDisabled
                        ctx.beginPath()
                        ctx.moveTo(pad, yOf(avg))
                        ctx.lineTo(w - pad/2, yOf(avg))
                        ctx.stroke()
                        ctx.setLineDash([])
                        ctx.fillStyle = Theme.colorTextDisabled
                        ctx.textAlign = "left"
                        ctx.fillText("moy " + avg.toFixed(2) + " €", pad + 4, yOf(avg) - 6)

                        // Ligne polyligne
                        ctx.strokeStyle = Theme.colorPrimary
                        ctx.lineWidth = 2
                        ctx.beginPath()
                        for (let i = 0; i < n; i++) {
                            const x = xOf(ts[i])
                            const y = yOf(vs[i])
                            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
                        }
                        ctx.stroke()

                        // Points
                        for (let i = 0; i < n; i++) {
                            const x = xOf(ts[i])
                            const y = yOf(vs[i])
                            ctx.beginPath()
                            ctx.fillStyle = (i === hoverIndex) ? Theme.colorAccent : Theme.colorPrimary
                            ctx.arc(x, y, (i === hoverIndex) ? 5 : 3, 0, Math.PI * 2)
                            ctx.fill()
                        }
                    }

                    MouseArea {
                        id: chartMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        onExited: { chartCanvas.hoverIndex = -1; chartCanvas.requestPaint() }
                        onPositionChanged: function(mouse) {
                            // Trouve le point le plus proche de la souris (en X seulement)
                            if (historyModel.count === 0) return
                            const w = chartCanvas.width
                            const pad = 24
                            const n = historyModel.count
                            const ts = []
                            for (let i = 0; i < n; i++) {
                                const it = historyModel.get(i)
                                ts.push(new Date(it.recordedAtIso).getTime())
                            }
                            const tMin = ts[0]
                            const tMax = ts[n - 1]
                            let best = -1
                            let bestDist = 1e9
                            for (let i = 0; i < n; i++) {
                                const x = (tMin === tMax)
                                          ? pad + (w - pad - pad/2 - pad) / 2
                                          : pad + (ts[i] - tMin) / (tMax - tMin) * (w - pad - pad/2)
                                const d = Math.abs(mouse.x - x)
                                if (d < bestDist) { bestDist = d; best = i }
                            }
                            if (bestDist < 24) {
                                if (chartCanvas.hoverIndex !== best) {
                                    chartCanvas.hoverIndex = best
                                    chartCanvas.requestPaint()
                                }
                            } else {
                                if (chartCanvas.hoverIndex !== -1) {
                                    chartCanvas.hoverIndex = -1
                                    chartCanvas.requestPaint()
                                }
                            }
                        }
                    }

                    // Tooltip floating au-dessus du point survolé
                    Rectangle {
                        visible: chartCanvas.hoverIndex >= 0
                        x: chartMouse.mouseX + 12
                        y: Math.max(0, chartMouse.mouseY - 50)
                        width: tooltipText.implicitWidth + Theme.spaceMd * 2
                        height: tooltipText.implicitHeight + Theme.spaceXs * 2
                        color: Theme.colorText
                        radius: Theme.radiusSm
                        opacity: 0.92
                        Text {
                            id: tooltipText
                            anchors.centerIn: parent
                            color: Theme.colorBackground
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXs
                            text: {
                                if (chartCanvas.hoverIndex < 0) return ""
                                const item = historyModel.get(chartCanvas.hoverIndex)
                                if (!item) return ""
                                return item.recordedAtIso.slice(0,10)
                                     + "\n" + Number(parseFloat(item.pricePer100g)).toLocaleString(Qt.locale(), 'f', 2) + " € / 100 g"
                                     + (item.store ? "\n" + item.store : "")
                            }
                        }
                    }
                }
            }
        }

        // ---- Tableau des observations ----
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorBorder

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: Theme.spaceXs
                spacing: 0

                // En-tête
                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 28
                    color: Theme.colorBackground
                    radius: Theme.radiusSm
                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: Theme.spaceMd
                        anchors.rightMargin: Theme.spaceMd
                        spacing: Theme.spaceMd
                        Text { Layout.preferredWidth: 100; text: "Date";        color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs; font.weight: Theme.fontWeightMedium }
                        Text { Layout.preferredWidth: 130; text: "Enseigne";    color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs; font.weight: Theme.fontWeightMedium }
                        Text { Layout.preferredWidth: 90;  text: "Qté (g)";     color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs; font.weight: Theme.fontWeightMedium; horizontalAlignment: Text.AlignRight }
                        Text { Layout.preferredWidth: 90;  text: "Prix (€)";    color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs; font.weight: Theme.fontWeightMedium; horizontalAlignment: Text.AlignRight }
                        Text { Layout.preferredWidth: 100; text: "€ / 100 g";   color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs; font.weight: Theme.fontWeightMedium; horizontalAlignment: Text.AlignRight }
                        Text { Layout.fillWidth: true; text: "Notes";           color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs; font.weight: Theme.fontWeightMedium }
                        Text { Layout.preferredWidth: 70; text: "";             color: Theme.colorTextSecondary }   // colonne action
                    }
                }

                // Liste — affichage chronologique inverse (newest first).
                // Le ListModel reste ASC pour le graph ; ici on accède via
                // (count - 1 - index).
                ListView {
                    id: tableList
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    spacing: 1
                    boundsBehavior: Flickable.StopAtBounds
                    model: historyModel.count
                    ScrollBar.vertical: AppScrollBar { orientation: Qt.Vertical }

                    delegate: Rectangle {
                        readonly property int reverseIndex: historyModel.count - 1 - index
                        readonly property var entry: historyModel.get(reverseIndex)
                        width: tableList.width
                        height: 30
                        color: rowMouse.containsMouse ? Theme.colorSurfaceHover : Theme.colorTransparent

                        RowLayout {
                            anchors.fill: parent
                            anchors.leftMargin: Theme.spaceMd
                            anchors.rightMargin: Theme.spaceMd
                            spacing: Theme.spaceMd

                            Text {
                                Layout.preferredWidth: 100
                                text: entry ? entry.recordedAtIso.slice(0, 10) : ""
                                color: Theme.colorText
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                verticalAlignment: Text.AlignVCenter
                            }
                            Text {
                                Layout.preferredWidth: 130
                                text: entry ? (entry.store || "—") : ""
                                color: entry && entry.store ? Theme.colorText : Theme.colorTextDisabled
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                elide: Text.ElideRight
                                verticalAlignment: Text.AlignVCenter
                            }
                            Text {
                                Layout.preferredWidth: 90
                                text: entry ? Number(entry.quantityG).toLocaleString(Qt.locale(), 'f', 0) : ""
                                color: Theme.colorText
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                horizontalAlignment: Text.AlignRight
                                verticalAlignment: Text.AlignVCenter
                            }
                            Text {
                                Layout.preferredWidth: 90
                                text: entry ? Number(parseFloat(entry.priceEur)).toLocaleString(Qt.locale(), 'f', 2) : ""
                                color: Theme.colorText
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                horizontalAlignment: Text.AlignRight
                                verticalAlignment: Text.AlignVCenter
                            }
                            Text {
                                Layout.preferredWidth: 100
                                text: entry ? Number(parseFloat(entry.pricePer100g)).toLocaleString(Qt.locale(), 'f', 2) : ""
                                color: Theme.colorPrimary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                font.weight: Theme.fontWeightMedium
                                horizontalAlignment: Text.AlignRight
                                verticalAlignment: Text.AlignVCenter
                            }
                            Text {
                                Layout.fillWidth: true
                                text: entry ? (entry.notes || "") : ""
                                color: Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeSm
                                elide: Text.ElideRight
                                verticalAlignment: Text.AlignVCenter
                            }

                            // Action ✕ : supprimer cette observation. Le prix de
                            // référence de l'ingrédient se recalcule automatiquement
                            // à partir de l'observation suivante la plus récente
                            // (plus besoin de bouton "promouvoir" : la dernière
                            // observation par date EST le prix actuel).
                            Text {
                                text: "✕"
                                color: deleteMouse.containsMouse ? Theme.colorError : Qt.alpha(Theme.colorTextSecondary, 0.55)
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeMd
                                Layout.preferredWidth: 40
                                horizontalAlignment: Text.AlignHCenter
                                verticalAlignment: Text.AlignVCenter
                                Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                                MouseArea {
                                    id: deleteMouse
                                    anchors.fill: parent
                                    hoverEnabled: true
                                    cursorShape: Qt.PointingHandCursor
                                    ToolTip.visible: containsMouse
                                    ToolTip.text: "Supprimer cette observation"
                                    ToolTip.delay: 400
                                    onClicked: {
                                        if (!entry) return
                                        if (ingredientVM.deletePriceHistory(entry.id)) {
                                            root._refreshHistory()
                                        }
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
                    }
                }
            }
        }

        // ---- Footer : bouton Fermer ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceSm
            Item { Layout.fillWidth: true }
            AppButton { text: "Fermer"; variant: "secondary"; onClicked: root.close() }
        }
    }

    // ============================================================ Mini-calendrier

    DatePickerPopup {
        id: datePicker
        onDateSelected: function(iso) { dateField.text = iso }
    }

    // ============================================================ Submit handler

    function _submitNew() {
        const payload = {
            "ingredientId":   root.ingredientId,
            "priceEur":       priceField.text,
            "quantityG":      qtyField.realValue,
            "store":          storeField.editText,
            "recordedAtIso":  dateField.text.trim(),
            "notes":          notesField.text
        }
        const saved = ingredientVM.addPriceHistory(payload)
        if (saved && saved.id) {
            // Reset les champs principaux mais garde la date + l'enseigne
            // (saisies en rafale typique : "j'ai été chez Auchan, voici 5 prix").
            priceField.text = ""
            notesField.text = ""
            qtyField.realValue = root.defaultQuantityG > 0 ? root.defaultQuantityG : 0
            _refreshHistory()
            _refreshStores()
            priceField.forceActiveFocus()
        }
    }
}
