/**
 * L'editeur de bornes chiffrees, partage par la bibliotheque et l'import.
 *
 * Il vivait dans l'ecran Ingredients. Des que l'import a du filtrer lui aussi,
 * le copier aurait cree deux comportements a maintenir d'accord — et ils
 * auraient diverge au premier ajustement.
 *
 * La forme n'est pas une grille de champs min/max mais une LISTE DE REGLES :
 * on ajoute « Protéines ≥ 20 », puis « Sel ≤ 1 ». On ne paie que ce qu'on
 * demande, et n'importe quel nutriment est atteignable — ce que douze champs
 * figes n'offraient pas.
 */

import type { Criterion } from '@livre/shared'

import { formatDecimalInput, parseDecimal } from '../../components/Field.js'
import { Icon } from '../../icons/index.js'

export interface CriterionFieldDef {
  readonly code: string
  readonly label: string
  readonly unit: string
}

export function CriteriaFields({
  criteria,
  onChange,
  fields,
  hint,
}: {
  readonly criteria: readonly Criterion[]
  readonly onChange: (criteria: Criterion[]) => void
  readonly fields: readonly CriterionFieldDef[]
  readonly hint?: string
}) {
  const update = (index: number, patch: Partial<Criterion>) =>
    onChange(criteria.map((c, i) => (i === index ? { ...c, ...patch } : c)))

  return (
    <fieldset className="ing-choices">
      <legend className="ing-choices__legend">Bornes chiffrées</legend>

      {criteria.map((criterion, index) => {
        const champ = fields.find((f) => f.code === criterion.field)
        return (
          <div className="ing-criterion" key={`${criterion.field}-${index}`}>
            <select
              className="field__select ing-criterion__field"
              value={criterion.field}
              onChange={(e) => update(index, { field: e.target.value })}
              aria-label="Nutriment ou propriété"
            >
              {fields.map((f) => (
                <option key={f.code} value={f.code}>
                  {f.label}
                </option>
              ))}
            </select>

            <select
              className="field__select ing-criterion__bound"
              value={criterion.bound}
              onChange={(e) => update(index, { bound: e.target.value as 'min' | 'max' })}
              aria-label="Sens de la borne"
            >
              {/* Les symboles plutot que « au moins » / « au plus » : dans une
                  ligne qui se lit « Protéines ≥ 20 g/100 g », le signe se
                  comprend d'un coup d'oeil la ou les mots demandaient d'etre
                  lus. Les valeurs stockees restent `min` et `max` : les liens
                  deja partages continuent de fonctionner. */}
              <option value="min">≥</option>
              <option value="max">≤</option>
            </select>

            {/* `type="text"` et non `number` : le clavier francais produit une
                virgule, que `type="number"` refuse dans plusieurs navigateurs —
                on saisirait « 0,5 » et le champ se viderait. */}
            <input
              type="text"
              inputMode="decimal"
              className="search-field ing-criterion__value"
              value={formatDecimalInput(criterion.value, 2)}
              onChange={(e) => update(index, { value: parseDecimal(e.target.value) ?? 0 })}
              aria-label={`Valeur en ${champ?.unit ?? ''}`}
            />
            <span className="ing-criterion__unit">{champ?.unit}</span>

            <button
              type="button"
              className="button button--danger ing-criterion__remove"
              onClick={() => onChange(criteria.filter((_, i) => i !== index))}
              aria-label="Retirer cette borne"
            >
              <Icon name="ui-close" size={16} />
            </button>
          </div>
        )
      })}

      <button
        type="button"
        className="button button--secondary"
        onClick={() =>
          // Les proteines par defaut, et non le premier champ de la liste : c'est
          // la borne qu'on pose le plus souvent, et « Énergie ≥ 10 » ne filtre
          // rien. Le choix etait deliberé avant l'extraction du composant ; il
          // s'etait perdu en cours de route.
          onChange([
            ...criteria,
            {
              field: fields.some((f) => f.code === 'proteins') ? 'proteins' : (fields[0]?.code ?? 'kcal'),
              bound: 'min',
              value: 10,
            },
          ])
        }
      >
        <Icon name="ui-plus" size={16} className="icon--inline" /> Ajouter une borne
      </button>

      <p className="field__hint">
        {hint ??
          'Toutes les bornes doivent être satisfaites. Un ingrédient dont la valeur n’est pas renseignée n’en satisfait aucune — sinon « moins de 1 g de sel » ramènerait les fiches vides.'}
      </p>
    </fieldset>
  )
}
