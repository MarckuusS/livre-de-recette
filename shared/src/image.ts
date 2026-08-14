/**
 * Reconnaissance du type reel d'une image, par ses premiers octets.
 *
 * POURQUOI CE FICHIER EXISTE. Le `content-type` d'une requete est une
 * DECLARATION DU CLIENT, pas un fait. Un document HTML envoye avec
 * `content-type: image/jpeg` reste du HTML, et servi depuis notre origine il
 * s'execute : ses scripts liraient `/api/profile`, c'est-a-dire le poids, la
 * taille et l'annee de naissance. Meme raisonnement que `svg.ts`, meme regle :
 * liste blanche, et c'est le serveur qui fait foi, jamais le navigateur.
 *
 * CE QU'IL NE FAIT PAS, et il faut le savoir. `FF D8 FF` suivi de neuf
 * megaoctets choisis par un attaquant reste un JPEG pour lui : les fichiers
 * polyglottes existent. Le controle d'octets protege contre l'erreur honnete,
 * pas contre l'attaque construite. Ce sont les EN-TETES DE REPONSE de la route
 * de lecture (content-type en constante litterale, `nosniff`, CSP `sandbox`)
 * qui protegent contre le polyglotte. Les deux sont necessaires, aucun ne
 * remplace l'autre.
 *
 * SEUL LE JPEG EST ACCEPTE, et c'est un choix etroit assume. Le PNG serait sans
 * danger, mais la cle finit en `.jpg` et la lecture sert un content-type fige a
 * `image/jpeg` : un PNG stocke serait servi comme un JPEG, donc une image cassee
 * sans le moindre message. Le navigateur convertit deja tout en JPEG avant
 * l'envoi ; accepter un second format obligerait a deriver l'extension et le
 * type du format detecte, pour rien.
 *
 * LES DIMENSIONS NE SONT PAS LUES, et c'est aussi un choix. Il faudrait un
 * analyseur de marqueurs SOF pour refuser une bombe de decompression, une image
 * de 60 000 par 60 000 pixels qui pese trois kilooctets compresses. Le plafond
 * d'octets borne deja ce qui traverse le reseau, et la bombe retombe sur le
 * navigateur qui affiche, dont les seuls utilisateurs sont les membres du foyer
 * qui a televerse. Le rapport cout sur benefice ne le justifie pas ici.
 */

/** Le seul format retenu. Un type nomme plutot qu'un booleen : il dira ce qu'on
    a reconnu le jour ou un second format sera accepte. */
export type ImageKind = 'jpeg'

const commencePar = (bytes: Uint8Array, offset: number, signature: readonly number[]): boolean => {
  if (bytes.length < offset + signature.length) return false
  return signature.every((octet, i) => bytes[offset + i] === octet)
}

/** `FF D8 FF` : SOI (debut d'image) puis le premier marqueur, toujours present. */
const JPEG = [0xff, 0xd8, 0xff] as const

export function detectImageKind(bytes: Uint8Array): ImageKind | null {
  return commencePar(bytes, 0, JPEG) ? 'jpeg' : null
}

/** Quatre lettres ASCII a une position donnee. */
const marque = (bytes: Uint8Array, offset: number, texte: string): boolean =>
  commencePar(
    bytes,
    offset,
    [...texte].map((c) => c.charCodeAt(0)),
  )

/**
 * Nomme un format identifiable mais refuse, pour pouvoir DIRE lequel est arrive.
 *
 * Refuser sans nommer laisse l'utilisateur devant un mur. C'est la meme regle
 * que le `existingId` rendu avec l'erreur de doublon : une erreur doit etre
 * actionnable. « Envoie une photo au format JPEG » ne dit pas quoi faire ; « le
 * fichier recu est un HEIC » designe le coupable.
 *
 * Rend `null` quand rien n'est reconnaissable, auquel cas le message reste
 * general.
 *
 * TROIS PIEGES DE POSITION, tous verifies contre les specifications :
 * - WebP porte `RIFF` en 0-3 et `WEBP` en 8-11, les quatre octets du milieu
 *   etant la taille du fichier.
 * - HEIC et AVIF portent `ftyp` en 4-7 et leur marque de marque en 8-11 ; les
 *   octets 0-3 sont la taille de la boite, pas une signature.
 * - SVG n'a AUCUNE signature binaire. Il ne se reconnait que par un prefixe
 *   textuel, apres un eventuel BOM et des espaces. On ne le detecte que POUR LE
 *   NOMMER : ce n'est jamais ce qui l'autorise ou le refuse.
 */
export function nameRefusedFormat(bytes: Uint8Array): string | null {
  if (commencePar(bytes, 0, [0x89, 0x50, 0x4e, 0x47])) return 'un PNG'
  if (commencePar(bytes, 0, [0x47, 0x49, 0x46, 0x38])) return 'un GIF'
  if (commencePar(bytes, 0, [0x42, 0x4d])) return 'un BMP'
  if (marque(bytes, 0, 'RIFF') && marque(bytes, 8, 'WEBP')) return 'un WebP'

  if (marque(bytes, 4, 'ftyp')) {
    // Les marques HEIF se ressemblent : `heic`, `heix`, `mif1`, `msf1` pour la
    // famille HEIC, `avif` et `avis` pour AVIF.
    for (const m of ['heic', 'heix', 'mif1', 'msf1']) if (marque(bytes, 8, m)) return 'un HEIC'
    for (const m of ['avif', 'avis']) if (marque(bytes, 8, m)) return 'un AVIF'
    return 'une video ou un format de conteneur'
  }

  const tete = texteDeTete(bytes)
  if (tete.startsWith('<?xml') || tete.startsWith('<svg')) return 'un SVG'
  if (tete.startsWith('<!doctype html') || tete.startsWith('<html')) return 'une page HTML'
  if (tete.startsWith('%pdf-')) return 'un PDF'

  return null
}

/** Les premiers caracteres en minuscules, BOM et espaces retires. */
function texteDeTete(bytes: Uint8Array): string {
  let debut = 0
  // BOM UTF-8, qu'un editeur de texte pose sans le dire.
  if (commencePar(bytes, 0, [0xef, 0xbb, 0xbf])) debut = 3
  let texte = ''
  for (let i = debut; i < Math.min(bytes.length, debut + 64); i += 1) {
    texte += String.fromCharCode(bytes[i] as number)
  }
  return texte.trimStart().toLowerCase()
}
