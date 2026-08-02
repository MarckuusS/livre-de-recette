/**
 * Reglages et etats volatils, stockes en JSON dans `app_setting`.
 *
 * Cette table generalise l'ancienne table singleton du desktop. Elle accueille
 * ce qui n'a pas de schema propre : cases cochees de la liste de courses,
 * instantanes de cout hebdomadaire, preferences.
 *
 * AUCUN secret ici — les jetons vont dans les secrets Cloudflare.
 */

import { NOW_SQL } from './sql.js'

export class SettingsRepo {
  constructor(private readonly db: D1Database) {}

  async getJson<T>(key: string, fallback: T): Promise<T> {
    const row = await this.db
      .prepare('SELECT value_json FROM app_setting WHERE key = ?')
      .bind(key)
      .first<{ value_json: string }>()
    if (!row) return fallback
    try {
      return JSON.parse(row.value_json) as T
    } catch {
      // Une valeur corrompue ne doit pas casser l'ecran qui la lit.
      return fallback
    }
  }

  async setJson(key: string, value: unknown): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO app_setting (key, value_json, updated_at) VALUES (?, ?, ${NOW_SQL})
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .bind(key, JSON.stringify(value))
      .run()
  }

  // ------------------------------------------------------- liste de courses

  /** Cases cochees d'une semaine, persistees. Volatiles dans le desktop. */
  async getCheckedItems(isoWeek: string): Promise<number[]> {
    const parsed = await this.getJson<unknown>(`shopping.checked.${isoWeek}`, [])
    return Array.isArray(parsed) ? parsed.filter((v): v is number => typeof v === 'number') : []
  }

  async setCheckedItems(isoWeek: string, ingredientIds: number[]): Promise<void> {
    await this.setJson(
      `shopping.checked.${isoWeek}`,
      [...new Set(ingredientIds)].sort((a, b) => a - b),
    )
  }

  // ------------------------------------------------------ cout hebdomadaire

  /**
   * Archive le cout d'une semaine.
   *
   * C'est ce qui permet de comparer les semaines entre elles : recalculer un
   * cout passe donnerait le prix d'AUJOURD'HUI, pas celui paye a l'epoque.
   */
  async saveWeeklyCost(
    isoWeek: string,
    totalEur: string,
    missingCount: number,
  ): Promise<{ isoWeek: string; totalEur: string; missingCount: number; capturedAt: string }> {
    const row = await this.db
      .prepare(
        `INSERT INTO weekly_cost_snapshot (iso_week, total_eur, missing_count, captured_at)
         VALUES (?, ?, ?, ${NOW_SQL})
         ON CONFLICT(iso_week) DO UPDATE SET
           total_eur = excluded.total_eur,
           missing_count = excluded.missing_count,
           captured_at = excluded.captured_at
         RETURNING iso_week, total_eur, missing_count, captured_at`,
      )
      .bind(isoWeek, totalEur, missingCount)
      .first<{ iso_week: string; total_eur: string; missing_count: number; captured_at: string }>()

    if (!row) throw new Error("INSERT weekly_cost_snapshot n'a rien renvoye")
    return {
      isoWeek: row.iso_week,
      totalEur: row.total_eur,
      missingCount: row.missing_count,
      // Rendu par la base et non recalcule ici : c'est l'horodatage
      // reellement ecrit, au format que les schemas imposent.
      capturedAt: row.captured_at,
    }
  }

  async listWeeklyCosts(limit = 26): Promise<
    Array<{ isoWeek: string; totalEur: string; missingCount: number; capturedAt: string }>
  > {
    const { results } = await this.db
      .prepare(
        `SELECT iso_week, total_eur, missing_count, captured_at
         FROM weekly_cost_snapshot ORDER BY iso_week DESC LIMIT ?`,
      )
      .bind(limit)
      .all<{ iso_week: string; total_eur: string; missing_count: number; captured_at: string }>()

    return results.map((r) => ({
      isoWeek: r.iso_week,
      totalEur: r.total_eur,
      missingCount: r.missing_count,
      capturedAt: r.captured_at,
    }))
  }
}
