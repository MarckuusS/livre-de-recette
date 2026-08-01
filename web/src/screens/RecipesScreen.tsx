import { Link, useParams } from 'react-router'
import {
  aggregateRecipe,
  energyBreakdown,
  formatEuros,
  formatGrams,
  recipeCost,
  type NutritionTotal,
  type Recipe,
} from '@livre/shared'

import { EmptyState, ErrorState, LoadingRows } from '../components/States.js'
import { useRecipe, useRecipes } from '../lib/queries.js'

export function RecipesScreen() {
  const query = useRecipes()

  return (
    <section className="screen">
      {query.isPending && <LoadingRows />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.isSuccess && query.data.items.length === 0 && (
        <EmptyState title="Aucune recette">Ta bibliothèque de recettes est vide.</EmptyState>
      )}

      {query.isSuccess && query.data.items.length > 0 && (
        <ul className="row-list">
          {query.data.items.map((recipe) => (
            <li key={recipe.id} className="row">
              <Link to={`/recettes/${recipe.id}`} className="row__link">
                <span className="row__body">
                  <span className="row__title">{recipe.name}</span>
                  <span className="row__meta">
                    {recipe.defaultPortions} portion{recipe.defaultPortions > 1 ? 's' : ''} ·{' '}
                    {recipe.lineCount} ingrédient{recipe.lineCount > 1 ? 's' : ''}
                  </span>
                </span>
                <span className="row__chevron" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------

export function RecipeDetailScreen() {
  const params = useParams()
  const id = Number(params['id'])
  const query = useRecipe(Number.isInteger(id) ? id : null)

  if (query.isPending) return <section className="screen"><LoadingRows rows={6} /></section>
  if (query.isError)
    return (
      <section className="screen">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </section>
    )

  const recipe = query.data
  // Nutrition et cout sont calcules COTE CLIENT, a partir du meme code que
  // celui du serveur (shared/). Rien a recalculer ni a synchroniser.
  const nutrition = aggregateRecipe(recipe)
  const cost = recipeCost(recipe)

  return (
    <section className="screen">
      <div className="card">
        <h2 className="card__title">{recipe.name}</h2>
        <p className="row__meta">
          {recipe.defaultPortions} portion{recipe.defaultPortions > 1 ? 's' : ''}
          {nutrition.totalWeightG > 0 && <span>{formatGrams(nutrition.totalWeightG)} au total</span>}
        </p>
        {recipe.tags.length > 0 && (
          <div className="chips">
            {recipe.tags.map((tag) => (
              <span key={tag.id} className="chip" style={{ borderColor: tag.colorHex, color: tag.colorHex }}>
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <IngredientLines recipe={recipe} />

      <div className="card">
        <h3 className="card__title">Nutrition</h3>
        <NutritionTable
          columns={[
            ['Pour 100 g', nutrition.per100g],
            ['Par portion', nutrition.perPortion],
            ['Total', nutrition.total],
          ]}
        />
        {nutrition.linesWithUnknownMacros.length > 0 && (
          <p className="note">
            {nutrition.linesWithUnknownMacros.length} ingrédient
            {nutrition.linesWithUnknownMacros.length > 1 ? 's ont' : ' a'} des valeurs manquantes : ces
            totaux sont sous-estimés.
          </p>
        )}
        <EnergyNote total={nutrition.total} />
      </div>

      <div className="card">
        <h3 className="card__title">Coût</h3>
        <dl className="kv">
          <div className="kv__pair">
            <dt>Total</dt>
            <dd>{formatEuros(cost.total)}</dd>
          </div>
          <div className="kv__pair">
            <dt>Par portion</dt>
            <dd>{formatEuros(cost.perPortion)}</dd>
          </div>
        </dl>
        {cost.missing.length > 0 && (
          <p className="note">
            {cost.missing.length} ingrédient{cost.missing.length > 1 ? 's' : ''} sans prix, exclu
            {cost.missing.length > 1 ? 's' : ''} du total.
          </p>
        )}
      </div>

      {recipe.instructions.trim() && (
        <div className="card">
          <h3 className="card__title">Préparation</h3>
          <p className="instructions">{recipe.instructions}</p>
        </div>
      )}
    </section>
  )
}

/** Lignes groupees par rayon, comme le desktop depuis B5. */
function IngredientLines({ recipe }: { recipe: Recipe }) {
  const sorted = [...recipe.lines].sort((a, b) => {
    const ca = a.ingredient.categoryL1 ?? '￿'
    const cb = b.ingredient.categoryL1 ?? '￿'
    return ca === cb ? a.ordinal - b.ordinal : ca.localeCompare(cb, 'fr')
  })

  let lastCategory: string | null = null

  return (
    <div className="card card--flush">
      <h3 className="card__title card__title--padded">Ingrédients</h3>
      <ul className="row-list row-list--flush">
        {sorted.map((line, i) => {
          const category = line.ingredient.categoryL1 ?? 'Sans rayon'
          const header = category !== lastCategory ? category : null
          lastCategory = category
          return (
            <li key={`${line.ingredient.id}-${i}`}>
              {header && <h4 className="section-header">{header}</h4>}
              <div className="row row--static">
                <span className="row__body">
                  <span className="row__title">{line.ingredient.name}</span>
                  {line.notes && <span className="row__meta">{line.notes}</span>}
                </span>
                <span className="row__value">{formatGrams(line.quantityG)}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function NutritionTable({ columns }: { columns: Array<[string, NutritionTotal]> }) {
  const rows: Array<[string, keyof NutritionTotal, string, number]> = [
    ['Énergie', 'kcal', 'kcal', 0],
    ['Protéines', 'proteins', 'g', 1],
    ['Glucides', 'carbs', 'g', 1],
    ['dont sucres', 'sugars', 'g', 1],
    ['Lipides', 'fats', 'g', 1],
    ['dont saturés', 'saturatedFats', 'g', 1],
    ['Fibres', 'fiber', 'g', 1],
    ['Sel', 'salt', 'g', 2],
  ]
  return (
    <div className="table-scroll">
      <table className="nutrition-table">
        <thead>
          <tr>
            <th scope="col" />
            {columns.map(([label]) => (
              <th key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, key, unit, digits]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {columns.map(([colLabel, totals]) => (
                <td key={colLabel}>
                  {totals[key].toLocaleString('fr-FR', {
                    minimumFractionDigits: digits,
                    maximumFractionDigits: digits,
                  })}
                  <span className="unit"> {unit}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Signale l'ecart entre l'energie declaree et celle recalculee par Atwater.
 *
 * Le desktop affichait la valeur recalculee au centre du donut et la valeur
 * declaree dans le tableau juste a cote, sans jamais mentionner qu'elles
 * different. Ici on affiche la declaree, et on ne mentionne l'ecart que
 * lorsqu'il devient significatif.
 */
function EnergyNote({ total }: { total: NutritionTotal }) {
  const breakdown = energyBreakdown(total)
  if (breakdown.divergence < 0.1) return null
  return (
    <p className="note">
      Le calcul à partir des macros donne {Math.round(breakdown.atwaterKcal)} kcal, contre{' '}
      {Math.round(breakdown.declaredKcal)} kcal mesurées. L’écart vient des données source — les
      valeurs affichées sont celles mesurées.
    </p>
  )
}
