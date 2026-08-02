/**
 * Ingredients : bibliotheque personnelle, catalogue, prix.
 *
 * Le « catalogue » (CIQUAL, OpenFoodFacts) et la « bibliotheque personnelle »
 * sont la MEME table. Seul `in_personal_library` les distingue. Ajouter un
 * ingredient depuis le catalogue ne copie donc rien : cela bascule un drapeau.
 */

import type { Ingredient } from '@livre/shared'
import { escapeLike, normalizeName, toFtsQuery } from '@livre/shared'

import { toIngredient, type IngredientRow } from '../rows.js'
import { buildSet, NOW_SQL, placeholders, toInt } from './sql.js'

export const INGREDIENT_COLUMNS = `
  id, name, name_normalized, source, source_ref, brand,
  kcal_per_100g, proteins_g, carbs_g, sugars_g,
  fats_g, saturated_fats_g, fiber_g, salt_g,
  price_eur, price_quantity_g, piece_weight_g, cooked_weight_per_100g_raw,
  in_personal_library, category_l1, category_l2, season_months,
  created_at, updated_at`

/** Colonnes modifiables, indexees par le nom camelCase de l'API. */
const WRITABLE = {
  name: 'name',
  source: 'source',
  sourceRef: 'source_ref',
  brand: 'brand',
  kcal: 'kcal_per_100g',
  proteins: 'proteins_g',
  carbs: 'carbs_g',
  sugars: 'sugars_g',
  fats: 'fats_g',
  saturatedFats: 'saturated_fats_g',
  fiber: 'fiber_g',
  salt: 'salt_g',
  priceEur: 'price_eur',
  priceQuantityG: 'price_quantity_g',
  pieceWeightG: 'piece_weight_g',
  cookedWeightPer100gRaw: 'cooked_weight_per_100g_raw',
  inLibrary: 'in_personal_library',
  categoryL1: 'category_l1',
  categoryL2: 'category_l2',
  seasonMonths: 'season_months',
} as const

/**
 * Champs acceptes en ecriture.
 *
 * Volontairement en `unknown` : la validation de forme est deja faite par Zod
 * dans la route, et redeclarer ici chacun des vingt types ne ferait que creer
 * un second endroit a maintenir quand le modele bouge.
 */
export type IngredientWrite = { [K in keyof typeof WRITABLE]?: unknown }

/** Ce qui empeche une suppression definitive, et pourquoi. */
export interface IngredientUsage {
  readonly recipes: number
  readonly mealPlan: number
  readonly pantry: number
}

export class IngredientRepo {
  constructor(private readonly db: D1Database) {}

  // ------------------------------------------------------------------ lecture

  async count(): Promise<number> {
    const row = await this.db.prepare('SELECT COUNT(*) AS c FROM ingredient').first<{ c: number }>()
    return row?.c ?? 0
  }

  async byIds(ids: Iterable<number>): Promise<Map<number, Ingredient>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Map()

    const { results } = await this.db
      .prepare(`SELECT ${INGREDIENT_COLUMNS} FROM ingredient WHERE id IN (${placeholders(unique.length)})`)
      .bind(...unique)
      .all<IngredientRow>()

