/**
 * Profil alimentaire et sportif — Parametres → Mon profil.
 *
 * L'ecran repond a une question : « combien pour MOI, aujourd'hui ». Il ne
 * donne pas d'avis medical, et il le dit.
 *
 * QUATRE PARTIS PRIS D'INTERFACE :
 *
 *   1. Les cibles se recalculent PENDANT la saisie, avant tout enregistrement.
 *      Changer d'objectif et voir la ligne bouger explique le calcul mieux
 *      qu'une phrase — et evite d'enregistrer pour decouvrir le resultat.
 *
 *   2. Le detail du calcul est montre, pas cache : metabolisme de base, puis
 *      facteur d'activite, puis ajustement d'objectif. Quelqu'un qui ne sait
 *      pas lire un tableau nutritionnel a d'autant plus besoin de voir d'ou
 *      sort le chiffre qu'on lui propose.
 *
 *   3. L'energie et la repartition sont DEUX cartes distinctes, parce que ce
 *      sont deux decisions distinctes. Choisir « sèche » propose une
 *      repartition ; la remplacer ne change pas l'objectif de poids.
 *
 *   4. Rien n'est obligatoire. Un profil se remplit par etapes ; l'ecran
 *      s'enregistre a tout moment et dit simplement ce qui manque encore pour
 *      que la cible apparaisse.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  ACTIVITY_LEVELS,
  ENERGY_GOALS,
  MACRO_SPLITS,
  MIN_FAT_PERCENT,
  MIN_PROTEINS_PER_KG,
  PACES,
  estimateTargets,
  splitOf,
  type ActivityCode,
  type GoalCode,
  type MacroSplit,
  type PaceCode,
  type SplitCode,
  type Targets,
} from '@livre/shared'

import { NumberField, SelectField } from '../components/Field.js'
import { NutrientLabel } from '../components/NutrientLabel.js'
import { ErrorState, LoadingRows } from '../components/States.js'
import { useToast } from '../components/Toast.js'
import { Icon } from '../icons/index.js'
import { useProfile, useSaveProfile, type ProfilePayload } from '../lib/queries.js'
import '../styles/profile.css'

interface Draft {
  sex: 'f' | 'm' | null
  birthYear: number | null
  heightCm: number | null
  weightKg: number | null
  activity: ActivityCode | null
  goal: GoalCode | null
  split: SplitCode | null
  splitProteins: number | null
  splitCarbs: number | null
  splitFats: number | null
  targetWeightKg: number | null
  pace: PaceCode | null
  kcalTarget: number | null
  eaters: number
}

const EMPTY: Draft = {
  sex: null, birthYear: null, heightCm: null, weightKg: null,
  activity: null, goal: null,
  split: null, splitProteins: null, splitCarbs: null, splitFats: null,
  targetWeightKg: null, pace: null,
  kcalTarget: null, eaters: 1,
}

/** Comme partout ailleurs : « 2 759 » et non « 2759 ». */
const kcalFr = (value: number) => value.toLocaleString('fr-FR')

const dateFr = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

