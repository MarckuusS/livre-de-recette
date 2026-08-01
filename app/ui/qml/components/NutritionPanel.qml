// Tableau nutritionnel — 8 nutriments en ordre réglementaire UE 1169/2011,
// avec N colonnes de valeurs (Pour 100 g, Par portion, Recette entière, …).
//
// API :
//   NutritionPanel {
//       columnTitles:    ["Pour 100 g", "Par portion", "Recette entière"]
//       columnSubtitles: ["",            "≈ 281 g cuit", "561 g cuit"]   // optionnel
//       columnData:      [page.nutritionPer100g, page.nutritionPerPortion, page.nutritionTotal]
//   }
//
// Chaque dict de `columnData` suit la forme retournée par
// `recipeEditorVM.nutritionTotalAsDict()` : {kcal, proteins, carbs, sugars,
// fats, saturatedFats, fiber, salt}.
//
// Ordre des lignes UE :
//   Énergie → Lipides → dont saturés → Glucides → dont sucres → Fibres
//   → Protéines → Sel
//
// Les sous-lignes "dont saturés" et "dont sucres" sont en gris italique pour
// rester cohérent avec le formulaire ingrédient (NutrientLabel `subline`).
//
// Alignement : la cellule entête ET la cellule valeur partagent la MÊME
// structure `[stretch][text][unit-slot-de-largeur-fixe]`. Comme le slot
// d'unité a la même largeur dans les deux, le bord droit du titre coïncide
// avec le bord droit du nombre — pas de décalage visuel quel que soit
// le libellé d'unité de la ligne (kcal, g, …).

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import App

