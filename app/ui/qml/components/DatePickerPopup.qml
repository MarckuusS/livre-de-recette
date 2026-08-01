// Mini-calendrier contextuel — popup léger pour saisir une date sans clavier.
//
//   DatePickerPopup {
//       id: dp
//       onDateSelected: function(iso) { dateField.text = iso }
//   }
//   ...
//   onClicked: dp.openAt(button, dateField.text)
//
// API :
//   - property `selectedIso: string`     "YYYY-MM-DD" actuellement sélectionnée
//   - signal `dateSelected(string iso)`  émis au clic sur une cellule jour
//   - function `openAt(anchorItem, iso)` ouvre sous l'anchor + initialise la sélection
//
// Implémentation :
//   - Popup non-modal, ferme sur clic extérieur (closePolicy CloseOnPressOutsideParent)
//   - Header : ‹ Mois Année › avec navigation +/- 1 mois (clavier PageUp/PageDown aussi)
//   - Bandeau jours de semaine (L M M J V S D — locale-aware via Qt.locale())
//   - Grille 6×7 : jours du mois courant en colorText, mois précédent/suivant
//     en colorTextDisabled. Aujourd'hui : anneau primary. Sélection : pastille primary remplie.
//   - Footer : "Aujourd'hui" (saute à la date système) + "Fermer"
//
// Aucune dépendance externe (Qt.labs.calendar pas disponible dans cette build PySide6).
// La logique date est faite via JS Date — pas de timezone, on travaille en jours.

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import App

