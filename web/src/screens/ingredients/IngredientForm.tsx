/**
 * Fiche d'ingredient — creation ET modification, portage du panneau droit de
 * IngredientsPage.qml.
 *
 * Le desktop montrait liste et formulaire cote a cote dans un SplitView 42/58.
 * En 375 px c'est un ecran a part, atteint depuis la liste et quitte par le
 * bouton Retour. Consequence directe : il faut une barre d'action COLLANTE (le
 * bouton Enregistrer ne se cherche pas au bas d'un formulaire de vingt champs)
 * et un signalement des modifications non enregistrees, que le desktop n'avait
 * pas et dont l'absence se paye bien plus cher au doigt.
 *
 * Trois regles metier qui ne se devinent pas en lisant le formulaire :
 *
 *   1. Une macro VIDE vaut « inconnue » (`null`), pas zero. Le desktop allait
 *      plus loin et convertissait AUSSI un 0 saisi en `null`, rendant
 *      impossible d'affirmer « 0 g de sucres ». Ce piege n'est pas porte :
 *      vide = inconnu, 0 = zero mesure.
 *
 *   2. `source` et `sourceRef` ne partent PAS en modification. Le desktop
 *      affichait un champ « Réf. source » editable dont la saisie etait
 *      ensuite ignoree en silence. Ici il passe en lecture seule des que la
 *      fiche existe.
 *
 *   3. Le prix ne se saisit pas : il derive du dernier releve. La cellule est
 *      un BOUTON qui ouvre l'historique, plutot qu'un cadenas qui n'explique
 *      rien.
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { SOURCE_LABELS, formatEuros, formatGrams, type Ingredient } from '@livre/shared'

import { NumberField, SelectField, TextField } from '../../components/Field.js'
import { ConfirmDialog } from '../../components/Sheet.js'
import { SourceBadge } from '../../components/States.js'
import { ApiError } from '../../lib/api.js'
import {
  useCategories,
  useCreateIngredient,
  useDeleteIngredient,
  useUpdateIngredient,
} from '../../lib/queries.js'
import { PriceHistorySheet } from './PriceHistorySheet.js'
import {
  EMPTY_DRAFT,
  MONTHS,
  draftFromIngredient,
  sourceUrl,
  toWritePayload,
  type IngredientDraft,
} from './model.js'
import '../../styles/ingredients.css'

/** Valeur du menu Rayon qui bascule en saisie libre. */
const CUSTOM_RAYON = '__custom__'

/** Les 8 champs du tableau nutritionnel, dans l'ordre impose par la reglementation UE. */
const NUTRIENTS = [
  { key: 'kcal', label: 'Énergie', unit: 'kcal/100 g', max: 2000, sub: false },
  { key: 'fats', label: 'Lipides', unit: 'g/100 g', max: 100, sub: false },
  { key: 'saturatedFats', label: 'dont acides gras saturés', unit: 'g/100 g', max: 100, sub: true },
  { key: 'carbs', label: 'Glucides', unit: 'g/100 g', max: 100, sub: false },
  { key: 'sugars', label: 'dont sucres', unit: 'g/100 g', max: 100, sub: true },
  { key: 'fiber', label: 'Fibres', unit: 'g/100 g', max: 100, sub: false },
  { key: 'proteins', label: 'Protéines', unit: 'g/100 g', max: 100, sub: false },
  { key: 'salt', label: 'Sel', unit: 'g/100 g', max: 100, sub: false },
] as const

type NutrientKey = (typeof NUTRIENTS)[number]['key']

export interface IngredientFormProps {
  /** `null` en creation. Le parent monte le formulaire avec `key={id}`. */
  readonly ingredient: Ingredient | null
}

