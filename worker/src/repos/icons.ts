/**
 * Icones personnelles.
 *
 * `markup` est stocke tel que la route l'a assaini. Ce depot ne verifie rien :
 * la garantie est en amont, dans `routes/icons.ts`, seul chemin d'ecriture.
 * Le rappeler ici plutot que de laisser croire a une double barriere qui
 * n'existe pas.
 */

import type { D1Database } from '@cloudflare/workers-types'

export interface CustomIconRow {
  readonly id: number
  readonly name: string
  readonly markup: string
  readonly viewBox: string
  readonly keepColors: boolean
}

export class IconRepo {
  constructor(
    private readonly db: D1Database,
    private readonly householdId: number,
  ) {}

  async list(): Promise<CustomIconRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, name, markup, view_box, keep_colors
           FROM custom_icon WHERE household_id = ? ORDER BY name`,
      )
      .bind(this.householdId)
      .all<{ id: number; name: string; markup: string; view_box: string; keep_colors: number }>()

    return results.map((r) => ({
      id: r.id,
      name: r.name,
      markup: r.markup,
      viewBox: r.view_box,
      keepColors: r.keep_colors === 1,
    }))
  }

  async findByName(name: string): Promise<{ id: number } | null> {
    return await this.db
      .prepare('SELECT id FROM custom_icon WHERE household_id = ? AND name = ?')
      .bind(this.householdId, name)
      .first<{ id: number }>()
  }

  async nameOf(id: number): Promise<string | null> {
    const row = await this.db
      .prepare('SELECT name FROM custom_icon WHERE id = ? AND household_id = ?')
      .bind(id, this.householdId)
      .first<{ name: string }>()
    return row?.name ?? null
  }

  async create(name: string, markup: string, viewBox: string, keepColors: boolean): Promise<number> {
    const row = await this.db
      .prepare(
        `INSERT INTO custom_icon (household_id, name, markup, view_box, keep_colors)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(this.householdId, name, markup, viewBox, keepColors ? 1 : 0)
      .first<{ id: number }>()
    if (!row) throw new Error("INSERT custom_icon n'a rien renvoye")
    return row.id
  }

  async remove(id: number): Promise<void> {
    await this.db
      .prepare('DELETE FROM custom_icon WHERE id = ? AND household_id = ?')
      .bind(id, this.householdId)
      .run()
  }
}
