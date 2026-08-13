/**
 * Le pied fixe : reconnaitre les limites, puis enregistrer.
 *
 * LA CASE BLOQUE, MAIS UNE SEULE FOIS. Elle ne bloque que la PREMIERE
 * ecriture, et seulement s'il y a une cible a reconnaitre :
 *
 *   - deja reconnu (`ackAt` non nul) : rien ne bloque, la case reste cochee
 *     avec sa date ;
 *   - jamais reconnu ET une cible existe : bloque. C'est le seul cas ;
 *   - jamais reconnu ET aucune cible : ne bloque pas. Faire reconnaitre les
 *     limites d'un calcul qui n'a pas eu lieu serait du theatre, et ce cas
 *     couvre celui qui vient seulement regler le nombre de mangeurs.
 *
 * LE BOUTON N'EST JAMAIS `disabled`, il est `aria-disabled`. Un vrai
 * `disabled` le sort de l'ordre de tabulation : un lecteur d'ecran ne le
 * rencontre jamais, donc n'apprend jamais pourquoi rien ne part. Ici le tap
 * n'envoie pas, il fait defiler le bloc des limites au centre et met la mise
 * au point sur la case. Et la ligne d'etat dit la raison AVANT le tap.
 *
 * LA CASE VIT DANS LE PIED, pas dans le bloc ambre. C'est ce que montre le
 * mockup, et c'est ce qui dissout le probleme du bouton grise dont la cause
 * est a six cents pixels plus haut : la case et le bouton sont dans le meme
 * bloc collant, toujours visibles ensemble.
 */

import { useRef } from 'react'

import { Icon } from '../../icons/index.js'

const dateFr = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

export function PiedEnregistrer({
  ackAt,
  onAck,
  bloquant,
  onSubmit,
  enCours,
  erreur,
  modifie,
  enregistre,
  cibleLimites,
}: {
  /** Horodatage de la reconnaissance, ou `null`. */
  readonly ackAt: string | null
  readonly onAck: (reconnu: boolean) => void
  /** Vrai s'il y a une cible a reconnaitre. Sans cible, la case ne bloque pas. */
  readonly bloquant: boolean
  readonly onSubmit: () => void
  readonly enCours: boolean
  readonly erreur: string | null
  readonly modifie: boolean
  readonly enregistre: boolean
  /** Identifiant du bloc de limites, vers lequel renvoyer au refus. */
  readonly cibleLimites: string
}) {
  const caseRef = useRef<HTMLInputElement>(null)
  const reconnu = ackAt !== null
  const retenu = bloquant && !reconnu

  const cliquer = () => {
    if (enCours) return
    if (retenu) {
      // Plutot que de ne rien faire : montrer la cause, et y poser la main.
      document.getElementById(cibleLimites)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      caseRef.current?.focus()
      return
    }
    onSubmit()
  }

  return (
    <div className="pied-reglages">
      {erreur !== null && (
        <p className="pied-reglages__erreur" role="alert">
          {erreur}
        </p>
      )}

      <label className="pied-reglages__case">
        <input
          ref={caseRef}
          type="checkbox"
          checked={reconnu}
          onChange={(event) => onAck(event.target.checked)}
        />
        <span>
          J’ai lu et compris ces limites
          {reconnu && <small> · reconnu le {dateFr(ackAt)}</small>}
        </span>
      </label>

      <p className="pied-reglages__etat" aria-live="polite">
        {retenu
          ? 'Coche la case pour enregistrer.'
          : enregistre
            ? 'Enregistré.'
            : modifie
              ? 'Modifications non enregistrées'
              : ''}
      </p>

      <button
        type="button"
        className={`button ${enregistre ? 'button--saved' : 'button--primary'} button--block`}
        aria-disabled={retenu || enCours}
        onClick={cliquer}
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
