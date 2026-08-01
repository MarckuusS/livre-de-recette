import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router'

import { useTheme } from './lib/theme.js'
import { DiagnosticScreen } from './screens/DiagnosticScreen.js'
import { IngredientDetailScreen, IngredientsScreen } from './screens/IngredientsScreen.js'
import { PantryScreen } from './screens/PantryScreen.js'
import { RecipeDetailScreen, RecipesScreen } from './screens/RecipesScreen.js'
import { ActivityScreen } from './screens/ActivityScreen.js'
import { ShoppingScreen } from './screens/ShoppingScreen.js'
import { WeekScreen } from './screens/WeekScreen.js'

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

const TITLES: Array<[RegExp, string]> = [
  [/^\/ingredients\/\d+$/, 'Ingrédient'],
  [/^\/ingredients$/, 'Ingrédients'],
  [/^\/recettes\/\d+$/, 'Recette'],
  [/^\/recettes$/, 'Recettes'],
  [/^\/semaine$/, 'Ma semaine'],
  [/^\/courses$/, 'Liste de courses'],
  [/^\/frigo$/, 'Frigo & cellier'],
  [/^\/diagnostic$/, 'Diagnostic'],
  [/^\/activite$/, 'Compte & activité'],
]

export function App() {
  const { isDark, toggle } = useTheme()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'Livre de recettes'
  // Les vues de detail sont empilees sur leur liste : elles ont besoin d'un
  // retour visible, la barre d'onglets ramenant a la racine de l'onglet.
  const isDetail =
    /^\/(ingredients|recettes)\/\d+$/.test(pathname) ||
    pathname === '/diagnostic' ||
    pathname === '/activite'

  return (
    <div className="app">
      <header className="app-header">
        {isDetail ? (
          <button type="button" className="icon-button" onClick={() => void navigate(-1)} aria-label="Retour">
            ‹
          </button>
        ) : (
          <span className="icon-button icon-button--spacer" aria-hidden="true" />
        )}

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
          <NavLink to="/activite" className="icon-button" aria-label="Compte et activité">
            ⋯
          </NavLink>
        </div>
      </header>

      <main className="app-main">
        <Routes>
          <Route path="/" element={<ShoppingScreen />} />
          <Route path="/ingredients" element={<IngredientsScreen />} />
          <Route path="/ingredients/:id" element={<IngredientDetailScreen />} />
          <Route path="/recettes" element={<RecipesScreen />} />
          <Route path="/recettes/:id" element={<RecipeDetailScreen />} />
          <Route path="/semaine" element={<WeekScreen />} />
          <Route path="/courses" element={<ShoppingScreen />} />
          <Route path="/frigo" element={<PantryScreen />} />
          <Route path="/diagnostic" element={<DiagnosticScreen />} />
          <Route path="/activite" element={<ActivityScreen />} />
          <Route
            path="*"
            element={
              <section className="screen">
                <div className="card">
                  <h2 className="card__title">Page introuvable</h2>
                  <p className="card__lead">Cette adresse ne correspond à rien.</p>
                </div>
              </section>
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
