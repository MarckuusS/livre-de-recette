/**
 * Aspect des rayons, tel que l'utilisateur l'a regle.
 *
 * CE QUE CE HOOK REPARE. Les ecrans appelaient `iconForRayon` en direct, donc
 * la DEDUCTION seule. Le gestionnaire de rayons pouvait bien enregistrer une
 * couleur et une icone, aucune liste ne les lisait : le reglage n'avait d'effet
 * que dans l'ecran ou on le saisissait. Passer par ici est desormais le seul
 * moyen correct d'habiller un rayon.
 *
 * Les deux requetes sont mises en cache long et partagees par TanStack Query :
 * six ecrans peuvent appeler ce hook sans multiplier les appels reseau.
 */

import { useMemo } from 'react'

import { DERIVED_RAYON_STYLE, makeRayonStyle, type RayonStyle } from '../icons/index.js'
import { useCustomIcons, useRayons } from './queries.js'

export function useRayonStyle(): (label: string | null | undefined) => RayonStyle {
  const rayons = useRayons()
  const icons = useCustomIcons()

  return useMemo(() => {
    const declared = rayons.data?.items
    const custom = icons.data?.items
    // Avant le premier chargement, la deduction rend exactement ce que
    // l'application affichait avant l'existence du gestionnaire : aucun
    // scintillement, aucune pastille grise transitoire.
    if (declared === undefined) return DERIVED_RAYON_STYLE
    return makeRayonStyle(declared, custom ?? [])
  }, [rayons.data, icons.data])
}
