/**
 * Normalisation de texte pour la recherche.
 *
 * Cote Python, la comparaison de noms passait par `str.casefold()` et un
 * chargement complet de la source en memoire (voir `IngredientRepo.find_by_name`,
 * ~3 000 lignes pour comparer deux chaines). Ici la forme normalisee est
 * persistee dans `ingredient.name_normalized` et indexee.
 */

/**
 * Plie une chaine pour la comparaison et la recherche :
 * minuscules, sans diacritiques, ligatures decomposees, espaces collapses.
 *
 * Le pliage des ligatures est ce que FTS5 ne sait PAS faire : son tokenizer
 * `unicode61 remove_diacritics 2` retire les accents mais laisse « Œuf »
 * intact, si bien que « oeuf » ne le trouve pas. C'est precisement le trou
 * que cette fonction bouche (verifie par scripts/check-fts5.mjs).
 *
 * L'ordre compte : NFD puis retrait des diacritiques AVANT le passage en
 * minuscules, sinon les caracteres precomposes survivent.
 */
export function normalizeName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Transforme une saisie utilisateur en requete FTS5 sure.
 *
 * Corrige un bug du desktop (annexe #3 de la spec) : un guillemet double dans
 * le champ de recherche cassait la syntaxe FTS5 et remontait une erreur SQL
 * non rattrapee — declenchable en tapant simplement `to"mate`.
 *
 * Chaque token est mis entre guillemets et suffixe de `*` pour la recherche
 * par prefixe ; les guillemets internes sont doubles, comme l'exige FTS5.
 * Les tokens sont joints par un ET implicite, comme cote Python.
 *
 * Retourne `null` quand il ne reste rien a chercher : l'appelant doit alors
 * lister sans filtre plutot que d'executer un MATCH vide (qui leverait).
 */
export function toFtsQuery(raw: string | null | undefined): string | null {
  const tokens = (raw ?? '')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    // Les caracteres de syntaxe FTS5 isoles (`*`, `-`, `^`, `:`) ne sont pas
    // des mots : les garder produirait une requete vide entre guillemets.
    .map((t) => t.replace(/["*^:]/g, (c) => (c === '"' ? '""' : '')))
    .filter((t) => t.length > 0)

  if (tokens.length === 0) return null
  return tokens.map((t) => `"${t}"*`).join(' ')
}

/** Echappe les jokers d'un LIKE SQL, pour le repli sur `name_normalized`. */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (c) => `\\${c}`)
}
