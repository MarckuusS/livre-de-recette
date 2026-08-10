#!/usr/bin/env node
/**
 * Eprouve les routes d'ecriture de l'API contre un Worker LOCAL.
 *
 * Le but n'est pas de remplacer des tests unitaires mais de repondre a une
 * question simple, et bien plus souvent negligee : est-ce que ce code a deja
 * tourne une seule fois ? Il a deja paye — c'est lui qui a revele que la regle
 * XOR du calendrier avait disparu de la validation, et que supprimer un releve
 * de prix laissait la fiche afficher un montant que l'historique ne justifiait
 * plus.
 *
 * ---------------------------------------------------------------------------
 * NE JAMAIS LE LANCER SUR LA PRODUCTION. Il CREE et SUPPRIME des lignes.
 * ---------------------------------------------------------------------------
 *
 * Mise en place :
 *
 *   1. appliquer les migrations en local
 *        npm run db:migrate:local
 *   2. creer un compte de test (le mot de passe reste sur cette machine)
 *        node scripts/add-user.mjs smoketest "Test local" --local
 *   3. demarrer le Worker
 *        npx wrangler pages dev --port 8787
 *   4. lancer ce script
 *        SMOKE_USER=smoketest SMOKE_PASSWORD=... node scripts/smoke-api.mjs
 *
 * Aucun identifiant n'est ecrit ici : le depot est public.
 */

const BASE = process.env['SMOKE_BASE'] ?? 'http://127.0.0.1:8787'
const CREDS = {
  username: process.env['SMOKE_USER'] ?? '',
  password: process.env['SMOKE_PASSWORD'] ?? '',
}

if (!CREDS.username || !CREDS.password) {
  console.error(
    'Renseigne SMOKE_USER et SMOKE_PASSWORD.\n' +
      'Cree le compte au prealable : node scripts/add-user.mjs smoketest "Test local" --local',
  )
  process.exit(2)
}

// Garde-fou : ce script ecrit et supprime. Une faute de frappe sur SMOKE_BASE
// ne doit pas pouvoir toucher la production.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error(`SMOKE_BASE doit viser la machine locale. Reçu : ${BASE}`)
  process.exit(2)
}

let cookie = ''
let pass = 0
let fail = 0
const failures = []

async function call(method, path, body, extraHeaders) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...(extraHeaders ?? {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { _raw: text.slice(0, 200) }
  }
  return { status: res.status, body: json }
}

function check(label, condition, detail) {
  if (condition) {
    pass++
    console.log(`  ok   ${label}`)
  } else {
    fail++
    failures.push(label)
    console.log(`  FAIL ${label}${detail ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`)
  }
}

const section = (t) => console.log(`\n=== ${t} ===`)

// ---------------------------------------------------------------------------

const login = await call('POST', '/api/login', CREDS)
if (login.status !== 200) {
  console.error('Connexion impossible :', login.status, login.body)
  process.exit(1)
}

let ingredientId = null
let recipeId = null
let entryId = null
let stockId = null
let tagId = null
const WEEK = '2099-W01' // semaine bidon : n'interfere avec aucune donnee reelle

