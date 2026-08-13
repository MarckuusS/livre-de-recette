/**
 * Le tampon d'edition de l'ecran de reglage.
 *
 * Il vit a part pour que les cartes conservees et les blocs neufs le
 * partagent sans que l'un importe l'autre.
 */

import type { ActivityCode, GoalCode, PaceCode, SplitCode } from '@livre/shared'

export interface Draft {
  sex: 'f' | 'm' | null
  birthYear: number | null
  heightCm: number | null
  weightKg: number | null
  waistCm: number | null
  activity: ActivityCode | null
  goal: GoalCode | null
  split: SplitCode | null
  splitProteins: number | null
  splitCarbs: number | null
  splitFats: number | null
  targetWeightKg: number | null
  pace: PaceCode | null
  kcalTarget: number | null
  /**
   * Horodatage de la reconnaissance des limites, ou `null`.
   *
   * En ecriture, seule sa NULLITE compte : le serveur pose la date lui-meme et
   * conserve celle qui existe. Le navigateur ne peut donc ni l'antidater, ni
   * la rajeunir a chaque enregistrement.
   */
  limitsAckAt: string | null
  eaters: number
}

export const EMPTY: Draft = {
  sex: null, birthYear: null, heightCm: null, weightKg: null, waistCm: null,
  activity: null, goal: null,
  split: null, splitProteins: null, splitCarbs: null, splitFats: null,
  targetWeightKg: null, pace: null,
  kcalTarget: null, limitsAckAt: null, eaters: 1,
}
