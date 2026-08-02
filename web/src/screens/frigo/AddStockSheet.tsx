/**
 * Ajout d'un lot au frigo — portage d'AddPantryStockDialog.qml.
 *
 * Le desktop ouvrait une vraie fenetre systeme, non modale, deplacable hors de
 * l'application. Rien de tout cela n'a de sens au doigt : c'est une feuille qui
 * monte du bas, avec un seul bouton d'action en pied.
 *
 * Trois defauts du dialogue d'origine sont corriges ici, tous signales par
 * l'inventaire de parite :
 *
 *   1. Il se fermait AVANT de savoir si l'enregistrement avait reussi. Sur le
 *      web la requete peut echouer, et l'utilisateur perdrait sa saisie : la
 *      feuille ne se ferme qu'au succes.
 *   2. Le bouton restait grise sans dire pourquoi. Il reste actif et explique
 *      au tap ce qui manque — un bouton mort au doigt n'apprend rien.
 *   3. Une date mal formee etait silencieusement ignoree et l'article
 *      enregistre sans peremption. `<input type="date">` rend la saisie
 *      invalide impossible.
 *
 * Aucune deduplication, comme sur le desktop : ajouter deux fois le meme
 * ingredient cree deux lots, c'est toute la raison d'etre de l'ecran.
 */

import { useState } from 'react'
import type { Ingredient } from '@livre/shared'

import { DateField, TextField } from '../../components/Field.js'
import { IngredientPicker } from '../../components/IngredientPicker.js'
import { QuantityField } from '../../components/QuantityField.js'
import { Sheet } from '../../components/Sheet.js'
import { useToast } from '../../components/Toast.js'
import { useAddStock } from '../../lib/queries.js'

/**
 * Quantite proposee des qu'un ingredient est choisi : une piece si
 * l'ingredient en a une, 100 g sinon. Regle metier du desktop, a tenir quel que
 * soit le geste d'ajout.
 */
const DEFAULT_QUANTITY_G = 100

/** Longueur de la colonne `notes` en base. Le desktop ne la faisait pas respecter. */
const NOTES_MAX_LENGTH = 500

export interface AddStockSheetProps {
  readonly onClose: () => void
}

export function AddStockSheet({ onClose }: AddStockSheetProps) {
  const add = useAddStock()
  const toast = useToast()

  const [ingredient, setIngredient] = useState<Ingredient | null>(null)
  const [quantityG, setQuantityG] = useState<number | null>(null)
  const [expiryDate, setExpiryDate] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  // Les erreurs n'apparaissent qu'apres une tentative : signaler « ingredient
  // manquant » sur un formulaire vierge accuse l'utilisateur avant qu'il ait
  // fait quoi que ce soit.
  const [attempted, setAttempted] = useState(false)

  const pick = (picked: Ingredient) => {
    setIngredient(picked)
    setQuantityG(picked.pieceWeightG ?? DEFAULT_QUANTITY_G)
  }

  const missingIngredient = ingredient === null || ingredient.id === null
  const missingQuantity = quantityG === null || quantityG <= 0

  const submit = () => {
    setAttempted(true)
    // Les memes conditions que ci-dessus, re-testees sur les valeurs elles-memes
    // pour que TypeScript sache ici que l'identifiant et la quantite existent.
    if (ingredient === null || ingredient.id === null) return
    if (quantityG === null || quantityG <= 0) return

    add.mutate(
      {
        ingredientId: ingredient.id,
        quantityG,
        expiryDate,
        // Chaine vide -> null : le desktop stockait tantot l'un tantot l'autre
        // selon le chemin de code, et « pas de note » devenait deux choses.
        notes: notes.trim() === '' ? null : notes.trim(),
      },
      {
        onSuccess: () => {
          toast.show({ message: `${ingredient.name} ajouté au frigo.` })
          onClose()
        },
      },
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Ajouter au stock"
      // Pendant l'enregistrement, fermer ferait croire a une annulation alors
      // que la requete est deja partie.
      dismissible={!add.isPending}
      actions={
        <>
          <button
            type="button"
            className="button button--secondary"
            onClick={onClose}
            disabled={add.isPending}
          >
            Annuler
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={submit}
            disabled={add.isPending}
          >
            {add.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      {ingredient === null ? (
        <IngredientPicker
          onPick={pick}
          label="Ingrédient"
          placeholder="Cherche dans ta bibliothèque…"
          hint="Seule ta bibliothèque personnelle est proposée."
          required
          error={attempted && missingIngredient ? 'Choisis un ingrédient.' : null}
        />
      ) : (
        <div className="picked">
          <span className="picked__label">Ingrédient</span>
          <span className="picked__name">{ingredient.name}</span>
          <button
            type="button"
            className="button button--ghost picked__change"
            onClick={() => setIngredient(null)}
          >
            Changer
          </button>
        </div>
      )}

      <QuantityField
        label="Quantité"
        value={quantityG}
        onChange={setQuantityG}
        pieceWeightG={ingredient?.pieceWeightG ?? null}
        required
        error={attempted && missingQuantity ? 'Indique une quantité supérieure à zéro.' : null}
      />

      <DateField
        label="Périmé le"
        value={expiryDate}
        onChange={setExpiryDate}
        hint="Facultatif — laisse vide pour le sel, les épices, les conserves."
      />

      <TextField
        label="Note"
        value={notes}
        onChange={setNotes}
        placeholder="Ex : promo Lidl, ouvert hier…"
        maxLength={NOTES_MAX_LENGTH}
      />

      {add.isError && (
        <p className="text-error" role="alert">
          {add.error.message}
        </p>
      )}
    </Sheet>
  )
}
