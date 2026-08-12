/**
 * Derives de la semaine : ce que designe une entree, ses apports, son cout.
 *
 * Aucun calcul n'est invente ici. Tout vient de @livre/shared ; ce module se
 * contente de resoudre les references — l'API rend les recettes et les
 * ingredients a part, indexes par identifiant — puis d'appliquer les formules
 * a un jour ou a une semaine.
 *
 * Rien n'y connait React : l'ecran s'en sert dans des `useMemo`, et ces
 * fonctions restent testables sans harnais.
 */

import {
  MEAL_SLOTS,
  ZERO_NUTRITION,
  addNutrition,
  aggregateRecipe,
  divideNutrition,
  formatGrams,
  macrosFor,
  mealPlanEntryCost,
  mealPlanEntryCostDetail,
  type Ingredient,
  type MealPlanEntry,
  type MealSlot,
  type NutritionTotal,
  type Recipe,
} from '@livre/shared'

import type { CalendarResponse } from '../../lib/queries.js'

/**
 * Un montant, sans importer decimal.js.
 *
 * La bibliotheque est une dependance de @livre/shared, pas du front : la
 * declarer ici pour un simple type creerait une dependance non declaree dans
 * web/package.json. Le type de retour de `mealPlanEntryCost` la nomme deja.
 */
export type Money = NonNullable<ReturnType<typeof mealPlanEntryCost>>

/**
 * Une entree telle qu'elle revient du serveur : son identifiant est acquis.
 *
 * Le schema partage autorise `id: null` parce qu'il sert aussi a la creation.
 * Cote ecran, une entree sans identifiant ne pourrait etre ni modifiee ni
 * supprimee : ce type evite d'avoir a le verifier a chaque bouton.
 */
export type SavedEntry = MealPlanEntry & { readonly id: number }

export const isSaved = (entry: MealPlanEntry): entry is SavedEntry => entry.id !== null

/** Ce que designe une entree, une fois resolu. `null` = reference orpheline. */
export type EntryTarget =
  | { readonly kind: 'recipe'; readonly recipe: Recipe }
  | { readonly kind: 'ingredient'; readonly ingredient: Ingredient }
  | null

export function targetOf(entry: MealPlanEntry, data: CalendarResponse): EntryTarget {
  if (entry.recipeId !== null) {
    const recipe = data.recipes[String(entry.recipeId)]
    return recipe ? { kind: 'recipe', recipe } : null
  }
  if (entry.ingredientId !== null) {
    const ingredient = data.ingredients[String(entry.ingredientId)]
    return ingredient ? { kind: 'ingredient', ingredient } : null
  }
  return null
}

/** Nom affiche. Une recette supprimee laisse une entree qu'il faut nommer quand meme. */
export function entryName(entry: MealPlanEntry, data: CalendarResponse): string {
  const target = targetOf(entry, data)
  if (target === null) return 'Entrée orpheline'
  return target.kind === 'recipe' ? target.recipe.name : target.ingredient.name
}

/**
 * Quantite lisible. La regle XOR se voit ici : des PORTIONS pour une recette,
 * des GRAMMES pour un ingredient, jamais les deux.
 */
export function entryAmountLabel(entry: MealPlanEntry): string {
  if (entry.recipeId !== null) {
    const portions = entry.portions ?? 1
    const value = portions.toLocaleString('fr-FR', { maximumFractionDigits: 2 })
    return `${value} portion${portions > 1 ? 's' : ''}`
  }
  return formatGrams(entry.quantityG ?? 0)
}

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

export function entryNutrition(entry: MealPlanEntry, data: CalendarResponse): NutritionTotal {
  const target = targetOf(entry, data)
  if (target === null) return ZERO_NUTRITION

  if (target.kind === 'ingredient') return macrosFor(target.ingredient, entry.quantityG ?? 0)

  const portions = entry.portions ?? 1
  if (portions <= 0) return ZERO_NUTRITION
  const { total } = aggregateRecipe(target.recipe)
  // Mise a l'echelle sans recopier de formule : diviser par
  // (portions par defaut / portions servies) revient exactement a multiplier
  // par le rapport des portions, ce que fait `nutrition_service._scale`.
  return divideNutrition(total, Math.max(target.recipe.defaultPortions, 1) / portions)
}

export function sumNutrition(
  entries: readonly MealPlanEntry[],
  data: CalendarResponse,
): NutritionTotal {
  return entries.reduce(
    (total, entry) => addNutrition(total, entryNutrition(entry, data)),
    ZERO_NUTRITION,
  )
}

// ---------------------------------------------------------------------------
// Cout
// ---------------------------------------------------------------------------

