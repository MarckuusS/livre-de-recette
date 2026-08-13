/**
 * Lire une serie de pesees.
 *
 * Une balance ment tous les matins : sel, hydratation, transit, heure de la
 * mesure font varier le chiffre de plus d'un kilo d'un jour a l'autre, quand
 * la vraie evolution se compte en centaines de grammes par SEMAINE. Lire la
 * pesee du jour, c'est donc lire surtout du bruit.
 *
 * Tout ce module existe pour separer la TENDANCE du BRUIT, et pour ne repondre
 * qu'a des questions dont la reponse a un sens : a quel rythme est-ce que je
 * descends, quand vais-je arriver, est-ce que je suis dans les temps.
 *
 * Module PUR : aucune date "maintenant" implicite, aucun acces reseau. Le jour
 * de reference se passe en parametre, sans quoi les tests dependraient de
 * l'heure a laquelle on les lance.
 */

/** Une pesee. `day` au format AAAA-MM-JJ, jour LOCAL. */
export interface WeighIn {
  readonly day: string
  readonly weightKg: number
}

/** Un point de la moyenne lissee. */
export interface TrendPoint {
  readonly day: string
  /** Pesee brute de ce jour, `null` si l'on ne s'est pas pese. */
  readonly raw: number | null
  /** Moyenne des pesees de la fenetre glissante, `null` si la fenetre est vide. */
  readonly smoothed: number | null
}

/** Jours entre deux dates AAAA-MM-JJ. Positif si `b` est apres `a`. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/** `AAAA-MM-JJ` decale de `n` jours. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Moyenne mobile sur une fenetre de N jours, un point par jour.
 *
 * FENETRE EN JOURS, PAS EN MESURES. On ne se pese pas tous les jours, et
 * moyenner "les 7 dernieres pesees" melangerait sept jours pour qui se pese
 * chaque matin et six semaines pour qui se pese le dimanche. La fenetre suit
 * le calendrier, ce qui rend la pente comparable d'une personne a l'autre.
 *
 * Un jour sans pesee garde `raw: null` mais recoit tout de meme une moyenne,
 * calculee sur les pesees presentes dans sa fenetre : c'est ce qui permet de
 * tracer une ligne continue sur une serie trouee.
 */
export function movingAverage(weighIns: readonly WeighIn[], windowDays = 7): TrendPoint[] {
  if (weighIns.length === 0) return []

  const tries = [...weighIns].sort((a, b) => a.day.localeCompare(b.day))
  const premier = tries[0]?.day ?? ''
  const dernier = tries[tries.length - 1]?.day ?? ''
  const parJour = new Map(tries.map((w) => [w.day, w.weightKg]))

  const points: TrendPoint[] = []
  for (let i = 0; i <= daysBetween(premier, dernier); i += 1) {
    const day = addDays(premier, i)

    const fenetre: number[] = []
    for (let k = 0; k < windowDays; k += 1) {
      const valeur = parJour.get(addDays(day, -k))
      if (valeur !== undefined) fenetre.push(valeur)
    }

    points.push({
      day,
      raw: parJour.get(day) ?? null,
      smoothed:
        fenetre.length === 0 ? null : fenetre.reduce((s, v) => s + v, 0) / fenetre.length,
    })
  }
  return points
}

/**
 * Rythme en kg par semaine, sur les N derniers jours.
 *
 * Regression lineaire des moindres carres sur la MOYENNE LISSEE, et non sur
 * les pesees brutes : une seule journee salee en fin de periode ferait
 * basculer la pente d'un simple ecart entre premier et dernier point. La
 * regression pese tous les jours de la fenetre.
 *
 * Rend `null` sous deux points ou sur une fenetre trop courte : annoncer un
 * rythme sur trois jours serait annoncer du bruit avec deux decimales.
 */
export function weeklyPace(
  points: readonly TrendPoint[],
  today: string,
  windowDays = 28,
): number | null {
  const debut = addDays(today, -windowDays)
  const retenus = points.filter((p) => p.smoothed !== null && p.day > debut)
  if (retenus.length < 2) return null
  if (daysBetween(retenus[0]?.day ?? today, retenus[retenus.length - 1]?.day ?? today) < 7) {
    return null
  }

  const base = retenus[0]?.day ?? today
  const xs = retenus.map((p) => daysBetween(base, p.day))
  const ys = retenus.map((p) => p.smoothed as number)
  const n = xs.length
  const moyX = xs.reduce((s, v) => s + v, 0) / n
  const moyY = ys.reduce((s, v) => s + v, 0) / n

  let num = 0
  let den = 0
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] as number) - moyX
    num += dx * ((ys[i] as number) - moyY)
    den += dx * dx
  }
  if (den === 0) return null

  // Pente en kg/jour, ramenee a la semaine.
  return (num / den) * 7
}

