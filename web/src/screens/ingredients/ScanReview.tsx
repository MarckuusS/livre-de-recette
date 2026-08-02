/**
 * Verification d'un produit scanne, avant de l'ajouter pour de bon.
 *
 * Le scan seul ne suffit pas, et l'usage l'a montre : viser un code-barres
 * remplissait la bibliotheque sans que rien ne soit relu. Or OpenFoodFacts est
 * alimente par des contributeurs — un nom peut etre approximatif, une marque
 * absente, des macros datees d'un ancien emballage. Et deux informations que
 * l'utilisateur est le seul a connaitre n'y figurent JAMAIS : le prix qu'il
 * vient de payer, et le poids d'une piece.
 *
 * D'ou cet ecran intermediaire : « voici ce que j'ai trouve, est-ce bien le
 * produit devant toi, corrige ce qui cloche, ajoute ce que je ne peux pas
 * savoir ». Rien n'est ecrit avant sa validation.
 *
 * Les macros sont repliees par defaut. Les rouvrir a chaque scan pour huit
 * champs qu'on ne touchera pas une fois sur dix ferait de la verification une
 * corvee, et la corvee se contourne.
 */

import { useState } from 'react'
import type { Ingredient } from '@livre/shared'

import { NumberField, TextField } from '../../components/Field.js'
import { SourceBadge } from '../../components/States.js'
import {
  useAddToLibrary,
  useCreateIngredient,
  useRecordPrice,
  type BarcodeResult,
} from '../../lib/queries.js'
import '../../styles/ingredients.css'

