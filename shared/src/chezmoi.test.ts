import { describe, expect, it } from 'vitest'
import type { Ingredient, PantryStock } from './models.js'

import { expiringIngredientIds, expiringLotCount, recipesUsingAny } from './expiring.js'
import { restockLines, restockRatio } from './restock.js'
import {
  STORAGE_LABELS,
  STORAGE_SPACES,
  UNSTORED_LABEL,
  isStorageSpace,
  storageLabel,
} from './storage.js'

const AUJOURDHUI = new Date(2026, 7, 14) // 14 aout 2026

const stock = (ingredientId: number, expiryDate: string | null, quantityG = 100): PantryStock =>
  ({
    id: ingredientId,
    ingredientId,
    quantityG,
    expiryDate,
    storage: null,
    storageSince: null,
    unit: null,
    notes: null,
    addedAt: null,
    updatedAt: null,
  }) as PantryStock

const ingredient = (id: number, patch: Partial<Ingredient> = {}): Ingredient =>
  ({
    id,
    name: `Produit ${id}`,
    categoryL1: null,
    restockThresholdG: null,
    nutriscoreGrade: null,
    ...patch,
  }) as unknown as Ingredient

// ---------------------------------------------------------------------------

describe('storage', () => {
  it('a exactement TROIS espaces, et un quatrieme etat qui n en est pas un', () => {
    expect(STORAGE_SPACES).toEqual(['frigo', 'placard', 'congelateur'])
    // `null` veut dire "pas encore range". Ce n'est pas un lieu, c'est une
    // absence de lieu, et l'ecran l'expose au lieu de deviner.
    expect(isStorageSpace(null)).toBe(false)
    expect(storageLabel(null)).toBe(UNSTORED_LABEL)
  })

  it('nomme CHAQUE espace, sans exception possible', () => {
    // Meme invariant que GOAL_DIRECTIONS : le Record rend une entree manquante
    // impossible a la compilation, ce test le garde a l'execution.
    for (const espace of STORAGE_SPACES) {
      expect(STORAGE_LABELS[espace]).toBeTruthy()
      expect(storageLabel(espace)).toBe(STORAGE_LABELS[espace])
    }
    expect(Object.keys(STORAGE_LABELS)).toHaveLength(STORAGE_SPACES.length)
  })

  it('refuse un lieu invente, y compris un rayon de magasin', () => {
    // Le piege du chantier : "Surgeles" est un RAYON, pas un lieu. Les deux
    // axes se ressemblent et ne se deduisent pas l'un de l'autre.
    expect(isStorageSpace('surgeles')).toBe(false)
    expect(isStorageSpace('Frigo')).toBe(false) // sensible a la casse, comme le CHECK
    expect(isStorageSpace(3)).toBe(false)
  })
})

// ---------------------------------------------------------------------------

describe('restockLines', () => {
  it('ne produit RIEN pour un produit sans seuil', () => {
    // `null` veut dire "non suivi", ce qui est le cas de presque toute la
    // bibliotheque : une ligne par produit noierait les quelques suivis.
    const lignes = restockLines([ingredient(1)], new Map([[1, 0]]))
    expect(lignes).toEqual([])
  })

  it('LE SEUIL EST UN PLANCHER, PAS UNE CIBLE : au seuil exact, rien', () => {
    /*
     * Sans cette regle, un produit maintenu pile a son seuil reapparaitrait a
     * chaque liste de courses sans qu'on comprenne pourquoi.
     */
    const ingr = [ingredient(1, { restockThresholdG: 300 })]
    expect(restockLines(ingr, new Map([[1, 300]]))).toEqual([])
    expect(restockLines(ingr, new Map([[1, 299]]))).toHaveLength(1)
  })

  it('un stock a zero manque tout le seuil', () => {
    const [ligne] = restockLines([ingredient(1, { restockThresholdG: 300 })], new Map())
    expect(ligne?.inStockG).toBe(0)
    expect(ligne?.missingG).toBe(300)
  })

  it('le manque est la difference, jamais un negatif', () => {
    const [ligne] = restockLines(
      [ingredient(1, { restockThresholdG: 300 })],
      new Map([[1, 150]]),
    )
    expect(ligne?.missingG).toBe(150)
  })

  it('trie avec le meme collator que la liste de courses', () => {
    // Deux tris differents pour deux listes qui s'affichent l'une sous l'autre
    // se verraient tout de suite. « Oeuf » vaut U+0152, au-dela de Z.
    const lignes = restockLines(
      [
        ingredient(1, { name: 'Zeste', restockThresholdG: 10 }),
        ingredient(2, { name: 'Œuf', restockThresholdG: 10 }),
        ingredient(3, { name: 'Ail', restockThresholdG: 10 }),
      ],
      new Map(),
    )
    expect(lignes.map((l) => l.name)).toEqual(['Ail', 'Œuf', 'Zeste'])
  })

  it('ignore un seuil nul ou negatif, que le CHECK interdit deja en base', () => {
    expect(restockLines([ingredient(1, { restockThresholdG: 0 })], new Map())).toEqual([])
    expect(restockLines([ingredient(1, { restockThresholdG: -5 })], new Map())).toEqual([])
  })
})

