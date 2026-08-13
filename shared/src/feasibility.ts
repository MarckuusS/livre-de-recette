/**
 * Une recette est-elle faisable avec ce qu'on a ?
 *
 * Module PUR : il recoit un frigo deja somme par ingredient, il rend une
 * lecture. Aucune base, aucun reseau.
 *
 * ---------------------------------------------------------------------------
 * IL NE REECRIT PAS LE MOTEUR DE COURSES, IL EN EXTRAIT LA MEME REGLE
 * ---------------------------------------------------------------------------
 * `aggregateShoppingList` calcule deja, par ingredient, `inPantryG` et
 * `isCoveredByPantry` : c'est exactement la question posee ici, a l'echelle
 * d'une recette au lieu d'une semaine. La regle de couverture est donc la
 * MEME, volontairement : deux definitions de « il m'en manque » finiraient par
 * diverger, et l'utilisateur verrait « Frigo OK » sur une recette dont la
 * liste de courses lui reclame un ingredient.
 *
 * ---------------------------------------------------------------------------
 * CE QUE « FAISABLE » VEUT DIRE, ET CE QU'IL NE VEUT PAS DIRE
 * ---------------------------------------------------------------------------
 * Faisable = CHAQUE ligne de la recette est couverte EN QUANTITE par le stock.
 * Pas « presente » : avoir 20 g de riz quand la recette en demande 200 ne rend
 * pas le plat faisable, et un badge vert qui le pretendrait serait pire
 * qu'aucun badge.
 *
 * MAIS le frigo d'une vraie cuisine ne contient ni le sel, ni l'huile, ni les
 * epices. Personne ne saisit une pincee de paprika. Les compter comme
 * manquantes rendrait presque toute recette infaisable, et le bandeau
 * afficherait eternellement zero.
 *
 * D'ou un SEUIL DE QUANTITE, et non une liste de rayons. Ce choix vient des
 * donnees, pas d'une intuition : les rayons de cette application sont ceux
 * d'un magasin (« Epicerie », « Fruits et legumes »), et « Epicerie » contient
 * autant le paprika que les pates. Un rayon ne dit donc rien. Les QUANTITES,
 * elles, sont sans ambiguite. Releve des plus petites lignes reellement
 * saisies : poivre de Cayenne 1 g, fleur de sel 1 g, paprika 1 g, cumin 5 g,
 * huile d'olive 5 g, ail 5 g, vinaigre 5 g, thym 5 g, laurier 5 g, curcuma
 * 5 g, huile 10 g, vinaigre balsamique 10 g, ail 12 et 15 g. Au-dela, on
 * trouve des aliments qui font le plat.
 *
 * C'est une approximation, elle est assumee, et l'ecran doit la dire : une
 * recette « faisable » peut demander une pincee de curry qu'on n'a pas.
 * L'alternative honnete serait de ne rien afficher, ce qui rendrait le frigo
 * muet.
 *
 * Le seuil est volontairement CLAIR plutot que malin : une ligne compte comme
 * couverte si le stock l'atteint, ou si elle pese moins que le seuil. Rien
 * d'autre, aucune tolerance a 90 %, aucune substitution devinee.
 */

import type { Recipe } from './models.js'

/**
 * Sous cette masse, une ligne est un assaisonnement : on la suppose presente.
 *
 * Calibre sur les lignes reellement saisies (voir l'en-tete). Exporte pour que
 * l'ecran puisse l'ecrire au lieu de le repeter en dur.
 */
export const SEASONING_MAX_G = 15

/** Ce qui manque, ligne par ligne. */
export interface MissingLine {
  readonly ingredientId: number
  readonly name: string
  /** Quantite demandee par la recette, deja mise a l'echelle. */
  readonly neededG: number
  /** Quantite au frigo, tous lots confondus. */
  readonly inPantryG: number
  /** Ce qu'il reste a acheter : `neededG - inPantryG`, jamais negatif. */
  readonly shortG: number
}

export interface Feasibility {
  /** Vrai si aucune ligne ne manque. */
  readonly feasible: boolean
  /** Les lignes non couvertes, dans l'ordre de la recette. */
  readonly missing: readonly MissingLine[]
  /** Lignes couvertes par le stock, hors assaisonnements supposes presents. */
  readonly coveredCount: number
  /** Lignes ignorees parce qu'elles pesent moins que le seuil d'assaisonnement. */
  readonly assumedCount: number
}

/**
 * Croise une recette avec le frigo.
 *
 * `portions` permet de poser la question pour un nombre de parts different de
 * celui de la recette : cuisiner deux portions d'une recette qui en fait
 * quatre n'en demande que la moitie. C'est la meme mise a l'echelle que celle
 * de la liste de courses.
 */
export function feasibility(
  recipe: Pick<Recipe, 'lines' | 'defaultPortions'>,
  pantryByIngredient: ReadonlyMap<number, number>,
  portions?: number,
): Feasibility {
  const base = Math.max(recipe.defaultPortions, 1)
  const ratio = portions === undefined ? 1 : portions / base

  const missing: MissingLine[] = []
  let coveredCount = 0
  let assumedCount = 0

  for (const line of recipe.lines) {
    const id = line.ingredient.id
    if (id === null) continue

    const neededG = line.quantityG * ratio
    if (neededG <= SEASONING_MAX_G) {
      assumedCount++
      continue
    }

    const inPantryG = pantryByIngredient.get(id) ?? 0
    if (inPantryG >= neededG) {
      coveredCount++
      continue
    }

    missing.push({
      ingredientId: id,
      name: line.ingredient.name,
      neededG,
      inPantryG,
      shortG: Math.max(0, neededG - inPantryG),
    })
  }

  return { feasible: missing.length === 0, missing, coveredCount, assumedCount }
}

/**
 * Le frigo somme par ingredient, a partir des lots.
 *
 * Un ingredient peut avoir plusieurs lots (deux paquets de riz ouverts a des
 * dates differentes). La liste de courses somme deja de cette facon ; cette
 * fonction existe pour que l'appelant n'ait pas a la reecrire.
 */
export function pantryTotals(
  stocks: readonly { readonly ingredientId: number; readonly quantityG: number }[],
): Map<number, number> {
  const totals = new Map<number, number>()
  for (const s of stocks) {
    totals.set(s.ingredientId, (totals.get(s.ingredientId) ?? 0) + s.quantityG)
  }
  return totals
}
