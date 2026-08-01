/** Portage de tests/test_shopping_service.py, plus les cas de tri et de frigo. */

import { describe, expect, it } from 'vitest'

import { ingredientSchema, mealPlanEntrySchema, recipeSchema, type Ingredient, type MealPlanEntry, type Recipe } from './models.js'
import { aggregateShoppingList, formatAsText, formatShoppingQuantity, groupByCategory } from './shopping.js'
import { NBSP } from './testing.js'

const WEEK = '2026-W18'

const ing = (id: number, name: string, extra: Partial<Ingredient> = {}): Ingredient =>
  ingredientSchema.parse({ id, name, source: 'manual', ...extra })

const recipe = (id: number, portions: number, lines: Recipe['lines']): Recipe =>
  recipeSchema.parse({ id, name: `Recette ${id}`, defaultPortions: portions, lines })

const line = (ingredient: Ingredient, quantityG: number) => ({
  ingredient,
  quantityG,
  unit: null,
  notes: null,
  ordinal: 0,
})

const recipeEntry = (recipeId: number, portions: number): MealPlanEntry =>
  mealPlanEntrySchema.parse({ isoWeek: WEEK, dayOfWeek: 0, slot: 'noon', recipeId, portions })

const ingredientEntry = (ingredientId: number, quantityG: number): MealPlanEntry =>
  mealPlanEntrySchema.parse({ isoWeek: WEEK, dayOfWeek: 0, slot: 'morning', ingredientId, quantityG })

const run = (
  entries: MealPlanEntry[],
  ingredients: Ingredient[],
  recipes: Recipe[] = [],
  pantry: [number, number][] = [],
) =>
  aggregateShoppingList({
    isoWeek: WEEK,
    entries,
    recipesById: new Map(recipes.map((r) => [r.id!, r])),
    ingredientsById: new Map(ingredients.map((i) => [i.id!, i])),
    pantryByIngredient: new Map(pantry),
  })

describe('agregation', () => {
  it('cumule un meme ingredient venu de plusieurs sources', () => {
    const flour = ing(1, 'Farine')
    const cake = recipe(10, 4, [line(flour, 200)])
    const list = run([recipeEntry(10, 4), ingredientEntry(1, 50)], [flour], [cake])

    expect(list.items).toHaveLength(1)
    expect(list.items[0]?.quantityG).toBe(250)
  })

  it('met les quantites a l echelle des portions servies', () => {
    const flour = ing(1, 'Farine')
    // 2 portions d'une recette qui en fait 4 : la moitie des ingredients.
    const list = run([recipeEntry(10, 2)], [flour], [recipe(10, 4, [line(flour, 400)])])
    expect(list.items[0]?.quantityG).toBe(200)
  })

  it('ignore une entree qui pointe vers une recette supprimee', () => {
    // Degradation silencieuse : une liste incomplete reste utilisable en
    // magasin, un ecran d'erreur non.
    const list = run([recipeEntry(999, 2)], [], [])
    expect(list.items).toEqual([])
  })

  it('ignore une entree qui pointe vers un ingredient supprime', () => {
    expect(run([ingredientEntry(999, 100)], []).items).toEqual([])
  })

  it('rend une liste vide sur une semaine vide', () => {
    const list = run([], [])
    expect(list.items).toEqual([])
    expect(list.totalEur).toBe('0.00')
    expect(list.missingPriceCount).toBe(0)
  })
})

describe('couts', () => {
  it('somme les couts et compte les ingredients sans prix', () => {
    const priced = ing(1, 'Beurre', { priceEur: '4.00', priceQuantityG: 250 }) // 0,016 €/g
    const free = ing(2, 'Sel')
    const list = run([ingredientEntry(1, 250), ingredientEntry(2, 10)], [priced, free])

    expect(list.totalEur).toBe('4.00')
    expect(list.missingPriceCount).toBe(1)
    expect(list.items.find((i) => i.name === 'Sel')?.costEur).toBeNull()
  })

  it('exclut du total sans exclure de la liste', () => {
    const list = run([ingredientEntry(1, 100)], [ing(1, 'Sel')])
    expect(list.items).toHaveLength(1)
    expect(list.totalEur).toBe('0.00')
  })
})

