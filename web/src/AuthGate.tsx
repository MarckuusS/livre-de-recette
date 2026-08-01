import { useQuery, useQueryClient } from '@tanstack/react-query'

import { App } from './App.js'
import { ApiError, checkSession } from './lib/api.js'
import { LoginScreen } from './screens/LoginScreen.js'

/**
 * Decide, au lancement, entre l'ecran de connexion et l'application.
 *
 * L'etat d'authentification est une entree de cache comme une autre : le
 * gestionnaire global de `main.tsx` la met a `false` des qu'une requete
 * quelconque renvoie 401, ce qui fait basculer cet ecran sans qu'aucun
 * appelant n'ait a s'en preoccuper.
 */
export function AuthGate() {
  const client = useQueryClient()

  const session = useQuery({
    queryKey: ['session'],
    queryFn: checkSession,
    retry: false,
    // La session dure trois mois : inutile de la reverifier a chaque retour
    // sur l'onglet. Un 401 sur une vraie requete la remettra a jour.
    staleTime: Infinity,
  })

  if (session.isPending) {
    return (
      <div className="login">
        <div className="card login__card" aria-busy="true">
          <span className="skeleton skeleton--line" />
        </div>
      </div>
    )
  }

  // Panne reseau au lancement : afficher l'ecran de connexion serait
  // trompeur — le mot de passe est peut-etre valide, c'est le serveur qui
  // est injoignable.
  if (session.isError && !(session.error instanceof ApiError && session.error.isUnauthenticated)) {
    return (
      <div className="login">
        <div className="card login__card">
          <h1 className="login__title">Hors ligne</h1>
          <p className="card__lead">
            {session.error instanceof Error ? session.error.message : 'Serveur injoignable.'}
          </p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void session.refetch()}
          >
            Réessayer
          </button>
        </div>
      </div>
    )
  }

  if (!session.data?.authenticated) {
    return (
      <LoginScreen
        onSuccess={() => {
          client.setQueryData(['session'], { authenticated: true })
          // Les requetes lancees avant la connexion ont echoue en 401 :
          // sans cette invalidation, les ecrans resteraient sur leur erreur.
          void client.invalidateQueries()
        }}
      />
    )
  }

  return <App />
}
