/**
 * Aspect d'un rayon : son icone, sa teinte, et ce qu'il faut poser sur la balise.
 *
 * DEUX SOURCES, dans cet ordre :
 *
 *   1. ce que l'utilisateur a choisi dans le gestionnaire de rayons ;
 *   2. a defaut, ce que `resolve.ts` deduit du nom.
 *
 * Le second etage n'est pas un repli honteux, c'est le cas NORMAL : un rayon
 * jamais ouvert dans le gestionnaire a `icon` et `colorHex` a NULL en base, et
 * garde l'aspect qu'il avait avant l'existence du gestionnaire. Personne n'a a
 * renseigner dix rayons pour que l'ecran soit correct.
 *
 * POURQUOI DEUX MECANISMES DE COULEUR. Les dix teintes par defaut vivent en
 * CSS (`styles/icons.css`, selecteur `[data-rayon]`), ce qui leur donne
 * gratuitement leur variante sombre via `prefers-color-scheme`. Une couleur
 * choisie a la main ne peut pas passer par la : elle n'existe pas au moment ou
 * l'on ecrit la feuille de style. Elle est donc posee en variable inline, et
 * c'est encore la CSS qui en derive la variante sombre — voir la regle
 * `[data-rayon][data-rayon-custom]`. Le composant n'a jamais a savoir quel
 * theme est actif, ce qui evite de recalculer une couleur a chaque bascule.
 */

import type { CSSProperties } from 'react'

import { iconForRayon, rayonSlug } from './resolve.js'
import { isIconName, type IconName } from './registry.js'

/** Ce qu'un rayon expose : de quoi rendre une pastille et une teinte. */
export interface RayonStyle {
  readonly icon: IconName
  /** Attributs a etaler sur l'element teinte. */
  readonly tint: {
    readonly 'data-rayon': string
    readonly 'data-rayon-custom'?: '' | undefined
    /**
     * Porte `--rayon-base`. Le type de React ne connait pas les proprietes
     * personnalisees : la conversion ci-dessous est la facon consacree de les
     * lui faire accepter, et elle est sans risque — la valeur vient d'un champ
     * valide par `rayonSchema` cote serveur.
     */
    readonly style?: CSSProperties | undefined
  }
}

/** Le minimum dont on a besoin pour habiller un rayon. */
export interface RayonAppearance {
  readonly name: string
  readonly icon: string | null
  readonly colorHex: string | null
}

/**
 * Construit un resolveur a partir des rayons connus.
 *
 * La correspondance se fait sur le nom EXACT, parce que c'est ainsi que
 * `ingredient.category_l1` pointe vers son rayon — il n'y a pas de cle
 * etrangere. Un nom absent de la table (le temps qu'une creation se propage,
 * par exemple) retombe sur la deduction, jamais sur une erreur.
 */
export function makeRayonStyle(rayons: readonly RayonAppearance[]): (label: string | null | undefined) => RayonStyle {
  const byName = new Map(rayons.map((r) => [r.name, r]))

  return (label) => {
    const slug = rayonSlug(label)
    const chosen = label === null || label === undefined ? undefined : byName.get(label)

    // Une icone inconnue (jeu modifie depuis, valeur saisie a la main en base)
    // ne doit pas casser l'affichage : on redescend d'un etage.
    const icon =
      chosen?.icon !== null && chosen?.icon !== undefined && isIconName(chosen.icon)
        ? chosen.icon
        : iconForRayon(label)

    if (chosen?.colorHex === null || chosen?.colorHex === undefined) {
      return { icon, tint: { 'data-rayon': slug } }
    }
    return {
      icon,
      tint: {
        'data-rayon': slug,
        'data-rayon-custom': '',
        style: { '--rayon-base': chosen.colorHex } as CSSProperties,
      },
    }
  }
}

/** Resolveur sans reglages : la deduction seule. Sert avant le chargement. */
export const DERIVED_RAYON_STYLE = makeRayonStyle([])
