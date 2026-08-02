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
 * il faudrait embarquer du WebAssembly dans le Worker.
 */

/**
 * PLAFOND IMPOSE PAR LA PLATEFORME.
 *
 * Cloudflare Workers refuse PBKDF2 au-dela de 100 000 iterations, pour se
 * proteger d'un deni de service :
 *
 *     NotSupportedError: Pbkdf2 failed: iteration counts above 100000
 *     are not supported
 *
 * Piege : la limite n'est PAS appliquee par le runtime local de `wrangler
 * dev`. Un compte cree avec davantage fonctionne parfaitement en
 * developpement puis fait echouer toute connexion en production, avec une
 * erreur interne generique. C'est exactement ce qui s'est produit ici avec
 * 210 000 iterations.
 *
 * Consequence a assumer : l'OWASP recommande aujourd'hui 600 000 iterations
 * pour PBKDF2-HMAC-SHA256. On est six fois en dessous, sans possibilite de
 * faire mieux avec l'API native.
 *
 * Ce que ca signifie concretement : si la table `user` fuitait, un mot de
 * passe faible tomberait plus vite qu'avec un parametrage ideal. La parade
 * est donc un mot de passe LONG — le script de creation en impose au moins
 * dix caracteres. Et obtenir cette table suppose deja d'avoir compromis le
 * compte Cloudflare.
 *
 * Pour aller au-dela, il faudrait embarquer Argon2id ou scrypt en WebAssembly.
 * Disproportionne pour deux comptes personnels ; a reconsiderer si
 * l'application accueillait un jour de vrais utilisateurs tiers.
 */
export const MAX_PLATFORM_ITERATIONS = 100_000

export const DEFAULT_ITERATIONS = MAX_PLATFORM_ITERATIONS

export class IterationLimitError extends Error {
  constructor(iterations: number) {
    super(
      `PBKDF2 : ${iterations} itérations demandées, la plateforme en accepte ` +
        `${MAX_PLATFORM_ITERATIONS} au maximum.`,
    )
    this.name = 'IterationLimitError'
  }
}

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
  // Echouer ici, avec un message explicite, plutot que de laisser la
  // plateforme lever une erreur generique au fond d'une pile d'appels — c'est
  // ce qui avait rendu le diagnostic si penible.
  if (iterations > MAX_PLATFORM_ITERATIONS) throw new IterationLimitError(iterations)

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
