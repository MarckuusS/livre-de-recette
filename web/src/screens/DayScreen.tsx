/**
 * Une journee du planning.
 *
 * Elle vivait DANS l'ecran de la semaine, depliee sous la carte du jour. Deux
 * niveaux de cartes blanches imbriquees se lisaient comme un seul : on ne
 * savait plus si "MATIN" appartenait a mercredi ou a jeudi. La journee est
 * donc un ecran a part, atteint par un tap et quitte par le bouton retour.
 *
 * Elle porte TOUT ce qui concerne un jour : les cinq creneaux, le tableau des
 * apports, la comparaison a l'objectif, l'anneau, le cout, et les outils dont
 * "vider ce jour" — qui n'ont de sens qu'ici, une fois le jour choisi.
 */

import { useMemo, useState } from "react";
import { useParams } from "react-router";
import {
  DAY_LABELS,
  MEAL_SLOTS,
  MEAL_SLOT_LABELS,
  addNutrition,
  datesOfIsoWeek,
  divideNutrition,
  formatEuros,
  formatGrams,
  perEater,
  type MealSlot,
  type NutritionTotal,
} from "@livre/shared";

import { MacrosDonut } from "../components/MacrosDonut.js";
import { NutrientLabel } from "../components/NutrientLabel.js";
import { EmptyState, ErrorState, LoadingRows } from "../components/States.js";
import { useToast } from "../components/Toast.js";
import { Icon } from "../icons/index.js";
import {
  useAddEntry,
  useCalendar,
  useDeleteEntry,
  type CalendarResponse,
  type EntryDraft,
} from "../lib/queries.js";
import { useIsoWeekParam } from "../lib/useIsoWeekParam.js";
import { AddEntrySheet } from "./semaine/AddEntrySheet.js";
import { EntrySheet } from "./semaine/EntrySheet.js";
import { GoalCard } from "./semaine/GoalCard.js";
import { MealRow } from "./semaine/MealRow.js";
import { WeekTools, type WeekTool } from "./semaine/WeekTools.js";
import {
  NUTRIENT_ROWS,
  energyShare,
  entriesCost,
  entriesOfDay,
  entriesOfSlot,
  formatNutrient,
  sumNutrition,
  type SavedEntry,
} from "./semaine/totals.js";
import "../styles/week.css";

/** Indice de jour lu dans l'adresse. Hors bornes, on retombe sur lundi. */
function lireJour(brut: string | undefined): number {
  const n = Number(brut);
  return Number.isInteger(n) && n >= 0 && n <= 6 ? n : 0;
}