export function IngredientForm({ ingredient }: IngredientFormProps) {
  const navigate = useNavigate()
  const create = useCreateIngredient()
  const update = useUpdateIngredient()
  const categories = useCategories()

  const initial = useMemo(
    () => (ingredient ? draftFromIngredient(ingredient) : EMPTY_DRAFT),
    [ingredient],
  )
  const [draft, setDraft] = useState<IngredientDraft>(initial)
  const [nameError, setNameError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState(0)
  const [priceOpen, setPriceOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [customRayon, setCustomRayon] = useState(false)

  const patch = (changes: Partial<IngredientDraft>) =>
    setDraft((current) => ({ ...current, ...changes }))

  const id = ingredient?.id ?? null
  const isPending = create.isPending || update.isPending
  const error = id === null ? create.error : update.error
  // Le doublon de nom n'est pas une panne : il se lit au niveau du champ Nom,
  // la ou l'utilisateur peut le corriger, et pas dans la barre d'action.
  const duplicateMessage =
    error instanceof ApiError && error.code === 'duplicate_name' ? error.message : null

  // Le formulaire est « sale » des qu'il s'ecarte de ce qui a ete charge. La
  // comparaison passe par JSON : le brouillon est un objet plat de valeurs
  // primitives, une comparaison champ a champ n'apprendrait rien de plus.
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  // « ✓ Enregistré » pendant 1,5 s, comme le desktop : sur telephone, rien
  // d'autre ne signale qu'un formulaire est parti — ni titre de fenetre, ni
  // barre d'etat.
  useEffect(() => {
    if (savedAt === 0) return
    const timer = setTimeout(() => setSavedAt(0), 1500)
    return () => clearTimeout(timer)
  }, [savedAt])

  // Un rafraichissement ou une fermeture d'onglet avec un formulaire en cours
  // perd tout sans rien demander. C'est le seul garde-fou que le navigateur
  // laisse poser ; la navigation interne, elle, est signalee par la mention
  // « Modifications non enregistrées » de la barre d'action.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const name = draft.name.trim()
    if (name === '') {
      setNameError("Le nom de l'ingrédient est obligatoire.")
      return
    }
    setNameError(null)

    const payload = toWritePayload(draft)

    if (id === null) {
      create.mutate(
        // `sourceRef` n'est accepte qu'ici : ensuite il identifie la fiche
        // d'origine et n'a plus aucune raison de bouger.
        { ...payload, source: 'manual', sourceRef: draft.sourceRef.trim() || null },
        // `replace` : le bouton Retour ne doit pas ramener sur un formulaire
        // vide qui recreerait un doublon au prochain envoi.
        { onSuccess: (created) => void navigate(`/ingredients/${created.id}`, { replace: true }) },
      )
      return
    }

    // `id` APRES l'etalement : `Partial<Ingredient>` porte un `id` optionnel
    // qui, place en premier, ecraserait celui du chemin par `undefined`.
    update.mutate({ ...payload, id }, { onSuccess: () => setSavedAt(Date.now()) })
  }

  return (
    <>
      <form className="form ing-form" onSubmit={submit}>
        <Identity
          ingredient={ingredient}
          draft={draft}
          nameError={nameError ?? duplicateMessage}
          onPatch={patch}
        />

        <fieldset className="ing-form__section">
          <legend className="ing-form__legend">Valeurs nutritionnelles pour 100 g</legend>
          <p className="field__hint">
            Laisse un champ vide quand la valeur est inconnue : « — » et « 0 » ne disent pas la même
            chose, et un zéro inventé fausserait tous les totaux de la semaine.
          </p>
          {NUTRIENTS.map((nutrient) => (
            <div key={nutrient.key} className={nutrient.sub ? 'ing-form__sub' : undefined}>
              <NumberField
                label={nutrient.label}
                value={draft[nutrient.key]}
                onChange={(value) => patch(nutrientChange(nutrient.key, value))}
                suffix={nutrient.unit}
                min={0}
                max={nutrient.max}
                decimals={2}
              />
            </div>
          ))}
        </fieldset>

        <fieldset className="ing-form__section">
          <legend className="ing-form__legend">Quantités</legend>
          <NumberField
            label="Poids unitaire"
            value={draft.pieceWeightG}
            onChange={(value) => patch({ pieceWeightG: value })}
            suffix="g / pièce"
            min={0}
            max={10000}
            decimals={1}
            hint="1 œuf ≈ 60 g, 1 oignon ≈ 150 g, 1 gousse d’ail ≈ 5 g. Renseigné, il fait apparaître l’unité « pièce » partout où l’on saisit une quantité. Vide pour l’huile, le lait, le riz, le sel."
          />
          <NumberField
            label="Poids cuit"
            value={draft.cookedWeightPer100gRaw}
            onChange={(value) => patch({ cookedWeightPer100gRaw: value })}
            suffix="g / 100 g cru"
            min={0}
            max={1000}
            decimals={1}
            hint="Ex : 300 pour du riz (100 g cru → 300 g cuit). Optionnel — sert à estimer le poids d’une portion servie. Les valeurs nutritionnelles restent par 100 g cru."
          />
        </fieldset>

        <fieldset className="ing-form__section">
          <legend className="ing-form__legend">Rayon</legend>
          {customRayon ? (
            <>
              <TextField
                label="Nom du rayon"
                value={draft.categoryL1}
                onChange={(value) => patch({ categoryL1: value })}
                placeholder="Ex : Fruits & légumes, Viandes…"
                hint="Regroupe l’ingrédient dans la liste de courses et dans le frigo."
                autoFocus
              />
              <button type="button" className="button button--ghost" onClick={() => setCustomRayon(false)}>
                Choisir dans la liste
              </button>
            </>
          ) : (
            <SelectField
              label="Rayon"
              value={draft.categoryL1}
              onChange={(value) => {
                if (value === CUSTOM_RAYON) {
                  setCustomRayon(true)
                  patch({ categoryL1: '' })
                } else {
                  patch({ categoryL1: value })
                }
              }}
              placeholder="Aucun rayon"
              options={[
                ...rayonOptions(categories.data?.items ?? [], draft.categoryL1),
                { value: CUSTOM_RAYON, label: '＋ Autre rayon…' },
              ]}
              hint="Regroupe l’ingrédient dans la liste de courses et dans le frigo."
            />
          )}
        </fieldset>

        <SeasonPicker months={draft.months} onChange={(months) => patch({ months })} />

        {ingredient && <PriceSummary ingredient={ingredient} onOpenHistory={() => setPriceOpen(true)} />}

        <div className="ing-form__danger">
          {id === null ? (
            <button type="button" className="button button--secondary" onClick={() => void navigate(-1)}>
              Annuler
            </button>
          ) : (
            <button type="button" className="button button--danger" onClick={() => setDeleteOpen(true)}>
              {ingredient?.source === 'manual' ? 'Supprimer cet ingrédient' : 'Retirer de ma bibliothèque'}
            </button>
          )}
        </div>

        <div className="ing-actions">
          <p className="ing-actions__state" aria-live="polite">
            {error !== null && duplicateMessage === null ? (
              <span className="text-error" role="alert">
                {error.message}
              </span>
            ) : dirty ? (
              'Modifications non enregistrées'
            ) : (
              ''
            )}
          </p>
          <button
            type="submit"
            className={`button ${savedAt > 0 ? 'button--saved' : 'button--primary'}`}
            disabled={isPending}
          >
            {savedAt > 0 ? '✓ Enregistré' : isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>

      {ingredient && (
        <PriceHistorySheet open={priceOpen} onClose={() => setPriceOpen(false)} ingredient={ingredient} />
      )}

      {ingredient && id !== null && (
        <DeleteDialog open={deleteOpen} ingredient={ingredient} onClose={() => setDeleteOpen(false)} />
      )}
    </>
  )
}

/**
 * Traduit « ce nutriment vaut X » en modification partielle du brouillon.
 *
 * Passe par un `switch` plutot que par une cle calculee : sous
 * `exactOptionalPropertyTypes`, `{ [key]: value }` avec une cle d'union se
 * degrade en signature d'index et perd tout controle de type.
 */
function nutrientChange(key: NutrientKey, value: number | null): Partial<IngredientDraft> {
  switch (key) {
    case 'kcal':
      return { kcal: value }
    case 'fats':
      return { fats: value }
    case 'saturatedFats':
      return { saturatedFats: value }
    case 'carbs':
      return { carbs: value }
    case 'sugars':
      return { sugars: value }
    case 'fiber':
      return { fiber: value }
    case 'proteins':
      return { proteins: value }
    case 'salt':
      return { salt: value }
  }
}

/** Rayons connus, plus celui de la fiche s'il n'est plus utilise par personne d'autre. */
function rayonOptions(
  known: ReadonlyArray<{ l1: string; count: number }>,
  current: string,
): Array<{ value: string; label: string }> {
  const options = known.map((entry) => ({ value: entry.l1, label: `${entry.l1} (${entry.count})` }))
  if (current !== '' && !known.some((entry) => entry.l1 === current)) {
    options.unshift({ value: current, label: current })
  }
  return options
}

// ---------------------------------------------------------------------------
// Identite
// ---------------------------------------------------------------------------

function Identity({
  ingredient,
  draft,
  nameError,
  onPatch,
}: {
  ingredient: Ingredient | null
  draft: IngredientDraft
  nameError: string | null
  onPatch: (changes: Partial<IngredientDraft>) => void
}) {
  const link = ingredient ? sourceUrl(ingredient) : null

  return (
    <fieldset className="ing-form__section">
      <legend className="ing-form__legend">Identité</legend>

      <TextField
        label="Nom"
        value={draft.name}
        onChange={(value) => onPatch({ name: value })}
        placeholder="Ex : Tomate grappe"
        error={nameError}
        required
        autoFocus={ingredient === null}
        enterKeyHint="next"
      />

      <TextField
        label="Marque"
        value={draft.brand}
        onChange={(value) => onPatch({ brand: value })}
        placeholder="Ex : Pâturages, Carrefour Bio… (optionnel)"
      />

      {ingredient === null ? (
        <TextField
          label="Réf. source"
          value={draft.sourceRef}
          onChange={(value) => onPatch({ sourceRef: value })}
          placeholder="Code CIQUAL ou code-barres EAN (optionnel)"
          inputMode="numeric"
          hint="Modifiable uniquement à la création : c’est cette référence qui relie ensuite la fiche à son catalogue d’origine."
        />
      ) : (
        <div className="ing-readonly">
          <span className="field__label">Source</span>
          <span className="ing-readonly__value">
            <SourceBadge source={ingredient.source} />
            {link ? (
              // rel="noopener" : la page ouverte ne doit pas pouvoir manipuler
              // celle-ci par `window.opener`. En PWA iOS le lien quitte
              // l'application, d'ou le libelle explicite.
              <a href={link} target="_blank" rel="noopener noreferrer" className="ing-readonly__link">
                {ingredient.sourceRef} — ouvrir la fiche d’origine ↗
              </a>
            ) : (
              <span>{SOURCE_LABELS[ingredient.source]}</span>
            )}
          </span>
        </div>
      )}
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Saisonnalite
// ---------------------------------------------------------------------------

function SeasonPicker({
  months,
  onChange,
}: {
  months: readonly number[]
  onChange: (months: readonly number[]) => void
}) {
  const selected = new Set(months)

  const toggle = (month: number) => {
    const next = new Set(selected)
    if (next.has(month)) next.delete(month)
    else next.add(month)
    onChange([...next].sort((a, b) => a - b))
  }

  return (
    <fieldset className="ing-form__section">
      <legend className="ing-form__legend">Saisonnalité</legend>
      <p className="field__hint">
        Coche les mois où l’ingrédient est de saison. Vide = pas de badge « 🌱 de saison ».
      </p>

      {/* Deux rangees de six et non une de douze : douze cibles alignees sur
          375 px feraient 28 px de large, sous le minimum tactile. */}
      <div className="ing-months" role="group" aria-label="Mois de saison">
        {MONTHS.map((month) => (
          <button
            key={month.number}
            type="button"
            className={`ing-month${selected.has(month.number) ? ' ing-month--on' : ''}`}
            aria-pressed={selected.has(month.number)}
            aria-label={month.name}
            onClick={() => toggle(month.number)}
          >
            <span aria-hidden="true">{month.initial}</span>
          </button>
        ))}
      </div>

      <div className="ing-months__shortcuts">
        <button
          type="button"
          className="button button--ghost"
          onClick={() => onChange(MONTHS.map((month) => month.number))}
        >
          Toute l’année
        </button>
        <button type="button" className="button button--ghost" onClick={() => onChange([])}>
          Aucun mois
        </button>
      </div>
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Prix
// ---------------------------------------------------------------------------

function PriceSummary({
  ingredient,
  onOpenHistory,
}: {
  ingredient: Ingredient
  onOpenHistory: () => void
}) {
  return (
    <fieldset className="ing-form__section">
      <legend className="ing-form__legend">Prix de référence</legend>

      {/* Cellule cliquable plutot que cadenassee : un champ grise n'explique
          pas POURQUOI il l'est, alors qu'un bouton qui ouvre l'historique
          repond a la question en un tap. */}
      <button type="button" className="ing-price" onClick={onOpenHistory}>
        <span className="ing-price__amount">{formatEuros(ingredient.priceEur)}</span>
        <span className="ing-price__for">
          {ingredient.priceQuantityG ? `pour ${formatGrams(ingredient.priceQuantityG)}` : 'aucun relevé'}
        </span>
        <span className="ing-price__cta" aria-hidden="true">
          📊 Historique ›
        </span>
      </button>

      <p className="field__hint">
        Calculé automatiquement depuis le dernier relevé de l’historique. Il ne se saisit pas
        directement : note ce que tu vois en rayon, le prix suit.
      </p>
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Suppression
// ---------------------------------------------------------------------------

/**
 * Deux suppressions sous un seul bouton.
 *
 * Une fiche CIQUAL ou OpenFoodFacts n'est jamais detruite : elle SORT de la
 * bibliotheque et reste retrouvable dans l'import. Une fiche saisie a la main
 * disparait pour de bon. La confirmation dit lequel des deux va se produire,
 * parce que rien dans l'ecran ne permet de le deviner.
 */
function DeleteDialog({
  open,
  ingredient,
  onClose,
}: {
  open: boolean
  ingredient: Ingredient
  onClose: () => void
}) {
  const navigate = useNavigate()
  const remove = useDeleteIngredient()
  const permanent = ingredient.source === 'manual'

  return (
    <ConfirmDialog
      open={open}
      title={permanent ? `Supprimer « ${ingredient.name} » ?` : `Retirer « ${ingredient.name} » ?`}
      message={
        permanent
          ? 'Cette fiche a été créée à la main : elle sera définitivement supprimée. Si une recette l’utilise, la suppression sera refusée.'
          : `Cette fiche vient de ${SOURCE_LABELS[ingredient.source]} : elle sort de ta bibliothèque mais reste dans le catalogue. Tu pourras la réimporter à tout moment.`
      }
      confirmLabel={permanent ? 'Supprimer' : 'Retirer'}
      danger
      busy={remove.isPending}
      error={remove.error?.message}
      onClose={onClose}
      onConfirm={() => {
        if (ingredient.id === null) return
        remove.mutate(ingredient.id, {
          onSuccess: (result) => {
            onClose()
            // L'instantane voyage dans l'etat de navigation : c'est ce qui
            // permet a la liste d'offrir « Annuler » sans etat serveur, y
            // compris apres une suppression definitive — la fiche est alors
            // RECREEE, avec un nouvel identifiant, comme sur le desktop.
            void navigate('/ingredients', {
              replace: true,
              state: { deleted: { removed: result.removed, ingredient } },
            })
          },
        })
      }}
    />
  )
}
