// Cellule du calendrier : un (jour × slot). Affiche les entrées qui matchent et
// expose un bouton "+" toujours visible pour en ajouter. Toute la zone vide
// sous les entrées est cliquable et déclenche aussi l'ajout — pas besoin de
// viser pixel-près.
//
//   MealSlot {
//     dayOfWeek: 0
//     slot: "morning"
//     entriesModel: calendarVM.entries
//     onAddRequested: ...
//     onEntryRemoved: (entryId) => calendarVM.removeEntry(entryId)
//   }

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import App

Rectangle {
    id: root

    property int dayOfWeek: 0
    property string slot: "morning"
    property var entriesModel: null      // QAbstractListModel (calendarVM.entries)

    signal addRequested(int dayOfWeek, string slot)
    signal entryRemoved(int entryId)
    // U2 : ingredient_id émis par drop. Quantité = pieceWeightG si non-zero,
    // sinon 100g par défaut.
    signal ingredientDropped(int dayOfWeek, string slot, int ingredientId, real quantityG)

    color: dropArea.containsDrag
           ? Qt.alpha(Theme.colorPrimary, 0.18)
           : bgHover.containsMouse ? Theme.colorSurfaceHover : Theme.colorSurface
    radius: Theme.radiusSm
    border.width: dropArea.containsDrag ? 2 : 1
    border.color: dropArea.containsDrag
                  ? Theme.colorPrimary
                  : bgHover.containsMouse ? Theme.colorBorderHover : Theme.colorBorder
    Behavior on color { ColorAnimation { duration: Theme.durationFast } }
    Behavior on border.color { ColorAnimation { duration: Theme.durationFast } }

    // Refonte UX : hauteur dynamique façon tableur. La cellule a une hauteur
    // de base confortable (140 px) qui s'étend pour absorber tous les items
    // sans tronquer. Le RowLayout parent (= la ligne du calendrier) prendra
    // automatiquement la hauteur du plus grand MealSlot — donc toutes les
    // cellules d'une même ligne restent alignées verticalement.
    readonly property int _minHeight: 140
    readonly property int _entryHeight: 28
    readonly property int _entrySpacing: 4
    readonly property int _addButtonHeight: 22

    // Compte les entrées visibles dans cette cellule pour calculer la hauteur.
    // Re-calculé chaque fois que le model change (signal emis par
    // `MealPlanModel.modelReset` / `dataChanged`).
    property int visibleEntryCount: 0
    function _recomputeVisibleCount() {
        if (!entriesModel) { visibleEntryCount = 0; return }
        let n = 0
        const rowCount = entriesModel.rowCount()
        const dayRole = entriesModel.Roles ? entriesModel.Roles.dayOfWeek : -1
        const slotRole = entriesModel.Roles ? entriesModel.Roles.slot : -1
        if (dayRole < 0 || slotRole < 0) { visibleEntryCount = 0; return }
        for (let i = 0; i < rowCount; i++) {
            const idx = entriesModel.index(i, 0)
            if (entriesModel.data(idx, dayRole) === root.dayOfWeek
                && entriesModel.data(idx, slotRole) === root.slot) {
                n++
            }
        }
        visibleEntryCount = n
    }

    Connections {
        target: root.entriesModel
        function onModelReset()                          { root._recomputeVisibleCount() }
        function onRowsInserted(parent, first, last)     { root._recomputeVisibleCount() }
        function onRowsRemoved(parent, first, last)      { root._recomputeVisibleCount() }
        function onDataChanged(top, bottom, roles)       { root._recomputeVisibleCount() }
    }
    Component.onCompleted: _recomputeVisibleCount()
    onEntriesModelChanged: _recomputeVisibleCount()
    onDayOfWeekChanged: _recomputeVisibleCount()
    onSlotChanged: _recomputeVisibleCount()

    implicitHeight: {
        const entries = visibleEntryCount * _entryHeight
                      + Math.max(0, visibleEntryCount - 1) * _entrySpacing
        const gap = visibleEntryCount > 0 ? Theme.spaceSm : 0
        const content = Theme.spaceSm * 2 + entries + gap + _addButtonHeight
        return Math.max(_minHeight, content)
    }

    // ---- Toute la cellule est cliquable, sauf les entries qui ont leur propre
    //      MouseArea pour le bouton ✕ (z plus élevé). ----
    MouseArea {
        id: bgHover
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: root.addRequested(root.dayOfWeek, root.slot)
    }

    // U2 : DropArea pour le drag depuis le panneau "Ingrédients rapides".
    // Le composant source (DraggableIngredientChip) expose `ingredientId` et
    // `pieceWeightG` comme properties — lus via `drop.source.*`.
    DropArea {
        id: dropArea
        anchors.fill: parent
        onDropped: function(drop) {
            const source = drop.source
            if (source && source.ingredientId !== undefined) {
                const qty = source.pieceWeightG && source.pieceWeightG > 0
                            ? source.pieceWeightG  // 1 pièce
                            : 100.0                 // 100 g par défaut
                root.ingredientDropped(root.dayOfWeek, root.slot,
                                       source.ingredientId, qty)
                drop.accept(Qt.CopyAction)
            }
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceSm
        spacing: 4

        Repeater {
            model: root.entriesModel
            delegate: Rectangle {
                visible: model.dayOfWeek === root.dayOfWeek && model.slot === root.slot
                Layout.fillWidth: true
                Layout.preferredHeight: visible ? 28 : 0
                radius: Theme.radiusSm
                color: hoverItem.containsMouse ? Theme.colorSurfacePressed : Qt.alpha(Theme.colorPrimary, 0.10)
                z: 2

                RowLayout {
                    anchors.fill: parent
                    anchors.leftMargin: Theme.spaceSm
                    anchors.rightMargin: 4
                    spacing: 4

                    Text {
                        Layout.fillWidth: true
                        text: model.description
                        color: Theme.colorText
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeSm
                        elide: Text.ElideRight
                        verticalAlignment: Text.AlignVCenter
                    }
                    Text {
                        text: "✕"
                        color: removeMouse.containsMouse ? Theme.colorError : Qt.alpha(Theme.colorTextSecondary, 0.65)
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeMd
                        font.weight: Theme.fontWeightSemiBold
                        Layout.preferredWidth: 22
                        horizontalAlignment: Text.AlignHCenter
                        verticalAlignment: Text.AlignVCenter
                        Behavior on color { ColorAnimation { duration: Theme.durationFast } }

                        MouseArea {
                            id: removeMouse
                            anchors.fill: parent
                            anchors.margins: -3
                            hoverEnabled: true
                            cursorShape: Qt.PointingHandCursor
                            onClicked: root.entryRemoved(model.entryId)
                        }
                    }
                }
                MouseArea {
                    id: hoverItem
                    anchors.fill: parent
                    hoverEnabled: true
                    propagateComposedEvents: true
                    onClicked: function(mouse) { mouse.accepted = false }   // laisse passer au bgHover
                }
            }
        }

        Item { Layout.fillHeight: true }   // pousse le "+" vers le bas

        // "+" toujours visible — plus prononcé au survol.
        Text {
            Layout.alignment: Qt.AlignHCenter
            text: "+ Ajouter"
            color: bgHover.containsMouse ? Theme.colorPrimary : Qt.alpha(Theme.colorTextSecondary, 0.55)
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeSm
            font.weight: bgHover.containsMouse ? Theme.fontWeightSemiBold : Theme.fontWeightRegular
            Behavior on color { ColorAnimation { duration: Theme.durationFast } }
        }
    }
}
