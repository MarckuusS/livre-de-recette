/**
 * Frigo & cellier — l'inventaire physique du foyer.
 *
 * Deux idees portent cet ecran, et rien d'autre ne devrait s'y ajouter :
 *
 *   1. Le LOT est l'unite. Deux briques de lait ouvertes a une semaine d'ecart
 *      ne se confondent pas : elles ont deux peremptions, on consomme la plus
 *      urgente. La liste est donc une liste de lots, pas d'ingredients.
 *   2. Ce qui est range ici est RETRANCHE de la liste de courses. C'est la
 *      raison d'etre de l'ecran, et elle n'a rien d'evident : elle est ecrite
 *      en toutes lettres sous l'en-tete, avec un lien vers la liste.
 *
 * Le desktop offrait un panneau lateral de chips a glisser-deposer sur la
 * liste. Il n'est pas porte : le glisser-deposer HTML5 ne fonctionne pas au
 * doigt sous iOS, et le geste equivalent — chercher, taper, valider — est deja
 * celui de la feuille d'ajout. La regle metier qu'il portait (quantite par
 * defaut = 1 piece si l'ingredient en a une, 100 g sinon) est conservee la-bas.
 *
 * Le tri, le groupement et le filtre vivent dans l'URL et non dans un
 * `useState` : debout devant le frigo, un rafraichissement accidentel ne doit
 * pas renvoyer l'utilisateur au tri par defaut.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { SelectField } from '../components/Field.js'
import { EmptyState, ErrorState, LoadingRows } from '../components/States.js'
import { usePantry } from '../lib/queries.js'
import { AddStockSheet } from './frigo/AddStockSheet.js'
import { LotSheet } from './frigo/LotSheet.js'
import {
  GROUPS,
  SORTS,
  buildLots,
  filterLots,
  formatExpiryLabel,
  formatLotQuantity,
  formatLotTotal,
  groupLots,
  readOption,
  sortLots,
  type GroupValue,
  type Lot,
  type LotSection,
  type SortValue,
} from './frigo/lots.js'
import '../styles/pantry.css'

/** Seuil du seau « a consommer vite », en jours. Il inclut les lots deja perimes. */
const SOON_THRESHOLD_DAYS = 5

export function PantryScreen() {
  const query = usePantry()
  const today = useToday()

  const [params, setParams] = useSearchParams()
  const filter = params.get('q') ?? ''
  const sort = readOption<SortValue>(params.get('tri'), SORTS, 'urgence')
  const group = readOption<GroupValue>(params.get('groupe'), GROUPS, 'urgence')

  const setParam = (key: string, value: string, fallback: string) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        // La valeur par defaut ne s'ecrit pas : l'adresse reste courte et
        // partageable tant qu'on n'a rien change.
        if (value === fallback) next.delete(key)
        else next.set(key, value)
        return next
      },
      // `replace` : filtrer lettre par lettre n'a pas a remplir l'historique,
      // le bouton Retour du telephone doit ramener a l'ecran precedent.
      { replace: true },
    )
  }

  const [addingStock, setAddingStock] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)

  const lots = useMemo(
    () => (query.data ? buildLots(query.data.items, query.data.ingredients, today) : []),
    [query.data, today],
  )
  const visible = useMemo(() => sortLots(filterLots(lots, filter), sort), [lots, filter, sort])
  const sections = useMemo(() => groupLots(visible, group), [visible, group])

  // Le lot en cours d'edition est relu a chaque rendu dans la liste complete :
  // la feuille suit ainsi les ecritures (une consommation change la quantite)
  // et se ferme d'elle-meme quand le lot disparait. On cherche dans `lots` et
  // non dans `visible`, sans quoi filtrer pendant l'edition la refermerait.
  const editing = editingId === null ? null : (lots.find((lot) => lot.id === editingId) ?? null)

  const soonCount = visible.filter(
    (lot) => lot.daysLeft !== null && lot.daysLeft <= SOON_THRESHOLD_DAYS,
  ).length

  return (
    <section className="screen screen--pantry">
      <p className="pantry-note">
        Ce que tu ranges ici est <strong>retranché de ta liste de courses</strong> : un ingrédient
        déjà couvert par le frigo y arrive coché. <Link to="/courses">Voir la liste</Link>
      </p>

      {query.isPending && <LoadingRows />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.isSuccess && lots.length > 0 && (
        <>
          <PantryToolbar
            filter={filter}
            sort={sort}
            group={group}
            onFilterChange={(value) => setParam('q', value, '')}
            onSortChange={(value) => setParam('tri', value, 'urgence')}
            onGroupChange={(value) => setParam('groupe', value, 'urgence')}
          />
          <p className="pantry-summary">
            <span>
              {visible.length} article{visible.length > 1 ? 's' : ''}
              {visible.length !== lots.length && ` sur ${lots.length}`}
            </span>
            {soonCount > 0 && (
              <span className="pantry-summary__alert">
                <span aria-hidden="true">⚠️</span> {soonCount} à consommer rapidement
              </span>
            )}
          </p>
        </>
      )}

      {query.isSuccess && lots.length === 0 && (
        <EmptyState title="Frigo vide">
          Rien en stock pour l’instant. Ajoute ce que tu as sous la main : la liste de courses en
          tiendra compte dès le prochain calcul.{' '}
          <button type="button" className="button button--ghost" onClick={() => setAddingStock(true)}>
            Ajouter au stock
          </button>
        </EmptyState>
      )}

      {/* Deux etats vides distincts, la ou le desktop n'en avait qu'un : « frigo
          vide » quand il n'y a rien, « rien ne correspond » quand c'est le
          filtre qui masque tout. Le message unique laissait croire a un frigo
          vide alors qu'un mot restait dans le champ. */}
      {query.isSuccess && lots.length > 0 && visible.length === 0 && (
        <EmptyState title="Aucun résultat">
          Rien ne correspond à « {filter} » dans ton frigo.{' '}
          <button type="button" className="button button--ghost" onClick={() => setParam('q', '', '')}>
            Effacer le filtre
          </button>
        </EmptyState>
      )}

      {sections.map((section) => (
        <PantrySection key={section.key} section={section} onOpen={setEditingId} />
      ))}

      {query.isSuccess && (
        <button
          type="button"
          className="pantry-fab"
          onClick={() => setAddingStock(true)}
          aria-label="Ajouter au stock"
        >
          <span aria-hidden="true">+</span>
        </button>
      )}

      {addingStock && <AddStockSheet onClose={() => setAddingStock(false)} />}
      {editing && <LotSheet key={editing.id} lot={editing} onClose={() => setEditingId(null)} />}
    </section>
  )
}

