/**
 * Hachage et verification de mots de passe.
 *
 * Partage entre le Worker et le script de creation de comptes : les deux
 * DOIVENT produire exactement le meme resultat, sinon un compte cree en local
 * ne peut pas se connecter en production. C'est la raison d'etre de ce module
 * commun plutot que de deux copies.
 *
 * ---------------------------------------------------------------------------
 * Pourquoi PBKDF2 et non SHA-256
 * ---------------------------------------------------------------------------
 * Stocker un mot de passe n'est pas signer un cookie.
 *
 * Pour signer, on veut une fonction RAPIDE : HMAC-SHA256 (voir auth.ts).
 * Pour stocker, on veut exactement l'inverse — une fonction LENTE et SALEE.
 *
 * Un SHA-256 nu se teste a des milliards d'essais par seconde sur une carte
 * graphique : si la table `user` fuite, tous les mots de passe courants
 * tombent en quelques minutes. PBKDF2 a 210 000 iterations ramene cela a
 * quelques milliers d'essais par seconde.
 *
 * Le sel, unique par utilisateur, empeche de casser deux comptes d'un coup et
 * rend inutilisables les tables precalculees.
 *
 * Argon2id serait un meilleur choix encore, mais n'existe pas dans WebCrypto :
 * il faudrait embarquer du WebAssembly dans le Worker. PBKDF2 est le meilleur
 * compromis disponible nativement, et l'OWASP le juge acceptable a ce nombre
 * d'iterations.
 */

/** Recommandation OWASP 2023 pour PBKDF2-HMAC-SHA256. */
export const DEFAULT_ITERATIONS = 210_000

const encoder = new TextEncoder()

const toHex = (buffer: ArrayBuffer | Uint8Array): string =>
  [...(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

const fromHex = (hex: string): Uint8Array =>
  new Uint8Array((hex.match(/.{1,2}/g) ?? []).map((b) => parseInt(b, 16)))

export interface PasswordRecord {
  readonly hash: string
  readonly salt: string
  readonly iterations: number
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ])
  // `shared/` compile sans la bibliotheque DOM — volontairement, pour que rien
  // ici ne puisse dependre du navigateur. `BufferSource` n'y existe donc pas,
  // d'ou ce parametre construit a part plutot qu'une annotation de type.
  const params = { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }
  const bits = await crypto.subtle.deriveBits(params as never, key, 256)
  return toHex(bits)
}

/** Cree l'enregistrement a stocker pour un nouveau mot de passe. */
export async function hashPassword(
  password: string,
  iterations = DEFAULT_ITERATIONS,
): Promise<PasswordRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { hash: await derive(password, salt, iterations), salt: toHex(salt), iterations }
}

/**
 * Verifie un mot de passe. Comparaison en TEMPS CONSTANT : un `===` sortirait
 * au premier octet different et laisserait deviner le hash progressivement.
 */
export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const candidate = await derive(password, fromHex(record.salt), record.iterations)
  return timingSafeEqual(candidate, record.hash)
}

export function timingSafeEqual(a: string, b: string): boolean {
  // Les deux entrees sont des hex de meme longueur par construction ; ce test
  // ne revele donc rien d'exploitable.
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
