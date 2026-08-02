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
  constructor(
    private readonly db: D1Database,
    private readonly householdId: number,
  ) {}

  async list(): Promise<PantryStock[]> {
    const { results } = await this.db
      .prepare(
        // NULL en dernier : un stock sans date de peremption n'est pas urgent.
        `SELECT ${STOCK_COLUMNS} FROM pantry_stock
          WHERE household_id = ? ORDER BY (expiry_date IS NULL), expiry_date, id`,
      )
      .bind(this.householdId)
      .all<PantryStockRow>()
    return results.map(toPantryStock)
  }

  async get(id: number): Promise<PantryStock | null> {
    const row = await this.db
      .prepare(`SELECT ${STOCK_COLUMNS} FROM pantry_stock WHERE id = ? AND household_id = ?`)
      .bind(id, this.householdId)
      .first<PantryStockRow>()
    return row ? toPantryStock(row) : null
  }

  /**
   * Totaux par ingredient, tous lots confondus. Alimente le pre-cochage
   * « deja au frigo ».
   *
   * L'agregat porte sur toute la table : sans borne, la liste de courses
   * retrancherait le frigo du voisin de ce qu'il reste a acheter.
   */
  async totalsByIngredient(): Promise<Map<number, number>> {
    const { results } = await this.db
      .prepare(
        `SELECT ingredient_id, SUM(quantity_g) AS total FROM pantry_stock
          WHERE household_id = ? GROUP BY ingredient_id`,
      )
      .bind(this.householdId)
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
        `INSERT INTO pantry_stock (household_id, ingredient_id, quantity_g, expiry_date, notes)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(this.householdId, stock.ingredientId, stock.quantityG, stock.expiryDate, stock.notes)
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
        `UPDATE pantry_stock SET quantity_g = ?, expiry_date = ?, notes = ?, updated_at = ${NOW_SQL}
          WHERE id = ? AND household_id = ?`,
      )
      .bind(stock.quantityG, stock.expiryDate, stock.notes, id, this.householdId)
      .run()
    return (result.meta.changes ?? 0) > 0
  }

  /**
   * Consomme une quantite sur un lot.
   *
   * Le lot est supprime si la consommation le vide ou le depasse : la table a
   * un CHECK (quantity_g > 0), donc un UPDATE a zero echouerait. Rend la
   * quantite restante, ou `null` si le lot a disparu.
   *
   * Le `get` prealable est cloisonne : un lot etranger sort ici, avant toute
   * ecriture. Le filtre est repete sur l'UPDATE malgre tout — D1 n'a pas de
   * transaction interactive, donc rien ne garantit que la lecture et
   * l'ecriture voient la meme ligne.
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
      .prepare(
        `UPDATE pantry_stock SET quantity_g = ?, updated_at = ${NOW_SQL}
          WHERE id = ? AND household_id = ?`,
      )
      .bind(remaining, id, this.householdId)
      .run()
    return { removed: false, remainingG: remaining }
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db
      .prepare('DELETE FROM pantry_stock WHERE id = ? AND household_id = ?')
      .bind(id, this.householdId)
      .run()
    return (result.meta.changes ?? 0) > 0
  }
}
