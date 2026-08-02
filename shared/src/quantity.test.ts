/**
 * Analyse des contenances rendues par OpenFoodFacts.
 *
 * Ces cas viennent tous de reponses REELLES de l'API : le Nutella sans
 * quantite, la moutarde Maille en chaine « 360 g », la copie d'Open Prices en
 * nombre + unite separee. Un service exterieur qui change de forme casse en
 * silence ; ces tests le font parler.
 */

import { describe, expect, it } from 'vitest'

import { parseQuantityToGrams } from './units.js'

describe('parseQuantityToGrams', () => {
  it('accepte un nombre accompagne de son unite (forme Open Prices)', () => {
    expect(parseQuantityToGrams(400, 'g')).toBe(400)
    expect(parseQuantityToGrams(1.5, 'kg')).toBe(1500)
    expect(parseQuantityToGrams(50, 'cl')).toBe(500)
  })

  it('accepte une chaine unite comprise (forme /api/v2/product)', () => {
    expect(parseQuantityToGrams('360 g')).toBe(360)
    expect(parseQuantityToGrams('1,5 L')).toBe(1500)
    expect(parseQuantityToGrams('250ml')).toBe(250)
  })

  it('retombe sur le libelle humain quand le champ chiffre manque', () => {
    expect(parseQuantityToGrams(undefined, undefined, '360 g')).toBe(360)
    expect(parseQuantityToGrams('', 'g', '75 cl')).toBe(750)
  })

  it('compte le millilitre pour un gramme', () => {
    expect(parseQuantityToGrams(500, 'ml')).toBe(500)
  })

  it('refuse ce qui n’a pas de contenance exploitable', () => {
    // Le cas du Nutella : OpenFoodFacts ne connait pas sa quantite.
    expect(parseQuantityToGrams('')).toBeNull()
    expect(parseQuantityToGrams(undefined)).toBeNull()
    expect(parseQuantityToGrams(0, 'g')).toBeNull()
    expect(parseQuantityToGrams(-5, 'g')).toBeNull()
    expect(parseQuantityToGrams('quelques pincées')).toBeNull()
  })

  it('refuse une unite inconnue plutot que de supposer des grammes', () => {
    // « 6 pièces » n'est pas une masse : la traiter comme 6 g donnerait un
    // poids unitaire absurde, propage ensuite a toutes les recettes.
    expect(parseQuantityToGrams(6, 'pcs')).toBeNull()
    expect(parseQuantityToGrams(12, 'oz')).toBeNull()
  })

  it('refuse une valeur invraisemblable', () => {
    expect(parseQuantityToGrams(25, 'kg')).toBeNull()
    expect(parseQuantityToGrams(20, 'kg')).toBe(20_000)
  })

  it('arrondit au centieme de gramme', () => {
    expect(parseQuantityToGrams(33.333, 'g')).toBe(33.33)
  })
})
