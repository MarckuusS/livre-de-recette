/**
 * Bascule clair / sombre.
 *
 * Trois etats, comme dans theme.css : 'system' (aucun attribut, on suit le
 * telephone), 'light', 'dark'. Le desktop n'avait que deux etats parce qu'il
 * n'avait pas de preference systeme a suivre ; sur mobile, la suivre par
 * defaut est le comportement attendu.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'

export const THEME_CHOICES: readonly { value: ThemeChoice; label: string }[] = [
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
  { value: 'system', label: 'Système' },
]

const STORAGE_KEY = 'theme'

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(choice: ThemeChoice): void {
  if (choice === 'system') delete document.documentElement.dataset['theme']
  else document.documentElement.dataset['theme'] = choice
  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, choice)
  } catch {
    /* navigation privee : le choix ne survivra pas au rechargement */
  }
}

/** Vrai si le rendu courant est sombre, preference systeme comprise. */
export function isDarkNow(choice: ThemeChoice): boolean {
  if (choice === 'dark') return true
  if (choice === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

// ---------------------------------------------------------------------------
// Un seul choix pour toute l'application
// ---------------------------------------------------------------------------

/**
 * Le choix vit au niveau du MODULE, pas dans un `useState` de composant.
 *
 * Il etait local, et tant qu'un seul bouton le manipulait ça tenait. Des que
 * les Reglages proposent le meme reglage, deux `useTheme()` cohabitent : le
 * second ecrit dans le DOM et dans localStorage, mais le premier garde son
 * ancienne valeur en memoire, si bien que l'icone de l'en-tete continue
 * d'afficher l'inverse de ce que l'ecran montre. `useSyncExternalStore` evite
 * d'avoir a envelopper l'application dans un fournisseur de contexte
 * supplementaire pour un seul booleen.
 */
let currentChoice: ThemeChoice = read()
const listeners = new Set<() => void>()

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getChoice = (): ThemeChoice => currentChoice

/** Pose le theme, partout a la fois. Exporte pour les tests et les reglages. */
export function setThemeChoice(choice: ThemeChoice): void {
  if (choice === currentChoice) return
  currentChoice = choice
  apply(choice)
  for (const listener of listeners) listener()
}

// Le script inline de index.html a deja pose `data-theme` avant le premier
// rendu, pour eviter l'eclair blanc. On rejoue `apply` malgre tout : il est
// idempotent, et il rattrape le cas ou ce script aurait ete retire.
apply(currentChoice)

export function useTheme() {
  const choice = useSyncExternalStore(subscribe, getChoice, getChoice)

  // Suit les changements systeme tant qu'aucun choix explicite n'est fait
  // (bascule automatique au coucher du soleil sur iOS).
  const [systemDark, setSystemDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  /**
   * Bascule rapide de l'en-tete : clair ou sombre, jamais 'system'.
   *
   * Ce bouton etait le SEUL acces au theme, et il ne connaissait que deux
   * valeurs : une fois touche, plus rien ne ramenait a la preference du
   * telephone, et le basculement automatique jour / nuit d'iOS etait perdu
   * definitivement. Le troisieme etat se choisit maintenant dans les Reglages,
   * ou il tient dans un libelle explicite plutot que dans un troisieme dessin
   * d'icone que personne ne saurait interpreter.
   */
  const toggle = useCallback(() => {
    setThemeChoice(isDarkNow(getChoice()) ? 'light' : 'dark')
  }, [])

  return {
    choice,
    setChoice: setThemeChoice,
    toggle,
    isDark: choice === 'system' ? systemDark : choice === 'dark',
  }
}