export interface CostTotal {
  /** `null` quand aucune ligne n'a de prix : « — » plutot que « 0,00 € ». */
  readonly total: Money | null
  /**
   * Lignes d'ingredient sans prix, sur toutes les entrees.
   *
   * Compter les ENTREES au lieu des lignes rendait l'avertissement muet dans
   * le cas le plus courant : une recette dont deux ingredients sur cinq n'ont
   * pas de prix produit un cout non nul, donc l'entree passait pour complete,
   * et la carte annonçait un budget sous-estime sans le moindre signe.
   */
  readonly missingLines: number
  /** Entrees dont la recette ou l'ingredient a disparu : rien n'est chiffrable. */
  readonly orphanCount: number
}

/**
 * Cout d'un ensemble d'entrees.
 *
 * Divergence assumee avec le desktop : celui-ci ignorait purement et
 * simplement une recette introuvable, si bien qu'un total pouvait etre faux
 * sans que rien ne le signale. Ici une reference orpheline est comptee a part :
 * le total reste partiel, mais l'interface peut le dire.
 */
export function entriesCost(entries: readonly MealPlanEntry[], data: CalendarResponse): CostTotal {
  let total: Money | null = null
  let missingLines = 0
  let orphanCount = 0

  for (const entry of entries) {
    const target = targetOf(entry, data)
    if (target === null) {
      orphanCount += 1
      continue
    }
    const { cost, missingLines: missing } = mealPlanEntryCostDetail(entry, target)
    missingLines += missing
    if (cost !== null) total = total === null ? cost : total.plus(cost)
  }

  return { total, missingLines, orphanCount }
}

// ---------------------------------------------------------------------------
// Regroupements
// ---------------------------------------------------------------------------

export const entriesOfDay = (data: CalendarResponse, dayOfWeek: number): SavedEntry[] =>
  data.entries.filter(isSaved).filter((entry) => entry.dayOfWeek === dayOfWeek)

export const entriesOfSlot = (entries: readonly SavedEntry[], slot: MealSlot): SavedEntry[] =>
  entries.filter((entry) => entry.slot === slot)

/**
 * Valeur d'un `<select>` de creneau ramenee au type du domaine.
 *
 * Le repli sur « midi » ne peut se produire que si quelqu'un bricole le DOM :
 * les options sont construites a partir de MEAL_SLOTS.
 */
export const toMealSlot = (value: string): MealSlot =>
  MEAL_SLOTS.find((slot) => slot === value) ?? 'noon'


// ---------------------------------------------------------------------------
// Le tableau reglementaire
// ---------------------------------------------------------------------------

/**
 * Les huit lignes de l'etiquetage, dans l'ordre du reglement UE 1169/2011.
 *
 * Vit ici plutot que dans l'ecran Semaine depuis que la feuille d'un repas
 * affiche le meme tableau : deux listes a tenir d'accord auraient diverge au
 * premier ajout.
 */
export interface NutrientRow {
  readonly key: keyof NutritionTotal
  readonly label: string
  readonly unit: string
  readonly decimals: number
  /** Ligne « dont … », en retrait et en gris comme sur l'etiquetage. */
  readonly sub?: boolean | undefined
}

/** Ordre du reglement UE 1169/2011, celui de l'etiquetage alimentaire. */
export const NUTRIENT_ROWS: readonly NutrientRow[] = [
  { key: 'kcal', label: 'Énergie', unit: 'kcal', decimals: 0 },
  { key: 'fats', label: 'Lipides', unit: 'g', decimals: 1 },
  { key: 'saturatedFats', label: 'dont acides gras saturés', unit: 'g', decimals: 1, sub: true },
  { key: 'carbs', label: 'Glucides', unit: 'g', decimals: 1 },
  { key: 'sugars', label: 'dont sucres', unit: 'g', decimals: 1, sub: true },
  { key: 'fiber', label: 'Fibres', unit: 'g', decimals: 1 },
  { key: 'proteins', label: 'Protéines', unit: 'g', decimals: 1 },
  { key: 'salt', label: 'Sel', unit: 'g', decimals: 2 },
]

/**
 * Une valeur nutritionnelle.
 *
 * « — » quand il n'y a rien a totaliser : afficher « 0 kcal » pour une journee
 * vide laisserait croire a une donnee mesuree. Une macro inconnue, elle,
 * compte pour 0 dans l'agregat — regle du domaine, reprise du desktop.
 */
export function formatNutrient(entryCount: number, value: number, row: NutrientRow): string {
  if (entryCount === 0) return '—'
  const formatted = value.toLocaleString('fr-FR', {
    minimumFractionDigits: row.decimals,
    maximumFractionDigits: row.decimals,
  })
  return `${formatted} ${row.unit}`
}
