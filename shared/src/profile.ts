/**
 * Profil alimentaire et sportif, et objectifs qui en decoulent.
 *
 * Module PUR : aucune base, aucun reseau. C'est ce qui permet de le tester
 * comme une specification, et c'est important ici — les chiffres qu'il produit
 * sont affiches comme des reperes de sante.
 *
 * ---------------------------------------------------------------------------
 * DEUX AXES, ET NON UN SEUL
 * ---------------------------------------------------------------------------
 * La premiere version confondait deux questions dans une liste de trois
 * entrees : COMBIEN d'energie (perdre / maintenir / prendre) et COMMENT elle se
 * repartit (30/35/35…). Les deux etaient soudees, donc « perdre du poids »
 * imposait sa repartition, et vouloir des proteines hautes obligeait a changer
 * d'objectif de poids.
 *
 * Elles sont maintenant separees :
 *
 *   - `ENERGY_GOALS` decide de la CIBLE EN KCAL — l'ecart a la depense estimee.
 *   - `MACRO_SPLITS` decide du PARTAGE de cette energie entre les trois macros.
 *
 * Chaque objectif propose une repartition par defaut, que l'utilisateur peut
 * remplacer par une autre, ou ecrire lui-meme. C'est le point de la separation :
 * une seche et une prise de masse peuvent partager une repartition, deux
 * personnes en perte de poids peuvent en vouloir des differentes.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE MODULE N'EST PAS
 * ---------------------------------------------------------------------------
 * Ce n'est pas un avis medical, et l'interface doit le dire. Mifflin-St Jeor
 * est une ESTIMATION statistique du metabolisme de base : elle ignore la
 * composition corporelle, la genetique, les traitements, la grossesse et
 * l'allaitement. Un ecart de 10 a 15 % avec la depense reelle est normal.
 *
 * D'ou des garde-fous inscrits dans le code plutot que laisses a la vigilance
 * de l'interface : un plancher de kcal, un plafond d'allure, et des drapeaux
 * que l'ecran est oblige de regarder (`floored`, `capped`, `lowProteins`,
 * `lowFats`).
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

// ---------------------------------------------------------------------------
// Repartitions
// ---------------------------------------------------------------------------

export interface MacroSplit {
  readonly proteins: number
  readonly carbs: number
  readonly fats: number
}

/**
 * Repartitions proposees, en part de l'ENERGIE et non en grammes.
 *
 * L'energie est la seule unite qui reste valable quand la cible en kcal change :
 * une repartition en grammes devrait etre reecrite a chaque kilo perdu.
 *
 * Aucune ne descend sous 20 % de lipides. En dessous, l'apport ne couvre plus
 * les besoins hormonaux et l'absorption des vitamines liposolubles — c'est la
 * limite basse communement citee, et `estimateTargets` la surveille meme sur
 * une repartition ecrite a la main.
 */
export const MACRO_SPLITS = [
  {
    code: 'equilibre',
    label: 'Équilibrée',
    hint: 'Le partage courant, sans parti pris',
    split: { proteins: 25, carbs: 45, fats: 30 },
  },
  {
    code: 'proteine',
    label: 'Riche en protéines',
    hint: 'Rassasie davantage à énergie égale',
    split: { proteins: 35, carbs: 35, fats: 30 },
  },
  {
    code: 'seche',
    label: 'Sèche',
    hint: 'Protéines hautes pour préserver le muscle en déficit',
    split: { proteins: 40, carbs: 30, fats: 30 },
  },
  {
    code: 'faible_glucides',
    label: 'Faible en glucides',
    hint: 'Les lipides prennent la place des glucides',
    split: { proteins: 30, carbs: 20, fats: 50 },
  },
  {
    code: 'endurance',
    label: 'Endurance',
    hint: 'Glucides hauts, pour les sorties longues',
    split: { proteins: 20, carbs: 55, fats: 25 },
  },
  {
    code: 'mediterraneen',
    label: 'Méditerranéenne',
    hint: 'Lipides d’origine végétale, glucides modérés',
    split: { proteins: 20, carbs: 45, fats: 35 },
  },
  {
    code: 'perso',
    label: 'Personnalisée',
    hint: 'Trois pourcentages qui totalisent 100',
    split: null,
  },
] as const

