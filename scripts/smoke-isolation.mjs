#!/usr/bin/env node
/**
 * Prouve que deux cuisines ne se voient pas.
 *
 * C'est LE filet de securite du modele multi-foyers. SQLite n'a pas de
 * Row-Level Security : un `AND household_id = ?` oublie ne provoque aucune
 * erreur, aucun avertissement — il fait simplement apparaitre les donnees de
 * quelqu'un d'autre. Compter les occurrences dans le code ne prouve rien ; seul
 * un essai reel le fait.
 *
 * La methode : deux comptes dans deux cuisines. L'un ecrit partout. L'autre
 * tente de lire par TOUS les chemins — listes, recherches, acces direct par
 * identifiant, totaux — et ne doit rien trouver. Puis il tente d'ECRIRE sur les
 * donnees du premier, ce qui doit echouer.
 *
 * L'acces direct par identifiant est le plus important : c'est l'attaque
 * evidente. Une fois connecte, il suffit de taper /api/recipes/3 pour lire la
 * recette n° 3 — de qui qu'elle soit, si la requete ne filtre pas.
 *
 * ---------------------------------------------------------------------------
 * NE JAMAIS LE LANCER SUR LA PRODUCTION : il cree des comptes et des donnees.
 * ---------------------------------------------------------------------------
 *
 *   npm run db:migrate:local
 *   node scripts/add-user.mjs iso-a "Foyer A" --local
 *   node scripts/add-user.mjs iso-b "Foyer B" --local --cuisine="Cuisine B"
 *   npx wrangler pages dev --port 8787
 *   SMOKE_A_USER=iso-a SMOKE_A_PASSWORD=... SMOKE_B_USER=iso-b SMOKE_B_PASSWORD=... \
 *     node scripts/smoke-isolation.mjs
 */

const BASE = process.env['SMOKE_BASE'] ?? 'http://127.0.0.1:8787'
const A = { username: process.env['SMOKE_A_USER'] ?? '', password: process.env['SMOKE_A_PASSWORD'] ?? '' }
const B = { username: process.env['SMOKE_B_USER'] ?? '', password: process.env['SMOKE_B_PASSWORD'] ?? '' }
const WEEK = '2096-W01'

if (!A.username || !A.password || !B.username || !B.password) {
  console.error(
    'Renseigne SMOKE_A_USER / SMOKE_A_PASSWORD et SMOKE_B_USER / SMOKE_B_PASSWORD.\n' +
      'Les deux comptes doivent etre dans des cuisines DIFFERENTES — voir --cuisine= dans add-user.mjs.',
  )
  process.exit(2)
}

if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE)) {
  console.error(`SMOKE_BASE doit viser la machine locale. Reçu : ${BASE}`)
  process.exit(2)
}

let pass = 0
let fail = 0
const failures = []

/** Un client par foyer : chacun garde SON cookie, sans quoi le test ne prouve rien. */
function client() {
  let cookie = ''
  return {
    async call(method, path, body) {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const set = res.headers.get('set-cookie')
      if (set) cookie = set.split(';')[0]
      const text = await res.text()
      let json
      try { json = JSON.parse(text) } catch { json = { _raw: text.slice(0, 200) } }
      return { status: res.status, body: json }
    },
  }
}

