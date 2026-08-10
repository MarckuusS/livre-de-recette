/**
 * Registre unique des icones.
 *
 * Une seule table, fusionnee au chargement du module. Le decoupage en fichiers
 * par famille sert la relecture, pas le bundle : tout est joignable par nom
 * depuis le resolveur, donc rien n'est elaguable et il n'y a aucun interet a
 * eclater le chargement.
 *
 * Chaque valeur est le CONTENU d'un `<svg viewBox="0 0 24 24">` — jamais la
 * balise elle-meme. Les attributs communs (fill, stroke, epaisseur, jonctions)
 * sont poses une fois par `<Icon>`, ce qui garantit qu'aucune icone ne peut
 * deriver du systeme en redefinissant les siens.
 */

import { BOISSON_PATHS } from './paths/boissons.js'
import { DIVERS_PATHS } from './paths/divers.js'
import { EPICERIE_PATHS } from './paths/epicerie.js'
import { FECULENT_PATHS } from './paths/feculents.js'
import { FRUIT_PATHS } from './paths/fruits.js'
import { HERBE_PATHS } from './paths/herbes.js'
import { LAITIER_PATHS } from './paths/laitiers.js'
import { LEGUME_PATHS } from './paths/legumes.js'
import { PROTEINE_PATHS } from './paths/proteines.js'
import { RAYON_PATHS } from './paths/rayons.js'
import { UI_PATHS } from './paths/ui.js'

export const ICON_PATHS = {
  ...UI_PATHS,
  ...RAYON_PATHS,
  ...LEGUME_PATHS,
  ...FRUIT_PATHS,
  ...HERBE_PATHS,
  ...FECULENT_PATHS,
  ...PROTEINE_PATHS,
  ...LAITIER_PATHS,
  ...EPICERIE_PATHS,
  ...BOISSON_PATHS,
  ...DIVERS_PATHS,
} as const

export type IconName = keyof typeof ICON_PATHS

/** Familles, pour la galerie de `/parametres/icones`. L'ordre est celui du rendu. */
export const ICON_FAMILIES: ReadonlyArray<{ readonly title: string; readonly names: IconName[] }> = [
  { title: 'Interface', names: Object.keys(UI_PATHS) as IconName[] },
  { title: 'Rayons', names: Object.keys(RAYON_PATHS) as IconName[] },
  { title: 'Légumes', names: Object.keys(LEGUME_PATHS) as IconName[] },
  { title: 'Fruits', names: Object.keys(FRUIT_PATHS) as IconName[] },
  { title: 'Herbes & épices', names: Object.keys(HERBE_PATHS) as IconName[] },
  { title: 'Féculents & légumineuses', names: Object.keys(FECULENT_PATHS) as IconName[] },
  { title: 'Viandes, poissons & œufs', names: Object.keys(PROTEINE_PATHS) as IconName[] },
  { title: 'Produits laitiers', names: Object.keys(LAITIER_PATHS) as IconName[] },
  { title: 'Épicerie', names: Object.keys(EPICERIE_PATHS) as IconName[] },
  { title: 'Boissons', names: Object.keys(BOISSON_PATHS) as IconName[] },
  { title: 'Surgelés & plats', names: Object.keys(DIVERS_PATHS) as IconName[] },
]

export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[]

/** Vrai si la chaine designe une icone connue. Sert aux donnees non typees. */
export const isIconName = (value: string): value is IconName => value in ICON_PATHS