export function DayScreen() {
  const week = useIsoWeekParam();
  const { jour } = useParams();
  const dayIndex = lireJour(jour);

  const query = useCalendar(week.isoWeek);
  const data = query.data;

  const [addTarget, setAddTarget] = useState<MealSlot | null>(null);
  const [editing, setEditing] = useState<SavedEntry | null>(null);
  const [tool, setTool] = useState<WeekTool | null>(null);

  const toast = useToast();
  const remove = useDeleteEntry(week.isoWeek);
  const add = useAddEntry(week.isoWeek);

  /**
   * Suppression immediate, rattrapable pendant six secondes.
   *
   * L'annulation recree une entree, donc un nouvel identifiant. Le tampon est
   * cote client : l'application s'ouvre sur plusieurs appareils, un tampon
   * partage y annulerait la suppression d'un autre.
   */
  const deleteEntry = (entry: SavedEntry, label: string) => {
    const draft: EntryDraft = {
      dayOfWeek: entry.dayOfWeek,
      slot: entry.slot,
      recipeId: entry.recipeId,
      ingredientId: entry.ingredientId,
      quantityG: entry.quantityG,
      portions: entry.portions,
      unit: entry.unit,
    };
    setEditing(null);
    remove.mutate(entry.id, {
      onSuccess: () =>
        toast.showUndo(`${label} retiré`, () => add.mutate(draft)),
    });
  };

  const dates = useMemo(() => datesOfIsoWeek(week.isoWeek), [week.isoWeek]);
  const weekEntries = useMemo(() => data?.entries ?? [], [data]);
  const dayEntries = useMemo(
    () => (data ? entriesOfDay(data, dayIndex) : []),
    [data, dayIndex],
  );

  const total = useMemo(
    () => (data ? sumNutrition(dayEntries, data) : null),
    [dayEntries, data],
  );

  return (
    <section className="screen screen--jour">
      <div className="jour-entete">
        <h2 className="jour-entete__titre">
          {longDayLabel(dates[dayIndex], dayIndex)}
        </h2>
        {total !== null && total.kcal > 0 && (
          <span className="jour-entete__kcal chiffre">
            {Math.round(total.kcal).toLocaleString("fr-FR")}
          </span>
        )}
      </div>

      {query.isPending && <LoadingRows />}
      {query.isError && (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      )}

      {query.isSuccess && data && (
        <>
          {MEAL_SLOTS.map((slot) => (
            <SlotCard
              key={slot}
              slot={slot}
              dayIndex={dayIndex}
              entries={entriesOfSlot(dayEntries, slot)}
              data={data}
              onAdd={() => setAddTarget(slot)}
              onEdit={setEditing}
            />
          ))}

          {dayEntries.length === 0 && (
            <EmptyState title="Journée vide">
              Ajoute un repas à un créneau ci-dessus, ou reprends une semaine
              passée depuis « Outils de la semaine ».
            </EmptyState>
          )}

          <DayTotals
            data={data}
            dayEntries={dayEntries}
            weekEntries={weekEntries}
          />
        </>
      )}

      <div className="week-tools">
        <button
          type="button"
          className="button button--secondary week-tools__trigger"
          onClick={() => setTool("menu")}
        >
          <span aria-hidden="true">⋯</span> Outils de la semaine
        </button>
      </div>

      {addTarget !== null && (
        <AddEntrySheet
          isoWeek={week.isoWeek}
          dayOfWeek={dayIndex}
          slot={addTarget}
          onClose={() => setAddTarget(null)}
        />
      )}

      {editing !== null && data && (
        <EntrySheet
          isoWeek={week.isoWeek}
          entry={editing}
          data={data}
          onClose={() => setEditing(null)}
          onDelete={deleteEntry}
        />
      )}

      <WeekTools
        isoWeek={week.isoWeek}
        dayOfWeek={dayIndex}
        weekEntryCount={weekEntries.length}
        dayEntryCount={dayEntries.length}
        tool={tool}
        onTool={setTool}
      />
    </section>
  );
}

