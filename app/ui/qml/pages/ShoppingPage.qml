// Onglet 4 — Liste de courses générée depuis le planificateur (F1).
//
// VM : `shoppingVM` (context property). Une `iso_week` indépendante de
// CalendarViewModel — l'utilisateur peut préparer la liste de courses pour la
// semaine prochaine sans changer la semaine qu'il consulte sur le calendrier.
//
// La liste est aplatie côté model et regroupée visuellement par rayon
// dans le delegate (section header quand `categoryL1` change — `category_l1`
// stocke le nom du rayon depuis la refonte UX qui a abandonné les L1/L2).

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
import App
import "../components"
import "../dialogs"

Item {
    id: page

    Connections {
        target: shoppingVM
        function onWeek_changed() { /* refresh est appelé dans le set */ }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        // ---- Barre de navigation ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceMd

            AppButton {
                text: "‹ Semaine précédente"
                variant: "secondary"
                onClicked: shoppingVM.shiftWeek(-1)
            }
            AppButton {
                text: "Synchroniser avec calendrier"
                variant: "ghost"
                onClicked: shoppingVM.setIsoWeek(calendarVM.isoWeek)
            }
            AppButton {
                text: "Semaine suivante ›"
                variant: "secondary"
                onClicked: shoppingVM.shiftWeek(1)
            }
            // Note : les boutons d'import de ticket (PDF + Lidl Plus) ont été
            // déplacés dans l'onglet Frigo / Cellier — c'est là qu'on rentre
            // de courses, donc l'endroit naturel pour importer un ticket.

            Item { Layout.fillWidth: true }
            Text {
                text: "Liste de courses · Semaine " + (shoppingVM ? shoppingVM.isoWeek : "")
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeLg
                font.weight: Theme.fontWeightSemiBold
            }
        }

        // ---- Liste des items (avec sections par catégorie) ----
        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
            color: Theme.colorSurface
            radius: Theme.radiusMd
            border.width: 1
            border.color: Theme.colorBorder

            ListView {
                id: list
                anchors.fill: parent
                anchors.margins: 1
                clip: true
                model: shoppingVM ? shoppingVM.items : null
                spacing: 0
                ScrollBar.vertical: AppScrollBar {}

                // Section headers par catégorie L1
                section.property: "categoryL1"
                section.criteria: ViewSection.FullString
                section.delegate: Rectangle {
                    width: list.width
                    height: 32
                    color: Qt.alpha(Theme.colorPrimary, 0.06)
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.left: parent.left
                        anchors.leftMargin: Theme.spaceMd
                        text: (section || "Non catégorisé").toUpperCase()
                        color: Theme.colorPrimary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeSm
                        font.weight: Theme.fontWeightSemiBold
                        font.letterSpacing: 0.5
                    }
                }

                delegate: Rectangle {
                    width: list.width
                    height: 44
                    color: model.inFridge
                           ? Qt.alpha(Theme.colorSuccess, 0.06)
                           : itemHover.containsMouse
                             ? Theme.colorSurfaceHover
                             : Theme.colorTransparent
                    Behavior on color { ColorAnimation { duration: Theme.durationFast } }

                    MouseArea {
                        id: itemHover
                        anchors.fill: parent
                        hoverEnabled: true
                        acceptedButtons: Qt.NoButton
                    }

                    RowLayout {
                        anchors.fill: parent
                        anchors.leftMargin: Theme.spaceMd
                        anchors.rightMargin: Theme.spaceMd
                        spacing: Theme.spaceMd

                        AppCheckBox {
                            checked: model.inFridge
                            onClicked: shoppingVM.setInFridge(model.ingredientId, checked)
                        }
                        Text {
                            Layout.fillWidth: true
                            text: model.name
                            color: model.inFridge ? Theme.colorTextSecondary : Theme.colorText
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeMd
                            font.weight: Theme.fontWeightMedium
                            font.strikeout: model.inFridge
                            elide: Text.ElideRight
                        }
                        Text {
                            text: _formatQty(model.quantityG, model.pieceWeightG)
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeSm
                            Layout.preferredWidth: 200
                            horizontalAlignment: Text.AlignRight
                        }
                        Text {
                            visible: model.hasPrice
                            text: model.costEur
                                  ? Number(parseFloat(model.costEur)).toLocaleString(Qt.locale(), 'f', 2) + " €"
                                  : ""
                            color: Theme.colorText
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeMd
                            font.weight: Theme.fontWeightSemiBold
                            Layout.preferredWidth: 80
                            horizontalAlignment: Text.AlignRight
                        }
                        Text {
                            visible: !model.hasPrice
                            text: "(prix manquant)"
                            color: Theme.colorWarning
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXs
                            Layout.preferredWidth: 80
                            horizontalAlignment: Text.AlignRight
                        }
                    }
                }
            }

            // Empty state
            ColumnLayout {
                anchors.centerIn: parent
                visible: list.count === 0
                spacing: Theme.spaceSm
                Text {
                    Layout.alignment: Qt.AlignHCenter
                    text: "Aucun ingrédient à acheter"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeLg
                    font.weight: Theme.fontWeightMedium
                }
                Text {
                    Layout.preferredWidth: 360
                    Layout.alignment: Qt.AlignHCenter
                    wrapMode: Text.WordWrap
                    horizontalAlignment: Text.AlignHCenter
                    text: "Planifie des recettes ou des ingrédients dans le Calendrier pour cette semaine, puis reviens ici."
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                }
            }
        }

        // ---- Bandeau total + actions ----
        Rectangle {
            Layout.fillWidth: true
            radius: Theme.radiusMd
            color: Theme.colorSurface
            border.width: 1
            border.color: Theme.colorBorder
            implicitHeight: footerRow.implicitHeight + Theme.spaceMd * 2

            RowLayout {
                id: footerRow
                anchors.fill: parent
                anchors.margins: Theme.spaceMd
                spacing: Theme.spaceLg

                Text {
                    text: shoppingVM ? (shoppingVM.itemCount + " ingrédient"
                                        + (shoppingVM.itemCount > 1 ? "s" : ""))
                                     : "0 ingrédient"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                    font.weight: Theme.fontWeightMedium
                }
                Text {
                    visible: shoppingVM && shoppingVM.missingPriceCount > 0
                    text: "⚠ " + (shoppingVM ? shoppingVM.missingPriceCount : 0) + " sans prix"
                    color: Theme.colorWarning
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                }
                Item { Layout.fillWidth: true }

                Text {
                    text: "Total :"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                    font.weight: Theme.fontWeightMedium
                }
                Text {
                    text: shoppingVM
                          ? Number(parseFloat(shoppingVM.totalEur)).toLocaleString(Qt.locale(), 'f', 2) + " €"
                          : "0,00 €"
                    color: Theme.colorText
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXl
                    font.weight: Theme.fontWeightSemiBold
                }

                AppButton {
                    text: "📋 Copier la liste"
                    variant: "primary"
                    enabled: shoppingVM && shoppingVM.itemCount > 0
                    onClicked: page._copyToClipboard()
                }
            }
        }
    }

    // ---- Toast feedback ----
    Rectangle {
        id: toast
        property string message: ""
        visible: false
        z: 20
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
        Timer { running: toast.visible; interval: 3000; onTriggered: toast.visible = false }
    }

    // ============================================================ Helpers JS

    function _formatQty(quantityG, pieceWeightG) {
        let base = ""
        if (quantityG >= 1000) {
            const kg = quantityG / 1000
            base = kg.toLocaleString(Qt.locale(), 'f', kg < 10 ? 2 : 1) + " kg"
        } else if (quantityG >= 10) {
            base = Math.round(quantityG) + " g"
        } else {
            base = quantityG.toLocaleString(Qt.locale(), 'f', 1) + " g"
        }
        if (pieceWeightG && pieceWeightG > 0) {
            const pieces = quantityG / pieceWeightG
            const rounded = Math.round(pieces * 10) / 10
            const piecesStr = rounded.toLocaleString(Qt.locale(), 'f', rounded === Math.round(rounded) ? 0 : 1)
            const plural = rounded > 1 ? "s" : ""
            return base + "  ≈ " + piecesStr + " pièce" + plural
        }
        return base
    }

    function _copyToClipboard() {
        const ok = shoppingVM.copyToClipboard()
        if (ok) {
            toast.message = "✓ Liste copiée dans le presse-papier"
            toast.visible = true
        }
    }
}
