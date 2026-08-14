/**
 * Ce qui va perimer, et les recettes qui s'en servent.
 *
 * C'EST `feasibility.ts` VU PAR L'AUTRE BOUT. La faisabilite part d'une recette
 * et demande "ai-je de quoi la faire". Ici on part du frigo et on demande "que
 * faire de ce qui va se perdre". Meme donnee, question inverse.
 *
 * ET C'EST POURQUOI CE MODULE EST SEPARE. Melanger la date a `feasibility`
 * ferait cesser d'etre faisable une recette dont un seul lot expire, sur
 * l'ecran Recettes, alors qu'on peut parfaitement la cuisiner : on cuisine avec
 * les carottes qui ne perissent pas. La faisabilite se calcule donc toujours
 * sur le stock ENTIER, et l'urgence se calcule a cote.
 *
 * AUCUNE RECETTE N'EST NOTEE NI CLASSEE ICI. Le module rend celles qui touchent
 * a un produit qui presse, dans l'ordre ou elles arrivent. Les trier par
 * "nombre d'ingredients urgents utilises" serait une invention : deux recettes
 * qui sauvent chacune un produit different ne sont pas comparables.
 */

import type { PantryStock } from './models.js'
import { daysUntil } from './isoweek.js'

/**
 * Les ingredients dont un lot expire dans `withinDays` jours ou moins.
 *
 * LA FENETRE EST EN JOURS, PAS EN NOMBRE DE LOTS. "Les 3 produits les plus
 * urgents" remonterait trois produits meme quand aucun ne presse, et n'en
 * remonterait que trois le jour ou huit perissent.
 *
 * Un lot SANS DATE n'entre jamais dans l'ensemble : l'absence de date n'est pas
 * une urgence, c'est une absence d'information. Un lot DEJA PERIME y entre, ses
 * jours restants etant negatifs, donc sous le seuil : c'est exactement ce qu'on
 * veut voir en premier.
 */
export function expiringIngredientIds(
  stocks: readonly PantryStock[],
  today: Date,
  withinDays: number,
): ReadonlySet<number> {
  const ids = new Set<number>()
  for (const stock of stocks) {
    if (stock.expiryDate === null) continue
    if (daysUntil(stock.expiryDate, today) <= withinDays) ids.add(stock.ingredientId)
  }
  return ids
}

/**
 * Les recettes qui utilisent AU MOINS UN de ces ingredients.
 *
 * Le seuil est a une ligne, pas a la majorite : une recette qui sauve le seul
 * produit qui presse rend le service attendu, meme si ses onze autres
 * ingredients sont au placard depuis six mois.
 *
 * Generique sur la recette : le Worker manipule des lignes compactes, le front
 * des recettes completes, et ce module n'a besoin que des identifiants.
 */
export function recipesUsingAny<
  T extends { readonly lines: readonly { readonly ingredientId: number }[] },
>(recipes: readonly T[], ids: ReadonlySet<number>): T[] {
  if (ids.size === 0) return []
  return recipes.filter((recipe) => recipe.lines.some((line) => ids.has(line.ingredientId)))
}

/**
 * Combien de lots pressent, pour l'annonce en tete d'ecran.
 *
 * Compte des LOTS et non des ingredients : deux briques de lait ouvertes a une
 * semaine d'ecart sont deux choses a consommer, et c'est ce qu'on voit en
 * ouvrant le frigo.
 */
export function expiringLotCount(
  stocks: readonly PantryStock[],
  today: Date,
  withinDays: number,
): number {
  return stocks.filter(
    (stock) => stock.expiryDate !== null && daysUntil(stock.expiryDate, today) <= withinDays,
  ).length
}
