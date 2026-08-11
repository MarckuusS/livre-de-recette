/**
 * Du libelle de rayon a son icone.
 *
 * Les rayons sont saisis LIBREMENT par l'utilisateur : « Fruits et légumes »
 * chez l'un, « Primeur » chez l'autre, avec ou sans accents, au singulier ou au
 * pluriel. Une egalite stricte ne tiendrait pas une semaine. La correspondance
 * se fait donc sur un libelle normalise, par fragment reconnu.
 *
 * Un ingredient n'a pas d'icone propre : il prend celle de son rayon. C'est un
 * choix, pas une limite. Dessiner par aliment obligerait a maintenir un dessin
 * de plus a chaque produit scanne, et a faire deviner par une table de
 * mots-cles ce qu'un nom commercial contient — exercice qui echoue en silence
 * et rend un dessin faux, ce qui est pire qu'un dessin generique.
 */

import type { IconName } from './registry.js'

/** Bloc « Combining Diacritical Marks » : ce que NFD detache des lettres accentuees. */
const DIACRITICS = /[̀-ͯ]/g

/**
 * Minuscules, sans accents, sans ponctuation.
 *
 * `œ` ne se decompose PAS en NFD : sans la substitution explicite, un rayon
 * nomme « Œufs » deviendrait « ufs » et ne correspondrait plus a rien.
 */
export function normalizeLabel(text: string): string {
  return text
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Fragments reconnus, dans l'ordre de priorite.
 *
 * L'ORDRE EST SIGNIFICATIF, contrairement au reste du projet : c'est la
 * premiere ligne qui accroche qui gagne. Deux paires en dependent et se
 * casseraient a la moindre reorganisation alphabetique :
 *
 *   - « surgelés » avant « légumes », sinon un rayon « Légumes surgelés »
 *     partirait au frais plutot qu'au froid ;
 *   - « fruits de mer » avant « fruits », meme raison.
 */
const RAYON_RULES: ReadonlyArray<readonly [readonly string[], IconName]> = [
  [['surgel', 'congel'], 'rayon-surgeles'],
  [['boulanger', 'patisser', 'viennoiser'], 'rayon-boulangerie'],
  [['boucher', 'volaille', 'charcut', 'viande'], 'rayon-boucherie'],
  [['poissonner', 'maree', 'poisson', 'fruits de mer'], 'rayon-poissonnerie'],
  // « Frais » tout court est un rayon reel de la bibliotheque. En grande
  // surface il designe le refrigere — yaourts, cremes, traiteur — d'ou la
  // brique. Il vient APRES boucherie et poissonnerie, sinon « poissonnerie
  // fraiche » tomberait ici.
  [['laitier', 'cremerie', 'fromage', 'oeuf', 'frais'], 'rayon-produits-laitiers'],
  [['boisson', 'cave', 'liquide'], 'rayon-boissons'],
  [['snack', 'confiserie', 'sucrerie', 'apero', 'biscuit'], 'rayon-snacks-confiseries'],
  [['fruit', 'legume', 'primeur', 'marche'], 'rayon-fruits-legumes'],
  [['epicerie', 'conserve', 'condiment', 'assaisonn'], 'rayon-epicerie'],
]

/** Icone du rayon. Un libelle vide ou inconnu retombe sur la cagette. */
export function iconForRayon(label: string | null | undefined): IconName {
  if (label === null || label === undefined || label.trim() === '') return 'rayon-autre'
  const normalized = normalizeLabel(label)
  for (const [fragments, icon] of RAYON_RULES) {
    if (fragments.some((fragment) => normalized.includes(fragment))) return icon
  }
  return 'rayon-autre'
}

/**
 * Identifiant stable du rayon, pour le teinter en CSS
 * (`[data-rayon='fruits-legumes']`). Derive de l'icone, donc deux libelles
 * synonymes (« Primeur », « Fruits et légumes ») partagent la meme teinte.
 */
export const rayonSlug = (label: string | null | undefined): string =>
  iconForRayon(label).replace('rayon-', '')
