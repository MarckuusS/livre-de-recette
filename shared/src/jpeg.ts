/**
 * Les segments d'un JPEG, lus sans le decoder.
 *
 * POURQUOI. Le chemin normal passe par un canvas, qui ne transporte AUCUNE
 * metadonnee : il n'y a pas de conteneur a recopier, le reencodeur ecrit un
 * flux neuf. Partent donc les coordonnees GPS du domicile, le modele et le
 * numero de serie de l'appareil, l'horodatage, et la vignette EXIF embarquee.
 * Mais ce retrait est l'effet de bord d'une etape CLIENT : un `curl` avec
 * l'original d'un iPhone passe la signature JPEG et depose les coordonnees de
 * la maison dans le bucket.
 *
 * ON REFUSE, ON NE RETIRE PAS, et c'est tout le point de ce fichier.
 *
 * Retirer APP1 semble mieux et ne l'est pas. L'etiquette Orientation vit dans
 * APP1 : sur le chemin `curl`, la rotation n'est PAS cuite dans les pixels, le
 * capteur d'un telephone ecrivant toujours en paysage et deleguant la rotation
 * a cette etiquette. La detruire transformerait une rotation rattrapable en
 * rotation DEFINITIVE : la photo de quelqu'un resterait couchee pour toujours,
 * et personne ne saurait pourquoi. Refuser tient le meme objectif de vie
 * privee, sans analyseur TIFF, sans ce risque, et ne penalise que le chemin
 * qu'on ne veut de toute facon pas encourager.
 *
 * APP0 (JFIF) et APP2 (ICC) sont TOLERES. Certains navigateurs joignent un
 * profil de couleur a la sortie d'un canvas sur un ecran large gamut : les
 * refuser casserait le chemin nominal sur du materiel recent, ce qui serait
 * exactement le mauvais sens du compromis. Ni l'un ni l'autre ne porte de
 * donnee personnelle.
 */

export type JpegVerdict =
  /** Aucun segment de metadonnee avant le balayage. */
  | 'ok'
  /** Porte un APP1 (Exif ou XMP) ou un commentaire. */
  | 'metadata'
  /** Ne se lit pas comme un JPEG : longueur qui deborde, marqueur absent. */
  | 'malformed'

const SOI = 0xd8
/** Debut du balayage : au-dela, ce sont des donnees compressees, pas des segments. */
const SOS = 0xda
/** Fin d'image. */
const EOI = 0xd9
const APP1 = 0xe1
const COMMENT = 0xfe

/**
 * Les marqueurs SANS charge utile : ils ne sont pas suivis d'une longueur.
 * RSTn (D0 a D7), SOI, EOI, et TEM (01). Les traiter comme les autres ferait
 * lire deux octets de donnees comme une longueur, et le parcours partirait
 * n'importe ou.
 */
const SANS_LONGUEUR = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, SOI, EOI])

export function checkJpegSegments(bytes: Uint8Array): JpegVerdict {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return 'malformed'

  let i = 2
  while (i < bytes.length) {
    // Un segment commence toujours par 0xFF. Le bourrage par 0xFF repetes est
    // legal entre deux segments : on l'avale plutot que de crier au desordre.
    if (bytes[i] !== 0xff) return 'malformed'
    while (i < bytes.length && bytes[i] === 0xff) i += 1
    if (i >= bytes.length) return 'malformed'

    const marqueur = bytes[i] as number
    i += 1

    if (marqueur === SOS || marqueur === EOI) return 'ok'
    if (SANS_LONGUEUR.has(marqueur)) continue
    if (marqueur === APP1 || marqueur === COMMENT) return 'metadata'

    // Longueur sur deux octets, gros-boutiste, et ELLE SE COMPTE ELLE-MEME :
    // une longueur inferieure a 2 ferait reculer le curseur et boucler sans fin.
    if (i + 1 >= bytes.length) return 'malformed'
    const longueur = ((bytes[i] as number) << 8) | (bytes[i + 1] as number)
    if (longueur < 2 || i + longueur > bytes.length) return 'malformed'
    i += longueur
  }

  // On a atteint la fin sans rencontrer ni balayage ni fin d'image.
  return 'malformed'
}
