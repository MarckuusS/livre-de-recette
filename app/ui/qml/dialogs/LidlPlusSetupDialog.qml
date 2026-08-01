// Dialog de configuration de l'auto-fetch Lidl Plus (Plan v3, Phase 5).
//
// Vraie fenêtre système (Window) — détachable, non-modale. Workflow :
//
//   1. Affiche l'état actuel (lib installée ? credentials stockés ? activé ?)
//   2. Si pas connecté : champs email + refresh_token (l'utilisateur récupère
//      le token via la procédure documentée — captcha hors-app pour l'instant)
//   3. Bouton "Tester la connexion" → appelle syncNow et affiche le résultat
//   4. Toggle "Activer l'auto-fetch" + slider intervalle
//   5. Bouton "Désactiver et oublier les credentials" (sécurité)
//
// **EXPÉRIMENTAL** : un bandeau d'avertissement explique que la lib `lidl-plus`
// est testée principalement DE/AT/UK et que le support FR n'est pas garanti.

import QtQuick
import QtQuick.Window
import QtQuick.Controls
import QtQuick.Layouts
import App
import "../components"

Window {
    id: root

    title: "Lidl Plus — Auto-fetch des tickets (expérimental)"
    width: 720
    height: 780
    minimumWidth: 600
    minimumHeight: 580
    color: Theme.colorBackground
    flags: Qt.Dialog | Qt.WindowCloseButtonHint | Qt.WindowTitleHint
    modality: Qt.NonModal

    function openCentered(parentWindow) {
        if (parentWindow) {
            x = parentWindow.x + (parentWindow.width - width) / 2
            y = parentWindow.y + (parentWindow.height - height) / 2
        }
        // Reset des champs d'auth (on ne pré-remplit JAMAIS le password)
        emailField.text = lidlPlusVM ? lidlPlusVM.connectedEmail : ""
        tokenField.text = ""
        statusLine.text = ""
        show()
        raise()
    }

    Connections {
        target: lidlPlusVM
        function onError_emitted(msg) {
            statusLine.text = "✗ " + msg
            statusLine.color = Theme.colorError
        }
        function onSync_completed(nb, msg) {
            statusLine.text = (nb >= 0 ? "✓ " : "") + msg
            statusLine.color = nb >= 0 && lidlPlusVM.lastError === ""
                               ? Theme.colorSuccess
                               : Theme.colorWarning
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: Theme.spaceLg
        spacing: Theme.spaceMd

        // ---- Bandeau "expérimental" ----
        Rectangle {
            Layout.fillWidth: true
            color: Qt.alpha(Theme.colorWarning, 0.12)
            radius: Theme.radiusSm
            border.width: 1
            border.color: Theme.colorWarning
            implicitHeight: warnText.implicitHeight + Theme.spaceMd * 2

            Text {
                id: warnText
                anchors.fill: parent
                anchors.margins: Theme.spaceMd
                text: "⚠ Cette feature est <b>expérimentale</b>. La lib <code>lidl-plus</code> "
                    + "est testée principalement DE/AT/UK ; le support Lidl FR n'est pas "
                    + "garanti. En cas d'échec, tu peux toujours saisir tes tickets "
                    + "manuellement via l'import fichier (Phases 1-4)."
                color: Theme.colorText
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeSm
                wrapMode: Text.WordWrap
                textFormat: Text.RichText
            }
        }

        // ---- État global ----
        ColumnLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceXs

            Text {
                text: "État"
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeXs
                font.weight: Theme.fontWeightSemiBold
                font.letterSpacing: 0.5
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceMd

                Rectangle {
                    Layout.preferredWidth: 10; Layout.preferredHeight: 10
                    radius: 5
                    color: lidlPlusVM && lidlPlusVM.isAvailable ? Theme.colorSuccess : Theme.colorError
                }
                Text {
                    text: lidlPlusVM && lidlPlusVM.isAvailable
                          ? "Lib `lidl-plus` installée"
                          : "Lib `lidl-plus` non installée — `pip install -e \".[lidl]\"`"
                    color: Theme.colorText
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                    Layout.fillWidth: true
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceMd

                Rectangle {
                    Layout.preferredWidth: 10; Layout.preferredHeight: 10
                    radius: 5
                    color: lidlPlusVM && lidlPlusVM.isKeyringAvailable ? Theme.colorSuccess : Theme.colorWarning
                }
                Text {
                    text: lidlPlusVM && lidlPlusVM.isKeyringAvailable
                          ? "Module `keyring` disponible (stockage sécurisé OK)"
                          : "Module `keyring` non installé — credentials non persistables"
                    color: Theme.colorText
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                    Layout.fillWidth: true
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceMd

                Rectangle {
                    Layout.preferredWidth: 10; Layout.preferredHeight: 10
                    radius: 5
                    color: lidlPlusVM && lidlPlusVM.isConnected ? Theme.colorSuccess : Theme.colorTextSecondary
                }
                Text {
                    text: lidlPlusVM && lidlPlusVM.isConnected
                          ? "Connecté en tant que : " + lidlPlusVM.connectedEmail
                          : "Non connecté"
                    color: Theme.colorText
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                    Layout.fillWidth: true
                }
            }
        }

        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.colorBorder; opacity: 0.4 }

        // ---- Auth — saisie email + refresh_token ----
        ColumnLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceSm

            Text {
                text: "Authentification"
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeXs
                font.weight: Theme.fontWeightSemiBold
                font.letterSpacing: 0.5
            }

            // Bandeau "comment obtenir le token"
            Rectangle {
                Layout.fillWidth: true
                color: Qt.alpha(Theme.colorPrimary, 0.06)
                radius: Theme.radiusSm
                border.width: 1
                border.color: Qt.alpha(Theme.colorPrimary, 0.30)
                implicitHeight: helpCol.implicitHeight + Theme.spaceMd * 2

                ColumnLayout {
                    id: helpCol
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.leftMargin: Theme.spaceMd
                    anchors.rightMargin: Theme.spaceMd
                    spacing: 4

                    Text {
                        Layout.fillWidth: true
                        text: "<b>Comment obtenir le refresh_token</b> (à faire une fois) :"
                        color: Theme.colorText
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                        textFormat: Text.RichText
                    }
                    Text {
                        Layout.fillWidth: true
                        text: "1. Ouvre une invite de commande dans le dossier du projet.<br/>"
                            + "2. Lance la commande ci-dessous (remplace le numéro et le mot de passe) :"
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                        textFormat: Text.RichText
                        wrapMode: Text.WordWrap
                    }
                    // Commande copiable (sélection au clic)
                    TextEdit {
                        Layout.fillWidth: true
                        text: ".venv\\Scripts\\python.exe -m lidlplus -c FR -l fr -u \"+33XXXXXXXXX\" -p \"motDePasse\" --2fa email auth"
                        color: Theme.colorPrimary
                        font.family: "Consolas, Courier New, monospace"
                        font.pixelSize: Theme.fontSizeXs
                        readOnly: true
                        selectByMouse: true
                        wrapMode: TextEdit.Wrap
                    }
                    Text {
                        Layout.fillWidth: true
                        text: "3. Reçois un code 2FA par email, saisis-le. Le terminal affiche un long token.<br/>"
                            + "4. Copie-le ici dans le champ « Refresh token » + ton email, puis Enregistre.<br/>"
                            + "<br/>"
                            + "Le token est stocké dans le <b>Windows Credential Manager</b> via la lib <code>keyring</code> — jamais en clair sur disque."
                        color: Theme.colorTextSecondary
                        font.family: Theme.fontFamily
                        font.pixelSize: Theme.fontSizeXs
                        textFormat: Text.RichText
                        wrapMode: Text.WordWrap
                    }
                }
            }

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Text { text: "Email Lidl Plus"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs }
                AppTextField {
                    id: emailField
                    Layout.fillWidth: true
                    placeholderText: "ex : ton.email@example.fr"
                }
            }

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 2
                Text { text: "Refresh token (depuis lidl-plus CLI)"; color: Theme.colorTextSecondary; font.family: Theme.fontFamily; font.pixelSize: Theme.fontSizeXs }
                AppTextField {
                    id: tokenField
                    Layout.fillWidth: true
                    placeholderText: "Long token obtenu via la commande lidlplus auth ci-dessus"
                    echoMode: TextInput.Password
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceXs

                AppButton {
                    text: "💾 Enregistrer les credentials"
                    variant: "primary"
                    enabled: lidlPlusVM
                             && lidlPlusVM.isKeyringAvailable
                             && emailField.text.length > 3
                             && tokenField.text.length > 10
                    onClicked: {
                        const ok = lidlPlusVM.storeCredentials(emailField.text, tokenField.text)
                        if (ok) {
                            statusLine.text = "✓ Credentials enregistrés."
                            statusLine.color = Theme.colorSuccess
                            tokenField.text = ""    // on n'affiche plus le token
                        }
                    }
                }
                AppButton {
                    text: "🗑 Oublier les credentials"
                    variant: "danger"
                    visible: lidlPlusVM && lidlPlusVM.isConnected
                    onClicked: {
                        lidlPlusVM.purgeCredentials()
                        statusLine.text = "Credentials purgés."
                        statusLine.color = Theme.colorTextSecondary
                    }
                }
            }
        }

        Rectangle { Layout.fillWidth: true; Layout.preferredHeight: 1; color: Theme.colorBorder; opacity: 0.4 }

        // ---- Auto-fetch ----
        ColumnLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceSm

            Text {
                text: "Auto-fetch"
                color: Theme.colorTextSecondary
                font.family: Theme.fontFamily
                font.pixelSize: Theme.fontSizeXs
                font.weight: Theme.fontWeightSemiBold
                font.letterSpacing: 0.5
            }

            AppCheckBox {
                text: "Activer la synchronisation automatique"
                checked: lidlPlusVM && lidlPlusVM.enabled
                enabled: lidlPlusVM && lidlPlusVM.isAvailable && lidlPlusVM.isConnected
                onClicked: lidlPlusVM.setEnabled(checked)
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceMd
                Text {
                    text: "Intervalle"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                }
                AppSpinBox {
                    id: pollIntervalSpin
                    realFrom: 5; realTo: 1440; realStep: 5; decimals: 0
                    // Initialise une fois à l'apparition du dialog au lieu d'un
                    // binding bidirectionnel — sinon `setPollIntervalMinutes`
                    // notifie `pollIntervalMinutes` qui re-déclenche le binding
                    // et tombe dans une boucle.
                    Component.onCompleted: realValue = lidlPlusVM ? lidlPlusVM.pollIntervalMinutes : 60
                    onRealValueChanged: {
                        if (lidlPlusVM && realValue !== lidlPlusVM.pollIntervalMinutes) {
                            lidlPlusVM.setPollIntervalMinutes(realValue)
                        }
                    }
                }
                Text {
                    text: "minutes"
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeSm
                }
                Item { Layout.fillWidth: true }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: Theme.spaceXs
                AppButton {
                    text: lidlPlusVM && lidlPlusVM.isSyncing ? "⏳ Sync en cours…" : "🔄 Synchroniser maintenant"
                    variant: "secondary"
                    enabled: lidlPlusVM && lidlPlusVM.isAvailable && lidlPlusVM.isConnected && !lidlPlusVM.isSyncing
                    onClicked: lidlPlusVM.syncNow()
                }
                Text {
                    visible: lidlPlusVM
                    text: lidlPlusVM ? "Dernière sync : " + lidlPlusVM.lastFetchedHuman : ""
                    color: Theme.colorTextSecondary
                    font.family: Theme.fontFamily
                    font.pixelSize: Theme.fontSizeXs
                }
            }
        }

        // ---- Ligne de statut ----
        Text {
            id: statusLine
            Layout.fillWidth: true
            text: ""
            color: Theme.colorTextSecondary
            font.family: Theme.fontFamily
            font.pixelSize: Theme.fontSizeSm
            wrapMode: Text.WordWrap
        }

        Item { Layout.fillHeight: true }

        // ---- Footer ----
        RowLayout {
            Layout.fillWidth: true
            spacing: Theme.spaceSm
            Item { Layout.fillWidth: true }
            AppButton {
                text: "Fermer"
                variant: "secondary"
                onClicked: root.close()
            }
        }
    }
}