export type SplitCode = (typeof MACRO_SPLITS)[number]['code']

// ---------------------------------------------------------------------------
// Objectifs energetiques
// ---------------------------------------------------------------------------

/**
 * Objectifs, et l'ecart qu'ils creusent par rapport a la depense estimee.
 *
 * L'ajustement est un POURCENTAGE de la depense et non un forfait de 500 kcal :
 * retrancher 500 a quelqu'un qui depense 1 800 est une coupe de 28 %, la meme
 * coupe a quelqu'un qui depense 3 200 n'en fait que 16. Le pourcentage traite
 * les deux de la meme facon.
 *
 * `perte`, `maintien` et `prise` sont les trois codes d'origine : ils restent
 * pour que les profils deja enregistres continuent de se lire.
 *
 * `defaultSplit` n'est qu'une PROPOSITION. Elle s'applique tant que personne
 * n'a choisi de repartition, et cede des que quelqu'un en choisit une.
 */
export const ENERGY_GOALS = [
  {
    code: 'seche',
    label: 'Sèche',
    hint: 'Déficit marqué, protéines hautes',
    adjust: -0.2,
    defaultSplit: 'seche',
  },
  {
    code: 'perte',
    label: 'Perdre du poids',
    hint: 'Environ 15 % sous la dépense estimée',
    adjust: -0.15,
    defaultSplit: 'proteine',
  },
  {
    code: 'perte_douce',
    label: 'Perte progressive',
    hint: 'Déficit léger, tenable sur la durée',
    adjust: -0.1,
    defaultSplit: 'equilibre',
  },
  {
    code: 'maintien',
    label: 'Maintenir mon poids',
    hint: 'À la hauteur de la dépense estimée',
    adjust: 0,
    defaultSplit: 'equilibre',
  },
  {
    code: 'prise_seche',
    label: 'Prise de masse sèche',
    hint: 'Léger surplus, pour limiter le gras pris',
    adjust: 0.1,
    defaultSplit: 'proteine',
  },
  {
    code: 'prise',
    label: 'Prise de masse',
    hint: 'Surplus franc',
    adjust: 0.2,
    defaultSplit: 'proteine',
  },
] as const

export type GoalCode = (typeof ENERGY_GOALS)[number]['code']

export type Sex = 'f' | 'm'

// ---------------------------------------------------------------------------
// Garde-fous
// ---------------------------------------------------------------------------

/**
 * Plancher de securite, en kcal par jour.
 *
 * En dessous, un apport ne couvre plus les besoins de base d'un adulte et
 * releve d'un suivi medical, pas d'une application de recettes. Les valeurs
 * retenues sont les seuils communement cites pour un regime non supervise.
 */
export const MIN_SAFE_KCAL: Record<Sex, number> = { f: 1200, m: 1500 }

/**
 * Ecart maximal a la depense, en part de celle-ci.
 *
 * Sert quand l'ecart vient d'une ALLURE demandee (« 1 kg par semaine ») et non
 * d'un pourcentage choisi : une allure ambitieuse sur une petite depense donne
 * vite un deficit de 50 %. Le plafond le ramene a 25 %, et le drapeau `capped`
 * oblige l'ecran a dire que l'allure demandee ne sera pas tenue.
 */
export const MAX_ADJUST = 0.25

/** Part minimale de l'energie en lipides, sous laquelle on avertit. */
export const MIN_FAT_PERCENT = 20

/** Proteines minimales en g/kg, sous lesquelles on avertit en deficit. */
export const MIN_PROTEINS_PER_KG = 1.2

/**
 * Energie d'un kilo de masse corporelle, en kcal.
 *
 * Approximation classique (un kilo de tissu adipeux ≈ 7 700 kcal). Elle sert a
 * convertir une allure en kg/semaine en un ecart journalier. Elle SURESTIME les
 * premieres semaines, ou la balance bouge surtout par l'eau ; c'est une regle
 * de conversion, pas une promesse.
 */
export const KCAL_PER_KG = 7700

/** Allures proposees, en kg par semaine. */
export const PACES = [
  { code: 'lent', label: 'Lente', kgPerWeek: 0.25, hint: 'Le plus confortable, le plus lent' },
  { code: 'modere', label: 'Modérée', kgPerWeek: 0.5, hint: 'Le compromis habituel' },
  { code: 'rapide', label: 'Rapide', kgPerWeek: 0.75, hint: 'Exigeant, difficile à tenir longtemps' },
] as const

