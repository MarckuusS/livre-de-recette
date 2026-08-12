/**
 * La semaine, en sept lignes.
 *
 * Elle a d'abord ete une bande de sept boutons de 44 px, qui ne disaient rien
 * de leur contenu. Elle est ensuite devenue sept cartes portant une puce par
 * repas : le mockup en montrait trois par jour, la vraie donnee en met huit, et
 * la carte du mercredi faisait trois fois la hauteur de celle du mardi.
 *
 * D'ou la forme actuelle : une ligne de HAUTEUR FIXE par jour, quel que soit
 * le nombre de repas. Elle repond aux trois questions qu'on se pose en
 * parcourant sa semaine — qu'est-ce qui est rempli, combien ca pese, quelle
 * allure ca a — et rien d'autre. Le detail vit dans l'ecran du jour.
 *
 * LE JOUR EST UN ECRAN, PAS UN DEPLIANT. Deplie sous sa ligne, il empilait des
 * cartes blanches dans des cartes blanches, et l'on ne savait plus si "MATIN"
 * appartenait a mercredi ou a jeudi. Un tap ouvre `/planning/:jour`, le bouton
 * retour ramene ici.
 */

import { useMemo } from "react";
import { Link } from "react-router";
import {
  DAY_LABELS,
  MEAL_SLOTS,
  MEAL_SLOT_LABELS,
  datesOfIsoWeek,
  formatEuros,
  perEater,
} from "@livre/shared";

import { MacroBar } from "../components/MacrosDonut.js";
import { ErrorState, LoadingRows } from "../components/States.js";
import { WeekPicker } from "../components/WeekPicker.js";
import { useCalendar, type CalendarResponse } from "../lib/queries.js";
import { useDailyTargets } from "../lib/useDailyTargets.js";
import { useIsoWeekParam } from "../lib/useIsoWeekParam.js";
import { entriesCost, entriesOfDay, sumNutrition } from "./semaine/totals.js";
import "../styles/week.css";

export function WeekScreen() {
  const week = useIsoWeekParam();
  const query = useCalendar(week.isoWeek);
  const cible = useDailyTargets();

  /** 0 = lundi, comme en base. `getDay()` rend 0 pour dimanche. */
  const todayIndex = (new Date().getDay() + 6) % 7;
  const dates = useMemo(() => datesOfIsoWeek(week.isoWeek), [week.isoWeek]);
  const data = query.data;

  const semaine = useMemo(() => {
    if (data === undefined) return null;
    const total = sumNutrition(data.entries, data);
    return { total, cout: entriesCost(data.entries, data) };
  }, [data]);

  return (
    <section className="screen screen--week">
      <div className="week-head">
        <WeekPicker
          isoWeek={week.isoWeek}
          isCurrent={week.isCurrent}
          onChange={week.onChange}
          onToday={week.onToday}
        />
      </div>

      {query.isPending && <LoadingRows />}
      {query.isError && (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      )}

      <ul className="jours">
        {dates.map((date, index) => (
          <JourLigne
            key={index}
            index={index}
            date={date}
            isoWeek={week.isoWeek}
            today={week.isCurrent && index === todayIndex}
            data={data}
            kcalTarget={cible.kcalTarget}
            eaters={cible.eaters}
          />
        ))}
      </ul>

      {semaine !== null && semaine.total.kcal > 0 && (
        <div className="card semaine-bilan">
          <div className="card-entete">
            <h2 className="card__title card-entete__titre">Toute la semaine</h2>
            <span className="card-entete__valeur">
              {Math.round(semaine.total.kcal).toLocaleString("fr-FR")} kcal
            </span>
          </div>
          <MacroBar total={semaine.total} />
          {/* Le cout de la semaine vivait dans le bloc du jour, donc il fallait
              ouvrir un jour pour lire un total de semaine. */}
          <p className="semaine-bilan__cout">
            Coût estimé : <strong>{formatEuros(semaine.cout.total)}</strong>
            {semaine.cout.missingLines > 0 &&
              ` (${semaine.cout.missingLines} ligne${
                semaine.cout.missingLines > 1 ? "s" : ""
              } sans prix)`}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Une journee, en une ligne de hauteur fixe.
 *
 * Les CINQ MARQUES disent quels creneaux sont remplis. C'est la seule
 * information de contenu qui ne grandit pas avec le nombre de repas, et c'est
 * celle qu'on cherche en planifiant : ce qui manque, pas ce qui est deja la.
 *
 * Le total affiche est celui de LA CUISINE. Le badge, lui, compare une part
 * individuelle a son objectif, comme partout ailleurs : ecrire les deux sur la
 * meme ligne melangerait un total de foyer et une cible personnelle.
 */
function JourLigne({
  index,
  date,
  isoWeek,
  today,
  data,
  kcalTarget,
  eaters,
}: {
  index: number;
  date: Date | undefined;
  isoWeek: string;
  today: boolean;
  data: CalendarResponse | undefined;
  kcalTarget: number | null;
  eaters: number;
}) {
  const label = DAY_LABELS[index] ?? "";
  const entries = data === undefined ? [] : entriesOfDay(data, index);
  const total = data === undefined ? null : sumNutrition(entries, data);
  const kcal = Math.round(total?.kcal ?? 0);

  const remplis = MEAL_SLOTS.filter((slot) =>
    entries.some((e) => e.slot === slot),
  );
  const manquants = MEAL_SLOTS.filter((slot) => !remplis.includes(slot));

  const tenu =
    total !== null &&
    entries.length > 0 &&
    kcalTarget !== null &&
    Math.abs(perEater(total.kcal, eaters) - kcalTarget) <= kcalTarget * 0.1;

  return (
    <li>
      <Link
        to={`/planning/${index}?semaine=${isoWeek}`}
        className={`jour${today ? " jour--aujourdhui" : ""}`}
      >
        <span className="jour__haut">
          <span className="jour__nom">{label}</span>
          {date && (
            <span className="jour__date" aria-hidden="true">
              {date.getUTCDate()}
            </span>
          )}
          {today && (
            <span className="badge-jour badge-jour--encours">En cours</span>
          )}
          {tenu && (
            <span className="badge-jour badge-jour--ok">Objectif tenu</span>
          )}

          <span className="jour__valeur">
            {entries.length === 0 ? (
              <span className="jour__libre">Jour libre</span>
            ) : (
              <span className="jour__kcal">{kcal.toLocaleString("fr-FR")}</span>
            )}
          </span>
          <span className="jour__chevron" aria-hidden="true">
            ›
          </span>
        </span>

        {/* Les marques ne sont PAS decoratives : elles portent la seule
            information de contenu de la ligne. D'ou le libelle, qui dit en
            toutes lettres ce que cinq ronds disent a l'oeil. */}
        <span
          className="creneaux"
          role="img"
          aria-label={
            remplis.length === 0
              ? "Aucun repas prévu"
              : `Prévu : ${remplis.map((s) => MEAL_SLOT_LABELS[s]).join(", ")}. Manque : ${manquants
                  .map((s) => MEAL_SLOT_LABELS[s])
                  .join(", ")}`
          }
        >
          {MEAL_SLOTS.map((slot) => (
            <span
              key={slot}
              className={`creneau${remplis.includes(slot) ? " creneau--rempli" : ""}`}
            />
          ))}
        </span>

        {total !== null && <MacroBar total={total} />}
      </Link>
    </li>
  );
}
