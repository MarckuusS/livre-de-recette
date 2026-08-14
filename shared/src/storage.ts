/**
 * Ou un produit est range, et pourquoi ce n'est PAS son rayon de magasin.
 *
 * Deux axes distincts, et les confondre est l'erreur qui guette : "Surgeles"
 * est un rayon, pas un lieu ; "Epicerie" contient le paprika et les pates, qui
 * finissent tous deux au placard, mais aussi les petits pois surgeles, qui n'y
 * finissent pas. Le lieu ne se deduit donc jamais de `category_l1`, il se
 * saisit.
 *
 * TROIS ESPACES ET UN QUATRIEME ETAT. `null` n'est pas un espace : il veut dire
 * "pas encore range", ce qui est l'etat exact de tout ce qui arrive des courses.
 * L'application ne sait pas ou vous avez pose le paquet de riz, et elle ne le
 * devinera pas. L'ecran expose cet etat dans un onglet a lui, qui disparait une
 * fois vide, plutot que de choisir a votre place.
 *
 * CHACUN A SA LOGIQUE, et c'est ce qui justifie la separation :
 *   frigo       -> des JOURS, la date limite commande
 *   placard     -> un NIVEAU, le seuil de reappro commande
 *   congelateur -> du TEMPS PASSE depuis l'entree
 * Appliquer un compte a rebours rouge a un paquet de riz serait absurde, et un
 * niveau de stock ne dit rien d'un yaourt entame.
 */

export const STORAGE_SPACES = ['frigo', 'placard', 'congelateur'] as const

export type StorageSpace = (typeof STORAGE_SPACES)[number]

/**
 * Les libelles affiches. "Congelo" et non "Congelateur" : c'est le mot qu'on
 * emploie, et l'onglet doit tenir a cote de deux autres sur 375 px.
 */
export const STORAGE_LABELS: Record<StorageSpace, string> = {
  frigo: 'Frigo',
  placard: 'Placard',
  congelateur: 'Congélo',
}

/** Le libelle du quatrieme etat, qui n'est pas un espace. */
export const UNSTORED_LABEL = 'À ranger'

export function isStorageSpace(value: unknown): value is StorageSpace {
  return typeof value === 'string' && (STORAGE_SPACES as readonly string[]).includes(value)
}

/**
 * Le libelle d'un lieu, `null` compris.
 *
 * Passe par le `Record` plutot que par un `switch` : le typage rend une entree
 * manquante impossible, alors qu'un `switch` sans `default` compile encore.
 */
export function storageLabel(space: StorageSpace | null): string {
  return space === null ? UNSTORED_LABEL : STORAGE_LABELS[space]
}
