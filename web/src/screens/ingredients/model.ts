/**
 * Regles de presentation de la bibliotheque : tri, groupement, filtres, et la
 * traduction du formulaire vers les charges utiles de l'API.
 *
 * Tout le tri / groupement / filtrage se fait ICI, cote client, sur les 500
 * lignes que rend `GET /api/ingredients` — exactement comme le desktop triait
 * en Python apres son SELECT. L'alternative etait de porter les 18 tris, les
 * 5 groupements et les 6 filtres dans la query string du Worker : une
 * douzaine de parametres a maintenir des deux cotes, et un aller-retour reseau
 * a chaque changement de tri, pour une bibliotheque qui tient deja entierement
 * en memoire. Rejetee.
 *
 * Le module est pur : pas de React, pas de fetch. C'est ce qui permet de le
 * lire comme une specification.
 */

import {
  SOURCE_LABELS,
  SOURCES,
  isInSeasonNow,
  seasonMonths as parseSeasonMonths,
  type Ingredient,
  type Source,
} from '@livre/shared'

// ---------------------------------------------------------------------------
// Tri
// ---------------------------------------------------------------------------

/**
 * 9 criteres x 2 sens = les 18 tris du desktop.
 *
 * Le desktop les presentait comme 18 entrees d'un seul menu deroulant. Au
 * pouce, une liste de 18 lignes se rate : critere et sens sont separes, ce qui
 * ramene le choix courant a deux taps sur des cibles pleine largeur.
 */
export const SORT_FIELDS = [
  { code: 'name', label: 'Nom' },
  { code: 'kcal', label: 'Énergie' },
  { code: 'proteins', label: 'Protéines' },
  { code: 'carbs', label: 'Glucides' },
  { code: 'fats', label: 'Lipides' },
  { code: 'fiber', label: 'Fibres' },
  { code: 'salt', label: 'Sel' },
  { code: 'price', label: 'Prix' },
  { code: 'created', label: 'Ajout' },
] as const

export type SortField = (typeof SORT_FIELDS)[number]['code']

const SORT_CODES: ReadonlySet<string> = new Set(SORT_FIELDS.map((field) => field.code))

/** Libelle du sens, dependant du critere : « A → Z » n'a de sens que pour un nom. */
export function directionLabel(field: SortField, desc: boolean): string {
  if (field === 'name') return desc ? 'Z → A' : 'A → Z'
  if (field === 'created') return desc ? 'Plus récents' : 'Plus anciens'
  return desc ? 'Décroissant' : 'Croissant'
}

/** Valeur numerique triable, `null` quand la donnee est inconnue. */
function numericKey(ingredient: Ingredient, field: SortField): number | null {
  switch (field) {
    case 'kcal':
      return ingredient.kcal
    case 'proteins':
      return ingredient.proteins
    case 'carbs':
      return ingredient.carbs
    case 'fats':
      return ingredient.fats
    case 'fiber':
      return ingredient.fiber
    case 'salt':
      return ingredient.salt
    case 'price':
      return ingredient.priceEur === null ? null : Number(ingredient.priceEur)
    default:
      return null
  }
}

/**
 * Tri stable, valeurs inconnues toujours en DERNIER.
 *
 * Reprend la cle `(1, 0)` contre `(0, valeur)` du viewmodel Python : une macro
 * absente ne doit pas remonter en tete d'un tri decroissant, sans quoi
 * « trier par protéines » commence par tout ce dont on ignore les proteines.
 */
export function sortIngredients(
  items: readonly Ingredient[],
  field: SortField,
  desc: boolean,
): Ingredient[] {
  const sign = desc ? -1 : 1
  const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true })

  return [...items].sort((a, b) => {
    if (field === 'name') return sign * collator.compare(a.name, b.name)

    if (field === 'created') {
      // Les horodatages sont en ISO-8601 UTC : l'ordre lexicographique EST
      // l'ordre chronologique, pas besoin de construire deux Date.
      const left = a.createdAt ?? ''
      const right = b.createdAt ?? ''
      if (left === right) return collator.compare(a.name, b.name)
      return sign * (left < right ? -1 : 1)
    }

    const left = numericKey(a, field)
    const right = numericKey(b, field)
    if (left === null && right === null) return collator.compare(a.name, b.name)
    if (left === null) return 1
    if (right === null) return -1
    if (left === right) return collator.compare(a.name, b.name)
    return sign * (left < right ? -1 : 1)
  })
}

