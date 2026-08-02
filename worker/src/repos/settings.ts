/**
 * Reglages et etats volatils, stockes en JSON dans `app_setting`.
 *
 * Cette table generalise l'ancienne table singleton du desktop. Elle accueille
 * ce qui n'a pas de schema propre : cases cochees de la liste de courses,
 * instantanes de cout hebdomadaire, preferences.
 *
 * AUCUN secret ici — les jetons vont dans les secrets Cloudflare.
 *
 * ---------------------------------------------------------------------------
 * DEUX NATURES DANS UNE SEULE TABLE
 * ---------------------------------------------------------------------------
 * `app_setting` a pour cle primaire (household_id, key), et le foyer 0 designe
 * le GLOBAL : il n'existe pas dans `household`, et c'est ce qui le distingue.
 * S'y rangent les cles `auth.*` — secret de signature des sessions, compteur
 * d'echecs de connexion — qui appartiennent au serveur et non a une cuisine.
 * Un secret de session par foyer n'aurait aucun sens : c'est lui qui permet de
 * savoir DE QUEL foyer releve la requete.
 *
 * D'ou les deux acces. Le scopé est le defaut, et il est le seul utilise par
 * les routes. Le global est nomme explicitement (`...Global...`) : on ne peut
 * pas y tomber par inadvertance en tapant un nom de cle.
 */

import { NOW_SQL } from './sql.js'

/**
 * Foyer conventionnel des reglages du serveur.
 *
 * Volontairement 0, comme `NO_HOUSEHOLD` : une requete sans session ne peut
 * de toute facon pas atteindre ce fichier, mais si elle y parvenait, elle
 * lirait des reglages globaux — jamais les donnees d'une cuisine.
 */
const GLOBAL_HOUSEHOLD = 0

export class SettingsRepo {
  constructor(
    private readonly db: D1Database,
    private readonly householdId: number,
  ) {}

  // ------------------------------------------------------------ acces scopé

  async getJson<T>(key: string, fallback: T): Promise<T> {
    return this.readJson(this.householdId, key, fallback)
  }

  async setJson(key: string, value: unknown): Promise<void> {
    await this.writeJson(this.householdId, key, value)
  }

  // ----------------------------------------------------------- acces global

  /**
   * Lit un reglage du serveur (foyer 0).
   *
   * Reserve aux cles `auth.*`. Aucune route ne doit l'appeler : ce qu'un
   * utilisateur peut lire ou ecrire passe par `getJson` / `setJson`.
   */
  async getGlobalJson<T>(key: string, fallback: T): Promise<T> {
    return this.readJson(GLOBAL_HOUSEHOLD, key, fallback)
  }

  async setGlobalJson(key: string, value: unknown): Promise<void> {
    await this.writeJson(GLOBAL_HOUSEHOLD, key, value)
  }

  // ---------------------------------------------------------------- interne

  private async readJson<T>(householdId: number, key: string, fallback: T): Promise<T> {
    const row = await this.db
      .prepare('SELECT value_json FROM app_setting WHERE household_id = ? AND key = ?')
      .bind(householdId, key)
      .first<{ value_json: string }>()
    if (!row) return fallback
    try {
      return JSON.parse(row.value_json) as T
    } catch {
      // Une valeur corrompue ne doit pas casser l'ecran qui la lit.
      return fallback
    }
  }

  private async writeJson(householdId: number, key: string, value: unknown): Promise<void> {
    await this.db
      .prepare(
        // La cible du ON CONFLICT est la cle primaire entiere, devenue
        // (household_id, key) en 0005. Laisser `(key)` seul ferait echouer la
        // requete : SQLite exige que la cible corresponde a une contrainte
        // d'unicite existante, et il n'y en a plus sur `key` seule.
        `INSERT INTO app_setting (household_id, key, value_json, updated_at) VALUES (?, ?, ?, ${NOW_SQL})
         ON CONFLICT(household_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .bind(householdId, key, JSON.stringify(value))
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
        // `iso_week` etait la cle primaire a elle seule : deux foyers n'auraient
        // pas pu archiver la meme semaine, et le second aurait ECRASE le
        // montant du premier via ce ON CONFLICT. La cle est desormais
        // (household_id, iso_week), et la cible du conflit doit la suivre.
        `INSERT INTO weekly_cost_snapshot (household_id, iso_week, total_eur, missing_count, captured_at)
         VALUES (?, ?, ?, ?, ${NOW_SQL})
         ON CONFLICT(household_id, iso_week) DO UPDATE SET
           total_eur = excluded.total_eur,
           missing_count = excluded.missing_count,
           captured_at = excluded.captured_at
         RETURNING iso_week, total_eur, missing_count, captured_at`,
      )
      .bind(this.householdId, isoWeek, totalEur, missingCount)
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
         FROM weekly_cost_snapshot WHERE household_id = ? ORDER BY iso_week DESC LIMIT ?`,
      )
      .bind(this.householdId, limit)
      .all<{ iso_week: string; total_eur: string; missing_count: number; captured_at: string }>()

    return results.map((r) => ({
      isoWeek: r.iso_week,
      totalEur: r.total_eur,
      missingCount: r.missing_count,
      capturedAt: r.captured_at,
    }))
  }
}
