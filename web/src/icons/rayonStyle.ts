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

/**
 * Ce qu'il faut dessiner : une icone du jeu, ou une icone collee.
 *
 * L'union est explicite plutot qu'un nom de chaine a interpreter au rendu :
 * une icone collee porte sa propre grille et son propre regime de couleur, et
 * les confondre avec un `IconName` obligerait chaque appelant a refaire la
 * distinction.
 */
export type RayonGlyph =
  | { readonly kind: 'builtin'; readonly name: IconName }
  | {
      readonly kind: 'custom'
      readonly markup: string
      readonly viewBox: string
      readonly keepColors: boolean
    }

/** Ce qu'un rayon expose : de quoi rendre une pastille et une teinte. */
export interface RayonStyle {
  readonly glyph: RayonGlyph
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

/** Une icone de la bibliotheque personnelle. */
export interface CustomIcon {
  readonly id: number
  readonly markup: string
  readonly viewBox: string
  readonly keepColors: boolean
}

/**
 * Prefixe des references vers la bibliotheque personnelle.
 *
 * `category_definition.icon` porte soit un nom du jeu (« rayon-boucherie »),
 * soit « custom:12 ». Une colonne de plus aurait evite le prefixe, au prix
 * d'un etat impossible a exprimer : les deux renseignees a la fois.
 */
const CUSTOM_PREFIX = 'custom:'

export const customIconRef = (id: number): string => `${CUSTOM_PREFIX}${id}`

/**
 * Construit un resolveur a partir des rayons connus.
 *
 * La correspondance se fait sur le nom EXACT, parce que c'est ainsi que
 * `ingredient.category_l1` pointe vers son rayon — il n'y a pas de cle
 * etrangere. Un nom absent de la table (le temps qu'une creation se propage,
 * par exemple) retombe sur la deduction, jamais sur une erreur.
 */
export function makeRayonStyle(
  rayons: readonly RayonAppearance[],
  customIcons: readonly CustomIcon[] = [],
): (label: string | null | undefined) => RayonStyle {
  const byName = new Map(rayons.map((r) => [r.name, r]))
  const byId = new Map(customIcons.map((i) => [i.id, i]))

  return (label) => {
    const slug = rayonSlug(label)
    const chosen = label === null || label === undefined ? undefined : byName.get(label)
    const wanted = chosen?.icon ?? null

    /*
     * Trois etages, du plus explicite au plus sur :
     *   1. une icone personnelle, si la reference resout encore ;
     *   2. une icone du jeu, si le nom en designe une ;
     *   3. l'icone deduite du libelle.
     *
     * Les deux replis ne sont pas theoriques : supprimer une icone de la
     * bibliotheque laisse des rayons pointant vers un identifiant mort, et
     * c'est le comportement voulu — le rayon perd son dessin choisi, il ne
     * casse pas.
     */
    let glyph: RayonGlyph
    if (wanted !== null && wanted.startsWith(CUSTOM_PREFIX)) {
      const custom = byId.get(Number(wanted.slice(CUSTOM_PREFIX.length)))
      glyph =
        custom === undefined
          ? { kind: 'builtin', name: iconForRayon(label) }
          : {
              kind: 'custom',
              markup: custom.markup,
              viewBox: custom.viewBox,
              keepColors: custom.keepColors,
            }
    } else if (wanted !== null && isIconName(wanted)) {
      glyph = { kind: 'builtin', name: wanted }
    } else {
      glyph = { kind: 'builtin', name: iconForRayon(label) }
    }

    if (chosen?.colorHex === null || chosen?.colorHex === undefined) {
      return { glyph, tint: { 'data-rayon': slug } }
    }
    return {
      glyph,
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
