/**
 * Message bref avec « Annuler » — portage d'UndoToast.qml.
 *
 * Ce composant est la reponse au probleme le plus concret du tactile : une
 * suppression au doigt part trop vite. Plutot que d'imposer une confirmation
 * avant CHAQUE suppression — cinq taps pour vider une journee de calendrier —
 * on agit tout de suite et on laisse six secondes pour revenir en arriere.
 * ConfirmDialog reste pour l'irreversible (supprimer une recette et ses repas
 * planifies) ; le toast couvre tout le reste.
 *
 * Six secondes et non cinq comme sur le desktop : la cible a atteindre fait un
 * aller-retour reseau, et le telephone se lit a bout de bras.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

import '../styles/components.css'

const DEFAULT_DURATION_MS = 6000

export interface ToastOptions {
  readonly message: string
  /** Libelle du bouton d'action. Sans lui, le message est simplement informatif. */
  readonly actionLabel?: string | undefined
  readonly onAction?: (() => void) | undefined
  readonly durationMs?: number | undefined
}

export interface ToastApi {
  readonly show: (options: ToastOptions) => void
  /** Raccourci du cas courant : « X supprimé » + bouton « Annuler ». */
  readonly showUndo: (message: string, onUndo: () => void) => void
  readonly dismiss: () => void
}

/**
 * Valeur par defaut volontairement inoffensive.
 *
 * Un `throw` serait plus visible en developpement, mais ferait tomber
 * l'application entiere en production si quelqu'un oublie le fournisseur — or
 * un toast est du confort, jamais une information vitale. L'avertissement
 * console suffit a le reperer pendant le developpement.
 */
const FALLBACK: ToastApi = {
  show: ({ message }) =>
    console.warn(`[Toast] <ToastProvider> absent : « ${message} » n'a pas pu être affiché.`),
  showUndo: (message) =>
    console.warn(`[Toast] <ToastProvider> absent : « ${message} » n'a pas pu être affiché.`),
  dismiss: () => {},
}

const ToastContext = createContext<ToastApi>(FALLBACK)

export const useToast = (): ToastApi => useContext(ToastContext)

interface ToastState {
  readonly id: number
  readonly message: string
  readonly actionLabel: string | null
  readonly onAction: (() => void) | null
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const [duration, setDuration] = useState(DEFAULT_DURATION_MS)
  const nextId = useRef(0)

  const dismiss = useCallback(() => setToast(null), [])

  const show = useCallback((options: ToastOptions) => {
    nextId.current += 1
    setDuration(options.durationMs ?? DEFAULT_DURATION_MS)
    // Un seul message a la fois, comme sur le desktop : empiler des toasts sur
    // 375 px recouvrirait la barre d'onglets et le contenu utile.
    setToast({
      id: nextId.current,
      message: options.message,
      actionLabel: options.actionLabel ?? null,
      onAction: options.onAction ?? null,
    })
  }, [])

  const showUndo = useCallback(
    (message: string, onUndo: () => void) =>
      show({ message, actionLabel: 'Annuler', onAction: onUndo }),
    [show],
  )

  // La minuterie depend de `toast.id` : un nouveau message relance six
  // secondes pleines au lieu d'heriter du reliquat du precedent.
  const currentId = toast?.id
  useEffect(() => {
    if (currentId === undefined) return
    const timer = setTimeout(() => setToast(null), duration)
    return () => clearTimeout(timer)
  }, [currentId, duration])

  const api = useMemo<ToastApi>(() => ({ show, showUndo, dismiss }), [show, showUndo, dismiss])

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast !== null &&
        createPortal(
          <div className="toast" role="status" aria-live="polite">
            <span className="toast__message">{toast.message}</span>
            {toast.actionLabel && (
              <button
                type="button"
                className="toast__action"
                onClick={() => {
                  toast.onAction?.()
                  setToast(null)
                }}
              >
                {toast.actionLabel}
              </button>
            )}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  )
}