export interface Cap {
  /** Poids lisse d'aujourd'hui, la valeur qu'il faut lire au lieu de la pesee. */
  readonly currentKg: number
  /** Premiere mesure de la serie : le point de depart du chemin parcouru. */
  readonly startKg: number
  readonly targetKg: number
  /** Kilos restants, en valeur absolue. */
  readonly remainingKg: number
  /** Part du chemin faite, entre 0 et 1. Bornee : on peut depasser sa cible. */
  readonly progress: number
  /** kg par semaine, negatif en perte. `null` si la serie est trop courte. */
  readonly paceKgPerWeek: number | null
  /** Date d'arrivee estimee au rythme observe, `null` si l'on n'y va pas. */
  readonly etaDay: string | null
  /**
   * Jours de marge par rapport a la date visee. Positif = en avance.
   * `null` si l'un des deux manque.
   */
  readonly marginDays: number | null
  readonly onTrack: boolean | null
}

/**
 * Ou en est-on, et y arrive-t-on.
 *
 * `etaDay` est `null` quand le rythme N'AVANCE PAS vers la cible : rythme nul,
 * ou de mauvais signe. Annoncer une date dans ce cas serait promettre l'inverse
 * de ce qui arrive. C'est la meme regle que `weeksToTarget` dans profile.ts.
 */
export function readCap(
  points: readonly TrendPoint[],
  today: string,
  targetKg: number | null,
  targetDay: string | null,
): Cap | null {
  const lisses = points.filter((p) => p.smoothed !== null)
  const premier = lisses[0]
  const dernier = lisses[lisses.length - 1]
  if (premier === undefined || dernier === undefined) return null

  const currentKg = dernier.smoothed as number
  const startKg = premier.smoothed as number
  if (targetKg === null) {
    return {
      currentKg,
      startKg,
      targetKg: currentKg,
      remainingKg: 0,
      progress: 1,
      paceKgPerWeek: weeklyPace(points, today),
      etaDay: null,
      marginDays: null,
      onTrack: null,
    }
  }

  const total = Math.abs(targetKg - startKg)
  const restant = Math.abs(targetKg - currentKg)
  const pace = weeklyPace(points, today)

  // Le rythme va-t-il DANS le bon sens ? Descendre quand on vise plus bas.
  const sens = Math.sign(targetKg - currentKg)
  const avance = pace !== null && sens !== 0 && Math.sign(pace) === sens && Math.abs(pace) > 0.01

  /*
   * On arrondit AVANT de plafonner, et ce n'est pas de la coquetterie.
   * 3,65 / 0,35 x 7 vaut 73,00000000000001 en virgule flottante : `ceil` seul
   * rend 74, et la date d'arrivee sautait d'un jour entier selon les chiffres
   * saisis. La tolerance absorbe l'erreur de representation sans toucher aux
   * vraies fractions de jour, qui elles doivent bien monter au jour suivant.
   */
  const jours = (restant / Math.abs(pace as number)) * 7
  const etaDay = avance ? addDays(today, Math.ceil(jours - 1e-9)) : null
  const marginDays = etaDay !== null && targetDay !== null ? daysBetween(etaDay, targetDay) : null

  return {
    currentKg,
    startKg,
    targetKg,
    remainingKg: restant,
    progress: total === 0 ? 1 : Math.min(1, Math.max(0, (total - restant) / total)),
    paceKgPerWeek: pace,
    etaDay,
    marginDays,
    onTrack: marginDays === null ? null : marginDays >= 0,
  }
}

/** Zone de perte consideree sure, en kg par semaine. Au-dela, on perd du muscle. */
export const SAFE_PACE = { min: 0.2, max: 1.0 } as const

/** Indice de masse corporelle. `null` si l'une des deux mesures manque. */
export function bmi(weightKg: number | null, heightCm: number | null): number | null {
  if (weightKg === null || heightCm === null || heightCm <= 0) return null
  const m = heightCm / 100
  return weightKg / (m * m)
}

/** Les quatre zones de l'OMS. Le libelle est celui qu'on affiche. */
export function bmiZone(value: number): string {
  if (value < 18.5) return 'Insuffisance pondérale'
  if (value < 25) return 'Zone normale'
  if (value < 30) return 'Surpoids'
  return 'Obésité'
}
