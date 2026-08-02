/**
 * Libelle de nutriment avec son pictogramme — portage de NutrientLabel.qml.
 *
 * Les icones sont celles dessinees pour l'application de bureau, reprises
 * telles quelles : elles font partie de l'identite de l'application et leur
 * absence se remarque. Reduites de 250 a 72 px et quantifiees en palette
 * (487 Ko a 58 Ko pour les huit), ce qui reste raisonnable pour une PWA qui
 * les telecharge une fois.
 *
 * Les sous-lignes du tableau reglementaire — « dont sucres », « dont acides
 * gras saturés » — n'ont pas de picto propre : elles sont un detail de la
 * ligne au-dessus, pas un nutriment de plus. Elles reprennent son retrait pour
 * rester alignees.
 */

import type { NutritionTotal } from '@livre/shared'

/**
 * Cle de macro vers nom de fichier.
 *
 * Seule `kcal` differe : le fichier de bureau s'appelle `energy`. On garde son
 * nom plutot que de renommer un fichier livre avec l'application d'origine.
 */
const ICON_FILES: Record<keyof NutritionTotal, string> = {
  kcal: 'energy',
  fats: 'fats',
  saturatedFats: 'saturatedFats',
  carbs: 'carbs',
  sugars: 'sugars',
  fiber: 'fiber',
  proteins: 'proteins',
  salt: 'salt',
}

export interface NutrientLabelProps {
  readonly nutrient: keyof NutritionTotal
  readonly label: string
  /** Sous-ligne du tableau reglementaire : retrait, italique, pas de picto. */
  readonly sub?: boolean
}

export function NutrientLabel({ nutrient, label, sub = false }: NutrientLabelProps) {
  if (sub) return <span className="nutrient-label nutrient-label--sub">{label}</span>

  return (
    <span className="nutrient-label">
      <img
        className="nutrient-label__icon"
        src={`/icons/nutrient/${ICON_FILES[nutrient]}.png`}
        // Purement decoratif : le libelle juste a cote dit deja tout. Un `alt`
        // renseigne ferait lire deux fois le meme mot par un lecteur d'ecran.
        alt=""
        width={22}
        height={22}
        // Le tableau des apports est sous la ligne de flottaison sur telephone.
        loading="lazy"
        decoding="async"
      />
      {label}
    </span>
  )
}
