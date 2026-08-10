/**
 * Galerie du jeu d'icones.
 *
 * Un dessin qui tient sur un ecran de bureau peut se refermer sur lui-meme a
 * 20 px sur un telephone tenu a bout de bras : cet ecran existe pour verifier
 * sur l'appareil reel, la ou le defaut se voit.
 *
 * Il montre aussi les rayons REELLEMENT presents dans la bibliotheque, avec
 * leur effectif. C'est ce qui dit si un rayon merite son propre dessin, et
 * surtout combien d'ingredients n'ont pas de rayon du tout — ceux-la tombent
 * sur la cagette, et c'est le seul cas ou l'icone n'apprend rien.
 */

import { useMemo, useState } from 'react'

import { Icon, ICON_FAMILIES, iconForRayon, rayonSlug, type IconName } from '../icons/index.js'
import { useIngredients } from '../lib/queries.js'

const UNCATEGORIZED = 'Sans rayon'

export function IconGalleryScreen() {
  const [size, setSize] = useState(24)

  const ingredients = useIngredients('')

  /** Rayons de la bibliotheque, du plus fourni au moins fourni. */
  const rayons = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of ingredients.data?.items ?? []) {
      const label = item.categoryL1 ?? UNCATEGORIZED
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [ingredients.data])

  const total = ingredients.data?.items.length ?? 0
  const orphans = rayons.find(([label]) => label === UNCATEGORIZED)?.[1] ?? 0

  return (
    <section className="screen">
      <div className="card">
        <h2 className="card__title">Jeu d’icônes</h2>
        <p className="card__lead">
          {ICON_FAMILIES.reduce((sum, family) => sum + family.names.length, 0)} dessins, grille 24,
          trait 1,6. Ils remplacent les émojis, qui changeaient d’un appareil à l’autre. Un
          ingrédient porte l’icône de son <strong>rayon</strong> : il n’y a pas de dessin par
          aliment.
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

      {rayons.length > 0 && (
        <div className="card">
          <h2 className="card__title">Tes rayons</h2>
          <p className="card__lead">
            {orphans === 0
              ? `Les ${total} ingrédients de la bibliothèque ont un rayon.`
              : `${orphans} ingrédient${orphans > 1 ? 's' : ''} sur ${total} n’${orphans > 1 ? 'ont' : 'a'} pas de rayon : ${orphans > 1 ? 'ils prennent' : 'il prend'} la cagette. Leur en attribuer un leur donne une icône et une couleur.`}
          </p>
          <ul className="row-list row-list--flush">
            {rayons.map(([label, count]) => (
              <li className="row row--static" key={label}>
                <span className="icon-chip" data-rayon={rayonSlug(label)}>
                  <Icon name={iconForRayon(label)} size={22} strokeWidth={1.7} />
                </span>
                <span className="row__body">
                  <span className="row__title">{label}</span>
                </span>
                <span className="row__value">{count}</span>
              </li>
            ))}
          </ul>
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
