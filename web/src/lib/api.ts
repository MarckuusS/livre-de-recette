/**
 * Client HTTP de l'API.
 *
 * Meme origine que le front : les chemins sont toujours relatifs, jamais une
 * URL absolue. En developpement, le proxy Vite renvoie /api vers le Worker.
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
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
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

  return (await response.json()) as T
}

export interface HealthResponse {
  readonly status: 'ok'
  readonly version: string
  readonly database: { readonly reachable: boolean; readonly ingredients: number | null }
  readonly time: string
}
