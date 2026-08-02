/** Diagnostic et journal d'activite. */

import { listActivity } from '../activity.js'
import { json, route } from '../http.js'

export const VERSION = '0.3.0'

route('GET', '/api/health', async ({ repos, env }) => {
  // On interroge reellement la base : un Worker qui repond alors que D1 est
  // injoignable donnerait un diagnostic faussement rassurant.
  let reachable = false
  let ingredients: number | null = null
  try {
    ingredients = await repos.ingredients.count()
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

route('GET', '/api/activity', async ({ env, url }) =>
  json({ items: await listActivity(env.DB, Number(url.searchParams.get('limit') ?? 50)) }),
)
