/**
 * Un repas planifie : changer sa quantite, le deplacer, le retirer.
 *
 * Cette feuille n'a pas d'equivalent sur le desktop, ou une entree ne pouvait
 * ni etre modifiee ni etre deplacee autrement qu'en la supprimant et en la
 * recreant, et ou le deplacement passait par un glisser-deposer a la souris.
 * Au doigt, viser une cellule de grille est impraticable : « Déplacer vers… »
 * le remplace par deux listes deroulantes natives.
 *
 * Un seul bouton « Enregistrer » pour deux routes d'API (deplacement et
 * quantite) : l'utilisateur n'a pas a savoir qu'il y en a deux, et n'enchaine
 * pas deux validations pour un seul geste.
 */

import { useState } from 'react'
import {
  DAY_LABELS,
  MEAL_SLOTS,
  MEAL_SLOT_LABELS,
  type MealSlot,
} from '@livre/shared'

import { NumberField, SelectField } from '../../components/Field.js'
import { QuantityField } from '../../components/QuantityField.js'
import { Sheet } from '../../components/Sheet.js'
import { useMoveEntry, useUpdateEntryAmount, type CalendarResponse } from '../../lib/queries.js'
import { entryName, targetOf, toMealSlot, type SavedEntry } from './totals.js'
import '../../styles/week.css'

const DAY_OPTIONS = DAY_LABELS.map((label, index) => ({ value: String(index), label }))
const SLOT_OPTIONS = MEAL_SLOTS.map((slot) => ({ value: slot, label: MEAL_SLOT_LABELS[slot] }))

export interface EntrySheetProps {
  readonly isoWeek: string
  readonly entry: SavedEntry
  readonly data: CalendarResponse
  readonly onClose: () => void
  /** La suppression et son annulation vivent dans l'ecran, qui lui survit a la fermeture. */
  readonly onDelete: (entry: SavedEntry, label: string) => void
}

export function EntrySheet({ isoWeek, entry, data, onClose, onDelete }: EntrySheetProps) {
  const target = targetOf(entry, data)
  const isRecipe = entry.recipeId !== null

  const [dayOfWeek, setDayOfWeek] = useState(entry.dayOfWeek)
  const [slot, setSlot] = useState<MealSlot>(entry.slot)
  const [portions, setPortions] = useState<number | null>(entry.portions)
  const [quantityG, setQuantityG] = useState<number | null>(entry.quantityG)

  const move = useMoveEntry(isoWeek)
  const amount = useUpdateEntryAmount(isoWeek)
  const busy = move.isPending || amount.isPending

  const moved = dayOfWeek !== entry.dayOfWeek || slot !== entry.slot
  const amountChanged = isRecipe ? portions !== entry.portions : quantityG !== entry.quantityG
  const amountValid = isRecipe ? portions !== null && portions > 0 : quantityG !== null && quantityG > 0

  const save = async () => {
    // Le deplacement d'abord : si la quantite echoue ensuite, le repas est au
    // moins au bon endroit, et l'ecran reste ouvert sur l'erreur.
    if (moved) await move.mutateAsync({ id: entry.id, dayOfWeek, slot })
    if (amountChanged && amountValid) {
      await amount.mutateAsync({
        id: entry.id,
        quantityG: isRecipe ? null : quantityG,
        portions: isRecipe ? portions : null,
      })
    }
    onClose()
  }

  const label = entryName(entry, data)
  const pieceWeightG = target?.kind === 'ingredient' ? target.ingredient.pieceWeightG : null
  const error = move.error?.message ?? amount.error?.message

  return (
    <Sheet
      open
      onClose={onClose}
      title={label}
      dismissible={!busy}
      actions={
        <>
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            Fermer
          </button>
          <button
            type="button"
            className="button button--primary"
            // Le rejet est deja rendu visible par `mutation.error` : on
            // l'avale pour ne pas laisser une promesse non traitee.
            onClick={() => void save().catch(() => {})}
            disabled={busy || (!moved && !amountChanged) || !amountValid}
          >
            {busy ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <div className="form">
        {isRecipe ? (
          <NumberField
            label="Portions"
            required
            value={portions}
            onChange={setPortions}
            min={0.25}
            max={50}
            decimals={2}
          />
        ) : (
          <QuantityField
            label="Quantité"
            required
            value={quantityG}
            onChange={setQuantityG}
            pieceWeightG={pieceWeightG}
          />
        )}

        <div className="form__row">
          <SelectField
            label="Jour"
            value={String(dayOfWeek)}
            onChange={(value) => setDayOfWeek(Number(value))}
            options={DAY_OPTIONS}
          />
          <SelectField
            label="Créneau"
            value={slot}
            onChange={(value) => setSlot(toMealSlot(value))}
            options={SLOT_OPTIONS}
          />
        </div>

        {target === null && (
          <p className="note">
            La recette ou l’ingrédient de ce repas n’existe plus. Retire-le, ou remplace-le par un
            nouveau repas.
          </p>
        )}

        {error !== undefined && (
          <p className="text-error" role="alert">
            {error}
          </p>
        )}

        <button
          type="button"
          className="button button--danger button--block"
          onClick={() => onDelete(entry, label)}
          disabled={busy}
        >
          Retirer de la semaine
        </button>
      </div>
    </Sheet>
  )
}