export type PaceCode = (typeof PACES)[number]['code']

// ---------------------------------------------------------------------------

export interface Profile {
  readonly sex: Sex | null
  readonly birthYear: number | null
  readonly heightCm: number | null
  readonly weightKg: number | null
  readonly activity: ActivityCode | null
  readonly goal: GoalCode | null
  /** Repartition choisie. `null` = celle que propose l'objectif. */
  readonly split?: SplitCode | null
  /** Pourcentages ecrits a la main. Lus seulement si `split === 'perso'`. */
  readonly customSplit?: MacroSplit | null
  /** Poids vise, en kg. `null` = pas d'arrivee, seulement une direction. */
  readonly targetWeightKg?: number | null
  /** Allure visee. Lue seulement en presence d'un poids vise. */
  readonly pace?: PaceCode | null
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
  /** Cible journaliere, apres ajustement et garde-fous. */
  readonly kcal: number
  readonly proteins: MacroTarget
  readonly carbs: MacroTarget
  readonly fats: MacroTarget
  /** Repartition finalement appliquee, et d'ou elle vient. */
  readonly split: MacroSplit
  readonly splitCode: SplitCode
  /** Proteines rapportees au poids — l'unite dans laquelle elles se jugent. */
  readonly proteinsPerKg: number

  /** Vrai si le plancher de securite a releve la cible. */
  readonly floored: boolean
  /** Vrai si l'allure demandee depassait `MAX_ADJUST` et a ete ramenee. */
  readonly capped: boolean
  /** Vrai si les proteines tombent sous `MIN_PROTEINS_PER_KG` en deficit. */
  readonly lowProteins: boolean
  /** Vrai si les lipides tombent sous `MIN_FAT_PERCENT`. */
  readonly lowFats: boolean

  /** Semaines estimees jusqu'au poids vise, s'il y en a un. */
  readonly weeksToTarget: number | null
  /** Date d'arrivee estimee, au format `yyyy-mm-dd`. */
  readonly targetDate: string | null
  /** Kilos restants (valeur absolue), s'il y a un poids vise. */
  readonly kgToTarget: number | null
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
 * Ramene trois pourcentages a un total de 100.
 *
 * Une repartition ecrite a la main arrive rarement juste, et un total de 97
 * produirait une cible qui ne consomme pas toute l'energie annoncee — sans que
 * rien ne l'explique a la lecture. Le reste d'arrondi va aux glucides, la macro
 * dont le gramme se lit le moins precisement.
 */
export function normalizeSplit(split: MacroSplit): MacroSplit {
  const total = split.proteins + split.carbs + split.fats
  if (total <= 0) return { proteins: 25, carbs: 45, fats: 30 }

  const proteins = Math.round((split.proteins / total) * 100)
  const fats = Math.round((split.fats / total) * 100)
  return { proteins, fats, carbs: 100 - proteins - fats }
}

/** La repartition d'un code, ou `null` pour `perso` (qui n'en porte pas). */
export const splitOf = (code: SplitCode): MacroSplit | null =>
  MACRO_SPLITS.find((s) => s.code === code)?.split ?? null

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
  const target = ENERGY_GOALS.find((g) => g.code === goal)
  if (!level || !target) return null

  const bmr = Math.round(basalMetabolicRate(sex, weightKg, heightCm, age))
  const tdee = Math.round(bmr * level.factor)

  // ---- L'ecart : soit une allure vers un poids vise, soit un pourcentage ----
  //
  // L'allure l'emporte quand elle est exploitable : « atteindre 68 kg à 0,5 kg
  // par semaine » est une intention plus precise que « perdre du poids », et
  // c'est elle qui doit decider du deficit.
  const goalDirection = Math.sign(target.adjust)
  const kgToTarget =
    profile.targetWeightKg != null ? Math.abs(profile.targetWeightKg - weightKg) : null

  const paceKgWeek = profile.pace != null ? PACES.find((p) => p.code === profile.pace)?.kgPerWeek : undefined

  let ratio = target.adjust
  let capped = false