// ---------------------------------------------------------------------------
// Groupement
// ---------------------------------------------------------------------------

export const GROUP_MODES = [
  { code: 'none', label: 'Aucun' },
  { code: 'source', label: 'Source' },
  { code: 'rayon', label: 'Rayon' },
  { code: 'season', label: 'Saisonnalité' },
  { code: 'kcal', label: 'Tranche kcal' },
] as const

export type GroupMode = (typeof GROUP_MODES)[number]['code']

const GROUP_CODES: ReadonlySet<string> = new Set(GROUP_MODES.map((mode) => mode.code))

function kcalBucket(kcal: number | null): string {
  if (kcal === null) return 'Sans valeur kcal'
  if (kcal < 100) return '0 – 100 kcal/100 g'
  if (kcal < 300) return '100 – 300 kcal/100 g'
  if (kcal < 500) return '300 – 500 kcal/100 g'
  return '500+ kcal/100 g'
}

function groupKey(ingredient: Ingredient, mode: GroupMode, now: Date): string {
  switch (mode) {
    case 'source':
      return SOURCE_LABELS[ingredient.source]
    case 'rayon':
      return ingredient.categoryL1 ?? 'Sans rayon'
    case 'season':
      if (isInSeasonNow(ingredient, now)) return '🌱 De saison'
      return parseSeasonMonths(ingredient).length > 0 ? 'Hors saison' : 'Saisonnalité inconnue'
    case 'kcal':
      return kcalBucket(ingredient.kcal)
    default:
      return ''
  }
}

export interface IngredientSection {
  readonly key: string
  readonly items: readonly Ingredient[]
}

/**
 * Decoupe la liste DEJA triee en sections.
 *
 * Le regroupement ne retrie pas : il parcourt et rassemble, ce qui preserve
 * l'ordre choisi par l'utilisateur A L'INTERIEUR de chaque section. Un meme
 * groupe peut donc apparaitre plusieurs fois si le tri l'eclate — le desktop
 * ajoutait un tri secondaire par cle de groupe pour l'eviter ; on fait pareil,
 * mais en amont, dans `groupIngredients` lui-meme.
 */
export function groupIngredients(
  items: readonly Ingredient[],
  mode: GroupMode,
  now: Date = new Date(),
): IngredientSection[] {
  if (mode === 'none') return [{ key: '', items }]

  const buckets = new Map<string, Ingredient[]>()
  for (const item of items) {
    const key = groupKey(item, mode, now)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }

  return [...buckets.entries()]
    .map(([key, sectionItems]) => ({ key, items: sectionItems }))
    .sort((a, b) => a.key.localeCompare(b.key, 'fr'))
}

// ---------------------------------------------------------------------------
// Filtres
// ---------------------------------------------------------------------------

/**
 * Les quatre bascules rapides du desktop, plus les deux listes.
 *
 * Semantique reprise telle quelle : une bascule active n'affiche QUE les
 * ingredients qui portent la propriete — il n'existe pas de « sans marque ».
 * Une liste vide veut dire « toutes », jamais « aucune ».
 *
 * Les 12 bornes min/max sur les macros ne sont pas portees : douze champs
 * numeriques dans une feuille sont intenables au pouce, et l'inventaire les
 * classe deja en « polish ».
 */
export interface LibraryFilters {
  readonly sources: readonly Source[]
  readonly rayons: readonly string[]
  readonly inSeason: boolean
  readonly withBrand: boolean
  readonly withPieceWeight: boolean
  readonly withPrice: boolean
}

