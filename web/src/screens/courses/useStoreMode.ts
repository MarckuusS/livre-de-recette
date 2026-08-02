/**
 * Mode « courses » — l'ecran reste allume et les cibles grossissent.
 *
 * Le probleme est concret : on avance dans les rayons une main sur le chariot,
 * on coche un article toutes les deux minutes, et entre deux l'ecran s'eteint.
 * Il faut alors deverrouiller le telephone a chaque ligne. Le desktop n'a
 * evidemment jamais eu ce souci — c'est une fonction que seule la version
 * mobile peut avoir.
 *
 * Le mode vit dans l'URL (`?mode=courses`) et non dans un `useState` : en
 * magasin, iOS decharge volontiers l'onglet en arriere-plan et le recharge au
 * retour. Un etat local disparaitrait avec lui, au pire moment.
 *
 * Ce que l'API Wake Lock permet reellement, verifie avant d'ecrire ceci :
 *   - elle existe depuis Safari iOS 16.4, Chrome 84 et Firefox 126 ; ailleurs
 *     `navigator.wakeLock` est absent, d'ou la detection explicite ;
 *   - le verrou est relache par le systeme des que l'onglet passe en
 *     arriere-plan, et n'est PAS repris tout seul au retour — d'ou l'ecoute de
 *     `visibilitychange` ;
 *   - le refus n'a rien d'exceptionnel (economiseur de batterie actif) : il ne
 *     doit produire aucun message d'erreur, seulement un mode un peu moins
 *     confortable. Les grandes cibles, elles, fonctionnent toujours.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

const PARAM = 'mode'
const VALUE = 'courses'

export interface StoreMode {
  readonly active: boolean
  readonly toggle: () => void
  /** Vrai quand l'ecran est effectivement maintenu allume. */
  readonly screenAwake: boolean
  /** Faux sur un navigateur sans Wake Lock : l'interface ne promet alors rien. */
  readonly supported: boolean
}

export function useStoreMode(): StoreMode {
  const [searchParams, setSearchParams] = useSearchParams()
  const active = searchParams.get(PARAM) === VALUE
  const [screenAwake, setScreenAwake] = useState(false)

  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator

  const toggle = useCallback(() => {
    // On repart des parametres existants : la semaine consultee (`?semaine=`)
    // ne doit pas sauter parce qu'on active le mode courses.
    const next = new URLSearchParams(searchParams)
    if (active) next.delete(PARAM)
    else next.set(PARAM, VALUE)
    // `replace` : le mode n'est pas une etape de navigation, le bouton Retour
    // du telephone doit ramener a l'ecran precedent, pas au meme ecran en
    // mode normal.
    setSearchParams(next, { replace: true })
  }, [active, searchParams, setSearchParams])

  const sentinel = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!active || !supported) {
      setScreenAwake(false)
      return
    }

    let abandoned = false

    const acquire = async () => {
      // Un verrou encore valide suffit : en redemander un second laisserait le
      // premier orphelin, impossible a relacher a la sortie du mode.
      if (sentinel.current && !sentinel.current.released) return
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (abandoned) {
          void lock.release()
          return
        }
        sentinel.current = lock
        setScreenAwake(true)
        lock.addEventListener('release', () => setScreenAwake(false))
      } catch {
        // Refus du systeme : le mode reste utile pour ses grandes cibles.
        setScreenAwake(false)
      }
    }

    void acquire()

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      abandoned = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void sentinel.current?.release()
      sentinel.current = null
      setScreenAwake(false)
    }
  }, [active, supported])

  return { active, toggle, screenAwake, supported }
}