  if (profile.targetWeightKg != null && paceKgWeek !== undefined && kgToTarget !== null && kgToTarget > 0) {
    // La direction vient de l'ECART REEL, jamais de l'objectif : quelqu'un qui
    // vise plus lourd que son poids actuel prend du poids, meme si l'objectif
    // affiche dit « perdre » — c'est le poids vise qui est explicite.
    const direction = profile.targetWeightKg > weightKg ? 1 : -1
    const dailyDelta = (paceKgWeek * KCAL_PER_KG) / 7
    ratio = (direction * dailyDelta) / tdee
  }

  if (Math.abs(ratio) > MAX_ADJUST) {
    ratio = Math.sign(ratio) * MAX_ADJUST
    capped = true
  }

  const wanted = Math.round(tdee * (1 + ratio))
  const floor = MIN_SAFE_KCAL[sex]
  const kcal = Math.max(wanted, floor)

  // ---- La repartition ----
  const splitCode: SplitCode = profile.split ?? target.defaultSplit
  const chosen =
    splitCode === 'perso'
      ? (profile.customSplit ?? splitOf(target.defaultSplit) ?? { proteins: 25, carbs: 45, fats: 30 })
      : (splitOf(splitCode) ?? splitOf(target.defaultSplit) ?? { proteins: 25, carbs: 45, fats: 30 })
  const split = normalizeSplit(chosen)

  const macro = (key: keyof typeof KCAL_PER_G): MacroTarget => {
    const percent = split[key]
    const macroKcal = Math.round((kcal * percent) / 100)
    return { percent, kcal: macroKcal, grams: Math.round(macroKcal / KCAL_PER_G[key]) }
  }

  const proteins = macro('proteins')
  const carbs = macro('carbs')
  const fats = macro('fats')
  const proteinsPerKg = proteins.grams / weightKg

  // ---- Combien de temps ----
  //
  // Calcule sur l'ecart REELLEMENT applique, pas sur l'allure demandee : quand
  // le plafond ou le plancher est intervenu, annoncer la date de l'allure
  // demandee serait promettre ce que la cible ne produira pas.
  // Et surtout : la cible se RAPPROCHE-t-elle ? Le plancher de securite peut
  // relever l'apport au-dessus de la depense, ce qui fait grossir quelqu'un qui
  // visait plus leger. Annoncer alors « 63 semaines » serait promettre une
  // arrivee dans la mauvaise direction. `weeksToTarget` reste `null` : a
  // l'ecran de dire que le reglage n'y mene pas.
  const appliedDelta = tdee - kcal // > 0 en deficit
  const kgPerWeek = (Math.abs(appliedDelta) * 7) / KCAL_PER_KG
  const needsLoss = profile.targetWeightKg != null && profile.targetWeightKg < weightKg
  const progressing = needsLoss ? appliedDelta > 0 : appliedDelta < 0
  const weeksToTarget =
    kgToTarget !== null && kgToTarget > 0 && kgPerWeek > 0 && progressing
      ? Math.ceil(kgToTarget / kgPerWeek)
      : null

  return {
    bmr,
    tdee,
    kcal,
    proteins,
    carbs,
    fats,
    split,
    splitCode,
    proteinsPerKg,
    floored: kcal > wanted,
    capped,
    // L'avertissement ne vaut qu'en deficit : c'est la que le muscle part.
    lowProteins: goalDirection < 0 && proteinsPerKg < MIN_PROTEINS_PER_KG,
    lowFats: split.fats < MIN_FAT_PERCENT,
    weeksToTarget,
    targetDate: weeksToTarget === null ? null : addWeeks(now, weeksToTarget),
    kgToTarget,
  }
}

/**
 * `yyyy-mm-dd`, N semaines apres une date.
 *
 * Arithmetique en UTC : la meme entree doit rendre la meme date, que le calcul
 * tourne dans le navigateur d'un telephone en France ou dans un Worker de
 * Cloudflare. Sur une estimation a plusieurs semaines, le fuseau ne dit rien
 * d'utile — mais un desaccord d'un jour entre les deux cotes, si.
 */
function addWeeks(from: Date, weeks: number): string {
  const d = new Date(from.getTime())
  d.setUTCDate(d.getUTCDate() + weeks * 7)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
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
