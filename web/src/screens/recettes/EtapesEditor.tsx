/**
 * Les etapes d'une recette, saisies une par une.
 *
 * ELLES RESTENT UNE SEULE CHAINE EN BASE. `recipe.instructions` ne change pas
 * de type : les etapes sont ses LIGNES, jointes par des sauts de ligne a
 * l'enregistrement et redecoupees a l'ouverture. Aucune migration, et surtout
 * aucune recette existante a ressaisir : un bloc deja tape se presente
 * decoupe, et un bloc d'un seul paragraphe reste une etape, ce qui est le bon
 * comportement.
 *
 * C'est la meme regle que partout ailleurs dans ce projet : ce qui est stocke
 * reste ce que la personne a tape, la lecture se recalcule. `parseSteps`
 * (`shared/src/steps.ts`) fait le meme decoupage cote lecture, et cet editeur
 * ecrit ce qu'il sait relire.
 *
 * LES INTERTITRES SE SAISISSENT COMME LES ETAPES. Une ligne finissant par deux
 * points (« Pour la sauce : ») est rendue comme un titre a la lecture, sans
 * numero, et ne decale pas la numerotation. Rien a cocher : on l'ecrit, elle
 * se comporte comme telle.
 */

import { useMemo } from 'react'
import { stepRanks } from '@livre/shared'

import { TextArea } from '../../components/Field.js'
import { Icon } from '../../icons/index.js'

export function EtapesEditor({
  instructions,
  onChange,
}: {
  readonly instructions: string
  readonly onChange: (instructions: string) => void
}) {
  /*
   * Le decoupage BRUT, ligne a ligne, et non `parseSteps` : l'editeur doit
   * rendre exactement ce qui est stocke, y compris une numerotation tapee a la
   * main, sinon la corriger la ferait disparaitre sous les doigts. `parseSteps`
   * ne sert ici qu'a montrer le rang tel qu'il s'affichera a la lecture.
   */
  const lignes = useMemo(() => {
    const brut = instructions.split(/\r?\n/)
    // Une chaine vide donne [''] : c'est voulu, l'editeur ouvre alors sur un
    // champ unique plutot que sur rien.
    return brut.length === 0 ? [''] : brut
  }, [instructions])

  /**
   * Les rangs tels que la fiche les affichera, alignes UN POUR UN sur les
   * champs.
   *
   * Premiere version : une table du texte vers son rang, construite depuis
   * `parseSteps`. Elle manquait toute ligne dont `parseSteps` retire quelque
   * chose : « 4) Ajuste le sel » etait indexee sans son « 4) », la recherche
   * echouait, et l'etape passait pour un intertitre. Le rang se calcule
   * desormais sur les lignes brutes, par la meme regle.
   */
  const rangs = useMemo(() => stepRanks(lignes), [lignes])

  const poser = (suivantes: string[]) => onChange(suivantes.join('\n'))

  const changer = (i: number, valeur: string) =>
    poser(lignes.map((l, k) => (k === i ? valeur : l)))

  const inserer = (apres: number) => {
    const suivantes = [...lignes]
    suivantes.splice(apres + 1, 0, '')
    poser(suivantes)
  }

  const retirer = (i: number) => {
    const suivantes = lignes.filter((_, k) => k !== i)
    poser(suivantes.length === 0 ? [''] : suivantes)
  }

  const deplacer = (i: number, sens: -1 | 1) => {
    const j = i + sens
    if (j < 0 || j >= lignes.length) return
    const suivantes = [...lignes]
    const a = suivantes[i] as string
    suivantes[i] = suivantes[j] as string
    suivantes[j] = a
    poser(suivantes)
  }

  return (
    <div className="etapes-editor">
      <p className="field__label">Étapes</p>

      <ol className="etapes-editor__liste">
        {lignes.map((ligne, i) => {
          const rang = rangs[i] ?? null
          const intertitre = ligne.trim() !== '' && rang === null
          return (
            <li key={i} className="etape-champ">
              <span
                className={`etape-champ__rang${intertitre ? ' etape-champ__rang--titre' : ''}`}
                aria-hidden="true"
              >
                {rang ?? '§'}
              </span>

              <TextArea
                label={`Étape ${i + 1}`}
                className="field--sans-libelle"
                value={ligne}
                onChange={(v) => changer(i, v)}
                placeholder={i === 0 ? 'Rince les lentilles à l’eau froide…' : 'Étape suivante…'}
                minRows={1}
              />

              <div className="etape-champ__outils">
                <button
                  type="button"
                  className="etape-champ__outil"
                  onClick={() => deplacer(i, -1)}
                  disabled={i === 0}
                  aria-label={`Monter l’étape ${i + 1}`}
                >
                  <Icon name="ui-chevron-up" size={16} />
                </button>
                <button
                  type="button"
                  className="etape-champ__outil"
                  onClick={() => deplacer(i, 1)}
                  disabled={i === lignes.length - 1}
                  aria-label={`Descendre l’étape ${i + 1}`}
                >
                  <Icon name="ui-chevron-down" size={16} />
                </button>
                <button
                  type="button"
                  className="etape-champ__outil etape-champ__outil--retirer"
                  onClick={() => retirer(i)}
                  disabled={lignes.length === 1 && ligne === ''}
                  aria-label={`Retirer l’étape ${i + 1}`}
                >
                  <Icon name="ui-trash" size={16} />
                </button>
              </div>
            </li>
          )
        })}
      </ol>

      <button
        type="button"
        className="button button--secondary"
        onClick={() => inserer(lignes.length - 1)}
      >
        <Icon name="ui-plus" size={16} className="icon--inline" /> Ajouter une étape
      </button>

      <p className="field__hint">
        Une étape par champ. Une ligne qui se termine par deux points, comme «&nbsp;Pour la
        sauce&nbsp;:&nbsp;», devient un intertitre : elle ne prend pas de numéro et ne décale pas
        les étapes suivantes.
      </p>
    </div>
  )
}
