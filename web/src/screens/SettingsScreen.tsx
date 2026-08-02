import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useCurrentUser } from '../AuthGate.js'
import { ApiError, apiFetch, logout, type HealthResponse } from '../lib/api.js'

/**
 * Parametres : qui est connecte, ce que repond le serveur, et ce que
 * l'appareil declare de son propre affichage.
 *
 * Remplace le « dossier de logs » du desktop, qui ouvrait l'explorateur de
 * fichiers — sans equivalent dans un navigateur. C'est le premier ecran a
 * consulter quand quelque chose ne repond pas depuis le telephone, et le seul
 * moyen de diagnostiquer a distance : une capture de cet ecran contient tout
 * ce qu'il faut.
 */

// ---------------------------------------------------------------------------
// Mesures de l'affichage
// ---------------------------------------------------------------------------

interface ViewportMetrics {
  readonly screenW: number
  readonly screenH: number
  readonly innerW: number
  readonly innerH: number
  readonly vh: number
  readonly dvh: number
  /** Position du bas de la barre d'onglets. Doit egaler la hauteur de l'ecran. */
  readonly tabbarBottom: number
  readonly tabbarHeight: number
  /** Pixels de fond nu visibles SOUS la barre d'onglets. Doit valoir 0. */
  readonly belowTabbar: number
  readonly safeTop: number
  readonly safeBottom: number
  readonly standalone: boolean
}

/**
 * Releve les mesures sur l'appareil lui-meme.
 *
 * Elles existent a cause d'un defaut precis : une fois installee sur un
 * iPhone, l'application laissait une bande de fond nu sous la barre d'onglets.
 * La cause n'etait visible que sur le telephone — iOS annonce un viewport plus
 * court que l'ecran, l'ecart valant exactement la hauteur de l'encoche (48 px
 * sur un iPhone 11). Sans un endroit ou lire ces nombres, ce genre de defaut se
 * diagnostique a l'aveugle.
 *
 * « Sous la barre » est LA mesure qui compte : elle doit valoir 0.
 */
function readMetrics(): ViewportMetrics {
  // On mesure les unites CSS elles-memes : c'est leur desaccord qui fait le
  // defaut, pas la valeur de l'une d'elles prise isolement.
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;visibility:hidden;height:100vh'
  document.body.appendChild(probe)
  const vh = probe.getBoundingClientRect().height
  probe.style.height = '100dvh'
  const dvh = probe.getBoundingClientRect().height
  document.body.removeChild(probe)

  const px = (value: string): number => Math.round(Number.parseFloat(value) || 0)
  const style = getComputedStyle(document.documentElement)

  // Positions REELLES, telles que le navigateur les a posees. Plus fiable que
  // de relire les regles CSS : `getPropertyValue('--app-height')` rend la
  // chaine « 100dvh », pas une longueur, et l'analyser donnerait 100.
  const tabbar = document.querySelector('.tabbar')
  const rect = tabbar?.getBoundingClientRect()
  const screenH = window.screen.height

  return {
    screenW: window.screen.width,
    screenH,
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    vh: Math.round(vh),
    dvh: Math.round(dvh),
    tabbarBottom: rect ? Math.round(rect.bottom) : 0,
    tabbarHeight: rect ? Math.round(rect.height) : 0,
    // L'ecart entre le bas de la barre et le bas de l'ecran physique.
    belowTabbar: rect ? Math.max(Math.round(screenH - rect.bottom), 0) : 0,
    safeTop: px(style.getPropertyValue('--safe-top')),
    safeBottom: px(style.getPropertyValue('--safe-bottom')),
    standalone:
      window.matchMedia('(display-mode: standalone)').matches ||
      // Safari iOS n'implemente pas display-mode et expose ce booleen non standard.
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
  }
}

