/**
 * Portage de tests/test_pricing.py — mêmes valeurs, mêmes attendus.
 * Les cas d'arrondi sont ceux qui garantissent que les totaux affiches sur le
 * web seront identiques au centime pres a ceux du desktop.
 */

import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { ingredientSchema, recipeSchema, type Ingredient, type Recipe } from './models.js'
import { formatEuros, ingredientCost, pricePerG, recipeCost } from './pricing.js'

const priced = (name: string, priceEur: string, qtyRefG: number): Ingredient =>
  ingredientSchema.parse({ name, source: 'manual', priceEur, priceQuantityG: qtyRefG })

const unpriced = (name: string): Ingredient =>
  ingredientSchema.parse({ name, source: 'manual' })

const recipeOf = (name: string, portions: number, lines: Recipe['lines']): Recipe =>
  recipeSchema.parse({ name, defaultPortions: portions, lines })

describe('recipeCost', () => {
  it('somme les couts de lignes', () => {
    const flour = priced('Flour', '1.00', 1000) // 0,001 €/g
    const butter = priced('Butter', '4.00', 250) // 0,016 €/g
    const cake = recipeOf('Cake', 4, [
      { ingredient: flour, quantityG: 500, unit: null, notes: null, ordinal: 0 }, // 0,50
      { ingredient: butter, quantityG: 250, unit: null, notes: null, ordinal: 1 }, // 4,00
    ])
    const { total, missing } = recipeCost(cake)
    expect(total.toFixed(2)).toBe('4.50')
    expect(missing).toEqual([])
  })

  it('divise par le nombre de portions', () => {
    const flour = priced('Flour', '1.00', 1000)
    const bread = recipeOf('Bread', 4, [
      { ingredient: flour, quantityG: 400, unit: null, notes: null, ordinal: 0 }, // 0,40
    ])
    expect(recipeCost(bread).perPortion.toFixed(2)).toBe('0.10')
  })

  it('signale les lignes sans prix au lieu de les compter a zero', () => {
    const bread = recipeOf('Bread', 1, [
      { ingredient: priced('Flour', '1.00', 1000), quantityG: 500, unit: null, notes: null, ordinal: 0 },
      { ingredient: unpriced('Salt'), quantityG: 10, unit: null, notes: null, ordinal: 1 },
    ])
    const { total, missing } = recipeCost(bread)
    expect(total.toFixed(2)).toBe('0.50')
    expect(missing).toHaveLength(1)
    expect(missing[0]?.ingredient.name).toBe('Salt')
  })

  it('rend zero sur une recette vide', () => {
    const { total, perPortion } = recipeCost(recipeOf('Vide', 4, []))
    expect(total.toFixed(2)).toBe('0.00')
    expect(perPortion.toFixed(2)).toBe('0.00')
  })
})

describe('ingredientCost', () => {
  it('rend null quand l ingredient n a pas de prix', () => {
    expect(ingredientCost(unpriced('Salt'), 100)).toBeNull()
  })

  it('arrondit au centime en ROUND_HALF_UP', () => {
    // 80 x 3,99 / 250 = 1,2768 -> 1,28
    expect(ingredientCost(priced('Cheese', '3.99', 250), 80)?.toFixed(2)).toBe('1.28')
  })

  it('arrondit 0,125 vers le haut, pas vers le pair', () => {
    // Le coeur de l'annexe #5 : en HALF_EVEN (defaut Python) ce serait 0,12.
    // Le desktop appliquait les deux modes selon le module appele.
    expect(ingredientCost(priced('X', '0.25', 200), 100)?.toFixed(2)).toBe('0.13')
  })

  it('traite une quantite de reference nulle comme un prix absent', () => {
    // Comportement du Python (`not self.price_quantity_g`) : pas de division par zero.
    const weird = ingredientSchema.parse({ name: 'Bizarre', priceEur: '1.00' })
    expect(pricePerG(weird)).toBeNull()
    expect(ingredientCost(weird, 100)).toBeNull()
  })
})

describe('pricePerG', () => {
  it('ne perd pas de precision avant la multiplication', () => {
    // 3,99 / 250 = 0,01596 : arrondir ici donnerait 0,02 €/g, soit +25 % sur 80 g.
    expect(pricePerG(priced('Cheese', '3.99', 250))?.toString()).toBe('0.01596')
  })
})

describe('formatEuros', () => {
  // Trois espaces differentes se croisent dans un montant francais formate.
  // Les nommer est le seul moyen d'ecrire un attendu relisible : a l'oeil nu
  // elles sont identiques, pour `===` elles ne le sont pas.
  const NBSP = ' ' // espace insecable, avant le symbole monetaire
  const NNBSP = ' ' // espace FINE insecable, separateur de milliers choisi par Intl en fr-FR

  it('formate a la francaise', () => {
    expect(formatEuros(new Decimal('12.5'))).toBe(`12,50${NBSP}€`)
    expect(formatEuros('0')).toBe(`0,00${NBSP}€`)
    expect(formatEuros(null)).toBe('—')
  })

  it('separe les milliers par une espace fine insecable', () => {
    expect(formatEuros('1234.567')).toBe(`1${NNBSP}234,57${NBSP}€`)
    // Et surtout PAS avec une espace ordinaire : c'est l'erreur qu'on ne voit
    // pas en relisant, et qui fait echouer une comparaison de chaines.
    expect(formatEuros('1234.567')).not.toBe(`1 234,57 €`)
  })
})
