/**
 * Les valeurs attendues sont calculees A LA MAIN depuis Mifflin-St Jeor, pas
 * relevees sur une execution du code. C'est la seule facon qu'un test de
 * calcul ait un sens : sinon il verifie que la fonction fait ce qu'elle fait,
 * ce qui est toujours vrai.
 *
 *   homme : 10 x poids + 6,25 x taille - 5 x age + 5
 *   femme : 10 x poids + 6,25 x taille - 5 x age - 161
 *
 * Reference reutilisee partout : homme, 80 kg, 180 cm, 30 ans, actif.
 *   BMR  = 800 + 1125 - 150 + 5 = 1780
 *   TDEE = 1780 x 1,55          = 2759
 */

import { describe, expect, it } from 'vitest'

import {
  ACTIVITY_LEVELS,
  HYDRATION_BOUNDS,
  hydrationTarget,
  ENERGY_GOALS,
  GOAL_DIRECTIONS,
  KCAL_PER_KG,
  MACRO_SPLITS,
  MAX_ADJUST,
  MIN_PROTEINS_PER_KG,
  MIN_SAFE_KCAL,
  ageFrom,
  basalMetabolicRate,
  directionOf,
  goalForDirection,
  ajusterSplit,
  effetsSecondaires,
  estimateTargets,
  normalizeSplit,
  perEater,
  progressToward,
  splitOf,
  type Profile,
} from './profile.js'

const NOW = new Date('2026-08-11T12:00:00Z')

const HOMME: Profile = {
  sex: 'm', birthYear: 1996, heightCm: 180, weightKg: 80, activity: 'actif', goal: 'maintien',
}

describe('basalMetabolicRate', () => {
  it('applique la formule pour un homme', () => {
    expect(basalMetabolicRate('m', 80, 180, 30)).toBe(1780)
  })

  it('applique la formule pour une femme', () => {
    // 600 + 1031,25 - 150 - 161
    expect(basalMetabolicRate('f', 60, 165, 30)).toBeCloseTo(1320.25, 2)
  })

  it('retranche bien 5 kcal par annee d’age, et pas davantage', () => {
    expect(basalMetabolicRate('m', 80, 180, 30) - basalMetabolicRate('m', 80, 180, 40)).toBe(50)
  })
})

describe('estimateTargets — energie', () => {
  it('enchaine metabolisme, activite et objectif', () => {
    const t = estimateTargets(HOMME, NOW)!
    expect(t.bmr).toBe(1780)
    expect(t.tdee).toBe(2759)
    expect(t.kcal).toBe(2759) // maintien : aucun ajustement
    expect(t.floored).toBe(false)
    expect(t.capped).toBe(false)
  })

  it('applique l’ajustement en POURCENTAGE, pas en forfait', () => {
    // Un forfait de 500 kcal couperait 28 % a l'un et 16 % a l'autre.
    const petit = estimateTargets({ ...HOMME, weightKg: 55, heightCm: 160, goal: 'perte' }, NOW)!
    const grand = estimateTargets({ ...HOMME, weightKg: 100, heightCm: 195, goal: 'perte' }, NOW)!
    expect(petit.kcal / petit.tdee).toBeCloseTo(0.85, 2)
    expect(grand.kcal / grand.tdee).toBeCloseTo(0.85, 2)
  })

  it('distingue les six objectifs par leur ecart a la depense', () => {
    const kcal = (goal: (typeof ENERGY_GOALS)[number]['code']) =>
      estimateTargets({ ...HOMME, goal }, NOW)!.kcal
    // Strictement croissant : deux objectifs qui rendraient la meme cible ne
    // meriteraient pas deux entrees dans la liste.
    const suite = [kcal('seche'), kcal('perte'), kcal('perte_douce'), kcal('maintien'), kcal('prise_seche'), kcal('prise')]
    expect(suite).toEqual([...suite].sort((a, b) => a - b))
    expect(new Set(suite).size).toBe(6)
  })

  it('ne descend jamais sous le plancher de securite, et le signale', () => {
    const t = estimateTargets(
      { sex: 'f', birthYear: 1966, heightCm: 150, weightKg: 45, activity: 'sedentaire', goal: 'perte' },
      NOW,
    )!
    // 927 x 1,2 = 1112 ; -15 % donnerait 945, sous le seuil.
    expect(t.kcal).toBe(MIN_SAFE_KCAL.f)
    expect(t.floored).toBe(true)
  })

  it('rend null des qu’une mesure manque, plutot qu’une estimation inventee', () => {
    for (const absent of ['sex', 'birthYear', 'heightCm', 'weightKg', 'activity', 'goal'] as const) {
      expect(estimateTargets({ ...HOMME, [absent]: null }, NOW), absent).toBeNull()
    }
  })

  it('couvre tous les niveaux et tous les objectifs declares', () => {
    // Un code ajoute a l'une des listes sans facteur ni repartition ferait
    // rendre `null` en silence a l'interface.
    for (const level of ACTIVITY_LEVELS) {
      for (const goal of ENERGY_GOALS) {
        expect(estimateTargets({ ...HOMME, activity: level.code, goal: goal.code }, NOW),
          `${level.code}/${goal.code}`).not.toBeNull()
      }
    }
  })
})

