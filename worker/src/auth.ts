/**
 * Authentification multi-identifiants, donnees communes.
 *
 * Chacun son compte et son mot de passe, revocable independamment — mais une
 * seule cuisine. Aucun filtrage par proprietaire : voir la note en tete de
 * migrations/0004_users_and_activity.sql pour pourquoi c'est un choix de
 * surete et pas une facilite.
 *
 * ---------------------------------------------------------------------------
 * Deux primitives, deux usages a ne pas confondre
 * ---------------------------------------------------------------------------
 *   - Stocker un mot de passe -> PBKDF2, LENT et sale (shared/password.ts).
 *   - Signer un cookie        -> HMAC-SHA256, rapide. C'est ce fichier.
 *
 * Le cookie porte `userId.expiration.signature`. Sans le secret de session on
 * ne peut ni en forger un, ni prolonger celui qu'on a, ni changer d'identite —
 * la signature couvre les deux champs.
 *
 * Il est `HttpOnly` (invisible au JavaScript, donc hors de portee d'une XSS),
 * `Secure` et `SameSite=Strict`.
 *
 * ---------------------------------------------------------------------------
 * Le secret de session
 * ---------------------------------------------------------------------------
 * Genere aleatoirement a la premiere utilisation et range dans `app_setting`,
 * plutot que d'etre un secret Cloudflare de plus a configurer a la main.
 *
 * Ce n'est pas un affaiblissement : qui sait lire cette table sait deja lire
 * les recettes, les prix et le frigo. Le mettre ailleurs ne protegerait rien
 * de plus, et ajouterait une etape ou se tromper.
 *
 * Le supprimer deconnecte tout le monde — c'est le bouton d'urgence.
 */

import { verifyPassword, type PasswordRecord } from '@livre/shared'

const COOKIE_NAME = 'lr_session'
const SESSION_DAYS = 90
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000

const MAX_FAILURES = 10
const LOCKOUT_MS = 15 * 60 * 1000

const SESSION_SECRET_KEY = 'auth.session_secret'

const encoder = new TextEncoder()

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

export interface SessionUser {
  readonly id: number
  readonly username: string
  readonly displayName: string
}

// ---------------------------------------------------------------------------
// Secret de session
// ---------------------------------------------------------------------------

async function sessionSecret(db: D1Database): Promise<string> {
  const row = await db
    .prepare('SELECT value_json FROM app_setting WHERE key = ?')
    .bind(SESSION_SECRET_KEY)
    .first<{ value_json: string }>()

  if (row) {
    try {
      const parsed = JSON.parse(row.value_json) as { secret?: string }
      if (typeof parsed.secret === 'string' && parsed.secret.length >= 32) return parsed.secret
    } catch {
      /* valeur corrompue : on en regenere une, ce qui deconnecte tout le monde */
    }
  }

  const secret = toHex(crypto.getRandomValues(new Uint8Array(32)).buffer)
  await db
    .prepare(
      `INSERT INTO app_setting (key, value_json, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .bind(SESSION_SECRET_KEY, JSON.stringify({ secret }))
    .run()
  return secret
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
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

const buildCookie = (value: string, maxAgeSeconds: number): string =>
  [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ')

export async function issueSession(db: D1Database, userId: number): Promise<string> {
  const payload = `${userId}.${Date.now() + SESSION_MS}`
  const signature = await sign(payload, await sessionSecret(db))
  return buildCookie(`${payload}.${signature}`, Math.floor(SESSION_MS / 1000))
}

export const clearSessionCookie = (): string => buildCookie('', 0)

/**
 * Rend l'utilisateur de la requete, ou `null`.
 *
 * Le compte est relu en base a chaque appel : desactiver quelqu'un le coupe
 * immediatement, sans attendre l'expiration de son cookie.
 */
export async function currentUser(request: Request, db: D1Database): Promise<SessionUser | null> {
  const raw = readCookie(request, COOKIE_NAME)
  if (!raw) return null

  const parts = raw.split('.')
  if (parts.length !== 3) return null
  const [userIdRaw, expiresRaw, signature] = parts as [string, string, string]

  const expiresAt = Number(expiresRaw)
  const userId = Number(userIdRaw)
  if (!Number.isInteger(userId) || !Number.isFinite(expiresAt) || expiresAt < Date.now()) return null

  const expected = await sign(`${userIdRaw}.${expiresRaw}`, await sessionSecret(db))
  if (!timingSafeEqual(signature, expected)) return null

  const row = await db
    .prepare('SELECT id, username, display_name FROM user WHERE id = ? AND is_active = 1')
    .bind(userId)
    .first<{ id: number; username: string; display_name: string }>()

  return row ? { id: row.id, username: row.username, displayName: row.display_name } : null
}

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

export async function authenticate(
  db: D1Database,
  username: string,
  password: string,
): Promise<SessionUser | null> {
  const row = await db
    .prepare(
      `SELECT id, username, display_name, password_hash, password_salt, iterations
       FROM user WHERE username = ? AND is_active = 1`,
    )
    .bind(username.trim().toLowerCase())
    .first<{
      id: number
      username: string
      display_name: string
      password_hash: string
      password_salt: string
      iterations: number
    }>()

  // Meme sur un utilisateur inconnu, on derive quand meme un hash : sans cela,
  // la reponse serait bien plus rapide et permettrait d'enumerer les comptes
  // existants au chronometre.
  const record: PasswordRecord = row
    ? { hash: row.password_hash, salt: row.password_salt, iterations: row.iterations }
    : { hash: '00'.repeat(32), salt: '00'.repeat(16), iterations: 210_000 }

  const ok = await verifyPassword(password, record)
  if (!row || !ok) return null

  await db
    .prepare("UPDATE user SET last_login_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?")
    .bind(row.id)
    .run()

  return { id: row.id, username: row.username, displayName: row.display_name }
}

export async function hasAnyUser(db: D1Database): Promise<boolean> {
  const row = await db.prepare('SELECT COUNT(*) AS c FROM user WHERE is_active = 1').first<{ c: number }>()
  return (row?.c ?? 0) > 0
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

/** Secondes restantes avant de pouvoir reessayer, ou 0. */
export async function lockoutRemaining(db: D1Database): Promise<number> {
  const { lockedUntil } = await readFailures(db)
  return lockedUntil > Date.now() ? Math.ceil((lockedUntil - Date.now()) / 1000) : 0
}

export async function recordFailure(db: D1Database): Promise<void> {
  const state = await readFailures(db)
  const count = state.count + 1
  await writeFailures(db, { count, lockedUntil: count >= MAX_FAILURES ? Date.now() + LOCKOUT_MS : 0 })
}

export const resetFailures = (db: D1Database): Promise<void> =>
  writeFailures(db, { count: 0, lockedUntil: 0 })
