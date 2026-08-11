/**
 * Profil alimentaire et sportif, et objectifs qui en decoulent.
 *
 * Module PUR : aucune base, aucun reseau. C'est ce qui permet de le tester
 * comme une specification, et c'est important ici — les chiffres qu'il produit
 * sont affiches comme des reperes de sante.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE MODULE N'EST PAS
 * ---------------------------------------------------------------------------
 * Ce n'est pas un avis medical, et l'interface doit le dire. Mifflin-St Jeor
 * est une ESTIMATION statistique du metabolisme de base : elle ignore la
 * composition corporelle, la genetique, les traitements, la grossesse et
 * l'allaitement. Un ecart de 10 a 15 % avec la depense reelle est normal.
 *
 * D'ou deux garde-fous inscrits dans le code plutot que laisses a la vigilance
 * de l'interface :
 *
 *   - `MIN_SAFE_KCAL`, un plancher sous lequel aucune cible n'est proposee ;
 *   - `estimateTargets` rend `null` des qu'une mesure manque, plutot qu'un
 *     chiffre construit sur des valeurs par defaut inventees.
 */

/**
 * Niveaux d'activite et leur facteur.
 *
 * Facteurs usuels de la litterature sur Harris-Benedict et Mifflin-St Jeor.
 * Les libelles decrivent la SEMAINE entiere, sport compris : c'est l'erreur de
 * saisie la plus frequente que d'additionner mentalement un facteur « actif »
 * et des seances de sport deja comptees dedans.
 */
export const ACTIVITY_LEVELS = [
  { code: 'sedentaire', label: 'Sédentaire', hint: 'Bureau, peu de marche, pas de sport', factor: 1.2 },
  { code: 'leger', label: 'Légèrement actif', hint: 'Sport 1 à 3 fois par semaine', factor: 1.375 },
  { code: 'actif', label: 'Actif', hint: 'Sport 3 à 5 fois par semaine', factor: 1.55 },
  { code: 'sportif', label: 'Très actif', hint: 'Sport 6 à 7 fois par semaine', factor: 1.725 },
  { code: 'athlete', label: 'Athlète', hint: 'Deux entraînements par jour, métier physique', factor: 1.9 },
] as const

export type ActivityCode = (typeof ACTIVITY_LEVELS)[number]['code']

/**
 * Objectifs de poids, et repartition des macros associee.
 *
 * L'ajustement est un POURCENTAGE de la depense et non un forfait de 500 kcal :
 * retrancher 500 a quelqu'un qui depense 1 800 est une coupe de 28 %, la meme
 * coupe a quelqu'un qui depense 3 200 n'en fait que 16. Le pourcentage traite
 * les deux de la meme facon.
 *
 * Les repartitions sont exprimees en part de l'ENERGIE, pas en grammes : c'est
 * le langage que parle deja l'anneau des macros, et le seul qui reste valable
 * quand la cible en kcal change.
 */
export const WEIGHT_GOALS = [
  {
    code: 'perte',
    label: 'Perdre du poids',
    hint: 'Environ 15 % sous la dépense estimée',
    adjust: -0.15,
    // Proteines hautes : c'est ce qui preserve la masse maigre quand l'apport
    // baisse, et ce qui rassasie le plus a energie egale.
    split: { proteins: 30, carbs: 35, fats: 35 },
  },
  {
    code: 'maintien',
    label: 'Maintenir mon poids',
    hint: 'À la hauteur de la dépense estimée',
    adjust: 0,
    split: { proteins: 25, carbs: 45, fats: 30 },
  },
  {
    code: 'prise',
    label: 'Prendre du poids',
    hint: 'Environ 10 % au-dessus de la dépense estimée',
    adjust: 0.1,
    split: { proteins: 25, carbs: 50, fats: 25 },
  },
] as const

export type GoalCode = (typeof WEIGHT_GOALS)[number]['code']

export type Sex = 'f' | 'm'

/**
 * Plancher de securite, en kcal par jour.
 *
 * En dessous, un apport ne couvre plus les besoins de base d'un adulte et
 * releve d'un suivi medical, pas d'une application de recettes. Les valeurs
 * retenues sont les seuils communement cites pour un regime non supervise.
 * `estimateTargets` ne descend jamais sous ce plancher, meme si le calcul le
 * demande — et le signale, plutot que de rendre le chiffre bas en silence.
 */
export const MIN_SAFE_KCAL: Record<Sex, number> = { f: 1200, m: 1500 }

export interface Profile {
  readonly sex: Sex | null
  readonly birthYear: number | null
  readonly heightCm: number | null
  readonly weightKg: number | null
  readonly activity: ActivityCode | null
  readonly goal: GoalCode | null
}

export interface MacroTarget {
  readonly percent: number
  readonly grams: number
  readonly kcal: number
}

