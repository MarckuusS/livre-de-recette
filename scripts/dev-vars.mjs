#!/usr/bin/env node
/**
 * Ecrit `.dev.vars`, le reglage local du serveur de developpement.
 *
 * POURQUOI CE FICHIER ET PAS UN AUTRE. `wrangler dev` lit `.dev.vars` et lui
 * donne la priorite sur le bloc `[vars]` de `wrangler.toml`. Il n'est en
 * revanche JAMAIS televerse : ni `wrangler deploy` ni `wrangler pages deploy`
 * ne le regardent. C'est donc le seul endroit d'ou l'on peut contredire la
 * production sans risquer de l'emporter avec soi. Il est ignore par git depuis
 * l'origine du portage.
 *
 * CE QU'IL OUVRE. `DEV_AUTOLOGIN=1` fait entrer dans l'application sans mot de
 * passe. C'est une porte, et elle est decrite en detail au-dessus de
 * `devUser()` dans `worker/src/auth.ts`, avec les deux verrous qui
 * l'empechent d'exister ailleurs qu'ici.
 *
 *     node scripts/dev-vars.mjs               -> connexion automatique
 *     node scripts/dev-vars.mjs --connexion   -> garde l'ecran de connexion
 *
 * IL FUSIONNE, IL N'ECRASE PAS. Un `.dev.vars` existant peut deja porter un
 * jeton d'API ou une adresse de service : ce script ne remplace que les deux
 * cles qu'il gere et laisse le reste (commentaires et ordre compris) tel
 * qu'il l'a trouve.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHEMIN = join(ROOT, '.dev.vars')

const avecConnexion = process.argv.slice(2).includes('--connexion')

/**
 * Les deux cles que ce script pilote.
 *
 * `ENVIRONMENT` compte autant que l'autre : c'est le second verrou. Le laisser
 * a 'production' (sa valeur dans `wrangler.toml`) suffirait a refermer la
 * porte, et l'oubli ne se verrait pas, la connexion echouant simplement comme
 * avant.
 */
const REGLAGES = {
  ENVIRONMENT: 'development',
  DEV_AUTOLOGIN: avecConnexion ? '0' : '1',
}

const lignes = existsSync(CHEMIN) ? readFileSync(CHEMIN, 'utf8').split(/\r?\n/) : []

const gerees = new Set(Object.keys(REGLAGES))
const posees = new Set()

const sortie = lignes.map((ligne) => {
  // On ne touche ni aux commentaires, ni aux lignes vides, ni a ce qui ne
  // ressemble pas a une affectation : un fichier annote le reste.
  const nom = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(ligne)?.[1]
  if (nom === undefined || !gerees.has(nom)) return ligne
  posees.add(nom)
  return `${nom}=${REGLAGES[nom]}`
})

const manquantes = Object.entries(REGLAGES).filter(([nom]) => !posees.has(nom))

if (manquantes.length > 0) {
  if (sortie.length > 0 && sortie[sortie.length - 1].trim() !== '') sortie.push('')
  sortie.push(
    '# Reglages du serveur LOCAL. Ce fichier ne part jamais en ligne.',
    '# Ecrit par scripts/dev-vars.mjs ; voir devUser() dans worker/src/auth.ts.',
    ...manquantes.map(([nom, valeur]) => `${nom}=${valeur}`),
    '',
  )
}

writeFileSync(CHEMIN, sortie.join('\n'), 'utf8')

console.log(
  avecConnexion
    ? "[dev-vars] Ecran de connexion CONSERVE (DEV_AUTOLOGIN=0). Il faudra un compte : node scripts/dev-compte.mjs --persist-to=..."
    : '[dev-vars] Connexion automatique ACTIVE : le serveur local ouvre sans mot de passe.',
)
