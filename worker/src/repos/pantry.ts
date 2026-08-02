/**
 * Frigo et cellier.
 *
 * Un ingredient peut avoir PLUSIEURS lots, chacun avec sa peremption : deux
 * briques de lait ouvertes a une semaine d'ecart ne sont pas interchangeables.
 * Les totaux par ingredient (pour la liste de courses) agregent donc les lots.
 */

import type { PantryStock } from '@livre/shared'

import { toPantryStock, type PantryStockRow } from '../rows.js'
import { NOW_SQL } from './sql.js'

const STOCK_COLUMNS = 'id, ingredient_id, quantity_g, expiry_date, notes, added_at, updated_at'

export class PantryRepo {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<PantryStock[]> {
    const { results } = await this.db
      .prepare(
        // NULL en dernier : un stock sans date de peremption n'est pas urgent.
        `SELECT ${STOCK_COLUMNS} FROM pantry_stock ORDER BY (expiry_date IS NULL), expiry_date, id`,
      )
      .all<PantryStockRow>()
    return results.map(toPantryStock)
  }

  async get(id: number): Promise<PantryStock | null> {
    const row = await this.db
      .prepare(`SELECT ${STOCK_COLUMNS} FROM pantry_stock WHERE id = ?`)
      .bind(id)
      .first<PantryStockRow>()
    return row ? toPantryStock(row) : null
  }

  /** Totaux par ingredient, tous lots confondus. Alimente le pre-cochage « deja au frigo ». */
  async totalsByIngredient(): Promise<Map<number, number>> {
    const { results } = await this.db
      .prepare('SELECT ingredient_id, SUM(quantity_g) AS total FROM pantry_stock GROUP BY ingredient_id')
      .all<{ ingredient_id: number; total: number }>()
    return new Map(results.map((r) => [r.ingredient_id, r.total]))
  }

  async add(stock: {
    ingredientId: number
    quantityG: number
    expiryDate: string | null
    notes: string | null
  }): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO pantry_stock (ingredient_id, quantity_g, expiry_date, notes)
         VALUES (?, ?, ?, ?) RETURNING id`,
      )
      .bind(stock.ingredientId, stock.quantityG, stock.expiryDate, stock.notes)
      .first<{ id: number }>()
    if (!row) throw new Error("INSERT pantry_stock n'a rien renvoye")
    return row.id
  }

  async update(
    id: number,
    stock: { quantityG: number; expiryDate: string | null; notes: string | null },
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE pantry_stock SET quantity_g = ?, expiry_date = ?, notes = ?, updated_at = ${NOW_SQL} WHERE id = ?`,
      )
      .bind(stock.quantityG, stock.expiryDate, stock.notes, id)
      .run()
    return (result.meta.changes ?? 0) > 0
  }

  /**
   * Consomme une quantite sur un lot.
   *
   * Le lot est supprime si la consommation le vide ou le depasse : la table a
   * un CHECK (quantity_g > 0), donc un UPDATE a zero echouerait. Rend la
   * quantite restante, ou `null` si le lot a disparu.
   */
  async consume(id: number, amountG: number): Promise<{ removed: boolean; remainingG: number | null }> {
    const current = await this.get(id)
    if (!current) return { removed: false, remainingG: null }

    const remaining = current.quantityG - amountG
    if (remaining <= 0) {
      await this.delete(id)
      return { removed: true, remainingG: null }
    }

    await this.db
      .prepare(`UPDATE pantry_stock SET quantity_g = ?, updated_at = ${NOW_SQL} WHERE id = ?`)
      .bind(remaining, id)
      .run()
    return { removed: false, remainingG: remaining }
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.prepare('DELETE FROM pantry_stock WHERE id = ?').bind(id).run()
    return (result.meta.changes ?? 0) > 0
  }
}
