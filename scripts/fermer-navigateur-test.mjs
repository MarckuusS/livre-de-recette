#!/usr/bin/env node
/**
 * Ferme les fenetres du navigateur de TEST restees ouvertes.
 *
 *     node scripts/fermer-navigateur-test.mjs "<chemin du profil>"
 *
 * POURQUOI. Chromium ne demarre qu'UNE instance par profil. Si une fenetre du
 * profil de test traine d'un lancement precedent, la commande suivante ne cree
 * pas de nouveau navigateur : elle demande a l'ancien d'ouvrir un onglet, puis
 * rend la main. Or c'est le navigateur, pas l'onglet, qui porte la prise de
 * debogage. L'ancienne instance n'a pas ete lancee avec
 * `--remote-debugging-port`, donc le pilotage se retrouve sans prise et
 * l'emulation telephone echoue sur "Not attached to an active page".
 *
 * `mobile-view.mjs` savait deja nommer cette cause et demandait de fermer les
 * fenetres a la main. C'est exactement le genre de geste que le lanceur doit
 * faire lui-meme : c'est la meme histoire que le port du serveur, tenu par un
 * lancement precedent, quelques lignes plus haut dans mobile.bat.
 *
 * ON NE FERME QUE LE PROFIL DE TEST. Le filtre porte sur `--user-data-dir`, qui
 * designe un dossier cree par ce projet sous %LOCALAPPDATA%\\Prandia. Les
 * fenetres de navigation ordinaires vivent dans un autre profil : elles ne
 * peuvent pas correspondre, et rien de ce qui est ouvert a cote ne se ferme.
 *
 * Le detour par PowerShell n'est pas un gout : Windows n'expose la ligne de
 * commande d'un processus qu'a travers WMI, et `tasklist` ne sait filtrer que
 * sur le nom. Node passe le script en un seul argument, ce qui evite les
 * echappements de guillemets d'un `.bat`.
 */

import { execFileSync } from 'node:child_process'

const profil = process.argv[2]
if (!profil) {
  console.error('[navigateur] Usage : node scripts/fermer-navigateur-test.mjs "<chemin du profil>"')
  process.exit(1)
}

/**
 * GARDE-FOU : on refuse un filtre qui attraperait trop large.
 *
 * Un chemin vide ou une racine ferait correspondre toutes les fenetres du
 * navigateur, y compris celles de l'utilisateur. Le profil de test vit sous
 * Prandia : on exige ce marqueur plutot que de faire confiance a l'appelant.
 */
if (!profil.toLowerCase().includes('prandia')) {
  console.error(`[navigateur] Refus : "${profil}" n'est pas un profil de test de ce projet.`)
  process.exit(1)
}

/*
 * LE CHEMIN PASSE PAR L'ENVIRONNEMENT, PAS PAR UN ARGUMENT.
 *
 * `powershell -Command "<script>" -args <valeur>` ne remplit pas `$args` : avec
 * `-Command`, tout ce qui suit est CONCATENE au script. La valeur atterrissait
 * donc a la fin du programme, ou `-args` etait lu comme une commande, et le
 * script echouait a chaque fois. Silencieusement, qui plus est, puisque le
 * `catch` ci-dessous traite l'echec comme non fatal.
 *
 * Une variable d'environnement traverse sans etre relue par personne, ce qui
 * regle du meme coup les espaces et le signe plus du chemin de ce depot.
 */
const script = `
$profil = $env:PRANDIA_PROFIL
$vises = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($profil.ToLower()) })
foreach ($p in $vises) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch {} }
Write-Output $vises.Count
`

let fermees = 0
try {
  const sortie = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, PRANDIA_PROFIL: profil },
  })
  fermees = Number(sortie.trim().split(/\r?\n/).pop()) || 0
} catch {
  // Pas de PowerShell, ou WMI indisponible : ce n'est pas fatal. Le lanceur
  // continue, et `mobile-view.mjs` dira quoi faire si l'emulation echoue.
  console.log('[navigateur] Verification impossible ; on continue.')
  process.exit(0)
}

console.log(
  fermees > 0
    ? `[navigateur] ${fermees} fenetre(s) de test d'un lancement precedent fermee(s).`
    : '[navigateur] Aucune fenetre de test a fermer.',
)
