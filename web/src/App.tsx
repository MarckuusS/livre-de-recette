import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router'

import { ToastProvider } from './components/Toast.js'
import { useTheme } from './lib/theme.js'
import { IngredientDetailScreen, IngredientsScreen } from './screens/IngredientsScreen.js'
import { PantryScreen } from './screens/PantryScreen.js'
import { RecipeDetailScreen, RecipesScreen } from './screens/RecipesScreen.js'
import { ActivityScreen } from './screens/ActivityScreen.js'
import { SettingsScreen } from './screens/SettingsScreen.js'
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

/**
 * Titres de l'en-tete, testes DANS L'ORDRE : le premier motif qui accroche
 * gagne. Les vues de creation viennent donc avant les vues de detail, sinon
 * `/ingredients/nouveau` ne serait jamais reconnu comme une creation.
 *
 * Le segment est `[^/]+` et non `\d+` : les identifiants ne sont pas les seules
 * valeurs possibles, et un motif trop strict laissait « Livre de recettes »
 * s'afficher au-dessus d'un formulaire de creation.
 */
const TITLES: Array<[RegExp, string]> = [
  [/^\/ingredients\/nouveau$/, 'Nouvel ingrédient'],
  [/^\/ingredients\/[^/]+$/, 'Ingrédient'],
  [/^\/ingredients$/, 'Ingrédients'],
  [/^\/recettes\/[^/]+$/, 'Recette'],
  [/^\/recettes$/, 'Recettes'],
  [/^\/semaine$/, 'Ma semaine'],
  [/^\/courses$/, 'Liste de courses'],
  [/^\/frigo$/, 'Frigo & cellier'],
  [/^\/(parametres|diagnostic)$/, 'Paramètres'],
  [/^\/activite$/, 'Journal d’activité'],
]

/** Les vues empilees sur une liste : elles ont besoin d'un retour visible. */
const STACKED = /^\/(ingredients|recettes)\/[^/]+$|^\/(parametres|diagnostic|activite)$/

export function App() {
  const { isDark, toggle } = useTheme()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'Livre de recettes'
  const isStacked = STACKED.test(pathname)

  return (
    // Le fournisseur enveloppe TOUT l'arbre : sans lui, `useToast()` retombe
    // sur un repli silencieux et chaque « Annuler » proposE apres une
    // suppression disparait sans que rien ne le signale.
    <ToastProvider>
      <div className="app">
        <header className="app-header">
          {isStacked ? (
            <button
              type="button"
              className="icon-button"
              onClick={() => void navigate(-1)}
              aria-label="Retour"
            >
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
            <NavLink to="/parametres" className="icon-button" aria-label="Paramètres">
              ⚙️
            </NavLink>
          </div>
        </header>

        <main className="app-main">
          <Routes>
            <Route path="/" element={<ShoppingScreen />} />
            <Route path="/ingredients" element={<IngredientsScreen />} />
            {/* Un seul motif, `:id`, y compris pour « /ingredients/nouveau ».
                L'ecran reconnait lui-meme ce segment et ouvre un formulaire
                vide. Une route litterale separee paraissait plus explicite,
                mais elle ne fournit AUCUN parametre : l'ecran ne voyait plus
                « nouveau » et repondait « Ingrédient introuvable ». */}
            <Route path="/ingredients/:id" element={<IngredientDetailScreen />} />
            <Route path="/recettes" element={<RecipesScreen />} />
            <Route path="/recettes/:id" element={<RecipeDetailScreen />} />
            <Route path="/semaine" element={<WeekScreen />} />
            <Route path="/courses" element={<ShoppingScreen />} />
            <Route path="/frigo" element={<PantryScreen />} />
            <Route path="/parametres" element={<SettingsScreen />} />
            {/* Ancienne adresse : elle a pu etre mise en favori, et un lien
                mort au moment ou l'on cherche a diagnostiquer serait ironique. */}
            <Route path="/diagnostic" element={<SettingsScreen />} />
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
    </ToastProvider>
  )
}
