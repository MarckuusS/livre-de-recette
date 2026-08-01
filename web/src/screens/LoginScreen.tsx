import { useState, type FormEvent } from 'react'

import { ApiError, login, type SessionUser } from '../lib/api.js'

/**
 * Ecran de connexion.
 *
 * Deux champs : chacun son identifiant, pour que le journal d'activite puisse
 * dire qui a fait quoi. Les donnees, elles, restent communes.
 */
export function LoginScreen({ onSuccess }: { onSuccess: (user: SessionUser) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !username || !password) return
    setBusy(true)
    setError(null)
    try {
      const { user } = await login(username, password)
      setPassword('')
      onSuccess(user)
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
          type="text"
          className="search-field login__field"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Identifiant"
          // `username` permet au trousseau iOS d'associer les deux champs et
          // de proposer le bon couple a la connexion suivante.
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          autoFocus
          disabled={busy}
          aria-label="Identifiant"
        />

        <input
          type="password"
          className="search-field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Mot de passe"
          autoComplete="current-password"
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

        <button
          type="submit"
          className="button button--primary login__submit"
          disabled={busy || !username || !password}
        >
          {busy ? 'Connexion…' : 'Entrer'}
        </button>
      </form>
    </div>
  )
}
