// Label nutrient — libellé + picto PNG, dans cet ordre.
//
// Usage typique dans un `GridLayout` :
//   NutrientLabel { type: "energy"; text: "Énergie"; Layout.alignment: Qt.AlignRight }
//
// Pour une sous-ligne (dont saturés / dont sucres), passer `subline: true`
// pour obtenir un texte gris italique cohérent avec le tableau nutritionnel
// réglementaire :
//   NutrientLabel { type: "saturatedFats"; text: "dont saturés"; subline: true; ... }
//
// Layout : [libellé] [icône] — ancré à droite. L'icône est positionnée
// directement avant le champ de saisie (cohérent avec le visuel "Lipides ⬢
// 12,90 g/100g" demandé). Pas de ":" — l'icône agit visuellement comme
// séparateur.

import QtQuick
import QtQuick.Layouts
import App

Item {
    id: root

    // Type de nutriment :
    //   "energy" / "fats" / "saturatedFats" / "carbs" / "sugars" /
    //   "fiber" / "proteins" / "salt"
    property string type: "energy"
    // Libellé à afficher avant le picto (ex: "Énergie", "Lipides", "dont saturés")
    property alias text: label.text
    // Sous-ligne (dont saturés / dont sucres) → texte plus gris + italique
    property bool subline: false
    // Taille du picto (côté carré, en px). Toutes les icônes utilisent la
    // même taille pour cohérence visuelle dans le formulaire.
    property int iconSize: 24

    implicitWidth: Math.max(140, iconSize + label.implicitWidth + row.spacing * 2 + 8)
    implicitHeight: Math.max(iconSize, label.implicitHeight)

    RowLayout {
        id: row
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        spacing: 8

        // Libellé (à gauche du picto)
        Text {
            id: label
            color: root.subline ? Qt.alpha(Theme.colorTextSecondary, 0.85) : Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeMd
            font.italic: root.subline
        }

        // Slot picto — taille fixe, juste avant le champ de saisie
        Image {
            Layout.preferredWidth: root.iconSize
            Layout.preferredHeight: root.iconSize
            source: "icons/nutrient/" + root.type + ".png"
            sourceSize.width: root.iconSize * 2   // ×2 pour rendu net en HiDPI
            sourceSize.height: root.iconSize * 2
            fillMode: Image.PreserveAspectFit
            smooth: true
        }
    }
}