describe('frigo', () => {
  const yaourt = ing(1, 'Yaourt')

  it('pre-coche quand le stock couvre le besoin', () => {
    const list = run([ingredientEntry(1, 200)], [yaourt], [], [[1, 480]])
    expect(list.items[0]?.isCoveredByPantry).toBe(true)
    expect(list.items[0]?.inPantryG).toBe(480)
  })

  it('ne pre-coche pas un stock insuffisant', () => {
    expect(run([ingredientEntry(1, 500)], [yaourt], [], [[1, 480]]).items[0]?.isCoveredByPantry).toBe(false)
  })

  it('ne pre-coche pas sans stock', () => {
    expect(run([ingredientEntry(1, 200)], [yaourt]).items[0]?.isCoveredByPantry).toBe(false)
  })
})

describe('tri', () => {
  it('place les rayons renseignes avant les autres', () => {
    const list = run(
      [ingredientEntry(1, 100), ingredientEntry(2, 100)],
      [ing(1, 'Sans rayon'), ing(2, 'Tomate', { categoryL1: 'Légumes' })],
    )
    expect(list.items.map((i) => i.name)).toEqual(['Tomate', 'Sans rayon'])
  })

  it('trie les ligatures a leur place alphabetique', () => {
    // Le desktop comparait des points de code : Œ vaut U+0152, au-dela de Z,
    // donc « Œuf » se retrouvait en fin de liste. En rayon, on le cherche a O.
    const list = run(
      [ingredientEntry(1, 100), ingredientEntry(2, 100), ingredientEntry(3, 100)],
      [ing(1, 'Zeste'), ing(2, 'Œuf'), ing(3, 'Ananas')],
    )
    expect(list.items.map((i) => i.name)).toEqual(['Ananas', 'Œuf', 'Zeste'])
  })

  it('ignore les accents dans le tri', () => {
    const list = run(
      [ingredientEntry(1, 100), ingredientEntry(2, 100)],
      [ing(1, 'Épinard'), ing(2, 'Endive')],
    )
    expect(list.items.map((i) => i.name)).toEqual(['Endive', 'Épinard'])
  })
})

describe('groupByCategory', () => {
  it('decoupe en sections consecutives', () => {
    const list = run(
      [ingredientEntry(1, 100), ingredientEntry(2, 100), ingredientEntry(3, 100)],
      [
        ing(1, 'Tomate', { categoryL1: 'Légumes' }),
        ing(2, 'Carotte', { categoryL1: 'Légumes' }),
        ing(3, 'Sel'),
      ],
    )
    const sections = groupByCategory(list.items)
    expect(sections.map((s) => s.category)).toEqual(['Légumes', 'Non catégorisé'])
    expect(sections[0]?.items).toHaveLength(2)
  })
})

describe('formatShoppingQuantity', () => {
  it('affiche les pieces quand elles ont un sens', () => {
    expect(formatShoppingQuantity({ quantityG: 360, pieceCount: 6 })).toBe(`360${NBSP}g · ≈ 6 pièces`)
    expect(formatShoppingQuantity({ quantityG: 60, pieceCount: 1 })).toBe(`60${NBSP}g · ≈ 1 pièce`)
  })

  it('s en tient aux grammes sinon', () => {
    expect(formatShoppingQuantity({ quantityG: 1500, pieceCount: null })).toBe(`1,5${NBSP}kg`)
  })
})

describe('formatAsText', () => {
  it('rend les sections, les cases et le total', () => {
    const list = run(
      [ingredientEntry(1, 250)],
      [ing(1, 'Beurre', { categoryL1: 'Frais', priceEur: '4.00', priceQuantityG: 250 })],
    )
    const text = formatAsText(list)
    expect(text).toContain('Liste de courses — 2026-W18')
    expect(text).toContain('— Frais —')
    expect(text).toContain('☐ Beurre')
    expect(text).toContain('Total : 4,00 €') // virgule decimale
  })

  it('signale les ingredients sans prix dans le total', () => {
    expect(formatAsText(run([ingredientEntry(1, 100)], [ing(1, 'Sel')]))).toContain('1 ingrédient(s) sans prix')
  })

  it('gere la semaine vide', () => {
    expect(formatAsText(run([], []))).toContain('(aucun ingrédient)')
  })
})