export const NO_FILTERS: LibraryFilters = {
  sources: [],
  rayons: [],
  inSeason: false,
  withBrand: false,
  withPieceWeight: false,
  withPrice: false,
}

/** Les bascules, dans l'ordre d'affichage. Le libelle sert aussi de puce. */
export const QUICK_TOGGLES = [
  { code: 'inSeason', label: '🌱 De saison' },
  { code: 'withPrice', label: '💰 Avec un prix' },
  { code: 'withPieceWeight', label: '● Poids unitaire' },
  { code: 'withBrand', label: '🏷️ Avec une marque' },
] as const

export type QuickToggle = (typeof QUICK_TOGGLES)[number]['code']

/**
 * Bascules et listes, exprimees en `switch` plutot qu'en cle calculee.
 *
 * `{ ...filters, [code]: !filters[code] }` avec une cle d'union se degrade en
 * signature d'index sous `exactOptionalPropertyTypes` : le controle de type
 * disparait exactement la ou il servirait.
 */
export function toggleQuickFilter(filters: LibraryFilters, code: QuickToggle): LibraryFilters {
  switch (code) {
    case 'inSeason':
      return { ...filters, inSeason: !filters.inSeason }
    case 'withPrice':
      return { ...filters, withPrice: !filters.withPrice }
    case 'withPieceWeight':
      return { ...filters, withPieceWeight: !filters.withPieceWeight }
    case 'withBrand':
      return { ...filters, withBrand: !filters.withBrand }
  }
}

export function toggleSource(filters: LibraryFilters, source: Source): LibraryFilters {
  const sources = filters.sources.includes(source)
    ? filters.sources.filter((value) => value !== source)
    : [...filters.sources, source]
  return { ...filters, sources }
}

export function toggleRayon(filters: LibraryFilters, rayon: string): LibraryFilters {
  const rayons = filters.rayons.includes(rayon)
    ? filters.rayons.filter((value) => value !== rayon)
    : [...filters.rayons, rayon]
  return { ...filters, rayons }
}

export function activeFilterCount(filters: LibraryFilters): number {
  let count = 0
  if (filters.sources.length > 0) count += 1
  if (filters.rayons.length > 0) count += 1
  for (const toggle of QUICK_TOGGLES) if (filters[toggle.code]) count += 1
  return count
}

export function filterIngredients(
  items: readonly Ingredient[],
  filters: LibraryFilters,
  now: Date = new Date(),
): Ingredient[] {
  const sources = new Set<string>(filters.sources)
  const rayons = new Set<string>(filters.rayons)

  return items.filter((item) => {
    if (sources.size > 0 && !sources.has(item.source)) return false
    if (rayons.size > 0 && !rayons.has(item.categoryL1 ?? '')) return false
    if (filters.inSeason && !isInSeasonNow(item, now)) return false
    if (filters.withBrand && (item.brand ?? '').trim() === '') return false
    if (filters.withPieceWeight && !item.pieceWeightG) return false
    if (filters.withPrice && item.priceEur === null) return false
    return true
  })
}

// ---------------------------------------------------------------------------
// Options de vue portees par l'URL
// ---------------------------------------------------------------------------

export interface ViewOptions {
  readonly query: string
  readonly sort: SortField
  readonly desc: boolean
  readonly group: GroupMode
  readonly filters: LibraryFilters
}

export const DEFAULT_VIEW: ViewOptions = {
  query: '',
  sort: 'name',
  desc: false,
  group: 'none',
  filters: NO_FILTERS,
}

const isSource = (value: string): value is Source => (SOURCES as readonly string[]).includes(value)

const splitCsv = (value: string | null): string[] =>
  value === null ? [] : value.split(',').map((part) => part.trim()).filter((part) => part !== '')

/**
 * Relit les options depuis la query string.
 *
 * L'URL plutot que `localStorage` : c'est ce qui rend un filtre partageable,
 * survivable a un rafraichissement en magasin, et surtout ANNULABLE par le
 * bouton Retour du telephone. Le desktop persistait dans QSettings, ce qui
 * pouvait rouvrir l'application sur une bibliotheque filtree en apparence
 * vide, sans que rien ne l'explique.
 *
 * Toute valeur devenue invalide entre deux versions est ignoree en silence et
 * le defaut s'applique — comme QSettings le faisait.
 */
