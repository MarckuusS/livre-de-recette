/**
 * Une ligne de repas.
 *
 * Elle vivait dans `WeekScreen`, ou elle est nee. L'Accueil montre les memes
 * repas — ceux d'aujourd'hui — et les recopier aurait produit deux facons de
 * lire un meme repas selon l'ecran par lequel on y arrive. Elle est donc
 * DEPLACEE ici, pas dupliquee.
 *
 * Toute la ligne est un bouton : quantite, deplacement et retrait sont dans la
 * feuille qu'elle ouvre. Le desktop n'exposait qu'un croix de 22 px, sous la
 * cible tactile minimale.
 */

import {
  formatEuros,
  mealPlanEntryCost,
} from '@livre/shared'

import { MacroBar } from '../../components/MacrosDonut.js'
import { Icon, RayonIcon } from '../../icons/index.js'
import { useRayonStyle } from '../../lib/useRayonStyle.js'
import type { CalendarResponse } from '../../lib/queries.js'
import { entryAmountLabel, entryName, entryNutrition, targetOf, type SavedEntry } from './totals.js'

export function MealRow({
  entry,
  data,
  onEdit,
}: {
  entry: SavedEntry
  data: CalendarResponse
  onEdit: (entry: SavedEntry) => void
}) {
  const name = entryName(entry, data)
  const nutrition = entryNutrition(entry, data)
  const kcal = nutrition.kcal

  // Cout de CETTE ligne. « 20 g d'isolat » ne dit rien de la depense, et le
  // total du jour ne se repartit pas a l'oeil : sans cette valeur, impossible
  // de savoir ce que pese un ingredient dans la note.
  const target = targetOf(entry, data)
  const styleOf = useRayonStyle()
  const cost = target === null ? null : mealPlanEntryCost(entry, target)

  return (
    <li className="meal">
      {/* Toute la ligne ouvre la feuille du repas : quantite, deplacement et
          retrait y sont reunis. Le desktop n'exposait qu'un ✕ de 22 px, sous la
          cible tactile minimale. */}
      <button type="button" className="meal__button" onClick={() => onEdit(entry)}>
        {/* Une recette porte les couverts, un ingredient l'icone de son rayon :
            dans une journee de cinq lignes, c'est ce qui distingue un plat
            cuisine d'un simple yaourt sans avoir a lire. */}
        <span
          className="icon-chip icon-chip--sm"
          {...(target?.kind === 'ingredient'
            ? styleOf(target.ingredient.categoryL1).tint
            : { 'data-rayon': 'autre' })}
        >
          {target?.kind === 'ingredient' ? (
            <RayonIcon glyph={styleOf(target.ingredient.categoryL1).glyph} size={18} strokeWidth={1.8} />
          ) : (
            <Icon name={target === null ? 'ui-alert' : 'ui-utensils'} size={18} strokeWidth={1.8} />
          )}
        </span>
        <span className="meal__body">
          <span className="meal__name">{name}</span>
          <span className="meal__meta">
            <span>{entryAmountLabel(entry)}</span>
            {kcal > 0 && <span>{Math.round(kcal).toLocaleString('fr-FR')} kcal</span>}
            {/* Un prix inconnu ne s'affiche pas en « 0,00 € » : le panneau de
                cout compte deja ces lignes et le dit en toutes lettres. */}
            {cost !== null && <span className="meal__cost">{formatEuros(cost.toFixed(4))}</span>}
          </span>
          {/* La repartition, en trois pixels. Sept valeurs chiffrees seraient
              illisibles sur une ligne qui porte deja un nom, une quantite, une
              energie et un prix ; l'allure d'un repas, elle, se lit d'un coup
              d'oeil. Le detail est dans la feuille, au tap. */}
          <MacroBar total={nutrition} />
        </span>
        <span className="meal__chevron" aria-hidden="true">
          ›
        </span>
      </button>
    </li>
  )
}
