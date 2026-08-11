/**
 * Profil alimentaire et sportif — Parametres → Mon profil.
 *
 * L'ecran repond a une question : « combien pour MOI, aujourd'hui ». Il ne
 * donne pas d'avis medical, et il le dit.
 *
 * TROIS PARTIS PRIS D'INTERFACE :
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
 *   3. Rien n'est obligatoire. Un profil se remplit par etapes ; l'ecran
 *      s'enregistre a tout moment et dit simplement ce qui manque encore pour
 *      que la cible apparaisse.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  ACTIVITY_LEVELS,
  WEIGHT_GOALS,
  estimateTargets,
  type ActivityCode,
  type GoalCode,
  type Sex,
} from '@livre/shared'

import { NumberField, SelectField } from '../components/Field.js'
import { NutrientLabel } from '../components/NutrientLabel.js'
import { ErrorState, LoadingRows } from '../components/States.js'
import { useToast } from '../components/Toast.js'
import { Icon } from '../icons/index.js'
import { useProfile, useSaveProfile } from '../lib/queries.js'
import '../styles/profile.css'

interface Draft {
  sex: Sex | null
  birthYear: number | null
  heightCm: number | null
  weightKg: number | null
  activity: ActivityCode | null
  goal: GoalCode | null
  kcalTarget: number | null
  eaters: number
}

/** Comme partout ailleurs : « 2 759 » et non « 2759 ». */
const kcalFr = (value: number) => value.toLocaleString('fr-FR')

const EMPTY: Draft = {
  sex: null, birthYear: null, heightCm: null, weightKg: null,
  activity: null, goal: null, kcalTarget: null, eaters: 1,
}

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
      kcalTarget: profile.kcalTarget,
      eaters,
    })
    setLoaded(true)
  }, [query.data, loaded])

  const patch = (changes: Partial<Draft>) => setDraft((d) => ({ ...d, ...changes }))

  const estimated = useMemo(() => estimateTargets(draft), [draft])
  /** La cible saisie a la main l'emporte sur l'estimation, si elle existe. */
  const kcal = draft.kcalTarget ?? estimated?.kcal ?? null

  const missing = useMemo(() => {
    const labels: Record<string, string> = {
      sex: 'le sexe', birthYear: 'l’année de naissance', heightCm: 'la taille',
      weightKg: 'le poids', activity: 'le niveau d’activité', goal: 'l’objectif',
    }
    return Object.entries(labels)
      .filter(([key]) => draft[key as keyof Draft] === null)
      .map(([, label]) => label)
  }, [draft])

  // « a, b et c » : une enumeration lue par un humain, pas un tableau imprime.
  const missingText = useMemo(() => {
    if (missing.length <= 1) return missing.join('')
    return `${missing.slice(0, -1).join(', ')} et ${missing[missing.length - 1]}`
  }, [missing])

  if (query.isPending) return <section className="screen"><LoadingRows rows={5} /></section>
  if (query.isError) {
    return (
      <section className="screen">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </section>
    )
  }

  const submit = () => {
    void save.mutateAsync({ ...draft }).then(() => toast.show({ message: 'Profil enregistré.' }))
  }

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
            onChange={(v) => patch({ sex: v === '' ? null : (v as Sex) })}
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
        <div className="form">
          <SelectField
            label="Niveau d’activité"
            value={draft.activity ?? ''}
            onChange={(v) => patch({ activity: v === '' ? null : (v as ActivityCode) })}
            placeholder="Non renseigné"
            options={ACTIVITY_LEVELS.map((l) => ({ value: l.code, label: `${l.label} — ${l.hint}` }))}
            hint="Décris ta semaine ENTIÈRE, sport compris. L’erreur la plus fréquente est d’ajouter mentalement le sport à un niveau qui le compte déjà."
          />
          <SelectField
            label="Objectif"
            value={draft.goal ?? ''}
            onChange={(v) => patch({ goal: v === '' ? null : (v as GoalCode) })}
            placeholder="Non renseigné"
            options={WEIGHT_GOALS.map((g) => ({ value: g.code, label: `${g.label} — ${g.hint}` }))}
          />
        </div>
      </div>

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

function TargetsCard({
  estimated,
  draft,
  missing,
  kcal,
  onPatch,
}: {
  estimated: ReturnType<typeof estimateTargets>
  draft: Draft
  missing: string
  kcal: number | null
  onPatch: (changes: Partial<Draft>) => void
}) {
  const manual = draft.kcalTarget !== null

  return (
    <div className="card">
      <h2 className="card__title">Mon objectif</h2>

      {estimated === null && !manual && (
        <p className="card__lead">
          Il manque encore {missing} pour estimer un objectif. Tu peux aussi entrer
          directement une cible plus bas.
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

          {estimated.floored && (
            <p className="status status--warn">
              <Icon name="ui-alert" size={16} className="icon--inline" /> Le calcul descendait sous
              le seuil d’un régime non supervisé : la cible a été relevée à {kcalFr(estimated.kcal)} kcal.
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
                </span>
              </li>
            ))}
          </ul>
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
