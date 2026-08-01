/**
 * API du Livre de recettes — Cloudflare Worker.
 *
 * Sert /api/* sur la meme origine que le front (Cloudflare Pages), ce qui
 * evite toute question de CORS.
 *
 * ---------------------------------------------------------------------------
 * AUTHENTIFICATION — a lire avant de deployer avec de vraies donnees
 * ---------------------------------------------------------------------------
 * Il n'y a volontairement AUCUN code d'authentification ici. La protection se
 * configure dans **Cloudflare Access**, devant le Worker et devant Pages :
 * les requetes non authentifiees sont refusees a la peripherie, avant
 * d'atteindre ce code.
 *
 * C'est le bon choix pour une application mono-utilisateur : zero ligne de
 * code a maintenir, zero session a stocker, et aucun risque d'ecrire soi-meme
 * une verification de jeton bancale. Mais cela veut dire que **tant qu'Access
 * n'est pas active, l'API est publique**. Voir docs/deploiement.md.
 */

import {
  aggregateShoppingList,
  currentIsoWeek,
  isValidIsoWeek,
  type ShoppingList,
} from '@livre/shared'

import { Repositories } from './repositories.js'

export interface Env {
  readonly DB: D1Database
  readonly MEDIA: R2Bucket
  readonly CACHE: KVNamespace
  readonly OFF_USER_AGENT: string
  readonly ENVIRONMENT: string
}

const VERSION = '0.2.0'

// ---------------------------------------------------------------------------
// Reponses
// ---------------------------------------------------------------------------

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Aucune reponse d'API n'est mise en cache : afficher un prix perime
      // comme s'il etait frais serait pire qu'afficher une erreur.
      'cache-control': 'no-store',
    },
  })

/** Les messages sont en francais : ils remontent tels quels a l'ecran. */
const fail = (status: number, code: string, message: string): Response =>
  json({ error: { code, message } }, status)

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const badWeek = (value: string) =>
  new HttpError(400, 'invalid_week', `Semaine « ${value} » invalide. Format attendu : 2026-W18.`)

// ---------------------------------------------------------------------------
// Routeur
// ---------------------------------------------------------------------------

type Handler = (ctx: {
  readonly repos: Repositories
  readonly env: Env
  readonly url: URL
  readonly params: Record<string, string>
  readonly request: Request
}) => Promise<Response>

interface Route {
  readonly method: string
  readonly pattern: RegExp
  readonly keys: readonly string[]
  readonly handler: Handler
}

const routes: Route[] = []

/** `/api/shopping/:week` -> expression reguliere + noms de parametres. */
function route(method: string, path: string, handler: Handler): void {
  const keys: string[] = []
  const pattern = new RegExp(
    '^' +
      path.replace(/:(\w+)/g, (_, key: string) => {
        keys.push(key)
        return '([^/]+)'
      }) +
      '/?$',
  )
  routes.push({ method, pattern, keys, handler })
}

// ---------------------------------------------------------------------------
// Diagnostic
// ---------------------------------------------------------------------------

route('GET', '/api/health', async ({ repos, env }) => {
  // On interroge reellement la base : un Worker qui repond alors que D1 est
  // injoignable donnerait un diagnostic faussement rassurant.
  let reachable = false
  let ingredients: number | null = null
  try {
    ingredients = await repos.countIngredients()
    reachable = true
  } catch {
    reachable = false
  }

  return json({
    status: 'ok',
    version: VERSION,
    environment: env.ENVIRONMENT,
    database: { reachable, ingredients },
    time: new Date().toISOString(),
  })
})

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

route('GET', '/api/ingredients', async ({ repos, url }) => {
  const q = url.searchParams.get('q')
  const items = await repos.listPersonalIngredients(q)
  return json({ items, totalCount: items.length })
})

route('GET', '/api/ingredients/:id', async ({ repos, params }) => {
  const id = Number(params['id'])
  if (!Number.isInteger(id)) throw new HttpError(400, 'invalid_id', 'Identifiant invalide.')
  const ingredient = await repos.getIngredient(id)
  if (!ingredient) throw new HttpError(404, 'not_found', 'Ingrédient introuvable.')
  return json(ingredient)
})

// ---------------------------------------------------------------------------
// Recettes
// ---------------------------------------------------------------------------

route('GET', '/api/recipes', async ({ repos }) => {
  const items = await repos.listRecipeSummaries()
  return json({ items, totalCount: items.length })
})

route('GET', '/api/recipes/:id', async ({ repos, params }) => {
  const id = Number(params['id'])
  if (!Number.isInteger(id)) throw new HttpError(400, 'invalid_id', 'Identifiant invalide.')
  const recipe = (await repos.listRecipesByIds([id])).get(id)
  if (!recipe) throw new HttpError(404, 'not_found', 'Recette introuvable.')
  return json(recipe)
})

