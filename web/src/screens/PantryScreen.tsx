import { daysUntil, formatGrams, urgencyBucket, type UrgencyBucket } from '@livre/shared'

import { EmptyState, ErrorState, LoadingRows } from '../components/States.js'
import { usePantry, type PantryResponse } from '../lib/queries.js'

/**
 * Frigo et cellier.
 *
 * Trois sections d'urgence, identiques au desktop : 5 jours, 14 jours, le
 * reste. C'est ce classement qui donne son utilite a l'ecran — une liste
 * alphabetique ne dirait pas ce qu'il faut manger ce soir.
 */
const SECTIONS: Array<{ bucket: UrgencyBucket; title: string; hint: string }> = [
  { bucket: 'soon', title: 'À consommer vite', hint: '5 jours ou moins' },
  { bucket: 'watch', title: 'À surveiller', hint: '14 jours ou moins' },
  { bucket: 'stock', title: 'En stock', hint: 'sans urgence' },
]

export function PantryScreen() {
  const query = usePantry()

  return (
    <section className="screen">
      {query.isPending && <LoadingRows />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}

      {query.isSuccess && query.data.items.length === 0 && (
        <EmptyState title="Frigo vide">
          Rien en stock. Ce que tu ajouteras ici sera automatiquement pré-coché dans la liste de
          courses.
        </EmptyState>
      )}

      {query.isSuccess && query.data.items.length > 0 && <PantrySections data={query.data} />}
    </section>
  )
}

function PantrySections({ data }: { data: PantryResponse }) {
  const now = new Date()

  const withUrgency = data.items.map((stock) => {
    const daysLeft = stock.expiryDate ? daysUntil(stock.expiryDate, now) : null
    return { stock, daysLeft, bucket: urgencyBucket(daysLeft) }
  })

  const expired = withUrgency.filter((i) => i.daysLeft !== null && i.daysLeft < 0).length

  return (
    <>
      <p className="list-count">
        {data.items.length} article{data.items.length > 1 ? 's' : ''}
        {expired > 0 && <span className="text-error"> · {expired} périmé{expired > 1 ? 's' : ''}</span>}
      </p>

      {SECTIONS.map((section) => {
        const items = withUrgency.filter((i) => i.bucket === section.bucket)
        if (items.length === 0) return null

        return (
          <div key={section.bucket} className="card card--flush">
            <h3 className={`section-header section-header--${section.bucket}`}>
              {section.title} <span className="section-header__hint">{section.hint}</span>
            </h3>
            <ul className="row-list row-list--flush">
              {items.map(({ stock, daysLeft }) => {
                const ingredient = data.ingredients[String(stock.ingredientId)]
                return (
                  <li key={stock.id} className="row row--static">
                    <span className={`urgency-dot urgency-dot--${urgencyBucket(daysLeft)}`} aria-hidden="true" />
                    <span className="row__body">
                      <span className="row__title">{ingredient?.name ?? 'Ingrédient supprimé'}</span>
                      <span className="row__meta">
                        {formatGrams(stock.quantityG)}
                        {stock.notes && <span>{stock.notes}</span>}
                      </span>
                    </span>
                    <span className="row__value">{formatExpiry(daysLeft)}</span>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </>
  )
}

/** « périmé », « aujourd'hui », « dans 3 j ». Plus lisible qu'une date brute en rayon. */
function formatExpiry(daysLeft: number | null): string {
  if (daysLeft === null) return '—'
  if (daysLeft < 0) return `périmé (${-daysLeft} j)`
  if (daysLeft === 0) return "aujourd'hui"
  if (daysLeft === 1) return 'demain'
  return `dans ${daysLeft} j`
}
