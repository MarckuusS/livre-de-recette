/**
 * Briques SQL communes aux repositories.
 *
 * Deux contraintes propres a D1 expliquent la forme de tout ce dossier :
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

/** Genere `?, ?, ?` pour un IN (...). */
export const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(', ')

/**
 * Horodatage courant, en SQL.
 *
 * Toujours cette expression, jamais `new Date().toISOString()` : les
 * millisecondes de JavaScript casseraient le format `AAAA-MM-JJTHH:MM:SSZ`
 * que les schemas Zod imposent, et la base resterait coherente avec les
 * lignes ecrites par les migrations.
 */
export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"

/**
 * Construit la clause `SET` d'un UPDATE partiel.
 *
 * Semantique « cle presente » : une colonne absente de `patch` n'est pas
 * touchee, une colonne presente a `null` est effacee. C'est ce qui permet a un
 * formulaire de n'envoyer que ce que l'utilisateur a modifie, sans ecraser le
 * reste avec des valeurs vides.
 *
 * Rend `null` quand il n'y a rien a mettre a jour — l'appelant doit alors
 * s'abstenir plutot que d'emettre un UPDATE sans SET, qui est une erreur SQL.
 */
export function buildSet(
  patch: Record<string, unknown>,
  columns: Readonly<Record<string, string>>,
): { clause: string; values: unknown[] } | null {
  const parts: string[] = []
  const values: unknown[] = []

  for (const [key, column] of Object.entries(columns)) {
    if (!(key in patch)) continue
    parts.push(`${column} = ?`)
    values.push(patch[key] ?? null)
  }

  if (parts.length === 0) return null
  parts.push(`updated_at = ${NOW_SQL}`)
  return { clause: parts.join(', '), values }
}

/** Booleen vers l'entier attendu par SQLite. */
export const toInt = (value: boolean | undefined): number | undefined =>
  value === undefined ? undefined : value ? 1 : 0