export function readViewOptions(params: URLSearchParams): ViewOptions {
  const [rawSort, rawDirection] = (params.get('tri') ?? '').split('.')
  const sort = rawSort !== undefined && SORT_CODES.has(rawSort) ? (rawSort as SortField) : DEFAULT_VIEW.sort
  const rawGroup = params.get('groupe')
  const group = rawGroup !== null && GROUP_CODES.has(rawGroup) ? (rawGroup as GroupMode) : DEFAULT_VIEW.group
  const toggles = new Set(splitCsv(params.get('f')))

  return {
    query: params.get('q') ?? '',
    sort,
    desc: rawDirection === 'desc',
    group,
    filters: {
      sources: splitCsv(params.get('sources')).filter(isSource),
      rayons: splitCsv(params.get('rayons')),
      inSeason: toggles.has('inSeason'),
      withBrand: toggles.has('withBrand'),
      withPieceWeight: toggles.has('withPieceWeight'),
      withPrice: toggles.has('withPrice'),
    },
  }
}

/** N'ecrit QUE ce qui differe du defaut : l'URL reste lisible et partageable. */
export function viewOptionsToParams(view: ViewOptions): URLSearchParams {
  const params = new URLSearchParams()
  if (view.query !== '') params.set('q', view.query)
  if (view.sort !== DEFAULT_VIEW.sort || view.desc) {
    params.set('tri', `${view.sort}.${view.desc ? 'desc' : 'asc'}`)
  }
  if (view.group !== DEFAULT_VIEW.group) params.set('groupe', view.group)
  if (view.filters.sources.length > 0) params.set('sources', view.filters.sources.join(','))
  if (view.filters.rayons.length > 0) params.set('rayons', view.filters.rayons.join(','))

  const toggles = QUICK_TOGGLES.filter((toggle) => view.filters[toggle.code]).map((t) => t.code)
  if (toggles.length > 0) params.set('f', toggles.join(','))

  return params
}

// ---------------------------------------------------------------------------
// Saisonnalite
// ---------------------------------------------------------------------------

export const MONTHS = [
  { number: 1, initial: 'J', name: 'janvier' },
  { number: 2, initial: 'F', name: 'février' },
  { number: 3, initial: 'M', name: 'mars' },
  { number: 4, initial: 'A', name: 'avril' },
  { number: 5, initial: 'M', name: 'mai' },
  { number: 6, initial: 'J', name: 'juin' },
  { number: 7, initial: 'J', name: 'juillet' },
  { number: 8, initial: 'A', name: 'août' },
  { number: 9, initial: 'S', name: 'septembre' },
  { number: 10, initial: 'O', name: 'octobre' },
  { number: 11, initial: 'N', name: 'novembre' },
  { number: 12, initial: 'D', name: 'décembre' },
] as const

/**
 * Serialise les mois vers la colonne `season_months`.
 *
 * Tri croissant, dedoublonnage, bornes 1..12, et `null` — jamais `''` — quand
 * rien n'est coche : le schema partage refuse une chaine vide, et c'est bien
 * « pas de donnee » qu'on veut stocker, pas « aucun mois ».
 */
export function seasonCsv(months: readonly number[]): string | null {
  const kept = [...new Set(months)].filter((m) => Number.isInteger(m) && m >= 1 && m <= 12).sort((a, b) => a - b)
  return kept.length > 0 ? kept.join(',') : null
}

// ---------------------------------------------------------------------------
// Brouillon de fiche
// ---------------------------------------------------------------------------

/**
 * L'etat du formulaire.
 *
 * Les champs texte sont des chaines (jamais `null`) : un `<input>` controle par
 * `null` bascule en non controle et React s'en plaint. La traduction vers le
 * `null` du modele se fait au moment de l'envoi, dans `toWritePayload`.
 */
