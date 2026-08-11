/**
 * Profil alimentaire et sportif.
 *
 * CE DEPOT EST CLOISONNE PAR PERSONNE, pas par foyer — c'est le seul du projet
 * dans ce cas, et c'est deliberé. Poids, taille et objectif de poids sont des
 * donnees de sante : partager une cuisine ne donne pas le droit de les lire.
 * L'identifiant vient de la session, jamais du corps de la requete.
 *
 * Le nombre de mangeurs, lui, appartient au FOYER : les deux membres doivent
 * lire le meme, puisque c'est par lui qu'on divise le total d'une journee.
 */

import type { D1Database } from '@cloudflare/workers-types'

export interface ProfileRow {
  readonly sex: 'f' | 'm' | null
  readonly birthYear: number | null
  readonly heightCm: number | null
  readonly weightKg: number | null
  readonly activity: string | null
  readonly goal: string | null
  /** Repartition des macros. `null` = celle que propose l'objectif. */
  readonly split: string | null
  /** Pourcentages ecrits a la main, lus seulement si `split === 'perso'`. */
  readonly splitProteins: number | null
  readonly splitCarbs: number | null
  readonly splitFats: number | null
  readonly targetWeightKg: number | null
  readonly pace: string | null
  readonly kcalTarget: number | null
}

/** Profil vierge : l'etat d'une personne qui n'a jamais ouvert l'ecran. */
const EMPTY: ProfileRow = {
  sex: null,
  birthYear: null,
  heightCm: null,
  weightKg: null,
  activity: null,
  goal: null,
  split: null,
  splitProteins: null,
  splitCarbs: null,
  splitFats: null,
  targetWeightKg: null,
  pace: null,
  kcalTarget: null,
}

export class ProfileRepo {
  constructor(
    private readonly db: D1Database,
    private readonly userId: number,
    private readonly householdId: number,
  ) {}

  /**
   * Le profil et le nombre de mangeurs.
   *
   * Une personne sans ligne rend un profil VIDE et non `null` : l'ecran doit
   * pouvoir s'afficher et se remplir sans avoir a distinguer « jamais ouvert »
   * de « ouvert puis vide ». C'est aussi ce qui permet au `PUT` de faire un
   * upsert sans se soucier de l'existant.
   */
  async get(): Promise<{ profile: ProfileRow; eaters: number }> {
    const row = await this.db
      .prepare(
        `SELECT sex, birth_year, height_cm, weight_kg, activity, goal,
                split, split_proteins, split_carbs, split_fats,
                target_weight_kg, pace, kcal_target
           FROM user_profile WHERE user_id = ?`,
      )
      .bind(this.userId)
      .first<{
        sex: 'f' | 'm' | null
        birth_year: number | null
        height_cm: number | null
        weight_kg: number | null
        activity: string | null
        goal: string | null
        split: string | null
        split_proteins: number | null
        split_carbs: number | null
        split_fats: number | null
        target_weight_kg: number | null
        pace: string | null
        kcal_target: number | null
      }>()

    const house = await this.db
      .prepare('SELECT eaters FROM household WHERE id = ?')
      .bind(this.householdId)
      .first<{ eaters: number }>()

    return {
      profile: row
        ? {
            sex: row.sex,
            birthYear: row.birth_year,
            heightCm: row.height_cm,
            weightKg: row.weight_kg,
            activity: row.activity,
            goal: row.goal,
            split: row.split,
            splitProteins: row.split_proteins,
            splitCarbs: row.split_carbs,
            splitFats: row.split_fats,
            targetWeightKg: row.target_weight_kg,
            pace: row.pace,
            kcalTarget: row.kcal_target,
          }
        : EMPTY,
      eaters: house?.eaters ?? 1,
    }
  }

  /**
   * Ecrit le profil et le nombre de mangeurs en une seule transaction.
   *
   * Les deux partent en `batch` parce qu'ils sont saisis sur le meme ecran :
   * les separer laisserait, sur coupure, un objectif enregistre compare a un
   * nombre de mangeurs qui ne l'est pas — donc un suivi faux sans que rien ne
   * l'indique.
   */
  async save(profile: ProfileRow, eaters: number): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO user_profile
             (user_id, sex, birth_year, height_cm, weight_kg, activity, goal,
              split, split_proteins, split_carbs, split_fats,
              target_weight_kg, pace, kcal_target, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
           ON CONFLICT (user_id) DO UPDATE SET
             sex = excluded.sex,
             birth_year = excluded.birth_year,
             height_cm = excluded.height_cm,
             weight_kg = excluded.weight_kg,
             activity = excluded.activity,
             goal = excluded.goal,
             split = excluded.split,
             split_proteins = excluded.split_proteins,
             split_carbs = excluded.split_carbs,
             split_fats = excluded.split_fats,
             target_weight_kg = excluded.target_weight_kg,
             pace = excluded.pace,
             kcal_target = excluded.kcal_target,
             updated_at = excluded.updated_at`,
        )
        .bind(
          this.userId,
          profile.sex,
          profile.birthYear,
          profile.heightCm,
          profile.weightKg,
          profile.activity,
          profile.goal,
          profile.split,
          profile.splitProteins,
          profile.splitCarbs,
          profile.splitFats,
          profile.targetWeightKg,
          profile.pace,
          profile.kcalTarget,
        ),
      this.db
        .prepare('UPDATE household SET eaters = ? WHERE id = ?')
        .bind(eaters, this.householdId),
    ])
  }
}
