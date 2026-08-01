// Champ numérique avec unité figée affichée à droite (équivalent QtWidgets
// FixedUnitField). Utilisé pour les macros (g/100g, kcal/100g) et pour le
// poids unitaire. Empty quand value=0 — distingue "non renseigné" de "0".
//
//   FixedUnitField {
//     value: ingredient.kcal_per_100g || 0
//     unitText: "kcal/100g"
//     onValueChanged: ...
//   }

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import App

RowLayout {
    id: root

    property real value: 0.0
    property string unitText: "g/100g"
    property real maxValue: 10000.0
    property int decimals: 2

    // Re-émis quand l'utilisateur modifie la valeur (pas au binding initial).
    signal valueEdited(real value)

    spacing: 0

    // Bug fix : la liaison root.value ↔ spin.realValue NE PEUT PAS être un
    // binding QML (`realValue: root.value`). Quand l'utilisateur saisit du
    // texte dans le spin, AppSpinBox.onValueChanged écrit directement dans
    // `spin.realValue` (`realValue = v`) — ce qui *casse* le binding. Après
    // ça, toute réaffectation de `root.value` (ex : changer d'ingrédient
    // dans le formulaire) ne se propage plus au spin, et l'utilisateur voit
    // l'ancienne valeur pour le nouvel ingrédient. La parade : un handler
    // explicite qui survit aux écritures impératives.
    onValueChanged: {
        if (Math.abs(value - spin.realValue) > 1e-9)
            spin.realValue = value
    }

    AppSpinBox {
        id: spin
        Layout.fillWidth: true
        emptyOnZero: true
        decimals: root.decimals
        realFrom: 0
        realTo: root.maxValue
        realStep: 0.1
        realValue: root.value   // valeur initiale uniquement (binding cassé dès la 1re saisie)
        onRealValueChanged: {
            if (Math.abs(realValue - root.value) > 1e-6) {
                root.value = realValue
                root.valueEdited(realValue)
            }
        }
    }

    // Cellule d'unité accolée au spin
    Rectangle {
        Layout.preferredWidth: unitLabel.implicitWidth + Theme.spaceMd * 2
        Layout.preferredHeight: spin.implicitHeight
        color: Theme.colorSurfaceHover
        border.width: 1
        border.color: Theme.colorBorder
        radius: 0
        // Fusion visuelle avec le spin : pas de coin haut-gauche/bas-gauche arrondis
        // Astuce QML : on superpose un petit rect par-dessus pour effacer la coupure
        // En pratique, le bord du spin est masqué par le contour de cette cellule.

        Text {
            id: unitLabel
            anchors.centerIn: parent
            text: root.unitText
            color: Theme.colorTextSecondary
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeSm
        }
    }

    // Reset programmatique : `field.clear()` repasse à 0 (cellule vide).
    function clear() {
        spin.realValue = 0.0
        root.value = 0.0
    }
}
