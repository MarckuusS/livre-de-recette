/**
 * Le pied fixe : enregistrer.
 *
 * IL A PORTE UNE CASE « J'ai lu et compris ces limites », retiree le
 * 2026-08-13. L'encart d'avertissement, lui, RESTE : il sert a informer, ce
 * qui a une valeur ; la case ne servait qu'a faire cliquer, ce qui n'en a
 * aucune ici. Une reconnaissance qu'on obtient d'un reflexe en deux passages
 * ne protege personne, et elle bloquait l'enregistrement de reglages qui
 * n'ont rien a voir avec des limites de sante.
 *
 * Le bouton reste `aria-disabled` plutot que `disabled` pendant l'envoi : un
 * `disabled` le sort de l'ordre de tabulation, et un lecteur d'ecran ne le
 * rencontre alors plus du tout.
 */

import { Icon } from '../../icons/index.js'

export function PiedEnregistrer({
  onSubmit,
  enCours,
  erreur,
  modifie,
  enregistre,
}: {
  readonly onSubmit: () => void
  readonly enCours: boolean
  readonly erreur: string | null
  readonly modifie: boolean
  readonly enregistre: boolean
}) {
  return (
    <div className="pied-reglages">
      {erreur !== null && (
        <p className="pied-reglages__erreur" role="alert">
          {erreur}
        </p>
      )}

      <p className="pied-reglages__etat" aria-live="polite">
        {enregistre ? 'Enregistré.' : modifie ? 'Modifications non enregistrées' : ''}
      </p>

      <button
        type="button"
        className={`button ${enregistre ? 'button--saved' : 'button--primary'} button--block`}
        aria-disabled={enCours}
        onClick={() => {
          if (!enCours) onSubmit()
        }}
      >
        {enregistre ? (
          <>
            <Icon name="ui-check" size={16} className="icon--inline" /> Enregistré
          </>
        ) : enCours ? (
          'Enregistrement…'
        ) : (
          'Enregistrer mes objectifs'
        )}
      </button>
    </div>
  )
}
