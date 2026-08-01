import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  formatShoppingQuantity,
  formatAsText,
  groupByCategory,
  isValidIsoWeek,
  nextIsoWeek,
  previousIsoWeek,
  type ShoppingItem,
} from '@livre/shared'

import { ApiError } from '../lib/api.js'
import { useCurrentWeek, useShoppingList, useToggleChecked, type ShoppingListResponse } from '../lib/queries.js'

/**
 * Liste de courses — le premier ecran livre pour de bon.
 *
 * C'est l'usage numero un de l'application sur telephone, et le seul qui soit
 * strictement meilleur en mobile qu'en desktop : on l'a dans la main, dans les
 * rayons. Tout le reste de l'ergonomie decoule de la : cibles larges, sections
 * collantes, total toujours visible, cases qui survivent a un rafraichissement.
 */
export function ShoppingScreen() {
  const currentWeek = useCurrentWeek()
  // La semaine vit dans l'URL : le lien est partageable, le bouton Retour du
  // telephone revient a la semaine precedemment consultee, et un
  // rafraichissement en magasin ne ramene pas a la semaine courante.
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('semaine')
  const isoWeek = requested && isValidIsoWeek(requested) ? requested : currentWeek

  const setIsoWeek = (week: string) => {
    // `replace` : chaque flèche n'ajoute pas une entree d'historique, sans quoi
    // le bouton Retour obligerait a remonter semaine par semaine.
    setSearchParams(week === currentWeek ? {} : { semaine: week }, { replace: true })
  }

  const query = useShoppingList(isoWeek)

  return (
    <section className="screen screen--shopping">
      <WeekPicker
        isoWeek={isoWeek}
        isCurrent={isoWeek === currentWeek}
        onChange={setIsoWeek}
        onToday={() => setIsoWeek(currentWeek)}
      />

      {query.isPending && <ListSkeleton />}
      {query.isError && <ErrorCard error={query.error} onRetry={() => void query.refetch()} />}
      {query.isSuccess && <ShoppingContent isoWeek={isoWeek} list={query.data} />}
    </section>
  )
}

// ---------------------------------------------------------------------------

function WeekPicker({
  isoWeek,
  isCurrent,
  onChange,
  onToday,
}: {
  isoWeek: string
  isCurrent: boolean
  onChange: (week: string) => void
  onToday: () => void
}) {
  const week = isoWeek.slice(6)
  return (
    <div className="week-picker">
      <button type="button" className="week-picker__arrow" onClick={() => onChange(previousIsoWeek(isoWeek))} aria-label="Semaine précédente">
        ‹
      </button>
      <button type="button" className="week-picker__label" onClick={onToday} disabled={isCurrent}>
        <span className="week-picker__week">Semaine {week}</span>
        <span className="week-picker__year">{isCurrent ? 'cette semaine' : isoWeek.slice(0, 4)}</span>
      </button>
      <button type="button" className="week-picker__arrow" onClick={() => onChange(nextIsoWeek(isoWeek))} aria-label="Semaine suivante">
        ›
      </button>
    </div>
  )
}

function ShoppingContent({ isoWeek, list }: { isoWeek: string; list: ShoppingListResponse }) {
  const toggle = useToggleChecked(isoWeek)
  const checked = useMemo(() => new Set(list.checkedIngredientIds), [list.checkedIngredientIds])
  const sections = useMemo(() => groupByCategory(list.items), [list.items])

  if (list.items.length === 0) {
    return (
      <div className="card">
        <h2 className="card__title">Rien à acheter</h2>
        <p className="card__lead">
          Aucun repas n’est prévu cette semaine. Ajoute des recettes au calendrier et la liste se
          remplira toute seule.
        </p>
      </div>
    )
  }

  const setChecked = (ingredientId: number, next: boolean) => {
    const ids = new Set(checked)
    if (next) ids.add(ingredientId)
    else ids.delete(ingredientId)
    toggle.mutate([...ids])
  }

  const remaining = list.items.filter((i) => !checked.has(i.ingredientId)).length

  return (
    <>
      {sections.map((section) => (
        <div key={section.category} className="shopping-section">
          <h2 className="shopping-section__header">{section.category}</h2>
          <ul className="shopping-list">
            {section.items.map((item) => (
              <ShoppingRow
                key={item.ingredientId}
                item={item}
                checked={checked.has(item.ingredientId)}
                onToggle={(next) => setChecked(item.ingredientId, next)}
              />
            ))}
          </ul>
        </div>
      ))}

      <ShoppingFooter list={list} remaining={remaining} />
    </>
  )
}

