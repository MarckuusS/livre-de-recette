import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { formatEuros, formatGrams, isInSeasonNow, type Ingredient } from '@livre/shared'

import { EmptyState, ErrorState, LoadingRows, SourceBadge } from '../components/States.js'
import { useIngredient, useIngredients } from '../lib/queries.js'

/**
 * Bibliotheque personnelle d'ingredients.
 *
 * Le desktop affichait liste et formulaire cote a cote dans un SplitView
 * 42/58. Impossible en 375 px : on passe a une pile — la liste, puis la fiche,
 * avec le bouton Retour du telephone pour revenir.
 */
export function IngredientsScreen() {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  // 200 ms, comme le picker du desktop. Sans ce delai, chaque lettre
  // declencherait une requete reseau.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 200)
    return () => clearTimeout(timer)
  }, [query])

  const list = useIngredients(debounced)

  return (
    <section className="screen">
      <input
        type="search"
        className="search-field"
        placeholder="Rechercher un ingrédient…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        // enterKeyHint : le clavier iOS affiche « rechercher » plutot que
        // « entrée », et l'absence d'autocorrection evite les corrections
        // parasites sur des noms d'aliments.
        enterKeyHint="search"
        autoCorrect="off"
        autoCapitalize="off"
      />

      {list.isPending && <LoadingRows />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}

      {list.isSuccess && list.data.items.length === 0 && (
        <EmptyState title="Aucun résultat">
          {debounced
            ? `Rien ne correspond à « ${debounced} » dans ta bibliothèque.`
            : 'Ta bibliothèque personnelle est vide.'}
        </EmptyState>
      )}

      {list.isSuccess && list.data.items.length > 0 && (
        <>
          <p className="list-count">
            {list.data.totalCount} ingrédient{list.data.totalCount > 1 ? 's' : ''}
          </p>
          <ul className="row-list">
            {list.data.items.map((ingredient) => (
              <IngredientRow key={ingredient.id} ingredient={ingredient} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function IngredientRow({ ingredient }: { ingredient: Ingredient }) {
  return (
    <li className="row">
      <Link to={`/ingredients/${ingredient.id}`} className="row__link">
        <span className="row__body">
          <span className="row__title">{ingredient.name}</span>
          <span className="row__meta">
            <SourceBadge source={ingredient.source} />
            {isInSeasonNow(ingredient) && <span className="badge badge--season">de saison</span>}
            {ingredient.kcal !== null && <span>{Math.round(ingredient.kcal)} kcal/100 g</span>}
          </span>
        </span>
        <span className="row__chevron" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  )
}

// ---------------------------------------------------------------------------

/** Fiche detaillee, en lecture seule pour la phase 1. */
export function IngredientDetailScreen() {
  const params = useParams()
  const id = Number(params['id'])
  const query = useIngredient(Number.isInteger(id) ? id : null)

  if (query.isPending) return <section className="screen"><LoadingRows /></section>
  if (query.isError)
    return (
      <section className="screen">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </section>
    )

  const ing = query.data
  const macros: Array<[string, number | null, string]> = [
    ['Énergie', ing.kcal, 'kcal'],
    ['Protéines', ing.proteins, 'g'],
    ['Glucides', ing.carbs, 'g'],
    ['dont sucres', ing.sugars, 'g'],
    ['Lipides', ing.fats, 'g'],
    ['dont saturés', ing.saturatedFats, 'g'],
    ['Fibres', ing.fiber, 'g'],
    ['Sel', ing.salt, 'g'],
  ]

  return (
    <section className="screen">
      <div className="card">
        <h2 className="card__title">{ing.name}</h2>
        <p className="row__meta">
          <SourceBadge source={ing.source} />
          {ing.brand && <span>{ing.brand}</span>}
          {isInSeasonNow(ing) && <span className="badge badge--season">de saison</span>}
        </p>
      </div>

      <div className="card">
        <h3 className="card__title">Pour 100 g</h3>
        <dl className="kv">
          {macros.map(([label, value, unit]) => (
            <div key={label} className="kv__pair">
              <dt>{label}</dt>
              {/* « — » et non 0 : une macro inconnue n'est pas une macro nulle.
                  CIQUAL ne mesure pas tout, et afficher 0 serait un mensonge. */}
              <dd>{value === null ? '—' : `${value.toLocaleString('fr-FR')} ${unit}`}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="card">
        <h3 className="card__title">Prix et quantités</h3>
        <dl className="kv">
          <div className="kv__pair">
            <dt>Prix de référence</dt>
            <dd>{formatEuros(ing.priceEur)}</dd>
          </div>
          <div className="kv__pair">
            <dt>Pour</dt>
            <dd>{ing.priceQuantityG ? formatGrams(ing.priceQuantityG) : '—'}</dd>
          </div>
          <div className="kv__pair">
            <dt>Poids d’une pièce</dt>
            <dd>{ing.pieceWeightG ? formatGrams(ing.pieceWeightG) : '—'}</dd>
          </div>
          <div className="kv__pair">
            <dt>Rayon</dt>
            <dd>{ing.categoryL1 ?? '—'}</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
