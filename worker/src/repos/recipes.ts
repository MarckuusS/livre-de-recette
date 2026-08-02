/**
 * Recettes : en-tete, lignes d'ingredients, tags, journal de cuisson.
 *
 * Une recette est sauvegardee d'un bloc. Les lignes et les tags sont
 * REMPLACES integralement, jamais reconcilies ligne a ligne : le formulaire
 * envoie l'etat complet qu'il affiche, et un diff cote serveur reintroduirait
 * les conflits d'ordre que le desktop reglait deja par un remplacement total.
 */

import type { Recipe, RecipeWrite } from '@livre/shared'

import { toRecipeShell, toTag, type RecipeRow, type TagRow } from '../rows.js'
import { IngredientRepo } from './ingredients.js'
import { NOW_SQL, placeholders } from './sql.js'

// La charge utile d'ecriture est definie dans `shared/src/models.ts`, aux
// cotes du schema Zod qui la valide : un seul endroit ou la faire evoluer.
export type { RecipeLineWrite, RecipeWrite } from '@livre/shared'

export interface RecipeSummary {
  readonly id: number
  readonly name: string
  readonly defaultPortions: number
  readonly imageKey: string | null
  readonly lineCount: number
  readonly prepTimeMin: number | null
  readonly tags: ReadonlyArray<{ id: number; name: string; colorHex: string }>
  readonly lastCookedAt: string | null
  readonly cookCount30d: number
}

export class RecipeRepo {
  constructor(
    private readonly db: D1Database,
    private readonly ingredients: IngredientRepo,
  ) {}

  // ------------------------------------------------------------------ lecture

  /**
   * Recettes completes, lignes et tags compris, en 4 requetes quel que soit
   * le nombre de recettes demandees.
   */
  async byIds(ids: Iterable<number>): Promise<Map<number, Recipe>> {
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
    const ingredients = await this.ingredients.byIds(lineRows.results.map((l) => l.ingredient_id))

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

  async get(id: number): Promise<Recipe | null> {
    return (await this.byIds([id])).get(id) ?? null
  }

  /**
   * Liste pour l'ecran principal.
   *
   * `cook_count_30d` est calcule en SQL sur une fenetre glissante de 30 jours
   * — la meme que le desktop. Le faire cote client obligerait a rapatrier tout
   * le journal de cuisson pour n'en afficher qu'un compteur.
   */
  async listSummaries(options: { query?: string | null; tagId?: number | null } = {}): Promise<RecipeSummary[]> {
    const { query = null, tagId = null } = options

    const where: string[] = []
    const args: unknown[] = []

    if (query && query.trim()) {
      where.push('LOWER(r.name) LIKE ?')
      args.push(`%${query.trim().toLowerCase()}%`)
    }
    if (tagId !== null) {
      where.push('EXISTS (SELECT 1 FROM recipe_tag rt WHERE rt.recipe_id = r.id AND rt.tag_id = ?)')
      args.push(tagId)
    }

    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''

    const [rows, tagRows] = await Promise.all([
      this.db
        .prepare(
          `SELECT r.id, r.name, r.default_portions, r.image_key, r.prep_time_min,
                  (SELECT COUNT(*) FROM recipe_ingredient ri WHERE ri.recipe_id = r.id) AS line_count,
                  (SELECT MAX(cooked_at) FROM recipe_cooking_log cl WHERE cl.recipe_id = r.id) AS last_cooked_at,
                  (SELECT COUNT(*) FROM recipe_cooking_log cl
                    WHERE cl.recipe_id = r.id AND cl.cooked_at >= date('now','-30 day')) AS cook_count_30d
           FROM recipe r ${clause} ORDER BY r.name`,
        )
        .bind(...args)
        .all<{
          id: number
          name: string
          default_portions: number
          image_key: string | null
          prep_time_min: number | null
          line_count: number
          last_cooked_at: string | null
          cook_count_30d: number
        }>(),
      this.db
        .prepare(
          `SELECT rt.recipe_id, t.id, t.name, t.color_hex
           FROM recipe_tag rt JOIN tag t ON t.id = rt.tag_id ORDER BY t.name`,
        )
        .all<{ recipe_id: number; id: number; name: string; color_hex: string }>(),
    ])

    const tagsByRecipe = new Map<number, Array<{ id: number; name: string; colorHex: string }>>()
    for (const t of tagRows.results) {
      const list = tagsByRecipe.get(t.recipe_id) ?? []
      list.push({ id: t.id, name: t.name, colorHex: t.color_hex })
      tagsByRecipe.set(t.recipe_id, list)
    }

    return rows.results.map((r) => ({
      id: r.id,
      name: r.name,
      defaultPortions: r.default_portions,
      imageKey: r.image_key,
      lineCount: r.line_count,
      prepTimeMin: r.prep_time_min,
      tags: tagsByRecipe.get(r.id) ?? [],
      lastCookedAt: r.last_cooked_at,
      cookCount30d: r.cook_count_30d,
    }))
  }

  // ------------------------------------------------------------------ ecriture

  async create(payload: RecipeWrite): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO recipe (name, instructions, default_portions, image_key, source_url, prep_time_min)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(
        payload.name,
        payload.instructions,
        payload.defaultPortions,
        payload.imageKey,
        payload.sourceUrl,
        payload.prepTimeMin,
      )
      .first<{ id: number }>()

    if (!row) throw new Error("INSERT recipe n'a rien renvoye")
    await this.replaceChildren(row.id, payload)
    return row.id
  }

