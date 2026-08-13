import { describe, expect, it } from 'vitest'

import { extractDurations, parseSteps } from './steps.js'

describe('parseSteps', () => {
  it('numerote une etape par ligne', () => {
    const s = parseSteps('Rince les lentilles.\nEmince l’oignon.\nMijote a couvert.')
    expect(s.map((e) => e.index)).toEqual([1, 2, 3])
    expect(s[0]?.text).toBe('Rince les lentilles.')
  })

  it('avale les lignes vides et les retours Windows', () => {
    // Un texte colle depuis un site en porte, et une ligne finissant par \r se
    // verrait a l'ecran.
    const s = parseSteps('Un.\r\n\r\n\r\nDeux.\r\n')
    expect(s).toHaveLength(2)
    expect(s[1]?.text).toBe('Deux.')
  })

  it('retire une numerotation deja tapee a la main', () => {
    // Sans cela, l'ecran afficherait « 2. 2) Ajoute les lentilles ».
    const s = parseSteps('1. Rince.\n2) Emince.\n3 - Mijote.\nÉtape 4 : Sers.')
    expect(s.map((e) => e.text)).toEqual(['Rince.', 'Emince.', 'Mijote.', 'Sers.'])
    expect(s.map((e) => e.index)).toEqual([1, 2, 3, 4])
  })

  it('renumerote juste meme quand la main a saute un chiffre', () => {
    const s = parseSteps('1. Un.\n3. Deux.\n7. Trois.')
    expect(s.map((e) => e.index)).toEqual([1, 2, 3])
  })

  it('ne confond pas une quantite avec un numero d’etape', () => {
    // « 2 cuillères » commence par un chiffre mais n'est pas une numerotation :
    // le motif exige un separateur, pas un espace seul.
    const s = parseSteps('2 cuillères de curry, puis remuer.')
    expect(s[0]?.text).toBe('2 cuillères de curry, puis remuer.')
  })

  it('traite un intertitre comme un titre, sans numero ni decalage', () => {
    const s = parseSteps('Pour la sauce :\nMelange le yaourt.\nPour le plat :\nCuis le riz.')
    expect(s.map((e) => [e.index, e.heading])).toEqual([
      [null, true],
      [1, false],
      [null, true],
      [2, false],
    ])
  })

  it('ne prend pas une longue phrase finissant par deux-points pour un titre', () => {
    const longue =
      'Melange le tout dans un saladier en veillant a ne pas ecraser les morceaux, puis reserve au frais :'
    const s = parseSteps(longue)
    expect(s[0]?.heading).toBe(false)
    expect(s[0]?.index).toBe(1)
  })

  it('rend une seule etape sur un paragraphe unique, et c’est le bon comportement', () => {
    const s = parseSteps('Fais tout cuire ensemble pendant vingt minutes puis sers.')
    expect(s).toHaveLength(1)
    expect(s[0]?.index).toBe(1)
  })

  it('rend une liste vide sur des instructions vides', () => {
    expect(parseSteps('')).toEqual([])
    expect(parseSteps('   \n\n  ')).toEqual([])
  })
})

describe('extractDurations', () => {
  it('lit les durees dont l’unite est ECRITE', () => {
    expect(extractDurations('Mijote 15 min a couvert.')).toEqual([15])
    expect(extractDurations('Laisse reposer 2 h.')).toEqual([120])
    expect(extractDurations('Cuire 45 minutes.')).toEqual([45])
    expect(extractDurations('Attendre 30mn.')).toEqual([30])
  })

  it('ignore un nombre sans unite de temps', () => {
    // C'est tout l'objet du module : le nombre serait facile a prendre, sa
    // NATURE est ce qu'on inventerait.
    expect(extractDurations('Prechauffe le four a 180 °C.')).toEqual([])
    expect(extractDurations('Ajoute 10 cl de creme.')).toEqual([])
    expect(extractDurations('Casse 4 oeufs.')).toEqual([])
  })

  it('rend TOUTES les durees d’une etape, jamais une seule', () => {
    // « Fais revenir 3 min puis laisse reposer 30 min » n'a pas de duree
    // principale : en choisir une reviendrait a choisir pour le lecteur.
    expect(extractDurations('Fais revenir 3 min puis laisse reposer 30 min.')).toEqual([3, 30])
  })

  it('ne retient pas une duree nulle', () => {
    expect(extractDurations('0 min')).toEqual([])
  })
})
