/**
 * Journal de cuisson : « j'ai cuisiné ça », et l'historique detaille.
 *
 * Le desktop ouvrait une vraie fenetre systeme, detachable sur un second
 * ecran. Sur telephone il n'y a qu'un ecran : l'historique devient une feuille
 * modale, et le tableau a quatre colonnes une liste de cartes.
 *
 * Le bouton d'action rapide est ici en evidence plutot qu'enfoui dans un
 * bandeau : c'est le geste le plus naturel de l'application en mobilite — on
 * vient de manger, on le note.
 *
 * La date du jour vient de `todayLocalIsoDate` et jamais de `toISOString()` :
 * cette derniere convertit en UTC et proposerait la veille des 22 h en France
 * l'ete. Le desktop avait exactement ce bug.
 */

import { useState } from 'react'
import { daysUntil, todayLocalIsoDate } from '@livre/shared'

import { DateField, TextArea } from '../../components/Field.js'
import { ConfirmDialog, Sheet } from '../../components/Sheet.js'
import { ErrorState, LoadingRows } from '../../components/States.js'
import { Icon } from '../../icons/index.js'
import {
  useAddCooking,
  useCookingLog,
  useDeleteCooking,
  type CookingEntry,
} from '../../lib/queries.js'
import { formatDay, plural } from './draft.js'

/** Fenetre glissante de 30 jours, celle du compteur « ce mois » du desktop. */
function countLast30Days(entries: readonly CookingEntry[]): number {
  return entries.filter((entry) => {
    // `daysUntil` rend un nombre negatif pour une date passee.
    const elapsed = -daysUntil(entry.cookedAt)
    return elapsed >= 0 && elapsed <= 30
  }).length
}

