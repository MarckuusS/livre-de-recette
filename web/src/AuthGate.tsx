import { createContext, useContext } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMatch, useNavigate } from 'react-router'

import { App } from './App.js'
import { ApiError, checkSession, type SessionUser } from './lib/api.js'
import { InvitationScreen } from './screens/InvitationScreen.js'
import { LoginScreen } from './screens/LoginScreen.js'

const UserContext = createContext<SessionUser | null>(null)

/** L'utilisateur connecte. Ne peut etre `null` a l'interieur de <App>. */
export const useCurrentUser = (): SessionUser => {
  const user = useContext(UserContext)
  if (!user) throw new Error('useCurrentUser appelé hors session')
  return user
}

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
  const navigate = useNavigate()

  /*
   * L'INVITATION PASSE AVANT LA GARDE, et ne peut pas passer apres.
   *
   * Son destinataire n'a pas encore de session : l'envoyer sur l'ecran de
   * connexion lui demanderait le mot de passe qu'il vient justement d'etre
   * invite a choisir. La verification de session est donc desactivee ici —
   * sans quoi elle partirait pour un 401 previsible a chaque ouverture du
   * lien.
   */
  const invitation = useMatch('/invitation/:jeton')

  const session = useQuery({
    queryKey: ['session'],
    queryFn: checkSession,
    retry: false,
    enabled: invitation === null,
    // La session dure trois mois : inutile de la reverifier a chaque retour
    // sur l'onglet. Un 401 sur une vraie requete la remettra a jour.
    staleTime: Infinity,
  })

  if (invitation !== null) {
    return (
      <InvitationScreen
        jeton={invitation.params.jeton ?? ''}
        onSuccess={(nouveau) => {
          // Le serveur a pose le cookie de session : on renseigne le cache et
          // on quitte l'adresse d'invitation, dont le jeton est desormais
          // consomme. `replace` pour que le geste retour n'y revienne pas.
          client.setQueryData(['session'], { authenticated: true, user: nouveau })
          void navigate('/accueil', { replace: true })
        }}
      />
    )
  }

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
  // trompeur — les identifiants sont peut-etre valides, c'est le serveur qui
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

  const user = session.data?.authenticated ? session.data.user : null

  if (!user) {
    return (
      <LoginScreen
        onSuccess={(loggedIn) => {
          client.setQueryData(['session'], { authenticated: true, user: loggedIn })
          // Les requetes lancees avant la connexion ont echoue en 401 :
          // sans cette invalidation, les ecrans resteraient sur leur erreur.
          void client.invalidateQueries()
        }}
      />
    )
  }

  return (
    <UserContext.Provider value={user}>
      <App />
    </UserContext.Provider>
  )
}
