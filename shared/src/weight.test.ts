/**
 * Les valeurs attendues sont posees A LA MAIN, jamais relevees sur une
 * execution : un test qui recopie sa sortie verifie que la fonction fait ce
 * qu'elle fait, ce qui est toujours vrai.
 *
 * Serie de reference : 28 jours, moyenne lissee descendant de 0,05 kg par
 * jour depuis 80 kg. Pente attendue : -0,05 x 7 = -0,35 kg par semaine.
 */

import { describe, expect, it } from 'vitest'

import {
  addDays,
  bmi,
  bmiZone,
  daysBetween,
  movingAverage,
  readCap,
  weeklyPace,
  type TrendPoint,
} from './weight.js'

const AUJOURDHUI = '2026-08-13'

/** 28 points, de -27 jours a aujourd'hui, en ligne droite. */
const DROITE: TrendPoint[] = Array.from({ length: 28 }, (_, i) => ({
  day: addDays(AUJOURDHUI, i - 27),
  raw: null,
  smoothed: 80 - 0.05 * i,
}))

describe('addDays et daysBetween', () => {
  it('comptent en jours pleins, en UTC', () => {
    expect(addDays('2026-08-13', 73)).toBe('2026-10-25')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-08-13', '2026-10-25')).toBe(73)
    expect(daysBetween('2026-10-25', '2026-08-13')).toBe(-73)
  })

  it('traversent un changement d’heure sans deriver', () => {
    // Le passage a l'heure d'ete 2026 en France tombe le 29 mars. Lu en heure
    // locale, ce saut fait perdre ou gagner une journee sur les differences.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
  })
})

describe('movingAverage', () => {
  it('remplit les jours sans pesee et lisse sur la FENETRE EN JOURS', () => {
    const points = movingAverage(
      [
        { day: '2026-08-01', weightKg: 80 },
        { day: '2026-08-03', weightKg: 78 },
      ],
      7,
    )
    // Trois jours de calendrier, dont un sans pesee.
    expect(points.map((p) => p.day)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03'])
    expect(points[0]).toEqual({ day: '2026-08-01', raw: 80, smoothed: 80 })
    // Pas de pesee le 2, mais la fenetre en contient une : la ligne continue.
    expect(points[1]).toEqual({ day: '2026-08-02', raw: null, smoothed: 80 })
    expect(points[2]).toEqual({ day: '2026-08-03', raw: 78, smoothed: 79 })
  })

  it('rend une liste vide sans pesee', () => {
    expect(movingAverage([], 7)).toEqual([])
  })
})

describe('weeklyPace', () => {
  it('rend la pente de la droite, en kg par semaine', () => {
    expect(weeklyPace(DROITE, AUJOURDHUI, 28)).toBeCloseTo(-0.35, 10)
  })

  it('refuse de chiffrer une serie trop courte', () => {
    // Trois jours : la pente y serait du bruit annonce avec deux decimales.
    const courte = DROITE.slice(-3)
    expect(weeklyPace(courte, AUJOURDHUI, 28)).toBeNull()
    expect(weeklyPace([], AUJOURDHUI, 28)).toBeNull()
  })

  it('rend zero sur un poids stable, et non null', () => {
    const plat = DROITE.map((p) => ({ ...p, smoothed: 80 }))
    expect(weeklyPace(plat, AUJOURDHUI, 28)).toBe(0)
  })
})

describe('readCap', () => {
  const cap = readCap(DROITE, AUJOURDHUI, 75, '2026-11-01')!

  it('lit le poids LISSE et non la derniere pesee', () => {
    // 80 - 0,05 x 27 = 78,65
    expect(cap.currentKg).toBeCloseTo(78.65, 10)
    expect(cap.startKg).toBe(80)
  })

  it('mesure le chemin fait et celui qui reste', () => {
    // Total 5 kg, restant |75 - 78,65| = 3,65, donc 1,35 de fait sur 5.
    expect(cap.remainingKg).toBeCloseTo(3.65, 10)
    expect(cap.progress).toBeCloseTo(1.35 / 5, 10)
  })

  it('projette l’arrivee au rythme observe', () => {
    // 3,65 / 0,35 = 10,4286 semaines, soit 73 jours pleins.
    expect(cap.etaDay).toBe('2026-10-25')
    expect(cap.marginDays).toBe(7)
    expect(cap.onTrack).toBe(true)
  })

  it('n’annonce AUCUNE date quand le rythme ne va pas vers la cible', () => {
    // On veut descendre a 75 mais on monte : promettre une date serait
    // promettre l'inverse de ce qui arrive.
    const monte = DROITE.map((p, i) => ({ ...p, smoothed: 80 + 0.05 * i }))
    const c = readCap(monte, AUJOURDHUI, 75, '2026-11-01')!
    expect(c.paceKgPerWeek).toBeCloseTo(0.35, 10)
    expect(c.etaDay).toBeNull()
    expect(c.marginDays).toBeNull()
    expect(c.onTrack).toBeNull()
  })

  it('signale le retard quand l’arrivee depasse la date visee', () => {
    const c = readCap(DROITE, AUJOURDHUI, 75, '2026-10-01')!
    expect(c.marginDays).toBe(daysBetween('2026-10-25', '2026-10-01'))
    expect(c.marginDays).toBeLessThan(0)
    expect(c.onTrack).toBe(false)
  })

  it('rend null sans aucune mesure', () => {
    expect(readCap([], AUJOURDHUI, 75, null)).toBeNull()
  })
})

describe('bmi', () => {
  it('calcule et classe', () => {
    // 76,4 / 1,80^2 = 23,58
    expect(bmi(76.4, 180)).toBeCloseTo(23.58, 2)
    expect(bmiZone(23.58)).toBe('Zone normale')
    expect(bmiZone(18.4)).toBe('Insuffisance pondérale')
    expect(bmiZone(27)).toBe('Surpoids')
    expect(bmiZone(31)).toBe('Obésité')
  })

  it('rend null des qu’une mesure manque', () => {
    expect(bmi(null, 180)).toBeNull()
    expect(bmi(76, null)).toBeNull()
    expect(bmi(76, 0)).toBeNull()
  })
})
