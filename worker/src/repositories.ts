/**
 * Acces aux donnees. Toutes les requetes SQL du Worker vivent ici.
 *
 * Deux contraintes propres a D1, qui expliquent la forme du code :
 *
 *   1. Pas de transaction interactive. On ne peut pas ouvrir une transaction,
 *      lire, decider, puis ecrire. Les ecritures groupees passent par
 *      `db.batch([...])`, qui est atomique mais dont toutes les requetes
 *      doivent etre connues d'avance.
 *
 *   2. Parametres positionnels `?` uniquement — pas de `:nom`.
 *
 * Le chargement en masse (`WHERE id IN (...)`) est systematique : le desktop
 * emettait une requete par entree de calendrier, ce qui coutait ~28 requetes
 * pour une semaine. Ici chaque aller-retour traverse le reseau, donc le N+1
 * n'est plus une lenteur mais une panne de latence.
 */

import type { Ingredient, MealPlanEntry, PantryStock, Recipe } from '@livre/shared'
import { toFtsQuery } from '@livre/shared'

import {
  toIngredient,
  toMealPlanEntry,
  toPantryStock,
  toRecipeShell,
  toTag,
  type IngredientRow,
  type MealPlanEntryRow,
  type PantryStockRow,
  type RecipeRow,
  type TagRow,
} from './rows.js'

const INGREDIENT_COLUMNS = `
  id, name, name_normalized, source, source_ref, brand,
  kcal_per_100g, proteins_g, carbs_g, sugars_g,
  fats_g, saturated_fats_g, fiber_g, salt_g,
  price_eur, price_quantity_g, piece_weight_g, cooked_weight_per_100g_raw,
  in_personal_library, category_l1, category_l2, season_months,
  created_at, updated_at`

/** Genere `?, ?, ?` pour un IN (...). */
const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ')

export class Repositories {
  constructor(private readonly db: D1Database) {}

  // ---------------------------------------------------------------- ingredients

  async countIngredients(): Promise<number> {
    const row = await this.db.prepare('SELECT COUNT(*) AS c FROM ingredient').first<{ c: number }>()
    return row?.c ?? 0
  }

  async listIngredientsByIds(ids: Iterable<number>): Promise<Map<number, Ingredient>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Map()

    const { results } = await this.db
      .prepare(`SELECT ${INGREDIENT_COLUMNS} FROM ingredient WHERE id IN (${placeholders(unique.length)})`)
      .bind(...unique)
      .all<IngredientRow>()