/** Jour local au format AAAA-MM-JJ. `toISOString()` decalerait la date le soir. */
function todayLocalIsoDate(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** Les 8 macros du tableau reglementaire, dans l'ordre impose par l'etiquette. */
const MACROS = [
  ['kcal', 'Énergie', 'kcal'],
  ['fats', 'Lipides', 'g'],
  ['saturatedFats', 'dont saturés', 'g'],
  ['carbs', 'Glucides', 'g'],
  ['sugars', 'dont sucres', 'g'],
  ['fiber', 'Fibres', 'g'],
  ['proteins', 'Protéines', 'g'],
  ['salt', 'Sel', 'g'],
] as const

type MacroKey = (typeof MACROS)[number][0]

interface Draft {
  name: string
  brand: string
  pieceWeightG: number | null
  macros: Record<MacroKey, number | null>
  priceEur: number | null
  priceQuantityG: number | null
  store: string
}

function draftFrom(product: BarcodeResult): Draft {
  return {
    name: product.name,
    brand: product.brand ?? '',
    pieceWeightG: product.pieceWeightG,
    macros: {
      kcal: product.kcal,
      fats: product.fats,
      saturatedFats: product.saturatedFats,
      carbs: product.carbs,
      sugars: product.sugars,
      fiber: product.fiber,
      proteins: product.proteins,
      salt: product.salt,
    },
    priceEur: null,
    priceQuantityG: null,
    store: '',
  }
}

/** Combien de macros OpenFoodFacts a reellement fournies. */
const filledMacros = (draft: Draft): number =>
  Object.values(draft.macros).filter((value) => value !== null).length

export interface ScanReviewProps {
  readonly ean: string
  readonly product: BarcodeResult
  /** Vrai si le produit est deja dans la bibliotheque personnelle. */
  readonly known: boolean
  readonly onAdded: (message: string) => void
  readonly onDismiss: () => void
}

export function ScanReview({ ean, product, known, onAdded, onDismiss }: ScanReviewProps) {
  // `key` sur l'appelant garantit un brouillon neuf par produit : sans cela,
  // scanner un second article reprendrait le prix du premier.
  const [draft, setDraft] = useState<Draft>(() => draftFrom(product))
  const [macrosOpen, setMacrosOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = useCreateIngredient()
  const addToLibrary = useAddToLibrary()
  const recordPrice = useRecordPrice()

  const busy = create.isPending || addToLibrary.isPending || recordPrice.isPending
  const nameOk = draft.name.trim().length > 0

  // Un prix a moitie saisi est une erreur ; un prix absent n'en est pas une.
  const priceState: 'empty' | 'partial' | 'ready' =
    draft.priceEur === null && draft.priceQuantityG === null
      ? 'empty'
      : draft.priceEur !== null && draft.priceEur > 0 && draft.priceQuantityG !== null && draft.priceQuantityG > 0
        ? 'ready'
        : 'partial'

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }))

  const setMacro = (key: MacroKey, value: number | null) =>
    setDraft((previous) => ({ ...previous, macros: { ...previous.macros, [key]: value } }))

  const submit = async () => {
    setError(null)
    if (!nameOk) {
      setError('Donne un nom à ce produit.')
      return
    }
    if (priceState === 'partial') {
      setError('Le prix demande un montant ET la quantité correspondante.')
      return
    }

    try {
      // Une ligne deja au catalogue s'ajoute par bascule de drapeau ; un
      // candidat OpenFoodFacts n'existe pas encore et doit etre cree. Creer
      // dans le premier cas buterait sur l'unicite du nom.
      const saved: Ingredient =
        product.id !== null
          ? await addToLibrary.mutateAsync(product.id)
          : await create.mutateAsync({
              name: draft.name.trim(),
              source: 'openfoodfacts',
              sourceRef: ean,
              brand: draft.brand.trim() || null,
              ...draft.macros,
              pieceWeightG: draft.pieceWeightG,
            })

      if (priceState === 'ready' && saved.id !== null) {
        await recordPrice.mutateAsync({
          ingredientId: saved.id,
          // Le montant est saisi en nombre mais stocke en chaine decimale :
          // un flottant ne represente pas 0,1 € exactement, et l'erreur
          // s'accumule sur une liste de courses.
          priceEur: (draft.priceEur ?? 0).toFixed(4),
          quantityG: draft.priceQuantityG ?? 0,
          store: draft.store.trim() || null,
          recordedAt: todayLocalIsoDate(),
          notes: null,
        })
      }

      onAdded(`✓ ${saved.name} ajouté à ta bibliothèque.`)
      onDismiss()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Enregistrement impossible.')
    }
  }

  if (known) {
    return (
      <div className="card scan-review">
        <p className="row__meta">
          <SourceBadge source={product.source} />
          <span>{ean}</span>
        </p>
        <h3 className="card__title">{product.name}</h3>
        <p className="status status--ok">Ce produit est déjà dans ta bibliothèque.</p>
        <button type="button" className="button button--secondary" onClick={onDismiss}>
          Scanner autre chose
        </button>
      </div>
    )
  }

  const found = filledMacros(draft)

  return (
    <div className="card scan-review">
      <p className="row__meta">
        <SourceBadge source={product.source} />
        <span>{ean}</span>
      </p>

      <p className="card__lead">
        Voici ce qu’OpenFoodFacts connaît de ce code. Vérifie que c’est bien le produit devant toi,
        corrige ce qui cloche, puis ajoute-le.
      </p>

      <TextField label="Nom" value={draft.name} onChange={(v) => set('name', v)} required />
      <TextField
        label="Marque"
        value={draft.brand}
        onChange={(v) => set('brand', v)}
        placeholder="Facultatif"
      />

      {/* Deux informations qu'OpenFoodFacts n'a jamais, et que seul
          l'utilisateur peut donner — au moment ou il tient le produit. */}
      <NumberField
        label="Poids d’une pièce"
        value={draft.pieceWeightG}
        onChange={(v) => set('pieceWeightG', v)}
        suffix="g"
        emptyOnZero
        hint="1 œuf ≈ 60 g. Renseigné, il fait apparaître l’unité « pièce » partout."
      />

      <fieldset className="scan-review__price">
        <legend className="scan-review__legend">Prix payé</legend>
        <NumberField
          label="Montant"
          value={draft.priceEur}
          onChange={(v) => set('priceEur', v)}
          suffix="€"
          emptyOnZero
          {...(priceState === 'partial' && draft.priceEur === null
            ? { error: 'Montant manquant.' }
            : {})}
        />
        <NumberField
          label="Pour"
          value={draft.priceQuantityG}
          onChange={(v) => set('priceQuantityG', v)}
          suffix="g"
          emptyOnZero
          {...(priceState === 'partial' && draft.priceQuantityG === null
            ? { error: 'Quantité manquante.' }
            : {})}
        />
        <TextField
          label="Magasin"
          value={draft.store}
          onChange={(v) => set('store', v)}
          placeholder="Facultatif"
        />
        <p className="field__hint">
          Facultatif. Il alimente l’historique de prix, et donc le coût de ta liste de courses.
        </p>
      </fieldset>

      <details
        className="scan-review__macros"
        open={macrosOpen}
        onToggle={(event) => setMacrosOpen(event.currentTarget.open)}
      >
        <summary>
          Valeurs nutritionnelles — {found} sur 8 renseignée{found > 1 ? 's' : ''}
        </summary>
        {found < 8 && (
          <p className="field__hint">
            Ce qui manque reste vide : « — » et « 0 » ne disent pas la même chose, et un zéro
            inventé fausserait tous les totaux de la semaine.
          </p>
        )}
        {MACROS.map(([key, label, unit]) => (
          <NumberField
            key={key}
            label={label}
            value={draft.macros[key]}
            onChange={(v) => setMacro(key, v)}
            suffix={`${unit}/100 g`}
            emptyOnZero
          />
        ))}
      </details>

      {error && (
        <p className="status status--error" role="alert">
          {error}
        </p>
      )}

      <div className="scan-review__actions">
        <button
          type="button"
          className="button button--primary"
          onClick={() => void submit()}
          disabled={busy || !nameOk}
        >
          {busy ? 'Enregistrement…' : 'Ajouter à ma bibliothèque'}
        </button>
        <button type="button" className="button button--secondary" onClick={onDismiss} disabled={busy}>
          Ce n’est pas ce produit
        </button>
      </div>
    </div>
  )
}
