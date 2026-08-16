#!/usr/bin/env node
/**
 * S'assure qu'un compte existe dans la base de DEVELOPPEMENT, et le cree sinon.
 *
 * POURQUOI IL EXISTE. Le lanceur `mobile.bat` montait tout correctement et
 * l'application repondait "Aucun compte n'est configuré sur ce serveur" : un
 * ecran de connexion sans compte a saisir, donc un lancement pour rien. Dire
 * "lance add-user.mjs" ne suffisait pas, et cette consigne etait meme FAUSSE,
 * ce script ecrivant alors dans la base par defaut du projet et non dans celle
 * que le serveur lit.
 *
 * IL NE TOUCHE JAMAIS A LA PRODUCTION. Il lit et ecrit exclusivement la base
 * locale designee par `--persist-to`, et n'a aucun chemin vers `--remote`.
 *
 * LE MOT DE PASSE EST DEMANDE, jamais invente. Un mot de passe par defaut
 * imprime a l'ecran finit toujours par etre reutilise ailleurs, et celui-ci
 * ouvre une base qui contient du poids, une taille et une annee de naissance.
 * C'est demande une seule fois, au premier lancement.
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const options = new Map(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--') && a.includes('='))
    .map((a) => [a.slice(2, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]),
)

const persistTo = options.get('persist-to')
if (!persistTo) {
  console.error('[compte] --persist-to=CHEMIN est obligatoire.')
  process.exit(1)
}

/**
 * Le fichier SQLite que miniflare tient pour cette base.
 *
 * On le lit DIRECTEMENT plutot que de passer par wrangler : demarrer wrangler
 * pour compter des lignes coute plusieurs secondes a chaque lancement, alors
 * qu'il ne s'agit que de savoir s'il faut poser une question.
 */
function fichierBase() {
  const dossier = join(persistTo, 'v3', 'd1', 'miniflare-D1DatabaseObject')
  if (!existsSync(dossier)) return null
  const fichiers = readdirSync(dossier).filter((f) => f.endsWith('.sqlite'))
  return fichiers.length === 0 ? null : join(dossier, fichiers[0])
}

function compteExistant() {
  const fichier = fichierBase()
  if (fichier === null) return false
  try {
    const db = new DatabaseSync(fichier, { readOnly: true })
    const ligne = db.prepare('SELECT COUNT(*) AS n FROM user WHERE is_active = 1').get()
    db.close()
    return Number(ligne?.n ?? 0) > 0
  } catch {
    // Table absente, base a moitie migree, fichier verrouille : dans tous les
    // cas on ne peut pas affirmer qu'un compte existe.
    return false
  }
}

if (compteExistant()) {
  console.log('[compte] Un compte existe déjà sur la base locale.')
  process.exit(0)
}

/*
 * SANS TERMINAL, ON LE DIT PLUTOT QUE D'ATTENDRE.
 *
 * La suite pose deux questions. Lancee depuis un script, une tache planifiee
 * ou une sortie redirigee, personne n'y repond et le lanceur reste fige sans
 * un mot, ce qui est le pire des comportements : on croit que ca travaille.
 */
if (!process.stdin.isTTY && options.get('identifiant') === undefined) {
  console.error('[compte] Aucun compte sur la base locale, et aucun terminal pour en créer un.')
  console.error('[compte] Lance mobile.bat en double-cliquant dessus, ou crée le compte ainsi :')
  console.error(`[compte]     node scripts/dev-compte.mjs --persist-to="${persistTo}"`)
  process.exit(1)
}

console.log('')
console.log('==========================================================================')
console.log(" Premier lancement : il n'y a pas encore de compte sur cette base locale.")
console.log(' Choisis un identifiant et un mot de passe. Ils ne valent QUE sur ta')
console.log(" machine et n'ont aucun rapport avec ceux de l'application en ligne.")
console.log('==========================================================================')
console.log('')

/**
 * L'identifiant, en clair : ce n'est pas un secret, et le masquer gene.
 *
 * `--identifiant=` court-circuite la question. Il existe pour que ce chemin
 * soit EPROUVABLE sans clavier : `readline` avale tout le tuyau d'un coup, si
 * bien qu'un test qui envoie identifiant puis mot de passe voit le second
 * disparaitre avant d'atteindre `add-user`. Au clavier, chaque programme lit
 * ses touches a son tour et la question suffit.
 */
const identifiant =
  options.get('identifiant') ??
  (await new Promise((resoudre) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question('Identifiant (minuscules, sans espace) : ', (r) => {
      rl.close()
      resoudre(r.trim())
    })
  }))

if (identifiant === '') {
  console.error('[compte] Aucun identifiant saisi.')
  process.exit(1)
}

/**
 * On delegue a `add-user.mjs`, qui sait hacher exactement comme le Worker.
 *
 * Refaire le calcul ici ferait une deuxieme implementation du meme hachage, et
 * la moindre divergence donnerait un compte impossible a utiliser. `stdio:
 * inherit` laisse sa saisie masquee fonctionner : elle a besoin d'un vrai
 * terminal.
 */
const code = await new Promise((resoudre) => {
  const enfant = spawn(
    process.execPath,
    [
      join(ROOT, 'scripts', 'add-user.mjs'),
      identifiant,
      '--local',
      `--persist-to=${persistTo}`,
    ],
    { cwd: ROOT, stdio: 'inherit' },
  )
  enfant.on('close', resoudre)
})

if (code !== 0) {
  console.error('')
  console.error("[compte] La création du compte a échoué ou a été interrompue.")
  process.exit(1)
}

// On revérifie plutot que de croire le code de sortie : c'est la base qui
// tranche, comme partout ailleurs dans ce projet.
if (!compteExistant()) {
  console.error('')
  console.error('[compte] Le compte ne se retrouve pas dans la base locale.')
  console.error(`[compte] Base interrogée : ${fichierBase() ?? '(introuvable)'}`)
  process.exit(1)
}

console.log('')
console.log('[compte] Compte créé et vérifié dans la base locale.')
