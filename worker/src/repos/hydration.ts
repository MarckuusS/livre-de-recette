/**
 * Hydratation du jour.
 *
 * DEUXIEME DEPOT CLOISONNE PAR PERSONNE, apres le profil, et pour la meme
 * raison : ce qu'on boit est une donnee de sante. L'identifiant vient de la
 * session, jamais du corps de la requete — il n'existe donc aucun parametre
 * par lequel demander la journee de quelqu'un d'autre.
 *
 * Comme `ProfileRepo`, il se construit a la main la ou on en a besoin et ne
 * rejoint pas l'agregat `Repositories`, qui ne connait que le foyer. Y glisser
 * une exception ferait croire que les autres depots sont cloisonnes ainsi.
 */

import type { D1Database } from '@cloudflare/workers-types'

export class HydrationRepo {
  constructor(
    private readonly db: D1Database,
    private readonly userId: number,
  ) {}

  /** Millilitres bus ce jour-la. Zero si la journee n'a jamais ete ouverte. */
  async get(day: string): Promise<number> {
    const row = await this.db
      .prepare('SELECT ml FROM hydration_day WHERE user_id = ? AND day = ?')
      .bind(this.userId, day)
      .first<{ ml: number }>()
    return row?.ml ?? 0
  }

  /**
   * Ajoute (ou retranche, si negatif) des millilitres et rend le nouveau total.
   *
   * UN DELTA ET NON UN TOTAL, parce que deux appareils peuvent ajouter un verre
   * dans la meme minute : avec un total, le second ecraserait le premier et le
   * verre disparaitrait. Avec un delta, les deux comptent.
   *
   * Le `MAX(0, ...)` est cote SQL et non cote client : c'est la seule facon que
   * deux retraits concurrents ne puissent pas faire passer la journee sous zero.
   * Le plafond, lui, est laisse a la contrainte CHECK de la table — le
   * depasser est une faute de saisie, pas un cas a rattraper en silence.
   */
  async add(day: string, deltaMl: number): Promise<number> {
    const row = await this.db
      .prepare(
        // Parametres NUMEROTES, et c'est necessaire : `?3` doit etre relu tel
        // quel dans la branche UPDATE. Avec `excluded.ml` on relirait la valeur
        // INSEREE, deja ramenee a zero par le MAX — un retrait serait donc
        // silencieusement perdu sur une journee deja ouverte.
        `INSERT INTO hydration_day (user_id, day, ml) VALUES (?1, ?2, MAX(0, ?3))
         ON CONFLICT (user_id, day)
         DO UPDATE SET ml = MAX(0, MIN(20000, hydration_day.ml + ?3))
         RETURNING ml`,
      )
      .bind(this.userId, day, deltaMl)
      .first<{ ml: number }>()
    return row?.ml ?? 0
  }
}
