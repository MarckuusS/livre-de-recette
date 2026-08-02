/**
 * Tags d'une recette : la rangee de pastilles du formulaire, et la feuille qui
 * ouvre le catalogue complet.
 *
 * Deux ecarts avec le desktop, tous deux dictes par l'API :
 *
 *   1. Le desktop persistait un tag AU CLIC, hors du tampon d'edition. Ici il
 *      n'existe pas de route dediee (`PUT /api/recipes/:id/tags`) : les tags
 *      partent dans la charge utile d'enregistrement, comme le reste. C'est
 *      d'ailleurs plus previsible — « Abandonner » abandonne vraiment tout.
 *
 *   2. Le catalogue de tags etait en lecture seule : impossible d'en creer un
 *      sans passer par la base. `POST /api/tags` existe, la creation se fait
 *      donc ici, la ou le besoin nait.
 */

import { useState } from 'react'

import { TextField } from '../../components/Field.js'
import { Sheet } from '../../components/Sheet.js'
import { useCreateTag, useTags, type TagItem } from '../../lib/queries.js'
import '../../styles/recipes.css'

/**
 * La couleur d'un tag est saisie par l'utilisateur et stockee en base : c'est
 * une DONNEE, pas un choix de mise en forme. Elle ne peut donc pas venir des
 * jetons de theme.css — d'ou le style en ligne, ici et nulle part ailleurs.
 */
export function TagChip({
  tag,
  selected,
  onClick,
}: {
  readonly tag: Pick<TagItem, 'id' | 'name' | 'colorHex'>
  readonly selected: boolean
  readonly onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`recipe-chip${selected ? ' recipe-chip--on' : ''}`}
      style={
        selected
          ? { background: tag.colorHex, borderColor: tag.colorHex }
          : { borderColor: tag.colorHex, color: tag.colorHex }
      }
      aria-pressed={selected}
      onClick={onClick}
    >
      {tag.name}
    </button>
  )
}

export function TagRow({
  tagIds,
  onToggle,
  onOpen,
}: {
  readonly tagIds: readonly number[]
  readonly onToggle: (id: number) => void
  readonly onOpen: () => void
}) {
  const tags = useTags()
  const attached = (tags.data?.items ?? []).filter((tag) => tagIds.includes(tag.id))

  return (
    <div className="field">
      {/* Un <span> et non un <label> : la rangee n'a pas un controle unique a
          designer, chaque pastille est un bouton a part entiere. */}
      <span className="field__label">Tags</span>
      <div className="recipe-chips">
        {attached.map((tag) => (
          <TagChip key={tag.id} tag={tag} selected onClick={() => onToggle(tag.id)} />
        ))}
        <button
          type="button"
          className="recipe-chip recipe-chip--add"
          onClick={onOpen}
          aria-label="Choisir les tags de la recette"
        >
          {attached.length === 0 ? '+ Ajouter un tag' : '+'}
        </button>
      </div>
    </div>
  )
}

export function TagSheet({
  open,
  onClose,
  tagIds,
  onToggle,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly tagIds: readonly number[]
  readonly onToggle: (id: number) => void
}) {
  const tags = useTags()
  const create = useCreateTag()
  const [name, setName] = useState('')
  const [color, setColor] = useState<string>(TAG_COLORS[0])

  const submit = () => {
    if (name.trim() === '') return
    create.mutate(
      { name: name.trim(), colorHex: color },
      {
        onSuccess: (tag) => {
          setName('')
          // Un tag cree depuis une recette est evidemment destine a cette
          // recette : on l'attache sans le redemander.
          onToggle(tag.id)
        },
      },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Tags"
      actions={
        <button type="button" className="button button--secondary" onClick={onClose}>
          Terminé
        </button>
      }
    >
      <p className="card__lead">
        Les tags s’enregistrent avec la recette : pense à valider en bas de l’écran.
      </p>

      <div className="recipe-chips recipe-chips--sheet">
        {(tags.data?.items ?? []).map((tag) => (
          <TagChip
            key={tag.id}
            tag={tag}
            selected={tagIds.includes(tag.id)}
            onClick={() => onToggle(tag.id)}
          />
        ))}
      </div>

      <div className="form tag-create">
        <TextField
          label="Nouveau tag"
          value={name}
          onChange={setName}
          placeholder="Végétarien"
          maxLength={40}
          error={create.isError ? create.error.message : null}
        />
        <div className="field">
          <span className="field__label" id="tag-color-label">
            Couleur
          </span>
          <div className="tag-palette" role="group" aria-labelledby="tag-color-label">
            {TAG_COLORS.map((hex) => (
              <button
                key={hex}
                type="button"
                className={`tag-palette__swatch${hex === color ? ' tag-palette__swatch--on' : ''}`}
                style={{ background: hex }}
                aria-label={`Couleur ${hex}`}
                aria-pressed={hex === color}
                onClick={() => setColor(hex)}
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          className="button button--primary button--block"
          onClick={submit}
          disabled={name.trim() === '' || create.isPending}
        >
          {create.isPending ? 'Création…' : 'Créer le tag'}
        </button>
      </div>
    </Sheet>
  )
}

/**
 * Palette fixe. Un selecteur de couleur libre au doigt produit des tags
 * illisibles sur fond clair comme sur fond sombre ; ces huit teintes sont
 * celles du theme, verifiees contre du texte blanc.
 */
const TAG_COLORS = [
  '#2563eb',
  '#16a34a',
  '#ea580c',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#ca8a04',
  '#64748b',
] as const
