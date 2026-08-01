/**
 * L'arithmetique ISO n'existait pas en TS cote desktop : Python la fournit via
 * `datetime.isocalendar()`. Ces tests couvrent donc surtout les pieges de
 * bascule d'annee, qui sont la source classique de bugs de calendrier.
 */

import { describe, expect, it } from 'vitest'
import {
  InvalidIsoWeekError,
  currentIsoWeek,
  datesOfIsoWeek,
  daysUntil,
  formatIsoWeek,
  isValidIsoWeek,
  isoWeekOf,
  mondayOfIsoWeek,
  nextIsoWeek,
  parseIsoWeek,
  previousIsoWeek,
  shiftIsoWeek,
  todayLocalIsoDate,
  weeksInIsoYear,
} from './isoweek.js'

describe('validation', () => {
  it('accepte une cle bien formee', () => {
    expect(parseIsoWeek('2026-W18')).toEqual({ year: 2026, week: 18 })
  })

  it('refuse les espaces que le desktop laissait passer', () => {
    // Bug #23 : `int("W 5")` tolere l'espace cote Python, donc '2026-W 5'
    // etait accepte et produisait une cle jamais retrouvable en base.
    expect(() => parseIsoWeek('2026-W 5')).toThrow(InvalidIsoWeekError)
    expect(isValidIsoWeek('2026-W 5')).toBe(false)
  })

  it('refuse les formes invalides', () => {
    for (const bad of ['2026W18', '26-W18', '2026-18', '2026-W1', '2026-W99', '1999-W01', '2101-W01', '']) {
      expect(isValidIsoWeek(bad)).toBe(false)
    }
  })

  it('refuse une semaine 53 dans une annee qui n en a que 52', () => {
    expect(weeksInIsoYear(2026)).toBe(53) // le 1er janvier 2026 est un jeudi
    expect(weeksInIsoYear(2027)).toBe(52)
    expect(isValidIsoWeek('2026-W53')).toBe(true)
    expect(isValidIsoWeek('2027-W53')).toBe(false)
  })

  it('formate avec des zeros de tete', () => {
    expect(formatIsoWeek(2026, 5)).toBe('2026-W05')
  })
})

describe('isoWeekOf', () => {
  it('place le 1er janvier 2026 (un jeudi) en semaine 1', () => {
    expect(isoWeekOf(new Date(2026, 0, 1))).toEqual({ year: 2026, week: 1 })
  })

  it('rattache la fin decembre 2025 a la semaine 1 de 2026', () => {
    // La semaine 2026-W01 commence le lundi 29 decembre 2025 : elle contient
    // le premier jeudi de 2026. C'est la regle ISO, et le piege classique.
    expect(isoWeekOf(new Date(2025, 11, 29))).toEqual({ year: 2026, week: 1 })
    expect(isoWeekOf(new Date(2025, 11, 28))).toEqual({ year: 2025, week: 52 })
  })

  it('donne la meme semaine pour les 7 jours d une semaine', () => {
    const week = '2026-W31'
    const weeks = datesOfIsoWeek(week).map((d) =>
      formatIsoWeek(...(Object.values(isoWeekOf(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))) as [number, number])),
    )
    expect(new Set(weeks)).toEqual(new Set([week]))
  })

  it('currentIsoWeek suit la date fournie', () => {
    expect(currentIsoWeek(new Date(2026, 7, 1))).toBe('2026-W31')
  })
})

describe('mondayOfIsoWeek / datesOfIsoWeek', () => {
  it('commence toujours un lundi', () => {
    for (const w of ['2026-W01', '2026-W18', '2026-W53', '2027-W01']) {
      expect(mondayOfIsoWeek(w).getUTCDay()).toBe(1)
    }
  })

  it('rend 7 jours consecutifs, lundi -> dimanche', () => {
    const dates = datesOfIsoWeek('2026-W01')
    expect(dates).toHaveLength(7)
    expect(dates[0]?.toISOString().slice(0, 10)).toBe('2025-12-29')
    expect(dates[6]?.toISOString().slice(0, 10)).toBe('2026-01-04')
    expect(dates[6]?.getUTCDay()).toBe(0) // dimanche
  })
})

describe('navigation', () => {
  it('avance et recule d une semaine', () => {
    expect(nextIsoWeek('2026-W18')).toBe('2026-W19')
    expect(previousIsoWeek('2026-W18')).toBe('2026-W17')
  })

  it('franchit les bascules d annee', () => {
    // 2026 compte 53 semaines : W53 existe et precede 2027-W01.
    expect(nextIsoWeek('2026-W52')).toBe('2026-W53')
    expect(nextIsoWeek('2026-W53')).toBe('2027-W01')
    expect(previousIsoWeek('2027-W01')).toBe('2026-W53')
    // 2025 n'en compte que 52.
    expect(nextIsoWeek('2025-W52')).toBe('2026-W01')
    expect(previousIsoWeek('2026-W01')).toBe('2025-W52')
  })

  it('fait un aller-retour fidele sur de grands decalages', () => {
    for (const w of ['2026-W01', '2026-W31', '2026-W53']) {
      expect(shiftIsoWeek(shiftIsoWeek(w, 40), -40)).toBe(w)
      expect(shiftIsoWeek(shiftIsoWeek(w, -104), 104)).toBe(w)
    }
  })
})

describe('todayLocalIsoDate', () => {
  it('utilise le calendrier LOCAL, pas UTC', () => {
    // Bug #29 : 23 h 30 le 31 juillet en heure francaise (UTC+2) correspond au
    // 31 juillet 21 h 30 UTC. `toISOString()` donnerait bien le 31 ici, mais
    // 00 h 30 le 1er aout donnerait le 31 juillet — la veille. On verifie que
    // la date suit l'horloge de l'utilisateur.
    const justAfterMidnightLocal = new Date(2026, 7, 1, 0, 30)
    expect(todayLocalIsoDate(justAfterMidnightLocal)).toBe('2026-08-01')
    expect(todayLocalIsoDate(new Date(2026, 7, 1, 23, 59))).toBe('2026-08-01')
  })
})

describe('daysUntil', () => {
  const today = new Date(2026, 7, 1, 15, 0)

  it('compte les jours entiers restants', () => {
    expect(daysUntil('2026-08-01', today)).toBe(0)
    expect(daysUntil('2026-08-06', today)).toBe(5)
    expect(daysUntil('2026-08-15', today)).toBe(14)
  })

  it('rend un negatif pour une date passee', () => {
    expect(daysUntil('2026-07-30', today)).toBe(-2)
  })

  it('ne se laisse pas decaler par l heure de la journee', () => {
    for (const h of [0, 6, 12, 18, 23]) {
      expect(daysUntil('2026-08-06', new Date(2026, 7, 1, h, 30))).toBe(5)
    }
  })
})
