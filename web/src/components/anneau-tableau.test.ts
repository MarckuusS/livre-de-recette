/**
 * L'anneau au-dessus de son tableau, partout, et une colonne de part.
 *
 * CE TEST EXISTE PARCE QUE LA REGLE A ETE REDEMANDEE QUATRE FOIS.
 *
 * Elle a ete tenue sur un ecran, puis sur un deuxieme, pendant que les deux
 * autres gardaient l'ordre inverse. Chaque correction paraissait complete parce
 * qu'elle regardait l'ecran signale, jamais les trois autres. Une regle qui ne
 * tient que par la vigilance de qui relit finit toujours par ceder : elle est
 * desormais verifiee sur le TEXTE DES QUATRE FICHIERS.
 *
 * C'est une verification grossiere, et c'est assume : elle lit des sources
 * plutot que de rendre des composants, ce qui la rend sensible a une
 * reecriture. Elle echouera alors bruyamment, avec le nom du fichier, ce qui
 * est exactement le service attendu. L'alternative, un rendu complet avec
 * jsdom, demanderait un harnais que ce projet n'a pas.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ICI = dirname(fileURLToPath(import.meta.url))
const lire = (chemin: string): string => readFileSync(resolve(ICI, '..', chemin), 'utf8')

/**
 * La source SANS ses commentaires.
 *
 * Necessaire parce que ce projet documente ce qu'il a retire, et longuement :
 * l'en-tete de `MacrosDonut` raconte le reglage supprime et pourquoi. Chercher
 * un nom dans la source brute confondrait donc l'explication d'une absence avec
 * la chose absente, et ce recit a plus de valeur que le test n'a de raisons de
 * l'interdire.
 */
const codeSeul = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * Les quatre endroits qui affichent une figure de repartition ET son tableau.
 *
 * `anneau` et `tableau` sont les marqueurs a chercher dans la source ; l'ordre
 * de leurs positions est ce que le test verifie.
 */
const ECRANS = [
  {
    nom: 'la fiche de recette',
    fichier: 'screens/recettes/RecipeView.tsx',
    anneau: '<MacrosRing',
    tableau: '<TableauNutriments',
  },
  {
    nom: "l'editeur de recette",
    fichier: 'screens/recettes/RecipeDerived.tsx',
    anneau: '<MacrosRing',
    tableau: '<table className="nutrition-table',
  },
  {
    nom: 'la journee et la semaine',
    fichier: 'screens/semaine/Apports.tsx',
    anneau: '<MacrosRing',
    tableau: '<TableauNutriments',
  },
  {
    nom: "la feuille d'un repas",
    fichier: 'screens/semaine/EntrySheet.tsx',
    anneau: '<MacrosDonut',
    tableau: '<TableauNutriments',
  },
] as const

describe('anneau puis tableau', () => {
  for (const ecran of ECRANS) {
    it(`${ecran.nom} pose l'anneau AVANT son tableau`, () => {
      const source = lire(ecran.fichier)
      const iAnneau = source.indexOf(ecran.anneau)
      const iTableau = source.indexOf(ecran.tableau)

      expect(iAnneau, `${ecran.fichier} : anneau introuvable`).toBeGreaterThan(-1)
      expect(iTableau, `${ecran.fichier} : tableau introuvable`).toBeGreaterThan(-1)
      // La figure montre, le tableau chiffre ce qu'elle montre.
      expect(iAnneau, `${ecran.fichier} : le tableau passe avant l'anneau`).toBeLessThan(iTableau)
    })
  }

  it("l'ecran du jour ne pose plus d'anneau a lui, il passe par la carte des apports", () => {
    // Il en avait un, dans une carte SEPAREE et POSEE APRES le tableau, avec la
    // carte d'objectif entre les deux.
    const jour = lire('screens/DayScreen.tsx')
    expect(jour).not.toContain('<MacrosDonut')
    expect(jour).toContain('anneau="kcal ce jour"')
  })

  it("l'editeur ne pose plus d'anneau a lui non plus", () => {
    const editeur = lire('screens/recettes/RecipeEditor.tsx')
    expect(editeur).not.toContain('<MacrosDonut')
  })
})

describe('la colonne de part', () => {
  it('existe dans le tableau partage', () => {
    const partage = lire('components/TableauNutriments.tsx')
    expect(partage).toContain('nutrition-table__part')
    expect(partage).toContain('massShare')
  })

  it("existe dans le tableau propre a l'editeur, qui en manquait", () => {
    // Ce tableau-ci a trois colonnes d'echelle et n'utilise pas le composant
    // partage : il avait donc echappe a la regle.
    const editeur = lire('screens/recettes/RecipeDerived.tsx')
    expect(editeur).toContain('nutrition-table__part')
    expect(editeur).toContain('massShare')
  })

  it("se lit AVANT les colonnes d'echelle dans l'editeur", () => {
    /*
     * Sa place est raisonnee, pas esthetique. Les trois echelles forment une
     * famille ; la part n'en fait pas partie, puisqu'elle vaut pareil pour les
     * trois. Et posee en cinquieme colonne elle sortait de l'ecran : mesure sur
     * un telephone, le tableau fait 469 px pour 311 visibles, la part se serait
     * trouvee a 469.
     */
    const source = lire('screens/recettes/RecipeDerived.tsx')
    const iPart = source.indexOf('<th scope="col">Part</th>')
    const iEchelles = source.indexOf('{columns.map(([label]) => (')
    expect(iPart).toBeGreaterThan(-1)
    expect(iPart).toBeLessThan(iEchelles)
  })

  it('n en donne pas aux lignes qui n en ont pas', () => {
    // L'energie EST le total, le sel n'appartient a aucune des quatre familles,
    // et les sous-lignes sont deja comptees dans la leur. `massShare` rend
    // `null` pour ces cles, ce qui vide la cellule.
    const partage = lire('components/TableauNutriments.tsx')
    expect(partage).toMatch(/massShare\(total, row\.key\)/)
  })
})

describe('la legende', () => {
  it("n'existe plus, et ne peut plus revenir par omission", () => {
    /*
     * Elle etait un `showLegend?: boolean` optionnel valant `true` : les ecrans
     * corrects le posaient a `false`, celui qui l'oubliait gardait sa legende.
     * Corriger la VALEUR ne suffisait pas, il fallait supprimer le REGLAGE.
     */
    const composant = codeSeul(lire('components/MacrosDonut.tsx'))
    expect(composant).not.toContain('showLegend')
    expect(composant).not.toContain('macros__legend')
    // Et aucun appelant ne le passe, ce qui serait de toute facon une erreur de
    // compilation aujourd'hui : ceinture et bretelles, la ceinture etant le
    // typecheck.
    for (const ecran of ECRANS) {
      expect(codeSeul(lire(ecran.fichier)), ecran.fichier).not.toContain('showLegend')
    }
  })
})
