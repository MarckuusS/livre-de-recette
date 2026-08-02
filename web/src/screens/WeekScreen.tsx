/**
 * Ma semaine — le planning des repas, un jour a la fois.
 *
 * Le desktop peint une grille de 7 jours x 5 creneaux large d'au moins 900 px.
 * En 375 px elle est illisible : on montre UN JOUR, la bande des sept jours en
 * tete servant a la fois de navigation et de vue d'ensemble (une pastille par
 * jour rempli). Tout le reste est repris tel quel : les cinq creneaux toujours
 * visibles, les apports du jour dans l'ordre reglementaire, le cout.
 *
 * Deux gestes du bureau n'ont aucun equivalent au doigt et sont remplaces :
 *
 *   - le glisser-deposer d'un repas vers une autre cellule devient
 *     « Déplacer vers… » dans la feuille du repas (EntrySheet) ;
 *   - la barre de six boutons d'outils devient un menu « ⋯ » (WeekTools).
 *
 * La semaine ET le jour consultes vivent dans l'URL (`?semaine=&jour=`) : le
 * telephone recharge l'application quand la memoire manque, et retrouver
 * « aujourd'hui » alors qu'on preparait le samedi est le genre de detail qui
 * fait abandonner un outil.
 */

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  DAY_LABELS,
  MEAL_SLOTS,
  MEAL_SLOT_LABELS,
  datesOfIsoWeek,
  formatEuros,
  mealPlanEntryCost,
  type MealSlot,
  type NutritionTotal,
} from '@livre/shared'

import { NutrientLabel } from '../components/NutrientLabel.js'
import { EmptyState, ErrorState, LoadingRows } from '../components/States.js'
import { useToast } from '../components/Toast.js'
import { WeekPicker } from '../components/WeekPicker.js'
import {
  useAddEntry,
  useCalendar,
  useDeleteEntry,
  type CalendarResponse,
  type EntryDraft,
} from '../lib/queries.js'
import { useIsoWeekParam } from '../lib/useIsoWeekParam.js'
import { AddEntrySheet } from './semaine/AddEntrySheet.js'
import { EntrySheet } from './semaine/EntrySheet.js'
import { WeekTools, type WeekTool } from './semaine/WeekTools.js'
import {
  entriesCost,
  entriesOfDay,
  entriesOfSlot,
  entryAmountLabel,
  entryName,
  entryNutrition,
  targetOf,
  sumNutrition,
  type SavedEntry,
} from './semaine/totals.js'
import '../styles/week.css'

const DAY_PANEL_ID = 'jour-panneau'

