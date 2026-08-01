/** Portage de tests/test_nutrition.py — mêmes ingrédients, mêmes attendus. */

import { describe, expect, it } from 'vitest'
import { ingredientSchema, recipeSchema, type Ingredient, type RecipeLine } from './models.js'
import {
  ZERO_NUTRITION,
  addNutrition,
  aggregateLines,
  aggregateRecipe,
  cookedWeightG,
  divideNutrition,
  energyBreakdown,
  macrosFor,
} from './nutrition.js'

const makeIngredient = (overrides: Partial<Ingredient> = {}): Ingredient =>
  ingredientSchema.parse({
    name: 'Test',
    source: 'manual',
    kcal: 100.0,
    proteins: 10.0,
    carbs: 20.0,
    fats: 5.0,
    ...overrides,
  })

const line = (ingredient: Ingredient, quantityG: number, ordinal = 0): RecipeLine => ({
  ingredient,
  quantityG,
  unit: null,
  notes: null,
  ordinal,
})

describe('aggregateLines', () => {
  it('somme les macros mises a l echelle', () => {
    const flour = makeIngredient({ name: 'Flour', kcal: 350, proteins: 10, carbs: 70, fats: 1 })
    const butter = makeIngredient({ name: 'Butter', kcal: 720, proteins: 0.6, carbs: 0, fats: 80 })
    const total = aggregateLines([line(flour, 200), line(butter, 100)])
    expect(total.kcal).toBe(700 + 720)
    expect(total.proteins).toBeCloseTo(20 + 0.6, 10)
    expect(total.carbs).toBe(140)
    expect(total.fats).toBe(2 + 80)
  })

  it('compte une macro inconnue pour zero', () => {
    // Choix repris du desktop : `null` (inconnu) contribue 0, ce qui
    // sous-estime le total sans le signaler. aggregateRecipe expose donc
    // linesWithUnknownMacros pour que l'interface puisse le dire.
    const sparse = makeIngredient({ name: 'Sparse', kcal: 100, proteins: null, fats: null })
    const total = aggregateLines([line(sparse, 100)])
    expect(total.kcal).toBe(100)
    expect(total.proteins).toBe(0)
    expect(total.fats).toBe(0)
  })

  it('rend zero sur une liste vide', () => {
    expect(aggregateLines([])).toEqual(ZERO_NUTRITION)
  })
})

describe('macrosFor', () => {
  it('met a l echelle depuis les valeurs pour 100 g', () => {
    const ing = makeIngredient({ kcal: 240, proteins: 12 })
    const total = macrosFor(ing, 250)
    expect(total.kcal).toBe(600)
    expect(total.proteins).toBe(30)
  })
})

describe('aggregateRecipe', () => {
  it('calcule le total et la portion', () => {
    const recipe = recipeSchema.parse({
      name: 'Cake',
      defaultPortions: 4,
      lines: [line(makeIngredient({ kcal: 400 }), 200)],
    })
    const { total, perPortion } = aggregateRecipe(recipe)
    expect(total.kcal).toBe(800)
    expect(perPortion.kcal).toBe(200)
  })

  it('rend zero sur une recette vide', () => {
    const { total, perPortion, per100g } = aggregateRecipe(
      recipeSchema.parse({ name: 'Empty', defaultPortions: 1 }),
    )
    expect(total.kcal).toBe(0)
    expect(perPortion.kcal).toBe(0)
    expect(per100g.kcal).toBe(0)
  })

  it('calcule la colonne « pour 100 g » sur la masse crue totale', () => {
    const recipe = recipeSchema.parse({
      name: 'Mix',
      defaultPortions: 2,
      lines: [line(makeIngredient({ kcal: 400 }), 200), line(makeIngredient({ kcal: 0 }), 200)],
    })
    // 800 kcal pour 400 g -> 200 kcal / 100 g
    expect(aggregateRecipe(recipe).per100g.kcal).toBe(200)
    expect(aggregateRecipe(recipe).totalWeightG).toBe(400)
  })

  it('remonte les lignes aux macros incompletes', () => {
    const recipe = recipeSchema.parse({
      name: 'Partiel',
      defaultPortions: 1,
      lines: [line(makeIngredient({ name: 'Complet' }), 100), line(makeIngredient({ name: 'Trou', proteins: null }), 100)],
    })
    const { linesWithUnknownMacros } = aggregateRecipe(recipe)
    expect(linesWithUnknownMacros).toHaveLength(1)
    expect(linesWithUnknownMacros[0]?.ingredient.name).toBe('Trou')
  })
})

describe('arithmetique des totaux', () => {
  it('additionne et divise', () => {
    const a = { ...ZERO_NUTRITION, kcal: 10, proteins: 1 }
    const b = { ...ZERO_NUTRITION, kcal: 20, proteins: 2 }
    const c = addNutrition(a, b)
    expect(c.kcal).toBe(30)
    expect(c.proteins).toBe(3)
    expect(divideNutrition(c, 2).kcal).toBe(15)
  })

  it('refuse une division par zero ou negative', () => {
    expect(() => divideNutrition(ZERO_NUTRITION, 0)).toThrow(RangeError)
    expect(() => divideNutrition(ZERO_NUTRITION, -1)).toThrow(RangeError)
  })
})

describe('energyBreakdown (Atwater)', () => {
  it('applique les coefficients 9 / 4 / 2 / 4', () => {
    const b = energyBreakdown({ ...ZERO_NUTRITION, fats: 10, carbs: 20, fiber: 5, proteins: 10 })
    expect(b.fatsKcal).toBe(90)
    expect(b.carbsKcal).toBe(80)
    expect(b.fiberKcal).toBe(10)
    expect(b.proteinsKcal).toBe(40)
    expect(b.atwaterKcal).toBe(220)
  })

  it('expose l ecart avec l energie declaree', () => {
    // Le desktop affichait la valeur Atwater au centre du donut et la valeur
    // declaree dans le tableau juste a cote, sans jamais mentionner l'ecart.
    const b = energyBreakdown({ ...ZERO_NUTRITION, kcal: 200, fats: 10, carbs: 20, proteins: 10 })
    expect(b.atwaterKcal).toBe(210)
    expect(b.declaredKcal).toBe(200)
    expect(b.divergence).toBeCloseTo(10 / 210, 10)
  })

  it('ne divise pas par zero sur un total vide', () => {
    expect(energyBreakdown(ZERO_NUTRITION).divergence).toBe(0)
  })
})

describe('cookedWeightG', () => {
  it('applique le ratio quand il est connu', () => {
    const rice = makeIngredient({ cookedWeightPer100gRaw: 300 })
    expect(cookedWeightG(rice, 100)).toBe(300)
    expect(cookedWeightG(rice, 75)).toBe(225)
  })

  it('assume 1:1 quand le ratio est inconnu', () => {
    expect(cookedWeightG(makeIngredient(), 250)).toBe(250)
  })
})
