/**
 * Le resolveur est la seule partie du jeu d'icones qui puisse se tromper en
 * silence : un dessin rate se voit, un rayon mal reconnu non — il rend
 * simplement la cagette, qui reste plausible.
 *
 * Les libelles testes sont ceux que l'utilisateur a reellement saisis, plus
 * leurs variantes previsibles.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { OVERRIDE_PATHS } from './paths/overrides.js'
import { RAYON_PATHS } from './paths/rayons.js'
import { ICON_PATHS } from './registry.js'
import { iconForRayon, normalizeLabel, rayonSlug } from './resolve.js'

describe('normalizeLabel', () => {
  it('deplie les ligatures que NFD laisse intactes', () => {
    // Sans la substitution explicite, « Œufs » se reduit a « ufs ».
    expect(normalizeLabel('Œufs & laitages')).toBe('oeufs laitages')
  })

  it('retire accents et ponctuation', () => {
    expect(normalizeLabel('Fruits et légumes')).toBe('fruits et legumes')
    expect(normalizeLabel('Produits laitiers & oeufs')).toBe('produits laitiers oeufs')
  })
})

describe('iconForRayon', () => {
  it('reconnait les rayons de la bibliotheque', () => {
    expect(iconForRayon('Fruits et légumes')).toBe('rayon-fruits-legumes')
    expect(iconForRayon('Boucherie')).toBe('rayon-boucherie')
    expect(iconForRayon('Poissonnerie')).toBe('rayon-poissonnerie')
    expect(iconForRayon('Boulangerie')).toBe('rayon-boulangerie')
    expect(iconForRayon('Produits laitiers & oeufs')).toBe('rayon-produits-laitiers')
    expect(iconForRayon('Boissons')).toBe('rayon-boissons')
    expect(iconForRayon('Surgelés')).toBe('rayon-surgeles')
    expect(iconForRayon('Epicerie')).toBe('rayon-epicerie')
    expect(iconForRayon('Snacks et confiseries')).toBe('rayon-snacks-confiseries')
  })

  it('reconnait un synonyme, pas seulement le libelle exact', () => {
    expect(iconForRayon('Primeur')).toBe('rayon-fruits-legumes')
    expect(iconForRayon('Crèmerie')).toBe('rayon-produits-laitiers')
    expect(iconForRayon('Charcuterie')).toBe('rayon-boucherie')
    expect(iconForRayon('Produits congelés')).toBe('rayon-surgeles')
    // « Frais » tout court, tel qu'il existe dans la bibliotheque.
    expect(iconForRayon('Frais')).toBe('rayon-produits-laitiers')
  })

  it('laisse la cagette aux rayons qu’aucun dessin ne couvre', () => {
    // « Sport nutrition » n'a pas d'equivalent en rayon de supermarche, et
    // aucune des dix icones ne le decrirait sans mentir.
    expect(iconForRayon('Sport nutrition')).toBe('rayon-autre')
  })

  it('respecte l’ordre des regles la ou il est signifiant', () => {
    // Les deux seules paires dont l'ordre compte. Les inverser dans
    // RAYON_RULES casserait exactement ces deux assertions, et rien d'autre.
    expect(iconForRayon('Légumes surgelés')).toBe('rayon-surgeles')
    expect(iconForRayon('Fruits de mer')).toBe('rayon-poissonnerie')
  })

  it('rend la cagette pour l’absence de rayon ou un rayon inconnu', () => {
    expect(iconForRayon(null)).toBe('rayon-autre')
    expect(iconForRayon(undefined)).toBe('rayon-autre')
    expect(iconForRayon('   ')).toBe('rayon-autre')
    expect(iconForRayon('Zorglub')).toBe('rayon-autre')
  })
})

describe('rayonSlug', () => {
  it('donne la meme teinte a deux libelles synonymes', () => {
    expect(rayonSlug('Primeur')).toBe(rayonSlug('Fruits et légumes'))
    expect(rayonSlug(null)).toBe('autre')
  })

  it('rend un identifiant utilisable tel quel comme attribut', () => {
    expect(rayonSlug('Snacks et confiseries')).toBe('snacks-confiseries')
  })
})

describe('registre', () => {
  it('a une teinte CSS declaree pour chaque rayon', () => {
    // Un rayon sans teinte tomberait sur la couleur de repli, en silence.
    //
    // Lu depuis le disque et non par `import ... ?raw` : sous vitest, le
    // transformateur CSS de Vite rend une chaine VIDE, et l'assertion passait
    // donc pour de mauvaises raisons sur tout ce qu'on lui demandait.
    const css = readFileSync(new URL('../styles/icons.css', import.meta.url), 'utf8')
    for (const name of Object.keys(ICON_PATHS)) {
      if (!name.startsWith('rayon-')) continue
      expect(css, name).toContain(`[data-rayon='${name.replace('rayon-', '')}']`)
    }
  })

  it('ne contient que du contenu de svg, jamais la balise elle-meme', () => {
    // Une icone qui reintroduirait son propre `<svg>` echapperait aux attributs
    // communs poses par `<Icon>` : trait, epaisseur et couleur deriveraient.
    //
    // La liste des balises acceptees est celle de l'assainisseur partage
    // (shared/src/svg.ts) : les dessins de Lucide utilisent aussi `line`,
    // `polyline` et `polygon`, et les exclure ici ferait echouer le test sur
    // des icones parfaitement valides.
    for (const [name, markup] of Object.entries(ICON_PATHS)) {
      expect(markup, name).toMatch(/^<(path|circle|ellipse|rect|line|polyline|polygon|g)[\s/>]/)
      expect(markup, name).not.toContain('<svg')
    }
  })

  it('laisse le dessin maison l’emporter sur celui de Lucide', () => {
    // Le mecanisme tient a UN detail : l'ordre des spreads dans registry.ts.
    // L'inverser rendrait les overrides silencieusement inoperants — le fichier
    // existerait, serait importe, et ne servirait a rien. Ce test est la seule
    // chose qui distingue les deux situations.
    for (const [name, markup] of Object.entries(OVERRIDE_PATHS)) {
      expect(ICON_PATHS[name as keyof typeof ICON_PATHS], name).toBe(markup)
    }
  })

  it('garde l’entree Lucide correspondante comme repli', () => {
    // Retirer une ligne d'overrides.ts doit rendre l'icone Lucide, pas faire
    // disparaitre l'icone. Cela suppose que `MAP` conserve l'entree.
    for (const name of Object.keys(OVERRIDE_PATHS)) {
      if (!name.startsWith('rayon-')) continue
      expect(RAYON_PATHS, name).toHaveProperty(name)
    }
  })

  it('ne porte aucune couleur en dur', () => {
    // Seules deux valeurs sont acceptables : `none`, qui est une consigne de
    // trace, et `currentColor`, qui EST le mecanisme par lequel une icone prend
    // la teinte de son rayon et suit le theme sombre. Une couleur litterale la
    // figerait, et c'est precisement ce qu'on reprochait aux emojis.
    //
    // Lucide en pose lui-meme quelques-unes (le trou de l'etiquette, l'oeil du
    // poisson) : toutes en `currentColor`, donc conformes.
    for (const [name, markup] of Object.entries(ICON_PATHS)) {
      for (const [, attr, value] of markup.matchAll(/(fill|stroke)="([^"]*)"/g)) {
        expect(value, `${name} / ${attr}`).toMatch(/^(none|currentColor)$/)
      }
    }
  })
})