export function WeekScreen() {
  const week = useIsoWeekParam()
  const query = useCalendar(week.isoWeek)

  const [searchParams, setSearchParams] = useSearchParams()
  // 0 = lundi, comme en base. `getDay()` rend 0 pour dimanche.
  const todayIndex = (new Date().getDay() + 6) % 7
  const requested = searchParams.get('jour')
  const parsed = requested === null ? Number.NaN : Number(requested)
  const dayIndex =
    Number.isInteger(parsed) && parsed >= 0 && parsed <= 6
      ? parsed
      : week.isCurrent
        ? todayIndex
        : 0

  const setDay = (index: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('jour', String(index))
    setSearchParams(next, { replace: true })
  }

  // Semaine et jour changent ENSEMBLE : deux appels successifs a
  // `setSearchParams` partiraient du meme instantane et le second effacerait
  // le premier.
  const goToday = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('semaine')
    next.set('jour', String(todayIndex))
    setSearchParams(next, { replace: true })
  }

  const [addTarget, setAddTarget] = useState<{ dayOfWeek: number; slot: MealSlot } | null>(null)
  const [editing, setEditing] = useState<SavedEntry | null>(null)
  const [tool, setTool] = useState<WeekTool | null>(null)

  const toast = useToast()
  const remove = useDeleteEntry(week.isoWeek)
  const add = useAddEntry(week.isoWeek)

  /**
   * Suppression immediate, rattrapable pendant six secondes.
   *
   * L'annulation recree une entree — un nouvel identifiant, donc, exactement
   * comme sur le desktop. Le tampon est ici cote client (la charge utile
   * complete) et non cote serveur : l'application s'ouvre sur plusieurs
   * appareils, un tampon partage y annulerait la suppression d'un autre.
   */
  const deleteEntry = (entry: SavedEntry, label: string) => {
    const draft: EntryDraft = {
      dayOfWeek: entry.dayOfWeek,
      slot: entry.slot,
      recipeId: entry.recipeId,
      ingredientId: entry.ingredientId,
      quantityG: entry.quantityG,
      portions: entry.portions,
    }
    setEditing(null)
    remove.mutate(entry.id, {
      onSuccess: () => toast.showUndo(`${label} retiré`, () => add.mutate(draft)),
    })
  }

  const dates = useMemo(() => datesOfIsoWeek(week.isoWeek), [week.isoWeek])
  const data = query.data
  // Memorises pour que les totaux, en aval, ne se recalculent pas a chaque
  // ouverture de feuille : huit agregations sur toute la semaine.
  const weekEntries = useMemo(() => data?.entries ?? [], [data])
  const dayEntries = useMemo(() => (data ? entriesOfDay(data, dayIndex) : []), [data, dayIndex])

  return (
    <section className="screen screen--week">
      <WeekPicker
        isoWeek={week.isoWeek}
        isCurrent={week.isCurrent}
        onChange={week.onChange}
        onToday={goToday}
      />

      {/* Fleches gauche / droite entre les jours : c'est ce qu'un lecteur
          d'ecran attend d'un `tablist`, et le seul equivalent au clavier du
          balayage horizontal. Le jour actif est le seul arret de tabulation,
          sinon la barre en compte sept avant d'atteindre le contenu. */}
      <div
        className="day-strip"
        role="tablist"
        aria-label="Jour de la semaine"
        onKeyDown={(event) => {
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (step === 0) return
          event.preventDefault()
          const next = (dayIndex + step + 7) % 7
          setDay(next)
          document.getElementById(`jour-onglet-${next}`)?.focus()
        }}
      >
        {dates.map((date, index) => (
          <DayTab
            key={index}
            index={index}
            date={date}
            active={index === dayIndex}
            today={week.isCurrent && index === todayIndex}
            filled={weekEntries.some((entry) => entry.dayOfWeek === index)}
            onSelect={setDay}
          />
        ))}
      </div>

      <div className="week-tools">
        <button
          type="button"
          className="button button--secondary week-tools__trigger"
          onClick={() => setTool('menu')}
        >
          <span aria-hidden="true">⋯</span> Outils de la semaine
        </button>
      </div>

      {query.isPending && <LoadingRows />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.isSuccess && data && (
        <>
          {weekEntries.length === 0 && (
            <EmptyState title="Semaine vide">
              Ajoute un repas à un créneau ci-dessous, ou reprends une semaine passée depuis
              « Outils de la semaine ».
            </EmptyState>
          )}

          <div
            className="day-panel"
            id={DAY_PANEL_ID}
            role="tabpanel"
            aria-labelledby={`jour-onglet-${dayIndex}`}
          >
            <h2 className="day-panel__title">{longDayLabel(dates[dayIndex], dayIndex)}</h2>

            {MEAL_SLOTS.map((slot) => (
              <SlotCard
                key={slot}
                slot={slot}
                dayIndex={dayIndex}
                entries={entriesOfSlot(dayEntries, slot)}
                data={data}
                onAdd={() => setAddTarget({ dayOfWeek: dayIndex, slot })}
                onEdit={setEditing}
              />
            ))}
          </div>

          <DayTotals data={data} dayEntries={dayEntries} weekEntries={weekEntries} />
        </>
      )}

      {addTarget !== null && (
        <AddEntrySheet
          isoWeek={week.isoWeek}
          dayOfWeek={addTarget.dayOfWeek}
          slot={addTarget.slot}
          onClose={() => setAddTarget(null)}
        />
      )}

      {editing !== null && data && (
        <EntrySheet
          isoWeek={week.isoWeek}
          entry={editing}
          data={data}
          onClose={() => setEditing(null)}
          onDelete={deleteEntry}
        />
      )}

      <WeekTools
        isoWeek={week.isoWeek}
        dayOfWeek={dayIndex}
        weekEntryCount={weekEntries.length}
        dayEntryCount={dayEntries.length}
        tool={tool}
        onTool={setTool}
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Bande des jours
// ---------------------------------------------------------------------------

function DayTab({
  index,
  date,
  active,
  today,
  filled,
  onSelect,
}: {
  index: number
  date: Date | undefined
  active: boolean
  today: boolean
  filled: boolean
  onSelect: (index: number) => void
}) {
  const label = DAY_LABELS[index] ?? ''
  return (
    <button
      type="button"
      id={`jour-onglet-${index}`}
      role="tab"
      aria-selected={active}
      aria-controls={DAY_PANEL_ID}
      tabIndex={active ? 0 : -1}
      // Le lecteur d'ecran annoncerait « L 28 » : la date complete est dans
      // le libelle accessible, l'abrege reste a l'ecran.
      aria-label={`${label}${today ? ' (aujourd’hui)' : ''}${filled ? ', repas prévus' : ''}`}
      className={[
        'day-strip__day',
        active ? 'day-strip__day--active' : '',
        today ? 'day-strip__day--today' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onSelect(index)}
    >
      <span className="day-strip__name" aria-hidden="true">
        {label.slice(0, 1)}
      </span>
      <span className="day-strip__date" aria-hidden="true">
        {date?.getUTCDate() ?? ''}
      </span>
      <span className={`day-strip__dot${filled ? ' day-strip__dot--on' : ''}`} aria-hidden="true" />
    </button>
  )
}

/** « Lundi 28 avril ». Les dates de la semaine sont a midi UTC (voir isoweek.ts). */
function longDayLabel(date: Date | undefined, index: number): string {
  if (!date) return DAY_LABELS[index] ?? ''
  const formatted = date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

// ---------------------------------------------------------------------------
// Un creneau
// ---------------------------------------------------------------------------

function SlotCard({
  slot,
  dayIndex,
  entries,
  data,
  onAdd,
  onEdit,
}: {
  slot: MealSlot
  dayIndex: number
  entries: readonly SavedEntry[]
  data: CalendarResponse
  onAdd: () => void
  onEdit: (entry: SavedEntry) => void
}) {
  const kcal = sumNutrition(entries, data).kcal
  const slotLabel = MEAL_SLOT_LABELS[slot]
  const dayLabel = DAY_LABELS[dayIndex] ?? ''

  return (
    <section className="slot">
      <header className="slot__header">
        {/* Les cinq creneaux restent affiches meme vides : c'est ce qui rend
            l'ajout a un en-cas atteignable en un seul geste. */}
        <h3 className="slot__title">{slotLabel}</h3>
        {kcal > 0 && <span className="slot__kcal">{Math.round(kcal).toLocaleString('fr-FR')} kcal</span>}
      </header>

      {entries.length > 0 && (
        <ul className="slot__list">
          {entries.map((entry) => (
            <MealRow key={entry.id} entry={entry} data={data} onEdit={onEdit} />
          ))}
        </ul>
      )}

      <button
        type="button"
        className="slot__add"
        onClick={onAdd}
        aria-label={`Ajouter un repas — ${dayLabel} ${slotLabel.toLowerCase()}`}
      >
        <span aria-hidden="true">＋</span> Ajouter
      </button>
    </section>
  )
}

function MealRow({
  entry,
  data,
  onEdit,
}: {
  entry: SavedEntry
  data: CalendarResponse
  onEdit: (entry: SavedEntry) => void
}) {
  const name = entryName(entry, data)
  const kcal = entryNutrition(entry, data).kcal

  // Cout de CETTE ligne. « 20 g d'isolat » ne dit rien de la depense, et le
  // total du jour ne se repartit pas a l'oeil : sans cette valeur, impossible
  // de savoir ce que pese un ingredient dans la note.
  const target = targetOf(entry, data)
  const cost = target === null ? null : mealPlanEntryCost(entry, target)

  return (
    <li className="meal">
      {/* Toute la ligne ouvre la feuille du repas : quantite, deplacement et
          retrait y sont reunis. Le desktop n'exposait qu'un ✕ de 22 px, sous la
          cible tactile minimale. */}
      <button type="button" className="meal__button" onClick={() => onEdit(entry)}>
        <span className="meal__icon" aria-hidden="true">
          {entry.recipeId !== null ? '🍽' : '🥕'}
        </span>
        <span className="meal__body">
          <span className="meal__name">{name}</span>
          <span className="meal__meta">
            <span>{entryAmountLabel(entry)}</span>
            {kcal > 0 && <span>{Math.round(kcal).toLocaleString('fr-FR')} kcal</span>}
            {/* Un prix inconnu ne s'affiche pas en « 0,00 € » : le panneau de
                cout compte deja ces lignes et le dit en toutes lettres. */}
            {cost !== null && <span className="meal__cost">{formatEuros(cost.toFixed(4))}</span>}
          </span>
        </span>
        <span className="meal__chevron" aria-hidden="true">
          ›
        </span>
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Totaux
// ---------------------------------------------------------------------------

interface NutrientRow {
  readonly key: keyof NutritionTotal
  readonly label: string
  readonly unit: string
  readonly decimals: number
  /** Ligne « dont … », en retrait et en gris comme sur l'etiquetage. */
  readonly sub?: boolean | undefined
}

/** Ordre du reglement UE 1169/2011, celui de l'etiquetage alimentaire. */
const NUTRIENT_ROWS: readonly NutrientRow[] = [
  { key: 'kcal', label: 'Énergie', unit: 'kcal', decimals: 0 },
  { key: 'fats', label: 'Lipides', unit: 'g', decimals: 1 },
  { key: 'saturatedFats', label: 'dont acides gras saturés', unit: 'g', decimals: 1, sub: true },
  { key: 'carbs', label: 'Glucides', unit: 'g', decimals: 1 },
  { key: 'sugars', label: 'dont sucres', unit: 'g', decimals: 1, sub: true },
  { key: 'fiber', label: 'Fibres', unit: 'g', decimals: 1 },
  { key: 'proteins', label: 'Protéines', unit: 'g', decimals: 1 },
  { key: 'salt', label: 'Sel', unit: 'g', decimals: 2 },
]

function DayTotals({
  data,
  dayEntries,
  weekEntries,
}: {
  data: CalendarResponse
  dayEntries: readonly SavedEntry[]
  weekEntries: CalendarResponse['entries']
}) {
  const dayTotal = useMemo(() => sumNutrition(dayEntries, data), [dayEntries, data])
  const weekTotal = useMemo(() => sumNutrition(weekEntries, data), [weekEntries, data])
  const dayCost = useMemo(() => entriesCost(dayEntries, data), [dayEntries, data])
  const weekCost = useMemo(() => entriesCost(weekEntries, data), [weekEntries, data])

  return (
    <>
      <div className="card">
        <h3 className="card__title">Apports</h3>
        <div className="table-scroll">
          <table className="nutrition-table">
            <thead>
              <tr>
                <th scope="col">Nutriment</th>
                <th scope="col">Jour</th>
                <th scope="col">Semaine</th>
              </tr>
            </thead>
            <tbody>
              {NUTRIENT_ROWS.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className={row.sub ? 'unit' : undefined}>
                    <NutrientLabel nutrient={row.key} label={row.label} sub={row.sub ?? false} />
                  </th>
                  <td>{formatNutrient(dayEntries.length, dayTotal[row.key], row)}</td>
                  <td>{formatNutrient(weekEntries.length, weekTotal[row.key], row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="card__title">Coût</h3>
        <dl className="kv">
          <div className="kv__pair">
            <dt>Ce jour</dt>
            <dd>{formatEuros(dayCost.total)}</dd>
          </div>
          <div className="kv__pair">
            <dt>La semaine</dt>
            <dd>{formatEuros(weekCost.total)}</dd>
          </div>
        </dl>
        {weekCost.missingCount > 0 && (
          <p className="note">
            <span aria-hidden="true">⚠ </span>
            {weekCost.missingCount} repas sans prix connu cette semaine : le total est partiel.
          </p>
        )}
      </div>
    </>
  )
}

/**
 * Une valeur nutritionnelle.
 *
 * « — » quand il n'y a rien a totaliser : afficher « 0 kcal » pour une journee
 * vide laisserait croire a une donnee mesuree. Une macro inconnue, elle,
 * compte pour 0 dans l'agregat — regle du domaine, reprise du desktop.
 */
function formatNutrient(entryCount: number, value: number, row: NutrientRow): string {
  if (entryCount === 0) return '—'
  const formatted = value.toLocaleString('fr-FR', {
    minimumFractionDigits: row.decimals,
    maximumFractionDigits: row.decimals,
  })
  return `${formatted} ${row.unit}`
}
