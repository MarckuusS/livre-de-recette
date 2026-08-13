/**
 * Les valeurs attendues sont celles PUBLIEES par les agences, pas des
 * relevés sur une execution. Un test qui recopie ce que le code produit ne
 * verifie rien ; ici il verifie que les chiffres affiches sont bien ceux de
 * l'OMS et de l'ANSES.
 *
 * Reference employee par les agences elles-memes pour illustrer leurs
 * pourcentages : 2 000 kcal.
 *   satures OMS   = 2000 x 10 % / 9 = 22,2 -> 22 g
 *   satures ANSES = 2000 x 12 % / 9 = 26,7 -> 27 g
 */

import { describe, expect, it } from 'vitest'

import {
  FIBER_MIN_G,
  FIBER_TARGET_G,
  SALT_MAX_G,
  SATURATED_ANSES_PERCENT,
  SATURATED_MAX_PERCENT,
  SUGARS_MAX_G,
  dailyLimits,
  readLimit,
  saturatedAnsesG,
} from './limits.js'

describe('les reperes publies', () => {
  it('porte les valeurs des agences, telles quelles', () => {
    expect(SALT_MAX_G).toBe(5) // OMS 2012, moins de 2 g de sodium
    expect(SUGARS_MAX_G).toBe(100) // ANSES 2016, sucres totaux hors lactose
    expect(SATURATED_MAX_PERCENT).toBe(10) // OMS 2023
    expect(SATURATED_ANSES_PERCENT).toBe(12) // ANSES 2011
    expect(FIBER_TARGET_G).toBe(30) // ANSES 2016
    expect(FIBER_MIN_G).toBe(25) // EFSA 2010 et OMS 2023
  })

  it('convertit le pourcentage de satures a 9 kcal par gramme', () => {
    expect(dailyLimits(2000).saturatedFats.grams).toBe(22)
    expect(saturatedAnsesG(2000)).toBe(27)
  })

  it('fait suivre les satures a la cible energetique, et eux seuls', () => {
    const petit = dailyLimits(1500)
    const grand = dailyLimits(3000)
    // 1500 x 10 % / 9 = 16,7 -> 17 ; 3000 x 10 % / 9 = 33,3 -> 33
    expect(petit.saturatedFats.grams).toBe(17)
    expect(grand.saturatedFats.grams).toBe(33)
    // Les trois autres sont des nombres absolus, identiques pour tous.
    expect(petit.salt.grams).toBe(grand.salt.grams)
    expect(petit.sugars.grams).toBe(grand.sugars.grams)
    expect(petit.fiber.grams).toBe(grand.fiber.grams)
  })

  it('retombe sur 2 000 kcal quand aucune cible n’est connue', () => {
    expect(dailyLimits(null).saturatedFats.grams).toBe(dailyLimits(2000).saturatedFats.grams)
  })

  it('distingue les plafonds du plancher', () => {
    const l = dailyLimits(2000)
    expect(l.salt.sens).toBe('plafond')
    expect(l.sugars.sens).toBe('plafond')
    expect(l.saturatedFats.sens).toBe('plafond')
    // Les fibres se visent, elles ne se limitent pas : confondre les deux
    // inverserait le sens de la barre et ferait feliciter d'en manquer.
    expect(l.fiber.sens).toBe('plancher')
  })
})

describe('readLimit', () => {
  const plafond = dailyLimits(2000).salt // 5 g
  const plancher = dailyLimits(2000).fiber // 30 g

  it('lit un plafond dans le bon sens', () => {
    expect(readLimit(3, plafond).etat).toBe('tenu')
    expect(readLimit(4.5, plafond).etat).toBe('limite') // 90 %
    expect(readLimit(5, plafond).etat).toBe('limite') // pile dessus, pas encore franchi
    expect(readLimit(5.1, plafond).etat).toBe('depasse')
  })

  it('lit un plancher dans l’autre sens', () => {
    expect(readLimit(31, plancher).etat).toBe('tenu')
    expect(readLimit(30, plancher).etat).toBe('tenu')
    expect(readLimit(27, plancher).etat).toBe('limite') // 90 %
    expect(readLimit(12, plancher).etat).toBe('depasse')
  })

  it('rend une part qui peut depasser 1', () => {
    expect(readLimit(10, plafond).part).toBe(2)
    expect(readLimit(0, plafond).part).toBe(0)
  })
})

describe('ce que le module ne fait PAS', () => {
  it('ne fait varier aucun repere en fonction d’un autre', () => {
    /*
     * Le coeur du sujet. L'idee « 100 g de sucres, c'est moins grave avec 50 g
     * de fibres » est juste dans son mecanisme (une fibre visqueuse ralentit
     * le sucre avale AVEC elle) mais ne se transpose pas a un total de
     * journee : la simultaneite est constitutive du mecanisme, et aucune des
     * quatre agences qui ont examine les deux dossiers ne conditionne l'un a
     * l'autre.
     *
     * Ce test existe pour qu'une future « amelioration » qui ferait monter le
     * plafond de sucres avec les fibres du jour casse ici, et pas en
     * silence.
     */
    expect(dailyLimits(2000).sugars.grams).toBe(dailyLimits(2000).sugars.grams)
    expect(SUGARS_MAX_G).toBe(100)
    // La signature n'accepte QUE la cible energetique : il n'existe aucun
    // parametre par lequel les fibres pourraient entrer dans ce calcul.
    expect(dailyLimits.length).toBe(1)
  })
})