export interface IngredientDraft {
  readonly name: string
  readonly brand: string
  readonly sourceRef: string
  readonly kcal: number | null
  readonly proteins: number | null
  readonly carbs: number | null
  readonly sugars: number | null
  readonly fats: number | null
  readonly saturatedFats: number | null
  readonly fiber: number | null
  readonly salt: number | null
  readonly pieceWeightG: number | null
  readonly cookedWeightPer100gRaw: number | null
  readonly categoryL1: string
  readonly months: readonly number[]
}

export const EMPTY_DRAFT: IngredientDraft = {
  name: '',
  brand: '',
  sourceRef: '',
  kcal: null,
  proteins: null,
  carbs: null,
  sugars: null,
  fats: null,
  saturatedFats: null,
  fiber: null,
  salt: null,
  pieceWeightG: null,
  cookedWeightPer100gRaw: null,
  categoryL1: '',
  months: [],
}

export function draftFromIngredient(ingredient: Ingredient): IngredientDraft {
  return {
    name: ingredient.name,
    brand: ingredient.brand ?? '',
    sourceRef: ingredient.sourceRef ?? '',
    kcal: ingredient.kcal,
    proteins: ingredient.proteins,
    carbs: ingredient.carbs,
    sugars: ingredient.sugars,
    fats: ingredient.fats,
    saturatedFats: ingredient.saturatedFats,
    fiber: ingredient.fiber,
    salt: ingredient.salt,
    pieceWeightG: ingredient.pieceWeightG,
    cookedWeightPer100gRaw: ingredient.cookedWeightPer100gRaw,
    categoryL1: ingredient.categoryL1 ?? '',
    months: parseSeasonMonths(ingredient),
  }
}

const blankToNull = (value: string): string | null => {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Brouillon -> charge utile d'ecriture.
 *
 * `categoryL2` part TOUJOURS a `null` : la hierarchie L1/L2 est abandonnee, et
 * chaque enregistrement nettoie au passage un residu du seed CIQUAL. Decision
 * reprise telle quelle du desktop.
 *
 * `priceEur` et `priceQuantityG` sont volontairement ABSENTS : ce sont des
 * caches de la derniere observation de l'historique, recalcules par le serveur.
 * Les envoyer depuis le formulaire ferait perdre le prix a chaque renommage.
 */
export function toWritePayload(draft: IngredientDraft): Partial<Ingredient> & { name: string } {
  return {
    name: draft.name.trim(),
    brand: blankToNull(draft.brand),
    kcal: draft.kcal,
    proteins: draft.proteins,
    carbs: draft.carbs,
    sugars: draft.sugars,
    fats: draft.fats,
    saturatedFats: draft.saturatedFats,
    fiber: draft.fiber,
    salt: draft.salt,
    pieceWeightG: draft.pieceWeightG,
    cookedWeightPer100gRaw: draft.cookedWeightPer100gRaw,
    categoryL1: blankToNull(draft.categoryL1),
    categoryL2: null,
    seasonMonths: seasonCsv(draft.months),
  }
}

/** Lien vers la fiche d'origine. `null` quand la source n'en a pas. */
export function sourceUrl(ingredient: Pick<Ingredient, 'source' | 'sourceRef'>): string | null {
  const ref = ingredient.sourceRef
  if (ref === null || ref.trim() === '') return null
  if (ingredient.source === 'ciqual') return `https://ciqual.anses.fr/#/aliments/${encodeURIComponent(ref)}`
  if (ingredient.source === 'openfoodfacts') {
    return `https://world.openfoodfacts.org/product/${encodeURIComponent(ref)}`
  }
  return null
}

/** Cle de deduplication d'une fiche du catalogue, valable meme sans identifiant. */
export const catalogKey = (ingredient: Ingredient): string =>
  ingredient.id !== null ? `id:${ingredient.id}` : `${ingredient.source}:${ingredient.sourceRef ?? ingredient.name}`
