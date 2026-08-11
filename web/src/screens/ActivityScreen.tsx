import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { EmptyState, ErrorState, LoadingRows } from '../components/States.js'
import { apiFetch } from '../lib/api.js'

interface ActivityEntry {
  readonly id: number
  readonly userId: number | null
  readonly displayName: string | null
  readonly action: 'create' | 'update' | 'delete'
  readonly entity: string
  readonly entityId: number | null
  readonly label: string
  readonly at: string
}

const ACTION_VERBS: Record<ActivityEntry['action'], string> = {
  create: 'a ajouté',
  update: 'a modifié',
  delete: 'a supprimé',
}

const ENTITY_LABELS: Record<string, string> = {
  recipe: 'la recette',
  ingredient: "l'ingrédient",
  pantry_stock: 'au frigo',
  meal_plan_entry: 'au calendrier',
  price_history: 'un prix pour',
  cooking_log: 'une cuisson de',
  shopping_checked: '',
  rayon: 'le rayon',
  icon: 'l’icône',
}

/**
 * Qui a fait quoi.
 *
 * Deux personnes partagent la meme cuisine : sans cette page, une recette qui
 * change ou un stock qui disparait devient une devinette.
 */
export function ActivityScreen() {
  const activity = useQuery({
    queryKey: ['activity'],
    queryFn: () => apiFetch<{ items: ActivityEntry[] }>('/api/activity?limit=100'),
  })

  return (
    <section className="screen">
      <p className="card__lead">
        Deux identifiants, une seule cuisine : ce journal dit qui a fait quoi. Le compte et l’état
        de l’application sont dans les <Link to="/parametres">paramètres</Link>.
      </p>

      {activity.isPending && <LoadingRows />}
      {activity.isError && (
        <ErrorState error={activity.error} onRetry={() => void activity.refetch()} />
      )}

      {activity.isSuccess && activity.data.items.length === 0 && (
        <EmptyState title="Rien pour l’instant">
          Les ajouts, modifications et suppressions apparaîtront ici, avec leur auteur.
        </EmptyState>
      )}

      {activity.isSuccess && activity.data.items.length > 0 && (
        <div className="card card--flush">
          <h3 className="card__title card__title--padded">Activité</h3>
          <ul className="row-list row-list--flush">
            {activity.data.items.map((entry) => (
              <li key={entry.id} className="row row--static">
                <span className={`urgency-dot activity-dot--${entry.action}`} aria-hidden="true" />
                <span className="row__body">
                  <span className="row__title">
                    {/* Le nom est fige au moment de l'action : apres une
                        suppression, l'identifiant ne designe plus rien. */}
                    <strong>{entry.displayName ?? 'Compte supprimé'}</strong>{' '}
                    {ACTION_VERBS[entry.action]} {ENTITY_LABELS[entry.entity] ?? entry.entity}{' '}
                    {entry.label}
                  </span>
                  <span className="row__meta">{formatWhen(entry.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** « il y a 5 min », « hier à 19:30 », puis la date. Plus parlant qu'un horodatage. */
function formatWhen(iso: string): string {
  const then = new Date(iso)
  const minutes = Math.floor((Date.now() - then.getTime()) / 60_000)

  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  if (minutes < 24 * 60) return `il y a ${Math.floor(minutes / 60)} h`

  const time = then.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (minutes < 48 * 60) return `hier à ${time}`
  return `${then.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} à ${time}`
}