describe('restockRatio', () => {
  it('se lit PAR RAPPORT AU SEUIL, pas a un plein que personne n a saisi', () => {
    /*
     * C'est la difference avec le pourcentage de remplissage des maquettes :
     * pour dire "70 % plein", il faudrait connaitre la contenance du paquet
     * neuf, que rien ne porte. Ici la barre repond a une question qui a une
     * reponse.
     */
    expect(restockRatio(150, 300)).toBe(0.5)
    expect(restockRatio(0, 300)).toBe(0)
  })

  it('remplit la barre sans la deborder au-dessus du seuil', () => {
    expect(restockRatio(900, 300)).toBe(1)
  })

  it('ne divise pas par zero', () => {
    expect(restockRatio(100, 0)).toBe(0)
  })
})

// ---------------------------------------------------------------------------

describe('expiringIngredientIds', () => {
  it('retient ce qui expire dans la fenetre', () => {
    const ids = expiringIngredientIds(
      [stock(1, '2026-08-16'), stock(2, '2026-08-25')],
      AUJOURDHUI,
      5,
    )
    expect([...ids]).toEqual([1])
  })

  it('retient ce qui est DEJA PERIME, jours negatifs donc sous le seuil', () => {
    const ids = expiringIngredientIds([stock(1, '2026-08-01')], AUJOURDHUI, 5)
    expect(ids.has(1)).toBe(true)
  })

  it('n entre JAMAIS un lot sans date', () => {
    // L'absence de date n'est pas une urgence, c'est une absence d'information.
    const ids = expiringIngredientIds([stock(1, null)], AUJOURDHUI, 999)
    expect(ids.size).toBe(0)
  })

  it('LA FENETRE EST EN JOURS, pas en nombre de lots', () => {
    /*
     * "Les 3 plus urgents" remonterait trois produits meme quand aucun ne
     * presse, et n'en remonterait que trois le jour ou huit perissent.
     */
    const rien = expiringIngredientIds([stock(1, '2026-09-30')], AUJOURDHUI, 5)
    expect(rien.size).toBe(0)
    const huit = expiringIngredientIds(
      Array.from({ length: 8 }, (_, i) => stock(i + 1, '2026-08-15')),
      AUJOURDHUI,
      5,
    )
    expect(huit.size).toBe(8)
  })

  it('dedoublonne : deux lots du meme produit ne font qu un identifiant', () => {
    const ids = expiringIngredientIds([stock(1, '2026-08-15'), stock(1, '2026-08-16')], AUJOURDHUI, 5)
    expect(ids.size).toBe(1)
  })
})

describe('expiringLotCount', () => {
  it('compte des LOTS et non des produits', () => {
    // Deux briques de lait ouvertes a une semaine d'ecart sont deux choses a
    // consommer, et c'est ce qu'on voit en ouvrant le frigo.
    const n = expiringLotCount([stock(1, '2026-08-15'), stock(1, '2026-08-16')], AUJOURDHUI, 5)
    expect(n).toBe(2)
  })
})

describe('recipesUsingAny', () => {
  const recettes = [
    { id: 1, lines: [{ ingredientId: 10 }, { ingredientId: 11 }] },
    { id: 2, lines: [{ ingredientId: 20 }] },
    { id: 3, lines: [] },
  ]

  it('retient une recette des qu UNE SEULE ligne correspond', () => {
    // Le seuil est a une ligne, pas a la majorite : une recette qui sauve le
    // seul produit qui presse rend le service attendu.
    const rendu = recipesUsingAny(recettes, new Set([11]))
    expect(rendu.map((r) => r.id)).toEqual([1])
  })

  it('conserve l ordre d entree, sans NOTER ni CLASSER', () => {
    /*
     * Trier par "nombre d'ingredients urgents utilises" serait une invention :
     * deux recettes qui sauvent chacune un produit different ne sont pas
     * comparables.
     */
    const rendu = recipesUsingAny(recettes, new Set([20, 10]))
    expect(rendu.map((r) => r.id)).toEqual([1, 2])
  })

  it('rend une liste vide quand rien ne presse, sans parcourir les recettes', () => {
    expect(recipesUsingAny(recettes, new Set())).toEqual([])
  })

  it('ignore une recette sans ligne', () => {
    expect(recipesUsingAny(recettes, new Set([99]))).toEqual([])
  })
})