    return new Map(results.map((r) => [r.id, toIngredient(r)]))
  }

  async get(id: number): Promise<Ingredient | null> {
    const row = await this.db
      .prepare(`SELECT ${INGREDIENT_COLUMNS} FROM ingredient WHERE id = ?`)
      .bind(id)
      .first<IngredientRow>()
    return row ? toIngredient(row) : null
  }

  /**
   * Bibliotheque personnelle, avec recherche optionnelle.
   *
   * La recherche combine deux chemins et fusionne : FTS5 pour le classement
   * par pertinence, et `name_normalized LIKE` pour rattraper ce que le
   * tokenizer ne sait pas faire — les ligatures, « oeuf » ne trouvant pas
   * « Œuf » via FTS5 seul.
   */
  async listPersonal(query: string | null, limit = 500): Promise<Ingredient[]> {
    const fts = toFtsQuery(query)

    if (!fts) {
      const { results } = await this.db
        .prepare(`SELECT ${INGREDIENT_COLUMNS} FROM ingredient WHERE in_personal_library = 1 ORDER BY name LIMIT ?`)
        .bind(limit)
        .all<IngredientRow>()
      return results.map(toIngredient)
    }

    const { results } = await this.db
      .prepare(
        `SELECT ${prefixed('i')}
         FROM ingredient i
         WHERE i.in_personal_library = 1
           AND (i.id IN (SELECT rowid FROM ingredient_fts WHERE ingredient_fts MATCH ?)
                OR i.name_normalized LIKE ? ESCAPE '\\')
         ORDER BY i.name
         LIMIT ?`,
      )
      .bind(fts, `%${escapeLike(normalizeName(query))}%`, limit)
      .all<IngredientRow>()
    return results.map(toIngredient)
  }

  /**
   * Catalogue complet — c'est ce que parcourt la fenetre « Importer ».
   *
   * Contrairement a `listPersonal`, aucun filtre sur `in_personal_library` :
   * on cherche justement ce qui n'y est pas encore. Les lignes deja presentes
   * dans la bibliotheque restent visibles (le front les marque d'une etoile)
   * plutot que d'etre masquees, sinon rechercher un ingredient qu'on possede
   * deja donnerait « aucun resultat », ce qui est deroutant.
   */
  async searchCatalog(
    query: string | null,
    options: { source?: string | null; categoryL1?: string | null; limit?: number; offset?: number } = {},
  ): Promise<{ items: Ingredient[]; totalCount: number }> {
    const { source = null, categoryL1 = null, limit = 50, offset = 0 } = options
    const fts = toFtsQuery(query)

    const where: string[] = []
    const args: unknown[] = []

    if (fts) {
      where.push(`(i.id IN (SELECT rowid FROM ingredient_fts WHERE ingredient_fts MATCH ?) OR i.name_normalized LIKE ? ESCAPE '\\')`)
      args.push(fts, `%${escapeLike(normalizeName(query))}%`)
    }
    if (source) {
      where.push('i.source = ?')
      args.push(source)
    }
    if (categoryL1) {
      where.push('i.category_l1 = ?')
      args.push(categoryL1)
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

    const [page, total] = await Promise.all([
      this.db
        .prepare(`SELECT ${prefixed('i')} FROM ingredient i ${clause} ORDER BY i.name LIMIT ? OFFSET ?`)
        .bind(...args, limit, offset)
        .all<IngredientRow>(),
      this.db
        .prepare(`SELECT COUNT(*) AS c FROM ingredient i ${clause}`)
        .bind(...args)
        .first<{ c: number }>(),
    ])

    return { items: page.results.map(toIngredient), totalCount: total?.c ?? 0 }
  }

  /** Rayons connus, pour alimenter le filtre par categorie. */
  async listCategories(): Promise<Array<{ l1: string; count: number }>> {
    const { results } = await this.db
      .prepare(
        `SELECT category_l1 AS l1, COUNT(*) AS count
         FROM ingredient WHERE category_l1 IS NOT NULL AND category_l1 <> ''
         GROUP BY category_l1 ORDER BY category_l1`,
      )
      .all<{ l1: string; count: number }>()
    return results
  }

  /**
   * Retrouve une fiche par son identifiant d'origine.
   *
   * Cle du scan par code-barres : un produit deja connu localement doit rendre
   * SA fiche — avec le prix releve et le poids a la piece que l'utilisateur a
   * saisis — et non la version brute d'OpenFoodFacts, qui les ecraserait.
   */
  async findBySourceRef(source: string, sourceRef: string): Promise<Ingredient | null> {
    const row = await this.db
      .prepare(`SELECT ${INGREDIENT_COLUMNS} FROM ingredient WHERE source = ? AND source_ref = ? LIMIT 1`)
      .bind(source, sourceRef)
      .first<IngredientRow>()
    return row ? toIngredient(row) : null
  }

  /** Recherche un doublon exact sur le nom normalise, hors ligne `exceptId`. */
  async findByNormalizedName(name: string, exceptId: number | null = null): Promise<Ingredient | null> {
    const row = await this.db
      .prepare(
        `SELECT ${INGREDIENT_COLUMNS} FROM ingredient
         WHERE name_normalized = ? AND (? IS NULL OR id <> ?) LIMIT 1`,
      )
      .bind(normalizeName(name), exceptId, exceptId)
      .first<IngredientRow>()
    return row ? toIngredient(row) : null
  }

  // ------------------------------------------------------------------ ecriture

  async create(payload: IngredientWrite & { name: string }): Promise<number> {
    const columns: string[] = ['name', 'name_normalized']
    const values: unknown[] = [payload.name, normalizeName(payload.name)]

    for (const [key, column] of Object.entries(WRITABLE)) {
      if (key === 'name' || !(key in payload)) continue
      columns.push(column)
      const raw = (payload as Record<string, unknown>)[key]
      values.push(key === 'inLibrary' ? toInt(raw as boolean) ?? 0 : raw ?? null)
    }

    const row = await this.db
      .prepare(
        `INSERT INTO ingredient (${columns.join(', ')}) VALUES (${placeholders(columns.length)})
         RETURNING id`,
      )
      .bind(...values)
      .first<{ id: number }>()

    if (!row) throw new Error("INSERT ingredient n'a rien renvoye")
    return row.id
  }

  /**
   * Mise a jour partielle.
   *
   * `name_normalized` est recalcule des que `name` change : c'est la seule
   * colonne derivee de la table, et un oubli rendrait l'ingredient
   * introuvable par la recherche sans qu'aucune erreur ne le signale.
   */
  async update(id: number, patch: IngredientWrite): Promise<boolean> {
    const normalized: Record<string, unknown> = { ...patch }
    if ('inLibrary' in normalized) normalized['inLibrary'] = toInt(normalized['inLibrary'] as boolean)

    const set = buildSet(normalized, WRITABLE)
    if (!set) return false

    let clause = set.clause
    const values = [...set.values]
    if (typeof patch.name === 'string') {
      clause = `name_normalized = ?, ${clause}`
      values.unshift(normalizeName(patch.name))
    }

    const result = await this.db
      .prepare(`UPDATE ingredient SET ${clause} WHERE id = ?`)
      .bind(...values, id)
      .run()
    return (result.meta.changes ?? 0) > 0
  }

  /** Bascule l'appartenance a la bibliotheque personnelle. */
  async setInLibrary(id: number, inLibrary: boolean): Promise<boolean> {
    const result = await this.db
      .prepare(`UPDATE ingredient SET in_personal_library = ?, updated_at = ${NOW_SQL} WHERE id = ?`)
      .bind(inLibrary ? 1 : 0, id)
      .run()
    return (result.meta.changes ?? 0) > 0
  }

  /**
   * Ou l'ingredient est-il utilise.
   *
   * `recipe_ingredient` porte un ON DELETE RESTRICT : sans cette verification
   * prealable, la suppression echouerait sur une contrainte SQLite dont le
   * message ne dit pas QUELLE recette bloque.
   */
  async usage(id: number): Promise<IngredientUsage> {
    const row = await this.db
      .prepare(
        `SELECT
           (SELECT COUNT(DISTINCT recipe_id) FROM recipe_ingredient WHERE ingredient_id = ?) AS recipes,
           (SELECT COUNT(*) FROM meal_plan_entry  WHERE ingredient_id = ?) AS meal_plan,
           (SELECT COUNT(*) FROM pantry_stock     WHERE ingredient_id = ?) AS pantry`,
      )
      .bind(id, id, id)
      .first<{ recipes: number; meal_plan: number; pantry: number }>()

    return { recipes: row?.recipes ?? 0, mealPlan: row?.meal_plan ?? 0, pantry: row?.pantry ?? 0 }
  }

  /** Noms des recettes qui utilisent l'ingredient — pour un message d'erreur utile. */
  async recipeNamesUsing(id: number, limit = 5): Promise<string[]> {
    const { results } = await this.db
      .prepare(
        `SELECT DISTINCT r.name FROM recipe r
         JOIN recipe_ingredient ri ON ri.recipe_id = r.id
         WHERE ri.ingredient_id = ? ORDER BY r.name LIMIT ?`,
      )
      .bind(id, limit)
      .all<{ name: string }>()
    return results.map((r) => r.name)
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM ingredient WHERE id = ?').bind(id).run()
    return (result.meta.changes ?? 0) > 0
  }

  // ------------------------------------------------------------------- prix

  async listPriceHistory(ingredientId: number): Promise<
    Array<{ id: number; ingredientId: number; priceEur: string; quantityG: number; store: string | null; recordedAt: string; notes: string | null; createdAt: string }>
  > {
    const { results } = await this.db
      .prepare(
        `SELECT id, ingredient_id, price_eur, quantity_g, store, recorded_at, notes, created_at
         FROM ingredient_price_history WHERE ingredient_id = ?
         ORDER BY recorded_at DESC, id DESC`,
      )
      .bind(ingredientId)
      .all<{
        id: number
        ingredient_id: number
        price_eur: string
        quantity_g: number
        store: string | null
        recorded_at: string
        notes: string | null
        created_at: string
      }>()

    return results.map((r) => ({
      id: r.id,
      ingredientId: r.ingredient_id,
      priceEur: r.price_eur,
      quantityG: r.quantity_g,
      store: r.store,
      recordedAt: r.recorded_at,
      notes: r.notes,
      createdAt: r.created_at,
    }))
  }

  /**
   * Enregistre une observation de prix et rafraichit le cache de l'ingredient.
   *
   * `ingredient.price_eur` est une denormalisation de la DERNIERE observation.
   * Les deux ecritures partent dans un `batch` : si la seconde echouait seule,
   * la fiche afficherait un prix que l'historique ne justifie pas.
   *
   * Le cache n'est mis a jour que si l'observation est la plus recente —
   * saisir un releve ancien ne doit pas faire reculer le prix courant.
   */
  async addPriceObservation(entry: {
    ingredientId: number
    priceEur: string
    quantityG: number
    store: string | null
    recordedAt: string
    notes: string | null
  }): Promise<void> {
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO ingredient_price_history
             (ingredient_id, price_eur, quantity_g, store, recorded_at, notes)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(entry.ingredientId, entry.priceEur, entry.quantityG, entry.store, entry.recordedAt, entry.notes),
      this.db
        .prepare(
          `UPDATE ingredient
              SET price_eur = ?, price_quantity_g = ?, updated_at = ${NOW_SQL}
            WHERE id = ?
              AND NOT EXISTS (
                SELECT 1 FROM ingredient_price_history
                 WHERE ingredient_id = ? AND recorded_at > ?)`,
        )
        .bind(entry.priceEur, entry.quantityG, entry.ingredientId, entry.ingredientId, entry.recordedAt),
    ])
  }

  /**
   * Supprime une observation, puis RECALCULE le prix courant.
   *
   * L'oubli du recalcul est la faute qui ne se voit pas : effacer le releve le
   * plus recent laissait la fiche afficher un prix que plus aucune ligne de
   * l'historique ne justifie. Le cache doit toujours refleter le dernier
   * releve restant — ou redevenir vide quand il n'en reste aucun.
   */
  async deletePriceObservation(id: number): Promise<boolean> {
    const row = await this.db
      .prepare('SELECT ingredient_id FROM ingredient_price_history WHERE id = ?')
      .bind(id)
      .first<{ ingredient_id: number }>()
    if (!row) return false

    await this.db.batch([
      this.db.prepare('DELETE FROM ingredient_price_history WHERE id = ?').bind(id),
      // La sous-requete s'evalue APRES le DELETE : D1 execute les requetes d'un
      // batch dans l'ordre. Sans ligne restante, elle rend NULL et le prix
      // s'efface, ce qui est le comportement voulu.
      this.db
        .prepare(
          `UPDATE ingredient SET
             price_eur = (SELECT price_eur FROM ingredient_price_history
                           WHERE ingredient_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1),
             price_quantity_g = (SELECT quantity_g FROM ingredient_price_history
                                  WHERE ingredient_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1),
             updated_at = ${NOW_SQL}
           WHERE id = ?`,
        )
        .bind(row.ingredient_id, row.ingredient_id, row.ingredient_id),
    ])

    return true
  }
}

/** `id, name, ...` -> `i.id, i.name, ...` pour les requetes avec alias. */
function prefixed(alias: string): string {
  return INGREDIENT_COLUMNS.split(',')
    .map((c) => `${alias}.${c.trim()}`)
    .join(', ')
}
