// Confirmation modale réutilisable. Deux modes selon `mode` :
//
//   "save"     → 3 boutons : Annuler / Sauver / Abandonner — pour les modifs
//                non sauvées d'un éditeur (recette, ingrédient, …).
//                Émet `cancelled()` / `saveRequested()` / `discarded()`.
//
//   "destroy"  → 2 boutons : Annuler / Confirmer (rouge) — pour les opérations
//                destructives (suppression d'un stock du frigo, suppression d'une
//                recette définitive).
//                Émet `cancelled()` / `confirmed()`.
//
// Usage typique :
//
//   AppConfirmDialog {
//       id: confirm
//       mode: "save"
//       title: "Modifications non sauvées"
//       message: "La recette « Chili » a des modifications. Veux-tu les sauver avant ?"
//       onSaveRequested: { recipeEditorVM.saveCurrent(); page._loadIngredient(pendingId) }
//       onDiscarded:     page._loadIngredient(pendingId)
//   }
//   ...
//   confirm.openWith({ pendingId: 42 })
//
// L'objet passé à `openWith()` est stocké dans `payload` et accessible dans les
// handlers — utile pour mémoriser ce qu'il faut faire après la décision.

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import App

AppDialog {
    id: root

    // ---- API publique ----
    property string mode: "save"            // "save" | "destroy"
    property string message: ""
    property string saveLabel: "Enregistrer"
    property string discardLabel: "Abandonner"
    property string confirmLabel: "Supprimer"
    property string cancelLabel: "Annuler"
    property var payload: ({})              // contexte arbitraire mémorisé entre open et émission

    signal cancelled()
    signal saveRequested()
    signal discarded()
    signal confirmed()

    function openWith(p) {
        payload = p || {}
        open()
    }

    // ---- Layout ----
    width: 480
    closePolicy: Popup.CloseOnEscape  // Esc = annuler

    onClosed: {
        // Ne rien émettre ici — les boutons ont déjà émis leur signal et fermé.
        // `Esc` ferme sans signal (l'utilisateur peut le rouvrir).
    }

    contentItem: ColumnLayout {
        spacing: Theme.spaceMd
        anchors.margins: Theme.spaceLg

        Text {
            Layout.fillWidth: true
            text: root.message
            color: Theme.colorText
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeMd
            wrapMode: Text.WordWrap
        }
    }

    footer: RowLayout {
        spacing: Theme.spaceSm
        Item { Layout.preferredWidth: Theme.spaceMd }   // gauche

        AppButton {
            text: root.cancelLabel
            variant: "secondary"
            onClicked: { root.cancelled(); root.close() }
        }

        Item { Layout.fillWidth: true }   // pousse les actions à droite

        // Mode "save" : Abandonner (ghost rouge) puis Enregistrer (primary)
        AppButton {
            visible: root.mode === "save"
            text: root.discardLabel
            variant: "danger"
            onClicked: { root.discarded(); root.close() }
        }
        AppButton {
            visible: root.mode === "save"
            text: root.saveLabel
            variant: "primary"
            onClicked: { root.saveRequested(); root.close() }
        }

        // Mode "destroy" : un seul bouton rouge "Supprimer"
        AppButton {
            visible: root.mode === "destroy"
            text: root.confirmLabel
            variant: "danger"
            onClicked: { root.confirmed(); root.close() }
        }

        Item { Layout.preferredWidth: Theme.spaceMd }   // droite
    }
}
