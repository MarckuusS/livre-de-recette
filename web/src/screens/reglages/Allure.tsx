/**
 * La jauge de rythme.
 *
 * Le mockup dessine un curseur continu sur trois zones. Le modele, lui, ne
 * connait que TROIS allures (`PACES` : 0,25, 0,5 et 0,75 kg par semaine), et
 * la colonne `user_profile.pace` porte un CHECK sur ces trois codes. On ne
 * fait donc pas semblant d'offrir un continuum : trois arrets poses sur la
 * barre, et l'echelle entiere dessinee autour d'eux.
 *
 * DEUX COUCHES QUI NE SE CONFONDENT PAS : une PISTE, pur decor (`aria-hidden`),
 * qui porte l'axe physique et ses zones ; et un CONTROLE pose dessus, un vrai
 * groupe de boutons radio. Le rond du mockup est l'arret selectionne, pas une
 * poignee : rien ne se traine, parce que rien n'est continu.
 *
 * POURQUOI PAS UN `input type=range`, malgre l'apparence du mockup :
 *
 *   1. un curseur ne sait pas etre VIDE. `pace` vaut `null` sur tous les
 *      profils existants, et `null` veut dire quelque chose de precis :
 *      « aucun choix, c'est l'objectif qui decide ». Un curseur sans valeur se
 *      pose au milieu et annonce une allure que personne n'a choisie ;
 *   2. les bornes de l'axe ne sont pas des valeurs offertes. L'axe va de 0 a
 *      1,2 ; les choix sont 0,25 / 0,5 / 0,75 ;
 *   3. le navigateur ne pose pas sa poignee ou la CSS la dessine : il reserve
 *      une demi-poignee a chaque bout, ce qui decale de plusieurs pixels par
 *      rapport a des zones dont les frontieres, elles, sont exactes.
 *
 * ET UNE REGLE D'ACCESSIBILITE QUI SE PAIE : un radio coche ne se decoche pas
 * au clavier. D'ou le bouton « Revenir a l'allure de l'objectif », sans lequel
 * on ne pourrait plus revenir a `null` une fois une allure choisie.
 */

import { PACES, SAFE_PACE, type PaceCode } from '@livre/shared'

/** Haut de l'echelle dessinee. Au-dela de `SAFE_PACE.max`, pour que le
    plafond se VOIE au lieu d'etre seulement affirme. */
const ECHELLE_MAX = 1.2

const pct = (kg: number) => (kg / ECHELLE_MAX) * 100

const kgFr = (v: number) =>
  v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** L'allure la plus rapide qu'on puisse choisir. Lue, jamais recopiee. */
const PLUS_RAPIDE = Math.max(...PACES.map((p) => p.kgPerWeek))

/**
 * La zone d'une allure, CALCULEE et non ecrite en dur.
 *
 * Les trois allures proposees tombent aujourd'hui dans la zone sure, et
 * l'etiquette pourrait donc etre un litteral. Elle ne l'est pas : le jour ou
 * `PACES` gagne une entree plus rapide, un litteral mentirait en silence.
 */
const zoneDe = (kgPerWeek: number): string => {
  if (kgPerWeek < SAFE_PACE.min) return 'Trop lent pour se voir'
  if (kgPerWeek > SAFE_PACE.max) return 'Au-delà du recommandé'
  return 'Zone recommandée'
}

export function Allure({
  value,
  onChange,
  onClear,
  perte,
}: {
  readonly value: PaceCode | null
  readonly onChange: (code: PaceCode) => void
  readonly onClear: () => void
  /** Vrai si l'ecart va vers le BAS. Decide du sens dit et du signe affiche. */
  readonly perte: boolean
}) {
  const choisi = PACES.find((p) => p.code === value) ?? null
  const sens = perte ? 'de moins' : 'de plus'

  return (
    <fieldset className="allure">
      <legend className="radios__legend">Allure visée</legend>

      <p className="allure__lecture">
        {choisi === null ? (
          <span className="allure__vide">Celle de l’objectif</span>
        ) : (
          <>
            <span className="chiffre allure__valeur">
              {perte ? '−' : '+'}
              {kgFr(choisi.kgPerWeek)}
            </span>{' '}
            <span className="allure__unite">kg par semaine</span>
            <span className="allure__zone">{zoneDe(choisi.kgPerWeek)}</span>
          </>
        )}
      </p>

      <div className="allure__jauge">
        <span className="allure__piste" aria-hidden="true">
          <span
            className="allure__bande allure__bande--lente"
            style={{ width: `${pct(SAFE_PACE.min)}%` }}
          />
          <span
            className="allure__bande allure__bande--sure"
            style={{ width: `${pct(SAFE_PACE.max - SAFE_PACE.min)}%` }}
          />
          <span className="allure__bande allure__bande--exclue" />
        </span>

        {PACES.map((p) => (
          <label
            key={p.code}
            className={`arret${value === p.code ? ' arret--on' : ''}`}
            style={{ left: `${pct(p.kgPerWeek)}%` }}
          >
            <input
              type="radio"
              name="allure"
              value={p.code}
              checked={value === p.code}
              onChange={() => onChange(p.code)}
            />
            <span className="arret__pastille" aria-hidden="true" />
            {/* Le nombre est VISIBLE et fait partie du nom accessible : un
                `aria-label` l'ecraserait, et le pilotage vocal ne pourrait
                plus dire « clique sur 0,25 ». Le reste de la phrase est lu
                mais pas vu. */}
            <span className="arret__valeur">{kgFr(p.kgPerWeek)}</span>
            <span className="arret__dit">
              {` kg ${sens} par semaine. ${p.label}, ${p.hint.toLowerCase()}.`}
            </span>
          </label>
        ))}
      </div>

      <p className="allure__legende">
        Sous {kgFr(SAFE_PACE.min)} kg par semaine, la balance ne montrerait rien de net. La plus
        rapide proposée est {PLUS_RAPIDE.toLocaleString('fr-FR')} : la bande de droite, au-delà de{' '}
        {SAFE_PACE.max.toLocaleString('fr-FR')}, n’est pas atteignable, et ce n’est pas un oubli.
        La date d’arrivée découle du rythme, jamais l’inverse.
      </p>

      {value !== null && (
        <button type="button" className="button button--ghost allure__annuler" onClick={onClear}>
          Revenir à l’allure de l’objectif
        </button>
      )}
    </fieldset>
  )
}
