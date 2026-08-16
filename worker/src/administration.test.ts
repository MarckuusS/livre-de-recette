/**
 * La console d'administration, et ce qui l'empeche de laisser des ruines.
 *
 * Elle est le seul endroit du projet qui detruit des donnees en volume. Ces
 * tests ne verifient pas qu'elle marche — cela se voit en l'ouvrant — mais
 * qu'elle ne peut pas oublier quelque chose derriere elle.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// @ts-expect-error — module .mjs sans types, volontairement : c'est un script.
import { TABLES_DU_FOYER } from '../../scripts/lib/tables-foyer.mjs'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const lire = (nom: string) => readFileSync(join(RACINE, nom), 'utf8')

const serveurAdmin = lire('scripts/admin/serveur.mjs')

/**
 * Les tables portant `household_id`, relevees dans les migrations.
 *
 * Deux formes coexistent : la colonne declaree dans un CREATE TABLE, et celle
 * ajoutee plus tard par ALTER (c'est ainsi que la 0005 a cloisonne les tables
 * qui existaient deja).
 */
function tablesCloisonneesSelonLesMigrations(): Set<string> {
  const dossier = join(RACINE, 'migrations')
  const trouvees = new Set<string>()
  const renommages = new Map<string, string>()

  for (const fichier of readdirSync(dossier).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dossier, fichier), 'utf8')
      // Les commentaires parlent abondamment de household_id : les retirer
      // avant de chercher, sinon on releve des tables citees en prose.
      .replace(/--[^\n]*/g, '')

    for (const m of sql.matchAll(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+household_id/gi)) {
      trouvees.add(m[1]!)
    }

    for (const m of sql.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi,
    )) {
      if (/\bhousehold_id\b/.test(m[2]!)) trouvees.add(m[1]!)
    }

    /*
     * SQLite ne sait pas ajouter une contrainte : la 0005 a donc reconstruit
     * la moitie du schema par « CREATE TABLE x_new / copier / DROP x / RENAME
     * x_new TO x ». Sans suivre ce renommage, l'analyse retient `app_setting_new`
     * et croit `app_setting` non cloisonnee — soit exactement l'inverse de la
     * verite, sur la table qui porte le secret de session.
     */
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+(\w+)\s+RENAME\s+TO\s+(\w+)/gi)) {
      renommages.set(m[1]!, m[2]!)
    }
  }

  const resolu = new Set<string>()
  for (const nom of trouvees) {
    let courant = nom
    // Une table peut etre reconstruite plusieurs fois au fil des migrations.
    for (let i = 0; renommages.has(courant) && i < 10; i++) courant = renommages.get(courant)!
    resolu.add(courant)
  }

  // `user` porte household_id mais n'est pas une donnee de cuisine : c'est le
  // lien lui-meme. Supprimer une cuisine ne supprime pas ses habitants — la
  // console refuse justement de retirer une cuisine habitee.
  resolu.delete('user')
  return resolu
}

describe('supprimer une cuisine ne laisse rien derriere', () => {
  it('couvre TOUTES les tables cloisonnées déclarées dans les migrations', () => {
    /*
     * LE DEFAUT QUE CE TEST ATTRAPE : quelqu'un ajoute une table portant
     * `household_id` et oublie tables-foyer.mjs. La suppression d'une cuisine
     * laisse alors des lignes qui designent un foyer disparu — invisibles,
     * jusqu'au jour ou un identifiant de foyer est reattribue et les rend
     * a quelqu'un d'autre.
     */
    const attendues = tablesCloisonneesSelonLesMigrations()
    const couvertes = new Set<string>(TABLES_DU_FOYER)

    const oubliees = [...attendues].filter((t) => !couvertes.has(t)).sort()
    expect(oubliees, `tables cloisonnées absentes de TABLES_DU_FOYER`).toEqual([])
  })

  it('ne nomme aucune table qui n’existe pas', () => {
    const attendues = tablesCloisonneesSelonLesMigrations()
    const inconnues = TABLES_DU_FOYER.filter((t: string) => !attendues.has(t)).sort()
    expect(inconnues, 'tables listées mais non cloisonnées').toEqual([])
  })

  it('vide les enfants AVANT la cuisine', () => {
    // `DELETE FROM household` en premier ferait echouer les contraintes, ou
    // laisserait les enfants orphelins selon que les FK sont actives.
    const gabarit = serveurAdmin.slice(serveurAdmin.indexOf('async function supprimerCuisine'))
    const enfants = gabarit.indexOf('TABLES_DU_FOYER.map')
    const foyer = gabarit.indexOf('DELETE FROM household')
    expect(enfants).toBeGreaterThan(-1)
    expect(foyer).toBeGreaterThan(-1)
    expect(enfants).toBeLessThan(foyer)
  })

  it('refuse de supprimer une cuisine habitée', () => {
    expect(serveurAdmin).toMatch(/est habitée par \$\{etat\.comptes\} compte\(s\)/)
  })
})

describe('la réinitialisation', () => {
  it('efface les invitations précédentes du compte', () => {
    // Deux liens vivants pour un meme compte, c'est un lien de trop a
    // intercepter, et celui qu'on croyait perime ouvre encore.
    expect(serveurAdmin).toMatch(/DELETE FROM user_invite WHERE user_id = \$\{ou\}/)
  })

  it('ne touche ni à la cuisine ni au mot de passe en place', () => {
    const bloc = serveurAdmin.slice(
      serveurAdmin.indexOf('async function reinitialiser'),
      serveurAdmin.indexOf('async function creerCompte'),
    )
    expect(bloc).not.toMatch(/UPDATE user SET password/)
    expect(bloc).not.toMatch(/household_id\s*=/)
  })
})

describe('le contrôle de santé', () => {
  it('vérifie que l’index FTS suit la table des ingrédients', () => {
    // Un ecart fait disparaitre des aliments de la recherche, sans message.
    expect(serveurAdmin).toContain('FROM ingredient_fts')
    expect(serveurAdmin).toMatch(/index_fts/)
  })

  it('signale les cuisines partagées comme GRAVES', () => {
    const bloc = serveurAdmin.slice(serveurAdmin.indexOf("nom: 'Cuisines partagées'"))
    expect(bloc.slice(0, 200)).toMatch(/grave: n\('cuisines_partagees'\) > 0/)
  })
})