/** « Lundi 28 avril ». Les dates de la semaine sont a midi UTC (voir isoweek.ts). */
function longDayLabel(date: Date | undefined, index: number): string {
  if (!date) return DAY_LABELS[index] ?? "";
  const formatted = date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function SlotCard({
  slot,
  dayIndex,
  entries,
  data,
  onAdd,
  onEdit,
}: {
  slot: MealSlot;
  dayIndex: number;
  entries: readonly SavedEntry[];
  data: CalendarResponse;
  onAdd: () => void;
  onEdit: (entry: SavedEntry) => void;
}) {
  const kcal = sumNutrition(entries, data).kcal;
  const slotLabel = MEAL_SLOT_LABELS[slot];
  const dayLabel = DAY_LABELS[dayIndex] ?? "";

  return (
    <section className="slot">
      <header className="slot__header">
        {/* Les cinq creneaux restent affiches meme vides : c'est ce qui rend
            l'ajout a un en-cas atteignable en un seul geste. */}
        <h3 className="slot__title">{slotLabel}</h3>
        {kcal > 0 && (
          <span className="slot__kcal">
            {Math.round(kcal).toLocaleString("fr-FR")} kcal
          </span>
        )}
      </header>

      {entries.length > 0 && (
        <ul className="slot__list">
          {entries.map((entry) => (
            <MealRow key={entry.id} entry={entry} data={data} onEdit={onEdit} />
          ))}
        </ul>
      )}

      <button
        type="button"
        className="slot__add"
        onClick={onAdd}
        aria-label={`Ajouter un repas — ${dayLabel} ${slotLabel.toLowerCase()}`}
      >
        <span aria-hidden="true">＋</span> Ajouter
      </button>
    </section>
  );
}

function DayTotals({
  data,
  dayEntries,
  weekEntries,
}: {
  data: CalendarResponse;
  dayEntries: readonly SavedEntry[];
  weekEntries: CalendarResponse["entries"];
}) {
  const dayTotal = useMemo(
    () => sumNutrition(dayEntries, data),
    [dayEntries, data],
  );
  const weekTotal = useMemo(
    () => sumNutrition(weekEntries, data),
    [weekEntries, data],
  );
  const dayCost = useMemo(
    () => entriesCost(dayEntries, data),
    [dayEntries, data],
  );
  const weekCost = useMemo(
    () => entriesCost(weekEntries, data),
    [weekEntries, data],
  );

  return (
    <>
      <div className="card">
        <h3 className="card__title">Apports</h3>
        <div className="table-scroll">
          <table className="nutrition-table">
            <thead>
              <tr>
                <th scope="col">Nutriment</th>
                <th scope="col">Jour</th>
                <th scope="col">Part</th>
                <th scope="col">Semaine</th>
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
                  <td>
                    {formatNutrient(dayEntries.length, dayTotal[row.key], row)}
                  </td>
                  {/* La part porte sur le JOUR, c'est elle que l'anneau plus
                      bas resume. Elle se range donc juste apres sa colonne. */}
                  <td className="nutrition-table__part">
                    {dayEntries.length > 0
                      ? energyShare(dayTotal, row.key)
                      : null}
                  </td>
                  <td>
                    {formatNutrient(
                      weekEntries.length,
                      weekTotal[row.key],
                      row,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/*
        Repartition du jour selectionne, en pourcentage.
        Le tableau ci-dessus donne les nombres, pas les proportions : savoir
        qu'une journee pese 92 g de lipides ne dit pas qu'elle est a 55 %
        lipidique. C'est la lecture qui manquait, et c'est celle qui se fait
        d'un coup d'oeil. Le meme composant sert a la fiche recette.
      */}
      {/* Entre les nombres bruts et l'anneau : c'est la lecture personnelle de
          la journee, et elle n'a de sens qu'apres avoir vu les totaux. */}
      <GoalCard dayTotal={dayTotal} hasEntries={dayEntries.length > 0} />

      <MacrosDonut
        total={dayTotal}
        title="Répartition du jour"
        centerCaption="kcal ce jour"
        emptyMessage={
          dayEntries.length === 0
            ? "Rien de prévu ce jour."
            : "Aucune donnée : les repas de ce jour n’ont pas de macros renseignées."
        }
        // Le tableau des apports du jour est rendu juste au-dessus : la
        // legende reprenait quatre de ses huit lignes.
        showLegend={false}
      />

      <div className="card">
        <h3 className="card__title">Coût</h3>
        <dl className="kv">
          <div className="kv__pair">
            <dt>Ce jour</dt>
            <dd>{formatEuros(dayCost.total)}</dd>
          </div>
          <div className="kv__pair">
            <dt>La semaine</dt>
            <dd>{formatEuros(weekCost.total)}</dd>
          </div>
        </dl>
        {weekCost.missingLines > 0 && (
          <p className="note">
            <Icon name="ui-alert" size={14} className="icon--inline" />{" "}
            {weekCost.missingLines === 1
              ? "Un ingrédient de la semaine n’a pas de prix"
              : `${weekCost.missingLines} ingrédients de la semaine n’ont pas de prix`}{" "}
            : le total ci-dessus est <strong>sous-estimé</strong>.
          </p>
        )}
        {weekCost.orphanCount > 0 && (
          <p className="note">
            <Icon name="ui-alert" size={14} className="icon--inline" />{" "}
            {weekCost.orphanCount === 1
              ? "Un repas pointe vers une recette ou un ingrédient supprimé"
              : `${weekCost.orphanCount} repas pointent vers une recette ou un ingrédient supprimé`}{" "}
            : rien n’a pu être chiffré pour{" "}
            {weekCost.orphanCount === 1 ? "lui" : "eux"}.
          </p>
        )}
      </div>
    </>
  );
}

/**
 * Une valeur nutritionnelle.
 *
 * « — » quand il n'y a rien a totaliser : afficher « 0 kcal » pour une journee
 * vide laisserait croire a une donnee mesuree. Une macro inconnue, elle,
 * compte pour 0 dans l'agregat — regle du domaine, reprise du desktop.
 */
