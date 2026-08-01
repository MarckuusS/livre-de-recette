import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  DAY_LABELS,
  MEAL_SLOTS,
  MEAL_SLOT_LABELS,
  addNutrition,
  aggregateRecipe,
  datesOfIsoWeek,
  formatGrams,
  isValidIsoWeek,
  macrosFor,
  nextIsoWeek,
  previousIsoWeek,
  ZERO_NUTRITION,
  type MealSlot,
  type NutritionTotal,
} from '@livre/shared'

import { ErrorState, LoadingRows } from '../components/States.js'
import { useCalendar, useCurrentWeek, type CalendarResponse } from '../lib/queries.js'

/**
 * Planning de la semaine.
 *
 * C'est l'ecran le plus problematique du portage : le desktop affiche une
 * grille 7 jours x 5 creneaux d'au moins 900 px de large. En 375 px, on
 * bascule sur UN JOUR A LA FOIS, avec une bande de selection des jours en
 * haut. La semaine reste navigable, mais on ne voit plus tout d'un coup.
 */
export function WeekScreen() {
  const currentWeek = useCurrentWeek()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('semaine')
  const isoWeek = requested && isValidIsoWeek(requested) ? requested : currentWeek

  const today = new Date()
  // 0 = lundi, comme en base. getDay() rend 0 = dimanche.
  const todayIndex = (today.getDay() + 6) % 7
  const [dayIndex, setDayIndex] = useState(isoWeek === currentWeek ? todayIndex : 0)

  const setWeek = (week: string) =>
    setSearchParams(week === currentWeek ? {} : { semaine: week }, { replace: true })

  const query = useCalendar(isoWeek)
  const dates = useMemo(() => datesOfIsoWeek(isoWeek), [isoWeek])

  return (
    <section className="screen">
      <div className="week-picker">
        <button type="button" className="week-picker__arrow" onClick={() => setWeek(previousIsoWeek(isoWeek))} aria-label="Semaine précédente">
          ‹
        </button>
        <button type="button" className="week-picker__label" onClick={() => setWeek(currentWeek)} disabled={isoWeek === currentWeek}>
          <span className="week-picker__week">Semaine {isoWeek.slice(6)}</span>
          <span className="week-picker__year">{isoWeek === currentWeek ? 'cette semaine' : isoWeek.slice(0, 4)}</span>
        </button>
        <button type="button" className="week-picker__arrow" onClick={() => setWeek(nextIsoWeek(isoWeek))} aria-label="Semaine suivante">
          ›
        </button>
      </div>

      <div className="day-strip" role="tablist" aria-label="Jour de la semaine">
        {dates.map((date, i) => {
          const filled = query.data?.entries.some((e) => e.dayOfWeek === i) ?? false
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === dayIndex}
              className={`day-strip__day${i === dayIndex ? ' day-strip__day--active' : ''}`}
              onClick={() => setDayIndex(i)}
            >
              <span className="day-strip__name">{DAY_LABELS[i]?.slice(0, 1)}</span>
              <span className="day-strip__date">{date.getUTCDate()}</span>
              {/* Une pastille sur les jours remplis : sans elle, il faudrait
                  ouvrir les sept jours pour savoir ou sont les repas. */}
              <span className={`day-strip__dot${filled ? ' day-strip__dot--on' : ''}`} aria-hidden="true" />
            </button>
          )
        })}
      </div>

      {query.isPending && <LoadingRows />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.isSuccess && <DayView data={query.data} dayIndex={dayIndex} />}
    </section>
  )
}

function DayView({ data, dayIndex }: { data: CalendarResponse; dayIndex: number }) {
  const dayEntries = data.entries.filter((e) => e.dayOfWeek === dayIndex)

  const nutritionOf = (slot: MealSlot): NutritionTotal =>
    dayEntries
      .filter((e) => e.slot === slot)
      .reduce((total, entry) => {
        if (entry.recipeId !== null) {
          const recipe = data.recipes[String(entry.recipeId)]
          if (!recipe) return total
          const { perPortion } = aggregateRecipe(recipe)
          const portions = entry.portions ?? 1
          return addNutrition(total, {
            kcal: perPortion.kcal * portions,
            proteins: perPortion.proteins * portions,
            carbs: perPortion.carbs * portions,
            sugars: perPortion.sugars * portions,
            fats: perPortion.fats * portions,
            saturatedFats: perPortion.saturatedFats * portions,
            fiber: perPortion.fiber * portions,
            salt: perPortion.salt * portions,
          })
        }
        const ingredient = data.ingredients[String(entry.ingredientId)]
        if (!ingredient) return total
        return addNutrition(total, macrosFor(ingredient, entry.quantityG ?? 0))
      }, ZERO_NUTRITION)

  const dayTotal = MEAL_SLOTS.map(nutritionOf).reduce(addNutrition, ZERO_NUTRITION)

  return (
    <>
      {MEAL_SLOTS.map((slot) => {
        const entries = dayEntries.filter((e) => e.slot === slot)
        // Les creneaux de collation ne s'affichent que s'ils contiennent
        // quelque chose : sinon la journee compte cinq blocs vides sur cinq.
        const isSnack = slot === 'snack_morning' || slot === 'snack_afternoon'
        if (isSnack && entries.length === 0) return null

        return (
          <div key={slot} className="card card--flush">
            <h3 className="card__title card__title--padded">{MEAL_SLOT_LABELS[slot]}</h3>
            {entries.length === 0 ? (
              <p className="slot-empty">Rien de prévu</p>
            ) : (
              <ul className="row-list row-list--flush">
                {entries.map((entry) => {
                  const recipe = entry.recipeId !== null ? data.recipes[String(entry.recipeId)] : null
                  const ingredient =
                    entry.ingredientId !== null ? data.ingredients[String(entry.ingredientId)] : null
                  return (
                    <li key={entry.id} className="row row--static">
                      <span className="row__body">
                        <span className="row__title">
                          {recipe?.name ?? ingredient?.name ?? 'Entrée orpheline'}
                        </span>
                        <span className="row__meta">
                          {recipe
                            ? `${entry.portions ?? 1} portion${(entry.portions ?? 1) > 1 ? 's' : ''}`
                            : formatGrams(entry.quantityG ?? 0)}
                        </span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}

      <div className="card">
        <h3 className="card__title">Total du jour</h3>
        <dl className="kv">
          <div className="kv__pair">
            <dt>Énergie</dt>
            <dd>{Math.round(dayTotal.kcal).toLocaleString('fr-FR')} kcal</dd>
          </div>
          <div className="kv__pair">
            <dt>Protéines</dt>
            <dd>{dayTotal.proteins.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} g</dd>
          </div>
          <div className="kv__pair">
            <dt>Glucides</dt>
            <dd>{dayTotal.carbs.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} g</dd>
          </div>
          <div className="kv__pair">
            <dt>Lipides</dt>
            <dd>{dayTotal.fats.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} g</dd>
          </div>
        </dl>
      </div>
    </>
  )
}
