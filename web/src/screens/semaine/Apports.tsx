/**
 * Le tableau des apports et la carte de cout, pour une portee quelconque.
 *
 * Ils vivaient dans le bloc du jour, avec une colonne "Semaine" en plus. Cette
 * colonne obligeait a OUVRIR UN JOUR pour lire un total de semaine, et
 * melangeait deux portees dans un meme tableau : on comparait sans le vouloir
 * une journee a sept.
 *
 * Chaque ecran porte donc les siens. Le composant est partage plutot que
 * recopie, sans quoi le format des nombres, le seuil des traces et la regle
 * des parts d'energie auraient fini par diverger entre les deux.
 */

import { formatEuros } from "@livre/shared";
import type { NutritionTotal } from "@livre/shared";

import { NutrientLabel } from "../../components/NutrientLabel.js";
import { Icon } from "../../icons/index.js";
import {
  NUTRIENT_ROWS,
  energyShare,
  formatNutrient,
  type CostTotal,
} from "./totals.js";

export function TableauApports({
  titre,
  total,
  entryCount,
}: {
  readonly titre: string;
  readonly total: NutritionTotal;
  /** Zero fait afficher "—" plutot que des zeros, qui passeraient pour mesures. */
  readonly entryCount: number;
}) {
  return (
    <div className="card">
      <h3 className="card__title">{titre}</h3>
      <div className="table-scroll">
        <table className="nutrition-table">
          <thead>
            <tr>
              <th scope="col">Nutriment</th>
              <th scope="col">Quantité</th>
              <th scope="col">Part</th>
            </tr>
          </thead>
          <tbody>
            {NUTRIENT_ROWS.map((row) => (
              <tr key={row.key}>
                <th scope="row" className={row.sub ? "unit" : undefined}>
                  <NutrientLabel
                    nutrient={row.key}
                    label={row.label}
                    sub={row.sub ?? false}
                  />
                </th>
                <td>{formatNutrient(entryCount, total[row.key], row)}</td>
                <td className="nutrition-table__part">
                  {entryCount > 0 ? energyShare(total, row.key) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CarteCout({
  titre,
  cout,
  portee,
}: {
  readonly titre: string;
  readonly cout: CostTotal;
  /** Ce dont on parle dans les avertissements : "de ce jour", "de la semaine". */
  readonly portee: string;
}) {
  return (
    <div className="card">
      <div className="card-entete">
        <h3 className="card__title card-entete__titre">{titre}</h3>
        <span className="card-entete__valeur">{formatEuros(cout.total)}</span>
      </div>

      {/* Un total sous-estime qui ne le dit pas est pire qu'une absence de
          total : on batit un budget dessus. */}
      {cout.missingLines > 0 && (
        <p className="note">
          <Icon name="ui-alert" size={14} className="icon--inline" />{" "}
          {cout.missingLines === 1
            ? `Un ingrédient ${portee} n’a pas de prix`
            : `${cout.missingLines} ingrédients ${portee} n’ont pas de prix`}{" "}
          : le total ci-dessus est <strong>sous-estimé</strong>.
        </p>
      )}

      {cout.orphanCount > 0 && (
        <p className="note">
          <Icon name="ui-alert" size={14} className="icon--inline" />{" "}
          {cout.orphanCount === 1
            ? "Un repas pointe vers une recette ou un ingrédient supprimé"
            : `${cout.orphanCount} repas pointent vers une recette ou un ingrédient supprimé`}{" "}
          : rien n’a pu être chiffré pour{" "}
          {cout.orphanCount === 1 ? "lui" : "eux"}.
        </p>
      )}
    </div>
  );
}