export function ProfileScreen() {
  const query = useProfile()
  const save = useSaveProfile()
  const toast = useToast()

  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [loaded, setLoaded] = useState(false)

  // Le serveur fait foi au PREMIER chargement seulement : reecraser le tampon
  // a chaque reponse effacerait la saisie en cours si une requete de fond
  // aboutissait entre-temps.
  useEffect(() => {
    if (loaded || query.data === undefined) return
    const { profile, eaters } = query.data
    setDraft({
      sex: profile.sex,
      birthYear: profile.birthYear,
      heightCm: profile.heightCm,
      weightKg: profile.weightKg,
      activity: profile.activity as ActivityCode | null,
      goal: profile.goal as GoalCode | null,
      split: profile.split as SplitCode | null,
      splitProteins: profile.splitProteins,
      splitCarbs: profile.splitCarbs,
      splitFats: profile.splitFats,
      targetWeightKg: profile.targetWeightKg,
      pace: profile.pace as PaceCode | null,
      kcalTarget: profile.kcalTarget,
      eaters,
    })
    setLoaded(true)
  }, [query.data, loaded])

  const patch = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }))

  const customSplit: MacroSplit | null =
    draft.splitProteins === null && draft.splitCarbs === null && draft.splitFats === null
      ? null
      : {
          proteins: draft.splitProteins ?? 0,
          carbs: draft.splitCarbs ?? 0,
          fats: draft.splitFats ?? 0,
        }

  const estimated = useMemo(
    () => estimateTargets({ ...draft, customSplit }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft],
  )

  /** La cible saisie a la main l'emporte sur l'estimation, si elle existe. */
  const kcal = draft.kcalTarget ?? estimated?.kcal ?? null

  const missingText = useMemo(() => {
    const labels: Record<string, string> = {
      sex: 'le sexe', birthYear: 'l’année de naissance', heightCm: 'la taille',
      weightKg: 'le poids', activity: 'le niveau d’activité', goal: 'l’objectif',
    }
    const missing = Object.entries(labels)
      .filter(([key]) => draft[key as keyof Draft] === null)
      .map(([, label]) => label)
    // « a, b et c » : une enumeration lue par un humain, pas un tableau imprime.
    if (missing.length <= 1) return missing.join('')
    return `${missing.slice(0, -1).join(', ')} et ${missing[missing.length - 1]}`
  }, [draft])

  if (query.isPending) return <section className="screen"><LoadingRows rows={5} /></section>
  if (query.isError) {
    return (
      <section className="screen">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </section>
    )
  }

  const submit = () => {
    const payload: ProfilePayload = { ...draft }
    void save.mutateAsync(payload).then(() => toast.show({ message: 'Profil enregistré.' }))
  }

  const perdDuPoids =
    draft.targetWeightKg !== null && draft.weightKg !== null
      ? draft.targetWeightKg < draft.weightKg
      : (ENERGY_GOALS.find((g) => g.code === draft.goal)?.adjust ?? 0) < 0

  return (
    <section className="screen">
      <div className="card">
        <h2 className="card__title">Mon profil</h2>
        <p className="card__lead">
          Sert à calculer un objectif journalier. Ces informations sont <strong>personnelles</strong> :
          l’autre personne du foyer ne les voit pas.
        </p>
      </div>

      <div className="card">
        <h2 className="card__title">Moi</h2>
        <div className="form">
          <SelectField
            label="Sexe"
            value={draft.sex ?? ''}
            onChange={(v) => patch({ sex: v === '' ? null : (v as 'f' | 'm') })}
            placeholder="Non renseigné"
            options={[{ value: 'f', label: 'Femme' }, { value: 'm', label: 'Homme' }]}
            hint="La formule de référence n’a que ces deux constantes."
          />
          <NumberField
            label="Année de naissance"
            value={draft.birthYear}
            onChange={(v) => patch({ birthYear: v })}
            min={1900}
            max={2100}
            hint="L’année suffit : une erreur de douze mois déplace la cible de 5 kcal."
          />
          <NumberField label="Taille" value={draft.heightCm} onChange={(v) => patch({ heightCm: v })} min={80} max={250} suffix="cm" />
          <NumberField label="Poids" value={draft.weightKg} onChange={(v) => patch({ weightKg: v })} min={20} max={400} suffix="kg" decimals={1} />
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">Activité</h2>
        <SelectField
          label="Niveau d’activité"
          value={draft.activity ?? ''}
          onChange={(v) => patch({ activity: v === '' ? null : (v as ActivityCode) })}
          placeholder="Non renseigné"
          options={ACTIVITY_LEVELS.map((l) => ({ value: l.code, label: `${l.label} — ${l.hint}` }))}
          hint="Décris ta semaine ENTIÈRE, sport compris. L’erreur la plus fréquente est d’ajouter mentalement le sport à un niveau qui le compte déjà."
        />
      </div>

      {/* ---------- Ce qu'on veut qu'il arrive ---------- */}
      <div className="card">
        <h2 className="card__title">Objectif</h2>
        <div className="form">
          <SelectField
            label="Objectif"
            value={draft.goal ?? ''}
            onChange={(v) => patch({ goal: v === '' ? null : (v as GoalCode) })}
            placeholder="Non renseigné"
            options={ENERGY_GOALS.map((g) => ({ value: g.code, label: `${g.label} — ${g.hint}` }))}
            hint="Il décide de l’écart à ta dépense, et propose une répartition — que tu peux changer juste en dessous."
          />

          <NumberField
            label="Poids visé"
            value={draft.targetWeightKg}
            onChange={(v) => patch({ targetWeightKg: v })}
            min={20}
            max={400}
            suffix="kg"
            decimals={1}
            hint="Facultatif. Renseigné, il remplace le pourcentage de l’objectif par un écart calculé, et l’écran annonce une date d’arrivée."
          />

          {draft.targetWeightKg !== null && (
            <SelectField
              label="Allure"
              value={draft.pace ?? ''}
              onChange={(v) => patch({ pace: v === '' ? null : (v as PaceCode) })}
              placeholder="Celle de l’objectif"
              options={PACES.map((p) => ({
                value: p.code,
                label: `${p.label} — ${p.kgPerWeek.toLocaleString('fr-FR')} kg par semaine`,
              }))}
              hint={
                perdDuPoids
                  ? 'Une allure rapide n’est pas une allure meilleure : plus le déficit est creux, plus la masse musculaire paie.'
                  : 'Au-delà d’un petit surplus, ce qui se prend en plus se prend en gras.'
              }
            />
          )}
        </div>
      </div>

      <SplitCard draft={draft} onPatch={patch} estimated={estimated} />

      <TargetsCard estimated={estimated} draft={draft} missing={missingText} onPatch={patch} kcal={kcal} />

      <div className="card">
        <h2 className="card__title">La cuisine</h2>
        <NumberField
          label="Nombre de mangeurs"
          value={draft.eaters}
          onChange={(v) => patch({ eaters: v ?? 1 })}
          min={1}
          max={20}
          hint="Le calendrier planifie pour la cuisine, sans dire qui mange quoi. Le total d’une journée est donc divisé par ce nombre pour être comparé à ton objectif. Réglage partagé avec l’autre personne du foyer."
        />
        <p className="field__hint">
          C’est une approximation : elle suppose que vous mangez la même chose, en même quantité.
        </p>
      </div>

      <div className="card">
        <button type="button" className="button button--primary" disabled={save.isPending} onClick={submit}>
          {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {save.isError && <p className="status status--error">{save.error.message}</p>}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Repartition
// ---------------------------------------------------------------------------

function SplitCard({
  draft,
  estimated,
  onPatch,
}: {
  readonly draft: Draft
  readonly estimated: Targets | null
  readonly onPatch: (changes: Partial<Draft>) => void
}) {
  const proposee = ENERGY_GOALS.find((g) => g.code === draft.goal)?.defaultSplit
  const perso = draft.split === 'perso'
  const total = (draft.splitProteins ?? 0) + (draft.splitCarbs ?? 0) + (draft.splitFats ?? 0)

  /**
   * Passer en « personnalisée » recopie la repartition en cours dans les trois
   * champs. Les laisser vides obligerait a tout ressaisir pour deplacer cinq
   * points, et personne ne connait par coeur celle qu'il vient de quitter.
   */
  const choisir = (code: string) => {
    if (code !== 'perso') {
      onPatch({ split: code === '' ? null : (code as SplitCode) })
      return
    }
    const depart =
      draft.splitProteins !== null
        ? null
        : (estimated?.split ?? splitOf(draft.split ?? proposee ?? 'equilibre'))
    onPatch({
      split: 'perso',
      ...(depart
        ? { splitProteins: depart.proteins, splitCarbs: depart.carbs, splitFats: depart.fats }
        : {}),
    })
  }

  return (
    <div className="card">
      <h2 className="card__title">Répartition</h2>
      <SelectField
        label="Répartition des macros"
        value={draft.split ?? ''}
        onChange={choisir}
        placeholder={
          proposee
            ? `Celle de l’objectif — ${MACRO_SPLITS.find((s) => s.code === proposee)?.label}`
            : 'Celle de l’objectif'
        }
        options={MACRO_SPLITS.map((s) => ({
          value: s.code,
          label: s.split
            ? `${s.label} — ${s.split.proteins}/${s.split.carbs}/${s.split.fats}`
            : s.label,
        }))}
        hint="Protéines / glucides / lipides, en part de l’énergie. Changer de répartition ne change pas la cible en kcal."
      />

      {perso && (
        <>
          <div className="form profile-split">
            <NumberField
              label="Protéines"
              value={draft.splitProteins}
              onChange={(v) => onPatch({ splitProteins: v })}
              min={0}
              max={100}
              suffix="%"
            />
            <NumberField
              label="Glucides"
              value={draft.splitCarbs}
              onChange={(v) => onPatch({ splitCarbs: v })}
              min={0}
              max={100}
              suffix="%"
            />
            <NumberField
              label="Lipides"
              value={draft.splitFats}
              onChange={(v) => onPatch({ splitFats: v })}
              min={0}
              max={100}
              suffix="%"
            />
          </div>

          {/* Le total est indicatif, jamais bloquant : ramener a 100 est un
              calcul, pas une decision, et il se fait des deux cotes du reseau. */}
          <p className={total === 100 ? 'status status--ok' : 'status status--warn'}>
            Total : {total} %
            {total !== 100 && estimated !== null && (
              <>
                {' '}— ramené à {estimated.split.proteins}/{estimated.split.carbs}/
                {estimated.split.fats}
              </>
            )}
          </p>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ce que ca donne
// ---------------------------------------------------------------------------

function TargetsCard({
  estimated,
  draft,
  missing,
  kcal,
  onPatch,
}: {
  readonly estimated: Targets | null
  readonly draft: Draft
  readonly missing: string
  readonly kcal: number | null
  readonly onPatch: (changes: Partial<Draft>) => void
}) {
  const manual = draft.kcalTarget !== null

  return (
    <div className="card">
      <h2 className="card__title">Ma cible</h2>

      {estimated === null && !manual && (
        <p className="card__lead">
          Il manque encore {missing} pour estimer un objectif. Tu peux aussi entrer directement une
          cible plus bas.
        </p>
      )}

      {estimated !== null && (
        <>
          {/* Le detail du calcul, pas seulement son resultat. */}
          <dl className="kv profile-steps">
            <dt>Métabolisme de base</dt>
            <dd>{kcalFr(estimated.bmr)} kcal</dd>
            <dt>Dépense estimée</dt>
            <dd>{kcalFr(estimated.tdee)} kcal</dd>
            <dt>Après objectif</dt>
            <dd>{kcalFr(estimated.kcal)} kcal</dd>
          </dl>

          {estimated.weeksToTarget !== null && estimated.targetDate !== null && (
            <p className="profile-eta">
              <Icon name="ui-calendar" size={16} className="icon--inline" />{' '}
              {estimated.kgToTarget?.toLocaleString('fr-FR')} kg en {estimated.weeksToTarget}{' '}
              semaines, soit vers le {dateFr(estimated.targetDate)}.
            </p>
          )}

          {estimated.capped && (
            <p className="status status--warn">
              <Icon name="ui-alert" size={16} className="icon--inline" /> L’allure demandée creusait
              un écart de plus de 25 % de ta dépense. Elle a été ramenée à cette limite.
            </p>
          )}

          {estimated.floored && (
            <p className="status status--warn">
              <Icon name="ui-alert" size={16} className="icon--inline" /> Le calcul descendait sous
              le seuil d’un régime non supervisé : la cible a été relevée à{' '}
              {kcalFr(estimated.kcal)} kcal.
            </p>
          )}

          {estimated.kgToTarget !== null &&
            estimated.kgToTarget > 0 &&
            estimated.weeksToTarget === null && (
              <p className="status status--warn">
                <Icon name="ui-alert" size={16} className="icon--inline" /> À ce réglage, la cible ne
                se rapproche pas : l’apport retenu ne va pas dans la direction du poids visé.
              </p>
            )}


          {/* Memes pictogrammes que le calendrier et la fiche ingredient : trois
              dessins differents pour la meme chose obligeraient a réapprendre
              le code couleur a chaque ecran. */}
          <ul className="profile-macros">
            {([
              ['proteins', 'Protéines', estimated.proteins],
              ['carbs', 'Glucides', estimated.carbs],
              ['fats', 'Lipides', estimated.fats],
            ] as const).map(([key, label, macro]) => (
              <li key={key}>
                <NutrientLabel nutrient={key} label={label} />
                <span className="profile-macros__value">
                  {kcalFr(macro.grams)} g · {macro.percent} %
                  {key === 'proteins' && (
                    // Les proteines se jugent au poids du corps, pas en part de
                    // l'energie : 25 % ne veut rien dire sans savoir de quoi.
                    <span className="profile-macros__per-kg">
                      {estimated.proteinsPerKg.toLocaleString('fr-FR', {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{' '}
                      g/kg
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          {estimated.lowProteins && (
            <p className="status status--warn">
              <Icon name="ui-alert" size={16} className="icon--inline" /> Moins de{' '}
              {MIN_PROTEINS_PER_KG.toLocaleString('fr-FR')} g de protéines par kilo, en déficit :
              c’est la masse musculaire qui paie en premier.
            </p>
          )}

          {estimated.lowFats && (
            <p className="status status--warn">
              <Icon name="ui-alert" size={16} className="icon--inline" /> Moins de{' '}
              {MIN_FAT_PERCENT} % de lipides : en dessous, l’apport ne couvre plus les besoins
              hormonaux et l’absorption des vitamines A, D, E et K.
            </p>
          )}
        </>
      )}

      <NumberField
        label="Cible personnalisée"
        value={draft.kcalTarget}
        onChange={(v) => onPatch({ kcalTarget: v })}
        min={800}
        max={8000}
        suffix="kcal"
        hint={
          manual
            ? 'Cette valeur remplace l’estimation. Vide-la pour revenir au calcul.'
            : 'Facultatif. Si un professionnel t’a donné un chiffre, entre-le : il l’emportera sur l’estimation.'
        }
      />

      {kcal !== null && (
        <p className="profile-final">
          Objectif retenu : <strong>{kcalFr(kcal)} kcal par jour</strong>
          {manual && ' (saisi à la main)'}
        </p>
      )}

      <p className="field__hint">
        Estimation statistique (Mifflin-St Jeor), pas un avis médical. Elle ignore la composition
        corporelle, les traitements, la grossesse et l’allaitement ; un écart de 10 à 15 % avec la
        dépense réelle est normal.
      </p>
    </div>
  )
}