try {
  // ------------------------------------------------------------- ingredients
  section('Ingredients — creation, modification, doublon')

  const created = await call('POST', '/api/ingredients', {
    name: 'Ingrédient de test œuf/ligature',
    kcal: 150,
    proteins: 12.5,
    carbs: 1,
    fats: 10,
    pieceWeightG: 60,
    categoryL1: 'Test',
  })
  check('POST /api/ingredients -> 201', created.status === 201, created.body)
  ingredientId = created.body?.id ?? null
  check('id attribue', typeof ingredientId === 'number', created.body)
  check('inLibrary force a true', created.body?.inLibrary === true, created.body)
  check('source par defaut = manual', created.body?.source === 'manual', created.body)

  const dup = await call('POST', '/api/ingredients', { name: 'ingredient de test oeuf/ligature' })
  check('doublon (ligature + accents replies) -> 409', dup.status === 409, dup.body)
  check('  code duplicate_name', dup.body?.error?.code === 'duplicate_name', dup.body)

  const invalid = await call('POST', '/api/ingredients', { name: '   ', kcal: -5 })
  check('nom vide + macro negative -> 422', invalid.status === 422, invalid.body)

  const patched = await call('PATCH', `/api/ingredients/${ingredientId}`, { brand: 'Marque test' })
  check('PATCH partiel -> 200', patched.status === 200, patched.body)
  check('  marque posee', patched.body?.brand === 'Marque test', patched.body)
  check('  kcal PRESERVE (cle absente)', patched.body?.kcal === 150, patched.body)

  const erased = await call('PATCH', `/api/ingredients/${ingredientId}`, { brand: null })
  check('PATCH avec null -> efface', erased.body?.brand === null, erased.body)

  // recherche : la ligature doit etre trouvee par "oeuf"
  const found = await call('GET', '/api/ingredients?q=oeuf')
  check(
    'recherche « oeuf » trouve « œuf »',
    (found.body?.items ?? []).some((i) => i.id === ingredientId),
    { total: found.body?.totalCount },
  )

  // --------------------------------------------------------------------- prix
  section('Prix — observation et cache denormalise')

  const price = await call('POST', `/api/ingredients/${ingredientId}/prices`, {
    priceEur: '3.4900',
    quantityG: 500,
    store: 'Intermarché',
    recordedAt: '2026-07-01',
    notes: null,
  })
  check('POST prix -> 201', price.status === 201, price.body)
  check('  cache ingredient a jour', price.body?.ingredient?.priceEur === '3.4900', price.body?.ingredient)

  const older = await call('POST', `/api/ingredients/${ingredientId}/prices`, {
    priceEur: '9.9900',
    quantityG: 500,
    store: 'Ancien',
    recordedAt: '2020-01-01',
    notes: null,
  })
  check('releve ANCIEN ne fait pas reculer le prix courant', older.body?.ingredient?.priceEur === '3.4900', older.body?.ingredient)
  check('  historique = 2 lignes', (older.body?.items ?? []).length === 2, older.body?.items?.length)

  const badPrice = await call('POST', `/api/ingredients/${ingredientId}/prices`, {
    priceEur: '0',
    quantityG: 500,
    recordedAt: '2026-07-01',
  })
  check('prix nul -> 422', badPrice.status === 422, badPrice.body)

  // Le releve le plus recent porte le prix courant : le supprimer doit faire
  // REDESCENDRE la fiche sur le releve precedent, jamais laisser un prix
  // que l'historique ne justifie plus.
  const recent = (older.body?.items ?? []).find((p) => p.recordedAt === '2026-07-01')
  const afterDelete = await call('DELETE', `/api/prices/${recent?.id}?ingredient=${ingredientId}`)
  check('suppression du dernier releve -> 200', afterDelete.status === 200, afterDelete.body)
  check(
    '  prix recalcule sur le releve restant',
    afterDelete.body?.ingredient?.priceEur === '9.9900',
    afterDelete.body?.ingredient,
  )

  const last = (afterDelete.body?.items ?? [])[0]
  const emptied2 = await call('DELETE', `/api/prices/${last?.id}?ingredient=${ingredientId}`)
  check('  historique vide -> prix efface', emptied2.body?.ingredient?.priceEur === null, emptied2.body?.ingredient)

  // On remet un prix pour que la liste de courses teste plus bas ait un cout.
  await call('POST', `/api/ingredients/${ingredientId}/prices`, {
    priceEur: '3.4900',
    quantityG: 500,
    store: 'Intermarché',
    recordedAt: '2026-07-01',
    notes: null,
  })

  const dupWithId = await call('POST', '/api/ingredients', { name: 'Ingrédient de test œuf/ligature' })
  check('409 porte l identifiant du doublon', dupWithId.body?.error?.existingId === ingredientId, dupWithId.body?.error)

  // ------------------------------------------------------------------ recettes
  section('Recettes — creation, lignes, remplacement')

  const tags = await call('GET', '/api/tags')
  tagId = tags.body?.items?.[0]?.id ?? null

  const recipe = await call('POST', '/api/recipes', {
    name: 'Recette de test',
    instructions: 'Mélanger.',
    defaultPortions: 4,
    prepTimeMin: 20,
    lines: [{ ingredientId, quantityG: 300, unit: 'g', notes: 'test' }],
    tagIds: tagId ? [tagId] : [],
  })
  check('POST /api/recipes -> 201', recipe.status === 201, recipe.body)
  recipeId = recipe.body?.id ?? null
  check('  1 ligne', (recipe.body?.lines ?? []).length === 1, recipe.body?.lines)
  check('  ligne porte l ingredient complet', recipe.body?.lines?.[0]?.ingredient?.id === ingredientId, recipe.body?.lines?.[0])
  check('  tag attache', (recipe.body?.tags ?? []).length === (tagId ? 1 : 0), recipe.body?.tags)

  const ghost = await call('POST', '/api/recipes', {
    name: 'Recette fantome',
    lines: [{ ingredientId: 999999, quantityG: 100 }],
  })
  check('ligne vers un ingredient inexistant -> 422', ghost.status === 422, ghost.body)
  check('  code unknown_ingredient', ghost.body?.error?.code === 'unknown_ingredient', ghost.body)

  const replaced = await call('PUT', `/api/recipes/${recipeId}`, {
    name: 'Recette de test renommée',
    instructions: 'Mélanger puis cuire.',
    defaultPortions: 2,
    lines: [],
    tagIds: [],
  })
  check('PUT remplace tout -> 200', replaced.status === 200, replaced.body)
  check('  lignes VIDEES', (replaced.body?.lines ?? []).length === 0, replaced.body?.lines)
  check('  tags VIDES', (replaced.body?.tags ?? []).length === 0, replaced.body?.tags)
  check('  renommee', replaced.body?.name === 'Recette de test renommée', replaced.body?.name)

  // --- ecriture concurrente -------------------------------------------------
  // Simule deux appareils : celui-ci a charge la recette AVANT le PUT
  // ci-dessus, il tient donc un `updatedAt` perime. Sans ce controle, son
  // enregistrement ecrasait l'autre sans un mot, ce qui est exactement le
  // scenario que le passage en foyer partage rend quotidien.
  const staleBody = {
    name: 'Version concurrente',
    instructions: '',
    defaultPortions: 2,
    lines: [],
    tagIds: [],
  }
  const stale = await call('PUT', `/api/recipes/${recipeId}`, staleBody, {
    'if-match': '2000-01-01T00:00:00Z',
  })
  check('PUT avec un If-Match perime -> 409', stale.status === 409, stale.body)
  check('  code stale_recipe', stale.body?.error?.code === 'stale_recipe', stale.body?.error)
  check(
    '  la recette n a PAS ete ecrasee',
    (await call('GET', `/api/recipes/${recipeId}`)).body?.name === 'Recette de test renommée',
  )

  const fresh = await call('GET', `/api/recipes/${recipeId}`)
  const onTime = await call('PUT', `/api/recipes/${recipeId}`, staleBody, {
    'if-match': fresh.body?.updatedAt,
  })
  check('PUT avec le bon If-Match -> 200', onTime.status === 200, onTime.body)

  // Sans en-tete, l'ecriture reste inconditionnelle : c'est la semantique HTTP
  // de If-Match, et ce script comme un futur client s'en passent.
  const unconditional = await call('PUT', `/api/recipes/${recipeId}`, {
    ...staleBody,
    name: 'Recette de test renommée',
  })
  check('PUT sans If-Match reste accepte -> 200', unconditional.status === 200, unconditional.body)

  // ingredient utilise par une recette : suppression refusee
  await call('PUT', `/api/recipes/${recipeId}`, {
    name: 'Recette de test renommée',
    instructions: '',
    defaultPortions: 2,
    lines: [{ ingredientId, quantityG: 100 }],
    tagIds: [],
  })
  const blocked = await call('DELETE', `/api/ingredients/${ingredientId}`)
  check('supprimer un ingredient utilise -> 409', blocked.status === 409, blocked.body)
  check('  message nomme la recette', String(blocked.body?.error?.message ?? '').includes('Recette de test'), blocked.body?.error)

  // ------------------------------------------------------------- cuisson
  section('Journal de cuisson')

  const cooked = await call('POST', `/api/recipes/${recipeId}/cooking`, {
    cookedAt: new Date().toISOString().slice(0, 10),
    rating: 4,
    notes: 'Bon',
  })
  check('POST cuisson -> 201', cooked.status === 201, cooked.body)

  const listAfterCook = await call('GET', '/api/recipes')
  const mine = (listAfterCook.body?.items ?? []).find((r) => r.id === recipeId)
  check('compteur 30 jours = 1', mine?.cookCount30d === 1, mine)
  check('derniere cuisson renseignee', typeof mine?.lastCookedAt === 'string', mine)

  const badRating = await call('POST', `/api/recipes/${recipeId}/cooking`, {
    cookedAt: '2026-07-01',
    rating: 9,
  })
  check('note hors 1-5 -> 422', badRating.status === 422, badRating.body)

  // ------------------------------------------------------------- calendrier
  section('Calendrier — XOR, ordinal, deplacement')

  const addRecipe = await call('POST', `/api/calendar/${WEEK}/entries`, {
    dayOfWeek: 1,
    slot: 'noon',
    recipeId,
    ingredientId: null,
    portions: 2,
    quantityG: null,
  })
  check('POST entree recette -> 201', addRecipe.status === 201, addRecipe.body)
  check('  semaine rendue complete', addRecipe.body?.isoWeek === WEEK, addRecipe.body?.isoWeek)
  entryId = addRecipe.body?.entries?.[0]?.id ?? null
  check('  ordinal attribue a 0', addRecipe.body?.entries?.[0]?.ordinal === 0, addRecipe.body?.entries?.[0])

  const xor = await call('POST', `/api/calendar/${WEEK}/entries`, {
    dayOfWeek: 1,
    slot: 'noon',
    recipeId,
    ingredientId,
    portions: 1,
    quantityG: 100,
  })
  check('recette ET ingredient -> 422 (XOR)', xor.status === 422, xor.body)

  const xor2 = await call('POST', `/api/calendar/${WEEK}/entries`, {
    dayOfWeek: 1,
    slot: 'noon',
    recipeId,
    ingredientId: null,
    portions: null,
    quantityG: 250,
  })
  check('recette avec des GRAMMES -> 422', xor2.status === 422, xor2.body)

  const addIng = await call('POST', `/api/calendar/${WEEK}/entries`, {
    dayOfWeek: 1,
    slot: 'noon',
    recipeId: null,
    ingredientId,
    portions: null,
    quantityG: 250,
  })
  check('POST entree ingredient -> 201', addIng.status === 201, addIng.body)
  const second = (addIng.body?.entries ?? []).find((e) => e.ingredientId === ingredientId)
  check('  ordinal incremente a 1', second?.ordinal === 1, addIng.body?.entries)

  const amount = await call('PATCH', `/api/calendar/entries/${entryId}`, { portions: 3, quantityG: null })
  check('PATCH portions -> 200', amount.status === 200, amount.body)
  check('  portions a 3', (amount.body?.entries ?? []).find((e) => e.id === entryId)?.portions === 3, amount.body?.entries)

  const wrongAmount = await call('PATCH', `/api/calendar/entries/${entryId}`, { quantityG: 500, portions: null })
  check('regler une recette en GRAMMES -> 422', wrongAmount.status === 422, wrongAmount.body)

  const moved = await call('PUT', `/api/calendar/entries/${entryId}/move`, { dayOfWeek: 4, slot: 'evening' })
  check('PUT deplacement -> 200', moved.status === 200, moved.body)
  const movedEntry = (moved.body?.entries ?? []).find((e) => e.id === entryId)
  check('  jour et creneau changes', movedEntry?.dayOfWeek === 4 && movedEntry?.slot === 'evening', movedEntry)

  const copy = await call('POST', `/api/calendar/2099-W02/copy-from`, { from: WEEK })
  check('copie de semaine -> 201', copy.status === 201, copy.body)
  check('  2 entrees copiees', (copy.body?.entries ?? []).length === 2, copy.body?.entries?.length)

  const recopy = await call('POST', `/api/calendar/2099-W02/copy-from`, { from: WEEK })
  check('recopier NE DOUBLE PAS', (recopy.body?.entries ?? []).length === 2, recopy.body?.entries?.length)

  const badWeek = await call('GET', '/api/calendar/2026-18')
  check('semaine mal formee -> 400', badWeek.status === 400, badWeek.body)

  // ------------------------------------------------------------------ frigo
  section('Frigo — lots, consommation partielle')

  const stock = await call('POST', '/api/pantry', {
    ingredientId,
    quantityG: 500,
    expiryDate: '2026-08-10',
    notes: 'lot test',
  })
  check('POST lot -> 201', stock.status === 201, stock.body)
  stockId = (stock.body?.items ?? []).find((s) => s.notes === 'lot test')?.id ?? null
  check('  id du lot', typeof stockId === 'number', stock.body?.items)

  const consumed = await call('POST', `/api/pantry/${stockId}/consume`, { quantityG: 200 })
  check('consommer 200 g -> 200', consumed.status === 200, consumed.body)
  check('  reste 300 g', consumed.body?.remainingG === 300, consumed.body)
  check('  lot conserve', consumed.body?.removed === false, consumed.body)

  const emptied = await call('POST', `/api/pantry/${stockId}/consume`, { quantityG: 999 })
  check('consommer au-dela -> lot supprime', emptied.body?.removed === true, emptied.body)
  check('  plus dans la liste', !(emptied.body?.items ?? []).some((s) => s.id === stockId), emptied.body?.items)
  stockId = null

  const badConsume = await call('POST', '/api/pantry/999999/consume', { quantityG: 10 })
  check('consommer un lot inexistant -> 404', badConsume.status === 404, badConsume.body)

  // --------------------------------------------------------------- courses
  section('Liste de courses et archivage')

  const shopping = await call('GET', `/api/shopping/${WEEK}`)
  check('GET liste -> 200', shopping.status === 200, shopping.body)
  check('  au moins 1 article', (shopping.body?.items ?? []).length >= 1, shopping.body?.items?.length)
  check('  total est une CHAINE', typeof shopping.body?.totalEur === 'string', shopping.body?.totalEur)

  const snap = await call('POST', `/api/shopping/${WEEK}/snapshot`, {})
  check('archivage du cout -> 201', snap.status === 201, snap.body)
  check(
    '  horodatage rendu au bon format',
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(snap.body?.capturedAt)),
    snap.body,
  )

  const history = await call('GET', '/api/shopping-history')
  check(
    '  present dans l historique',
    (history.body?.items ?? []).some((h) => h.isoWeek === WEEK),
    history.body?.items,
  )

  // -------------------------------------------------------------- routeur
  section('Routeur et journal')

  const notFound = await call('GET', '/api/nawak')
  check('adresse inconnue -> 404', notFound.status === 404, notFound.body)

  const wrongMethod = await call('DELETE', '/api/tags')
  check('mauvais verbe sur une adresse connue -> 405', wrongMethod.status === 405, wrongMethod.body)

  const badId = await call('GET', '/api/ingredients/abc')
  check('identifiant non numerique -> 400', badId.status === 400, badId.body)

  const activity = await call('GET', '/api/activity?limit=100')
  const labels = (activity.body?.items ?? []).map((a) => a.label)
  check('journal alimente', labels.length > 5, labels.length)
  // Le journal contient l'historique reel de la base : on verifie seulement
  // que les lignes ECRITES PENDANT CE TEST portent bien leur auteur.
  const mineInLog = (activity.body?.items ?? []).filter((a) => a.userId === login.body.user.id)
  check('  lignes attribuees a l auteur', mineInLog.length > 5, mineInLog.length)
  check(
    '  nom affiche resolu',
    mineInLog.every((a) => a.displayName === 'Test local'),
    mineInLog[0],
  )
  check(
    '  details JSON presents',
    (activity.body?.items ?? []).some((a) => a.details && a.details !== 'null'),
    activity.body?.items?.[0],
  )
} finally {
  // ------------------------------------------------------------- nettoyage
  section('Nettoyage')

  await call('DELETE', `/api/calendar/${WEEK}`)
  await call('DELETE', '/api/calendar/2099-W02')
  if (stockId) await call('DELETE', `/api/pantry/${stockId}`)
  if (recipeId) await call('DELETE', `/api/recipes/${recipeId}`)
  if (ingredientId) {
    const gone = await call('DELETE', `/api/ingredients/${ingredientId}`)
    check('ingredient manuel DETRUIT (pas juste retire)', gone.body?.removed === 'permanent', gone.body)
  }

  // Une fiche CIQUAL doit sortir de la bibliotheque, jamais disparaitre.
  const ciqual = await call('GET', '/api/catalog?q=carotte&source=ciqual&limit=1')
  const cid = ciqual.body?.items?.[0]?.id
  if (cid) {
    const wasInLibrary = ciqual.body.items[0].inLibrary
    await call('PUT', `/api/ingredients/${cid}/library`)
    const out = await call('DELETE', `/api/ingredients/${cid}`)
    check('fiche CIQUAL : retiree de la bibliotheque, pas detruite', out.body?.removed === 'library', out.body)
    const still = await call('GET', `/api/ingredients/${cid}`)
    check('  la fiche existe toujours', still.status === 200, still.status)
    if (wasInLibrary) await call('PUT', `/api/ingredients/${cid}/library`)
  }

  console.log(`\n${'='.repeat(50)}`)
  console.log(`${pass} verifications OK, ${fail} en echec`)
  if (fail > 0) console.log('Echecs :\n  - ' + failures.join('\n  - '))
  process.exit(fail > 0 ? 1 : 0)
}