// ---------------------------------------------------------------------------

function PantryToolbar({
  filter,
  sort,
  group,
  onFilterChange,
  onSortChange,
  onGroupChange,
}: {
  filter: string
  sort: SortValue
  group: GroupValue
  onFilterChange: (value: string) => void
  onSortChange: (value: SortValue) => void
  onGroupChange: (value: GroupValue) => void
}) {
  return (
    <div className="pantry-toolbar">
      <div className="pantry-toolbar__search">
        {/* Filtrage cote client : le frigo d'un foyer tient en quelques dizaines
            de lignes, et une requete HTTP par frappe — ce que faisait le
            desktop en SQL local — est inacceptable en 4G. */}
        <input
          type="search"
          className="search-field"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="Filtrer par nom…"
          aria-label="Filtrer par nom"
          autoComplete="off"
          enterKeyHint="search"
        />
        {filter !== '' && (
          <button
            type="button"
            className="pantry-toolbar__clear"
            onClick={() => onFilterChange('')}
            aria-label="Effacer le filtre"
          >
            <span aria-hidden="true">✕</span>
          </button>
        )}
      </div>

      <div className="pantry-toolbar__options">
        <SelectField
          label="Trier"
          value={sort}
          onChange={(value) => onSortChange(readOption<SortValue>(value, SORTS, 'urgence'))}
          options={SORTS.map((option) => ({ value: option.value, label: option.label }))}
        />
        <SelectField
          label="Grouper"
          value={group}
          onChange={(value) => onGroupChange(readOption<GroupValue>(value, GROUPS, 'urgence'))}
          options={GROUPS.map((option) => ({ value: option.value, label: option.label }))}
        />
      </div>
    </div>
  )
}

function PantrySection({
  section,
  onOpen,
}: {
  section: LotSection
  onOpen: (id: number) => void
}) {
  return (
    <div className="pantry-section">
      {section.title !== null && (
        <h2
          className={`section-header pantry-section__header${
            section.bucket ? ` section-header--${section.bucket}` : ''
          }`}
        >
          {section.title}
          {section.hint && <span className="section-header__hint"> · {section.hint}</span>}
        </h2>
      )}
      <ul className="lot-list">
        {section.lots.map((lot) => (
          <LotRow key={lot.id} lot={lot} onOpen={onOpen} />
        ))}
      </ul>
    </div>
  )
}

function LotRow({ lot, onOpen }: { lot: Lot; onOpen: (id: number) => void }) {
  return (
    <li className={`lot lot--${lot.bucket}`}>
      {/* Toute la ligne ouvre la fiche du lot. Sur le desktop, cliquer une
          ligne ne faisait rien : le seul geste possible etait la croix de
          suppression, et modifier une quantite imposait de tout ressaisir. */}
      <button type="button" className="lot__open" onClick={() => onOpen(lot.id)}>
        <span className="lot__body">
          <span className="lot__name">{lot.name}</span>
          <span className="lot__meta">
            <span>{formatLotQuantity(lot)}</span>
            <span className={`lot__expiry lot__expiry--${lot.bucket}`}>
              {formatExpiryLabel(lot.daysLeft)}
            </span>
            {lot.siblingCount > 1 && (
              <span className="lot__siblings">
                {lot.siblingCount} lots · {formatLotTotal(lot)}
              </span>
            )}
          </span>
          {lot.stock.notes && <span className="lot__notes">{lot.stock.notes}</span>}
        </span>
        <span className="lot__chevron" aria-hidden="true">
          ›
        </span>
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------

/**
 * La date du jour, renouvelee au retour au premier plan.
 *
 * Les seaux d'urgence se calculent par rapport a aujourd'hui. Une PWA reste
 * ouverte des jours entiers en arriere-plan : sans ce reveil, « périme demain »
 * resterait affiche une semaine. On ne remplace l'objet que si le JOUR a
 * change, sinon chaque retour d'onglet recalculerait toute la liste.
 */
function useToday(): Date {
  const [today, setToday] = useState(() => new Date())

  useEffect(() => {
    const sync = () => {
      if (document.visibilityState !== 'visible') return
      setToday((previous) => (previous.toDateString() === new Date().toDateString() ? previous : new Date()))
    }
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  return today
}
