import type { ReactNode } from 'react'

import { ApiError } from '../lib/api.js'

/**
 * Etats de chargement, d'erreur et de vide, partages par tous les ecrans.
 *
 * Le desktop n'en avait quasiment aucun : tout y etait synchrone sur du SQLite
 * local. En web, chaque lecture est un aller-retour reseau, et le telephone
 * est souvent sur un mauvais reseau — ces trois etats deviennent la regle,
 * pas l'exception.
 */

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="card" aria-busy="true" aria-label="Chargement">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <span className="skeleton skeleton--box" />
          <span className="skeleton skeleton--line" />
        </div>
      ))}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const offline = error instanceof ApiError && error.isOffline
  return (
    <div className="card">
      <h2 className="card__title">{offline ? 'Pas de connexion' : 'Chargement impossible'}</h2>
      <p className="card__lead">
        {offline
          ? 'Le réseau est mauvais ici. Réessaie dans un instant.'
          : error instanceof Error
            ? error.message
            : 'Erreur inconnue.'}
      </p>
      {onRetry && (
        <button type="button" className="button button--secondary" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card">
      <h2 className="card__title">{title}</h2>
      <p className="card__lead">{children}</p>
    </div>
  )
}

/** Pastille de source : CIQUAL, OpenFoodFacts, manuel, Lidl. */
export function SourceBadge({ source }: { source: string }) {
  const labels: Record<string, string> = {
    ciqual: 'CIQUAL',
    openfoodfacts: 'OFF',
    manual: 'manuel',
    lidl: 'Lidl',
  }
  return <span className={`badge badge--source badge--${source}`}>{labels[source] ?? source}</span>
}
