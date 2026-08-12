/**
 * La bande d'hydratation.
 *
 * Le plus petit ajout de l'ecran, et celui qui demande le plus de retenue :
 * un suivi d'eau qui reclame une saisie precise n'est jamais tenu. On compte
 * donc en VERRES de 25 cl, pas en millilitres — deux boutons, aucun clavier.
 *
 * La cible vient du poids (`hydrationTarget`), recalculee comme les cibles en
 * kcal. Quand le poids manque, on affiche le repere general de 2 L et on le
 * dit : annoncer « ton objectif » sur un chiffre qu'on n'a pas calcule serait
 * mentir sur la nature du nombre.
 *
 * Le retrait existe parce qu'on se trompe de bouton, pas parce qu'on rend
 * l'eau. Il s'arrete a zero, cote serveur — deux retraits simultanes ne
 * peuvent donc pas creuser la journee sous zero.
 */

import { useDrink, useHydration, todayIso } from '../../lib/queries.js'
import { useDailyTargets } from '../../lib/useDailyTargets.js'
import { Icon } from '../../icons/index.js'
import '../../styles/accueil.css'

/** Un verre. La contenance courante d'un verre a eau, et une unite qui se compte. */
const VERRE_ML = 250

/** Au-dela, la rangee de gouttes devient un damier illisible. */
const GOUTTES_MAX = 10

const litres = (ml: number) =>
  (ml / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function Hydratation() {
  const jour = todayIso()
  const query = useHydration(jour)
  const boire = useDrink(jour)
  const { hydration } = useDailyTargets()

  // Pendant l'aller-retour, on affiche ce qu'on vient de demander plutot que
  // l'ancien total : sans cela, taper deux verres d'affilee donne l'impression
  // que le premier n'a pas compte.
  const bu = boire.isPending
    ? Math.max(0, (query.data?.ml ?? 0) + (boire.variables ?? 0))
    : (query.data?.ml ?? 0)

  const objectif = hydration.ml
  const gouttes = Math.min(GOUTTES_MAX, Math.round(objectif / VERRE_ML))
  const pleines = Math.min(gouttes, Math.round(bu / VERRE_ML))

  return (
    <div className="hydratation">
      <div className="hydratation__texte">
        <span className="hydratation__titre">Hydratation</span>
        <span className="hydratation__valeur">
          {litres(bu)} / {litres(objectif)} L
          {!hydration.estimated && <span className="hydratation__repere"> · repère général</span>}
        </span>
      </div>

      <div className="hydratation__gouttes" aria-hidden="true">
        {Array.from({ length: gouttes }, (_, i) => (
          <span key={i} className={`goutte${i < pleines ? ' goutte--pleine' : ''}`} />
        ))}
      </div>

      <div className="hydratation__boutons">
        <button
          type="button"
          className="hydratation__bouton"
          onClick={() => boire.mutate(-VERRE_ML)}
          disabled={bu <= 0 || boire.isPending}
          aria-label="Retirer un verre d’eau"
        >
          <Icon name="ui-minus" size={18} />
        </button>
        <button
          type="button"
          className="hydratation__bouton hydratation__bouton--plein"
          onClick={() => boire.mutate(VERRE_ML)}
          disabled={boire.isPending}
          aria-label="Ajouter un verre d’eau de 25 centilitres"
        >
          <Icon name="ui-plus" size={18} />
        </button>
      </div>
    </div>
  )
}
