/**
 * Bascule clair / sombre.
 *
 * Trois etats, comme dans theme.css : 'system' (aucun attribut, on suit le
 * telephone), 'light', 'dark'. Le desktop n'avait que deux etats parce qu'il
 * n'avait pas de preference systeme a suivre ; sur mobile, la suivre par
 * defaut est le comportement attendu.
 */

import { useCallback, useEffect, useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'

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

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read)

  useEffect(() => {
    apply(choice)
  }, [choice])

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

  const toggle = useCallback(() => {
    setChoice((c) => (isDarkNow(c) ? 'light' : 'dark'))
  }, [])

  return { choice, setChoice, toggle, isDark: choice === 'system' ? systemDark : choice === 'dark' }
}
