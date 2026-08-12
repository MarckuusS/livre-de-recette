/**
 * Bornes chiffrees — le format d'echange entre l'ecran et le Worker.
 *
 * Une borne s'ecrit `champ:sens:valeur`, et une liste se separe par des
 * virgules : `proteins:min:20,salt:max:0.5`.
 *
 * POURQUOI ICI plutot que dans l'ecran, ou ce format est ne. Il a d'abord servi
 * a filtrer la bibliotheque cote client, ou il ne concernait que le
 * navigateur. Des que le catalogue et OpenFoodFacts ont du filtrer a la source
 * — parce qu'on ne peut pas filtrer une page de dix resultats sans mentir sur
 * les 3 474 autres — le meme texte a du etre relu par le Worker. Deux analyseurs
 * pour un seul format finissent toujours par diverger d'un cas limite ; il n'y
 * en a donc qu'un.
 *
 * Le separateur est le DEUX-POINTS et non le point : le point est deja le
 * separateur decimal, et `priceKg.max.12.5` se relisait en 12. Un test
 * d'aller-retour l'a montre.
 *
 * `field` n'est pas contraint ici : la bibliotheque connait des champs que le
 * catalogue ignore (le prix au kilo), et le catalogue en connait que
 * OpenFoodFacts ne sait pas filtrer. Chaque cote valide contre SA liste — ce
 * module ne fait que lire et ecrire.
 */

export interface Criterion {
  readonly field: string
  readonly bound: 'min' | 'max'
  readonly value: number
}

/**
 * Lit une liste de bornes. Toute borne illisible est ignoree EN SILENCE.
 *
 * C'est la meme regle que le reste des options de vue : un lien d'une version
 * anterieure doit s'ouvrir sur une liste un peu moins filtree, jamais sur une
 * page en erreur.
 */
export function parseCriteria(raw: string | null | undefined): Criterion[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .flatMap((part) => {
      const [field, bound, value] = part.split(':')
      const nombre = Number(value)
      if (!field) return []
      if (bound !== 'min' && bound !== 'max') return []
      if (!Number.isFinite(nombre)) return []
      return [{ field, bound, value: nombre }]
    })
}

export const formatCriteria = (list: readonly Criterion[]): string =>
  list.map((c) => `${c.field}:${c.bound}:${c.value}`).join(',')