Popup {
    id: root

    // ------------------------------------------------------------ API publique
    property string selectedIso: ""    // "YYYY-MM-DD" — ce que la grille met en surbrillance
    signal dateSelected(string iso)

    function openAt(anchorItem, iso) {
        // Init la sélection. Si iso est vide ou invalide, on prend aujourd'hui.
        const parsed = root._parseIso(iso) || new Date()
        root.selectedIso = root._formatIso(parsed)
        root._viewYear = parsed.getFullYear()
        root._viewMonth = parsed.getMonth()   // 0-indexed
        root._rebuildGrid()

        // Position sous l'anchor item dans les coordonnées de root.parent.
        // Le Popup parent doit être un Item du même arbre — on utilise window.contentItem
        // pour avoir la zone visible complète.
        const win = anchorItem.Window.window
        if (win) {
            // Mappe la position de l'anchor vers le contentItem de la fenêtre.
            const pt = anchorItem.mapToItem(win.contentItem,
                                            0, anchorItem.height + 4)
            root.parent = win.contentItem
            root.x = Math.max(8, Math.min(pt.x, win.contentItem.width - root.width - 8))
            root.y = Math.max(8, Math.min(pt.y, win.contentItem.height - root.height - 8))
        }
        root.open()
    }

    // ------------------------------------------------------------ Look & feel
    width: 280
    padding: 0
    modal: false
    focus: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutsideParent | Popup.CloseOnReleaseOutsideParent

    background: Rectangle {
        color: Theme.colorSurface
        radius: Theme.radiusMd
        border.width: 1
        border.color: Theme.colorBorder
        // Ombre légère
        Rectangle {
            anchors.fill: parent
            anchors.margins: -1
            radius: parent.radius + 1
            color: "transparent"
            border.width: 1
            border.color: Qt.alpha(Theme.colorText, 0.05)
            z: -1
        }
    }

    enter: Transition {
        NumberAnimation { property: "opacity"; from: 0; to: 1; duration: Theme.durationFast }
        NumberAnimation { property: "scale"; from: 0.96; to: 1.0; duration: Theme.durationFast }
    }

    // ------------------------------------------------------------ État interne
    property int _viewYear: (new Date()).getFullYear()
    property int _viewMonth: (new Date()).getMonth()
    property var _gridCells: []   // 42 entrées { iso, day, inMonth, isToday }

    function _parseIso(iso) {
        if (!iso || iso.length < 10) return null
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
        if (!m) return null
        const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))
        if (isNaN(d.getTime())) return null
        return d
    }

    function _formatIso(d) {
        const y = d.getFullYear()
        const m = (d.getMonth() + 1).toString().padStart(2, "0")
        const day = d.getDate().toString().padStart(2, "0")
        return y + "-" + m + "-" + day
    }

    function _rebuildGrid() {
        // Premier jour du mois et son décalage par rapport à lundi (0=lundi … 6=dimanche).
        const firstOfMonth = new Date(_viewYear, _viewMonth, 1)
        const jsDay = firstOfMonth.getDay()                // 0=dim … 6=sam
        const isoOffset = (jsDay + 6) % 7                  // 0=lun … 6=dim
        // On démarre la grille à `firstOfMonth - isoOffset jours`.
        const startDate = new Date(_viewYear, _viewMonth, 1 - isoOffset)

        const today = new Date()
        const todayY = today.getFullYear()
        const todayM = today.getMonth()
        const todayD = today.getDate()

        const cells = []
        for (let i = 0; i < 42; i++) {
            const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i)
            cells.push({
                "iso":     _formatIso(d),
                "day":     d.getDate(),
                "inMonth": d.getMonth() === _viewMonth && d.getFullYear() === _viewYear,
                "isToday": d.getFullYear() === todayY && d.getMonth() === todayM && d.getDate() === todayD
            })
        }
        _gridCells = cells
    }

    function _shiftMonth(delta) {
        let m = _viewMonth + delta
        let y = _viewYear
        while (m < 0)  { m += 12; y -= 1 }
        while (m > 11) { m -= 12; y += 1 }
        _viewMonth = m
        _viewYear = y
        _rebuildGrid()
    }

    function _capitalize(s) {
        return s && s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
    }

    // ------------------------------------------------------------ Layout
    contentItem: ColumnLayout {
        spacing: 0

        // ---- Header : ‹ Mois Année › ----
        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 36
            spacing: 0

            Text {
                Layout.preferredWidth: 36
                Layout.fillHeight: true
                text: "‹"
                color: prevMouse.containsMouse ? Theme.colorPrimary : Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeLg
                font.weight: Theme.fontWeightSemiBold
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
                Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                MouseArea {
                    id: prevMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root._shiftMonth(-1)
                }
            }

            Text {
                Layout.fillWidth: true
                Layout.fillHeight: true
                text: root._capitalize(Qt.locale().standaloneMonthName(root._viewMonth, Locale.LongFormat))
                      + " " + root._viewYear
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeMd
                font.weight: Theme.fontWeightSemiBold
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
            }

            Text {
                Layout.preferredWidth: 36
                Layout.fillHeight: true
                text: "›"
                color: nextMouse.containsMouse ? Theme.colorPrimary : Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeLg
                font.weight: Theme.fontWeightSemiBold
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
                Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                MouseArea {
                    id: nextMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root._shiftMonth(1)
                }
            }
        }

        // Séparateur
        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.colorBorder }

        // ---- Bandeau jours de semaine (L M M J V S D) — semaine commence lundi ----
        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 24
            spacing: 0
            Repeater {
                model: 7
                delegate: Item {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Text {
                        anchors.centerIn: parent
                        // Lundi = index 1 dans Qt.locale()
                        text: Qt.locale().standaloneDayName((index + 1) % 7, Locale.NarrowFormat).toUpperCase()
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                        font.weight: Theme.fontWeightMedium
                    }
                }
            }
        }

        // ---- Grille 6×7 ----
        Grid {
            id: grid
            Layout.fillWidth: true
            Layout.preferredHeight: 6 * 32
            columns: 7
            rows: 6
            // Chaque cellule : 1/7 de la largeur ; on calcule au binding pour
            // éviter le flicker quand le popup est ouvert plusieurs fois.

            Repeater {
                model: root._gridCells
                delegate: Rectangle {
                    width: grid.width / 7
                    height: 32
                    radius: Theme.radiusSm

                    readonly property bool isSelected: modelData.iso === root.selectedIso
                    readonly property bool inMonth: modelData.inMonth

                    color: isSelected
                           ? Theme.colorPrimary
                           : cellMouse.containsMouse
                             ? Theme.colorSurfaceHover
                             : Theme.colorTransparent
                    border.width: !isSelected && modelData.isToday ? 1.5 : 0
                    border.color: Theme.colorPrimary

                    Behavior on color { ColorAnimation { duration: Theme.durationFast } }

                    Text {
                        anchors.centerIn: parent
                        text: modelData.day
                        color: isSelected
                               ? Theme.colorOnPrimary
                               : !inMonth
                                 ? Theme.colorTextDisabled
                                 : modelData.isToday
                                   ? Theme.colorPrimary
                                   : Theme.colorText
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeSm
                        font.weight: modelData.isToday || isSelected
                                     ? Theme.fontWeightSemiBold
                                     : Theme.fontWeightRegular
                    }

                    MouseArea {
                        id: cellMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: {
                            root.selectedIso = modelData.iso
                            root.dateSelected(modelData.iso)
                            root.close()
                        }
                    }
                }
            }
        }

        // Séparateur
        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.colorBorder }

        // ---- Footer : Aujourd'hui / Fermer ----
        RowLayout {
            Layout.fillWidth: true
            Layout.preferredHeight: 36
            spacing: 0

            Item {
                Layout.fillWidth: true
                Layout.fillHeight: true
                Text {
                    anchors.centerIn: parent
                    text: "Aujourd'hui"
                    color: todayMouse.containsMouse ? Theme.colorPrimary : Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                    font.weight: Theme.fontWeightMedium
                    Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                }
                MouseArea {
                    id: todayMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                        const today = new Date()
                        root.selectedIso = root._formatIso(today)
                        root._viewYear = today.getFullYear()
                        root._viewMonth = today.getMonth()
                        root._rebuildGrid()
                        root.dateSelected(root.selectedIso)
                        root.close()
                    }
                }
            }

            Rectangle { Layout.preferredWidth: 1; Layout.fillHeight: true; color: Theme.colorBorder }

            Item {
                Layout.fillWidth: true
                Layout.fillHeight: true
                Text {
                    anchors.centerIn: parent
                    text: "Fermer"
                    color: closeMouse.containsMouse ? Theme.colorPrimary : Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                    font.weight: Theme.fontWeightMedium
                    Behavior on color { ColorAnimation { duration: Theme.durationFast } }
                }
                MouseArea {
                    id: closeMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.close()
                }
            }
        }
    }

    // Raccourcis clavier (PageUp/PageDown navigue les mois quand le popup a le focus)
    Keys.onPressed: function(e) {
        if (e.key === Qt.Key_PageUp)        { root._shiftMonth(-1); e.accepted = true }
        else if (e.key === Qt.Key_PageDown) { root._shiftMonth(1);  e.accepted = true }
    }
}
