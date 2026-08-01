/** Acces aux donnees de l'API, via TanStack Query. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  currentIsoWeek,
  type Ingredient,
  type MealPlanEntry,
  type PantryStock,
  type Recipe,
  type ShoppingList,
} from '@livre/shared'

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

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

export function useIngredients(query: string) {
  return useQuery({
    queryKey: ['ingredients', query],
    queryFn: () =>
      apiFetch<{ items: Ingredient[]; totalCount: number }>(
        `/api/ingredients${query ? `?q=${encodeURIComponent(query)}` : ''}`,
      ),
    // Garde la liste precedente affichee pendant la frappe, au lieu de
    // repasser par un squelette a chaque lettre.
    placeholderData: (previous) => previous,
  })
}

export function useIngredient(id: number | null) {
  return useQuery({
    queryKey: ['ingredient', id],
    queryFn: () => apiFetch<Ingredient>(`/api/ingredients/${id}`),
    enabled: id !== null,
  })
}

// ---------------------------------------------------------------------------
// Recettes
// ---------------------------------------------------------------------------

export interface RecipeSummary {
  readonly id: number
  readonly name: string
  readonly defaultPortions: number
  readonly imageKey: string | null
  readonly lineCount: number
}

export function useRecipes() {
  return useQuery({
    queryKey: ['recipes'],
    queryFn: () => apiFetch<{ items: RecipeSummary[]; totalCount: number }>('/api/recipes'),
  })
}

export function useRecipe(id: number | null) {
  return useQuery({
    queryKey: ['recipe', id],
    queryFn: () => apiFetch<Recipe>(`/api/recipes/${id}`),
    enabled: id !== null,
  })
}

// ---------------------------------------------------------------------------
// Calendrier
// ---------------------------------------------------------------------------

export interface CalendarResponse {
  readonly isoWeek: string
  readonly entries: readonly MealPlanEntry[]
  /** Recettes et ingredients references, indexes par identifiant. */
  readonly recipes: Record<string, Recipe>
  readonly ingredients: Record<string, Ingredient>
}

export function useCalendar(isoWeek: string) {
  return useQuery({
    queryKey: ['calendar', isoWeek],
    queryFn: () => apiFetch<CalendarResponse>(`/api/calendar/${isoWeek}`),
  })
}

// ---------------------------------------------------------------------------
// Frigo
// ---------------------------------------------------------------------------

export interface PantryResponse {
  readonly items: readonly PantryStock[]
  readonly ingredients: Record<string, Ingredient>
}

export function usePantry() {
  return useQuery({ queryKey: ['pantry'], queryFn: () => apiFetch<PantryResponse>('/api/pantry') })
}

/** Semaine ISO courante, calculee sur l'heure LOCALE du telephone. */
export const useCurrentWeek = () => currentIsoWeek()
