/**
 * Client HTTP de l'API.
 *
 * Meme origine que le front : les chemins sont toujours relatifs, jamais une
 * URL absolue. En developpement, le proxy Vite renvoie /api vers le Worker.
 *
 * La session vit dans un cookie `HttpOnly` : ce code ne la voit pas, ne la
 * stocke pas et n'a rien a lui faire. Il se contente de reconnaitre un 401
 * et de laisser l'application afficher l'ecran de connexion.
 */

export interface ApiErrorBody {
  readonly error: { readonly code: string; readonly message: string }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }

  /** Vrai quand l'erreur vient du reseau, pas d'une reponse du serveur. */
  get isOffline(): boolean {
    return this.status === 0
  }

  /** Session absente ou expiree : il faut se reconnecter. */
  get isUnauthenticated(): boolean {
    return this.status === 401
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      // Le cookie de session part avec la requete. 'same-origin' est deja le
      // defaut, mais l'expliciter evite qu'un changement de configuration ne
      // casse silencieusement l'authentification.
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...init?.headers },
    })
  } catch {
    // fetch ne rejette que sur une panne reseau : le telephone est hors
    // couverture, ou le serveur est injoignable.
    throw new ApiError(0, 'network', 'Pas de connexion. Vérifie ton réseau.')
  }

  if (!response.ok) {
    let code = 'unknown'
    let message = `Erreur ${response.status}.`
    try {
      const body = (await response.json()) as Partial<ApiErrorBody>
      if (body.error) {
        code = body.error.code ?? code
        message = body.error.message ?? message
      }
    } catch {
      /* le corps n'est pas du JSON : on garde le message par defaut */
    }
    throw new ApiError(response.status, code, message)
  }

  // Une reponse 200 ne garantit pas du JSON. Le repli SPA de Cloudflare Pages
  // sert index.html sur tout chemin inconnu : sans ce controle, JSON.parse
  // echoue sur « Unexpected token '<' », message qui n'apprend rien.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new ApiError(response.status, 'not_json', "L'API ne répond pas correctement.")
  }

  return (await response.json()) as T
}

export interface HealthResponse {
  readonly status: 'ok'
  readonly version: string
  readonly database: { readonly reachable: boolean; readonly ingredients: number | null }
  readonly time: string
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface SessionUser {
  readonly id: number
  readonly username: string
  readonly displayName: string
}

export const checkSession = (): Promise<{ authenticated: boolean; user: SessionUser | null }> =>
  apiFetch('/api/session')

export const login = (username: string, password: string): Promise<{ user: SessionUser }> =>
  apiFetch('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })

export const logout = (): Promise<{ status: 'ok' }> =>
  apiFetch('/api/logout', { method: 'POST' })
