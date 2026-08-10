/**
 * Rendu d'une icone du registre.
 *
 * `dangerouslySetInnerHTML` porte mal son nom ici : le contenu injecte vient
 * exclusivement de `ICON_PATHS`, une constante du depot, jamais d'une saisie ni
 * d'une reponse d'API. C'est le seul moyen de garder UNE table de chemins
 * plutot que deux cents composants, et la contrainte de type sur `name` rend
 * impossible de lui passer autre chose.
 *
 * Deux modes d'accessibilite, et il faut choisir consciemment :
 *   - sans `label`, l'icone est decorative (`aria-hidden`) — c'est le cas quand
 *     un texte lisible l'accompagne, ce qui est la regle dans les listes ;
 *   - avec `label`, elle porte l'information a elle seule et est annoncee.
 */

import { ICON_PATHS, type IconName } from './registry.js'

export interface IconProps {
  readonly name: IconName
  /** Cote du carre, en pixels. 20 correspond au corps de texte des listes. */
  readonly size?: number
  /**
   * Epaisseur du trait, exprimee dans la grille 24. Elle est mise a l'echelle
   * avec `size` : a 16 px, 1,6 rend un trait d'environ 1,07 px, ce qui est
   * volontairement leger. Monter a 1,9 pour une icone isolee et petite.
   */
  readonly strokeWidth?: number
  readonly className?: string
  /** Renseigne : l'icone est annoncee. Absent : elle est purement decorative. */
  readonly label?: string
}

export function Icon({ name, size = 20, strokeWidth = 1.6, className, label }: IconProps) {
  return (
    <svg
      className={className === undefined ? 'icon' : `icon ${className}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      // Sans ceci, un `<svg>` reste tabulable sous certains moteurs et ajoute
      // un arret de tabulation muet devant chaque ligne de liste.
      focusable="false"
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }}
    />
  )
}