  async update(id: number, payload: RecipeWrite): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE recipe
            SET name = ?, instructions = ?, default_portions = ?, image_key = ?,
                source_url = ?, prep_time_min = ?, updated_at = ${NOW_SQL}
          WHERE id = ?`,
      )
      .bind(
        payload.name,
        payload.instructions,
        payload.defaultPortions,
        payload.imageKey,
        payload.sourceUrl,
        payload.prepTimeMin,
        id,
      )
      .run()

    if ((result.meta.changes ?? 0) === 0) return false
    await this.replaceChildren(id, payload)
    return true
  }

  /**
   * Remplace lignes et tags en un seul `batch` atomique.
   *
   * Le DELETE precede les INSERT dans le meme lot : D1 execute les requetes
   * d'un batch dans l'ordre et annule tout en cas d'echec, donc une recette ne
   * peut pas se retrouver amputee de ses lignes si un ingredient a disparu
   * entre-temps.
   */
  private async replaceChildren(recipeId: number, payload: RecipeWrite): Promise<void> {
    const statements: D1PreparedStatement[] = [
      this.db.prepare('DELETE FROM recipe_ingredient WHERE recipe_id = ?').bind(recipeId),
      this.db.prepare('DELETE FROM recipe_tag WHERE recipe_id = ?').bind(recipeId),
    ]

    // L'ordinal est reattribue depuis la position dans le tableau : c'est
    // l'ordre affiche qui fait foi, pas celui que le client a calcule.
    payload.lines.forEach((line, index) => {
      statements.push(
        this.db
          .prepare(
            `INSERT INTO recipe_ingredient (recipe_id, ingredient_id, ordinal, quantity_g, notes, unit)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(recipeId, line.ingredientId, index, line.quantityG, line.notes, line.unit),
      )
    })

    for (const tagId of new Set(payload.tagIds)) {
      statements.push(
        this.db.prepare('INSERT INTO recipe_tag (recipe_id, tag_id) VALUES (?, ?)').bind(recipeId, tagId),
      )
    }

    await this.db.batch(statements)
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM recipe WHERE id = ?').bind(id).run()
    return (result.meta.changes ?? 0) > 0
  }

  /** Combien d'entrees du calendrier disparaitraient avec la recette (ON DELETE CASCADE). */
  async plannedCount(id: number): Promise<number> {
    const row = await this.db
      .prepare('SELECT COUNT(*) AS c FROM meal_plan_entry WHERE recipe_id = ?')
      .bind(id)
      .first<{ c: number }>()
    return row?.c ?? 0
  }

  // -------------------------------------------------------- journal de cuisson

  async listCookingLog(recipeId: number): Promise<
    Array<{ id: number; recipeId: number; cookedAt: string; rating: number | null; notes: string | null; createdAt: string }>
  > {
    const { results } = await this.db
      .prepare(
        `SELECT id, recipe_id, cooked_at, rating, notes, created_at
         FROM recipe_cooking_log WHERE recipe_id = ? ORDER BY cooked_at DESC, id DESC`,
      )
      .bind(recipeId)
      .all<{ id: number; recipe_id: number; cooked_at: string; rating: number | null; notes: string | null; created_at: string }>()

    return results.map((r) => ({
      id: r.id,
      recipeId: r.recipe_id,
      cookedAt: r.cooked_at,
      rating: r.rating,
      notes: r.notes,
      createdAt: r.created_at,
    }))
  }

  async addCookingLog(entry: {
    recipeId: number
    cookedAt: string
    rating: number | null
    notes: string | null
  }): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO recipe_cooking_log (recipe_id, cooked_at, rating, notes)
         VALUES (?, ?, ?, ?) RETURNING id`,
      )
      .bind(entry.recipeId, entry.cookedAt, entry.rating, entry.notes)
      .first<{ id: number }>()
    if (!row) throw new Error("INSERT recipe_cooking_log n'a rien renvoye")
    return row.id
  }

  async deleteCookingLog(id: number): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM recipe_cooking_log WHERE id = ?').bind(id).run()
    return (result.meta.changes ?? 0) > 0
  }

  // ------------------------------------------------------------------- tags

  async listTags(): Promise<Array<{ id: number; name: string; colorHex: string; recipeCount: number }>> {
    const { results } = await this.db
      .prepare(
        `SELECT t.id, t.name, t.color_hex,
                (SELECT COUNT(*) FROM recipe_tag rt WHERE rt.tag_id = t.id) AS recipe_count
         FROM tag t ORDER BY t.name`,
      )
      .all<{ id: number; name: string; color_hex: string; recipe_count: number }>()

    return results.map((t) => ({ id: t.id, name: t.name, colorHex: t.color_hex, recipeCount: t.recipe_count }))
  }

  async createTag(name: string, colorHex: string): Promise<number> {
    const row = await this.db
      .prepare('INSERT INTO tag (name, color_hex) VALUES (?, ?) RETURNING id')
      .bind(name, colorHex)
      .first<{ id: number }>()
    if (!row) throw new Error("INSERT tag n'a rien renvoye")
    return row.id
  }

  async updateTag(id: number, name: string, colorHex: string): Promise<boolean> {
    const result = await this.db
      .prepare('UPDATE tag SET name = ?, color_hex = ? WHERE id = ?')
      .bind(name, colorHex, id)
      .run()
    return (result.meta.changes ?? 0) > 0
  }

  async deleteTag(id: number): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM tag WHERE id = ?').bind(id).run()
    return (result.meta.changes ?? 0) > 0
  }
}
