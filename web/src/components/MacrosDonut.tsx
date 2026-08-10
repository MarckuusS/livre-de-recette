/**
 * Anneau de repartition energetique des macros.
 *
 * Vit ici, et non dans les ecrans Recettes ou il est ne, parce qu'il sert
 * desormais a deux endroits : la composition d'une recette pour 100 g, et la
 * repartition d'une journee du calendrier. Le calcul est le meme, seuls le
 * titre et ce qu'on inscrit au centre changent.
 *
 * Le denominateur est la somme Atwater RECALCULEE, jamais l'energie declaree :
 * c'est la seule facon que les quatre parts fassent exactement 100 %. Le
 * desktop faisait deja ce choix (`MacrosChart.qml`). Consequence a connaitre :
 * le pourcentage et l'energie affichee au centre ne viennent pas de la meme
 * source, et divergent legerement sur les donnees CIQUAL.
 *
 * Pas de survol : il n'existe pas au doigt. Les valeurs que le desktop
 * revelait au passage de la souris sont ecrites en permanence dans la legende,
 * qui porte a elle seule toute l'information — le trace n'est qu'une aide a la
 * lecture, d'ou son `aria-hidden`.
 */

import { energyBreakdown, type NutritionTotal } from '@livre/shared'

import { formatNumber } from '../lib/format.js'

import '../styles/components.css'

const DONUT_RADIUS = 42
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS

const SEGMENTS = [
  { key: 'fats', label: 'Lipides' },
  { key: 'carbs', label: 'Glucides' },
  { key: 'fiber', label: 'Fibres' },
  { key: 'proteins', label: 'Protéines' },
] as const

export interface MacrosDonutProps {
  readonly total: NutritionTotal
  readonly title: string
  /** Ligne sous le nombre central : « kcal / 100 g », « kcal ce jour »… */
  readonly centerCaption: string
  /** Phrase affichee quand rien n'est chiffrable. */
  readonly emptyMessage: string
}

export function MacrosDonut({ total, title, centerCaption, emptyMessage }: MacrosDonutProps) {
  const breakdown = energyBreakdown(total)

  const segments = SEGMENTS.map((segment) => ({
    ...segment,
    grams: total[segment.key],
    kcal: breakdown[`${segment.key}Kcal` as const],
  }))

  const totalKcal = breakdown.atwaterKcal
  if (totalKcal <= 0) {
    return (
      <div className="card">
        <h3 className="card__title">{title}</h3>
        <p className="card__lead">{emptyMessage}</p>
      </div>
    )
  }

  let offset = 0
  const arcs = segments.map((segment) => {
    const share = segment.kcal / totalKcal
    const arc = { ...segment, share, start: offset }
    offset += share
    return arc
  })

  return (
    <div className="card">
      <h3 className="card__title">{title}</h3>
      <div className="macros">
        <svg className="macros__chart" viewBox="0 0 120 120" aria-hidden="true">
          <circle
            className="macros__track"
            cx="60"
            cy="60"
            r={DONUT_RADIUS}
            fill="none"
            strokeWidth="16"
          />
          {arcs.map((arc) => (
            <circle
              key={arc.key}
              cx="60"
              cy="60"
              r={DONUT_RADIUS}
              fill="none"
              strokeWidth="16"
              stroke={`var(--color-nutrient-${arc.key})`}
              strokeDasharray={`${arc.share * DONUT_CIRCUMFERENCE} ${DONUT_CIRCUMFERENCE}`}
              strokeDashoffset={-arc.start * DONUT_CIRCUMFERENCE}
              // Depart a 12 h plutot qu'a 3 h, comme sur le desktop.
              transform="rotate(-90 60 60)"
            />
          ))}
          <text className="macros__center" x="60" y="57" textAnchor="middle">
            {Math.round(total.kcal)}
          </text>
          <text className="macros__center-sub" x="60" y="72" textAnchor="middle">
            {centerCaption}
          </text>
        </svg>

        <ul className="macros__legend">
          {arcs.map((arc) => (
            <li key={arc.key} className="macros__item">
              <span
                className="nutrient-dot"
                style={{ background: `var(--color-nutrient-${arc.key})` }}
                aria-hidden="true"
              />
              <span className="macros__label">{arc.label}</span>
              <span className="macros__value">
                {formatNumber(arc.grams, 1)} g · {Math.round(arc.kcal)} kcal ·{' '}
                <strong>{formatNumber(arc.share * 100, 0)} %</strong>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
