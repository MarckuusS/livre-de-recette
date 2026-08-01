#!/usr/bin/env node
/**
 * Cree un compte, ou change le mot de passe d'un compte existant.
 *
 *     node scripts/add-user.mjs marius "Marius"
 *
 * Le mot de passe est demande de facon interactive, et ne quitte JAMAIS cette
 * machine : le script calcule le hachage en local et n'affiche que le SQL a
 * executer. Rien ne transite par le reseau, rien n'apparait dans un
 * historique de commandes.
 *
 * Le hachage est volontairement identique a celui du Worker (PBKDF2-SHA256,
 * 210 000 iterations, sel de 16 octets). Node et les Workers exposent tous
 * deux WebCrypto : le meme calcul donne le meme resultat des deux cotes, sinon
 * un compte cree ici ne pourrait pas se connecter en production.
 */

import { createInterface } from 'node:readline'
import { stdin, stdout } from 'node:process'

const ITERATIONS = 210_000

const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  )
  return { hash: toHex(bits), salt: toHex(salt), iterations: ITERATIONS }
}

/** Saisie masquee : le mot de passe ne doit pas rester lisible a l'ecran. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: true })
    const onData = (char) => {
      // Reecrit la ligne sans les caracteres tapes, a chaque frappe.
      if (!['\n', '\r', ''].includes(String(char))) {
        stdout.clearLine?.(0)
        stdout.cursorTo?.(0)
        stdout.write(question)
      }
    }
    stdin.on('data', onData)
    rl.question(question, (answer) => {
      stdin.removeListener('data', onData)
      rl.close()
      stdout.write('\n')
      resolve(answer)
    })
  })
}

const sqlString = (v) => `'${String(v).replace(/'/g, "''")}'`

const [, , usernameRaw, displayNameRaw] = process.argv

if (!usernameRaw) {
  console.error(`Usage : node scripts/add-user.mjs <identifiant> ["Nom affiché"]

  identifiant   ce qu'on tape pour se connecter (minuscules, sans espace)
  Nom affiché   ce qui apparaît dans le journal d'activité`)
  process.exit(1)
}

const username = usernameRaw.trim().toLowerCase()
if (!/^[a-z0-9_-]{2,32}$/.test(username)) {
  console.error("L'identifiant doit faire 2 à 32 caractères : lettres, chiffres, tiret, souligné.")
  process.exit(1)
}
const displayName = (displayNameRaw ?? usernameRaw).trim()

const password = await askHidden(`Mot de passe pour « ${username} » : `)
if (password.length < 10) {
  // C'est le seul facteur d'authentification, sur une application exposee
  // publiquement : un mot de passe court n'a pas de sens ici.
  console.error('Trop court : 10 caractères minimum.')
  process.exit(1)
}
const confirm = await askHidden('Confirme : ')
if (password !== confirm) {
  console.error('Les deux saisies diffèrent.')
  process.exit(1)
}

const { hash, salt, iterations } = await hashPassword(password)

const sql =
  `INSERT INTO user (username, display_name, password_hash, password_salt, iterations) ` +
  `VALUES (${sqlString(username)}, ${sqlString(displayName)}, ${sqlString(hash)}, ${sqlString(salt)}, ${iterations}) ` +
  `ON CONFLICT(username) DO UPDATE SET ` +
  `display_name = excluded.display_name, password_hash = excluded.password_hash, ` +
  `password_salt = excluded.password_salt, iterations = excluded.iterations, is_active = 1;`

console.log(`
Compte « ${username} » (${displayName}) — SQL prêt.
Le mot de passe n'apparaît nulle part ci-dessous : seul son empreinte est stockée.

  En local :
    npx wrangler d1 execute livre-de-recettes --local --command "${sql.replace(/"/g, '\\"')}"

  En production :
    npx wrangler d1 execute livre-de-recettes --remote --command "${sql.replace(/"/g, '\\"')}"
`)
