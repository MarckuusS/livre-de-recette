/**
 * Frigo et cellier.
 *
 * Chaque lot est distinct : deux briques de lait ouvertes a une semaine
 * d'ecart ne se confondent pas. C'est aussi ce qui permet de consommer le lot
 * le plus proche de la peremption sans toucher aux autres.
 */

import { pantryStockWriteSchema } from '@livre/shared'

import { logActivity } from '../activity.js'
import { badRequest, intParam, json, notFound, parseOrThrow, readJson, route } from '../http.js'
import type { Repositories } from '../repos/index.js'

async function loadPantry(repos: Repositories) {
  const items = await repos.pantry.list()
  const ingredients = await repos.ingredients.byIds(items.map((s) => s.ingredientId))
  return { items, ingredients: Object.fromEntries(ingredients) }
}

route('GET', '/api/pantry', async ({ repos }) => json(await loadPantry(repos)))

route('POST', '/api/pantry', async ({ repos, request, env, user }) => {
  const payload = parseOrThrow(pantryStockWriteSchema, await readJson(request))

  const ingredient = await repos.ingredients.get(payload.ingredientId)
  if (!ingredient) throw notFound('Ingrédient introuvable.')

  const id = await repos.pantry.add(payload)
  await logActivity(env.DB, user, {
    action: 'create',
    entity: 'pantry_stock',
    entityId: id,
    label: ingredient.name,
    details: { grammes: payload.quantityG, peremption: payload.expiryDate },
  })

  return json(await loadPantry(repos), 201)
})

route('PUT', '/api/pantry/:id', async ({ repos, params, request, env, user }) => {
  const id = intParam(params, 'id')
  const stock = await repos.pantry.get(id)
  if (!stock) throw notFound('Lot introuvable.')

  const payload = parseOrThrow(pantryStockWriteSchema, await readJson(request))
  await repos.pantry.update(id, payload)

  const ingredient = await repos.ingredients.get(stock.ingredientId)
  await logActivity(env.DB, user, {
    action: 'update',
    entity: 'pantry_stock',
    entityId: id,
    label: ingredient?.name ?? 'Lot',
    details: { grammes: payload.quantityG, peremption: payload.expiryDate },
  })

  return json(await loadPantry(repos))
})

/**
 * Consommation partielle.
 *
 * Le lot disparait s'il tombe a zero : la table porte un CHECK
 * (quantity_g > 0), donc un lot vide n'existe pas — et un « 0 g de lait »
 * dans la liste du frigo n'apprendrait rien a personne.
 */
route('POST', '/api/pantry/:id/consume', async ({ repos, params, request, env, user }) => {
  const id = intParam(params, 'id')
  const stock = await repos.pantry.get(id)
  if (!stock) throw notFound('Lot introuvable.')

  const body = (await readJson(request)) as { quantityG?: unknown }
  const amount = Number(body?.quantityG)
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Quantité à retirer invalide.')

  const outcome = await repos.pantry.consume(id, amount)
  const ingredient = await repos.ingredients.get(stock.ingredientId)

  await logActivity(env.DB, user, {
    action: outcome.removed ? 'delete' : 'update',
    entity: 'pantry_stock',
    entityId: id,
    label: ingredient?.name ?? 'Lot',
    details: { consomme_g: Math.min(amount, stock.quantityG), reste_g: outcome.remainingG },
  })

  return json({ ...(await loadPantry(repos)), removed: outcome.removed, remainingG: outcome.remainingG })
})

route('DELETE', '/api/pantry/:id', async ({ repos, params, env, user }) => {
  const id = intParam(params, 'id')
  const stock = await repos.pantry.get(id)
  if (!stock) throw notFound('Lot introuvable.')

  const ingredient = await repos.ingredients.get(stock.ingredientId)
  await repos.pantry.delete(id)

  await logActivity(env.DB, user, {
    action: 'delete',
    entity: 'pantry_stock',
    entityId: id,
    label: ingredient?.name ?? 'Lot',
    details: { grammes: stock.quantityG },
  })

  return json(await loadPantry(repos))
})