    return new Map(results.map((r) => [r.id, toIngredient(r)]))
  }

  /**
   * Bibliotheque personnelle, avec recherche optionnelle.
   *
   * La recherche combine deux chemins et fusionne : FTS5 pour le classement
   * par pertinence, et `name_normalized LIKE` pour rattraper ce que le
   * tokenizer ne sait pas faire — les ligatures, « oeuf » ne trouvant pas
   * « Œuf » via FTS5 seul.
   */
  async listPersonalIngredients(query: string | null, limit = 500): Promise<Ingredient[]> {
    const fts = toFtsQuery(query)

    if (!fts) {
      const { results } = await this.db
        .prepare(`SELECT ${INGREDIENT_COLUMNS} FROM ingredient WHERE in_personal_library = 1 ORDER BY name LIMIT ?`)
        .bind(limit)
        .all<IngredientRow>()
      return results.map(toIngredient)
    }

    const normalized = (query ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    const { results } = await this.db
      .prepare(
        `SELECT ${INGREDIENT_COLUMNS.split(',').map((c) => `i.${c.trim()}`).join(', ')}
         FROM ingredient i
         WHERE i.in_personal_library = 1
           AND (i.id IN (SELECT rowid FROM ingredient_fts WHERE ingredient_fts MATCH ?)
                OR i.name_normalized LIKE ?)
         ORDER BY i.name
         LIMIT ?`,
      )
      .bind(fts, `%${normalized}%`, limit)
      .all<IngredientRow>()
    return results.map(toIngredient)
  }

  async getIngredient(id: number): Promise<Ingredient | null> {
    const row = await this.db
      .prepare(`SELECT ${INGREDIENT_COLUMNS} FROM ingredient WHERE id = ?`)
      .bind(id)
      .first<IngredientRow>()
    return row ? toIngredient(row) : null
  }

  // ---------------------------------------------------------------- recettes

  /**
   * Recettes completes, lignes et tags compris, en 4 requetes quel que soit
   * le nombre de recettes demandees.
   */
  async listRecipesByIds(ids: Iterable<number>): Promise<Map<number, Recipe>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Map()
    const marks = placeholders(unique.length)

    const [recipeRows, lineRows, tagRows] = await Promise.all([
      this.db.prepare(`SELECT * FROM recipe WHERE id IN (${marks})`).bind(...unique).all<RecipeRow>(),
      this.db
        .prepare(
          `SELECT recipe_id, ingredient_id, ordinal, quantity_g, notes, unit
           FROM recipe_ingredient WHERE recipe_id IN (${marks}) ORDER BY recipe_id, ordinal`,
        )
        .bind(...unique)
        .all<{
          recipe_id: number
          ingredient_id: number
          ordinal: number
          quantity_g: number
          notes: string | null
          unit: string | null
        }>(),
      this.db
        .prepare(
          `SELECT rt.recipe_id, t.id, t.name, t.color_hex, t.created_at
           FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id
           WHERE rt.recipe_id IN (${marks}) ORDER BY t.name`,
        )
        .bind(...unique)
        .all<TagRow & { recipe_id: number }>(),
    ])

    // Les ingredients des lignes, en une requete de plus.
    const ingredients = await this.listIngredientsByIds(lineRows.results.map((l) => l.ingredient_id))

    const recipes = new Map(recipeRows.results.map((r) => [r.id, toRecipeShell(r)]))

    for (const l of lineRows.results) {
      const recipe = recipes.get(l.recipe_id)
      const ingredient = ingredients.get(l.ingredient_id)
      // Ligne orpheline : l'ingredient a disparu. On saute plutot que de
      // fabriquer un ingredient vide qui fausserait nutrition et cout.
      if (!recipe || !ingredient) continue
      ;(recipe.lines as Recipe['lines']).push({
        ingredient,
        quantityG: l.quantity_g,
        unit: l.unit,
        notes: l.notes,
        ordinal: l.ordinal,
      })
    }

    for (const t of tagRows.results) {
      recipes.get(t.recipe_id)?.tags.push(toTag(t))
    }

    return recipes
  }

  async listRecipeSummaries(): Promise<
    Array<{ id: number; name: string; defaultPortions: number; imageKey: string | null; lineCount: number }>
  > {
    const { results } = await this.db
      .prepare(
        `SELECT r.id, r.name, r.default_portions, r.image_key,
                (SELECT COUNT(*) FROM recipe_ingredient ri WHERE ri.recipe_id = r.id) AS line_count
         FROM recipe r ORDER BY r.name`,
      )
      .all<{ id: number; name: string; default_portions: number; image_key: string | null; line_count: number }>()

    return results.map((r) => ({
      id: r.id,
      name: r.name,
      defaultPortions: r.default_portions,
      imageKey: r.image_key,
      lineCount: r.line_count,
    }))
  }

  // ---------------------------------------------------------------- calendrier

  async listWeekEntries(isoWeek: string): Promise<MealPlanEntry[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, iso_week, day_of_week, slot, recipe_id, ingredient_id, quantity_g, portions, ordinal
         FROM meal_plan_entry WHERE iso_week = ? ORDER BY day_of_week, ordinal`,
      )
      .bind(isoWeek)
      .all<MealPlanEntryRow>()
    return results.map(toMealPlanEntry)
  }

  // ---------------------------------------------------------------- frigo

  async listPantry(): Promise<PantryStock[]> {
    const { results } = await this.db
      .prepare(
        // NULL en dernier : un stock sans date de peremption n'est pas urgent.
        `SELECT id, ingredient_id, quantity_g, expiry_date, notes, added_at, updated_at
         FROM pantry_stock ORDER BY (expiry_date IS NULL), expiry_date, id`,
      )
      .all<PantryStockRow>()
    return results.map(toPantryStock)
  }

  /** Totaux par ingredient, tous lots confondus. Alimente le pre-cochage « deja au frigo ». */
  async pantryTotalsByIngredient(): Promise<Map<number, number>> {
    const { results } = await this.db
      .prepare('SELECT ingredient_id, SUM(quantity_g) AS total FROM pantry_stock GROUP BY ingredient_id')
      .all<{ ingredient_id: number; total: number }>()
    return new Map(results.map((r) => [r.ingredient_id, r.total]))
  }

  // ---------------------------------------------------------------- courses

  /** Cases cochees d'une semaine, persistees. Volatiles dans le desktop. */
  async getCheckedItems(isoWeek: string): Promise<number[]> {
    const row = await this.db
      .prepare('SELECT value_json FROM app_setting WHERE key = ?')
      .bind(`shopping.checked.${isoWeek}`)
      .first<{ value_json: string }>()
    if (!row) return []
    try {
      const parsed: unknown = JSON.parse(row.value_json)
      return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : []
    } catch {
      return []
    }
  }

  async setCheckedItems(isoWeek: string, ingredientIds: number[]): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO app_setting (key, value_json, updated_at)
         VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
         ON CONFLICT(key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at`,
      )
      .bind(`shopping.checked.${isoWeek}`, JSON.stringify([...new Set(ingredientIds)].sort((a, b) => a - b)))
      .run()
  }
}
