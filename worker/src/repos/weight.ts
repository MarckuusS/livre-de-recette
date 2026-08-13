/**
 * L'historique de poids.
 *
 * TROISIEME DEPOT CLOISONNE PAR PERSONNE, apres le profil et l'hydratation, et
 * pour la meme raison : un poids est une donnee de sante. L'identifiant vient
 * de la session, jamais du corps de la requete, donc il n'existe aucun
 * parametre par lequel demander la courbe de quelqu'un d'autre.
 *
 * Comme les deux autres, il se construit a la main la ou on en a besoin et ne
 * rejoint pas l'agregat `Repositories`, qui ne connait que le foyer.
 */

import type { D1Database } from '@cloudflare/workers-types'

export interface WeighInRow {
  readonly day: string
  readonly weightKg: number
}

export class WeightRepo {
  constructor(
    private readonly db: D1Database,
    private readonly userId: number,
  ) {}

  /**
   * Les pesees depuis un jour donne, dans l'ordre.
   *
   * Bornee par une date et non par un nombre de lignes : la moyenne mobile
   * raisonne en JOURS de calendrier, et "les 60 dernieres pesees" couvre deux
   * mois pour qui se pese chaque matin et deux ans pour qui se pese le
   * dimanche.
   */
  async since(day: string): Promise<WeighInRow[]> {
    const { results } = await this.db
      .prepare(
        'SELECT day, weight_kg FROM weight_log WHERE user_id = ? AND day >= ? ORDER BY day',
      )
      .bind(this.userId, day)
      .all<{ day: string; weight_kg: number }>()
    return (results ?? []).map((r) => ({ day: r.day, weightKg: r.weight_kg }))
  }

  /**
   * Enregistre la pesee du jour, en remplacant celle qui existait.
   *
   * Se peser deux fois le meme matin est courant. Garder les deux obligerait a
   * choisir laquelle compte, et la moyenne mobile pencherait selon l'heure de
   * la mesure. La seconde remplace donc la premiere.
   */
  async put(day: string, weightKg: number): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO weight_log (user_id, day, weight_kg) VALUES (?1, ?2, ?3)
         ON CONFLICT (user_id, day) DO UPDATE SET weight_kg = ?3`,
      )
      .bind(this.userId, day, weightKg)
      .run()
  }

  async remove(day: string): Promise<void> {
    await this.db
      .prepare('DELETE FROM weight_log WHERE user_id = ? AND day = ?')
      .bind(this.userId, day)
      .run()
  }
}
