// SpinBox numérique avec décimales (équivalent QDoubleSpinBox stylé).
//
// Qt Quick SpinBox ne gère que des int : on passe par `from / to / stepSize`
// scalés et `valueFromText / textFromValue` pour exposer un `realValue` fractionnaire.

import QtQuick
import QtQuick.Controls
import App

SpinBox {
    id: root

    // ---- API publique en réels ----
    // Le signal `realValueChanged` est auto-généré par QML ; les consommateurs
    // peuvent écouter via `onRealValueChanged: ...`.
    property real realValue: 0.0
    property real realFrom: 0.0
    property real realTo: 1000000.0
    property real realStep: 1.0
    property int  decimals: 1
    // Si `true`, la valeur 0 s'affiche comme une cellule vide (équivalent
    // QSpinBox.setSpecialValueText("")) — utilisé par les champs macro pour
    // distinguer "non renseigné" de "0 g".
    property bool emptyOnZero: false

    // ---- Conversion réel ↔ entier interne ----
    readonly property int _factor: Math.pow(10, decimals)
    from: Math.round(realFrom * _factor)
    to:   Math.round(realTo * _factor)
    stepSize: Math.round(realStep * _factor)
    value: Math.round(realValue * _factor)

    onValueChanged: {
        const v = value / _factor
        if (Math.abs(v - realValue) > 1e-9)
            realValue = v
    }
    onRealValueChanged: {
        const target = Math.round(realValue * _factor)
        if (value !== target)
            value = target
    }

    editable: true
    implicitHeight: Theme.controlHeightMd
    implicitWidth: 120

    font.family: Theme.fontFamily
    font.pixelSize: Theme.fontSizeMd

    validator: DoubleValidator {
        bottom: root.realFrom
        top: root.realTo
        decimals: root.decimals
        notation: DoubleValidator.StandardNotation
        locale: "fr_FR"
    }

    textFromValue: function(value, locale) {
        if (root.emptyOnZero && value === 0)
            return ""
        return Number(value / root._factor).toLocaleString(locale, 'f', root.decimals)
    }
    valueFromText: function(text, locale) {
        const t = (text || "").trim()
        if (root.emptyOnZero && t === "")
            return 0
        return Math.round(Number.fromLocaleString(locale, t) * root._factor)
    }

    contentItem: TextInput {
        z: 2
        text: root.textFromValue(root.value, root.locale)
        font: root.font
        color: root.enabled ? Theme.colorText : Theme.colorTextDisabled
        selectionColor: Qt.alpha(Theme.colorPrimary, 0.35)
        selectedTextColor: Theme.colorText
        horizontalAlignment: Qt.AlignHCenter
        verticalAlignment: Qt.AlignVCenter
        readOnly: !root.editable
        validator: root.validator
        inputMethodHints: Qt.ImhFormattedNumbersOnly | Qt.ImhDigitsOnly
        selectByMouse: true
    }

    up.indicator: Rectangle {
        x: parent.width - width
        height: parent.height / 2
        implicitWidth: 24
        radius: 0
        color: root.up.pressed
               ? Theme.colorSurfacePressed
               : root.up.hovered
                 ? Theme.colorSurfaceHover
                 : Theme.colorTransparent

        Text {
            text: "+"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeMd
            font.weight: Theme.fontWeightSemiBold
            color: Theme.colorTextSecondary
            anchors.centerIn: parent
        }
    }

    down.indicator: Rectangle {
        x: parent.width - width
        y: parent.height / 2
        height: parent.height / 2
        implicitWidth: 24
        radius: 0
        color: root.down.pressed
               ? Theme.colorSurfacePressed
               : root.down.hovered
                 ? Theme.colorSurfaceHover
                 : Theme.colorTransparent

        Text {
            text: "−"
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeMd
            font.weight: Theme.fontWeightSemiBold
            color: Theme.colorTextSecondary
            anchors.centerIn: parent
        }
    }

    background: Rectangle {
        radius: Theme.radiusMd
        color: !root.enabled ? Theme.colorSurfaceHover : Theme.colorSurface
        border.width: 1
        border.color: !root.enabled
                      ? Theme.colorBorder
                      : root.activeFocus
                        ? Theme.colorBorderFocus
                        : root.hovered
                          ? Theme.colorBorderHover
                          : Theme.colorBorder
        Behavior on border.color {
            ColorAnimation { duration: Theme.durationFast }
        }
    }
}
