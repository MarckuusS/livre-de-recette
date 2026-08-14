import { describe, expect, it } from 'vitest'

import { detectImageKind, nameRefusedFormat } from './image.js'
import { checkJpegSegments } from './jpeg.js'
import {
  PHOTO,
  PHOTO_BODY_MAX,
  coverKey,
  photoPath,
  photoPrefix,
  scaleFor,
  vignetteKey,
} from './photo.js'

/** Un tableau d'octets a partir d'une liste, complete de zeros jusqu'a `taille`. */
const octets = (tete: readonly number[], taille = tete.length): Uint8Array => {
  const u = new Uint8Array(taille)
  u.set(tete)
  return u
}

/** Les octets d'une chaine ASCII. */
const ascii = (s: string): number[] => [...s].map((c) => c.charCodeAt(0))

// ---------------------------------------------------------------------------

describe('cles et adresses', () => {
  it('la cle porte la recette ET une empreinte', () => {
    expect(coverKey(6, 'a3f9c1d2b4e5f607')).toBe('recipes/6/a3f9c1d2b4e5f607.jpg')
  })

  it('la vignette se deduit de la grande, jamais stockee a part', () => {
    const cover = coverKey(6, 'a3f9c1d2b4e5f607')
    expect(vignetteKey(cover)).toBe('recipes/6/a3f9c1d2b4e5f607.vignette.jpg')
  })

  it('refuse de deduire une vignette d une cle qui n a pas la bonne forme', () => {
    // Une cle heritee de l'ancien format ne doit pas produire silencieusement
    // une cle de vignette qui ne designera jamais rien.
    expect(() => vignetteKey('recipes/6.jpg')).not.toThrow()
    expect(() => vignetteKey('recipes/6')).toThrow(/inattendue/)
  })

  it('l adresse porte l identifiant et l empreinte, JAMAIS la cle', () => {
    // Le routeur compile `:param` en `([^/]+)` : une cle contenant une barre
    // oblique ne peut pas transiter par un parametre de chemin.
    const cle = coverKey(6, 'a3f9c1d2b4e5f607')
    const url = photoPath(6, cle, 'thumb')
    expect(url).toBe('/api/recipes/6/image?size=thumb&v=a3f9c1d2b4e5f607')
    // La cle elle-meme n'apparait nulle part : c'est elle qui porte la barre
    // oblique de trop.
    expect(url).not.toContain(cle)
    expect(url.split('?')[0]?.split('/')).toHaveLength(5)
  })

  it('l adresse change quand la photo change, ce qui autorise le cache long', () => {
    const a = photoPath(6, coverKey(6, 'aaaaaaaaaaaaaaaa'))
    const b = photoPath(6, coverKey(6, 'bbbbbbbbbbbbbbbb'))
    expect(a).not.toBe(b)
  })

  it('le prefixe couvre toute une recette, pour le balayage', () => {
    expect(coverKey(6, 'x').startsWith(photoPrefix(6))).toBe(true)
    expect(photoPrefix(6)).not.toBe(photoPrefix(60))
  })

  it('le plafond du corps couvre les deux parties', () => {
    expect(PHOTO_BODY_MAX).toBeGreaterThan(PHOTO.cover.maxBytes + PHOTO.thumb.maxBytes)
  })
})

describe('scaleFor', () => {
  it('reduit a rapport constant', () => {
    expect(scaleFor(4032, 3024, 1280)).toEqual({ width: 1280, height: 960 })
  })

  it('reduit sur le cote LONG, portrait comme paysage', () => {
    expect(scaleFor(3024, 4032, 1280)).toEqual({ width: 960, height: 1280 })
  })

  it('N AGRANDIT JAMAIS', () => {
    // Comme le `thumbnail()` de Pillow du desktop : agrandir ne cree aucun
    // detail et multiplie le poids par quatre.
    expect(scaleFor(600, 400, 1280)).toEqual({ width: 600, height: 400 })
  })

  it('rend au moins un pixel sur une image tres allongee', () => {
    // 1 x 4000 reduit a 320 donnerait 0 de large, et un canvas de largeur nulle
    // leve.
    expect(scaleFor(1, 4000, 320).width).toBe(1)
  })

  it('reste sous la limite de surface d un canvas iOS', () => {
    // 16 777 216 pixels. Un iPhone 15 Pro photographie en 5712 x 4284, soit
    // 24 470 208, donc 1,46 fois la limite : un canvas aux dimensions natives
    // leve sur les telephones RECENTS.
    const { width, height } = scaleFor(5712, 4284, PHOTO.cover.maxSide)
    expect(width * height).toBeLessThan(16_777_216 / 10)
  })
})

