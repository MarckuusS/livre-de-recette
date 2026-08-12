/**
 * Ma semaine — le planning des repas, un jour a la fois.
 *
 * Le desktop peint une grille de 7 jours x 5 creneaux large d'au moins 900 px.
 * En 375 px elle est illisible : on montre UN JOUR, la bande des sept jours en
 * tete servant a la fois de navigation et de vue d'ensemble (une pastille par
 * jour rempli). Tout le reste est repris tel quel : les cinq creneaux toujours
 * visibles, les apports du jour dans l'ordre reglementaire, le cout.
 *
 * Deux gestes du bureau n'ont aucun equivalent au doigt et sont remplaces :
 *
 *   - le glisser-deposer d'un repas vers une autre cellule devient
 *     « Déplacer vers… » dans la feuille du repas (EntrySheet) ;
 *   - la barre de six boutons d'outils devient un menu « ⋯ » (WeekTools).
 *
 * La semaine ET le jour consultes vivent dans l'URL (`?semaine=&jour=`) : le
 * telephone recharge l'application quand la memoire manque, et retrouver
 * « aujourd'hui » alors qu'on preparait le samedi est le genre de detail qui
 * fait abandonner un outil.
 */

import { Fragment, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  DAY_LABELS,
  MEAL_SLOTS,
  MEAL_SLOT_LABELS,
  perEater,
  datesOfIsoWeek,
  formatEuros,
  type MealSlot,
  type NutritionTotal,
} from "@livre/shared";

import { MacroBar, MacrosDonut } from "../components/MacrosDonut.js";
import { NutrientLabel } from "../components/NutrientLabel.js";
import { EmptyState, ErrorState, LoadingRows } from "../components/States.js";
import { useToast } from "../components/Toast.js";
import { WeekPicker } from "../components/WeekPicker.js";
import {
  useAddEntry,
  useCalendar,
  useDeleteEntry,
  type CalendarResponse,
  type EntryDraft,
} from "../lib/queries.js";
import { useDailyTargets } from "../lib/useDailyTargets.js";
import { useIsoWeekParam } from "../lib/useIsoWeekParam.js";
import { GoalCard } from "./semaine/GoalCard.js";
import { MealRow } from "./semaine/MealRow.js";
import { AddEntrySheet } from "./semaine/AddEntrySheet.js";
import { EntrySheet } from "./semaine/EntrySheet.js";
import { WeekTools, type WeekTool } from "./semaine/WeekTools.js";
import {
  NUTRIENT_ROWS,
  entriesCost,
  entriesOfDay,
  entriesOfSlot,
  entryName,
  entryAmountLabel,
  formatNutrient,
  sumNutrition,
  type SavedEntry,
} from "./semaine/totals.js";
import { Icon } from "../icons/index.js";
import "../styles/week.css";

const DAY_PANEL_ID = "jour-panneau";

/**
 * Les creneaux dont l'absence se remarque.
 *
 * Les collations n'y sont pas : ne pas gouter n'est pas un trou a combler, et
 * cinq puces « + » sur chaque jour libre rendraient la semaine illisible.
 */
const PRINCIPAUX = ["morning", "noon", "evening"] as const;

