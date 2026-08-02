#!/usr/bin/env node
/**
 * Eprouve la session de courses de bout en bout, contre le Worker LOCAL.
 *
 * Le scenario est celui du magasin : on ouvre, on scanne un produit connu et un
 * produit inconnu, on corrige, on retire, puis on valide — et on verifie que
 * TOUT a atterri au bon endroit. C'est la seule facon de savoir si la
 * validation fait vraiment ses cinq etapes.
 */

const BASE = process.env['SMOKE_BASE'] ?? 'http://127.0.0.1:8787'
const CREDS = {
  username: process.env['SMOKE_USER'] ?? '',
  password: process.env['SMOKE_PASSWORD'] ?? '',
}
/** Semaine bidon : la session y coche des lignes, on ne touche a rien de reel. */
const WEEK = '2097-W01'

if (!CREDS.username || !CREDS.password) {
  console.error(
    'Renseigne SMOKE_USER et SMOKE_PASSWORD.\n' +
      'Cree le compte au prealable : node scripts/add-user.mjs smoketest "Test local" --local',
  )
  process.exit(2)
}

// Garde-fou : ce script cree des fiches, des lots et des prix. Une faute de
// frappe sur SMOKE_BASE ne doit pas pouvoir toucher la production.
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error(`SMOKE_BASE doit viser la machine locale. Reçu : ${BASE}`)
  process.exit(2)
}

let cookie = ''
let pass = 0
let fail = 0
const failures = []

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) cookie = setCookie.split(';')[0]
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = { _raw: text.slice(0, 200) } }
  return { status: res.status, body: json }
}

