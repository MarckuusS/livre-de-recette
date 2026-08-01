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

/**
 * Renvoie l'utilisateur vers la page de connexion de Cloudflare Access.
 *
 * Le passage par `/api/auth-return` n'est pas un detour inutile : le service
 * worker sert la coquille de l'app depuis son cache, donc un simple
 * `location.reload()` ne toucherait jamais le reseau et bouclerait. `/api/*`
 * est exclu du cache, la requete part donc reellement, Access l'intercepte,
 * affiche sa page de connexion, puis renvoie ici — et le Worker nous ramene
 * a l'ecran d'ou l'on venait.
 */
function redirectToLogin(): never {
  // Garde anti-boucle : si la connexion echoue malgre tout, on ne veut pas
  // faire tourner le telephone indefiniment entre deux redirections.
  const KEY = 'auth-redirect-at'
  const last = Number(sessionStorage.getItem(KEY) ?? 0)
  if (Date.now() - last < 10_000) {
    throw new ApiError(401, 'auth_loop', 'La connexion a échoué. Recharge la page.')
  }
  sessionStorage.setItem(KEY, String(Date.now()))

  const next = location.pathname + location.search
  location.href = `/api/auth-return?next=${encodeURIComponent(next)}`
  // location.href ne suspend pas l'execution : sans ce throw, l'appelant
  // continuerait a traiter une reponse qui n'existe pas.
  throw new ApiError(401, 'redirecting', 'Redirection vers la connexion…')
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      // 'manual' est indispensable : par defaut, fetch suit la redirection
      // d'Access vers cloudflareaccess.com, une autre origine, et echoue
      // avec une simple erreur reseau — impossible de distinguer une session
      // expiree d'un telephone hors couverture.
      redirect: 'manual',
      headers: { Accept: 'application/json', ...init?.headers },
    })
  } catch {
    // fetch ne rejette que sur une panne reseau : le telephone est hors
    // couverture, ou le serveur est injoignable.
    throw new ApiError(0, 'network', 'Pas de connexion. Vérifie ton réseau.')
  }

  // Session Access absente ou expiree.
  if (response.type === 'opaqueredirect' || response.status === 401) {
    redirectToLogin()
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
  // sert index.html sur tout chemin inconnu, y compris /api/* tant que le
  // Worker n'a pas de route : sans ce controle, JSON.parse echoue sur
  // « Unexpected token '<' », message qui n'apprend rien a l'utilisateur.
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    throw new ApiError(
      response.status,
      'not_json',
      "L'API ne répond pas encore sur cette adresse.",
    )
  }

  return (await response.json()) as T
}

export interface HealthResponse {
  readonly status: 'ok'
  readonly version: string
  readonly database: { readonly reachable: boolean; readonly ingredients: number | null }
  readonly time: string
}
