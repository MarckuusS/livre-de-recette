/**
 * Agregation nutritionnelle. Fonctions pures : aucune base, aucun reseau.
 *
 * Portage de app/domain/nutrition.py. Toutes les valeurs de `Ingredient` sont
 * POUR 100 G (convention CIQUAL) et en CRU. Les totaux, eux, sont en unites
 * absolues.
 *
 * Regle reprise telle quelle : une macro `null` (« inconnue ») contribue 0 au
 * total. Une recette dont un ingredient n'a pas de proteines renseignees
 * affiche donc un total sous-estime, pas une erreur. C'est un choix du desktop
 * qu'on conserve — mais l'interface doit signaler les donnees manquantes.
 */

import type { Ingredient, NutritionTotal, Recipe, RecipeLine } from './models.js'

export const ZERO_NUTRITION: NutritionTotal = {
  kcal: 0,
  proteins: 0,
  carbs: 0,
  sugars: 0,
  fats: 0,
  saturatedFats: 0,
  fiber: 0,
  salt: 0,
}

export function addNutrition(a: NutritionTotal, b: NutritionTotal): NutritionTotal {
  return {
    kcal: a.kcal + b.kcal,
    proteins: a.proteins + b.proteins,
    carbs: a.carbs + b.carbs,
    sugars: a.sugars + b.sugars,
    fats: a.fats + b.fats,
    saturatedFats: a.saturatedFats + b.saturatedFats,
    fiber: a.fiber + b.fiber,
    salt: a.salt + b.salt,
  }
}

/** Divise un total. Leve si `n <= 0`, comme `NutritionTotal.divided_by`. */
export function divideNutrition(total: NutritionTotal, n: number): NutritionTotal {
  if (n <= 0) throw new RangeError('portions must be > 0')
  return {
    kcal: total.kcal / n,
    proteins: total.proteins / n,
    carbs: total.carbs / n,
    sugars: total.sugars / n,
    fats: total.fats / n,
    saturatedFats: total.saturatedFats / n,
    fiber: total.fiber / n,
    salt: total.salt / n,
  }
}

/** Ramene les valeurs pour 100 g a la quantite reelle. `null` compte pour 0. */
export function macrosFor(
  ingredient: Pick<
    Ingredient,
    'kcal' | 'proteins' | 'carbs' | 'sugars' | 'fats' | 'saturatedFats' | 'fiber' | 'salt'
  >,
  quantityG: number,
): NutritionTotal {
  const factor = quantityG / 100
  const safe = (v: number | null): number => (v ?? 0) * factor
  return {
    kcal: safe(ingredient.kcal),
    proteins: safe(ingredient.proteins),
    carbs: safe(ingredient.carbs),
    sugars: safe(ingredient.sugars),
    fats: safe(ingredient.fats),
    saturatedFats: safe(ingredient.saturatedFats),
    fiber: safe(ingredient.fiber),
    salt: safe(ingredient.salt),
  }
}

export function aggregateLines(lines: readonly RecipeLine[]): NutritionTotal {
  return lines.reduce(
    (total, line) => addNutrition(total, macrosFor(line.ingredient, line.quantityG)),
    ZERO_NUTRITION,
  )
}

export interface RecipeNutrition {
  readonly total: NutritionTotal
  readonly perPortion: NutritionTotal
  /** Valeurs ramenees a 100 g de preparation crue — la colonne reglementaire. */
  readonly per100g: NutritionTotal
  /** Masse crue totale, somme des lignes. */
  readonly totalWeightG: number
  /** Lignes dont au moins une macro est inconnue : l'UI doit le signaler. */
  readonly linesWithUnknownMacros: readonly RecipeLine[]
}

export function aggregateRecipe(
  recipe: Pick<Recipe, 'lines' | 'defaultPortions'>,
): RecipeNutrition {
  const total = aggregateLines(recipe.lines)
  const totalWeightG = recipe.lines.reduce((sum, l) => sum + l.quantityG, 0)
  return {
    total,
    perPortion: divideNutrition(total, Math.max(recipe.defaultPortions, 1)),
    per100g: totalWeightG > 0 ? divideNutrition(total, totalWeightG / 100) : ZERO_NUTRITION,
    totalWeightG,
    linesWithUnknownMacros: recipe.lines.filter((l) => hasUnknownMacros(l.ingredient)),
  }
}

function hasUnknownMacros(ingredient: Ingredient): boolean {
  return (
    ingredient.kcal === null ||
    ingredient.proteins === null ||
    ingredient.carbs === null ||
    ingredient.fats === null
  )
}

// ---------------------------------------------------------------------------
// Composition energetique (Atwater)
// ---------------------------------------------------------------------------

/**
 * Coefficients d'Atwater, en kcal par gramme. Ceux du desktop (MacrosChart.qml).
 * Les fibres a 2 kcal/g suivent la convention europeenne (reglement 1169/2011).
 */
export const ATWATER = { fats: 9, carbs: 4, fiber: 2, proteins: 4 } as const

export interface EnergyBreakdown {
  readonly fatsKcal: number
  readonly carbsKcal: number
  readonly fiberKcal: number
  readonly proteinsKcal: number
  /** Somme des quatre postes ci-dessus. */
  readonly atwaterKcal: number
  /** Energie telle qu'elle est stockee en base. */
  readonly declaredKcal: number
  /**
   * Ecart relatif entre les deux, entre 0 et 1.
   *
   * Les deux divergent regulierement sur les donnees CIQUAL : l'ANSES mesure
   * l'energie plutot que de la recalculer. Le desktop affichait la valeur
   * Atwater au centre du donut tout en montrant la valeur declaree dans le
   * tableau juste a cote, sans jamais le dire (annexe #38 de la spec).
   * Les deux sont exposees ici pour que l'interface tranche explicitement.
   */
  readonly divergence: number
}

export function energyBreakdown(total: NutritionTotal): EnergyBreakdown {
  const fatsKcal = total.fats * ATWATER.fats
  const carbsKcal = total.carbs * ATWATER.carbs
  const fiberKcal = total.fiber * ATWATER.fiber
  const proteinsKcal = total.proteins * ATWATER.proteins
  const atwaterKcal = fatsKcal + carbsKcal + fiberKcal + proteinsKcal
  const declaredKcal = total.kcal
  const ref = Math.max(atwaterKcal, declaredKcal)
  return {
    fatsKcal,
    carbsKcal,
    fiberKcal,
    proteinsKcal,
    atwaterKcal,
    declaredKcal,
    divergence: ref > 0 ? Math.abs(atwaterKcal - declaredKcal) / ref : 0,
  }
}

/**
 * Masse servie apres cuisson, quand le ratio est connu.
 * `cookedWeightPer100gRaw = 300` : 100 g de riz cru donnent 300 g cuits.
 * `null` : on assume 1:1.
 */
export function cookedWeightG(
  ingredient: Pick<Ingredient, 'cookedWeightPer100gRaw'>,
  rawQuantityG: number,
): number {
  const ratio = ingredient.cookedWeightPer100gRaw
  return ratio === null ? rawQuantityG : (rawQuantityG * ratio) / 100
}