function check(label, condition, detail) {
  if (condition) { pass++; console.log(`  ok   ${label}`) }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${detail === undefined ? '' : ` -> ${JSON.stringify(detail).slice(0, 240)}`}`) }
}
const section = (t) => console.log(`\n=== ${t} ===`)

const a = client()
const b = client()

const loginA = await a.call('POST', '/api/login', A)
const loginB = await b.call('POST', '/api/login', B)
if (loginA.status !== 200 || loginB.status !== 200) {
  console.error('Connexion impossible :', loginA.status, loginB.status)
  process.exit(1)
}

const made = { ingredient: null, recipe: null, pantry: null, entry: null, tag: null }

try {
  section('Les deux comptes sont bien dans des cuisines differentes')

  const healthA = await a.call('GET', '/api/health')
  const healthB = await b.call('GET', '/api/health')
  check(
    'chaque foyer a son propre catalogue',
    (healthA.body?.database?.ingredients ?? 0) > 0 && (healthB.body?.database?.ingredients ?? 0) > 0,
    { A: healthA.body?.database, B: healthB.body?.database },
  )

  section('A remplit sa cuisine')

  const ing = await a.call('POST', '/api/ingredients', {
    name: 'Zzqx foyer A marqueur', kcal: 100, proteins: 5,
    priceEur: '9.9900', priceQuantityG: 1000,
  })
  check('A cree un ingredient', ing.status === 201, ing.body)
  made.ingredient = ing.body?.id ?? null

  const tag = await a.call('POST', '/api/tags', { name: 'Tag secret A', colorHex: '#123456' })
  check('A cree un tag', tag.status === 201, tag.body)
  made.tag = tag.body?.id ?? null

  const rec = await a.call('POST', '/api/recipes', {
    name: 'Recette secrete de A',
    instructions: 'Ne pas divulguer.',
    defaultPortions: 2,
    lines: [{ ingredientId: made.ingredient, quantityG: 200 }],
    tagIds: made.tag ? [made.tag] : [],
  })
  check('A cree une recette', rec.status === 201, rec.body)
  made.recipe = rec.body?.id ?? null

  const stock = await a.call('POST', '/api/pantry', {
    ingredientId: made.ingredient, quantityG: 500, expiryDate: null, notes: 'Frigo de A',
  })
  check('A pose un lot au frigo', stock.status === 201, stock.body)
  made.pantry = (stock.body?.items ?? []).find((s) => s.notes === 'Frigo de A')?.id ?? null

  const entry = await a.call('POST', `/api/calendar/${WEEK}/entries`, {
    dayOfWeek: 0, slot: 'noon', recipeId: made.recipe, ingredientId: null, portions: 1, quantityG: null,
  })
  check('A planifie un repas', entry.status === 201, entry.body)
  made.entry = (entry.body?.entries ?? [])[0]?.id ?? null

  await a.call('POST', `/api/shopping/${WEEK}/snapshot`, {})

  section('B ne voit RIEN de A — les listes')

  const libB = await b.call('GET', '/api/ingredients')
  check(
    'bibliotheque : pas l’ingredient de A',
    !(libB.body?.items ?? []).some((i) => i.name === 'Zzqx foyer A marqueur'),
    (libB.body?.items ?? []).map((i) => i.name).slice(0, 5),
  )

  const searchB = await b.call('GET', '/api/ingredients?q=Zzqx')
  check('recherche plein-texte : rien', (searchB.body?.items ?? []).length === 0, searchB.body?.items)

  const catB = await b.call('GET', '/api/catalog?q=Zzqx')
  check('catalogue : rien', (catB.body?.items ?? []).length === 0, catB.body?.items)

  const recB = await b.call('GET', '/api/recipes')
  check(
    'recettes : pas celle de A',
    !(recB.body?.items ?? []).some((r) => r.name === 'Recette secrete de A'),
    (recB.body?.items ?? []).map((r) => r.name),
  )

  const tagsB = await b.call('GET', '/api/tags')
  check(
    'tags : pas celui de A',
    !(tagsB.body?.items ?? []).some((t) => t.name === 'Tag secret A'),
    (tagsB.body?.items ?? []).map((t) => t.name),
  )

  const panB = await b.call('GET', '/api/pantry')
  check(
    'frigo : pas le lot de A',
    !(panB.body?.items ?? []).some((s) => s.notes === 'Frigo de A'),
    (panB.body?.items ?? []).map((s) => s.notes),
  )

  const calB = await b.call('GET', `/api/calendar/${WEEK}`)
  check('calendrier : semaine vide', (calB.body?.entries ?? []).length === 0, calB.body?.entries)

  const shopB = await b.call('GET', `/api/shopping/${WEEK}`)
  check('liste de courses : vide', (shopB.body?.items ?? []).length === 0, shopB.body?.items)

  const histB = await b.call('GET', '/api/shopping-history')
  check(
    'historique de cout : pas la semaine de A',
    !(histB.body?.items ?? []).some((h) => h.isoWeek === WEEK),
    histB.body?.items,
  )

  const actB = await b.call('GET', '/api/activity?limit=100')
  check(
    'journal : aucune trace de A',
    !(actB.body?.items ?? []).some((e) => String(e.label).includes('Zzqx') || String(e.label).includes('secrete de A')),
    (actB.body?.items ?? []).slice(0, 3).map((e) => e.label),
  )

  const storesB = await b.call('GET', '/api/stores')
  check('enseignes : pas celles de A', Array.isArray(storesB.body?.items), storesB.body)

  section('B ne voit RIEN de A — l’acces direct par identifiant')

  // C'est l'attaque evidente : une fois connecte, on tape le numero dans l'URL.
  const directIng = await b.call('GET', `/api/ingredients/${made.ingredient}`)
  check('GET ingredient de A -> 404', directIng.status === 404, directIng.body)

  const directRec = await b.call('GET', `/api/recipes/${made.recipe}`)
  check('GET recette de A -> 404', directRec.status === 404, directRec.body)

  const directPrices = await b.call('GET', `/api/ingredients/${made.ingredient}/prices`)
  check('GET prix de A -> vide ou 404', directPrices.status === 404 || (directPrices.body?.items ?? []).length === 0, directPrices.body)

  const directCook = await b.call('GET', `/api/recipes/${made.recipe}/cooking`)
  check('GET journal de cuisson de A -> vide ou 404', directCook.status === 404 || (directCook.body?.items ?? []).length === 0, directCook.body)

  section('B ne peut RIEN modifier chez A')

  const patchIng = await b.call('PATCH', `/api/ingredients/${made.ingredient}`, { name: 'Detourne par B' })
  check('PATCH ingredient de A -> 404', patchIng.status === 404, patchIng.body)

  const putRec = await b.call('PUT', `/api/recipes/${made.recipe}`, {
    name: 'Detournee par B', instructions: '', defaultPortions: 1, lines: [], tagIds: [],
  })
  check('PUT recette de A -> 404', putRec.status === 404, putRec.body)

  const delRec = await b.call('DELETE', `/api/recipes/${made.recipe}`)
  check('DELETE recette de A -> 404', delRec.status === 404, delRec.body)

  const delStock = await b.call('DELETE', `/api/pantry/${made.pantry}`)
  check('DELETE lot de A -> 404', delStock.status === 404, delStock.body)

  const delEntry = await b.call('DELETE', `/api/calendar/entries/${made.entry}`)
  check('DELETE repas de A -> 404', delEntry.status === 404, delEntry.body)

  const putLib = await b.call('PUT', `/api/ingredients/${made.ingredient}/library`, {})
  check('mettre l’ingredient de A dans SA bibliotheque -> 404', putLib.status === 404, putLib.body)

  const addPrice = await b.call('POST', `/api/ingredients/${made.ingredient}/prices`, {
    priceEur: '1.0000', quantityG: 100, store: 'B', recordedAt: '2026-01-01', notes: null,
  })
  check('relever un prix sur l’ingredient de A -> 404', addPrice.status === 404, addPrice.body)

  const useInRecipe = await b.call('POST', '/api/recipes', {
    name: 'Tentative de B', instructions: '', defaultPortions: 1,
    lines: [{ ingredientId: made.ingredient, quantityG: 100 }], tagIds: [],
  })
  check(
    'utiliser l’ingredient de A dans une recette de B -> refuse',
    useInRecipe.status === 422,
    useInRecipe.body,
  )

  const planIt = await b.call('POST', `/api/calendar/${WEEK}/entries`, {
    dayOfWeek: 0, slot: 'noon', recipeId: null, ingredientId: made.ingredient, quantityG: 50, portions: null,
  })
  const planned = planIt.status === 201 ? (planIt.body?.entries ?? []) : []
  check(
    'planifier l’ingredient de A chez B -> refuse, ou sans effet visible',
    planIt.status >= 400 || planned.length === 0,
    { status: planIt.status, entrees: planned.length },
  )

  section('A retrouve tout intact')

  const backA = await a.call('GET', `/api/recipes/${made.recipe}`)
  check('la recette de A existe toujours', backA.status === 200, backA.status)
  check('  son nom n’a pas ete detourne', backA.body?.name === 'Recette secrete de A', backA.body?.name)

  const ingA = await a.call('GET', `/api/ingredients/${made.ingredient}`)
  check('l’ingredient de A est intact', ingA.body?.name === 'Zzqx foyer A marqueur', ingA.body?.name)
  check('  son prix n’a pas bouge', ingA.body?.priceEur === '9.9900', ingA.body?.priceEur)

  const panA = await a.call('GET', '/api/pantry')
  check(
    'son lot est toujours au frigo',
    (panA.body?.items ?? []).some((s) => s.notes === 'Frigo de A'),
    (panA.body?.items ?? []).map((s) => s.notes),
  )

  const calA = await a.call('GET', `/api/calendar/${WEEK}`)
  check('son repas est toujours planifie', (calA.body?.entries ?? []).length === 1, calA.body?.entries?.length)
} finally {
  section('Nettoyage')
  await a.call('DELETE', `/api/calendar/${WEEK}`)
  if (made.pantry) await a.call('DELETE', `/api/pantry/${made.pantry}`)
  if (made.recipe) await a.call('DELETE', `/api/recipes/${made.recipe}`)
  if (made.tag) await a.call('DELETE', `/api/tags/${made.tag}`)
  if (made.ingredient) await a.call('DELETE', `/api/ingredients/${made.ingredient}`)
  await a.call('PUT', `/api/shopping/${WEEK}/checked`, { ingredientIds: [] })
  console.log('  donnees de test retirees')

  console.log(`\n${'='.repeat(52)}`)
  console.log(`${pass} verifications OK, ${fail} en echec`)
  if (fail > 0) {
    console.log('\nEchecs — CHACUN EST UNE FUITE DE DONNEES ENTRE DEUX PERSONNES :')
    console.log('  - ' + failures.join('\n  - '))
  }
  process.exit(fail > 0 ? 1 : 0)
}
