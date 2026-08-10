/**
 * Galerie du jeu d'icones.
 *
 * Un dessin qui tient sur un ecran de bureau peut se refermer sur lui-meme a
 * 20 px sur un telephone tenu a bout de bras : cet ecran existe pour verifier
 * sur l'appareil reel, la ou le defaut se voit.
 *
 * Il affiche aussi la COUVERTURE du resolveur sur la bibliotheque personnelle,
 * c'est-a-dire la part d'ingredients qui retombent sur l'icone de leur rayon
 * faute de mot-cle reconnu. C'est la seule mesure qui dise s'il faut enrichir
 * le tableau de `resolve.ts`, et elle depend des ingredients reellement
 * presents — donc de personne d'autre que l'utilisateur.
 */

import { useMemo, useState } from 'react'

import { Icon, ICON_FAMILIES, iconForIngredient, type IconName } from '../icons/index.js'
import { useIngredients } from '../lib/queries.js'

export function IconGalleryScreen() {
  const [size, setSize] = useState(24)

  const ingredients = useIngredients('')

  const coverage = useMemo(() => {
    const items = ingredients.data?.items ?? []
    if (items.length === 0) return null
    const missing = items
      .map((item) => ({ name: item.name, icon: iconForIngredient(item) }))
      .filter((entry) => entry.icon.startsWith('rayon-'))
    return { total: items.length, missing }
  }, [ingredients.data])

  return (
    <section className="screen">
      <div className="card">
        <h2 className="card__title">Jeu d’icônes</h2>
        <p className="card__lead">
          {ICON_FAMILIES.reduce((sum, family) => sum + family.names.length, 0)} dessins, grille 24,
          trait 1,6. Ils remplacent les émojis, qui changeaient d’un appareil à l’autre.
        </p>
        <label className="field">
          <span className="field__label">Taille d’affichage — {size} px</span>
          <input
            type="range"
            min={16}
            max={40}
            step={2}
            value={size}
            onChange={(event) => setSize(Number(event.target.value))}
          />
        </label>
      </div>

      {coverage !== null && (
        <div className="card">
          <h2 className="card__title">Couverture</h2>
          <p className="card__lead">
            <span className="icon-gallery__count">
              {coverage.total - coverage.missing.length}/{coverage.total}
            </span>{' '}
            ingrédients de la bibliothèque ont une icône propre. Les autres prennent celle de leur
            rayon, ce qui reste juste mais moins parlant.
          </p>
          {coverage.missing.length > 0 && (
            <ul className="row-list row-list--flush">
              {coverage.missing.map((entry) => (
                <li className="row row--static" key={entry.name}>
                  <Icon name={entry.icon} size={22} />
                  <span className="row__body">
                    <span className="row__title">{entry.name}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {ICON_FAMILIES.map((family) => (
        <div className="card" key={family.title}>
          <h2 className="card__title">
            {family.title} <span className="icon-gallery__count">· {family.names.length}</span>
          </h2>
          <div className="icon-gallery__grid">
            {family.names.map((name: IconName) => (
              <div className="icon-gallery__cell" key={name}>
                <Icon name={name} size={size} label={name} />
                <span className="icon-gallery__name">{name}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}
