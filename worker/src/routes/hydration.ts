/**
 * Hydratation : ce qu'on a bu aujourd'hui.
 *
 * Comme le profil, l'identifiant de la personne vient du cookie signe et jamais
 * du corps de la requete : il n'existe aucun parametre par lequel demander la
 * journee de quelqu'un d'autre.
 *
 * LA CIBLE N'EST PAS RENDUE ICI. Elle se recalcule du poids par
 * `hydrationTarget()`, la meme fonction des deux cotes du reseau — l'ecran
 * connait deja le profil, il n'a pas besoin qu'on lui repete un chiffre qu'il
 * sait deriver. C'est la regle etablie pour les cibles en kcal et en macros.
 */

import { z } from 'zod'

import { json, parseOrThrow, readJson, requireUser, route } from '../http.js'
import { HydrationRepo } from '../repos/hydration.js'

/** Jour LOCAL au format AAAA-MM-JJ. Le fuseau du serveur n'a pas voix ici. */
const jourSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Jour attendu au format AAAA-MM-JJ')

const ajoutSchema = z.object({
  day: jourSchema,
  /**
   * Delta en millilitres, et non un total : deux appareils peuvent ajouter un
   * verre dans la meme minute, et un total ferait disparaitre le premier.
   * Borne a un litre par geste — au-dela, c'est une faute de frappe.
   */
  deltaMl: z.number().int().min(-2000).max(2000),
})

route('GET', '/api/hydration', async ({ env, user, url }) => {
  const me = requireUser(user)
  const day = parseOrThrow(jourSchema, url.searchParams.get('day'))
  return json({ day, ml: await new HydrationRepo(env.DB, me.id).get(day) })
})

route('POST', '/api/hydration', async ({ env, user, request }) => {
  const me = requireUser(user)
  const payload = parseOrThrow(ajoutSchema, await readJson(request))
  const ml = await new HydrationRepo(env.DB, me.id).add(payload.day, payload.deltaMl)

  // Pas de journal d'activite, meme raison que pour le profil : ce qu'une
  // personne boit n'a rien a faire sous les yeux de l'autre membre du foyer.
  return json({ day: payload.day, ml })
})
