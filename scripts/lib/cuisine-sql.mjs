/**
 * Le SQL qui cree une cuisine, ECRIT UNE SEULE FOIS.
 *
 * Deux appelants le produisent : `scripts/add-user.mjs` (ligne de commande) et
 * `scripts/admin/serveur.mjs` (console d'administration). Les laisser porter
 * chacun leur copie garantissait qu'une correction n'atteigne qu'un des deux —
 * et la regle « une cuisine par compte » ne vaut que si les deux chemins la
 * respectent a l'identique.
 */

/** Litteral SQL : les apostrophes se doublent. `spawn` n'ouvre aucun shell. */
export const sqlString = (v) => `'${String(v).replace(/'/g, "''")}'`

/**
 * Une nouvelle cuisine part avec une copie du catalogue CIQUAL, et de LUI SEUL.
 *
 * Sans catalogue, le nouveau venu ouvre une application vide : plus aucun
 * aliment a chercher, et « Importer » ne servirait a rien. CIQUAL est la table
 * de composition de l'ANSES — une reference publique, identique pour tout le
 * monde : la copier ne raconte rien de personne.
 *
 * Les lignes OpenFoodFacts sont EXCLUES, et c'est le point important. Elles
 * n'ont rien d'une reference : ce sont les produits que le foyer d'origine a
 * scannes en magasin. Les recopier ferait apparaitre chez le nouveau venu la
 * marque de creme, le fromage et la moutarde exacts qu'achete quelqu'un
 * d'autre. Aucune recette ni aucun prix ne fuiterait, mais ses courses, si.
 *
 * Il constituera les siennes en scannant. C'est deja le chemin le plus rapide.
 *
 * Le sous-SELECT `MIN(id)` par source_ref evite de dupliquer une fiche presente
 * en plusieurs exemplaires, ce qui violerait l'unicite
 * (household_id, source, source_ref).
 */
export function sqlCreationCuisine(nom) {
  return (
    `INSERT INTO household (name) VALUES (${sqlString(nom)});\n` +
    `INSERT INTO ingredient (household_id, name, name_normalized, source, source_ref, brand,\n` +
    `  kcal_per_100g, proteins_g, carbs_g, sugars_g, fats_g, saturated_fats_g, fiber_g, salt_g,\n` +
    `  piece_weight_g, cooked_weight_per_100g_raw, in_personal_library, category_l1, category_l2,\n` +
    `  season_months)\n` +
    `SELECT (SELECT MAX(id) FROM household), name, name_normalized, source, source_ref, brand,\n` +
    `  kcal_per_100g, proteins_g, carbs_g, sugars_g, fats_g, saturated_fats_g, fiber_g, salt_g,\n` +
    `  piece_weight_g, cooked_weight_per_100g_raw, 0, category_l1, category_l2, season_months\n` +
    `FROM ingredient WHERE source = 'ciqual'\n` +
    `  AND id IN (SELECT MIN(id) FROM ingredient WHERE source = 'ciqual' GROUP BY source_ref);\n`
  )
}

/** L'identifiant d'une cuisine tout juste inseree par le SQL ci-dessus. */
export const CUISINE_CREEE = '(SELECT MAX(id) FROM household)'