Rectangle {
    id: root

    property string title: ""
    property var columnTitles: []
    property var columnSubtitles: []   // optionnel — taille = celle de columnTitles ou vide
    property var columnData: []        // liste de dicts (un par colonne)

    // Largeur fixe d'une colonne de valeurs — utile pour aligner les chiffres
    // à droite à la verticale entre les lignes.
    property int valueColumnWidth: 110
    // Largeur fixe du slot d'unité. Calé sur la plus longue unité ("kcal")
    // pour garantir que le bord droit du nombre coïncide entre les lignes
    // (la ligne kcal a une unité plus large que les g des autres lignes).
    property int unitSlotWidth: 30
    // Mode "alignement avec un autre tableau" (typiquement la grille jour du
    // calendrier) : largeur de la zone label/icône fixée, colonnes valeurs en
    // `Layout.fillWidth: true` pour épouser une grille externe partageant la
    // même largeur disponible. `labelColumnWidth=0` → comportement historique
    // (zone label élastique avec un minimumWidth de 160).
    property int labelColumnWidth: 0
    property bool useFlexibleColumns: false
    // Espacement entre colonnes valeurs. Doit être identique à celui de la
    // grille externe avec laquelle on veut s'aligner ; sinon les centres des
    // colonnes drift au fil des cellules. Pour le calendrier (`Theme.spaceXs`).
    property int cellSpacing: Theme.spaceMd
    // Mode "centré" : titre et valeur centrés dans leur cellule (pour
    // s'aligner sous des entêtes centrés type calendrier). Sinon : titre
    // aligné à droite + slot d'unité réservé à droite (page Recettes).
    property bool centerCells: false
    // Taille du picto à gauche du libellé. Réduit (18 px) pour le calendrier
    // qui partage 130 px avec la grille — on a besoin de la place pour le
    // texte du nutriment.
    property int iconSize: 22

    color: Theme.colorSurface
    radius: Theme.radiusMd
    border.width: 1
    border.color: Theme.colorBorder
    implicitHeight: column.implicitHeight + Theme.spaceMd * 2
    implicitWidth: 280 + valueColumnWidth * Math.max(1, columnTitles.length)

    // Définition des 8 lignes nutriments. `key` correspond à la clé dans
    // `columnData[i]` ; `decimals` cadre le formatage ; `unit` est affiché
    // après chaque valeur ; `subline` grise + italique le libellé.
    readonly property var _rows: [
        { key: "kcal",          label: "Énergie",       type: "energy",        unit: "kcal", decimals: 0, subline: false },
        { key: "fats",          label: "Lipides",       type: "fats",          unit: "g",    decimals: 1, subline: false },
        { key: "saturatedFats", label: "dont saturés",  type: "saturatedFats", unit: "g",    decimals: 1, subline: true  },
        { key: "carbs",         label: "Glucides",      type: "carbs",         unit: "g",    decimals: 1, subline: false },
        { key: "sugars",        label: "dont sucres",   type: "sugars",        unit: "g",    decimals: 1, subline: true  },
        { key: "fiber",         label: "Fibres",        type: "fiber",         unit: "g",    decimals: 1, subline: false },
        { key: "proteins",      label: "Protéines",     type: "proteins",      unit: "g",    decimals: 1, subline: false },
        { key: "salt",          label: "Sel",           type: "salt",          unit: "g",    decimals: 2, subline: false }
    ]

    function _fmt(value, decimals) {
        if (value === undefined || value === null) return "—"
        return Number(value).toLocaleString(Qt.locale(), 'f', decimals)
    }

    ColumnLayout {
        id: column
        anchors.fill: parent
        anchors.margins: Theme.spaceMd
        spacing: 4

        Text {
            text: root.title
            color: Theme.colorTextSecondary
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeSm
            font.weight: Theme.fontWeightMedium
            visible: text !== ""
            Layout.bottomMargin: 4
        }

        // --- Ligne d'entête : titre + sous-titre optionnel ---
        // Chaque cellule est un `Item` (vrai conteneur, pas un RowLayout) qui
        // se redimensionne via Layout.fillWidth. À l'intérieur, un Column est
        // ancré (centerHorizontalCenter ou anchors.right) selon le mode.
        // Approche plus simple et plus fiable que des stretches dynamiques
        // dans un RowLayout avec items `visible:` toggle.
        RowLayout {
            Layout.fillWidth: true
            spacing: root.cellSpacing
            Item {
                Layout.preferredWidth: root.labelColumnWidth > 0
                                       ? root.labelColumnWidth : -1
                Layout.fillWidth: root.labelColumnWidth <= 0
                Layout.minimumWidth: root.labelColumnWidth > 0 ? 0 : 160
            }
            Repeater {
                model: root.columnTitles
                delegate: Item {
                    property string titleText: modelData
                    property string subtitleText: index < root.columnSubtitles.length
                                                  ? root.columnSubtitles[index] : ""
                    Layout.preferredWidth: root.useFlexibleColumns
                                           ? -1 : root.valueColumnWidth
                    Layout.fillWidth: root.useFlexibleColumns
                    implicitHeight: headerColumn.implicitHeight

                    Column {
                        id: headerColumn
                        spacing: 0
                        // Mode centré : ancré au centre horizontal. Mode
                        // bord-droit : ancré au bord droit MOINS le slot
                        // d'unité (pour aligner avec le bord du nombre).
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.horizontalCenter: root.centerCells
                                                  ? parent.horizontalCenter
                                                  : undefined
                        anchors.right: root.centerCells
                                       ? undefined : parent.right
                        anchors.rightMargin: root.centerCells ? 0 : root.unitSlotWidth

                        Text {
                            anchors.right: root.centerCells ? undefined : parent.right
                            anchors.horizontalCenter: root.centerCells
                                                      ? parent.horizontalCenter
                                                      : undefined
                            text: parent.parent.titleText
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXs
                            font.weight: Theme.fontWeightMedium
                            horizontalAlignment: root.centerCells
                                                 ? Text.AlignHCenter : Text.AlignRight
                        }
                        Text {
                            anchors.right: root.centerCells ? undefined : parent.right
                            anchors.horizontalCenter: root.centerCells
                                                      ? parent.horizontalCenter
                                                      : undefined
                            text: parent.parent.subtitleText
                            visible: text !== ""
                            color: Theme.colorTextSecondary
                            font.family: Theme.fontFamily
                            font.pixelSize: Theme.fontSizeXs
                            font.italic: true
                            opacity: 0.85
                            horizontalAlignment: root.centerCells
                                                 ? Text.AlignHCenter : Text.AlignRight
                        }
                    }
                }
            }
        }

        // Séparateur fin sous les titres
        Rectangle {
            Layout.fillWidth: true
            Layout.preferredHeight: 1
            color: Theme.colorBorder
            opacity: 0.6
        }

        // --- 8 lignes nutriments ---
        Repeater {
            model: root._rows
            delegate: RowLayout {
                id: nutrientRow
                // Capture la définition de ligne sous un nom stable, pour que
                // les Repeaters imbriqués (colonnes de valeurs) puissent y
                // accéder sans dépendre du chemin parent.parent.
                property var rowDef: modelData
                Layout.fillWidth: true
                spacing: root.cellSpacing

                // Libellé + picto à gauche (mêmes conventions que NutrientLabel
                // sur la page Ingrédients : libellé puis picto, calé à droite).
                RowLayout {
                    Layout.preferredWidth: root.labelColumnWidth > 0
                                           ? root.labelColumnWidth : -1
                    Layout.fillWidth: root.labelColumnWidth <= 0
                    Layout.minimumWidth: root.labelColumnWidth > 0 ? 0 : 160
                    spacing: 8

                    Item { Layout.fillWidth: true }

                    Text {
                        text: nutrientRow.rowDef.label
                        color: nutrientRow.rowDef.subline
                               ? Qt.alpha(Theme.colorTextSecondary, 0.85)
                               : Theme.colorText
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeMd
                        font.italic: nutrientRow.rowDef.subline
                    }

                    Image {
                        Layout.preferredWidth: root.iconSize
                        Layout.preferredHeight: root.iconSize
                        source: "icons/nutrient/" + nutrientRow.rowDef.type + ".png"
                        sourceSize.width: root.iconSize * 2
                        sourceSize.height: root.iconSize * 2
                        fillMode: Image.PreserveAspectFit
                        smooth: true
                    }
                }

                // N colonnes de valeurs. Structure identique à l'entête :
                // un `Item` cellule + un `Row` ancré (centerHorizontalCenter
                // ou rightAligned). Garantit que valeur et titre se calent
                // sur le même axe vertical.
                Repeater {
                    model: root.columnData
                    delegate: Item {
                        property var colData: modelData
                        Layout.preferredWidth: root.useFlexibleColumns
                                               ? -1 : root.valueColumnWidth
                        Layout.fillWidth: root.useFlexibleColumns
                        implicitHeight: valueRow.implicitHeight

                        Row {
                            id: valueRow
                            spacing: 4
                            anchors.verticalCenter: parent.verticalCenter
                            // Mode centré : centré dans la cellule. Mode
                            // bord-droit : ancré à droite avec un retrait du
                            // slot d'unité pour que les nombres s'alignent
                            // verticalement (le slot d'unité absorbe la
                            // différence de largeur "kcal" vs "g").
                            anchors.horizontalCenter: root.centerCells
                                                      ? parent.horizontalCenter
                                                      : undefined
                            anchors.right: root.centerCells ? undefined : parent.right
                            anchors.rightMargin: root.centerCells
                                                 ? 0
                                                 : (root.unitSlotWidth - valueUnit.implicitWidth - 4)

                            Text {
                                text: root._fmt(parent.parent.colData
                                                ? parent.parent.colData[nutrientRow.rowDef.key]
                                                : 0,
                                                nutrientRow.rowDef.decimals)
                                color: nutrientRow.rowDef.subline
                                       ? Qt.alpha(Theme.colorTextSecondary, 0.85)
                                       : Theme.colorText
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeMd
                                font.weight: nutrientRow.rowDef.subline
                                             ? Theme.fontWeightRegular
                                             : Theme.fontWeightSemiBold
                                font.italic: nutrientRow.rowDef.subline
                                anchors.verticalCenter: parent.verticalCenter
                            }
                            Text {
                                id: valueUnit
                                text: nutrientRow.rowDef.unit
                                color: Theme.colorTextSecondary
                                font.family: Theme.fontFamily
                                font.pixelSize: Theme.fontSizeXs
                                anchors.verticalCenter: parent.verticalCenter
                            }
                        }
                    }
                }
            }
        }
    }
}
