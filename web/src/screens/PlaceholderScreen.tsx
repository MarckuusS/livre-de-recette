interface PlaceholderScreenProps {
  readonly title: string
  readonly lead: string
  readonly items: readonly string[]
}

/**
 * Ecran d'attente, le temps que le vrai arrive.
 *
 * Il annonce ce qui viendra et ce que contiennent deja les donnees, plutot
 * que d'afficher un « bientot disponible » qui n'apprend rien.
 */
export function PlaceholderScreen({ title, lead, items }: PlaceholderScreenProps) {
  return (
    <section className="screen">
      <div className="card">
        <h2 className="card__title">{title}</h2>
        <p className="card__lead">{lead}</p>
        {items.length > 0 && (
          <ul className="card__list">
            {items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