describe('estimateTargets — repartition', () => {
  it('prend la repartition proposee par l’objectif tant qu’on n’en choisit pas', () => {
    const t = estimateTargets(HOMME, NOW)!
    expect(t.splitCode).toBe('equilibre') // celle de « maintien »
    expect(t.split).toEqual({ proteins: 25, carbs: 45, fats: 30 })
    // 2759 x 25 % = 690 kcal ; 690 / 4 = 173 g
    expect(t.proteins.kcal).toBe(690)
    expect(t.proteins.grams).toBe(173)
    expect(t.fats.grams).toBe(92) // 828 / 9
  })

  it('laisse une repartition choisie l’emporter sur celle de l’objectif', () => {
    const t = estimateTargets({ ...HOMME, split: 'faible_glucides' }, NOW)!
    expect(t.split).toEqual({ proteins: 30, carbs: 20, fats: 50 })
    // C'est bien la MEME energie qui se repartit autrement.
    expect(t.kcal).toBe(2759)
  })

  it('lit les pourcentages ecrits a la main quand la repartition est « perso »', () => {
    const t = estimateTargets(
      { ...HOMME, split: 'perso', customSplit: { proteins: 40, carbs: 20, fats: 40 } },
      NOW,
    )!
    expect(t.split).toEqual({ proteins: 40, carbs: 20, fats: 40 })
    expect(t.splitCode).toBe('perso')
  })

  it('ignore les pourcentages manuels tant que « perso » n’est pas choisi', () => {
    // Sinon, revenir a une repartition proposee laisserait l'ancienne saisie
    // agir dans le dos de l'utilisateur.
    const t = estimateTargets(
      { ...HOMME, split: 'seche', customSplit: { proteins: 90, carbs: 5, fats: 5 } },
      NOW,
    )!
    expect(t.split).toEqual({ proteins: 40, carbs: 30, fats: 30 })
  })

  it('les trois parts couvrent toujours toute l’energie', () => {
    for (const s of MACRO_SPLITS) {
      const t = estimateTargets({ ...HOMME, split: s.code }, NOW)!
      expect(t.split.proteins + t.split.carbs + t.split.fats, s.code).toBe(100)
    }
  })

  it('rapporte les proteines au poids, l’unite dans laquelle elles se jugent', () => {
    const t = estimateTargets(HOMME, NOW)!
    expect(t.proteinsPerKg).toBeCloseTo(173 / 80, 4)
  })

  it('signale des proteines insuffisantes EN DEFICIT seulement', () => {
    const maigre = { proteins: 10, carbs: 60, fats: 30 }
    const enDeficit = estimateTargets(
      { ...HOMME, goal: 'perte', split: 'perso', customSplit: maigre }, NOW,
    )!
    const enMaintien = estimateTargets(
      { ...HOMME, goal: 'maintien', split: 'perso', customSplit: maigre }, NOW,
    )!
    // 2345 x 10 % = 235 kcal → 59 g → 0,73 g/kg
    expect(enDeficit.lowProteins).toBe(true)
    // Meme repartition, mais hors deficit : ce n'est plus le muscle qui est en jeu.
    expect(enMaintien.lowProteins).toBe(false)
  })

  it('signale des lipides sous le seuil hormonal', () => {
    const t = estimateTargets(
      { ...HOMME, split: 'perso', customSplit: { proteins: 45, carbs: 40, fats: 15 } }, NOW,
    )!
    expect(t.lowFats).toBe(true)
    expect(estimateTargets(HOMME, NOW)!.lowFats).toBe(false)
  })
})

