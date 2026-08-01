/** Acces aux donnees de l'API, via TanStack Query. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { currentIsoWeek, type ShoppingList } from '@livre/shared'

import { apiFetch } from './api.js'

export interface ShoppingListResponse extends ShoppingList {
  /** Cases cochees, persistees cote serveur. */
  readonly checkedIngredientIds: readonly number[]
}

export function useShoppingList(isoWeek: string) {
  return useQuery({
    queryKey: ['shopping', isoWeek],
    queryFn: () => apiFetch<ShoppingListResponse>(`/api/shopping/${isoWeek}`),
  })
}

/**
 * Coche ou decoche un article.
 *
 * Mise a jour optimiste : en magasin le reseau est mauvais, attendre la
 * reponse du serveur avant de cocher rendrait la liste inutilisable. On
 * applique le changement immediatement et on revient en arriere si l'appel
 * echoue.
 */
export function useToggleChecked(isoWeek: string) {
  const client = useQueryClient()
  const key = ['shopping', isoWeek] as const

  return useMutation({
    mutationFn: (ingredientIds: readonly number[]) =>
      apiFetch<{ checkedIngredientIds: number[] }>(`/api/shopping/${isoWeek}/checked`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ingredientIds }),
      }),

    onMutate: async (ingredientIds) => {
      // Sans cette annulation, une lecture encore en vol pourrait ecraser
      // la mise a jour optimiste en arrivant apres elle.
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<ShoppingListResponse>(key)
      if (previous) {
        client.setQueryData<ShoppingListResponse>(key, { ...previous, checkedIngredientIds: ingredientIds })
      }
      return { previous }
    },

    onError: (_error, _vars, context) => {
      if (context?.previous) client.setQueryData(key, context.previous)
    },
  })
}

/** Semaine ISO courante, calculee sur l'heure LOCALE du telephone. */
export const useCurrentWeek = () => currentIsoWeek()
