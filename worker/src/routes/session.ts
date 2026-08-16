/**
 * Connexion, deconnexion, etat de session.
 *
 * Ces trois routes sont les SEULES accessibles sans session — voir
 * `PUBLIC_ROUTES` dans index.ts. `/logout` et `/session` sont inoffensives :
 * l'une efface un cookie, l'autre ne dit que « oui » ou « non ».
 */

import {
  authenticate,
  clearSessionCookie,
  hasAnyUser,
  issueSession,
  lockoutRemaining,
  recordFailure,
  resetFailures,
} from '../auth.js'
import { HttpError, badRequest, json, readJson, route } from '../http.js'

route('POST', '/api/login', async ({ env, request }) => {
  if (!(await hasAnyUser(env.DB))) {
    // Aucun compte en base : on REFUSE plutot que d'ouvrir. Un defaut de
    // configuration ne doit jamais laisser entrer.
    throw new HttpError(503, 'no_users', "Aucun compte n'est configuré sur ce serveur.")
  }

  const locked = await lockoutRemaining(env.DB)
  if (locked > 0) {
    throw new HttpError(
      429,
      'locked_out',
      `Trop de tentatives. Réessaie dans ${Math.ceil(locked / 60)} minute(s).`,
    )
  }

  const { username, password } = ((await readJson(request)) ?? {}) as {
    username?: unknown
    password?: unknown
  }
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    throw badRequest('Identifiant et mot de passe requis.')
  }

  let user
  try {
    user = await authenticate(env.DB, username, password)
  } catch (error) {
    // Un compte cree avant que le plafond PBKDF2 de la plateforme ne soit
    // connu porte un nombre d'iterations que Workers refuse de deriver. Sans
    // ce message, la connexion echoue en « erreur interne » et rien
    // n'indique quoi faire.
    if (error instanceof Error && error.name === 'IterationLimitError') {
      throw new HttpError(
        500,
        'stale_hash',
        'Ce compte a été créé avec des réglages que le serveur refuse désormais. ' +
          'Recrée-le avec « node scripts/add-user.mjs ».',
      )
    }
    throw error
  }

  if (!user) {
    await recordFailure(env.DB)
    // Volontairement vague : ne pas reveler si c'est l'identifiant ou le mot
    // de passe qui est faux, cela permettrait d'enumerer les comptes.
    throw new HttpError(401, 'bad_credentials', 'Identifiant ou mot de passe incorrect.')
  }

  await resetFailures(env.DB)
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': await issueSession(env.DB, user.id),
    },
  })
})

route(
  'POST',
  '/api/logout',
  async () =>
    new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'set-cookie': clearSessionCookie(),
      },
    }),
)

/**
 * Permet au front de savoir s'il doit afficher l'ecran de connexion, et qui est la.
 *
 * ON REPREND L'UTILISATEUR DU CONTEXTE, on ne le recalcule pas. Le refaire ici
 * avec `currentUser` couterait une deuxieme fois le meme travail, et surtout
 * manquerait la connexion automatique de developpement, qui n'est appliquee
 * qu'en un seul endroit (index.ts) : l'ecran de connexion serait alors le seul
 * a la contourner, donc le seul a s'afficher quand meme.
 */
route('GET', '/api/session', async ({ user }) => json({ authenticated: user !== null, user }))
