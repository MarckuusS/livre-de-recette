/**
 * Constantes d'espaces invisibles, pour les tests.
 *
 * Les fonctions de formatage produisent des espaces qu'on ne distingue pas a
 * l'oeil d'une espace ordinaire, mais que `===` distingue tres bien. Ecrire
 * l'attendu a la main donne un test qui echoue sans qu'on voie pourquoi.
 * Les importer d'ici rend l'intention explicite.
 */

/** U+00A0 — avant une unite ou un symbole monetaire : « 250 g », « 12,50 € ». */
export const NBSP = ' '

/** U+202F — separateur de milliers choisi par Intl en fr-FR : « 1 234 ». */
export const NNBSP = ' '
