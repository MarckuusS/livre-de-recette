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
 * 100 000 iterations, sel de 16 octets). Node et les Workers exposent tous
 * deux WebCrypto : le meme calcul donne le meme resultat des deux cotes, sinon
 * un compte cree ici ne pourrait pas se connecter en production.
 */

import { spawn } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { stdin, stdout } from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Plafond impose par Cloudflare Workers : au-dela de 100 000, PBKDF2 leve
// « iteration counts above 100000 are not supported ». La limite n'est PAS
// appliquee par le runtime local, d'ou un compte qui marche en developpement
// et casse en production. Voir shared/src/password.ts.
const ITERATIONS = 100_000
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

/**
 * Execute la commande wrangler directement.
 *
 * Le SQL n'est PAS colle dans un terminal : il est passe en argument via
 * `spawn`, sans passer par un shell. C'est ce qui evite le probleme de
 * guillemets — la requete contient des apostrophes, la commande des
 * guillemets doubles, et selon le terminal le collage casse l'un ou l'autre.
 *
 * Le mot de passe ne part toujours pas sur le reseau : wrangler ne transmet
 * que l'empreinte, deja calculee ici.
 */
async function runWrangler(sql, target) {
  // Le SQL passe par un FICHIER, jamais par la ligne de commande.
  //
  // Un argument contenant apostrophes, espaces et parentheses se fait
  // reinterpreter par le shell — c'est precisement ce qui cassait le
  // copier-coller manuel, et `shell: true` reproduisait le probleme.
  const file = join(tmpdir(), `livre-user-${Date.now()}.sql`)
  await writeFile(file, sql, 'utf8')

  // On appelle l'entree JavaScript de wrangler avec le Node courant, plutot
  // que `npx`. Sur Windows npx est un script .cmd, que Node refuse de lancer
  // sans shell — et le shell est justement ce qu'on veut eviter.
  const wrangler = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js')

  try {
    return await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [wrangler, 'd1', 'execute', 'livre-de-recettes', target, '--file', file],
        { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      let output = ''
      child.stdout.on('data', (d) => (output += d))
      child.stderr.on('data', (d) => (output += d))
      child.on('close', (code) => resolve({ code, output }))
      child.on('error', (err) => resolve({ code: 1, output: String(err) }))
    })
  } finally {
    // Le fichier ne contient que l'empreinte, jamais le mot de passe — mais
    // il n'a aucune raison de trainer.
    await rm(file, { force: true })
  }
}

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--') && !a.includes('=')))
const options = new Map(
  args
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => {
      const at = a.indexOf('=')
      return [a.slice(2, at), a.slice(at + 1)]
    }),
)
const [usernameRaw, displayNameRaw] = args.filter((a) => !a.startsWith('--'))

if (!usernameRaw) {
  quit(`Usage : node scripts/add-user.mjs <identifiant> ["Nom affiché"] [options]

  identifiant        ce qu'on tape pour se connecter (minuscules, sans espace)
  Nom affiché        ce qui apparaît dans le journal d'activité

  --cuisine="Nom"    CREE une nouvelle cuisine et y place ce compte.
                     Sans cette option, le compte rejoint la cuisine n° 1 —
                     donc voit les mêmes recettes, le même frigo, les mêmes
                     prix. C'est ce qu'on veut pour un conjoint, jamais pour
                     un ami.
  --local            applique sur la base de développement
  --print            affiche seulement le SQL, sans rien appliquer

Exemples :
  node scripts/add-user.mjs marius "Marius"
      → rejoint la cuisine existante

  node scripts/add-user.mjs paul "Paul" --cuisine="Chez Paul"
      → nouvelle cuisine, données entièrement séparées`)
}

const newKitchen = options.get('cuisine')?.trim() ?? null
if (newKitchen !== null && newKitchen === '') {
  quit('--cuisine attend un nom : --cuisine="Chez Paul"')
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

/*
 * Une nouvelle cuisine part avec une COPIE du catalogue CIQUAL/OpenFoodFacts.
 *
 * Sans elle, le nouveau venu ouvre une application vide : plus aucun aliment a
 * chercher, et l'import ne servirait qu'a retelecharger ce que la base contient
 * deja. La copie repart a zero sur ce qui est intime — bibliotheque
 * personnelle, prix releves — et ne garde que les donnees de reference.
 *
 * Le sous-SELECT `MIN(id)` par (source, source_ref) evite de dupliquer une
 * fiche deja presente en plusieurs exemplaires, ce qui violerait l'unicite.
 */
const kitchenSql =
  newKitchen === null
    ? ''
    : `INSERT INTO household (name) VALUES (${sqlString(newKitchen)});
` +
      `INSERT INTO ingredient (household_id, name, name_normalized, source, source_ref, brand,
` +
      `  kcal_per_100g, proteins_g, carbs_g, sugars_g, fats_g, saturated_fats_g, fiber_g, salt_g,
` +
      `  piece_weight_g, cooked_weight_per_100g_raw, in_personal_library, category_l1, category_l2,
` +
      `  season_months)
` +
      `SELECT (SELECT MAX(id) FROM household), name, name_normalized, source, source_ref, brand,
` +
      `  kcal_per_100g, proteins_g, carbs_g, sugars_g, fats_g, saturated_fats_g, fiber_g, salt_g,
` +
      `  piece_weight_g, cooked_weight_per_100g_raw, 0, category_l1, category_l2, season_months
` +
      `FROM ingredient WHERE id IN (SELECT MIN(id) FROM ingredient GROUP BY source, source_ref);
`

// `household_id` n'est PAS dans le ON CONFLICT : changer le mot de passe d'un
// compte existant ne doit jamais le deplacer de cuisine.
const household = newKitchen === null ? '1' : '(SELECT MAX(id) FROM household)'

const sql =
  kitchenSql +
  `INSERT INTO user (username, display_name, household_id, password_hash, password_salt, iterations) ` +
  `VALUES (${sqlString(username)}, ${sqlString(displayName)}, ${household}, ${sqlString(hash)}, ${sqlString(salt)}, ${iterations}) ` +
  `ON CONFLICT(username) DO UPDATE SET ` +
  `display_name = excluded.display_name, password_hash = excluded.password_hash, ` +
  `password_salt = excluded.password_salt, iterations = excluded.iterations, is_active = 1;`

if (flags.has('--print')) {
  stdout.write(`\n${sql}\n`)
  process.exit(0)
}

const target = flags.has('--local') ? '--local' : '--remote'
const where = target === '--local' ? 'la base de développement' : 'la production'

stdout.write(`\nApplication sur ${where}…\n`)
const { code, output } = await runWrangler(sql, target)

if (code !== 0) {
  stdout.write(`\n${output}\n`)
  quit(
    `Échec. Si c'est un problème d'authentification, lance « npx wrangler login ».\n` +
      `Tu peux aussi récupérer le SQL avec --print et l'appliquer toi-même.`,
  )
}

stdout.write(`
Compte « ${username} » (${displayName}) créé sur ${where}.${
  newKitchen === null
    ? '\nIl rejoint la cuisine existante : mêmes recettes, même frigo, mêmes prix.'
    : `\nNouvelle cuisine « ${newKitchen} », avec sa copie du catalogue. Données entièrement séparées.`
}
Le mot de passe n'est stocké nulle part : seule son empreinte l'est.

Tu peux maintenant te connecter avec l'identifiant « ${username} ».
`)
