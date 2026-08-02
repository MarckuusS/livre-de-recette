/**
 * Ingredients : bibliotheque personnelle, catalogue, prix.
 *
 * Rappel du modele, qui surprend souvent : catalogue et bibliotheque sont la
 * meme table. « Ajouter » un ingredient CIQUAL ne cree rien, cela leve
 * `in_personal_library`. C'est pourquoi il y a deux verbes de suppression
 * distincts — retirer de la bibliotheque, et supprimer pour de bon.
 */

import { ingredientCreateSchema, ingredientPatchSchema, priceHistoryEntrySchema } from '@livre/shared'

import { logActivity } from '../activity.js'
import { badRequest, HttpError, intParam, json, notFound, parseOrThrow, readJson, route } from '../http.js'

// ---------------------------------------------------------------------------
// Bibliotheque personnelle
// ---------------------------------------------------------------------------

route('GET', '/api/ingredients', async ({ repos, url }) => {
  const items = await repos.ingredients.listPersonal(url.searchParams.get('q'))
  return json({ items, totalCount: items.length })
})

route('POST', '/api/ingredients', async ({ repos, request, env, user }) => {
  const payload = parseOrThrow(ingredientCreateSchema, await readJson(request))

  // Un doublon exact de nom rend la bibliotheque inutilisable : deux « Tomate »
  // que rien ne distingue dans un menu deroulant. On refuse tot, avec le nom
  // exact du coupable plutot qu'une violation de contrainte.
  const existing = await repos.ingredients.findByNormalizedName(payload.name)
  if (existing) {
    // L'identifiant accompagne le message : l'interface peut alors proposer
    // d'ouvrir la fiche existante, au lieu de laisser l'utilisateur chercher
    // lui-meme ce qu'il vient de recreer.
    throw new HttpError(
      409,
      'duplicate_name',
      `« ${existing.name} » existe déjà dans ta bibliothèque.`,
      { existingId: existing.id },
    )
  }

  const id = await repos.ingredients.create({ ...payload, inLibrary: true })
  await logActivity(env.DB, user, {
    action: 'create',
    entity: 'ingredient',
    entityId: id,
    label: payload.name,
  })

  return json(await repos.ingredients.get(id), 201)
})

route('GET', '/api/ingredients/:id', async ({ repos, params }) => {
  const ingredient = await repos.ingredients.get(intParam(params, 'id'))
  if (!ingredient) throw notFound('Ingrédient introuvable.')
  return json(ingredient)
})

route('PATCH', '/api/ingredients/:id', async ({ repos, params, request, env, user }) => {
  const id = intParam(params, 'id')
  const before = await repos.ingredients.get(id)
  if (!before) throw notFound('Ingrédient introuvable.')

  const patch = parseOrThrow(ingredientPatchSchema, await readJson(request))

  if (typeof patch.name === 'string') {
    const clash = await repos.ingredients.findByNormalizedName(patch.name, id)
    if (clash) {
      throw new HttpError(409, 'duplicate_name', `« ${clash.name} » existe déjà.`, {
        existingId: clash.id,
      })
    }
  }

  const changed = await repos.ingredients.update(id, patch)
  if (!changed) return json(before)

  await logActivity(env.DB, user, {
    action: 'update',
    entity: 'ingredient',
    entityId: id,
    label: patch.name ?? before.name,
    details: { champs: Object.keys(patch) },
  })

  return json(await repos.ingredients.get(id))
})

/**
 * Suppression.
 *
 * Comportement repris du desktop : une ligne du catalogue (CIQUAL,
 * OpenFoodFacts) n'est jamais detruite, elle sort simplement de la
 * bibliotheque — la reimporter doit rester possible sans re-telecharger le
 * catalogue. Seules les fiches creees a la main disparaissent vraiment.
 */
route('DELETE', '/api/ingredients/:id', async ({ repos, params, env, user }) => {
  const id = intParam(params, 'id')
  const ingredient = await repos.ingredients.get(id)
  if (!ingredient) throw notFound('Ingrédient introuvable.')

  if (ingredient.source !== 'manual') {
    await repos.ingredients.setInLibrary(id, false)
    await logActivity(env.DB, user, {
      action: 'update',
      entity: 'ingredient',
      entityId: id,
      label: ingredient.name,
      details: { retire_de_la_bibliotheque: true },
    })
    return json({ removed: 'library', ingredient: await repos.ingredients.get(id) })
  }

  const usage = await repos.ingredients.usage(id)
  if (usage.recipes > 0) {
    const names = await repos.ingredients.recipeNamesUsing(id)
    throw new HttpError(
      409,
      'in_use',
      `Impossible de supprimer « ${ingredient.name} » : utilisé par ${names.join(', ')}.`,
    )
  }

  await repos.ingredients.delete(id)
  await logActivity(env.DB, user, {
    action: 'delete',
    entity: 'ingredient',
    entityId: id,
    // Le libelle est fige ici : apres le DELETE, plus rien ne permettrait
    // de retrouver ce nom.
    label: ingredient.name,
  })

  return json({ removed: 'permanent', id })
})

