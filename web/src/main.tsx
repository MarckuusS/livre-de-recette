import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router'

import { AuthGate } from './AuthGate.js'
import { ApiError } from './lib/api.js'
import { keepAppUpToDate } from './lib/appUpdate.js'
import { preventBrowserZoom } from './lib/gestures.js'
import './styles/theme.css'
import './styles/app.css'
import './styles/icons.css'

/**
 * Un 401 sur N'IMPORTE QUELLE requete bascule immediatement l'application sur
 * l'ecran de connexion.
 *
 * Le traiter ici plutot que dans chaque ecran garantit qu'aucun appel n'est
 * oublie : une session expiree pendant qu'on consulte sa liste de courses ne
 * doit pas produire un message d'erreur incomprehensible.
 */
const onError = (error: unknown) => {
  if (error instanceof ApiError && error.isUnauthenticated) {
    queryClient.setQueryData(['session'], { authenticated: false })
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      // L'app est en ligne par choix, mais le reseau en magasin est mauvais :
      // on reessaie deux fois avant d'afficher une erreur. Inutile en
      // revanche de s'acharner sur un 401, qui ne se resoudra pas tout seul.
      retry: (failureCount, error) =>
        error instanceof ApiError && error.isUnauthenticated ? false : failureCount < 2,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
})

// Avant le premier rendu : le pincement ne doit jamais avoir l'occasion de
// zoomer, pas meme pendant le chargement.
preventBrowserZoom()

// Le script de chargement genere par vite-plugin-pwa enregistre le service
// worker et s'arrete la. Sans ce complement, une PWA installee peut continuer
// d'afficher une version publiee des jours plus tot. Voir lib/appUpdate.ts.
keepAppUpToDate()

const root = document.getElementById('root')
if (!root) throw new Error('#root introuvable')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthGate />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
