/**
 * Rendu d'un glyphe de rayon : icone du jeu, ou icone collee par l'utilisateur.
 *
 * Deux chemins, parce que les contraintes different :
 *
 *   - une icone du JEU est dessinee dans la grille 24 et au trait `currentColor`.
 *     Les attributs communs sont poses ici, et aucune icone ne peut en devier ;
 *   - une icone COLLEE arrive avec sa propre grille (`viewBox`), et parfois ses
 *     propres couleurs. On respecte sa grille — remettre ses coordonnees a
 *     l'echelle serait faux des qu'elle contient un `transform` — et on lui
 *     impose ou non le style maison selon ce que l'utilisateur a demande.
 *
 * `dangerouslySetInnerHTML` sur du contenu utilisateur n'est acceptable que
 * parce que ce contenu a ete assaini PAR LE SERVEUR avant d'entrer en base
 * (`worker/src/routes/icons.ts`, seul chemin d'ecriture). Le front n'assainit
 * que pour l'apercu, et sa sortie n'est jamais ce qu'on enregistre.
 */

import { ICON_PATHS } from './registry.js'
import type { RayonGlyph } from './rayonStyle.js'

export interface RayonIconProps {
  readonly glyph: RayonGlyph
  readonly size?: number
  readonly strokeWidth?: number
  readonly className?: string
  readonly label?: string
}

export function RayonIcon({ glyph, size = 22, strokeWidth = 1.7, className, label }: RayonIconProps) {
  const custom = glyph.kind === 'custom'

  // Une icone collee qui garde ses couleurs doit rendre EXACTEMENT ce qu'elle
  // porte : lui imposer `fill="none"` viderait les aplats qu'on vient de
  // promettre de conserver.
  const painted = custom && glyph.keepColors

  return (
    <svg
      className={className === undefined ? 'icon' : `icon ${className}`}
      viewBox={custom ? glyph.viewBox : '0 0 24 24'}
      width={size}
      height={size}
      fill={painted ? undefined : 'none'}
      stroke={painted ? undefined : 'currentColor'}
      strokeWidth={painted ? undefined : strokeWidth}
      strokeLinecap={painted ? undefined : 'round'}
      strokeLinejoin={painted ? undefined : 'round'}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      focusable="false"
      dangerouslySetInnerHTML={{
        __html: custom ? glyph.markup : ICON_PATHS[glyph.name],
      }}
    />
  )
}
