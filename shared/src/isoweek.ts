/**
 * Arithmetique des semaines ISO-8601.
 *
 * `iso_week` ('2026-W18') est la cle naturelle du calendrier : on ne stocke
 * jamais de date. Ce choix survit aux changements d'heure et s'indexe bien.
 *
 * Regle ISO-8601 : la semaine 1 est celle qui contient le premier jeudi de
 * l'annee — autrement dit celle qui contient le 4 janvier. Une annee compte
 * 52 ou 53 semaines, et les premiers jours de janvier peuvent appartenir a la
 * semaine 52/53 de l'annee precedente.
 *
 * Convention interne : les calculs se font a midi UTC pour qu'aucun decalage
 * horaire ni changement d'heure ne puisse faire basculer un jour. La lecture
 * de « aujourd'hui » utilise en revanche le calendrier LOCAL de l'utilisateur
 * — c'est le bug #29 de la spec, ou un `toISOString()` proposait la veille
 * quand on saisissait une date en soiree francaise.
 */

const DAY_MS = 86_400_000

/** Format strict. Le desktop acceptait « 2026-W 5 » car `int()` tolere les espaces (bug #23). */
const ISO_WEEK_RE = /^(\d{4})-W(\d{2})$/

export class InvalidIsoWeekError extends Error {
  constructor(value: string, reason: string) {
    super(`Semaine ISO invalide '${value}' : ${reason}`)
    this.name = 'InvalidIsoWeekError'
  }
}

export interface IsoWeekParts {
  readonly year: number
  readonly week: number
}

/** Valide et decompose une cle '2026-W18'. Leve si la forme est mauvaise. */
export function parseIsoWeek(value: string): IsoWeekParts {
  const m = ISO_WEEK_RE.exec(value)
  if (!m) throw new InvalidIsoWeekError(value, "format attendu 'YYYY-Www'")
  const year = Number(m[1])
  const week = Number(m[2])
  if (year < 2000 || year > 2100) throw new InvalidIsoWeekError(value, `annee hors bornes : ${year}`)
  if (week < 1 || week > 53) throw new InvalidIsoWeekError(value, `semaine hors bornes : ${week}`)
  if (week > weeksInIsoYear(year)) {
    throw new InvalidIsoWeekError(value, `l'annee ${year} ne compte que ${weeksInIsoYear(year)} semaines`)
  }
  return { year, week }
}

export function isValidIsoWeek(value: string): boolean {
  try {
    parseIsoWeek(value)
    return true
  } catch {
    return false
  }
}

export function formatIsoWeek(year: number, week: number): string {
  return `${String(year).padStart(4, '0')}-W${String(week).padStart(2, '0')}`
}

/** Nombre de semaines ISO d'une annee : 53 si le 1er janvier ou le 31 decembre est un jeudi. */
export function weeksInIsoYear(year: number): number {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay()
  const dec31 = new Date(Date.UTC(year, 11, 31)).getUTCDay()
  return jan1 === 4 || dec31 === 4 ? 53 : 52
}

/**
 * Semaine ISO d'une date, d'apres ses composantes LOCALES.
 * C'est ce que l'utilisateur appelle « cette semaine ».
 */
export function isoWeekOf(date: Date = new Date()): IsoWeekParts {
  // Midi UTC a partir des composantes locales : immunise contre les decalages.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12))
  const dayNum = d.getUTCDay() || 7 // lundi = 1 … dimanche = 7
  // On se place sur le jeudi de la semaine : son annee est l'annee ISO.
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const year = d.getUTCFullYear()
  const yearStart = Date.UTC(year, 0, 1, 12)
  const week = Math.ceil((d.getTime() - yearStart) / DAY_MS / 7 + 1 / 7)
  return { year, week }
}

/** Cle de la semaine courante, ex. '2026-W31'. */
export function currentIsoWeek(date: Date = new Date()): string {
  const { year, week } = isoWeekOf(date)
  return formatIsoWeek(year, week)
}

/** Lundi (midi UTC) de la semaine ISO donnee. */
export function mondayOfIsoWeek(value: string): Date {
  const { year, week } = parseIsoWeek(value)
  // Le 4 janvier appartient toujours a la semaine 1.
  const jan4 = new Date(Date.UTC(year, 0, 4, 12))
  const jan4Day = jan4.getUTCDay() || 7
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7)
  return monday
}

/** Les 7 dates de la semaine, du lundi (index 0) au dimanche (index 6). */
export function datesOfIsoWeek(value: string): Date[] {
  const monday = mondayOfIsoWeek(value)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setUTCDate(monday.getUTCDate() + i)
    return d
  })
}

/** Decale de `delta` semaines. Gere le passage d'annee, y compris les annees a 53 semaines. */
export function shiftIsoWeek(value: string, delta: number): string {
  const monday = mondayOfIsoWeek(value)
  monday.setUTCDate(monday.getUTCDate() + delta * 7)
  const { year, week } = isoWeekOf(
    new Date(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()),
  )
  return formatIsoWeek(year, week)
}

export const previousIsoWeek = (value: string): string => shiftIsoWeek(value, -1)
export const nextIsoWeek = (value: string): string => shiftIsoWeek(value, 1)

/**
 * Date du jour au format 'YYYY-MM-DD', en heure LOCALE.
 *
 * A utiliser partout ou l'on pre-remplit un champ date. `toISOString()`
 * convertit en UTC et propose donc la veille des qu'il est 22 h en France
 * l'ete — c'est exactement le bug #29 de la spec, present dans
 * PriceHistoryDialog et CookingHistoryDialog.
 */
export function todayLocalIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Jours entiers restants avant `expiry` ('YYYY-MM-DD'). Negatif = perime. */
export function daysUntil(expiry: string, from: Date = new Date()): number {
  const [y, m, d] = expiry.split('-').map(Number)
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`Date invalide : '${expiry}'`)
  }
  const target = Date.UTC(y, m - 1, d, 12)
  const today = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate(), 12)
  return Math.round((target - today) / DAY_MS)
}
