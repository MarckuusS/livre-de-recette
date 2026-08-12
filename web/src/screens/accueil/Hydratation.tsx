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
  // La part remplie se calcule sur la CIBLE, pas en verres : au-dela de 2,5 L
  // la rangee est plafonnee a dix gouttes, et compter en verres les remplissait
  // toutes alors qu'il restait un demi-litre a boire.
  const pleines = objectif <= 0 ? 0 : Math.min(gouttes, Math.round((bu / objectif) * gouttes))

  // Une journee dont on ne connait pas le total ne vaut pas une journee a zero.
  // Sans cette distinction, la bande annonce « 0,00 L » et toutes les gouttes
  // vides a qui a bu un litre et demi mais dont la requete n'a pas abouti.
  const inconnu = query.isPending || query.isError

  return (
    <div className="hydratation">
      <div className="hydratation__texte">
        <span className="hydratation__titre">Hydratation</span>
        <span className="hydratation__valeur">
          {inconnu ? '—' : litres(bu)} / {litres(objectif)} L
          {!hydration.estimated && <span className="hydratation__repere"> · repère général</span>}
        </span>
        {boire.isError && (
          <span className="hydratation__echec" role="alert">
            Ce verre n’a pas été enregistré. Réessaie.
          </span>
        )}
      </div>

      <div className="hydratation__gouttes" aria-hidden="true">
        {Array.from({ length: gouttes }, (_, i) => (
          <span key={i} className={`goutte${!inconnu && i < pleines ? ' goutte--pleine' : ''}`} />
        ))}
      </div>

      <div className="hydratation__boutons">
        <button
          type="button"
          className="hydratation__bouton"
          onClick={() => boire.mutate(-VERRE_ML)}
          disabled={inconnu || bu <= 0 || boire.isPending}
          aria-label="Retirer un verre d’eau"
        >
          <Icon name="ui-minus" size={18} />
        </button>
        <button
          type="button"
          className="hydratation__bouton hydratation__bouton--plein"
          onClick={() => boire.mutate(VERRE_ML)}
          disabled={inconnu || boire.isPending}
          aria-label="Ajouter un verre d’eau de 25 centilitres"
        >
          <Icon name="ui-plus" size={18} />
        </button>
      </div>
    </div>
  )
}