export interface Targets {
  /** Metabolisme de base, en kcal par jour. */
  readonly bmr: number
  /** Depense totale estimee : metabolisme de base x facteur d'activite. */
  readonly tdee: number
  /** Cible journaliere, apres ajustement d'objectif et plancher de securite. */
  readonly kcal: number
  readonly proteins: MacroTarget
  readonly carbs: MacroTarget
  readonly fats: MacroTarget
  /** Vrai si le plancher a releve la cible : l'interface doit le dire. */
  readonly floored: boolean
}

/** kcal par gramme, pour convertir une part d'energie en grammes. */
const KCAL_PER_G = { proteins: 4, carbs: 4, fats: 9 } as const

/**
 * Age revolu approximatif, a partir de l'annee de naissance.
 *
 * L'annee suffit : Mifflin-St Jeor retranche 5 kcal par annee d'age, donc une
 * erreur de douze mois deplace la cible de 5 kcal — trois cacahuetes. Demander
 * une date de naissance complete serait collecter une donnee plus sensible pour
 * un gain nul.
 */
export const ageFrom = (birthYear: number, now: Date): number => now.getFullYear() - birthYear

/**
 * Metabolisme de base — equation de Mifflin-St Jeor (1990).
 *
 *   homme : 10 x poids + 6,25 x taille - 5 x age + 5
 *   femme : 10 x poids + 6,25 x taille - 5 x age - 161
 *
 * Retenue plutot que Harris-Benedict, qu'elle a remplacee : elle est plus juste
 * sur les populations actuelles, et c'est la reference des recommandations
 * nutritionnelles depuis les annees 2000. Ce n'est pas une formule maison, et
 * c'est le point : elle est verifiable.
 */
export function basalMetabolicRate(
  sex: Sex,
  weightKg: number,
  heightCm: number,
  age: number,
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return sex === 'm' ? base + 5 : base - 161
}

/**
 * Cibles journalieres, ou `null` si le profil est incomplet.
 *
 * `null` et non une estimation partielle : une cible calculee sur un poids
 * devine serait presentee avec la meme assurance qu'une cible calculee sur un
 * poids reel, et rien a l'ecran ne les distinguerait.
 */
export function estimateTargets(profile: Profile, now: Date = new Date()): Targets | null {
  const { sex, birthYear, heightCm, weightKg, activity, goal } = profile
  if (sex === null || birthYear === null || heightCm === null || weightKg === null) return null
  if (activity === null || goal === null) return null

  const age = ageFrom(birthYear, now)
  const level = ACTIVITY_LEVELS.find((l) => l.code === activity)
  const target = WEIGHT_GOALS.find((g) => g.code === goal)
  if (!level || !target) return null

  const bmr = Math.round(basalMetabolicRate(sex, weightKg, heightCm, age))
  const tdee = Math.round(bmr * level.factor)

  const wanted = Math.round(tdee * (1 + target.adjust))
  const floor = MIN_SAFE_KCAL[sex]
  const kcal = Math.max(wanted, floor)

  const macro = (key: keyof typeof KCAL_PER_G): MacroTarget => {
    const percent = target.split[key]
    const macroKcal = Math.round((kcal * percent) / 100)
    return { percent, kcal: macroKcal, grams: Math.round(macroKcal / KCAL_PER_G[key]) }
  }

  return {
    bmr,
    tdee,
    kcal,
    proteins: macro('proteins'),
    carbs: macro('carbs'),
    fats: macro('fats'),
    floored: kcal > wanted,
  }
}

/**
 * Part d'une journee revenant a une personne.
 *
 * Le calendrier planifie pour LA CUISINE : aucune entree ne dit qui mange (voir
 * la migration 0005, ou `meal_plan_entry` ne porte que le foyer). Comparer le
 * total d'une journee a l'objectif d'une personne serait donc faux d'un facteur
 * egal au nombre de mangeurs.
 *
 * On divise par le nombre declare sur le foyer. C'est une APPROXIMATION, et
 * l'interface doit le dire : elle suppose que tout le monde mange la meme
 * chose et en meme quantite. Elle est juste pour des repas communs, fausse pour
 * une portion d'enfant ou un dejeuner pris dehors.
 */
export const perEater = (total: number, eaters: number): number =>
  eaters > 0 ? total / eaters : total

/** Ou en est-on d'une cible : part atteinte, et de combien on l'a depassee. */
export interface Progress {
  readonly ratio: number
  readonly over: boolean
  /** Ecart absolu a la cible, dans l'unite de la cible. */
  readonly gap: number
}

/**
 * Une cible nulle ou absente ne produit PAS un ratio infini : elle rend une
 * progression neutre. Un ecran qui affiche « 340 % » parce que la cible vaut
 * zero est pire que pas d'objectif du tout.
 */
export function progressToward(actual: number, target: number): Progress {
  if (!Number.isFinite(target) || target <= 0) return { ratio: 0, over: false, gap: 0 }
  return { ratio: actual / target, over: actual > target, gap: Math.abs(target - actual) }
}
