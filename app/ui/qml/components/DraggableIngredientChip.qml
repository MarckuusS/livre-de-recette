// Chip d'ingrédient draggable — utilisée dans le panneau latéral "Ingrédients
// rapides" du calendrier (U2) et de Frigo / Cellier (Phase D). Le drag laisse
// la chip immobile dans son layout (Flow / autre) et déplace un GHOST séparé
// qui suit la souris — au release, le ghost disparaît et la chip n'a jamais
// bougé visuellement (donc pas de chevauchement avec ses voisines).
//
// Le DropArea cible lit `drop.source.ingredientId` et `drop.source.pieceWeightG`.
//
// Bug fix : avant, on utilisait `drag.target: chip` directement, ce qui
// pirate les coords x/y de la chip. Au release, `chip.x = chip.y = 0` est
// envoyé mais le Flow parent ne re-flow pas (il cache son layout après le
// premier render). Résultat : si l'utilisateur drag puis lâche hors d'une
// cible, la chip se figeait à une position random et chevauchait ses voisines.
// Le ghost interne résout ça : la chip elle-même n'est jamais déplacée.

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import App

Item {
    id: chip

    property int ingredientId: -1
    property string ingredientName: ""
    property string sourceTag: "manual"  // ciqual / openfoodfacts / manual
    property real pieceWeightG: 0

    signal clicked

    implicitHeight: 28
    implicitWidth: rect.implicitWidth

    // ---- Chip statique (visible normalement, reste TOUJOURS dans le Flow) ----
    Rectangle {
        id: rect
        anchors.fill: parent
        radius: Theme.radiusFull
        color: ghost.Drag.active
               ? Qt.alpha(Theme.colorPrimary, 0.18)
               : dragArea.containsMouse
                 ? Theme.colorSurfaceHover
                 : Theme.colorSurface
        border.width: 1
        border.color: ghost.Drag.active
                      ? Theme.colorPrimary
                      : Theme.colorBorder
        implicitWidth: row.implicitWidth + Theme.spaceMd * 2

        Behavior on color { ColorAnimation { duration: Theme.durationFast } }
        Behavior on border.color { ColorAnimation { duration: Theme.durationFast } }

        RowLayout {
            id: row
            anchors.centerIn: parent
            spacing: Theme.spaceXs

            Rectangle {
                Layout.preferredWidth: 6
                Layout.preferredHeight: 6
                radius: 3
                color: chip.sourceTag === "ciqual"
                       ? "#15803d"
                       : chip.sourceTag === "openfoodfacts" ? "#1d4ed8" : "#c2410c"
            }
            Text {
                text: chip.ingredientName
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
                font.weight: Theme.fontWeightMedium
                elide: Text.ElideRight
                Layout.maximumWidth: 160
            }
            Text {
                visible: chip.pieceWeightG > 0
                text: "● 1pc"
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeXs
            }
        }
    }

    // ---- Ghost flottant : visible uniquement pendant le drag ----
    // Le drag.target opère sur ce ghost, pas sur la chip. La chip reste donc
    // immobile dans le Flow parent — pas de chevauchement.
    //
    // Pour exposer les propriétés au DropArea cible, le ghost porte les
    // mêmes ingredientId/pieceWeightG que la chip. La cible lit
    // `drop.source.ingredientId` (drop.source = ghost) et ça marche.
    Item {
        id: ghost
        // Hérite des données de la chip pour que la cible puisse les lire
        property int ingredientId: chip.ingredientId
        property string ingredientName: chip.ingredientName
        property real pieceWeightG: chip.pieceWeightG
        property string sourceTag: chip.sourceTag

        width: rect.width
        height: rect.height
        visible: Drag.active
        z: 1000

        Drag.active: false
        Drag.hotSpot.x: width / 2
        Drag.hotSpot.y: height / 2
        Drag.dragType: Drag.Internal

        // Reproduit le visuel de la chip pour le feedback visuel pendant le drag
        Rectangle {
            anchors.fill: parent
            radius: Theme.radiusFull
            color: Qt.alpha(Theme.colorPrimary, 0.92)
            border.width: 1
            border.color: Theme.colorPrimary

            Text {
                anchors.centerIn: parent
                text: "🛒  " + chip.ingredientName
                color: "white"
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
                font.weight: Theme.fontWeightSemiBold
                elide: Text.ElideRight
                width: parent.width - Theme.spaceMd * 2
                horizontalAlignment: Text.AlignHCenter
            }
        }
    }

    MouseArea {
        id: dragArea
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.OpenHandCursor
        drag.target: ghost
        drag.threshold: 6

        onPressed: {
            cursorShape = Qt.ClosedHandCursor
            // Place le ghost à la position de la chip au moment du press,
            // pour qu'il apparaisse "en place" puis suive la souris.
            ghost.x = 0
            ghost.y = 0
            ghost.Drag.active = true
        }
        onReleased: {
            cursorShape = Qt.OpenHandCursor
            ghost.Drag.drop()
            ghost.Drag.active = false
            ghost.visible = false
            // Reset des coords du ghost (la chip n'a jamais bougé, elle)
            ghost.x = 0
            ghost.y = 0
        }
        onClicked: chip.clicked()
    }
}
