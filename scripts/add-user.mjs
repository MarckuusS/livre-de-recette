#!/usr/bin/env node
/**
 * Cree un compte, ou change le mot de passe d'un compte existant.
 *
 *     node scripts/add-user.mjs marius "Marius"
 *
 * Le mot de passe est demande de facon interactive et ne quitte JAMAIS cette
 * machine : le script calcule l'empreinte en local et n'affiche que le SQL a
 * executer. Rien ne transite par le reseau, rien n'apparait dans un historique
 * de commandes.
 *
 * Le hachage est volontairement identique a celui du Worker (PBKDF2-SHA256,
 * 210 000 iterations, sel de 16 octets). Node et les Workers exposent tous
 * deux WebCrypto : le meme calcul donne le meme resultat des deux cotes, sinon
 * un compte cree ici ne pourrait pas se connecter en production.
 */

import { stdin, stdout } from 'node:process'

const ITERATIONS = 210_000
const MIN_LENGTH = 10

const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  return { hash: toHex(bits), salt: toHex(salt), iterations: ITERATIONS }
}

// ---------------------------------------------------------------------------
// Saisie masquee
// ---------------------------------------------------------------------------
//
// Lecture directe des touches, sans `readline`. Deux raisons, toutes deux
// constatees a l'usage :
//
//   - readline ne masque pas de facon fiable — cela repose sur
//     `_writeToOutput`, une API privee dont le comportement varie ;
//   - enchainer deux questions laissait l'entree standard dans un etat ou
//     plus rien n'arrivait, et la seconde promesse ne se resolvait jamais.
//
// Ici le tampon est gere explicitement : rien n'est jamais reecrit a l'ecran.

const KEY_ENTER = '\r'
const KEY_NEWLINE = '\n'
const KEY_CTRL_C = ''
const KEY_CTRL_D = ''
const KEY_BACKSPACE = ''
const KEY_BACKSPACE_ALT = '\b'
const KEY_ESCAPE = ''

/** Toutes les lignes d'un coup quand l'entree n'est pas un terminal. */
async function readAllPipedLines() {
  const chunks = []
  for await (const chunk of stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/)
}

const pipedLines = stdin.isTTY ? null : await readAllPipedLines()
let pipedIndex = 0

function askHidden(question) {
  stdout.write(question)

  // Hors terminal (pipe, redirection, CI) : aucun ecran a proteger, et
  // setRawMode n'existe pas sur un flux qui n'est pas un TTY.
  if (!stdin.isTTY) {
    const line = pipedLines?.[pipedIndex++] ?? ''
    stdout.write('\n')
    return Promise.resolve(line)
  }

  return new Promise((resolve) => {
    let buffer = ''

    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    const finish = (value) => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', onKey)
      stdout.write('\n')
      resolve(value)
    }

    const onKey = (key) => {
      if (key === KEY_ENTER || key === KEY_NEWLINE || key === KEY_CTRL_D) {
        finish(buffer)
        return
      }
      if (key === KEY_CTRL_C) {
        // Remettre le terminal dans un etat utilisable avant de sortir :
        // sans cela, le shell reste en mode brut et n'affiche plus rien.
        stdin.setRawMode(false)
        stdout.write('\n')
        process.exit(130)
      }
      if (key === KEY_BACKSPACE || key === KEY_BACKSPACE_ALT) {
        buffer = buffer.slice(0, -1)
        return
      }
      // Ignore les sequences d'echappement (fleches, touches de fonction) :
      // elles commencent par ESC et n'ont rien a faire dans un mot de passe.
      if (key >= ' ' && !key.startsWith(KEY_ESCAPE)) buffer += key
    }

    stdin.on('data', onKey)
  })
}

// ---------------------------------------------------------------------------

const quit = (message) => {
  console.error(message)
  process.exit(1)
}

const sqlString = (v) => `'${String(v).replace(/'/g, "''")}'`

const [, , usernameRaw, displayNameRaw] = process.argv

if (!usernameRaw) {
  quit(`Usage : node scripts/add-user.mjs <identifiant> ["Nom affiché"]

  identifiant   ce qu'on tape pour se connecter (minuscules, sans espace)
  Nom affiché   ce qui apparaît dans le journal d'activité`)
}

const username = usernameRaw.trim().toLowerCase()
if (!/^[a-z0-9_-]{2,32}$/.test(username)) {
  quit("L'identifiant doit faire 2 à 32 caractères : lettres, chiffres, tiret, souligné.")
}
const displayName = (displayNameRaw ?? usernameRaw).trim()

if (stdin.isTTY) {
  stdout.write("\nLa saisie est masquée : rien ne s'affiche pendant que tu tapes, c'est normal.\n\n")
}

const password = await askHidden(`Mot de passe pour « ${username} » : `)

if (password.length < MIN_LENGTH) {
  // C'est le seul facteur d'authentification, sur une application joignable
  // publiquement : un mot de passe court n'a pas de sens ici.
  quit(`Trop court : ${password.length} caractère(s), il en faut au moins ${MIN_LENGTH}.`)
}

const confirmation = await askHidden('Confirme : ')
if (password !== confirmation) {
  quit('Les deux saisies diffèrent.')
}

const { hash, salt, iterations } = await hashPassword(password)

const sql =
  `INSERT INTO user (username, display_name, password_hash, password_salt, iterations) ` +
  `VALUES (${sqlString(username)}, ${sqlString(displayName)}, ${sqlString(hash)}, ${sqlString(salt)}, ${iterations}) ` +
  `ON CONFLICT(username) DO UPDATE SET ` +
  `display_name = excluded.display_name, password_hash = excluded.password_hash, ` +
  `password_salt = excluded.password_salt, iterations = excluded.iterations, is_active = 1;`

stdout.write(`
Compte « ${username} » (${displayName}) — prêt.
Le mot de passe n'apparaît nulle part ci-dessous : seule son empreinte est stockée.

Copie-colle cette commande :

npx wrangler d1 execute livre-de-recettes --remote --command "${sql.replace(/"/g, '\\"')}"

(remplace --remote par --local pour la base de développement)
`)
