/**
 * Les invitations, et surtout ce qui les empeche de deraper.
 *
 * Ces routes sont les SEULES que la console d'administration ajoute au serveur
 * deploye, et les seules routes publiques en ecriture du projet. Chaque test
 * ci-dessous correspond a une facon precise de les rendre dangereuses, et non
 * a une facon de les faire marcher — cela se voit en suivant un lien.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ICI = dirname(fileURLToPath(import.meta.url))
const RACINE = join(ICI, '..', '..')
const lire = (nom: string) => readFileSync(join(RACINE, nom), 'utf8')

const routeInvitation = lire('worker/src/routes/invitation.ts')
const indexWorker = lire('worker/src/index.ts')
const serveurAdmin = lire('scripts/admin/serveur.mjs')
const migration = lire('migrations/0017_invitations.sql')

describe('la garde d’authentification laisse passer les invitations', () => {
  it('déclare les deux chemins dans PUBLIC_ROUTES', () => {
    // Sans cela, le destinataire recoit un 401 : il n'a pas de session, c'est
    // precisement pourquoi on l'invite.
    const bloc = indexWorker.slice(
      indexWorker.indexOf('const PUBLIC_ROUTES'),
      indexWorker.indexOf('export default'),
    )
    expect(bloc).toContain("'/api/invitation'")
    expect(bloc).toContain("'/api/invitation/mot-de-passe'")
  })

  it('enregistre le module de routes', () => {
    // `route()` s'execute a l'import : sans cette ligne les endpoints
    // n'existent pas, et rien ne le signale a la compilation.
    expect(indexWorker).toContain("import './routes/invitation.js'")
  })

  it('garde une comparaison EXACTE des chemins publics', () => {
    // Un `startsWith` ou une expression rationnelle ouvrirait bien plus que
    // les quatre chemins voulus. C'est aussi la raison pour laquelle le jeton
    // voyage dans le corps plutot que dans un segment d'URL.
    expect(indexWorker).toContain('PUBLIC_ROUTES.has(url.pathname)')
  })
})

describe('le jeton', () => {
  it("n'est jamais stocké en clair : la console n'insère qu'une empreinte", () => {
    expect(serveurAdmin).toMatch(/createHash\('sha256'\)\.update\(jeton\)/)
    // La colonne s'appelle token_hash, et c'est bien l'empreinte qu'on y met.
    expect(serveurAdmin).toMatch(/INSERT INTO user_invite \(token_hash/)
    expect(serveurAdmin).toMatch(/sqlString\(empreinte\)/)
  })

  it('fait 256 bits, ce qui justifie SHA-256 plutôt que PBKDF2', () => {
    expect(serveurAdmin).toContain('randomBytes(32).toString(\'hex\')')
    // Le raisonnement doit rester ecrit : c'est une exception assumee a la
    // regle « un secret se hache lentement » de auth.ts.
    expect(migration).toMatch(/SHA-256 ICI, PBKDF2 POUR UN MOT DE PASSE/)
  })

  it('est refusé côté serveur s’il n’a pas la forme attendue', () => {
    expect(routeInvitation).toMatch(/\/\^\[0-9a-f\]\{64\}\$\//)
  })
})

describe("l'invitation est réservée AVANT que le mot de passe ne soit posé", () => {
  /*
   * L'INVARIANT LE PLUS SUBTIL DU FICHIER.
   *
   * `UPDATE ... WHERE used_at IS NULL` est une prise de verrou : de deux
   * requetes simultanees portant le meme jeton, une seule voit changes = 1.
   * Poser le mot de passe d'abord laisserait les deux aboutir, et la seconde
   * ecraserait le mot de passe choisi par la premiere — un lien intercepte
   * suffirait alors a reprendre un compte deja reclame.
   *
   * On verifie l'ORDRE dans le source, comme le fait
   * web/src/components/anneau-tableau.test.ts pour l'anneau et son tableau.
   */
  it('marque used_at puis seulement ensuite écrit password_hash', () => {
    const prise = routeInvitation.indexOf('UPDATE user_invite SET used_at')
    const pose = routeInvitation.indexOf('UPDATE user SET password_hash')

    expect(prise).toBeGreaterThan(-1)
    expect(pose).toBeGreaterThan(-1)
    expect(prise).toBeLessThan(pose)
  })

  it('conditionne la prise à used_at IS NULL et vérifie changes', () => {
    expect(routeInvitation).toMatch(/WHERE token_hash = \? AND used_at IS NULL/)
    expect(routeInvitation).toMatch(/changes \?\? 0\) !== 1/)
  })
})

describe('ce que la base garantit', () => {
  it('lie l’invitation au compte avec une cascade', () => {
    // Supprimer un compte en attente doit emporter son invitation, sinon un
    // lien survivrait a son destinataire.
    expect(migration).toMatch(/REFERENCES user \(id\) ON DELETE CASCADE/)
  })

  it('impose une date de péremption', () => {
    expect(migration).toMatch(/expires_at TEXT\s+NOT NULL/)
  })
})

describe('les messages ne renseignent pas un curieux', () => {
  it('emploie le même refus pour inconnu, utilisé et périmé', () => {
    // Trois messages distincts apprendraient qu'un jeton a existe, et lequel.
    const occurrences = routeInvitation.match(/invitation_invalide/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(2)
    expect(routeInvitation).toMatch(
      /!ligne \|\| ligne\.used_at !== null \|\| ligne\.expires_at <= new Date\(\)\.toISOString\(\)/,
    )
  })
})
