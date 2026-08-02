/**
 * Ecran Recettes : la liste, puis l'editeur.
 *
 * Le desktop tenait les deux dans un SplitView 30/70 redimensionnable. En
 * 375 px il n'y a qu'une colonne : la liste est un ecran, chaque recette en est
 * un autre (/recettes/:id), et le bouton Retour du telephone fait la
 * navigation. La poignee de separation n'a pas d'equivalent tactile et
 * disparait sans regret.
 *
 * La liste est ici RICHE : le desktop n'affichait que le nom et deux
 * compteurs, alors que ce qui aide a choisir un dimanche soir, c'est de voir
 * les tags, le temps de preparation et la derniere fois qu'on l'a cuisinee.
 * Ces informations sont deja calculees par l'API (`cookCount30d`,
 * `lastCookedAt`), il aurait ete dommage de les laisser dans le tuyau.
 *
 * Ce qui n'est PAS porte, faute de socle : les photos de recette. `imageKey`
 * est lu et transmis tel quel a chaque enregistrement pour ne pas l'effacer,
 * mais le bucket R2 n'est pas configure et aucune URL n'est servie — donc pas
 * de vignette, pas d'envoi, pas de depot d'image.
 */

import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { Recipe } from '@livre/shared'

import { NumberField, TextField } from '../components/Field.js'
import { Sheet } from '../components/Sheet.js'
import { EmptyState, ErrorState, LoadingRows } from '../components/States.js'
import { useRecipe, useRecipes, useSaveRecipe, useTags, type RecipeSummary } from '../lib/queries.js'
import { RecipeEditor } from './recettes/RecipeEditor.js'
import { formatDay, plural } from './recettes/draft.js'
import '../styles/recipes.css'

export function RecipesScreen() {
  // Le filtre vit dans l'URL : revenir d'une recette a la liste retrouve la
  // selection, et le lien se partage. C'est la meme regle que `?semaine=` sur
  // la liste de courses.
  const [searchParams, setSearchParams] = useSearchParams()
  const tagParam = searchParams.get('tag')
  const tagId = tagParam !== null && /^\d+$/.test(tagParam) ? Number(tagParam) : null

  const [text, setText] = useState(() => searchParams.get('q') ?? '')
  const [debounced, setDebounced] = useState(() => searchParams.get('q') ?? '')
  const [newOpen, setNewOpen] = useState(false)

  // 200 ms, comme le picker du desktop : sans ce delai, chaque lettre part en
  // requete reseau.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), 200)
    return () => clearTimeout(timer)
  }, [text])

  useEffect(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (debounced) next.set('q', debounced)
        else next.delete('q')
        return next
      },
      // `replace` : sans cela, chaque lettre tapee ajouterait une entree
      // d'historique et le bouton Retour deviendrait inutilisable.
      { replace: true },
    )
  }, [debounced, setSearchParams])

  const setTag = (next: number | null) =>
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous)
        if (next === null) params.delete('tag')
        else params.set('tag', String(next))
        return params
      },
      { replace: true },
    )

  const list = useRecipes(debounced, tagId)
  const filtered = debounced !== '' || tagId !== null

  return (
    <section className="screen screen--recipes">
      <input
        type="search"
        className="search-field"
        placeholder="Rechercher une recette…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        enterKeyHint="search"
        autoCorrect="off"
        autoCapitalize="off"
        aria-label="Rechercher une recette"
      />

      <TagFilter selected={tagId} onSelect={setTag} />

      {list.isPending && <LoadingRows />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}

      {list.isSuccess && list.data.items.length === 0 && (
        <EmptyState title={filtered ? 'Aucun résultat' : 'Aucune recette'}>
          {filtered ? (
            <>
              Rien ne correspond à ce filtre.{' '}
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setText('')
                  setTag(null)
                }}
              >
                Tout afficher
              </button>
            </>
          ) : (
            'Ta bibliothèque de recettes est vide. Crée la première avec le bouton ci-dessous.'
          )}
        </EmptyState>
      )}

      {list.isSuccess && list.data.items.length > 0 && (
        <>
          <p className="list-count">
            {list.data.items.length} {plural(list.data.items.length, 'recette')}
          </p>
          <ul className="row-list">
            {list.data.items.map((recipe) => (
              <RecipeRow key={recipe.id} recipe={recipe} />
            ))}
          </ul>
        </>
      )}

      {/* Bouton fixe plutot que flottant : il ne recouvre jamais la derniere
          ligne de la liste, ce qu'un bouton rond en surimpression fait
          systematiquement sur les listes longues. */}
      <div className="recipes-footer">
        <button
          type="button"
          className="button button--primary button--block"
          onClick={() => setNewOpen(true)}
        >
          Nouvelle recette
        </button>
      </div>

      <NewRecipeSheet open={newOpen} onClose={() => setNewOpen(false)} />
    </section>
  )
}

// ---------------------------------------------------------------------------