describe('normalizeSplit', () => {
  it('ramene un total approximatif a exactement 100', () => {
    // 30/97 → 30,9 → 31 ; 27/97 → 27,8 → 28 ; les glucides prennent le reste.
    expect(normalizeSplit({ proteins: 30, carbs: 40, fats: 27 })).toEqual({
      proteins: 31, carbs: 41, fats: 28,
    })
  })

  it('laisse intact un total deja juste', () => {
    expect(normalizeSplit({ proteins: 25, carbs: 45, fats: 30 })).toEqual({
      proteins: 25, carbs: 45, fats: 30,
    })
  })

  it('ne divise pas par zero', () => {
    expect(normalizeSplit({ proteins: 0, carbs: 0, fats: 0 })).toEqual({
      proteins: 25, carbs: 45, fats: 30,
    })
  })
})

describe('splitOf', () => {
  it('rend null pour « perso », qui ne porte pas de valeurs', () => {
    expect(splitOf('perso')).toBeNull()
    expect(splitOf('seche')).toEqual({ proteins: 40, carbs: 30, fats: 30 })
  })
})

describe('estimateTargets — poids vise', () => {
  const VISE: Profile = { ...HOMME, goal: 'perte', targetWeightKg: 74, pace: 'modere' }

  it('laisse l’allure decider du deficit, a la place du pourcentage', () => {
    // 0,5 kg/semaine x 7700 / 7 = 550 kcal par jour.
    const t = estimateTargets(VISE, NOW)!
    expect(t.kcal).toBe(2759 - 550)
    // Le pourcentage de l'objectif « perte » aurait donne 2345.
    expect(t.kcal).not.toBe(2345)
  })

  it('annonce la duree et la date d’arrivee', () => {
    const t = estimateTargets(VISE, NOW)!
    expect(t.kgToTarget).toBe(6)
    expect(t.weeksToTarget).toBe(12) // 6 kg a 0,5 kg par semaine
    expect(t.targetDate).toBe('2026-11-03') // 84 jours apres le 11 aout
  })

  it('prend la direction de l’ECART REEL, pas du libelle de l’objectif', () => {
    // Objectif affiche « perdre », mais le poids vise est plus lourd : c'est le
    // poids vise qui est explicite, donc c'est lui qui gagne.
    const t = estimateTargets({ ...VISE, targetWeightKg: 84, pace: 'lent' }, NOW)!
    expect(t.kcal).toBe(2759 + 275) // 0,25 kg/sem = 275 kcal/jour
    expect(t.weeksToTarget).toBe(16) // 4 kg a 0,25 kg par semaine
  })

  it('estime encore une duree sans allure choisie', () => {
    // Sans allure, l'ecart vient du pourcentage de l'objectif : -15 %.
    const t = estimateTargets({ ...HOMME, goal: 'perte', targetWeightKg: 74 }, NOW)!
    expect(t.kcal).toBe(2345)
    expect(t.weeksToTarget).toBe(16) // 414 kcal/jour → 0,376 kg/sem → 6 kg
  })

  it('plafonne une allure trop ambitieuse et le signale', () => {
    const t = estimateTargets(
      {
        sex: 'f', birthYear: 1966, heightCm: 150, weightKg: 45,
        activity: 'sedentaire', goal: 'perte', targetWeightKg: 40, pace: 'rapide',
      },
      NOW,
    )!
    // 825 kcal/jour demandes sur une depense de 1112 : 74 %, ramenes a 25 %.
    expect(t.capped).toBe(true)
    expect(t.floored).toBe(true)
    expect(t.kcal).toBe(MIN_SAFE_KCAL.f)
  })

  it('n’annonce AUCUNE duree quand le reglage n’avance pas vers la cible', () => {
    // Le plancher a releve l'apport AU-DESSUS de la depense : la personne
    // grossirait. Annoncer une arrivee serait promettre l'inverse de ce qui
    // se produirait.
    const t = estimateTargets(
      {
        sex: 'f', birthYear: 1966, heightCm: 150, weightKg: 45,
        activity: 'sedentaire', goal: 'perte', targetWeightKg: 40, pace: 'rapide',
      },
      NOW,
    )!
    expect(t.kgToTarget).toBe(5)
    expect(t.weeksToTarget).toBeNull()
    expect(t.targetDate).toBeNull()
  })

  it('n’annonce pas de duree en maintien, meme avec un poids vise', () => {
    const t = estimateTargets({ ...HOMME, goal: 'maintien', targetWeightKg: 74 }, NOW)!
    expect(t.weeksToTarget).toBeNull()
  })

  it('ne plafonne jamais au-dela de MAX_ADJUST', () => {
    for (const pace of ['lent', 'modere', 'rapide'] as const) {
      for (const cible of [40, 50, 60, 70, 90, 110]) {
        const t = estimateTargets({ ...HOMME, targetWeightKg: cible, pace }, NOW)!
        expect(Math.abs(t.tdee - t.kcal) / t.tdee, `${pace}/${cible}`)
          .toBeLessThanOrEqual(MAX_ADJUST + 0.001)
      }
    }
  })

  it('convertit les kilos en kcal par la constante declaree', () => {
    // Le test tomberait si quelqu'un remplacait 7700 par 3500 (la valeur en
    // livres, l'erreur classique) sans toucher au reste.
    expect(KCAL_PER_KG).toBe(7700)
    const t = estimateTargets({ ...HOMME, targetWeightKg: 70, pace: 'lent' }, NOW)!
    expect(t.tdee - t.kcal).toBe(Math.round((0.25 * KCAL_PER_KG) / 7))
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

describe('ajusterSplit', () => {
  const EQ = { proteins: 25, carbs: 45, fats: 30 }

  it('redistribue le reste sur les deux autres, a proportion', () => {
    // 100 - 40 = 60 a partager entre 45 et 30, soit 60 % / 40 %.
    expect(ajusterSplit(EQ, 'proteins', 40)).toEqual({ proteins: 40, carbs: 36, fats: 24 })
  })

  it('rend TOUJOURS un total de 100', () => {
    for (const macro of ['proteins', 'carbs', 'fats'] as const) {
      for (let v = 0; v <= 100; v++) {
        const s = ajusterSplit(EQ, macro, v)
        expect(s.proteins + s.carbs + s.fats, `${macro}=${v}`).toBe(100)
        expect(s[macro], `${macro}=${v}`).toBe(v)
      }
    }
  })

  it('partage a egalite quand les deux autres sont a zero', () => {
    // Leur rapport n'existe pas : tout donner a l'une serait arbitraire.
    expect(ajusterSplit({ proteins: 100, carbs: 0, fats: 0 }, 'proteins', 40))
      .toEqual({ proteins: 40, carbs: 30, fats: 30 })
  })

  it('borne la valeur demandee entre 0 et 100', () => {
    expect(ajusterSplit(EQ, 'fats', 140).fats).toBe(100)
    expect(ajusterSplit(EQ, 'fats', -20).fats).toBe(0)
  })
})

describe('effetsSecondaires', () => {
  const codes = (p: Profile) => effetsSecondaires(estimateTargets(p, NOW)!).map((a) => a.code)

  it('ne dit rien sur un reglage raisonnable', () => {
    // Maintien, repartition equilibree : il n'y a rien a signaler, et le dire
    // quand meme rendrait tous les autres avertissements inaudibles.
    expect(codes(HOMME)).toEqual([])
  })

  it('signale un deficit au-dela du quart de la depense', () => {
    const t = estimateTargets({ ...HOMME, targetWeightKg: 70, pace: 'rapide' }, NOW)!
    expect(effetsSecondaires(t).map((a) => a.code)).toContain('deficit-fort')
  })

  it('signale un surplus franc', () => {
    expect(codes({ ...HOMME, goal: 'prise' })).toContain('surplus-fort')
  })

  it('signale des lipides sous le plancher hormonal', () => {
    const avis = effetsSecondaires(estimateTargets(
      { ...HOMME, split: 'perso', customSplit: { proteins: 45, carbs: 40, fats: 15 } }, NOW)!)
    const lipides = avis.find((a) => a.code === 'lipides-bas')!
    expect(lipides.gravite).toBe('serieux')
    // Les trois horizons doivent etre renseignes : c'est tout l'interet de la
    // graduation, et un horizon vide passerait inapercu a la relecture.
    expect(lipides.court).not.toBeNull()
    expect(lipides.moyen).not.toBeNull()
    expect(lipides.long).not.toBeNull()
  })

  it('signale une part de lipides digne d’un regime cetogene', () => {
    expect(codes({ ...HOMME, split: 'perso', customSplit: { proteins: 20, carbs: 15, fats: 65 } }))
      .toContain('lipides-hauts')
  })

  it('signale des glucides sous le besoin en glucose du cerveau', () => {
    expect(codes({ ...HOMME, split: 'perso', customSplit: { proteins: 40, carbs: 10, fats: 50 } }))
      .toContain('glucides-bas')
  })

  it('distingue proteines trop basses et proteines basses EN DEFICIT', () => {
    const maigre = { proteins: 8, carbs: 60, fats: 32 }
    expect(codes({ ...HOMME, split: 'perso', customSplit: maigre })).toContain('proteines-tres-basses')

    // 15 % de 2 345 kcal = 88 g pour 80 kg, soit 1,1 g/kg : au-dessus de
    // l'apport de reference, mais sous le plancher d'un deficit.
    const moyen = { proteins: 15, carbs: 55, fats: 30 }
    const enDeficit = codes({ ...HOMME, goal: 'perte', split: 'perso', customSplit: moyen })
    expect(enDeficit).toContain('proteines-basses-deficit')
    expect(enDeficit).not.toContain('proteines-tres-basses')

    // Meme repartition hors deficit : ce n'est plus le muscle qui est en jeu.
    expect(codes({ ...HOMME, split: 'perso', customSplit: moyen })).not.toContain('proteines-basses-deficit')
  })

  it('signale un exces de proteines', () => {
    expect(codes({ ...HOMME, split: 'perso', customSplit: { proteins: 60, carbs: 20, fats: 20 } }))
      .toContain('proteines-tres-hautes')
  })

  it('signale le plancher de securite', () => {
    const t = estimateTargets(
      { sex: 'f', birthYear: 1966, heightCm: 150, weightKg: 45, activity: 'sedentaire', goal: 'seche' },
      NOW)!
    expect(effetsSecondaires(t).map((a) => a.code)).toContain('plancher')
  })

  it('n’avertit jamais sans dire ce qui le declenche', () => {
    // Un avertissement sans constat serait un reproche sans motif : la personne
    // ne saurait pas quel curseur bouger.
    const extreme = estimateTargets(
      { ...HOMME, goal: 'seche', split: 'perso', customSplit: { proteins: 70, carbs: 5, fats: 25 } }, NOW)!
    const avis = effetsSecondaires(extreme)
    expect(avis.length).toBeGreaterThan(1)
    for (const a of avis) {
      expect(a.constat.length, a.code).toBeGreaterThan(10)
      expect([a.court, a.moyen, a.long].some(Boolean), a.code).toBe(true)
      expect(['attention', 'serieux']).toContain(a.gravite)
    }
  })

  it('couvre les repartitions proposees sans rien signaler', () => {
    // Si une repartition du catalogue declenchait un avertissement, c'est le
    // catalogue qu'il faudrait corriger, pas l'avertissement.
    for (const s of MACRO_SPLITS) {
      if (s.code === 'perso') continue
      const avis = codes({ ...HOMME, split: s.code })
      expect(avis, `${s.code} : ${avis.join(', ')}`).toEqual([])
    }
  })
})

describe('hydrationTarget', () => {
  // Valeurs posees a la main depuis 30 ml/kg, arrondies a la centaine :
  //   80 kg -> 2400   |   62 kg -> 1860 -> 1900   |   55 kg -> 1650 -> 1700
  it('rend 30 ml par kilo, arrondis a la centaine', () => {
    expect(hydrationTarget(80)).toEqual({ ml: 2400, estimated: true })
    expect(hydrationTarget(62)).toEqual({ ml: 1900, estimated: true })
    expect(hydrationTarget(55)).toEqual({ ml: 1700, estimated: true })
  })

  it('borne aux deux extremites', () => {
    // 40 kg -> 1200, sous le plancher ; 150 kg -> 4500, au-dessus du plafond.
    expect(hydrationTarget(40).ml).toBe(HYDRATION_BOUNDS.min)
    expect(hydrationTarget(150).ml).toBe(HYDRATION_BOUNDS.max)
  })

  it('rend le repere general, et le DIT, quand le poids manque', () => {
    // `estimated: false` est le point du test : l'ecran doit pouvoir annoncer
    // « repere general » plutot que de faire passer 2 L pour un calcul.
    for (const absent of [null, 0, -5, Number.NaN]) {
      expect(hydrationTarget(absent), String(absent)).toEqual({ ml: 2000, estimated: false })
    }
  })
})

// ---------------------------------------------------------------------------
// Les trois directions
// ---------------------------------------------------------------------------

describe('GOAL_DIRECTIONS', () => {
  it('couvre les six objectifs, sans doublon ni oubli', () => {
    const groupes = GOAL_DIRECTIONS.flatMap((d) => d.goals as readonly string[])
    const codes = ENERGY_GOALS.map((g) => g.code)
    // Une tuile qui oublierait un objectif le rendrait inatteignable, et un
    // profil deja enregistre dessus n'aurait plus aucune tuile active.
    expect([...groupes].sort()).toEqual([...codes].sort())
    expect(new Set(groupes).size).toBe(groupes.length)
  })

  it('range chaque direction du plus doux au plus marque', () => {
    for (const direction of GOAL_DIRECTIONS) {
      const ecarts = direction.goals.map(
        (code) => ENERGY_GOALS.find((g) => g.code === code)?.adjust ?? 0,
      )
      const parAmpleur = [...ecarts].sort((a, b) => Math.abs(a) - Math.abs(b))
      expect(ecarts).toEqual(parAmpleur)
    }
  })

  it('met les objectifs dans le bon sens', () => {
    for (const direction of GOAL_DIRECTIONS) {
      for (const code of direction.goals) {
        const ecart = ENERGY_GOALS.find((g) => g.code === code)?.adjust ?? 0
        if (direction.code === 'perdre') expect(ecart).toBeLessThan(0)
        if (direction.code === 'maintenir') expect(ecart).toBe(0)
        if (direction.code === 'prendre') expect(ecart).toBeGreaterThan(0)
      }
    }
  })
})

describe('directionOf', () => {
  it('retrouve la direction de chaque objectif', () => {
    expect(directionOf('seche')).toBe('perdre')
    expect(directionOf('perte')).toBe('perdre')
    expect(directionOf('perte_douce')).toBe('perdre')
    expect(directionOf('maintien')).toBe('maintenir')
    expect(directionOf('prise_seche')).toBe('prendre')
    expect(directionOf('prise')).toBe('prendre')
  })

  it('rend null quand aucun objectif n’est choisi', () => {
    expect(directionOf(null)).toBeNull()
    expect(directionOf(undefined)).toBeNull()
  })
})

describe('goalForDirection', () => {
  it('garde l’objectif en cours s’il appartient deja a la direction', () => {
    // Taper sur la tuile deja active ne doit rien changer : quelqu'un qui a
    // choisi « Sèche » et retape sur « Perdre » ne veut pas retomber sur
    // « Perte progressive ».
    expect(goalForDirection('perdre', 'seche')).toBe('seche')
    expect(goalForDirection('perdre', 'perte')).toBe('perte')
    expect(goalForDirection('prendre', 'prise')).toBe('prise')
  })

  it('prend le plus doux en changeant de direction', () => {
    expect(goalForDirection('perdre', 'prise')).toBe('perte_douce')
    expect(goalForDirection('prendre', 'seche')).toBe('prise_seche')
    expect(goalForDirection('maintenir', 'seche')).toBe('maintien')
  })

  it('prend le plus doux quand rien n’est choisi', () => {
    expect(goalForDirection('perdre', null)).toBe('perte_douce')
    expect(goalForDirection('prendre', undefined)).toBe('prise_seche')
  })

  it('ne rend jamais un ecart de plus de 10 % par defaut', () => {
    for (const direction of GOAL_DIRECTIONS) {
      const defaut = goalForDirection(direction.code, null)
      const ecart = ENERGY_GOALS.find((g) => g.code === defaut)?.adjust ?? 0
      expect(Math.abs(ecart)).toBeLessThanOrEqual(0.1)
    }
  })
})

describe('lowProteins se juge sur l’ecart APPLIQUE', () => {
  /*
   * Le drapeau se lisait sur le signe de l'OBJECTIF, pas sur celui du calcul.
   * Or une allure vers un poids vise l'emporte sur l'objectif : viser 135 kg
   * quand on en pese 130, avec un objectif « seche », produit un SURPLUS.
   * L'avertissement « en deficit, la masse musculaire paie » s'affichait alors
   * sur un calcul qui AJOUTE de l'energie.
   *
   * Reference calculee a la main. Homme, 130 kg, 180 cm, 30 ans, sedentaire :
   *   BMR  = 1300 + 1125 - 150 + 5 = 2280
   *   TDEE = 2280 x 1,2            = 2736
   * Repartition « endurance », 20 % de proteines, choisie pour que le seuil de
   * 1,2 g/kg soit franchi dans les deux sens.
   */
  const LOURD: Profile = {
    sex: 'm',
    birthYear: 1996,
    heightCm: 180,
    weightKg: 130,
    activity: 'sedentaire',
    goal: 'seche',
    split: 'endurance',
  }

  it('ne s’allume pas quand le poids vise renverse le calcul en surplus', () => {
    // Allure lente vers un poids PLUS LOURD :
    //   ecart journalier = 0,25 x 7700 / 7 = 275 kcal, en PLUS
    //   ratio  = +275 / 2736            = +10,05 %  (sous le plafond de 25 %)
    //   cible  = 2736 x 1,1005          = 3011 kcal
    //   prot.  = 3011 x 20 % / 4        = 151 g, soit 1,16 g/kg
    const cibles = estimateTargets({ ...LOURD, targetWeightKg: 135, pace: 'lent' }, NOW)
    expect(cibles).not.toBeNull()
    expect(cibles!.kcal).toBe(3011)
    expect(cibles!.kcal).toBeGreaterThan(cibles!.tdee)
    expect(cibles!.proteinsPerKg).toBeLessThan(MIN_PROTEINS_PER_KG)
    expect(cibles!.lowProteins).toBe(false)
  })

  it('s’allume toujours sur un vrai deficit', () => {
    //   cible = 2736 x 0,8       = 2189 kcal
    //   prot. = 2189 x 20 % / 4  = 110 g, soit 0,85 g/kg
    const cibles = estimateTargets(LOURD, NOW)
    expect(cibles).not.toBeNull()
    expect(cibles!.kcal).toBe(2189)
    expect(cibles!.kcal).toBeLessThan(cibles!.tdee)
    expect(cibles!.proteinsPerKg).toBeLessThan(MIN_PROTEINS_PER_KG)
    expect(cibles!.lowProteins).toBe(true)
  })
})
