/**
 * Authentification par mot de passe unique.
 *
 * Remplace Cloudflare Access, qui protegeait correctement mais cassait la PWA :
 * sa page de connexion vit sur une autre origine, et un `fetch()` ne peut pas
 * lire une reponse issue d'une redirection cross-origin. L'API devenait donc
 * « injoignable » des que la session expirait, sans moyen de le distinguer
 * d'une panne de reseau.
 *
 * ---------------------------------------------------------------------------
 * Ce qui rend ce code defendable
 * ---------------------------------------------------------------------------
 *
 * Aucune cryptographie n'est ecrite ici. Tout passe par `crypto.subtle`,
 * l'implementation native de la plateforme :
 *
 *   - la signature du cookie est un HMAC-SHA256. Sans le secret, on ne peut
 *     pas en fabriquer un valide, ni prolonger une date d'expiration ;
 *   - `crypto.subtle.verify` compare en TEMPS CONSTANT. Une comparaison avec
 *     `===` fuirait de l'information par le temps de reponse et permettrait de
 *     reconstituer la signature octet par octet ;
 *   - le mot de passe lui-meme est compare apres hachage, octet a octet, sans
 *     court-circuit — meme raison.
 *
 * Le cookie est `HttpOnly` (invisible au JavaScript, donc non volable par une
 * faille XSS), `Secure` (jamais en clair) et `SameSite=Strict` (inutilisable
 * depuis un autre site).
 *
 * La cle de signature EST le mot de passe : le changer invalide donc toutes
 * les sessions ouvertes. Pour un usage mono-utilisateur, c'est exactement le
 * comportement voulu — un seul secret a gerer, et une revocation immediate.
 *
 * ---------------------------------------------------------------------------
 * Ce que ce dispositif ne fait PAS
 * ---------------------------------------------------------------------------
 *
 * Pas de second facteur, pas de comptes multiples, pas de journal d'acces.
 * Et surtout : il s'execute DANS ce Worker, la ou Access refusait la requete
 * en amont. Un bug ici ouvre la porte ; avec Access, c'etait impossible.
 * Compromis accepte en connaissance de cause pour une application
 * personnelle a un seul utilisateur.
 */

const COOKIE_NAME = 'lr_session'
const SESSION_DAYS = 90
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000

/** Au-dela, toute tentative est refusee pendant `LOCKOUT_MS`. */
const MAX_FAILURES = 10
const LOCKOUT_MS = 15 * 60 * 1000

const encoder = new TextEncoder()

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

async function sign(payload: string, secret: string): Promise<string> {
  return toHex(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload)))
}

/**
 * Comparaison en temps constant.
 *
 * Les deux entrees sont d'abord hachees : la duree ne depend donc plus de la
 * longueur du mot de passe saisi, et la boucle parcourt toujours 32 octets.
 */
async function equalsConstantTime(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  const va = new Uint8Array(ha)
  const vb = new Uint8Array(hb)
  let diff = 0
  for (let i = 0; i < va.length; i++) diff |= (va[i] ?? 0) ^ (vb[i] ?? 0)
  return diff === 0
}

// ---------------------------------------------------------------------------
// Cookie
// ---------------------------------------------------------------------------

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

export function buildSessionCookie(value: string, maxAgeSeconds: number): string {
  return [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly', // invisible au JavaScript : une XSS ne peut pas le voler
    'Secure', // jamais transmis en clair
    'SameSite=Strict', // inutilisable depuis un autre site (CSRF)
  ].join('; ')
}

export async function issueSession(secret: string): Promise<string> {
  const expiresAt = String(Date.now() + SESSION_MS)
  const signature = await sign(expiresAt, secret)
  return buildSessionCookie(`${expiresAt}.${signature}`, Math.floor(SESSION_MS / 1000))
}

export const clearSessionCookie = (): string => buildSessionCookie('', 0)

/** Vrai si la requete porte une session valide et non expiree. */
export async function hasValidSession(request: Request, secret: string): Promise<boolean> {
  const raw = readCookie(request, COOKIE_NAME)
  if (!raw) return false

  const separator = raw.lastIndexOf('.')
  if (separator <= 0) return false
  const payload = raw.slice(0, separator)
  const signature = raw.slice(separator + 1)

  const expiresAt = Number(payload)
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false

  // Reconstruire la signature attendue et la comparer via verify(), qui est
  // constant-time. Une date d'expiration modifiee invalide la signature.
  const expected = await sign(payload, secret)
  return equalsConstantTime(signature, expected)
}

// ---------------------------------------------------------------------------
// Limitation des tentatives
// ---------------------------------------------------------------------------

interface FailureState {
  count: number
  lockedUntil: number
}

const FAILURE_KEY = 'auth.failures'

async function readFailures(db: D1Database): Promise<FailureState> {
  const row = await db
    .prepare('SELECT value_json FROM app_setting WHERE key = ?')
    .bind(FAILURE_KEY)
    .first<{ value_json: string }>()
  if (!row) return { count: 0, lockedUntil: 0 }
  try {
    const parsed = JSON.parse(row.value_json) as Partial<FailureState>
    return { count: Number(parsed.count ?? 0), lockedUntil: Number(parsed.lockedUntil ?? 0) }
  } catch {
    return { count: 0, lockedUntil: 0 }
  }
}

async function writeFailures(db: D1Database, state: FailureState): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_setting (key, value_json, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .bind(FAILURE_KEY, JSON.stringify(state))
    .run()
}

/** Secondes restantes avant de pouvoir reessayer, ou 0 si l'on peut essayer. */
export async function lockoutRemaining(db: D1Database): Promise<number> {
  const { lockedUntil } = await readFailures(db)
  return lockedUntil > Date.now() ? Math.ceil((lockedUntil - Date.now()) / 1000) : 0
}

export async function recordFailure(db: D1Database): Promise<void> {
  const state = await readFailures(db)
  const count = state.count + 1
  await writeFailures(db, {
    count,
    lockedUntil: count >= MAX_FAILURES ? Date.now() + LOCKOUT_MS : 0,
  })
}

export const resetFailures = (db: D1Database): Promise<void> =>
  writeFailures(db, { count: 0, lockedUntil: 0 })

// ---------------------------------------------------------------------------

export async function checkPassword(submitted: string, secret: string): Promise<boolean> {
  return equalsConstantTime(submitted, secret)
}
