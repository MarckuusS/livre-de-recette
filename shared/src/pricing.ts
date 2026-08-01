/**
 * Calculs de cout. Decimal partout — jamais de float sur des euros.
 *
 * Portage de app/domain/pricing.py.
 *
 * Deux points de fidelite qui ne se voient pas mais changent les totaux :
 *
 *   1. L'arrondi se fait LIGNE PAR LIGNE au centime, puis on somme. Arrondir
 *      seulement le total donnerait des ecarts d'un centime par rapport a ce
 *      que le desktop affiche aujourd'hui.
 *
 *   2. ROUND_HALF_UP, pas le mode par defaut. Python arrondit au pair le plus
 *      proche (banker's rounding) par defaut, si bien que `pricing.py` et
 *      `shopping_service.py` n'arrondissaient PAS pareil — 0,125 € devenait
 *      0,13 € d'un cote et 0,12 € de l'autre (annexe #5 de la spec).
 *      Tout est harmonise sur HALF_UP ici.
 */

import Decimal from 'decimal.js'
import type { Ingredient, Recipe, RecipeLine } from './models.js'

const CENTS = 2
const HALF_UP = Decimal.ROUND_HALF_UP

/** Arrondit au centime, ROUND_HALF_UP. */
export function toCents(value: Decimal): Decimal {
  return value.toDecimalPlaces(CENTS, HALF_UP)
}

/** Serialise un montant pour l'API : chaine a 2 decimales. */
export function formatAmount(value: Decimal): string {
  return toCents(value).toFixed(CENTS)
}

/**
 * Formate un montant pour l'affichage francais : « 12,50 € ».
 *
 * L'espace avant le symbole est INSECABLE (U+00A0) : sans elle, un montant en
 * fin de ligne se coupe entre le nombre et le « € ». Le separateur de milliers,
 * lui, est choisi par Intl et vaut U+202F en fr-FR — une espace FINE insecable,
 * qui n'est ni l'une ni l'autre des deux precedentes. Ne jamais comparer une
 * chaine formatee a un litteral tape a la main : elles se ressemblent a l'oeil
 * et different pour `===`.
 */
export function formatEuros(value: Decimal | string | null): string {
  if (value === null) return '—'
  const d = typeof value === 'string' ? new Decimal(value) : value
  const amount = toCents(d).toNumber().toLocaleString('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${amount} €`
}

/**
 * Prix au gramme, en pleine precision (aucun arrondi ici — arrondir avant de
 * multiplier fausserait tout).
 *
 * Retourne `null` si le prix ou la quantite de reference manquent. Attention,
 * comportement repris du Python (`not self.price_quantity_g`) : une quantite
 * de reference a 0 est traitee comme absente, pas comme une division par zero.
 */
export function pricePerG(
  ingredient: Pick<Ingredient, 'priceEur' | 'priceQuantityG'>,
): Decimal | null {
  if (ingredient.priceEur === null) return null
  if (!ingredient.priceQuantityG) return null
  return new Decimal(ingredient.priceEur).div(new Decimal(ingredient.priceQuantityG))
}

/** Cout d'une quantite d'ingredient, arrondi au centime. `null` si pas de prix. */
export function ingredientCost(
  ingredient: Pick<Ingredient, 'priceEur' | 'priceQuantityG'>,
  quantityG: number,
): Decimal | null {
  const perG = pricePerG(ingredient)
  if (perG === null) return null
  return toCents(perG.mul(new Decimal(quantityG)))
}

export function lineCost(line: Pick<RecipeLine, 'ingredient' | 'quantityG'>): Decimal | null {
  return ingredientCost(line.ingredient, line.quantityG)
}

export interface RecipeCost {
  readonly total: Decimal
  readonly perPortion: Decimal
  /** Lignes sans prix : exclues du total mais comptees, pour que l'UI le dise. */
  readonly missing: readonly RecipeLine[]
}

/**
 * Cout d'une recette. Les lignes sans prix sont ignorees dans le total et
 * renvoyees a part — un total de 3 € sur une recette dont la moitie des
 * ingredients n'ont pas de prix serait trompeur sans cette information.
 */
export function recipeCost(recipe: Pick<Recipe, 'lines' | 'defaultPortions'>): RecipeCost {
  let total = new Decimal(0)
  const missing: RecipeLine[] = []

  for (const line of recipe.lines) {
    const cost = lineCost(line)
    if (cost === null) missing.push(line)
    else total = total.plus(cost)
  }

  const rounded = toCents(total)
  const portions = Math.max(recipe.defaultPortions, 1)
  return {
    total: rounded,
    perPortion: toCents(rounded.div(new Decimal(portions))),
    missing,
  }
}

/**
 * Cout d'une entree de calendrier.
 * Recette : cout total x (portions servies / portions par defaut).
 * Ingredient : cout de la quantite.
 */
export function mealPlanEntryCost(
  entry: { readonly portions: number | null; readonly quantityG: number | null },
  target:
    | { readonly kind: 'recipe'; readonly recipe: Pick<Recipe, 'lines' | 'defaultPortions'> }
    | { readonly kind: 'ingredient'; readonly ingredient: Pick<Ingredient, 'priceEur' | 'priceQuantityG'> },
): Decimal | null {
  if (target.kind === 'recipe') {
    const { total, missing } = recipeCost(target.recipe)
    if (missing.length > 0 && total.isZero()) return null
    const ratio = new Decimal(entry.portions ?? 1).div(
      new Decimal(Math.max(target.recipe.defaultPortions, 1)),
    )
    return toCents(total.mul(ratio))
  }
  return ingredientCost(target.ingredient, entry.quantityG ?? 0)
}
