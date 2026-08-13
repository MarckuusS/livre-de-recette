/**
 * Les pesees.
 *
 * Comme le profil et l'hydratation, l'identifiant de la personne vient du
 * cookie signe et jamais du corps de la requete.
 *
 * ENREGISTRER UNE PESEE MET AUSSI A JOUR `user_profile.weight_kg`, et c'est
 * volontaire : cette colonne est la valeur de reference du calcul de cible, et
 * la laisser derriere ferait calculer un objectif sur un poids d'il y a trois
 * mois. Les deux ne se confondent pas pour autant, on peut regler un profil
 * sans jamais se peser.
 */

import { z } from 'zod'

import { json, parseOrThrow, readJson, requireUser, route } from '../http.js'
import { ProfileRepo } from '../repos/profile.js'
import { WeightRepo } from '../repos/weight.js'

const jourSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Jour attendu au format AAAA-MM-JJ')

const peseeSchema = z.object({
  day: jourSchema,
  /** Memes bornes que le profil : au-dela, c'est une faute de frappe. */
  weightKg: z.number().min(20).max(400),
})

route('GET', '/api/weight', async ({ env, user, url }) => {
  const me = requireUser(user)
  // Par defaut deux ans : assez pour "Tout" sans jamais tout charger.
  const depuis = url.searchParams.get('depuis')
  const debut =
    depuis !== null && /^\d{4}-\d{2}-\d{2}$/.test(depuis)
      ? depuis
      : new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10)

  return json({ weighIns: await new WeightRepo(env.DB, me.id).since(debut) })
})

route('PUT', '/api/weight', async ({ env, user, request }) => {
  const me = requireUser(user)
  const pesee = parseOrThrow(peseeSchema, await readJson(request))

  const repo = new WeightRepo(env.DB, me.id)
  await repo.put(pesee.day, pesee.weightKg)

  // La cible se recalcule du poids : le profil doit suivre la derniere pesee.
  const profil = new ProfileRepo(env.DB, me.id, me.householdId)
  const actuel = await profil.get()
  await profil.save({ ...actuel.profile, weightKg: pesee.weightKg }, actuel.eaters)

  return json({ weighIns: await repo.since(new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10)) })
})

route('DELETE', '/api/weight/:day', async ({ env, user, params }) => {
  const me = requireUser(user)
  const day = parseOrThrow(jourSchema, params['day'])
  const repo = new WeightRepo(env.DB, me.id)
  await repo.remove(day)
  return json({ weighIns: await repo.since(new Date(Date.now() - 730 * 86_400_000).toISOString().slice(0, 10)) })
})