// ---------------------------------------------------------------------------
// Catalogue — la fenetre « Importer un ingrédient »
// ---------------------------------------------------------------------------

route('GET', '/api/catalog', async ({ repos, url }) => {
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200)
  const offset = Math.max(Number(url.searchParams.get('offset') ?? 0) || 0, 0)

  const page = await repos.ingredients.searchCatalog(url.searchParams.get('q'), {
    source: url.searchParams.get('source'),
    categoryL1: url.searchParams.get('category'),
    limit,
    offset,
  })

  return json({ ...page, limit, offset })
})

route('GET', '/api/categories', async ({ repos }) => json({ items: await repos.ingredients.listCategories() }))

/** Fait entrer une fiche du catalogue dans la bibliotheque personnelle. */
route('PUT', '/api/ingredients/:id/library', async ({ repos, params, env, user }) => {
  const id = intParam(params, 'id')
  const ingredient = await repos.ingredients.get(id)
  if (!ingredient) throw notFound('Ingrédient introuvable.')

  if (!ingredient.inLibrary) {
    await repos.ingredients.setInLibrary(id, true)
    await logActivity(env.DB, user, {
      action: 'create',
      entity: 'ingredient',
      entityId: id,
      label: ingredient.name,
      details: { importe_depuis: ingredient.source },
    })
  }

  return json(await repos.ingredients.get(id))
})

// ---------------------------------------------------------------------------
// Historique de prix
// ---------------------------------------------------------------------------

route('GET', '/api/ingredients/:id/prices', async ({ repos, params }) =>
  json({ items: await repos.ingredients.listPriceHistory(intParam(params, 'id')) }),
)

route('POST', '/api/ingredients/:id/prices', async ({ repos, params, request, env, user }) => {
  const id = intParam(params, 'id')
  const ingredient = await repos.ingredients.get(id)
  if (!ingredient) throw notFound('Ingrédient introuvable.')

  const body = await readJson(request)
  const entry = parseOrThrow(priceHistoryEntrySchema, {
    ...(typeof body === 'object' && body !== null ? body : {}),
    // L'identifiant du chemin fait foi : un corps qui en designerait un autre
    // ecrirait dans la fiche d'a cote.
    ingredientId: id,
  })

  await repos.ingredients.addPriceObservation({
    ingredientId: id,
    priceEur: entry.priceEur,
    quantityG: entry.quantityG,
    store: entry.store,
    recordedAt: entry.recordedAt,
    notes: entry.notes,
  })

  await logActivity(env.DB, user, {
    action: 'create',
    entity: 'price_history',
    entityId: id,
    label: ingredient.name,
    details: { prix: entry.priceEur, pour_g: entry.quantityG, magasin: entry.store },
  })

  return json(
    {
      items: await repos.ingredients.listPriceHistory(id),
      ingredient: await repos.ingredients.get(id),
    },
    201,
  )
})

route('DELETE', '/api/prices/:id', async ({ repos, params, url, env, user }) => {
  const id = intParam(params, 'id')
  const removed = await repos.ingredients.deletePriceObservation(id)
  if (!removed) throw notFound('Relevé de prix introuvable.')

  await logActivity(env.DB, user, {
    action: 'delete',
    entity: 'price_history',
    entityId: id,
    label: 'Relevé de prix',
  })

  // La suppression a pu changer le prix courant de la fiche. On rend l'etat
  // recalcule quand l'appelant dit de quel ingredient il s'agit, plutot que de
  // le laisser deviner qu'il doit relire.
  const ingredientId = Number(url.searchParams.get('ingredient'))
  if (Number.isInteger(ingredientId) && ingredientId > 0) {
    return json({
      id,
      items: await repos.ingredients.listPriceHistory(ingredientId),
      ingredient: await repos.ingredients.get(ingredientId),
    })
  }

  return json({ id })
})

// ---------------------------------------------------------------------------
// Recherche OpenFoodFacts — proxy
// ---------------------------------------------------------------------------

