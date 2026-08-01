import { useState, type FormEvent } from 'react'

import { ApiError, login } from '../lib/api.js'

/**
 * Ecran de connexion.
 *
 * Volontairement nu : un champ, un bouton. Il remplace la page de Cloudflare
 * Access, qui vivait sur une autre origine et sortait de l'application
 * installee — c'etait tout l'interet de la bascule.
 */
export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || password.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await login(password)
      setPassword('')
      onSuccess()
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Connexion impossible. Réessaie dans un instant.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <form className="card login__card" onSubmit={(e) => void submit(e)}>
        <h1 className="login__title">Livre de recettes</h1>
        <p className="card__lead">Cette application est privée.</p>

        <input
          type="password"
          className="search-field login__field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mot de passe"
          // `current-password` laisse le trousseau iOS proposer puis
          // enregistrer le mot de passe — sinon il faut le retaper a chaque
          // expiration de session.
          autoComplete="current-password"
          autoFocus
          enterKeyHint="go"
          disabled={busy}
          aria-label="Mot de passe"
          aria-invalid={error !== null}
        />

        {error && (
          <p className="status status--error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="button button--primary login__submit" disabled={busy || !password}>
          {busy ? 'Connexion…' : 'Entrer'}
        </button>
      </form>
    </div>
  )
}