function TagFilter({
  selected,
  onSelect,
}: {
  readonly selected: number | null
  readonly onSelect: (id: number | null) => void
}) {
  const tags = useTags()
  const items = tags.data?.items ?? []
  if (items.length === 0) return null

  return (
    <div className="tag-filter" role="group" aria-label="Filtrer par tag">
      <div className="tag-filter__scroller">
        <button
          type="button"
          className={`recipe-chip${selected === null ? ' recipe-chip--on' : ''}`}
          aria-pressed={selected === null}
          onClick={() => onSelect(null)}
        >
          Tous
        </button>
        {items.map((tag) => {
          const on = tag.id === selected
          return (
            <button
              key={tag.id}
              type="button"
              className={`recipe-chip${on ? ' recipe-chip--on' : ''}`}
              // Couleur choisie par l'utilisateur et stockee en base : elle ne
              // peut pas venir des jetons du theme.
              style={
                on
                  ? { background: tag.colorHex, borderColor: tag.colorHex }
                  : { borderColor: tag.colorHex, color: tag.colorHex }
              }
              aria-pressed={on}
              // Un seul tag a la fois : `GET /api/recipes?tag=` n'en accepte
              // qu'un. Le desktop cumulait les filtres en OU logique.
              onClick={() => onSelect(on ? null : tag.id)}
            >
              {tag.name}
              <span className="recipe-chip__count">{tag.recipeCount}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function RecipeRow({ recipe }: { readonly recipe: RecipeSummary }) {
  return (
    <li className="row">
      <Link to={`/recettes/${recipe.id}`} className="row__link">
        <span className="row__body">
          <span className="row__title">{recipe.name}</span>
          <span className="row__meta">
            <span>
              {recipe.defaultPortions} {plural(recipe.defaultPortions, 'portion')}
            </span>
            <span>
              {recipe.lineCount} {plural(recipe.lineCount, 'ingrédient')}
            </span>
            {recipe.prepTimeMin !== null && <span>{recipe.prepTimeMin} min</span>}
            {recipe.cookCount30d > 0 && (
              <span className="badge badge--cooked">
                {recipe.cookCount30d}× ces 30 j
              </span>
            )}
          </span>
          {(recipe.tags.length > 0 || recipe.lastCookedAt !== null) && (
            <span className="row__meta">
              {recipe.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="recipe-chip recipe-chip--static"
                  style={{ borderColor: tag.colorHex, color: tag.colorHex }}
                >
                  {tag.name}
                </span>
              ))}
              {recipe.lastCookedAt !== null && (
                <span>dernière fois le {formatDay(recipe.lastCookedAt)}</span>
              )}
            </span>
          )}
        </span>
        <span className="row__chevron" aria-hidden="true">
          ›
        </span>
      </Link>
    </li>
  )
}

/**
 * Creation en deux temps : un nom et des portions ici, tout le reste dans
 * l'editeur.
 *
 * Le desktop ouvrait un formulaire vide et ne creait la ligne qu'a
 * l'enregistrement. Impossible a reproduire tel quel : le journal de cuisson et
 * les futures photos ont besoin d'un identifiant stable. On cree donc tout de
 * suite, avec le strict minimum que le schema exige, puis on bascule sur
 * l'editeur de la recette reelle.
 */
function NewRecipeSheet({
  open,
  onClose,
}: {
  readonly open: boolean
  readonly onClose: () => void
}) {
  const navigate = useNavigate()
  const save = useSaveRecipe()
  const [name, setName] = useState('')
  const [portions, setPortions] = useState<number | null>(2)
  const [touched, setTouched] = useState(false)

  const problem = name.trim() === '' ? 'Le nom de la recette ne peut pas être vide.' : null

  const submit = () => {
    setTouched(true)
    if (problem !== null) return
    save.mutate(
      {
        id: null,
        name: name.trim(),
        instructions: '',
        defaultPortions: Math.max(1, Math.round(portions ?? 1)),
        imageKey: null,
        sourceUrl: null,
        prepTimeMin: null,
        lines: [],
        tagIds: [],
      },
      {
        onSuccess: (recipe) => {
          setName('')
          setTouched(false)
          onClose()
          void navigate(`/recettes/${recipe.id}`)
        },
      },
    )
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Nouvelle recette"
      dismissible={!save.isPending}
      actions={
        <>
          <button
            type="button"
            className="button button--secondary"
            onClick={onClose}
            disabled={save.isPending}
          >
            Annuler
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={submit}
            disabled={save.isPending}
          >
            {save.isPending ? 'Création…' : 'Créer'}
          </button>
        </>
      }
    >
      <div className="form">
        <TextField
          label="Nom"
          value={name}
          onChange={setName}
          placeholder="Gratin de courgettes"
          required
          autoFocus
          error={touched ? problem : null}
        />
        <NumberField
          label="Portions"
          value={portions}
          onChange={setPortions}
          min={1}
          max={50}
          decimals={0}
        />
        {save.isError && (
          <p className="text-error" role="alert">
            {save.error.message}
          </p>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------

export function RecipeDetailScreen() {
  const params = useParams()
  const navigate = useNavigate()
  const raw = params['id']
  const id = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null

  const query = useRecipe(id)

  if (id === null) {
    return (
      <section className="screen">
        <EmptyState title="Recette introuvable">Cette adresse ne correspond à rien.</EmptyState>
      </section>
    )
  }

  if (query.isPending) {
    return (
      <section className="screen">
        <LoadingRows rows={6} />
      </section>
    )
  }

  if (query.isError) {
    return (
      <section className="screen">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </section>
    )
  }

  return <RecipeEditorHost recipe={query.data} onDeleted={() => void navigate('/recettes')} />
}

/**
 * `key` sur l'identifiant : passer d'une recette a l'autre doit repartir d'un
 * tampon neuf. Sans cela, l'editeur garderait l'etat de saisie de la
 * precedente — et le drapeau « modifie » avec.
 */
function RecipeEditorHost({
  recipe,
  onDeleted,
}: {
  readonly recipe: Recipe
  readonly onDeleted: () => void
}) {
  return <RecipeEditor key={recipe.id ?? 'nouvelle'} recipe={recipe} onDelete={onDeleted} />
}
