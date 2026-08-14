import { describe, expect, it } from 'vitest'

import { extractDurations, isHeading, parseSteps, stepRanks } from './steps.js'

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

describe('stepRanks', () => {
  it('aligne un rang par ligne brute, sans rien filtrer', () => {
    // Le point du separer de `parseSteps` : l'editeur a un champ par ligne, y
    // compris vide, et doit poser le bon numero en face du bon champ.
    expect(stepRanks(['Un.', 'Deux.', 'Trois.'])).toEqual([1, 2, 3])
  })

  it('numerote une ligne dont le numero est deja tape a la main', () => {
    // Le defaut qui a motive cette fonction : « 4) Ajuste le sel » etait
    // indexee sans son « 4) » et passait pour un intertitre.
    expect(stepRanks(['Un.', '4) Ajuste le sel, un trait de citron.'])).toEqual([1, 2])
  })

  it('ne numerote ni les intertitres ni les lignes vides', () => {
    expect(stepRanks(['Pour la sauce :', 'Melange.', '', 'Pour le plat :', 'Cuis.'])).toEqual([
      null, 1, null, null, 2,
    ])
  })

  it('donne le meme rang que parseSteps sur un texte sans ligne vide', () => {
    const texte = 'Un.\nPour la sauce :\n2) Deux.\nTrois.'
    const parLignes = stepRanks(texte.split('\n'))
    expect(parseSteps(texte).map((e) => e.index)).toEqual(parLignes)
  })
})

describe('isHeading', () => {
  it('reconnait une ligne de section', () => {
    expect(isHeading('Pour la sauce :')).toBe(true)
    expect(isHeading('  Pour le plat:  ')).toBe(true)
  })

  it('refuse une phrase longue qui finit par deux-points', () => {
    expect(
      isHeading(
        'Melange le tout dans un saladier en veillant a ne pas ecraser les morceaux, puis reserve :',
      ),
    ).toBe(false)
  })

  it('refuse une instruction ordinaire', () => {
    expect(isHeading('Rince les lentilles.')).toBe(false)
  })
})
