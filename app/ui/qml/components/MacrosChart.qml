// Donut chart des macros : Lipides / Glucides / Fibres / Protéines exprimés
// en proportion d'énergie (kcal). Centre du donut = total kcal au repos ;
// au survol d'un wedge, le centre montre le détail (libellé, grammes, %).
//
// La légende sous le donut a été supprimée : le tableau nutritionnel à
// gauche affiche déjà toutes les valeurs ; dupliquer ici n'aurait fait que
// gonfler la hauteur du panneau (qui doit rester ≤ hauteur du tableau).
//
// Conventions énergétiques (FAO Atwater) :
//     1 g lipide   = 9 kcal
//     1 g glucide  = 4 kcal
//     1 g fibre    = 2 kcal
//     1 g protéine = 4 kcal
//
// API :
//   MacrosChart {
//       Layout.preferredWidth: 320
//       nutritionData: page.nutritionPer100g
//       perLabel: "/ 100 g"
//   }

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import App

Rectangle {
    id: root

    property var nutritionData: ({})
    property string perLabel: "/ 100 g"

    color: Theme.colorSurface
    radius: Theme.radiusMd
    border.width: 1
    border.color: Theme.colorBorder
    implicitWidth: 280
    // Hauteur naturelle = titre + donut + marges. Volontairement compacte
    // (≤ tableau nutritionnel à gauche).
    implicitHeight: column.implicitHeight + Theme.spaceMd * 2

    // Palette nutriment officielle (méta produit). Les sept nutriments du
    // tableau UE + l'énergie. Pour les Fibres on nuance vers un vert plus
    // clair/lime — la valeur exacte de la méta (#4F8C40) est très proche de
    // Glucides (#509938) et rendrait deux wedges adjacents indistinguables.
    readonly property color colorEnergy:      "#F1B40E"
    readonly property color colorFats:        "#FDA406"
    readonly property color colorSatFats:     "#DA4A35"
    readonly property color colorCarbs:       "#509938"
    readonly property color colorSugars:      "#07A0AA"
    readonly property color colorFiber:       "#7CC04C"   // déclinaison lime de #4F8C40 pour contraster avec Glucides
    readonly property color colorProteins:    "#0B6BBB"
    readonly property color colorSalt:        "#7145A7"

    // --- Lecture des valeurs avec fallback 0 ---
    readonly property real fatsG:     nutritionData && nutritionData.fats     ? nutritionData.fats     : 0
    readonly property real carbsG:    nutritionData && nutritionData.carbs    ? nutritionData.carbs    : 0
    readonly property real fiberG:    nutritionData && nutritionData.fiber    ? nutritionData.fiber    : 0
    readonly property real proteinsG: nutritionData && nutritionData.proteins ? nutritionData.proteins : 0

    readonly property real kcalFats:     fatsG     * 9
    readonly property real kcalCarbs:    carbsG    * 4
    readonly property real kcalFiber:    fiberG    * 2
    readonly property real kcalProteins: proteinsG * 4
    // Total Atwater : somme des contributions énergétiques. Sert de base aux
    // pourcentages des wedges. Garantit que les segments somment à 100 %.
    readonly property real kcalAtwater: kcalFats + kcalCarbs + kcalFiber + kcalProteins

    // --- État de survol ---
    // -1 = aucun wedge survolé (centre = total). 0..3 = wedge actif (centre
    // = détail du nutriment). Mis à jour par la MouseArea + hit-test radial.
    property int hoveredIndex: -1

    // Description des 4 wedges. Calculés en lecture, non mutés ; permet à la
    // MouseArea ET au paint Canvas de partager exactement la même définition.
    readonly property var _wedges: [
        { label: "Lipides",   grams: fatsG,     decimals: 1, kcal: kcalFats,     color: colorFats },
        { label: "Glucides",  grams: carbsG,    decimals: 1, kcal: kcalCarbs,    color: colorCarbs },
        { label: "Fibres",    grams: fiberG,    decimals: 1, kcal: kcalFiber,    color: colorFiber },
        { label: "Protéines", grams: proteinsG, decimals: 1, kcal: kcalProteins, color: colorProteins }
    ]

    function _pct(part) {
        return root.kcalAtwater > 0 ? (part / root.kcalAtwater * 100) : 0
    }

    onFatsGChanged:        donut.requestPaint()
    onCarbsGChanged:       donut.requestPaint()
    onFiberGChanged:       donut.requestPaint()
    onProteinsGChanged:    donut.requestPaint()
    onHoveredIndexChanged: donut.requestPaint()

    ColumnLayout {
        id: column
        anchors.fill: parent
        anchors.margins: Theme.spaceMd
        spacing: Theme.spaceSm

        Text {
            text: "Composition macros"
            color: Theme.colorTextSecondary
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeSm
            font.weight: Theme.fontWeightMedium
        }

        // --- Donut Canvas + MouseArea ---
        // Carré centré dans son `Item` parent ; les deux ont la même taille
        // pour que la MouseArea couvre exactement la zone visible et que les
        // calculs hit-test (cx/cy/rayons) soient triviaux.
        Item {
            Layout.fillWidth: true
            Layout.preferredHeight: 220   // tient confortablement < tableau (8 lignes)

            Canvas {
                id: donut
                anchors.centerIn: parent
                width: Math.min(parent.width, parent.height)
                height: width

                Connections {
                    target: Theme
                    function onDarkModeChanged() { donut.requestPaint() }
                }

                onWidthChanged:  requestPaint()
                onHeightChanged: requestPaint()

                onPaint: {
                    const ctx = getContext("2d")
                    ctx.reset()

                    const cx = width / 2
                    const cy = height / 2
                    const outerR = Math.min(width, height) / 2 - 4
                    const innerR = outerR * 0.62

                    // Cas vide : anneau gris pour signifier "aucune donnée".
                    if (root.kcalAtwater <= 0) {
                        ctx.beginPath()
                        ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
                        ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true)
                        ctx.fillStyle = Qt.alpha(Theme.colorBorder, 0.35).toString()
                        ctx.fill()
                        ctx.fillStyle = Theme.colorTextSecondary.toString()
                        ctx.font = "italic 12px " + Theme.fontFamily
                        ctx.textAlign = "center"
                        ctx.textBaseline = "middle"
                        ctx.fillText("aucune donnée", cx, cy)
                        return
                    }

                    // Démarre à -90° (pointe sur 12 h) — convention donut.
                    let startAngle = -Math.PI / 2
                    for (let i = 0; i < root._wedges.length; ++i) {
                        const w = root._wedges[i]
                        if (w.kcal <= 0) continue
                        const sweep = (w.kcal / root.kcalAtwater) * Math.PI * 2
                        const endAngle = startAngle + sweep

                        // Le wedge survolé est légèrement extrudé vers
                        // l'extérieur pour donner un feedback visuel net.
                        const isHover = (root.hoveredIndex === i)
                        const ro = isHover ? outerR + 4 : outerR
                        const ri = innerR
                        ctx.beginPath()
                        ctx.arc(cx, cy, ro, startAngle, endAngle)
                        ctx.arc(cx, cy, ri, endAngle, startAngle, true)
                        ctx.closePath()
                        ctx.fillStyle = w.color.toString()
                        ctx.fill()
                        startAngle = endAngle
                    }

                    // Texte central : par défaut le total kcal ; au survol,
                    // le détail du wedge actif (libellé + grammes + %).
                    ctx.textAlign = "center"
                    ctx.textBaseline = "middle"

                    const hovered = root.hoveredIndex >= 0
                                    && root.hoveredIndex < root._wedges.length
                                    ? root._wedges[root.hoveredIndex] : null
                    if (hovered) {
                        ctx.fillStyle = hovered.color.toString()
                        ctx.font = "bold 14px " + Theme.fontFamily
                        ctx.fillText(hovered.label, cx, cy - 18)

                        ctx.fillStyle = Theme.colorText.toString()
                        ctx.font = "bold 18px " + Theme.fontFamily
                        ctx.fillText(
                            Number(hovered.grams).toLocaleString(
                                Qt.locale(), 'f', hovered.decimals) + " g",
                            cx, cy + 4)

                        ctx.fillStyle = Theme.colorTextSecondary.toString()
                        ctx.font = "11px " + Theme.fontFamily
                        ctx.fillText(
                            Math.round(hovered.kcal) + " kcal · "
                            + Number(root._pct(hovered.kcal)).toLocaleString(
                                  Qt.locale(), 'f', 0) + " %",
                            cx, cy + 22)
                    } else {
                        ctx.fillStyle = Theme.colorText.toString()
                        ctx.font = "bold 22px " + Theme.fontFamily
                        ctx.fillText(Math.round(root.kcalAtwater) + " kcal", cx, cy - 6)

                        ctx.font = "11px " + Theme.fontFamily
                        ctx.fillStyle = Theme.colorTextSecondary.toString()
                        ctx.fillText(root.perLabel, cx, cy + 14)
                    }
                }

                // Hit-test radial : un wedge est sous le curseur ssi le
                // curseur est dans la couronne [innerR, outerR+hoverPad] ET
                // son angle (depuis le centre) tombe dans l'intervalle
                // angulaire alloué à ce wedge. Stateless : recalculé à chaque
                // mouvement, pas de dépendance à un index pré-stocké.
                MouseArea {
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: root.kcalAtwater > 0
                                 ? Qt.PointingHandCursor : Qt.ArrowCursor
                    onPositionChanged: function(mouse) {
                        if (root.kcalAtwater <= 0) {
                            root.hoveredIndex = -1
                            return
                        }
                        const cx = parent.width / 2
                        const cy = parent.height / 2
                        const dx = mouse.x - cx
                        const dy = mouse.y - cy
                        const dist = Math.sqrt(dx * dx + dy * dy)
                        const outerR = Math.min(parent.width, parent.height) / 2 - 4
                        const innerR = outerR * 0.62
                        // +6 px pour matcher la zone d'extrusion du wedge
                        // survolé — l'utilisateur peut continuer à survoler
                        // un wedge déjà extrudé sans qu'il "saute".
                        if (dist < innerR || dist > outerR + 6) {
                            root.hoveredIndex = -1
                            return
                        }
                        // Angle dans [-π, π], normalisé pour démarrer à -π/2
                        // (top, comme le tracé du donut) puis ramené dans [0, 2π).
                        let ang = Math.atan2(dy, dx) + Math.PI / 2
                        if (ang < 0) ang += Math.PI * 2
                        let acc = 0
                        for (let i = 0; i < root._wedges.length; ++i) {
                            const w = root._wedges[i]
                            if (w.kcal <= 0) continue
                            const sweep = (w.kcal / root.kcalAtwater) * Math.PI * 2
                            if (ang >= acc && ang < acc + sweep) {
                                root.hoveredIndex = i
                                return
                            }
                            acc += sweep
                        }
                        root.hoveredIndex = -1
                    }
                    onExited: root.hoveredIndex = -1
                }
            }
        }
    }
}
