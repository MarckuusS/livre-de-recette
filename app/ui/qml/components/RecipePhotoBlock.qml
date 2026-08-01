// Bloc photo de l'éditeur de recette (F6 + A2 + A7).
//
// Encapsule :
//   - La zone photo 300×200 avec son placeholder ("🍽 Aucune photo" /
//     "Photo introuvable" si fichier supprimé du disque, A2)
//   - Les boutons "Ajouter / Modifier la photo" et "Retirer la photo"
//   - Le FileDialog natif pour le picker d'image
//   - **Drag-and-drop** : zone réceptrice pour fichiers locaux (file://)
//     ET URLs distantes (http(s)://) — typiquement un drag depuis un
//     navigateur ou l'explorateur Windows.
//
// Inputs (set par le parent) :
//   - `photoUrl: string`  — file:// URL ou chaîne vide. Vient du parent qui
//                           lui-même la lit depuis `recipeEditorVM.photoUrl`.
//   - `selectedId: int`   — -1 = rien, -2 = nouvelle (non sauvée), >0 = recette persistée.
//                           Le bouton "Ajouter une photo" est désactivé tant que
//                           la recette n'est pas sauvée (besoin d'un id stable
//                           pour nommer le fichier sur disque).
//
// Émet :
//   - `photoSaved()` — la VM a accepté et persisté une nouvelle photo. Le
//                      parent peut afficher un toast de succès.

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Dialogs
import App

RowLayout {
    id: root

    property string photoUrl: ""
    property int selectedId: -1

    signal photoSaved()

    spacing: Theme.spaceMd

    Rectangle {
        id: photoBox
        Layout.preferredWidth: 300
        Layout.preferredHeight: 200
        radius: Theme.radiusMd
        color: Theme.colorSurface
        border.width: dropArea.containsDrag ? 2 : 1
        border.color: dropArea.containsDrag ? Theme.colorPrimary : Theme.colorBorder
        clip: true
        Behavior on border.color { ColorAnimation { duration: Theme.durationFast } }

        Image {
            id: recipePhoto
            anchors.fill: parent
            anchors.margins: 1
            source: root.photoUrl
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            cache: false
            visible: source != "" && status !== Image.Error
        }
        ColumnLayout {
            anchors.centerIn: parent
            visible: root.photoUrl === "" || recipePhoto.status === Image.Error
            spacing: Theme.spaceSm
            Text {
                Layout.alignment: Qt.AlignHCenter
                text: dropArea.containsDrag ? "📥" : "🍽"
                font.pixelSize: 48
                color: Theme.colorTextDisabled
            }
            Text {
                Layout.alignment: Qt.AlignHCenter
                text: dropArea.containsDrag
                      ? "Déposer ici"
                      : recipePhoto.status === Image.Error
                        ? "Photo introuvable"
                        : root.selectedId === -2
                          ? "Enregistre la recette d'abord"
                          : "Aucune photo"
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
            }
            Text {
                visible: !dropArea.containsDrag && root.photoUrl === ""
                         && root.selectedId > 0
                Layout.alignment: Qt.AlignHCenter
                text: "(ou glisse une image ici)"
                color: Theme.colorTextSecondary
                opacity: 0.7
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeXs
                font.italic: true
            }
        }

        // Halo bleu quand un drag-over est actif sur la zone — feedback
        // immédiat avant le drop.
        Rectangle {
            anchors.fill: parent
            visible: dropArea.containsDrag
            color: Qt.alpha(Theme.colorPrimary, 0.10)
            radius: Theme.radiusMd
        }

        DropArea {
            id: dropArea
            anchors.fill: parent
            // Désactivé si la recette n'est pas sauvée (besoin d'un id stable
            // pour nommer le fichier photo sur disque) — cohérent avec le
            // bouton "+ Ajouter une photo".
            enabled: root.selectedId > 0
            keys: ["text/uri-list", "text/plain"]

            onDropped: function(drop) {
                if (drop.hasUrls && drop.urls.length > 0) {
                    root._handleDroppedUrl(drop.urls[0].toString())
                    drop.acceptProposedAction()
                    return
                }
                // Fallback : certains navigateurs envoient l'URL en text/plain
                // (drag d'un lien plutôt qu'une image elle-même).
                if (drop.hasText) {
                    const txt = drop.text.trim()
                    if (txt) {
                        root._handleDroppedUrl(txt)
                        drop.acceptProposedAction()
                    }
                }
            }
        }
    }

    ColumnLayout {
        Layout.alignment: Qt.AlignTop
        spacing: Theme.spaceSm

        AppButton {
            text: root.photoUrl === "" ? "+ Ajouter une photo" : "Modifier la photo"
            variant: "secondary"
            enabled: root.selectedId > 0
            onClicked: photoFileDialog.open()
        }
        AppButton {
            text: "Retirer la photo"
            variant: "danger"
            visible: root.photoUrl !== ""
            onClicked: recipeEditorVM.removePhoto()
        }
        Text {
            visible: root.selectedId === -2
            Layout.maximumWidth: 220
            wrapMode: Text.WordWrap
            text: "Sauvegarde d'abord la recette pour pouvoir y attacher une photo."
            color: Theme.colorTextSecondary
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeXs
        }
    }

    FileDialog {
        id: photoFileDialog
        title: "Choisir une photo de recette"
        nameFilters: ["Images (*.png *.jpg *.jpeg *.webp *.gif *.bmp)"]
        fileMode: FileDialog.OpenFile
        onAccepted: {
            const ok = recipeEditorVM.setPhotoFromUrl(selectedFile.toString())
            if (ok) root.photoSaved()
        }
    }

    // Dispatcher du drag-drop : route vers `setPhotoFromUrl` (file://) ou
    // `setPhotoFromHttpUrl` (http(s)://) selon le schéma de l'URL droppée.
    function _handleDroppedUrl(url) {
        if (!url) return
        const lower = url.toLowerCase()
        if (lower.startsWith("file://")) {
            const ok = recipeEditorVM.setPhotoFromUrl(url)
            if (ok) root.photoSaved()
        } else if (lower.startsWith("http://") || lower.startsWith("https://")) {
            const ok = recipeEditorVM.setPhotoFromHttpUrl(url)
            if (ok) root.photoSaved()
        }
        // Sinon : URL non supportée (data:, ftp:, …) — on ne fait rien,
        // l'utilisateur verra que la photo n'a pas changé.
    }
}
