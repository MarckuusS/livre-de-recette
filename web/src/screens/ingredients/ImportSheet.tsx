/**
 * Import d'ingredients — portage d'ImportIngredientDialog.qml.
 *
 * Rappel du modele, qui surprend toujours : catalogue et bibliotheque sont la
 * MEME table. « Ajouter » une ligne CIQUAL ne copie rien, cela leve un drapeau.
 * D'ou l'etoile sur les lignes deja presentes plutot que leur disparition :
 * chercher un ingredient qu'on possede deja et lire « aucun résultat » serait
 * deroutant.
 *
 * Les deux onglets ne se comportent pas pareil, et c'est voulu :
 *
 *   - CIQUAL interroge la base locale, donc a la frappe (debounce 250 ms) ;
 *   - OpenFoodFacts part sur un BOUTON explicite. OFF bride les clients
 *     anonymes ; declencher a la frappe garantit d'etre limite au bout de
 *     trois mots.
 *
 * Autre asymetrie, imposee par l'API : une ligne CIQUAL existe deja en base et
 * s'ajoute par `PUT /library`, tandis qu'un resultat OFF n'est qu'un candidat
 * sans identifiant (le Worker ne le met pas en cache) — il faut le CREER.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { UseQueryResult } from '@tanstack/react-query'
import type { Ingredient } from '@livre/shared'

import { BarcodeScanner } from '../../components/BarcodeScanner.js'
import { SelectField } from '../../components/Field.js'
import { Sheet } from '../../components/Sheet.js'
import { EmptyState, ErrorState, LoadingRows, SourceBadge } from '../../components/States.js'
import { ApiError } from '../../lib/api.js'
import {
  useAddToLibrary,
  useBarcode,
  useCatalog,
  useCategories,
  useCreateIngredient,
  useIngredients,
  useOffSearch,
  type BarcodeResult,
} from '../../lib/queries.js'
import { catalogKey } from './model.js'
import '../../styles/ingredients.css'

type Tab = 'ciqual' | 'off'

export interface ImportSheetProps {
  readonly open: boolean
  readonly onClose: () => void
  /** Onglet a l'ouverture. « Scanner » arrive directement sur OpenFoodFacts. */
  readonly initialTab?: Tab
  /** Ouvre la camera dans la foulee, sans tap supplementaire. */
  readonly autoScan?: boolean
}

