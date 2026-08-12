import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router'

import { ToastProvider } from './components/Toast.js'
import { Icon, type IconName } from './icons/index.js'
import { useTheme } from './lib/theme.js'
import { IconGalleryScreen } from './screens/IconGalleryScreen.js'
import { CustomIconsScreen } from './screens/CustomIconsScreen.js'
import { ProfileScreen } from './screens/ProfileScreen.js'
import { RayonsScreen } from './screens/RayonsScreen.js'
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
 *
 * `kicker` est le surtitre affiche au-dessus du grand titre de l'ecran. Il ne
 * paraphrase pas le titre — il dit ce que le titre ne peut pas dire, a savoir
 * ce qu'on vient chercher la. « Ingrédients » nomme, « Ce que je cuisine »
 * situe.
 */
export const TABS: ReadonlyArray<{
  to: string
  icon: IconName
  label: string
  kicker: string
}> = [
  { to: '/ingredients', icon: 'ui-basket', label: 'Ingrédients', kicker: 'Ce que je cuisine' },
  { to: '/recettes', icon: 'ui-utensils', label: 'Recettes', kicker: 'Mon répertoire' },
  // Le libelle d'onglet reste court — il dispose d'un cinquieme de la largeur.
  // Le grand titre de l'ecran, lui, vient de TITLES et peut respirer.
  { to: '/semaine', icon: 'ui-calendar', label: 'Semaine', kicker: 'Ce qui est prévu' },
  { to: '/courses', icon: 'ui-cart', label: 'Courses', kicker: 'Ce qu’il me faut' },
  { to: '/frigo', icon: 'ui-fridge', label: 'Frigo', kicker: 'Ce que j’ai déjà' },
]

/**
 * Titres de l'en-tete, testes DANS L'ORDRE : le premier motif qui accroche
 * gagne. Les vues de creation viennent donc avant les vues de detail, sinon
 * `/ingredients/nouveau` ne serait jamais reconnu comme une creation.
 *
 * Le segment est `[^/]+` et non `\d+` : les identifiants ne sont pas les seules
 * valeurs possibles, et un motif trop strict laissait « Prandia »
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
  [/^\/parametres\/profil$/, 'Mon profil'],
  [/^\/parametres\/icones$/, 'Jeu d’icônes'],
  [/^\/parametres\/rayons$/, 'Rayons'],
  [/^\/parametres\/mes-icones$/, 'Mes icônes'],
  [/^\/(parametres|diagnostic)$/, 'Paramètres'],
  [/^\/activite$/, 'Journal d’activité'],
]

/** Les vues empilees sur une liste : elles ont besoin d'un retour visible. */
const STACKED =
  /^\/(ingredients|recettes)\/[^/]+$|^\/(parametres|diagnostic|activite)$|^\/parametres\/(profil|icones|rayons|mes-icones)$/

export function App() {
  const { isDark, toggle } = useTheme()
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'Prandia'
  const isStacked = STACKED.test(pathname)
  // Le surtitre n'existe que pour les cinq onglets. Une vue empilee garde son
  // titre dans la barre, a cote du bouton retour qui a besoin d'un ancrage.
  const kicker = TABS.find((tab) => tab.to === pathname)?.kicker

  return (
    // Le fournisseur enveloppe TOUT l'arbre : sans lui, `useToast()` retombe
    // sur un repli silencieux et chaque « Annuler » proposE apres une
    // suppression disparait sans que rien ne le signale.
    <ToastProvider>
      <div className="app">
        <header className={`app-header${kicker ? ' app-header--effacee' : ''}`}>
          {isStacked ? (
            <button
              type="button"
              className="icon-button"
              onClick={() => void navigate(-1)}
              aria-label="Retour"
            >
              <Icon name="ui-chevron-left" size={22} strokeWidth={1.9} />
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
              <Icon name={isDark ? 'ui-sun' : 'ui-moon'} size={20} strokeWidth={1.7} />
            </button>
            <NavLink to="/parametres" className="icon-button" aria-label="Paramètres">
              <Icon name="ui-settings" size={20} strokeWidth={1.7} />
            </NavLink>
          </div>
        </header>

        <main className="app-main">
          {/* Le titre de l'ecran, rendu UNE FOIS ici plutot que dans chacun
              des cinq ecrans : les cinq l'auraient recopie, et le sixieme
              l'aurait oublie. `aria-hidden` parce que le <h1> reste dans la
              barre — deux titres annonces pour une seule page tromperaient un
              lecteur d'ecran. */}
          {kicker && (
            <div className="hero" aria-hidden="true">
              <span className="hero__kicker">{kicker}</span>
              <span className="hero__title">{title}</span>
            </div>
          )}

          <Routes>
            {/* `/` REDIRIGE, il ne rend pas.
                Rendre ShoppingScreen ici donnait le bon ecran mais aucun onglet
                en surbrillance : le NavLink de la barre pointe sur `/courses`,
                et `/` ne lui correspond pas. Comme le manifeste PWA declare
                `start_url: '/'`, l'application installee s'ouvrait donc
                systematiquement sans onglet actif. La redirection avec `replace`
                remet l'adresse sur `/courses` sans laisser d'etape dans
                l'historique, donc sans casser le bouton Retour. */}
            <Route path="/" element={<Navigate to="/courses" replace />} />
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
            <Route path="/parametres/profil" element={<ProfileScreen />} />
            {/* Galerie du jeu d'icones : verifier un dessin sur l'appareil reel
                vaut mieux que sur un ecran de bureau, ou tout parait lisible. */}
            <Route path="/parametres/icones" element={<IconGalleryScreen />} />
            <Route path="/parametres/rayons" element={<RayonsScreen />} />
            <Route path="/parametres/mes-icones" element={<CustomIconsScreen />} />
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
              <span className="tabbar__icon">
                <Icon name={tab.icon} size={24} strokeWidth={1.7} />
              </span>
              <span className="tabbar__label">{tab.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </ToastProvider>
  )
}
