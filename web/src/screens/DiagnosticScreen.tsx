import { useQuery } from '@tanstack/react-query'

import { ApiError, apiFetch, type HealthResponse } from '../lib/api.js'

/**
 * Etat de l'application : version deployee, joignabilite de l'API et de la
 * base, mode d'affichage.
 *
 * Remplace le « dossier de logs » du desktop, qui ouvrait l'explorateur de
 * fichiers — sans equivalent dans un navigateur. C'est aussi le premier
 * ecran a consulter quand quelque chose ne repond pas depuis le telephone.
 */
export function DiagnosticScreen() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/api/health'),
    retry: false,
  })

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    // Safari iOS n'implemente pas display-mode et expose ce booleen non standard.
    (navigator as Navigator & { standalone?: boolean }).standalone === true

  return (
    <section className="screen">
      <div className="card">
        <h2 className="card__title">Application</h2>
        <dl className="kv">
          <dt>Version</dt>
          <dd>{__APP_VERSION__}</dd>
          <dt>Construite le</dt>
          <dd>{new Date(__BUILD_TIME__).toLocaleString('fr-FR')}</dd>
          <dt>Mode</dt>
          <dd>{standalone ? 'installée sur l’écran d’accueil' : 'onglet du navigateur'}</dd>
          <dt>Connexion</dt>
          <dd>{navigator.onLine ? 'en ligne' : 'hors ligne'}</dd>
        </dl>
      </div>

      <div className="card">
        <h2 className="card__title">API et base de données</h2>

        {health.isPending && <p className="card__lead">Vérification…</p>}

        {health.isError && (
          <>
            <p className="status status--error">
              {health.error instanceof ApiError && health.error.isOffline
                ? 'API injoignable — pas de connexion.'
                : `API injoignable — ${(health.error as Error).message}`}
            </p>
            <p className="card__lead">
              C’est attendu tant que le Worker n’est pas déployé : le front est en ligne avant lui.
            </p>
          </>
        )}

        {health.isSuccess && (
          <>
            <p className="status status--ok">API joignable</p>
            <dl className="kv">
              <dt>Version API</dt>
              <dd>{health.data.version}</dd>
              <dt>Base</dt>
              <dd>{health.data.database.reachable ? 'connectée' : 'injoignable'}</dd>
              <dt>Ingrédients</dt>
              <dd>{health.data.database.ingredients ?? '—'}</dd>
            </dl>
          </>
        )}
      </div>
    </section>
  )
}