export function WeekScreen() {
  const week = useIsoWeekParam();
  const query = useCalendar(week.isoWeek);

  const [searchParams, setSearchParams] = useSearchParams();
  // 0 = lundi, comme en base. `getDay()` rend 0 pour dimanche.
  const todayIndex = (new Date().getDay() + 6) % 7;
  const requested = searchParams.get("jour");
  const parsed = requested === null ? Number.NaN : Number(requested);
  const dayIndex =
    Number.isInteger(parsed) && parsed >= 0 && parsed <= 6
      ? parsed
      : week.isCurrent
        ? todayIndex
        : 0;

  const setDay = (index: number) => {
    const next = new URLSearchParams(searchParams);
    next.set("jour", String(index));
    setSearchParams(next, { replace: true });
  };

  // Semaine et jour changent ENSEMBLE : deux appels successifs a
  // `setSearchParams` partiraient du meme instantane et le second effacerait
  // le premier.
  const goToday = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("semaine");
    next.set("jour", String(todayIndex));
    setSearchParams(next, { replace: true });
  };

  const cible = useDailyTargets();
  const [addTarget, setAddTarget] = useState<{
    dayOfWeek: number;
    slot: MealSlot;
  } | null>(null);
  const [editing, setEditing] = useState<SavedEntry | null>(null);
  const [tool, setTool] = useState<WeekTool | null>(null);

  const toast = useToast();
  const remove = useDeleteEntry(week.isoWeek);
  const add = useAddEntry(week.isoWeek);

  /**
   * Suppression immediate, rattrapable pendant six secondes.
   *
   * L'annulation recree une entree — un nouvel identifiant, donc, exactement
   * comme sur le desktop. Le tampon est ici cote client (la charge utile
   * complete) et non cote serveur : l'application s'ouvre sur plusieurs
   * appareils, un tampon partage y annulerait la suppression d'un autre.
   */
  const deleteEntry = (entry: SavedEntry, label: string) => {
    const draft: EntryDraft = {
      dayOfWeek: entry.dayOfWeek,
      slot: entry.slot,
      recipeId: entry.recipeId,
      ingredientId: entry.ingredientId,
      quantityG: entry.quantityG,
      portions: entry.portions,
    };
    setEditing(null);
    remove.mutate(entry.id, {
      onSuccess: () =>
        toast.showUndo(`${label} retiré`, () => add.mutate(draft)),
    });
  };

  const dates = useMemo(() => datesOfIsoWeek(week.isoWeek), [week.isoWeek]);
  const data = query.data;
  // Memorises pour que les totaux, en aval, ne se recalculent pas a chaque
  // ouverture de feuille : huit agregations sur toute la semaine.
  const weekEntries = useMemo(() => data?.entries ?? [], [data]);
  const dayEntries = useMemo(
    () => (data ? entriesOfDay(data, dayIndex) : []),
    [data, dayIndex],
  );

  return (
    <section className="screen screen--week">
      {/* Seul le SELECTEUR DE SEMAINE reste collant. La bande des jours y
          vivait aussi, du temps ou elle tenait en 44 px de haut ; les sept
          cartes qui l'ont remplacee y prendraient la moitie de l'ecran. */}
      <div className="week-head">
        <WeekPicker
          isoWeek={week.isoWeek}
          isCurrent={week.isCurrent}
          onChange={week.onChange}
          onToday={goToday}
        />
      </div>

      {/* UN ACCORDEON, ET NON PLUS UN JEU D'ONGLETS.
            Les creneaux du jour choisi se deplient sous SA carte, la ou le
            doigt vient de taper. Le panneau vivait sous les sept cartes, ce
            qui imposait de derouler 770 px — et l'ordre de derouler etait
            annule par la restauration de position que le navigateur applique
            au changement d'adresse, le jour vivant dans l'URL.
            Le role `tablist` est tombe avec : il interdit tout enfant qui ne
            soit pas un onglet, or le panneau est maintenant dans la liste.
            Sept boutons a deplier, c'est le motif standard, et les sept
            deviennent atteignables au clavier au lieu d'un seul. */}
      <div className="jours">
        {/* Taper un jour amene SA CARTE en haut, ses creneaux venant juste
              dessous. Derouler jusqu'au panneau ferait disparaitre la carte
              qu'on vient de choisir ; la laisser en place ne montrerait rien,
              les creneaux etant sous sept cartes.

              Defilement INSTANTANE : anime, il se fait annuler par le rendu
              qui suit le changement de jour. */}
        {dates.map((date, index) => (
          <Fragment key={index}>
            <DayCard
              index={index}
              date={date}
              active={index === dayIndex}
              today={week.isCurrent && index === todayIndex}
              entries={data ? entriesOfDay(data, index) : []}
              data={data}
              kcalTarget={cible.kcalTarget}
              eaters={cible.eaters}
              onSelect={setDay}
            />

            {index === dayIndex && data && (
              <div
                className="day-panel"
                id={DAY_PANEL_ID}
                role="region"
                aria-labelledby={`jour-onglet-${index}`}
              >
                {MEAL_SLOTS.map((slot) => (
                  <SlotCard
                    key={slot}
                    slot={slot}
                    dayIndex={dayIndex}
                    entries={entriesOfSlot(dayEntries, slot)}
                    data={data}
                    onAdd={() => setAddTarget({ dayOfWeek: dayIndex, slot })}
                    onEdit={setEditing}
                  />
                ))}
              </div>
            )}
          </Fragment>
        ))}
      </div>

      <div className="week-tools">
        <button
          type="button"
          className="button button--secondary week-tools__trigger"
          onClick={() => setTool("menu")}
        >
          <span aria-hidden="true">⋯</span> Outils de la semaine
        </button>
      </div>

      {query.isPending && <LoadingRows />}
      {query.isError && (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      )}

      {query.isSuccess && data && (
        <>
          {weekEntries.length === 0 && (
            <EmptyState title="Semaine vide">
              Ajoute un repas à un créneau ci-dessous, ou reprends une semaine
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

      {addTarget !== null && (
        <AddEntrySheet
          isoWeek={week.isoWeek}
          dayOfWeek={addTarget.dayOfWeek}
          slot={addTarget.slot}
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

// ---------------------------------------------------------------------------
// Bande des jours
// ---------------------------------------------------------------------------

/**
 * Une journee de la semaine, en carte.
 *
 * Elle a remplace un bouton de 44 px qui ne portait qu'une lettre, un chiffre
 * et un point : la semaine se parcourait sans qu'on puisse dire ce qu'il y
 * avait dedans. La carte repond aux trois questions qu'on se pose en
 * planifiant — qu'est-ce qui est prevu, combien ca pese, qu'est-ce qui manque.
 *
 * Elle reste un ONGLET (`role="tab"`), et la journee choisie se deplie
 * dessous : l'edition par creneau, que le mockup ignore, ne perd rien.
 *
 * LE TOTAL AFFICHE EST CELUI DE LA CUISINE, pas une part individuelle — c'est
 * ce qui est prevu ce jour-la. Le badge, lui, compare la part d'UNE personne a
 * son objectif, comme partout ailleurs. Ecrire « 1 580 / 2 400 » melangerait
 * les deux sur une meme ligne, un total de foyer face a une cible personnelle :
 * la comparaison chiffree reste la ou elle est expliquee, sur l'Accueil.
 */
function DayCard({
  index,
  date,
  active,
  today,
  entries,
  data,
  kcalTarget,
  eaters,
  onSelect,
}: {
  index: number;
  date: Date | undefined;
  active: boolean;
  today: boolean;
  entries: readonly SavedEntry[];
  /** Absente tant que la semaine charge : la carte se limite alors a sa date. */
  data: CalendarResponse | undefined;
  kcalTarget: number | null;
  eaters: number;
  onSelect: (index: number) => void;
}) {
  const label = DAY_LABELS[index] ?? "";
  const total = data === undefined ? null : sumNutrition(entries, data);
  const kcal = Math.round(total?.kcal ?? 0);

  // Les creneaux principaux qui n'ont rien : c'est le « + Dîner » du mockup,
  // et c'est l'information la plus utile d'un ecran de planification.
  const manquants = PRINCIPAUX.filter(
    (slot) => !entries.some((e) => e.slot === slot),
  );

  const badge =
    total === null
      ? null
      : entries.length === 0
        ? { texte: "Jour libre", ton: "libre" as const }
        : today
          ? { texte: "En cours", ton: "encours" as const }
          : kcalTarget !== null &&
              Math.abs(perEater(total.kcal, eaters) - kcalTarget) <=
                kcalTarget * 0.1
            ? { texte: "Objectif tenu", ton: "ok" as const }
            : null;

  return (
    <button
      type="button"
      id={`jour-onglet-${index}`}
      aria-expanded={active}
      aria-controls={DAY_PANEL_ID}
      className={`jour${active ? " jour--actif" : ""}${today ? " jour--aujourdhui" : ""}`}
      onClick={() => onSelect(index)}
    >
      <span className="jour__haut">
        <span className="jour__nom">{label}</span>
        {date && (
          <span className="jour__date" aria-hidden="true">
            {date.getUTCDate()}
          </span>
        )}
        {badge && (
          <span className={`badge-jour badge-jour--${badge.ton}`}>
            {badge.texte}
          </span>
        )}
        {kcal > 0 && (
          <span className="jour__kcal">{kcal.toLocaleString("fr-FR")}</span>
        )}
      </span>

      <span className="chips-repas">
        {data !== undefined &&
          entries.map((entry) => (
            <span key={entry.id} className="chip-repas">
              {entryName(entry, data)}
            </span>
          ))}
        {manquants.map((slot) => (
          <span key={slot} className="chip-repas chip-repas--vide">
            + {MEAL_SLOT_LABELS[slot]}
          </span>
        ))}
      </span>

      {total !== null && <MacroBar total={total} />}
    </button>
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

// ---------------------------------------------------------------------------
// Un creneau
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Totaux
// ---------------------------------------------------------------------------

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
