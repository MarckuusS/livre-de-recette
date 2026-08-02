/**
 * Les regles metier portees par les schemas, et non par le code applicatif.
 *
 * Ce fichier existe a cause d'un bug reel : `mealPlanEntryWriteSchema` avait
 * ete derive par `mealPlanEntrySchema.innerType().omit(...)`. Or `innerType()`
 * rend l'objet SANS son raffinement — la regle XOR disparaissait sans la
 * moindre erreur de compilation, et une entree invalide traversait la
 * validation jusqu'au CHECK SQLite, qui ressortait en « erreur interne ».
 *
 * Une validation qui s'evapore ne se voit pas. D'ou ces tests.
 */

import { describe, expect, it } from 'vitest'

import {
  ingredientPatchSchema,
  mealPlanEntrySchema,
  mealPlanEntryWriteSchema,
  recipeWriteSchema,
} from './models.js'

const baseEntry = {
  isoWeek: '2026-W18',
  dayOfWeek: 1,
  slot: 'noon' as const,
}

describe('mealPlanEntryWriteSchema — regle XOR', () => {
  it('accepte une entree recette avec des portions', () => {
    const result = mealPlanEntryWriteSchema.safeParse({ ...baseEntry, recipeId: 3, portions: 2 })
    expect(result.success).toBe(true)
  })

  it('accepte une entree ingredient avec des grammes', () => {
    const result = mealPlanEntryWriteSchema.safeParse({ ...baseEntry, ingredientId: 7, quantityG: 250 })
    expect(result.success).toBe(true)
  })

  it('refuse une entree qui porte a la fois une recette et un ingredient', () => {
    const result = mealPlanEntryWriteSchema.safeParse({
      ...baseEntry,
      recipeId: 3,
      ingredientId: 7,
      portions: 2,
      quantityG: 250,
    })
    expect(result.success).toBe(false)
  })

  it('refuse une entree qui ne reference ni recette ni ingredient', () => {
    expect(mealPlanEntryWriteSchema.safeParse({ ...baseEntry, portions: 2 }).success).toBe(false)
  })

  it('refuse une recette reglee en grammes', () => {
    const result = mealPlanEntryWriteSchema.safeParse({ ...baseEntry, recipeId: 3, quantityG: 250 })
    expect(result.success).toBe(false)
  })

  it('refuse un ingredient regle en portions', () => {
    const result = mealPlanEntryWriteSchema.safeParse({ ...baseEntry, ingredientId: 7, portions: 2 })
    expect(result.success).toBe(false)
  })

  it('refuse une recette sans nombre de portions', () => {
    expect(mealPlanEntryWriteSchema.safeParse({ ...baseEntry, recipeId: 3 }).success).toBe(false)
  })

  // Le schema complet et le schema d'ecriture doivent juger a l'identique :
  // c'est precisement ce qui avait cesse d'etre vrai.
  it('juge comme le schema complet', () => {
    const invalid = { ...baseEntry, recipeId: 3, ingredientId: 7, portions: 2, quantityG: 250 }
    expect(mealPlanEntrySchema.safeParse({ ...invalid, id: null, ordinal: 0 }).success).toBe(
      mealPlanEntryWriteSchema.safeParse(invalid).success,
    )
  })

  it('refuse une semaine mal formee', () => {
    const result = mealPlanEntryWriteSchema.safeParse({ ...baseEntry, isoWeek: '2026-18', recipeId: 3, portions: 2 })
    expect(result.success).toBe(false)
  })
})

describe('ingredientPatchSchema — semantique « cle presente »', () => {
  it('ne fabrique PAS les cles absentes', () => {
    const result = ingredientPatchSchema.parse({ brand: 'Bio' })
    // Le piege : les champs du schema portent des `.default()`. Si `.partial()`
    // ne l'emportait pas, un patch d'un seul champ remettrait tous les autres
    // a leur valeur par defaut — donc effacerait les macros de la fiche.
    expect(Object.keys(result)).toEqual(['brand'])
    expect('kcal' in result).toBe(false)
    expect('source' in result).toBe(false)
  })

  it('distingue « absent » de « present a null »', () => {
    expect('brand' in ingredientPatchSchema.parse({ brand: null })).toBe(true)
    expect('brand' in ingredientPatchSchema.parse({})).toBe(false)
  })

  it('refuse une macro negative', () => {
    expect(ingredientPatchSchema.safeParse({ kcal: -1 }).success).toBe(false)
  })

  it('refuse un prix nul ou negatif', () => {
    expect(ingredientPatchSchema.safeParse({ priceEur: '0' }).success).toBe(false)
    expect(ingredientPatchSchema.safeParse({ priceEur: '0.0100' }).success).toBe(true)
  })

  it('refuse des mois de saison mal formes', () => {
    expect(ingredientPatchSchema.safeParse({ seasonMonths: '6,7,8' }).success).toBe(true)
    expect(ingredientPatchSchema.safeParse({ seasonMonths: '13' }).success).toBe(false)
    expect(ingredientPatchSchema.safeParse({ seasonMonths: '6;7' }).success).toBe(false)
  })
})

describe('recipeWriteSchema', () => {
  it('accepte une recette sans ligne', () => {
    expect(recipeWriteSchema.safeParse({ name: 'Pain' }).success).toBe(true)
  })

  it('refuse un nom vide ou fait d espaces', () => {
    expect(recipeWriteSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('refuse moins d une portion', () => {
    expect(recipeWriteSchema.safeParse({ name: 'Pain', defaultPortions: 0 }).success).toBe(false)
  })

  it('refuse une ligne de quantite nulle', () => {
    const result = recipeWriteSchema.safeParse({
      name: 'Pain',
      lines: [{ ingredientId: 1, quantityG: 0 }],
    })
    expect(result.success).toBe(false)
  })

  it('applique les valeurs par defaut', () => {
    const recipe = recipeWriteSchema.parse({ name: 'Pain' })
    expect(recipe.defaultPortions).toBe(1)
    expect(recipe.instructions).toBe('')
    expect(recipe.lines).toEqual([])
    expect(recipe.tagIds).toEqual([])
  })
})