function ShoppingRow({
  item,
  checked,
  onToggle,
}: {
  item: ShoppingItem
  checked: boolean
  onToggle: (next: boolean) => void
}) {
  return (
    <li className={`shopping-row${checked ? ' shopping-row--checked' : ''}`}>
      {/* Le <label> englobe toute la ligne : la zone de tap fait la largeur
          de l'ecran, pas les 24 px de la case. Decisif avec un panier au bras. */}
      <label className="shopping-row__label">
        <input
          type="checkbox"
          className="shopping-row__checkbox"
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="shopping-row__body">
          <span className="shopping-row__name">{item.name}</span>
          <span className="shopping-row__meta">
            {formatShoppingQuantity(item)}
            {item.isCoveredByPantry && <span className="badge badge--pantry">déjà au frigo</span>}
          </span>
        </span>
        <span className="shopping-row__cost">
          {item.costEur ? `${item.costEur.replace('.', ',')} €` : '—'}
        </span>
      </label>
    </li>
  )
}

function ShoppingFooter({ list, remaining }: { list: ShoppingListResponse; remaining: number }) {
  const [shared, setShared] = useState<'idle' | 'copied'>('idle')

  const share = async () => {
    const text = formatAsText(list)
    // navigator.share ouvre la feuille de partage iOS ; sur desktop elle
    // n'existe pas, d'ou le repli presse-papiers.
    if (navigator.share) {
      try {
        await navigator.share({ title: `Liste de courses ${list.isoWeek}`, text })
        return
      } catch {
        // L'utilisateur a annule le partage : on ne bascule pas sur la copie,
        // ce serait faire quelque chose qu'il vient de refuser.
        return
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      setShared('copied')
      setTimeout(() => setShared('idle'), 2000)
    } catch {
      /* presse-papiers refuse (contexte non securise) : on n'affiche rien */
    }
  }

  return (
    <div className="shopping-footer">
      <div className="shopping-footer__totals">
        <strong className="shopping-footer__amount">{list.totalEur.replace('.', ',')} €</strong>
        <span className="shopping-footer__detail">
          {remaining === 0 ? 'tout est coché' : `${remaining} article${remaining > 1 ? 's' : ''} restant${remaining > 1 ? 's' : ''}`}
          {list.missingPriceCount > 0 && ` · ${list.missingPriceCount} sans prix`}
        </span>
      </div>
      <button type="button" className="button button--primary" onClick={() => void share()}>
        {shared === 'copied' ? 'Copié' : 'Partager'}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------

function ListSkeleton() {
  // Le desktop n'avait aucun etat de chargement : tout etait synchrone sur du
  // SQLite local. Ici chaque lecture est un aller-retour reseau.
  return (
    <div className="card" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skeleton-row">
          <span className="skeleton skeleton--box" />
          <span className="skeleton skeleton--line" />
        </div>
      ))}
    </div>
  )
}

function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const offline = error instanceof ApiError && error.isOffline
  return (
    <div className="card">
      <h2 className="card__title">{offline ? 'Pas de connexion' : 'Liste indisponible'}</h2>
      <p className="card__lead">
        {offline
          ? 'Le réseau est mauvais ici. Réessaie dans un instant.'
          : error instanceof Error
            ? error.message
            : 'Erreur inconnue.'}
      </p>
      <button type="button" className="button button--secondary" onClick={onRetry}>
        Réessayer
      </button>
    </div>
  )
}