// ---------------------------------------------------------------------------

describe('detectImageKind', () => {
  it('reconnait un JPEG', () => {
    expect(detectImageKind(octets([0xff, 0xd8, 0xff, 0xe0], 16))).toBe('jpeg')
  })

  it('refuse tout le reste, y compris ce qui est inoffensif', () => {
    // Choix etroit assume : la cle finit en .jpg et la lecture sert un
    // content-type fige, donc un PNG stocke serait servi comme un JPEG.
    expect(detectImageKind(octets([0x89, 0x50, 0x4e, 0x47], 16))).toBeNull()
    expect(detectImageKind(octets(ascii('RIFF0000WEBP'), 16))).toBeNull()
  })

  it('refuse un fichier trop court pour porter une signature', () => {
    expect(detectImageKind(new Uint8Array([0xff, 0xd8]))).toBeNull()
    expect(detectImageKind(new Uint8Array())).toBeNull()
  })

  it('refuse un HTML qui se declare image, le scenario qui compte', () => {
    // Servi depuis notre origine, il s'executerait et lirait /api/profile.
    // Le content-type de la requete est une declaration du client, pas un fait.
    expect(detectImageKind(octets(ascii('<!DOCTYPE html><script>'), 32))).toBeNull()
  })
})

describe('nameRefusedFormat', () => {
  it('nomme le HEIC, le format que produit un iPhone', () => {
    // `ftyp` en 4-7, la marque en 8-11. Les octets 0-3 sont la TAILLE de boite,
    // pas une signature : les lire comme telle est le piege classique.
    expect(nameRefusedFormat(octets([0, 0, 0, 24, ...ascii('ftypheic')], 32))).toBe('un HEIC')
    expect(nameRefusedFormat(octets([0, 0, 0, 32, ...ascii('ftypmif1')], 32))).toBe('un HEIC')
  })

  it('nomme l AVIF, qui partage la meme boite', () => {
    expect(nameRefusedFormat(octets([0, 0, 0, 24, ...ascii('ftypavif')], 32))).toBe('un AVIF')
  })

  it('nomme le WebP, dont la marque est en 8-11 et non en 4-7', () => {
    // Les quatre octets du milieu portent la taille du fichier.
    expect(nameRefusedFormat(octets(ascii('RIFFWEBPVP8 '), 32))).toBe(
      'un WebP',
    )
  })

  it('nomme le PNG, le GIF et le BMP', () => {
    expect(nameRefusedFormat(octets([0x89, 0x50, 0x4e, 0x47], 16))).toBe('un PNG')
    expect(nameRefusedFormat(octets(ascii('GIF89a'), 16))).toBe('un GIF')
    expect(nameRefusedFormat(octets(ascii('BM'), 16))).toBe('un BMP')
  })

  it('nomme le SVG, qui n a AUCUNE signature binaire', () => {
    // Il ne se reconnait qu'a un prefixe textuel. On ne le detecte que pour le
    // NOMMER : ce n'est jamais ce qui autorise ou refuse.
    expect(nameRefusedFormat(octets(ascii('<svg xmlns="http://'), 32))).toBe('un SVG')
    expect(nameRefusedFormat(octets(ascii('<?xml version="1.0"'), 32))).toBe('un SVG')
  })

  it('traverse le BOM et les espaces avant de lire le texte', () => {
    // Un editeur de texte pose un BOM sans le dire, et il decalerait la lecture.
    expect(nameRefusedFormat(octets([0xef, 0xbb, 0xbf, ...ascii('  <svg ')], 32))).toBe('un SVG')
  })

  it('nomme une page HTML et un PDF', () => {
    expect(nameRefusedFormat(octets(ascii('<!DOCTYPE html>'), 32))).toBe('une page HTML')
    expect(nameRefusedFormat(octets(ascii('%PDF-1.7'), 16))).toBe('un PDF')
  })

  it('rend null sur du bruit, plutot que de deviner', () => {
    expect(nameRefusedFormat(octets([0x12, 0x34, 0x56, 0x78], 16))).toBeNull()
    expect(nameRefusedFormat(new Uint8Array())).toBeNull()
  })

  it('ne nomme pas le JPEG : il n est pas refuse', () => {
    expect(nameRefusedFormat(octets([0xff, 0xd8, 0xff, 0xe0], 16))).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('checkJpegSegments', () => {
  /** Un segment : marqueur, longueur (elle se compte elle-meme), charge. */
  const segment = (marqueur: number, charge: readonly number[] = []): number[] => {
    const n = charge.length + 2
    return [0xff, marqueur, (n >> 8) & 0xff, n & 0xff, ...charge]
  }
  const SOI = [0xff, 0xd8]
  const SOS = [0xff, 0xda]

  it('accepte un JPEG issu d un canvas, sans metadonnee', () => {
    expect(checkJpegSegments(octets([...SOI, ...segment(0xdb, [1, 2, 3]), ...SOS], 64))).toBe('ok')
  })

  it('REFUSE un APP1, c est-a-dire l EXIF et le GPS du domicile', () => {
    const exif = segment(0xe1, ascii('Exif\0\0'))
    expect(checkJpegSegments(octets([...SOI, ...exif, ...SOS], 64))).toBe('metadata')
  })

  it('refuse un APP1 place APRES un autre segment', () => {
    // Il n'est pas toujours le premier : ne regarder que le debut le manquerait.
    const suite = [...SOI, ...segment(0xdb, [1, 2]), ...segment(0xe1, ascii('Exif')), ...SOS]
    expect(checkJpegSegments(octets(suite, 64))).toBe('metadata')
  })

  it('refuse un commentaire', () => {
    expect(checkJpegSegments(octets([...SOI, ...segment(0xfe, ascii('bonjour')), ...SOS], 64))).toBe(
      'metadata',
    )
  })

  it('TOLERE JFIF et le profil de couleur ICC', () => {
    // Certains navigateurs joignent un profil ICC a la sortie d'un canvas sur
    // un ecran large gamut. Les refuser casserait le chemin nominal sur du
    // materiel recent, et aucun des deux ne porte de donnee personnelle.
    const suite = [...SOI, ...segment(0xe0, ascii('JFIF\0')), ...segment(0xe2, ascii('ICC')), ...SOS]
    expect(checkJpegSegments(octets(suite, 64))).toBe('ok')
  })

  it('s arrete au balayage et n examine plus rien ensuite', () => {
    // Les donnees compressees contiennent des octets 0xFF suivis de n'importe
    // quoi : continuer a les lire comme des segments donnerait n'importe quel
    // verdict.
    const suite = [...SOI, ...SOS, 0xff, 0xe1, 0xff, 0xfe, 0x00, 0x01]
    expect(checkJpegSegments(octets(suite, 64))).toBe('ok')
  })

  it('avale le bourrage de 0xFF entre deux segments, qui est legal', () => {
    const suite = [...SOI, 0xff, 0xff, 0xff, ...segment(0xdb, [1]), ...SOS]
    expect(checkJpegSegments(octets(suite, 64))).toBe('ok')
  })

  it('traite les marqueurs SANS charge utile sans lire de longueur', () => {
    // RSTn et TEM ne sont pas suivis d'une longueur : les traiter comme les
    // autres ferait lire deux octets de donnees comme une longueur, et le
    // parcours partirait n'importe ou.
    const suite = [...SOI, 0xff, 0xd0, 0xff, 0x01, ...segment(0xdb, [1]), ...SOS]
    expect(checkJpegSegments(octets(suite, 64))).toBe('ok')
  })

  it('refuse une longueur qui deborde du fichier, sans lire hors des bornes', () => {
    expect(checkJpegSegments(new Uint8Array([...SOI, 0xff, 0xdb, 0xff, 0xff, 0x00]))).toBe(
      'malformed',
    )
  })

  it('NE BOUCLE PAS sur une longueur inferieure a deux', () => {
    // Une longueur de 0 ou 1 ferait reculer le curseur : boucle infinie, isolat
    // mort, et l'exception n'est meme pas rattrapable par le try/catch du
    // routeur. Le test echouerait par expiration, pas par assertion.
    expect(checkJpegSegments(new Uint8Array([...SOI, 0xff, 0xdb, 0x00, 0x00, 0x01, 0x02]))).toBe(
      'malformed',
    )
    expect(checkJpegSegments(new Uint8Array([...SOI, 0xff, 0xdb, 0x00, 0x01, 0x02]))).toBe(
      'malformed',
    )
  })

  it('refuse ce qui ne commence pas par SOI', () => {
    expect(checkJpegSegments(octets([0x89, 0x50, 0x4e, 0x47], 16))).toBe('malformed')
    expect(checkJpegSegments(new Uint8Array([0xff, 0xd8]))).toBe('malformed')
    expect(checkJpegSegments(new Uint8Array())).toBe('malformed')
  })

  it('refuse un flux qui finit sans balayage ni fin d image', () => {
    expect(checkJpegSegments(new Uint8Array([...SOI, ...segment(0xdb, [1, 2, 3])]))).toBe(
      'malformed',
    )
  })
})
