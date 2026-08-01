import { NavLink, Route, Routes, useLocation } from 'react-router'

import { useTheme } from './lib/theme.js'
import { DiagnosticScreen } from './screens/DiagnosticScreen.js'
import { PlaceholderScreen } from './screens/PlaceholderScreen.js'
import { ShoppingScreen } from './screens/ShoppingScreen.js'

/**
 * Les 5 onglets reprennent ceux du desktop, dans le meme ordre. « Calendrier »
 * devient « Semaine » : sur un ecran de telephone on affiche un jour a la fois,
 * et le mot decrit mieux ce qu'on y trouve.
 */
export const TABS = [
  { to: '/ingredients', icon: '🥕', label: 'Ingrédients' },
  { to: '/recettes', icon: '🍽', label: 'Recettes' },
  { to: '/semaine', icon: '📅', label: 'Semaine' },
  { to: '/courses', icon: '🛒', label: 'Courses' },
  { to: '/frigo', icon: '🥫', label: 'Frigo' },
] as const

const TITLES: Record<string, string> = {
  '/ingredients': 'Ingrédients',
  '/recettes': 'Recettes',
  '/semaine': 'Ma semaine',
  '/courses': 'Liste de courses',
  '/frigo': 'Frigo & cellier',
  '/diagnostic': 'Diagnostic',
}

export function App() {
  const { isDark, toggle } = useTheme()
  const { pathname } = useLocation()
  const title = TITLES[pathname] ?? 'Livre de recettes'

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-header__title">{title}</h1>
        <div className="app-header__actions">
          <button
            type="button"
            className="icon-button"
            onClick={toggle}
            aria-label={isDark ? 'Passer en thème clair' : 'Passer en thème sombre'}
          >
            {isDark ? '☀️' : '🌙'}
          </button>
          <NavLink to="/diagnostic" className="icon-button" aria-label="Diagnostic">
            ⋯
          </NavLink>
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route
            path="/"
            element={
              <PlaceholderScreen
                title="Bienvenue"
                lead="La coquille de l'application est en place et installable sur ton téléphone."
                items={[
                  'Les écrans arrivent un par un, en commençant par la liste de courses.',
                  'Le thème suit celui de ton téléphone, et se force avec le bouton en haut.',
                  "L'onglet ⋯ affiche l'état de la base et de l'API.",
                ]}
              />
            }
          />
          <Route
            path="/ingredients"
            element={
              <PlaceholderScreen
                title="Ingrédients"
                lead="Ta bibliothèque personnelle, avec la recherche et les fiches détaillées."
                items={['58 ingrédients dans ta bibliothèque', '4 177 en catalogue CIQUAL et OpenFoodFacts']}
              />
            }
          />
          <Route
            path="/recettes"
            element={
              <PlaceholderScreen
                title="Recettes"
                lead="Tes recettes, leur composition, leur nutrition et leur coût."
                items={['6 recettes', '56 lignes d’ingrédients']}
              />
            }
          />
          <Route
            path="/semaine"
            element={
              <PlaceholderScreen
                title="Ma semaine"
                lead="Le planning des repas, un jour à la fois."
                items={['5 créneaux par jour', 'Navigation par semaine ISO']}
              />
            }
          />
          <Route path="/courses" element={<ShoppingScreen />} />
          <Route
            path="/frigo"
            element={
              <PlaceholderScreen
                title="Frigo & cellier"
                lead="Ce que tu as en stock, et ce qui périme bientôt."
                items={['3 articles en stock']}
              />
            }
          />
          <Route path="/diagnostic" element={<DiagnosticScreen />} />
          <Route
            path="*"
            element={
              <PlaceholderScreen title="Page introuvable" lead="Cette adresse ne correspond à rien." items={[]} />
            }
          />
        </Routes>
      </main>

      <nav className="tabbar" aria-label="Navigation principale">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `tabbar__item${isActive ? ' tabbar__item--active' : ''}`}
          >
            <span className="tabbar__icon" aria-hidden="true">
              {tab.icon}
            </span>
            <span className="tabbar__label">{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