/**
 * Le front n'appelle pas OpenFoodFacts directement : le navigateur y ajouterait
 * une requete preliminaire CORS a chaque frappe, et l'entete `User-Agent`
 * qu'OFF exige pour ne pas brider les clients anonymes n'est pas modifiable
 * depuis une page web.
 */
route('GET', '/api/off/search', async ({ url, env }) => {
  const query = (url.searchParams.get('q') ?? '').trim()
  if (!query) return json({ items: [], totalCount: 0 })

  const target = new URL('https://search.openfoodfacts.org/search')
  target.searchParams.set('q', query)
  target.searchParams.set('page_size', String(Math.min(Number(url.searchParams.get('limit') ?? 25) || 25, 50)))
  target.searchParams.set('langs', 'fr,en')

  let response: Response
  try {
    response = await fetch(target, { headers: { 'User-Agent': env.OFF_USER_AGENT, Accept: 'application/json' } })
  } catch {
    throw new HttpError(502, 'off_unreachable', 'OpenFoodFacts est injoignable. Réessaie plus tard.')
  }

  if (!response.ok) {
    throw new HttpError(502, 'off_error', `OpenFoodFacts a répondu ${response.status}.`)
  }

  const body = (await response.json()) as { hits?: unknown[]; count?: number }
  const hits = Array.isArray(body.hits) ? body.hits : []

  return json({ items: hits.map(toOffCandidate), totalCount: body.count ?? hits.length })
})

/** Code-barres : le chemin du scan par la camera du telephone. */
route('GET', '/api/off/barcode/:ean', async ({ params, env, repos }) => {
  const ean = (params['ean'] ?? '').replace(/\D/g, '')
  if (ean.length < 8) throw badRequest('Code-barres invalide.', 'invalid_barcode')

  // Deja connu localement : on rend LA fiche existante, avec le prix releve
  // et le poids a la piece que l'utilisateur a saisis. Repartir d'OFF les
  // ecraserait a chaque scan.
  const known = await repos.ingredients.findBySourceRef('openfoodfacts', ean)
  if (known) return json({ ...known, alreadyKnown: true })

  let response: Response
  try {
    response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}`, {
      headers: { 'User-Agent': env.OFF_USER_AGENT, Accept: 'application/json' },
    })
  } catch {
    throw new HttpError(502, 'off_unreachable', 'OpenFoodFacts est injoignable. Réessaie plus tard.')
  }

  if (response.status === 404) throw notFound(`Aucun produit ne correspond au code ${ean}.`)
  if (!response.ok) throw new HttpError(502, 'off_error', `OpenFoodFacts a répondu ${response.status}.`)

  const body = (await response.json()) as { status?: number; product?: Record<string, unknown> }
  if (body.status !== 1 || !body.product) throw notFound(`Aucun produit ne correspond au code ${ean}.`)

  return json(toOffCandidate(body.product))
})

/**
 * Traduit un produit OFF vers la forme d'un ingredient.
 *
 * Les macros d'OFF sont deja pour 100 g. Les champs manquants restent `null` :
 * une valeur inconnue n'est pas zero, et ecrire 0 kcal fausserait tous les
 * totaux de la semaine sans que rien ne le signale.
 */
function toOffCandidate(raw: unknown): Record<string, unknown> {
  const p = (raw ?? {}) as Record<string, unknown>
  const n = (p['nutriments'] ?? {}) as Record<string, unknown>
  const num = (key: string): number | null => {
    const value = n[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
  }

  const name =
    (typeof p['product_name_fr'] === 'string' && p['product_name_fr']) ||
    (typeof p['product_name'] === 'string' && p['product_name']) ||
    'Produit sans nom'

  return {
    id: null,
    name,
    source: 'openfoodfacts',
    sourceRef: typeof p['code'] === 'string' ? p['code'] : null,
    brand: typeof p['brands'] === 'string' ? p['brands'] : null,
    kcal: num('energy-kcal_100g'),
    proteins: num('proteins_100g'),
    carbs: num('carbohydrates_100g'),
    sugars: num('sugars_100g'),
    fats: num('fat_100g'),
    saturatedFats: num('saturated-fat_100g'),
    fiber: num('fiber_100g'),
    salt: num('salt_100g'),
    priceEur: null,
    priceQuantityG: null,
    pieceWeightG: null,
    cookedWeightPer100gRaw: null,
    inLibrary: false,
    categoryL1: null,
    categoryL2: null,
    seasonMonths: null,
    createdAt: null,
    updatedAt: null,
  }
}
