/**
 * Le resolveur est la seule partie du jeu d'icones qui puisse se tromper en
 * silence : un dessin rate se voit, une correspondance ratee non — elle rend
 * simplement l'icone du rayon, qui reste plausible.
 *
 * Les cas ci-dessous sont pris tels quels dans la bibliotheque reelle, sources
 * CIQUAL et OpenFoodFacts melangees. Ils couvrent les quatre pieges :
 * le mot-cle englobant, le pluriel interne, l'accent et l'apostrophe.
 */

import { describe, expect, it } from 'vitest'

import { ICON_PATHS, type IconName } from './registry.js'
import { iconForIngredient, iconForRayon, normalizeLabel, rayonSlug } from './resolve.js'

const icon = (name: string, categoryL1: string | null = null): IconName =>
  iconForIngredient({ name, categoryL1 })

describe('normalizeLabel', () => {
  it('deplie les ligatures que NFD laisse intactes', () => {
    // Sans la substitution explicite, « Œuf » se reduit a « uf ».
    expect(normalizeLabel('Œuf fermier')).toBe('oeuf fermier')
  })

  it('retire accents et ponctuation', () => {
    expect(normalizeLabel("Huile d'olive vierge extra")).toBe('huile d olive vierge extra')
    expect(normalizeLabel('Épinard, cru')).toBe('epinard cru')
  })
})

describe('iconForIngredient — le mot-cle le plus long gagne', () => {
  it('prefere le mot-cle englobant a celui qu’il contient', () => {
    expect(icon('Beurre de cacahuètes')).toBe('cacahuete')
    expect(icon('Beurre à 80% MG minimum, doux, tendre')).toBe('beurre')

    expect(icon('Pomme de terre, sans peau, crue')).toBe('pomme-de-terre')
    expect(icon('Pur jus pomme')).toBe('pomme')

    expect(icon('Pain de mie grandes tranches')).toBe('pain-de-mie')
    expect(icon('Pain complet')).toBe('pain')

    expect(icon('Fromage blanc 0%')).toBe('yaourt')
    expect(icon('Fromage de chèvre')).toBe('fromage')
  })

  it('departage a longueur egale par la position dans le libelle', () => {
    // « bouillon » et « volaille » font huit lettres : c'est le premier lu qui
    // l'emporte, sans quoi le resultat dependrait de l'ordre du tableau.
    expect(icon('Bouillon de volaille, déshydraté')).toBe('bouillon')
    expect(icon('Sorbet plein fruit Orange Sanguine')).toBe('sorbet')
  })
})

describe('iconForIngredient — pluriels', () => {
  it('reconnait le pluriel, y compris au milieu du mot-cle', () => {
    expect(icon('Tomates cerises allongées')).toBe('tomate')
    expect(icon('Pommes de terre nouvelles')).toBe('pomme-de-terre')
    expect(icon('Petits pois carottes')).toBe('petit-pois')
    expect(icon('Œufs bio')).toBe('oeuf')
    expect(icon('Choux de Bruxelles')).toBe('chou')
  })

  it('ne coupe pas un mot qui finit deja par s', () => {
    // « mais » et « jus » perdraient leur sens si on leur otait la finale.
    expect(icon('Maïs doux bio')).toBe('mais')
    expect(icon('Jus multivitaminé')).toBe('jus')
  })
})

describe('iconForIngredient — replis', () => {
  it('retombe sur le rayon quand aucun mot-cle ne correspond', () => {
    expect(icon('Chaussée aux moines', 'Produits laitiers & oeufs')).toBe(
      'rayon-produits-laitiers',
    )
  })

  it('retombe sur la cagette sans nom ni rayon exploitable', () => {
    expect(icon('Zorglub 500g')).toBe('rayon-autre')
    expect(icon('Zorglub 500g', '')).toBe('rayon-autre')
  })
})

describe('iconForRayon', () => {
  it('reconnait un rayon a un fragment de son libelle', () => {
    expect(iconForRayon('Fruits et légumes')).toBe('rayon-fruits-legumes')
    expect(iconForRayon('Primeur')).toBe('rayon-fruits-legumes')
    expect(iconForRayon('Produits laitiers & oeufs')).toBe('rayon-produits-laitiers')
    expect(iconForRayon('Snacks et confiseries')).toBe('rayon-snacks-confiseries')
  })

  it('range « fruits de mer » avec la poissonnerie, pas avec les fruits', () => {
    expect(iconForRayon('Fruits de mer')).toBe('rayon-poissonnerie')
  })

  it('range « légumes surgelés » avec les surgelés, pas avec les légumes', () => {
    expect(iconForRayon('Légumes surgelés')).toBe('rayon-surgeles')
  })

  it('rend la cagette pour l’absence de rayon', () => {
    expect(iconForRayon(null)).toBe('rayon-autre')
    expect(iconForRayon('   ')).toBe('rayon-autre')
  })
})

describe('rayonSlug', () => {
  it('donne la meme teinte a deux libelles synonymes', () => {
    expect(rayonSlug('Primeur')).toBe(rayonSlug('Fruits et légumes'))
    expect(rayonSlug(null)).toBe('autre')
  })
})

describe('registre', () => {
  it('ne contient que du contenu de svg, jamais la balise elle-meme', () => {
    // Une icone qui reintroduirait son propre `<svg>` echapperait aux attributs
    // communs poses par `<Icon>` : trait, epaisseur et couleur deriveraient.
    for (const [name, markup] of Object.entries(ICON_PATHS)) {
      expect(markup, name).toMatch(/^<(path|circle|ellipse|rect)/)
      expect(markup, name).not.toContain('<svg')
    }
  })
})