export function ImportSheet({ open, onClose, initialTab = 'ciqual', autoScan = false }: ImportSheetProps) {
  const [tab, setTab] = useState<Tab>(initialTab)

  // L'onglet suit le bouton qui a ouvert la feuille. Sans cette
  // resynchronisation, l'etat de la derniere ouverture resterait en place et
  // « Scanner » retomberait sur CIQUAL, ou aucun scan n'a de sens.
  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  // La selection SURVIT au changement d'onglet, de requete et de categorie :
  // c'est ce qui rend l'ajout en lot supportable sur petit ecran — chercher
  // « tomate », cocher trois lignes, chercher « carotte », cocher deux autres,
  // puis tout importer d'un coup.
  const [selected, setSelected] = useState<ReadonlyMap<string, Ingredient>>(new Map())
  const [report, setReport] = useState<string | null>(null)

  const toggle = (candidate: Ingredient) => {
    const key = catalogKey(candidate)
    const next = new Map(selected)
    if (next.has(key)) next.delete(key)
    else next.set(key, candidate)
    setSelected(next)
  }

  // Une fermeture remet tout a plat : le desktop conservait l'etat le temps de
  // la session du dialogue et le perdait a la reouverture. Meme chose ici, en
  // plus previsible.
  useEffect(() => {
    if (open) return
    setSelected(new Map())
    setReport(null)
  }, [open])

  const library = useLibraryIndex()

  return (
    <Sheet open={open} onClose={onClose} title="Ajouter un ingrédient">
      {/* Un groupe de boutons `aria-pressed` plutot qu'un vrai motif ARIA
          tablist : sans `role="tabpanel"` ni gestion des fleches, annoncer des
          onglets promettrait au lecteur d'ecran un comportement inexistant. */}
      <div className="ing-tabs" role="group" aria-label="Source du catalogue">
        {(
          [
            ['ciqual', 'CIQUAL (local)'],
            ['off', 'OpenFoodFacts (en ligne)'],
          ] as const
        ).map(([code, label]) => (
          <button
            key={code}
            type="button"
            aria-pressed={tab === code}
            className={`ing-tabs__tab${tab === code ? ' ing-tabs__tab--active' : ''}`}
            onClick={() => setTab(code)}
          >
            {label}
          </button>
        ))}
      </div>

      {report && <p className="ing-import__report">{report}</p>}

      <SelectionBar
        selected={selected}
        onClear={() => setSelected(new Map())}
        onDone={(message) => {
          setReport(message)
          setSelected(new Map())
        }}
      />

      {tab === 'ciqual' ? (
        <CiqualTab library={library} selected={selected} onToggle={toggle} onAdded={setReport} />
      ) : (
        <OffTab
          library={library}
          selected={selected}
          onToggle={toggle}
          onAdded={setReport}
          autoScan={open && autoScan}
        />
      )}
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Ce qui est deja dans la bibliotheque
// ---------------------------------------------------------------------------

interface LibraryIndex {
  /** Identifiants deja en bibliotheque — le cas des lignes du catalogue local. */
  readonly ids: ReadonlySet<number>
  /** Cles `source:reference` — le seul moyen de reconnaitre un candidat OFF. */
  readonly refs: ReadonlySet<string>
}

/**
 * Un resultat OpenFoodFacts arrive sans identifiant : impossible de savoir s'il
 * est deja en bibliotheque en regardant son `inLibrary`, toujours faux. On
 * indexe donc la bibliotheque par `source:sourceRef` une bonne fois, et on
 * reconnait les candidats par leur code-barres.
 */
function useLibraryIndex(): LibraryIndex {
  // Meme cle de cache que la liste de l'ecran parent : la feuille ne declenche
  // donc aucune requete supplementaire, elle relit ce qui est deja charge.
  const library = useIngredients('')
  const items = library.data?.items

  return useMemo(() => {
    const ids = new Set<number>()
    const refs = new Set<string>()
    for (const item of items ?? []) {
      if (item.id !== null) ids.add(item.id)
      if (item.sourceRef) refs.add(`${item.source}:${item.sourceRef}`)
    }
    return { ids, refs }
  }, [items])
}

const isKnown = (candidate: Ingredient, library: LibraryIndex): boolean => {
  if (candidate.inLibrary) return true
  if (candidate.id !== null && library.ids.has(candidate.id)) return true
  return candidate.sourceRef !== null && library.refs.has(`${candidate.source}:${candidate.sourceRef}`)
}

// ---------------------------------------------------------------------------
// Import, a l'unite et en lot
// ---------------------------------------------------------------------------

/** Un candidat OFF n'existe pas en base : il faut le creer, macros comprises. */
const toCreatePayload = (candidate: Ingredient): Partial<Ingredient> & { name: string } => ({
  name: candidate.name,
  source: candidate.source,
  sourceRef: candidate.sourceRef,
  brand: candidate.brand,
  kcal: candidate.kcal,
  proteins: candidate.proteins,
  carbs: candidate.carbs,
  sugars: candidate.sugars,
  fats: candidate.fats,
  saturatedFats: candidate.saturatedFats,
  fiber: candidate.fiber,
  salt: candidate.salt,
})

function SelectionBar({
  selected,
  onClear,
  onDone,
}: {
  selected: ReadonlyMap<string, Ingredient>
  onClear: () => void
  onDone: (message: string) => void
}) {
  const addToLibrary = useAddToLibrary()
  const create = useCreateIngredient()
  const [busy, setBusy] = useState(false)
  const [failures, setFailures] = useState<string[]>([])

  if (selected.size === 0) return null

  const importAll = async () => {
    setBusy(true)
    setFailures([])
    const problems: string[] = []
    let done = 0

    // Sequentiel et non `Promise.all` : D1 n'aime pas vingt ecritures
    // concurrentes, et l'API ne propose pas d'import groupe. Une ligne qui
    // echoue (nom deja pris, par exemple) ne doit pas emporter les autres,
    // d'ou le try par candidat plutot qu'autour de la boucle.
    for (const candidate of selected.values()) {
      try {
        if (candidate.id !== null) await addToLibrary.mutateAsync(candidate.id)
        else await create.mutateAsync(toCreatePayload(candidate))
        done += 1
      } catch (error) {
        problems.push(`${candidate.name} — ${error instanceof Error ? error.message : 'échec'}`)
      }
    }

    setBusy(false)
    setFailures(problems)
    if (problems.length === 0) {
      onDone(`✓ ${done} ingrédient${done > 1 ? 's' : ''} ajouté${done > 1 ? 's' : ''} à ta bibliothèque.`)
    }
  }

  return (
    <div className="ing-selection">
      <p className="ing-selection__count">
        {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
      </p>
      <button type="button" className="button button--ghost" onClick={onClear} disabled={busy}>
        Tout désélectionner
      </button>
      <button
        type="button"
        className="button button--primary"
        onClick={() => void importAll()}
        disabled={busy}
      >
        {busy ? 'Import…' : `+ Importer (${selected.size})`}
      </button>

      {failures.length > 0 && (
        <ul className="ing-selection__failures" role="alert">
          {failures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Onglet CIQUAL
// ---------------------------------------------------------------------------

function CiqualTab({
  library,
  selected,
  onToggle,
  onAdded,
}: {
  library: LibraryIndex
  selected: ReadonlyMap<string, Ingredient>
  onToggle: (candidate: Ingredient) => void
  onAdded: (message: string) => void
}) {
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [category, setCategory] = useState('')
  const categories = useCategories()

  // 250 ms, comme le desktop — un cran au-dessus des 200 ms de la bibliotheque
  // personnelle, parce que le catalogue compte des milliers de lignes.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), 250)
    return () => clearTimeout(timer)
  }, [text])

  const results = useCatalog(debounced, { source: 'ciqual', category: category || null })

  return (
    <>
      <input
        type="search"
        className="search-field"
        placeholder="Rechercher dans le catalogue CIQUAL…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        enterKeyHint="search"
        autoCorrect="off"
        autoCapitalize="off"
        aria-label="Rechercher dans le catalogue CIQUAL"
      />

      <SelectField
        label="Catégorie"
        value={category}
        onChange={setCategory}
        placeholder="Toutes les catégories"
        options={(categories.data?.items ?? []).map((entry) => ({
          value: entry.l1,
          label: `${entry.l1} (${entry.count})`,
        }))}
      />

      <p className="field__hint">
        La table CIQUAL de l’ANSES, ~3 000 aliments bruts. Sans requête ni catégorie, elle se
        parcourt par ordre alphabétique.
      </p>

      {/* `isPending` et non `isFetching` : le hook garde la page precedente
          affichee pendant la frappe, remplacer la liste par un squelette a
          chaque lettre ferait clignoter l'ecran. */}
      {results.isPending && <LoadingRows rows={3} />}
      {results.isError && <ErrorState error={results.error} onRetry={() => void results.refetch()} />}

      {results.isSuccess && results.data.items.length === 0 && (
        <EmptyState title="Aucun résultat">Aucun aliment ne correspond à ces critères.</EmptyState>
      )}

      {results.isSuccess && results.data.items.length > 0 && (
        <>
          <p className="list-count">
            {results.data.totalCount} résultat{results.data.totalCount > 1 ? 's' : ''}
            {results.data.totalCount > results.data.items.length &&
              ` · ${results.data.items.length} affichés, affine ta recherche`}
          </p>
          <ul className="ing-results">
            {results.data.items.map((candidate) => (
              <CandidateRow
                key={catalogKey(candidate)}
                candidate={candidate}
                known={isKnown(candidate, library)}
                checked={selected.has(catalogKey(candidate))}
                onToggle={() => onToggle(candidate)}
                onAdded={onAdded}
              />
            ))}
          </ul>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Onglet OpenFoodFacts
// ---------------------------------------------------------------------------

function OffTab({
  library,
  selected,
  onToggle,
  onAdded,
  autoScan,
}: {
  library: LibraryIndex
  selected: ReadonlyMap<string, Ingredient>
  onToggle: (candidate: Ingredient) => void
  onAdded: (message: string) => void
  autoScan: boolean
}) {
  const [text, setText] = useState('')
  // Ce que l'utilisateur a VALIDE, distinct de ce qu'il tape : c'est cette
  // separation qui garantit qu'aucune requete ne part a la frappe.
  const [submitted, setSubmitted] = useState('')
  const [scanning, setScanning] = useState(autoScan)
  /** Code lu par la camera. Interroge le produit exact, pas la recherche texte. */
  const [scanned, setScanned] = useState<string | null>(null)

  const results = useOffSearch(submitted, submitted.length >= 2)
  const barcode = useBarcode(scanned)
  const canSearch = text.trim().length >= 2

  return (
    <>
      <form
        className="ing-off-search"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSearch) {
            setScanned(null)
            setSubmitted(text.trim())
          }
        }}
      >
        <input
          type="search"
          className="search-field"
          placeholder="Nom du produit ou code-barres…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          enterKeyHint="search"
          autoCorrect="off"
          autoCapitalize="off"
          aria-label="Rechercher sur OpenFoodFacts"
        />
        <div className="ing-off-search__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={!canSearch || results.isFetching}
          >
            {results.isFetching ? 'Recherche…' : 'Chercher en ligne'}
          </button>
          {/* Devant un rayon, viser le code-barres bat treize chiffres tapes a
              une main, et bat surtout la recherche par nom : les libelles
              d'OpenFoodFacts sont ecrits par des contributeurs, pas par le
              fabricant. */}
          <button
            type="button"
            className="button button--secondary"
            onClick={() => setScanning(true)}
          >
            Scanner
          </button>
        </div>
      </form>

      <p className="field__hint">
        La recherche par nom part uniquement quand tu la déclenches : OpenFoodFacts limite le débit
        des clients anonymes. Le scan, lui, interroge directement le code lu.
      </p>

      <BarcodeScanner
        open={scanning}
        onClose={() => setScanning(false)}
        title="Scanner un produit"
        onDetect={(code) => {
          setScanning(false)
          setText(code)
          setSubmitted('')
          setScanned(code)
        }}
      />

      {scanned !== null && (
        <ScannedProduct
          ean={scanned}
          query={barcode}
          library={library}
          onAdded={onAdded}
          onDismiss={() => setScanned(null)}
        />
      )}

      {/* Un scan en cours occupe l'ecran seul : melanger son resultat avec une
          liste de recherche precedente laisserait croire que le produit lu est
          l'un des dix affiches. */}
      {scanned === null && (
        <>
          {submitted === '' ? (
            <EmptyState title="Produits emballés">
              Scanne un code-barres, ou tape au moins 2 caractères puis « Chercher en ligne ».
            </EmptyState>
          ) : (
            // `isFetching` et non `isPending` : une requete desactivee reste
            // « pending » indefiniment, le squelette ne partirait jamais.
            results.isFetching && <LoadingRows rows={3} />
          )}

          {results.isError && (
            <ErrorState error={results.error} onRetry={() => void results.refetch()} />
          )}

          {results.isSuccess && !results.isFetching && results.data.items.length === 0 && (
            <EmptyState title="Aucun résultat">
              Rien ne correspond à « {submitted} » sur OpenFoodFacts. Tu peux créer la fiche à la
              main.
            </EmptyState>
          )}

          {results.isSuccess && results.data.items.length > 0 && (
            <ul className="ing-results">
              {results.data.items.map((candidate) => (
                <CandidateRow
                  key={catalogKey(candidate)}
                  candidate={candidate}
                  known={isKnown(candidate, library)}
                  checked={selected.has(catalogKey(candidate))}
                  onToggle={() => onToggle(candidate)}
                  onAdded={onAdded}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Resultat d'un scan
// ---------------------------------------------------------------------------

/**
 * Le produit lu, seul a l'ecran.
 *
 * Trois issues possibles, et elles n'appellent pas la meme action :
 * le produit est deja dans la bibliotheque (rien a faire), il est connu
 * d'OpenFoodFacts (l'ajouter), ou personne ne le connait (le creer a la main
 * avec son code deja rempli).
 */
function ScannedProduct({
  ean,
  query,
  library,
  onAdded,
  onDismiss,
}: {
  ean: string
  query: UseQueryResult<BarcodeResult, Error>
  library: LibraryIndex
  onAdded: (message: string) => void
  onDismiss: () => void
}) {
  if (query.isPending) return <LoadingRows rows={1} />

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404
    return (
      <div className="card">
        <h3 className="card__title">{notFound ? 'Produit inconnu' : 'Lecture impossible'}</h3>
        <p className="card__lead">
          {notFound
            ? `Le code ${ean} n’est pas répertorié sur OpenFoodFacts. Tu peux créer la fiche à la main : le code est déjà rempli.`
            : query.error.message}
        </p>
        <div className="ing-scan-actions">
          {notFound && (
            <Link
              to={`/ingredients/nouveau?ean=${ean}`}
              className="button button--primary"
              onClick={onDismiss}
            >
              Créer la fiche
            </Link>
          )}
          <button type="button" className="button button--secondary" onClick={onDismiss}>
            Scanner autre chose
          </button>
        </div>
      </div>
    )
  }

  const product = query.data
  const known = product.alreadyKnown === true || isKnown(product, library)

  return (
    <div className="card">
      {/* Pas de nom ni de marque ici : CandidateRow les affiche deja. Les
          repeter au-dessus donnait la meme fiche deux fois de suite. */}
      <p className="card__lead">
        Code <strong>{ean}</strong>
      </p>

      {known && product.inLibrary ? (
        <p className="status status--ok">Déjà dans ta bibliothèque.</p>
      ) : (
        <CandidateRow
          candidate={product}
          known={known}
          checked={false}
          onToggle={() => undefined}
          onAdded={(message) => {
            onAdded(message)
            onDismiss()
          }}
        />
      )}

      <button type="button" className="button button--secondary" onClick={onDismiss}>
        Scanner autre chose
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Une ligne de resultat
// ---------------------------------------------------------------------------

function CandidateRow({
  candidate,
  known,
  checked,
  onToggle,
  onAdded,
}: {
  candidate: Ingredient
  known: boolean
  checked: boolean
  onToggle: () => void
  onAdded: (message: string) => void
}) {
  const addToLibrary = useAddToLibrary()
  const create = useCreateIngredient()
  const busy = addToLibrary.isPending || create.isPending
  const error = candidate.id !== null ? addToLibrary.error : create.error

  const add = () => {
    const done = () => onAdded(`✓ Ajouté à ta bibliothèque : ${candidate.name}`)
    if (candidate.id !== null) addToLibrary.mutate(candidate.id, { onSuccess: done })
    else create.mutate(toCreatePayload(candidate), { onSuccess: done })
  }

  // `toLocaleString('fr-FR')` et non l'interpolation brute : OpenFoodFacts rend
  // « 6.3 », qui s'affichait tel quel au milieu d'une interface ou tous les
  // autres nombres portent une virgule.
  const gram = (value: number) => `${value.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} g`

  const macros = [
    candidate.kcal !== null ? `${Math.round(candidate.kcal)} kcal` : null,
    candidate.proteins !== null ? `P ${gram(candidate.proteins)}` : null,
    candidate.carbs !== null ? `G ${gram(candidate.carbs)}` : null,
    candidate.fats !== null ? `L ${gram(candidate.fats)}` : null,
  ].filter((part): part is string => part !== null)

  return (
    <li className="ing-result">
      {/* Pas de case a cocher sur une ligne deja en bibliotheque : la
          selectionner ne produirait rien. L'espace est conserve pour que les
          lignes restent alignees. */}
      {known ? (
        <span className="ing-result__slot" aria-hidden="true">
          🌟
        </span>
      ) : (
        <input
          type="checkbox"
          className="ing-result__check"
          checked={checked}
          onChange={onToggle}
          aria-label={`Sélectionner ${candidate.name}`}
        />
      )}

      <div className="ing-result__body">
        <p className="ing-result__name">{candidate.name}</p>
        <p className="ing-result__meta">
          <SourceBadge source={candidate.source} />
          {candidate.brand && <span>{candidate.brand}</span>}
          {macros.length > 0 && <span>{macros.join(' · ')}</span>}
          {candidate.categoryL1 && <span>{candidate.categoryL1}</span>}
        </p>
        {error && (
          <p className="field__error" role="alert">
            {error.message}
          </p>
        )}
      </div>

      <button
        type="button"
        className={`button ${known ? 'button--ghost' : 'button--secondary'} ing-result__add`}
        onClick={add}
        disabled={known || busy}
        aria-label={known ? `${candidate.name} est déjà dans ta bibliothèque` : `Ajouter ${candidate.name}`}
      >
        {known ? 'Déjà ajouté' : busy ? '…' : '+ Ajouter'}
      </button>
    </li>
  )
}
