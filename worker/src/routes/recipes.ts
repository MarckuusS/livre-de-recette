/**
 * Recettes, tags et journal de cuisson.
 */

import { cookingLogWriteSchema, recipeWriteSchema, tagWriteSchema } from '@livre/shared'

import { logActivity } from '../activity.js'
import { HttpError, intParam, json, notFound, parseOrThrow, readJson, route } from '../http.js'

// ---------------------------------------------------------------------------
// Recettes
// ---------------------------------------------------------------------------

route('GET', '/api/recipes', async ({ repos, url }) => {
  const tagParam = url.searchParams.get('tag')
  const items = await repos.recipes.listSummaries({
    query: url.searchParams.get('q'),
    tagId: tagParam ? Number(tagParam) || null : null,
  })
  return json({ items, totalCount: items.length })
})

route('POST', '/api/recipes', async ({ repos, request, env, user }) => {
  const payload = parseOrThrow(recipeWriteSchema, await readJson(request))
  await assertIngredientsExist(repos, payload.lines)

  const id = await repos.recipes.create(payload)
  await logActivity(env.DB, user, { action: 'create', entity: 'recipe', entityId: id, label: payload.name })

  return json(await repos.recipes.get(id), 201)
})

route('GET', '/api/recipes/:id', async ({ repos, params }) => {
  const recipe = await repos.recipes.get(intParam(params, 'id'))
  if (!recipe) throw notFound('Recette introuvable.')
  return json(recipe)
})

route('PUT', '/api/recipes/:id', async ({ repos, params, request, env, user }) => {
  const id = intParam(params, 'id')
  const before = await repos.recipes.get(id)
  if (!before) throw notFound('Recette introuvable.')

  const payload = parseOrThrow(recipeWriteSchema, await readJson(request))
  await assertIngredientsExist(repos, payload.lines)

  await repos.recipes.update(id, payload)
  await logActivity(env.DB, user, {
    action: 'update',
    entity: 'recipe',
    entityId: id,
    label: payload.name,
    details: { lignes: payload.lines.length, renommee: before.name !== payload.name ? before.name : undefined },
  })

  return json(await repos.recipes.get(id))
})

route('DELETE', '/api/recipes/:id', async ({ repos, params, env, user }) => {
  const id = intParam(params, 'id')
  const recipe = await repos.recipes.get(id)
  if (!recipe) throw notFound('Recette introuvable.')

  // Le calendrier tombe en cascade. On le dit AVANT, dans la reponse : perdre
  // silencieusement trois repas planifies serait une mauvaise surprise.
  const planned = await repos.recipes.plannedCount(id)

  await repos.recipes.delete(id)
  await logActivity(env.DB, user, {
    action: 'delete',
    entity: 'recipe',
    entityId: id,
    label: recipe.name,
    details: planned > 0 ? { repas_planifies_supprimes: planned } : undefined,
  })

  return json({ id, plannedEntriesRemoved: planned })
})

/**
 * Refuse tot une ligne qui pointe vers un ingredient disparu.
 *
 * `recipe_ingredient` porte une cle etrangere : sans ce controle, l'echec
 * remonterait comme une erreur SQLite opaque, apres que le DELETE des lignes
 * existantes soit deja parti dans le meme batch.
 */
async function assertIngredientsExist(
  repos: { ingredients: { byIds: (ids: number[]) => Promise<Map<number, unknown>> } },
  lines: ReadonlyArray<{ ingredientId: number }>,
): Promise<void> {
  if (lines.length === 0) return
  const ids = lines.map((l) => l.ingredientId)
  const found = await repos.ingredients.byIds(ids)
  const missing = [...new Set(ids)].filter((id) => !found.has(id))
  if (missing.length > 0) {
    throw new HttpError(
      422,
      'unknown_ingredient',
      `Ingrédient introuvable (identifiant ${missing.join(', ')}). Il a peut-être été supprimé entre-temps.`,
    )
  }
}

// ---------------------------------------------------------------------------
// Journal de cuisson
// ---------------------------------------------------------------------------

route('GET', '/api/recipes/:id/cooking', async ({ repos, params }) =>
  json({ items: await repos.recipes.listCookingLog(intParam(params, 'id')) }),
)

route('POST', '/api/recipes/:id/cooking', async ({ repos, params, request, env, user }) => {
  const id = intParam(params, 'id')
  const recipe = await repos.recipes.get(id)
  if (!recipe) throw notFound('Recette introuvable.')

  const entry = parseOrThrow(cookingLogWriteSchema, await readJson(request))
  const logId = await repos.recipes.addCookingLog({
    recipeId: id,
    cookedAt: entry.cookedAt,
    rating: entry.rating,
    notes: entry.notes,
  })

  await logActivity(env.DB, user, {
    action: 'create',
    entity: 'cooking_log',
    entityId: logId,
    label: recipe.name,
    details: { le: entry.cookedAt, note: entry.rating },
  })

  return json({ items: await repos.recipes.listCookingLog(id) }, 201)
})

route('DELETE', '/api/cooking/:id', async ({ repos, params, env, user }) => {
  const id = intParam(params, 'id')
  if (!(await repos.recipes.deleteCookingLog(id))) throw notFound('Entrée de journal introuvable.')

  await logActivity(env.DB, user, { action: 'delete', entity: 'cooking_log', entityId: id, label: 'Cuisson' })
  return json({ id })
})

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

route('GET', '/api/tags', async ({ repos }) => json({ items: await repos.recipes.listTags() }))

route('POST', '/api/tags', async ({ repos, request }) => {
  const payload = parseOrThrow(tagWriteSchema, await readJson(request))

  // `tag.name` est UNIQUE : on traduit la violation en message lisible plutot
  // que de laisser remonter « UNIQUE constraint failed ».
  const existing = (await repos.recipes.listTags()).find(
    (t) => t.name.toLowerCase() === payload.name.toLowerCase(),
  )
  if (existing) throw new HttpError(409, 'duplicate_name', `Le tag « ${existing.name} » existe déjà.`)

  const id = await repos.recipes.createTag(payload.name, payload.colorHex)
  return json({ id, name: payload.name, colorHex: payload.colorHex, recipeCount: 0 }, 201)
})

route('PUT', '/api/tags/:id', async ({ repos, params, request }) => {
  const id = intParam(params, 'id')
  const payload = parseOrThrow(tagWriteSchema, await readJson(request))
  if (!(await repos.recipes.updateTag(id, payload.name, payload.colorHex))) throw notFound('Tag introuvable.')
  return json({ id, name: payload.name, colorHex: payload.colorHex })
})

route('DELETE', '/api/tags/:id', async ({ repos, params }) => {
  const id = intParam(params, 'id')
  if (!(await repos.recipes.deleteTag(id))) throw notFound('Tag introuvable.')
  return json({ id })
})