function check(label, condition, detail) {
  if (condition) { pass++; console.log(`  ok   ${label}`) }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${detail ? ` -> ${JSON.stringify(detail).slice(0, 260)}` : ''}`) }
}
const section = (t) => console.log(`\n=== ${t} ===`)

const login = await call('POST', '/api/login', CREDS)
if (login.status !== 200) { console.error('connexion impossible'); process.exit(1) }

let createdIngredientIds = []
let pantryBefore = 0

try {
  // On part propre.
  await call('DELETE', '/api/courses')

  section('Ouverture')

  const none = await call('GET', '/api/courses')
  check('aucune session au depart', none.body?.active === false, none.body)

  const started = await call('POST', '/api/courses', { store: 'Intermarché Vaise', isoWeek: WEEK })
  check('POST ouverture -> 201', started.status === 201, started.body)
  check('  magasin retenu', started.body?.session?.store === 'Intermarché Vaise', started.body?.session)
  check('  chariot vide', started.body?.itemCount === 0, started.body)

  const again = await call('POST', '/api/courses', { store: 'Autre', isoWeek: WEEK })
  check('seconde ouverture refusee -> 409', again.status === 409, again.body)
  check('  le magasin en cours est nomme', again.body?.error?.store === 'Intermarché Vaise', again.body?.error)

  const noStore = await call('POST', '/api/courses/items', { name: 'x', quantityG: 0 })
  check('quantite nulle refusee -> 422', noStore.status === 422, noStore.body)

  section('Le chariot se remplit')

  // Un produit DEJA en bibliotheque : on connait son identifiant.
  const library = await call('GET', '/api/ingredients')
  const known = library.body.items.find((i) => i.priceEur)
  const addKnown = await call('POST', '/api/courses/items', {
    ean: null,
    name: known.name,
    brand: null,
    quantityG: 500,
    priceEur: '2.4000',
    ingredientId: known.id,
    macros: null,
    pieceWeightG: null,
  })
  check('article connu ajoute -> 201', addKnown.status === 201, addKnown.body)
  check('  correspondance signalee', (addKnown.body?.matchedIngredientIds ?? []).includes(known.id), addKnown.body)

  // Un produit INCONNU, scanne : il faudra creer sa fiche a la validation.
  const addNew = await call('POST', '/api/courses/items', {
    ean: '1234567890128',
    name: 'Produit de test session',
    brand: 'Marque test',
    quantityG: 250,
    priceEur: '1.9900',
    ingredientId: null,
    macros: { kcal: 120, proteins: 8 },
    pieceWeightG: 250,
  })
  check('article inconnu ajoute', addNew.status === 201, addNew.body)
  check('  2 articles', addNew.body?.itemCount === 2, addNew.body)
  check('  total cumule', addNew.body?.totalEur === '4.39', addNew.body?.totalEur)

  // Un article sans prix : il compte, mais pas dans le total.
  const noPrice = await call('POST', '/api/courses/items', {
    ean: null, name: 'Vrac sans prix', brand: null, quantityG: 300,
    priceEur: null, ingredientId: null, macros: null, pieceWeightG: null,
  })
  check('article sans prix accepte', noPrice.status === 201, noPrice.body)
  check('  total inchange', noPrice.body?.totalEur === '4.39', noPrice.body?.totalEur)
  check('  3 articles', noPrice.body?.itemCount === 3, noPrice.body)

  section('Corriger et retirer')

  const target = noPrice.body.session.items[1]
  const edited = await call('PUT', `/api/courses/items/${target.id}`, {
    ean: target.ean, name: 'Produit de test corrigé', brand: target.brand,
    quantityG: 400, priceEur: '2.5000', ingredientId: null,
    macros: target.macros, pieceWeightG: target.pieceWeightG,
  })
  check('PUT correction -> 200', edited.status === 200, edited.body)
  const fixed = edited.body.session.items.find((i) => i.id === target.id)
  check('  nom et quantite corriges', fixed?.name === 'Produit de test corrigé' && fixed?.quantityG === 400, fixed)
  check('  total recalcule', edited.body?.totalEur === '4.90', edited.body?.totalEur)

  const junk = noPrice.body.session.items[2]
  const removed = await call('DELETE', `/api/courses/items/${junk.id}`)
  check('DELETE article -> 200', removed.status === 200, removed.body)
  check('  2 articles restants', removed.body?.itemCount === 2, removed.body)

  const ghost = await call('DELETE', '/api/courses/items/nexistepas')
  check('retirer un article inconnu ne casse rien', ghost.status === 200, ghost.body)

  section('La survie au rechargement')

  const reloaded = await call('GET', '/api/courses')
  check('la session est retrouvee telle quelle', reloaded.body?.itemCount === 2, reloaded.body)
  check('  magasin conserve', reloaded.body?.session?.store === 'Intermarché Vaise', reloaded.body?.session)

  section('Validation')

  const pantryB = await call('GET', '/api/pantry')
  pantryBefore = pantryB.body.items.length

  const commit = await call('POST', '/api/courses/commit')
  check('POST validation -> 200', commit.status === 200, commit.body)
  // Pas d'egalite stricte sur `createdCount` : au second passage la fiche
  // existe deja au catalogue et l'API la REUTILISE au lieu d'en creer une
  // seconde — c'est justement le comportement voulu, et retirer une fiche
  // OpenFoodFacts ne fait que la sortir de la bibliotheque. Ce qui compte est
  // verifie plus bas : la fiche est la, en bibliotheque, avec ses donnees.
  check('  au plus 1 fiche creee', (commit.body?.createdCount ?? 0) <= 1, commit.body)
  check('  2 lots poses', commit.body?.stockedCount === 2, commit.body)
  check('  2 prix releves', commit.body?.pricedCount === 2, commit.body)
  check('  session close', commit.body?.active === false, commit.body)

  const after = await call('GET', '/api/courses')
  check('plus de session en cours', after.body?.active === false, after.body)

  const pantryA = await call('GET', '/api/pantry')
  check('le frigo a grossi de 2', pantryA.body.items.length === pantryBefore + 2, {
    avant: pantryBefore, apres: pantryA.body.items.length,
  })
  const lot = pantryA.body.items.find((s) => (s.notes ?? '').includes('Intermarché Vaise'))
  check('  le lot porte le magasin', lot !== undefined, pantryA.body.items.slice(0, 2))

  const lib = await call('GET', '/api/ingredients?q=corrigé')
  const fresh = lib.body.items[0]
  check('la fiche du produit inconnu existe', fresh !== undefined, lib.body)
  check('  entree en bibliotheque', fresh?.inLibrary === true, fresh)
  check('  code-barres conserve', fresh?.sourceRef === '1234567890128', fresh)
  check('  macros reprises', fresh?.kcal === 120 && fresh?.proteins === 8, fresh)
  check('  prix pose depuis la session', fresh?.priceEur === '2.5000', fresh)
  if (fresh?.id) createdIngredientIds.push(fresh.id)

  const prices = await call('GET', `/api/ingredients/${known.id}/prices`)
  const fromSession = (prices.body.items ?? []).find((p) => p.store === 'Intermarché Vaise')
  check('le prix porte le magasin de la session', fromSession !== undefined, prices.body?.items?.slice(0, 2))

  const checkedList = await call('GET', `/api/shopping/${WEEK}`)
  check(
    'la ligne achetee est cochee',
    (checkedList.body?.checkedIngredientIds ?? []).includes(known.id),
    checkedList.body?.checkedIngredientIds,
  )

  section('Garde-fous')

  const emptyCommit = await call('POST', '/api/courses/commit')
  check('valider sans session -> 404', emptyCommit.status === 404, emptyCommit.body)

  await call('POST', '/api/courses', { store: 'Test vide', isoWeek: WEEK })
  const commitEmpty = await call('POST', '/api/courses/commit')
  check('valider un chariot vide -> 422', commitEmpty.status === 422, commitEmpty.body)
  await call('DELETE', '/api/courses')

  const badWeek = await call('POST', '/api/courses', { store: 'X', isoWeek: '2026-18' })
  check('semaine mal formee -> 422', badWeek.status === 422, badWeek.body)

  const noName = await call('POST', '/api/courses', { store: '   ', isoWeek: WEEK })
  check('magasin vide -> 422', noName.status === 422, noName.body)
} finally {
  section('Nettoyage')
  await call('DELETE', '/api/courses')
  for (const id of createdIngredientIds) await call('DELETE', `/api/ingredients/${id}`)
  const pantry = await call('GET', '/api/pantry')
  for (const s of pantry.body?.items ?? []) {
    if ((s.notes ?? '').includes('Intermarché Vaise')) await call('DELETE', `/api/pantry/${s.id}`)
  }
  await call('PUT', `/api/shopping/${WEEK}/checked`, { ingredientIds: [] })
  console.log('  session, lots et fiches de test retires')

  console.log(`\n${'='.repeat(50)}`)
  console.log(`${pass} verifications OK, ${fail} en echec`)
  if (fail > 0) console.log('Echecs :\n  - ' + failures.join('\n  - '))
  process.exit(fail > 0 ? 1 : 0)
}
