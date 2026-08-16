/**
 * La porte de developpement, et surtout ce qui la tient fermee.
 *
 * `devUser()` ouvre l'application sans mot de passe. Ces tests ne verifient pas
 * qu'elle marche (cela se voit a l'oeil en lancant mobile.bat), mais qu'elle
 * ne peut PAS s'ouvrir ailleurs. Chacun correspond a une facon precise de la
 * laisser entrebaillee par megarde.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { devLoginBypass, devUser } from './auth.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const lire = (nom: string) => readFileSync(join(ROOT, nom), 'utf8')

describe('devLoginBypass : les deux verrous', () => {
  it("reste ferme sans la variable, cas de tout deploiement", () => {
    expect(devLoginBypass({ ENVIRONMENT: 'production' })).toBe(false)
    expect(devLoginBypass({})).toBe(false)
  })

  it("reste ferme si ENVIRONMENT vaut production, meme avec la variable", () => {
    // Le scenario redoute : quelqu'un ajoute DEV_AUTOLOGIN dans le tableau de
    // bord Cloudflare. Le second verrou tient tout seul.
    expect(devLoginBypass({ ENVIRONMENT: 'production', DEV_AUTOLOGIN: '1' })).toBe(false)
  })

  it("reste ferme sur toute valeur autre que '1'", () => {
    // '0' est ce qu'ecrit `dev-vars.mjs --connexion` : il doit refermer.
    for (const valeur of ['0', '', 'true', 'oui', 'yes', '2']) {
      expect(devLoginBypass({ ENVIRONMENT: 'development', DEV_AUTOLOGIN: valeur })).toBe(false)
    }
  })

  it("ne s'ouvre qu'avec les deux conditions reunies", () => {
    expect(devLoginBypass({ ENVIRONMENT: 'development', DEV_AUTOLOGIN: '1' })).toBe(true)
    // ENVIRONMENT absent : `wrangler.toml` la fixe toujours, mais un Worker
    // lance sans elle ne doit pas se retrouver plus ferme qu'en local.
    expect(devLoginBypass({ DEV_AUTOLOGIN: '1' })).toBe(true)
  })
})

describe('la variable ne peut pas atteindre la production', () => {
  it("n'apparait pas dans wrangler.toml, seule voie vers le deploiement", () => {
    expect(lire('wrangler.toml')).not.toContain('DEV_AUTOLOGIN')
  })

  it('wrangler.toml fixe bien ENVIRONMENT a production', () => {
    // Le second verrou n'existe que par cette ligne : sans elle, un
    // deploiement n'aurait plus qu'un seul verrou.
    expect(lire('wrangler.toml')).toMatch(/^ENVIRONMENT\s*=\s*"production"$/m)
  })

  it('.dev.vars est ignore par git', () => {
    // Le depot est public. Un .dev.vars versionne emporterait la porte avec
    // lui dans toute copie du projet.
    expect(lire('.gitignore').split(/\r?\n/)).toContain('.dev.vars')
  })
})

/**
 * Base minimale : elle retient le SQL qu'on lui donne et rend ce qu'on lui a
 * dit de rendre. Assez pour prouver qui est interroge, et surtout qui ne l'est
 * pas.
 */
function baseFactice(lignes: Record<string, unknown>[]) {
  const requetes: string[] = []
  const db = {
    prepare(sql: string) {
      requetes.push(sql)
      return {
        bind: (...valeurs: unknown[]) => ({
          run: async () => {
            if (/INSERT INTO user/.test(sql)) {
              lignes.push({
                id: 1,
                username: valeurs[0],
                displayName: valeurs[1],
                householdId: valeurs[5],
              })
            }
            return { success: true }
          },
          first: async () => lignes[0] ?? null,
        }),
        first: async () => lignes[0] ?? null,
      }
    },
  }
  return { db: db as unknown as D1Database, requetes }
}

describe('devUser', () => {
  it('ne touche meme pas a la base quand la porte est fermee', async () => {
    const { db, requetes } = baseFactice([{ id: 7 }])
    expect(await devUser({ ENVIRONMENT: 'production', DEV_AUTOLOGIN: '1' }, db)).toBeNull()
    // Zero requete : le verrou est teste AVANT toute lecture, ce qui garantit
    // qu'aucun compte ne peut etre cree en production par ce chemin.
    expect(requetes).toEqual([])
  })

  it('reprend le premier compte actif plutot que d\'en imposer un', async () => {
    // La base locale porte deja les donnees d'essai de quelqu'un : entrer sous
    // une autre identite montrerait une cuisine vide.
    const existant = { id: 3, username: 'marius', displayName: 'Marius', householdId: 2 }
    const { db, requetes } = baseFactice([existant])
    expect(await devUser({ DEV_AUTOLOGIN: '1' }, db)).toEqual(existant)
    expect(requetes.some((q) => /INSERT INTO user/.test(q))).toBe(false)
  })

  it('cree un compte quand la base n\'en a aucun', async () => {
    const { db, requetes } = baseFactice([])
    const user = await devUser({ DEV_AUTOLOGIN: '1' }, db)
    expect(user).toMatchObject({ username: 'dev', householdId: 1 })
    // ON CONFLICT DO NOTHING : le navigateur ouvre plusieurs requetes de front
    // au chargement, et deux peuvent constater l'absence de compte ensemble.
    expect(requetes.some((q) => /ON CONFLICT\(username\) DO NOTHING/.test(q))).toBe(true)
  })
})