export function CookingLogCard({ recipeId }: { readonly recipeId: number }) {
  const log = useCookingLog(recipeId)
  const add = useAddCooking(recipeId)
  const [historyOpen, setHistoryOpen] = useState(false)

  const entries = log.data?.items ?? []
  const recent = countLast30Days(entries)
  const last = entries[0]

  return (
    <div className="card">
      <h3 className="card__title">Journal de cuisson</h3>

      {log.isError && <ErrorState error={log.error} onRetry={() => void log.refetch()} />}

      {!log.isError && (
        <p className="card__lead">
          {recent > 0
            ? `Cuisinée ${recent} ${plural(recent, 'fois', 'fois')} ces 30 derniers jours.`
            : 'Pas encore cuisinée ce mois-ci.'}
          {last && ` Dernière fois le ${formatDay(last.cookedAt)}.`}
        </p>
      )}

      <div className="cook-actions">
        <button
          type="button"
          className="button button--primary"
          disabled={add.isPending}
          onClick={() =>
            add.mutate({ cookedAt: todayLocalIsoDate(), rating: null, notes: null })
          }
        >
          {add.isPending ? 'Enregistrement…' : 'J’ai cuisiné ça'}
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => setHistoryOpen(true)}
        >
          Voir l’historique{entries.length > 0 ? ` (${entries.length})` : ''}
        </button>
      </div>

      {add.isError && (
        <p className="text-error" role="alert">
          {add.error.message}
        </p>
      )}

      <CookingHistorySheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        recipeId={recipeId}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function CookingHistorySheet({
  open,
  onClose,
  recipeId,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly recipeId: number
}) {
  const log = useCookingLog(recipeId)
  const add = useAddCooking(recipeId)
  const remove = useDeleteCooking(recipeId)

  const [cookedAt, setCookedAt] = useState<string | null>(todayLocalIsoDate())
  const [rating, setRating] = useState<number | null>(null)
  const [notes, setNotes] = useState('')
  const [pendingDelete, setPendingDelete] = useState<CookingEntry | null>(null)

  const submit = () => {
    if (cookedAt === null) return
    add.mutate(
      { cookedAt, rating, notes: notes.trim() === '' ? null : notes.trim() },
      {
        // La DATE n'est pas reinitialisee : on saisit souvent plusieurs
        // cuissons d'affilee pour le meme jour, en rattrapant la semaine.
        onSuccess: () => {
          setRating(null)
          setNotes('')
        },
      },
    )
  }

  const entries = log.data?.items ?? []

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Journal de cuisson"
      actions={
        <button type="button" className="button button--secondary" onClick={onClose}>
          Fermer
        </button>
      }
    >
      <div className="form">
        <DateField
          label="Date"
          value={cookedAt}
          onChange={setCookedAt}
          max={todayLocalIsoDate()}
          required
        />

        <StarPicker value={rating} onChange={setRating} />

        <TextArea
          label="Commentaire"
          value={notes}
          onChange={setNotes}
          placeholder="Trop salé, refaire avec moitié moins de bouillon…"
          minRows={2}
        />

        <button
          type="button"
          className="button button--primary button--block"
          onClick={submit}
          disabled={cookedAt === null || add.isPending}
        >
          {add.isPending ? 'Ajout…' : 'Ajouter au journal'}
        </button>

        {add.isError && (
          <p className="text-error" role="alert">
            {add.error.message}
          </p>
        )}
      </div>

      <h3 className="card__title cook-history__title">
        {entries.length > 0
          ? `${entries.length} ${plural(entries.length, 'cuisson')} enregistrée${entries.length > 1 ? 's' : ''}`
          : 'Aucune cuisson enregistrée'}
      </h3>

      {log.isPending && <LoadingRows rows={3} />}
      {log.isError && <ErrorState error={log.error} onRetry={() => void log.refetch()} />}

      {log.isSuccess && entries.length === 0 && (
        <p className="card__lead">Ajoute la première ci-dessus.</p>
      )}

      <ul className="cook-history">
        {entries.map((entry) => (
          <li key={entry.id} className="cook-entry">
            <div className="cook-entry__body">
              <span className="cook-entry__date">{formatDay(entry.cookedAt)}</span>
              <span
                className="cook-entry__stars"
                aria-label={entry.rating === null ? 'Sans note' : `${entry.rating} sur 5`}
              >
                {entry.rating === null
                  ? '-'
                  : [1, 2, 3, 4, 5].map((star) => (
                      <Icon
                        key={star}
                        name={star <= entry.rating! ? 'ui-star-filled' : 'ui-star'}
                        size={14}
                      />
                    ))}
              </span>
              {entry.notes && <span className="cook-entry__notes">{entry.notes}</span>}
            </div>
            <button
              type="button"
              className="icon-action icon-action--danger"
              onClick={() => setPendingDelete(entry)}
              aria-label={`Supprimer la cuisson du ${formatDay(entry.cookedAt)}`}
            >
              <Icon name="ui-close" size={16} />
            </button>
          </li>
        ))}
      </ul>

      {/* Une confirmation plutot que l'annulation par message ephemere : la
          cible de 44 px cotoie ici une liste qu'on fait defiler au pouce, et
          une entree effacee par megarde n'est plus recuperable. */}
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Supprimer cette cuisson ?"
        message={
          pendingDelete
            ? `L’entrée du ${formatDay(pendingDelete.cookedAt)} sera définitivement supprimée.`
            : ''
        }
        confirmLabel="Supprimer"
        danger
        busy={remove.isPending}
        error={remove.error?.message}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return
          remove.mutate(pendingDelete.id, { onSuccess: () => setPendingDelete(null) })
        }}
      />
    </Sheet>
  )
}

/**
 * Note de 1 a 5. Le desktop utilisait un spinbox 0-5 ou 0 valait « pas de
 * note » — indevinable. Cinq etoiles tappables, plus un bouton explicite pour
 * retirer la note.
 */
function StarPicker({
  value,
  onChange,
}: {
  readonly value: number | null
  readonly onChange: (value: number | null) => void
}) {
  return (
    <div className="field">
      <span className="field__label" id="cooking-rating-label">
        Note
      </span>
      <div className="stars" role="group" aria-labelledby="cooking-rating-label">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={`stars__button${value !== null && star <= value ? ' stars__button--on' : ''}`}
            aria-pressed={value !== null && star <= value}
            aria-label={`${star} ${plural(star, 'étoile')}`}
            onClick={() => onChange(star)}
          >
            <Icon name={value !== null && star <= value ? 'ui-star-filled' : 'ui-star'} size={22} />
          </button>
        ))}
        <button
          type="button"
          className="button button--ghost stars__clear"
          onClick={() => onChange(null)}
          disabled={value === null}
        >
          Sans note
        </button>
      </div>
    </div>
  )
}