function useViewportMetrics(): ViewportMetrics {
  const [metrics, setMetrics] = useState(readMetrics)

  useEffect(() => {
    // Un premier relevé au montage : la barre d'onglets n'est pas forcement
    // posee au moment du rendu initial, et sa position fait toute la mesure.
    const refresh = () => setMetrics(readMetrics())
    const timer = setTimeout(refresh, 0)

    window.addEventListener('resize', refresh)
    window.addEventListener('orientationchange', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', refresh)
      window.removeEventListener('orientationchange', refresh)
    }
  }, [])

  return metrics
}

// ---------------------------------------------------------------------------

export function SettingsScreen() {
  const me = useCurrentUser()
  const client = useQueryClient()
  const view = useViewportMetrics()

  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/api/health'),
    retry: false,
  })

  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      client.setQueryData(['session'], { authenticated: false, user: null })
      client.clear()
    },
  })

  return (
    <section className="screen">
      <div className="card">
        <h2 className="card__title">Compte</h2>
        <dl className="kv">
          <dt>Connecté</dt>
          <dd>{me.displayName}</dd>
          <dt>Identifiant</dt>
          <dd>{me.username}</dd>
        </dl>
        <p className="card__lead">
          <Link to="/activite">Journal d’activité</Link> — qui a ajouté, modifié ou supprimé quoi.
        </p>
      </div>

      <div className="card">
        <h2 className="card__title">Serveur</h2>

        {health.isPending && <p className="card__lead">Vérification…</p>}

        {health.isError && (
          <>
            <p className="status status--error">
              {health.error instanceof ApiError && health.error.isOffline
                ? 'API injoignable — pas de connexion.'
                : `API injoignable — ${(health.error as Error).message}`}
            </p>
            <p className="card__lead">
              Si le réseau est bon, ferme puis rouvre l’application : la session a peut-être expiré.
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

      <div className="card">
        <h2 className="card__title">Application</h2>
        <dl className="kv">
          <dt>Version</dt>
          <dd>{__APP_VERSION__}</dd>
          <dt>Construite le</dt>
          <dd>{new Date(__BUILD_TIME__).toLocaleString('fr-FR')}</dd>
          <dt>Mode</dt>
          <dd>{view.standalone ? 'installée' : 'onglet du navigateur'}</dd>
          <dt>Connexion</dt>
          <dd>{navigator.onLine ? 'en ligne' : 'hors ligne'}</dd>
        </dl>
      </div>

      <div className="card">
        <h2 className="card__title">Mesures de l’appareil</h2>
        <p className="card__lead">À envoyer en capture si l’affichage se comporte mal.</p>
        <dl className="kv">
          <dt>Écran</dt>
          <dd>
            {view.screenW} × {view.screenH}
          </dd>
          <dt>Viewport exposé</dt>
          <dd>
            {view.innerW} × {view.innerH}
          </dd>
          <dt>100vh</dt>
          <dd>{view.vh}</dd>
          <dt>100dvh</dt>
          <dd>{view.dvh}</dd>
          <dt>Hauteur de la barre</dt>
          <dd>{view.tabbarHeight}</dd>
          <dt>Bas de la barre</dt>
          <dd>{view.tabbarBottom}</dd>
          <dt>Sous la barre</dt>
          <dd>{view.belowTabbar}</dd>
          <dt>Marge système haute</dt>
          <dd>{view.safeTop}</dd>
          <dt>Marge système basse</dt>
          <dd>{view.safeBottom}</dd>
        </dl>

        {/* La seule ligne qui demande une action. Les autres ne sont que du
            contexte pour la comprendre. */}
        {view.belowTabbar > 0 && (
          <p className="status status--error" role="alert">
            {view.belowTabbar} px de fond apparaissent sous la barre d’onglets. Envoie cette capture.
          </p>
        )}
      </div>

      <button
        type="button"
        className="button button--secondary"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
      >
        {signOut.isPending ? 'Déconnexion…' : 'Se déconnecter'}
      </button>
    </section>
  )
}