// ---------------------------------------------------------------------------
// Calendrier
// ---------------------------------------------------------------------------

route('GET', '/api/calendar/:week', async ({ repos, params }) => {
  const week = params['week'] ?? ''
  if (!isValidIsoWeek(week)) throw badWeek(week)

  const entries = await repos.listWeekEntries(week)
  const recipes = await repos.listRecipesByIds(
    entries.map((e) => e.recipeId).filter((id): id is number => id !== null),
  )
  const ingredients = await repos.listIngredientsByIds(
    entries.map((e) => e.ingredientId).filter((id): id is number => id !== null),
  )

  return json({
    isoWeek: week,
    entries,
    recipes: Object.fromEntries(recipes),
    ingredients: Object.fromEntries(ingredients),
  })
})

// ---------------------------------------------------------------------------
// Frigo
// ---------------------------------------------------------------------------

route('GET', '/api/pantry', async ({ repos }) => {
  const stocks = await repos.listPantry()
  const ingredients = await repos.listIngredientsByIds(stocks.map((s) => s.ingredientId))
  return json({ items: stocks, ingredients: Object.fromEntries(ingredients) })
})

// ---------------------------------------------------------------------------
// Liste de courses
// ---------------------------------------------------------------------------

async function buildShoppingList(repos: Repositories, week: string): Promise<ShoppingList> {
  const entries = await repos.listWeekEntries(week)

  // Chargement en masse : 4 requetes quel que soit le nombre d'entrees.
  const recipes = await repos.listRecipesByIds(
    entries.map((e) => e.recipeId).filter((id): id is number => id !== null),
  )

  const ingredientIds = new Set<number>()
  for (const e of entries) if (e.ingredientId !== null) ingredientIds.add(e.ingredientId)
  for (const r of recipes.values()) {
    for (const l of r.lines) if (l.ingredient.id !== null) ingredientIds.add(l.ingredient.id)
  }

  const [ingredients, pantry] = await Promise.all([
    repos.listIngredientsByIds(ingredientIds),
    repos.pantryTotalsByIngredient(),
  ])

  return aggregateShoppingList({
    isoWeek: week,
    entries,
    recipesById: recipes,
    ingredientsById: ingredients,
    pantryByIngredient: pantry,
  })
}

route('GET', '/api/shopping/:week', async ({ repos, params }) => {
  const week = params['week'] ?? ''
  if (!isValidIsoWeek(week)) throw badWeek(week)
  const [list, checked] = await Promise.all([
    buildShoppingList(repos, week),
    repos.getCheckedItems(week),
  ])
  return json({ ...list, checkedIngredientIds: checked })
})

/**
 * Cases cochees. Volatiles dans le desktop : un rafraichissement en plein
 * magasin effacait tout le travail. Elles sont desormais persistees.
 */
route('PUT', '/api/shopping/:week/checked', async ({ repos, params, request }) => {
  const week = params['week'] ?? ''
  if (!isValidIsoWeek(week)) throw badWeek(week)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new HttpError(400, 'invalid_body', 'Corps de requête illisible.')
  }

  const ids = (body as { ingredientIds?: unknown })?.ingredientIds
  if (!Array.isArray(ids) || !ids.every((v) => Number.isInteger(v))) {
    throw new HttpError(400, 'invalid_body', 'ingredientIds doit être une liste d’entiers.')
  }

  await repos.setCheckedItems(week, ids as number[])
  return json({ isoWeek: week, checkedIngredientIds: ids })
})

/** Semaine courante — calculee cote serveur (UTC) et cote client (heure locale). */
route('GET', '/api/current-week', async () => json({ isoWeek: currentIsoWeek() }))

// ---------------------------------------------------------------------------
// Point d'entree
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (!url.pathname.startsWith('/api/')) {
      return fail(404, 'not_found', 'Cette adresse ne correspond à aucune API.')
    }

    for (const r of routes) {
      const match = r.pattern.exec(url.pathname)
      if (!match) continue
      if (r.method !== request.method) {
        return fail(405, 'method_not_allowed', `Méthode ${request.method} non autorisée ici.`)
      }

      const params: Record<string, string> = {}
      r.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(match[i + 1] ?? '')
      })

      try {
        return await r.handler({ repos: new Repositories(env.DB), env, url, params, request })
      } catch (error) {
        if (error instanceof HttpError) return fail(error.status, error.code, error.message)
        // Le detail part dans les logs Cloudflare, jamais dans la reponse :
        // un message d'erreur SQL renseigne un attaquant sur le schema.
        console.error('Erreur non gérée', url.pathname, error)
        return fail(500, 'internal', 'Une erreur interne est survenue.')
      }
    }

    return fail(404, 'not_found', 'Cette adresse ne correspond à aucune API.')
  },
} satisfies ExportedHandler<Env>
