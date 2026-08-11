/**
 * Les valeurs attendues sont calculees A LA MAIN depuis Mifflin-St Jeor, pas
 * relevees sur une execution du code. C'est la seule facon qu'un test de
 * calcul ait un sens : sinon il verifie que la fonction fait ce qu'elle fait,
 * ce qui est toujours vrai.
 *
 *   homme : 10 x poids + 6,25 x taille - 5 x age + 5
 *   femme : 10 x poids + 6,25 x taille - 5 x age - 161
 */

import { describe, expect, it } from 'vitest'

import {
  ACTIVITY_LEVELS,
  MIN_SAFE_KCAL,
  WEIGHT_GOALS,
  ageFrom,
  basalMetabolicRate,
  estimateTargets,
  perEater,
  progressToward,
  type Profile,
} from './profile.js'

const NOW = new Date('2026-08-11T12:00:00Z')

const HOMME: Profile = {
  sex: 'm', birthYear: 1996, heightCm: 180, weightKg: 80, activity: 'actif', goal: 'maintien',
}

describe('basalMetabolicRate', () => {
  it('applique la formule pour un homme', () => {
    // 10x80 + 6,25x180 - 5x30 + 5 = 800 + 1125 - 150 + 5
    expect(basalMetabolicRate('m', 80, 180, 30)).toBe(1780)
  })

  it('applique la formule pour une femme', () => {
    // 10x60 + 6,25x165 - 5x30 - 161 = 600 + 1031,25 - 150 - 161
    expect(basalMetabolicRate('f', 60, 165, 30)).toBeCloseTo(1320.25, 2)
  })

  it('retranche bien 5 kcal par annee d’age, et pas davantage', () => {
    const a = basalMetabolicRate('m', 80, 180, 30)
    const b = basalMetabolicRate('m', 80, 180, 40)
    expect(a - b).toBe(50)
  })
})

describe('estimateTargets', () => {
  it('enchaine metabolisme, activite et objectif', () => {
    const t = estimateTargets(HOMME, NOW)!
    expect(t.bmr).toBe(1780)
    expect(t.tdee).toBe(Math.round(1780 * 1.55)) // 2759
    expect(t.kcal).toBe(2759) // maintien : aucun ajustement
    expect(t.floored).toBe(false)
  })

  it('applique l’ajustement en POURCENTAGE, pas en forfait', () => {
    // Un forfait de 500 kcal couperait 28 % a l'un et 16 % a l'autre.
    const petit = estimateTargets({ ...HOMME, weightKg: 55, heightCm: 160, goal: 'perte' }, NOW)!
    const grand = estimateTargets({ ...HOMME, weightKg: 100, heightCm: 195, goal: 'perte' }, NOW)!
    expect(petit.kcal / petit.tdee).toBeCloseTo(0.85, 2)
    expect(grand.kcal / grand.tdee).toBeCloseTo(0.85, 2)
  })

  it('repartit les macros en part de l’energie, converties en grammes', () => {
    const t = estimateTargets(HOMME, NOW)!
    const split = WEIGHT_GOALS.find((g) => g.code === 'maintien')!.split
    expect(t.proteins.percent).toBe(split.proteins)
    expect(t.proteins.kcal).toBe(Math.round((t.kcal * split.proteins) / 100))
    expect(t.proteins.grams).toBe(Math.round(t.proteins.kcal / 4))
    expect(t.fats.grams).toBe(Math.round(t.fats.kcal / 9))
    // Les trois parts couvrent toute l'energie, sans reste inexplique.
    expect(t.proteins.percent + t.carbs.percent + t.fats.percent).toBe(100)
  })

  it('ne descend jamais sous le plancher de securite, et le signale', () => {
    const t = estimateTargets(
      { sex: 'f', birthYear: 1966, heightCm: 150, weightKg: 45, activity: 'sedentaire', goal: 'perte' },
      NOW,
    )!
    // Le calcul brut donne environ 945 kcal : sous le seuil d'un regime non supervise.
    expect(t.kcal).toBe(MIN_SAFE_KCAL.f)
    expect(t.floored).toBe(true)
  })

  it('rend null des qu’une mesure manque, plutot qu’une estimation inventee', () => {
    for (const absent of ['sex', 'birthYear', 'heightCm', 'weightKg', 'activity', 'goal'] as const) {
      expect(estimateTargets({ ...HOMME, [absent]: null }, NOW), absent).toBeNull()
    }
  })

  it('couvre tous les niveaux et tous les objectifs declares', () => {
    // Un code ajoute a l'une des deux listes sans facteur ni repartition ferait
    // rendre `null` en silence a l'interface.
    for (const level of ACTIVITY_LEVELS) {
      for (const goal of WEIGHT_GOALS) {
        const t = estimateTargets({ ...HOMME, activity: level.code, goal: goal.code }, NOW)
        expect(t, `${level.code}/${goal.code}`).not.toBeNull()
      }
    }
  })
})

describe('ageFrom', () => {
  it('compte en annees pleines', () => {
    expect(ageFrom(1996, NOW)).toBe(30)
  })
})

describe('perEater', () => {
  it('partage le total du jour entre les mangeurs declares', () => {
    expect(perEater(4000, 2)).toBe(2000)
  })

  it('ne divise pas par zero', () => {
    expect(perEater(4000, 0)).toBe(4000)
  })
})

describe('progressToward', () => {
  it('rend la part atteinte et l’ecart', () => {
    const p = progressToward(1500, 2000)
    expect(p.ratio).toBeCloseTo(0.75, 5)
    expect(p.over).toBe(false)
    expect(p.gap).toBe(500)
  })

  it('signale le depassement', () => {
    expect(progressToward(2400, 2000).over).toBe(true)
  })

  it('reste neutre quand la cible est absente ou nulle', () => {
    // Sans ce garde-fou, un ecran afficherait « 340 % » pour une cible a zero.
    for (const cible of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(progressToward(1500, cible).ratio, String(cible)).toBe(0)
    }
  })
})
