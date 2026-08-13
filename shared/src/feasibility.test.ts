/**
 * Les cas de ce fichier viennent des DONNEES REELLES de l'application, pas
 * d'exemples inventes : les plus petites lignes de recette effectivement
 * saisies sont du poivre a 1 g, de l'huile d'olive a 5 g et de l'ail a 12 g,
 * toutes rangees dans le rayon « Epicerie », qui contient aussi les pates.
 * C'est ce releve qui a fait choisir un seuil de QUANTITE plutot qu'une liste
 * de rayons.
 */

import { describe, expect, it } from 'vitest'

import { SEASONING_MAX_G, feasibility, pantryTotals } from './feasibility.js'
import type { Ingredient, Recipe, RecipeLine } from './models.js'

const ingredient = (id: number, name: string): Ingredient =>
  ({
    id,
    name,
    source: 'ciqual',
    sourceRef: null,
    kcalPer100g: 100,
    proteinsPer100g: 0,
    carbsPer100g: 0,
    sugarsPer100g: 0,
    fatsPer100g: 0,
    saturatedFatsPer100g: 0,
    fiberPer100g: 0,
    saltPer100g: 0,
    categoryL1: 'Epicerie',
    categoryL2: null,
    pieceWeightG: null,
    cookedWeightPer100gRaw: null,
    inPersonalLibrary: true,
    priceEur: null,
    priceQuantityG: null,
    createdAt: null,
    updatedAt: null,
  }) as unknown as Ingredient

const ligne = (id: number, name: string, quantityG: number): RecipeLine =>
  ({ ingredient: ingredient(id, name), quantityG, unit: null, notes: null }) as unknown as RecipeLine

const recette = (lines: RecipeLine[], defaultPortions = 2): Pick<Recipe, 'lines' | 'defaultPortions'> => ({
  lines,
  defaultPortions,
})

describe('feasibility', () => {
  it('declare faisable quand le stock couvre chaque ligne', () => {
    const r = recette([ligne(1, 'Lentilles corail', 180), ligne(2, 'Lait de coco', 200)])
    const frigo = new Map([
      [1, 500],
      [2, 400],
    ])
    const f = feasibility(r, frigo)
    expect(f.feasible).toBe(true)
    expect(f.missing).toEqual([])
    expect(f.coveredCount).toBe(2)
  })

  it('refuse de dire faisable quand la QUANTITE ne suit pas', () => {
    // Avoir du riz ne suffit pas : en avoir assez, si. Un badge vert pose sur
    // 20 g de riz quand la recette en demande 200 serait pire qu'aucun badge.
    const r = recette([ligne(1, 'Riz', 200)])
    const f = feasibility(r, new Map([[1, 20]]))
    expect(f.feasible).toBe(false)
    expect(f.missing).toHaveLength(1)
    expect(f.missing[0]?.neededG).toBe(200)
    expect(f.missing[0]?.inPantryG).toBe(20)
    expect(f.missing[0]?.shortG).toBe(180)
  })

  it('suppose presents les assaisonnements, jamais saisis au frigo', () => {
    // Cas reels : poivre de Cayenne 1 g, fleur de sel 1 g, huile d'olive 5 g,
    // ail 12 g. Aucun n'est dans le frigo, et la recette reste faisable.
    const r = recette([
      ligne(1, 'Lentilles corail', 180),
      ligne(2, 'Poivre de Cayenne', 1),
      ligne(3, 'Huile d’olive vierge extra', 5),
      ligne(4, 'Ail, cru', 12),
    ])
    const f = feasibility(r, new Map([[1, 500]]))
    expect(f.feasible).toBe(true)
    expect(f.assumedCount).toBe(3)
    expect(f.coveredCount).toBe(1)
  })

  it('place la frontiere du seuil sur la valeur declaree', () => {
    const juste = recette([ligne(1, 'Ail, cru', SEASONING_MAX_G)])
    expect(feasibility(juste, new Map()).feasible).toBe(true)

    const auDela = recette([ligne(1, 'Beurre', SEASONING_MAX_G + 1)])
    expect(feasibility(auDela, new Map()).feasible).toBe(false)
  })

  it('met a l’echelle avant de comparer, et le seuil suit', () => {
    // Une recette de 2 portions cuisinee pour 4 demande le double. Un stock
    // qui suffisait pour 2 ne suffit plus.
    const r = recette([ligne(1, 'Riz', 200)], 2)
    expect(feasibility(r, new Map([[1, 300]]), 2).feasible).toBe(true)
    expect(feasibility(r, new Map([[1, 300]]), 4).feasible).toBe(false)
    expect(feasibility(r, new Map([[1, 300]]), 4).missing[0]?.neededG).toBe(400)

    // Et une ligne de 10 g devient 40 g pour 8 portions : elle sort du seuil,
    // parce que c'est la quantite REELLEMENT necessaire qui compte.
    const huile = recette([ligne(1, 'Huile d’olive', 10)], 2)
    expect(feasibility(huile, new Map(), 2).feasible).toBe(true)
    expect(feasibility(huile, new Map(), 8).feasible).toBe(false)
  })

  it('ignore une ligne dont l’ingredient n’a pas d’identifiant', () => {
    const orpheline = { ingredient: { ...ingredient(0, 'X'), id: null }, quantityG: 100 } as unknown as RecipeLine
    const f = feasibility(recette([orpheline]), new Map())
    expect(f.feasible).toBe(true)
    expect(f.missing).toEqual([])
  })

  it('rend une recette sans ligne faisable, faute de contre-exemple', () => {
    expect(feasibility(recette([]), new Map()).feasible).toBe(true)
  })
})

describe('pantryTotals', () => {
  it('somme les lots d’un meme ingredient', () => {
    // Deux paquets de riz ouverts a des dates differentes font un seul stock.
    const totaux = pantryTotals([
      { ingredientId: 1, quantityG: 300 },
      { ingredientId: 1, quantityG: 200 },
      { ingredientId: 2, quantityG: 50 },
    ])
    expect(totaux.get(1)).toBe(500)
    expect(totaux.get(2)).toBe(50)
    expect(totaux.size).toBe(2)
  })

  it('rend une table vide sur un frigo vide', () => {
    expect(pantryTotals([]).size).toBe(0)
  })
})
