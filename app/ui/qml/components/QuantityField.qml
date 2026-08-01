// Champ quantité = spinbox + combobox d'unité. Stockage interne en grammes ;
// l'utilisateur saisit dans l'unité de son choix.
//
// API publique :
//   property real grams         : valeur courante en grammes (source de vérité)
//   property real pieceWeightG  : 0 = pas d'unité pièce ; > 0 = ajoute "pièce (Xg)"
//                                 en tête de combobox, conversion via ce facteur.
//   signal gramsEdited(real)    : émis quand l'utilisateur tape dans le spin
//                                 (pas au changement d'unité — la valeur en
//                                 grammes est stable lors d'un switch d'unité).
//
// Logique piece-aware : voir CLAUDE.md > Shared widgets > QuantityField. Quand
// pieceWeightG passe de 0 à 60, on ajoute "pièce (60 g)" en tête et on bascule
// dessus en préservant la valeur en grammes ("100 g" → "1.67 pièces"). Quand on
// remet à 0, l'entrée disparaît et le widget retombe sur la dernière unité
// statique (ou "g" par défaut) en préservant les grammes.

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import App

RowLayout {
    id: root

    // ---- API publique ----
    property real grams: 0.0
    property real pieceWeightG: 0
    property int decimals: 1
    property real maxGrams: 1000000.0
    // Refonte UX : unité préférée par l'utilisateur ("g", "ml", "_piece"…).
    // Si renseignée, on cherche cet index dans la liste d'unités au reload
    // au lieu de l'heuristique "_piece si pieceWeightG > 0" qui écrase le choix.
    // "" = pas de préférence, on retombe sur l'heuristique historique.
    property string preferredUnit: ""

    signal gramsEdited(real grams)
    // Émis quand l'utilisateur change l'unité dans la combobox. Le parent
    // peut stocker cette valeur (ex: dans un buffer d'édition de recette)
    // pour la persister.
    signal unitChanged(string unitCode)

    spacing: Theme.spaceXs

    // ---- Tableau d'unités statiques (mirror exact de app/domain/units.py) ----
    readonly property var staticUnits: [
        { code: "g",       label: "g",          factor: 1.0 },
        { code: "kg",      label: "kg",         factor: 1000.0 },
        { code: "mg",      label: "mg",         factor: 0.001 },
        { code: "ml",      label: "ml",         factor: 1.0 },
        { code: "cl",      label: "cl",         factor: 10.0 },
        { code: "dl",      label: "dl",         factor: 100.0 },
        { code: "L",       label: "L",          factor: 1000.0 },
        { code: "c_cafe",  label: "c. à café",  factor: 5.0 },
        { code: "c_soupe", label: "c. à soupe", factor: 15.0 },
        { code: "tasse",   label: "tasse",      factor: 250.0 },
        { code: "pincee",  label: "pincée",     factor: 1.0 }
    ]

    // ---- Liste effective d'unités (pièce + statiques si pieceWeightG > 0) ----
    property var units: _buildUnits(pieceWeightG)

    function _buildUnits(pw) {
        if (pw && pw > 0) {
            return [{ code: "_piece", label: "pièce (" + _formatG(pw) + ")", factor: pw }]
                .concat(staticUnits)
        }
        return staticUnits
    }

    function _formatG(g) {
        return Math.abs(g - Math.round(g)) < 1e-6
            ? Math.round(g) + " g"
            : g.toFixed(1).replace(".", ",") + " g"
    }

    // ---- Index courant dans `units` ----
    property int unitIndex: 0   // par défaut "g"
    property bool _suppressEdit: false

    function _currentFactor() {
        return units[unitIndex] ? units[unitIndex].factor : 1.0
    }

    function _findUnitIndex(code) {
        if (!code) return -1
        for (let i = 0; i < units.length; i++) {
            if (units[i].code === code) return i
        }
        return -1
    }

    // Restitue l'unité préférée si possible (refonte UX). À appeler quand
    // `preferredUnit` change ou quand `units` est rebuilt.
    function _applyPreferredUnit() {
        if (!preferredUnit) return
        const idx = _findUnitIndex(preferredUnit)
        if (idx >= 0 && idx !== unitIndex) {
            unitIndex = idx
        }
    }

    // ---- Sync programmatique : grammes -> spin ----
    function _refreshSpinFromGrams() {
        _suppressEdit = true
        spin.realValue = root.grams / _currentFactor()
        _suppressEdit = false
    }

    Component.onCompleted: {
        _applyPreferredUnit()
        _refreshSpinFromGrams()
    }

    // Si le parent change la préférence (ex: au reload d'une recette qui
    // expose `unit`), on bascule sur cette unité.
    onPreferredUnitChanged: {
        _applyPreferredUnit()
        _refreshSpinFromGrams()
    }

    // ---- Réagir aux changements de pieceWeightG (set_piece_weight côté QtWidgets) ----
    onPieceWeightGChanged: {
        const oldGrams = root.grams
        const wasOnPiece = (units[unitIndex] && units[unitIndex].code === "_piece")
        const newUnits = _buildUnits(pieceWeightG)
        units = newUnits

        // Refonte UX : `preferredUnit` du parent prime sur l'heuristique
        // historique (qui forçait "_piece" si pieceWeightG > 0). Sans ça,
        // un reload de recette écraserait le choix saisi par l'utilisateur.
        if (preferredUnit && _findUnitIndex(preferredUnit) >= 0) {
            unitIndex = _findUnitIndex(preferredUnit)
        } else if (pieceWeightG > 0) {
            unitIndex = 0  // "_piece" est toujours en index 0 quand présent
        } else if (wasOnPiece) {
            unitIndex = 0  // "g" est l'index 0 quand pas de pièce
        }
        // Préserve la valeur en grammes, met à jour le spin
        root.grams = oldGrams
        _refreshSpinFromGrams()
    }

    // ---- Quand la valeur en grammes change EXTÉRIEUREMENT (binding parent),
    //      on rafraîchit le spin sans réémettre gramsEdited. ----
    onGramsChanged: {
        if (_suppressEdit) return
        // Recompute display only if the spin value is out of sync with grams.
        const expected = root.grams / _currentFactor()
        if (Math.abs(spin.realValue - expected) > 1e-6)
            _refreshSpinFromGrams()
    }

    // ---- Le spin ----
    AppSpinBox {
        id: spin
        Layout.fillWidth: true
        decimals: root.decimals
        realFrom: 0
        realTo: root.maxGrams * 1000   // amplement suffisant en pièces ou kg
        realStep: 1.0

        onRealValueChanged: {
            if (root._suppressEdit) return
            const newGrams = realValue * root._currentFactor()
            if (Math.abs(newGrams - root.grams) > 1e-9) {
                root._suppressEdit = true
                root.grams = newGrams
                root._suppressEdit = false
                root.gramsEdited(newGrams)
            }
        }
    }

    // ---- La combobox d'unités ----
    AppComboBox {
        id: unitCombo
        Layout.preferredWidth: 110
        model: root.units.map(function(u) { return u.label })
        currentIndex: root.unitIndex

        onActivated: function(index) {
            // Switch d'unité : on préserve les grammes, on met à jour l'affichage.
            root.unitIndex = index
            root._refreshSpinFromGrams()
            // Émet le code d'unité pour que le parent puisse persister le choix
            // (refonte UX : RecipesPage stocke ça dans le buffer d'édition).
            const code = root.units[index] ? root.units[index].code : ""
            root.unitChanged(code)
        }
    }
}
