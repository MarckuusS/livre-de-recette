# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project direction (decided 2026-08-01) — pivot to web / PWA

> **Read this before anything else.** The project is changing target. Most of the document below still
> describes the *current* desktop app, which is accurate but no longer the destination.

The app is being ported to a **web front-end deployed as an installable PWA** (iOS "Add to Home
Screen"), backed by **Cloudflare** (Pages + Workers + D1 + R2), so that recipes, ingredients, meal
plans and the pantry are reachable from a phone and **synced between phone and desktop**.

Consequences:

- The **PySide6/QML desktop app is slated for retirement**. It stays the reference implementation and
  the only usable client until the web app reaches feature parity on what is actually used — then it
  is removed. Do not invest in new QML features unless explicitly asked; port instead.
- `app/domain/` (Pydantic models, nutrition, pricing, units, shopping) and the SQLite schema are the
  parts meant to survive. `app/ui/` is not portable and will be rewritten for the web.
- **Cloudflare D1 is SQLite**, so the schema, the FTS5 virtual table and the triggers port over
  essentially unchanged. Keep that in mind before proposing anything Postgres-flavoured.

## Stack & key choices

- Python 3.11+, PySide6 (Qt 6) for UI — **QtQuick Controls 2 / QML**. The QtWidgets MVP was migrated to QML in May 2026; only `QApplication` from QtWidgets remains, used as the bootstrap shell.
- The default style **`Basic`** is forced at startup via `QQuickStyle.setStyle("Basic")`. The native `FluentWinUI3` style on Windows refuses customization of `background` / `indicator` / `contentItem`, which would defeat the whole `Theme.qml` design system.
- SQLAlchemy 2.x + SQLite. The DB uses **WAL mode + FTS5** (virtual table `ingredient_fts`) for ingredient search. Do not remove FTS5 from the init script — the dynamic-suggestion widget depends on it.
- Pydantic v2 — all domain models live in `app/domain/models.py` and are the source of truth. ORM rows are mapped to/from Pydantic at the repository boundary. QML never sees Pydantic objects directly: `QAbstractListModel` exposes them via roles, and slots return `QVariantMap` (Python `dict`) for detail views.
- `httpx` (sync) for OpenFoodFacts. API base URL: `https://world.openfoodfacts.org`. No auth needed.
- ~~**No Electron, no WebView, no Tauri.** Native Qt only — this is a hard rule from the project's design.~~
  **Repealed on 2026-08-01.** The rule existed to keep the *desktop* app native, and it did its job.
  It no longer applies: the project is moving to a web front-end (see "Project direction" above).
  Web technologies are now the target stack, not a forbidden one. The rule that replaces it is
  narrower: **no desktop wrapper** — no Electron/Tauri shell around the web app. On desktop the app
  is simply opened in the browser (and installable from there if wanted).

## Jeu d'icônes (web) — `web/src/icons/`

L'application web n'utilise **plus d'émoji**. 67 icônes les remplacent : **10 rayons** et
57 d'interface. Règles complètes : `web/src/icons/README.md`. Les points qui ne se devinent pas :

- **Les dessins viennent de [Lucide](https://lucide.dev)** (0.469.0, ISC + MIT) **et de
  [Tabler](https://tabler.io/icons)** (3.31.0, MIT), versions figées. Les deux fichiers
  `LICENSE-*.txt` sont à conserver — le dépôt est public. Dans `MAP`, un nom préfixé `tabler:`
  va chercher chez Tabler : Lucide n'a pas tout, son `milk` est une bouteille quand le lait
  s'achète en brique.
- **`paths/ui.ts` et `paths/rayons.ts` sont GÉNÉRÉS.** Ne pas éditer à la main : ajouter la ligne
  dans `MAP` (`scripts/import-lucide.mjs`) puis relancer le script, qui récupère, filtre et réécrit.
- **`paths/overrides.ts` ne l'est pas** : c'est là que vivent les dessins maison, fusionnés **en
  dernier** dans `registry.ts` donc prioritaires. Deux tests protègent le mécanisme. **Une seule
  entrée**, le pot de yaourt à opercule, qu'aucun des deux jeux n'a. Avant d'en ajouter une
  autre, chercher chez Tabler : un dessin qu'on n'a pas à maintenir vaut mieux qu'un dessin
  qu'on maintient mal.
- Pas de dépendance `lucide-react` : le paquet laisse chaque icône poser ses propres attributs, ce
  que `Icon.tsx` interdit. On prend les chemins, on garde le cadre — c'est ce qui permet de rendre
  à 1,6 d'épaisseur ce que Lucide publie à 2.
- Une icône ne porte **jamais** de couleur littérale, seulement `none` ou `currentColor`. Un test
  échoue sinon : une couleur en dur raterait la teinte du rayon et le thème sombre.
- **Les 8 nutriments ont leurs icônes dans ce jeu**, plus de PNG. Une image ne se teinte pas, ne
  suit pas le thème sombre et se pixellise à l'agrandissement. Chacune est posée sur une **pastille pâle** et porte l'**encre** de son nutriment, jamais sa teinte. Les deux sous-lignes gardent le lien familial par leur dessin mais ont leur propre couleur : dérivées du parent, leurs pastilles calculaient la même valeur au pixel près. L'énergie porte l'olive de l'application. Le desktop QML garde ses
  propres PNG sous `app/ui/qml/components/icons/nutrient/` : ne pas les supprimer avec.
- **Il n'y a pas d'icône par aliment, et c'est délibéré.** Un ingrédient porte l'icône de son
  rayon (`category_l1`), donnée qu'il a déjà.
- L'ordre compte dans `RAYON_RULES` (`resolve.ts`), contrairement au reste du projet : la première
  règle qui accroche gagne. Deux paires en dépendent, couvertes par un test (`surgelés` avant
  `légumes`, `fruits de mer` avant `fruits`).
- Chaque rayon doit avoir sa teinte dans `styles/icons.css`, sous les deux thèmes. Test dédié.
- **Rayons et icônes éditables** : `category_definition` (nom, icône, couleur) et `custom_icon`
  (SVG collé). Un SVG collé est assaini par `shared/src/svg.ts` — **liste blanche**, 22 tests
  d'attaque — et c'est le **serveur** qui fait foi, jamais le navigateur.
- `node scripts/export-icons.mjs` régénère `docs/icones/` (SVG autonomes + galerie).

## Ligne visuelle (web) — `web/src/styles/theme.css`

L'interface suit un mockup adopté le 2026-08-12. Ce qui ne se devine pas :

- **Deux polices, deux rôles.** Instrument Sans porte ce qui se **lit**, Bricolage Grotesque
  ce qui s'**annonce** — titres d'écran, titres de section, grands chiffres (classe `.chiffre`).
  Bricolage dans un paragraphe lui fait perdre son caractère. Les deux sont **servies par
  l'application** (`@fontsource-variable/*`, licence OFL, importées dans `main.tsx`), jamais par
  un hôte distant : l'app doit s'ouvrir dans un magasin sans réseau.
- **Le tricolore macro a DEUX familles de jetons, et c'est le piège.** `--color-nutrient-X`
  est calibré pour des **surfaces** (barre, arc, fond de pastille) ; `--color-nutrient-X-ink`
  pour du **texte**. Le miel plafonne à 2,2:1 sur blanc : écrit avec sa teinte, il est
  invisible. Règle : *un aplat prend la teinte, un mot ou un chiffre prend l'encre.* C'est la
  même distinction que `--color-primary` / `--color-primary-text`. Les encres et les pastilles
  se retournent avec le thème ; les teintes, non.
- **L'énergie n'est pas une macro** : elle reste neutre partout. Quatre couleurs pour trois
  familles, et le tricolore ne signifie plus rien.
- **Les cartes n'ont pas de bordure**, seulement une ombre presque nulle sur le papier. À dix
  cartes par écran, les traits formaient une grille à traverser avant d'atteindre le contenu.
- **Le titre d'écran vit dans la page, pas dans une barre.** Il est rendu **une seule fois**,
  dans `App.tsx` (`.hero`), pour les cinq onglets — jamais recopié dans les écrans. La barre
  garde le `<h1>` masqué pour les lecteurs d'écran, et le `.hero` est `aria-hidden`. Sur les
  vues empilées, l'ancienne barre titrée revient : le bouton retour a besoin d'un ancrage.
- L'en-tête effacée prend la couleur du **papier**, pas `transparent` : elle est collante, et
  le contenu défilait visiblement derrière.
- **Les 11 teintes de rayon (`styles/icons.css`) ne font pas partie du tricolore.** C'est un
  système de codes calibré pour rester distinct côte à côte dans une liste triée par nom. En
  retoucher une seule le déséquilibre.

## Navigation (web) — `web/src/App.tsx`

**Quatre onglets et un bouton de scan central** : Accueil · Planning · [SCAN] · Objectifs · Profil.
La barre en portait cinq (Ingrédients / Recettes / Semaine / Courses / Frigo) ; elle suit désormais
la forme du mockup. Ce qui ne se devine pas :

- **Le bouton de scan n'est PAS dans `TABS`.** Il n'y a que 4 emplacements d'onglet : le cinquième
  est le bouton, qui mange la colonne centrale. Un élément de `TABS` porte un surtitre, un grand
  titre et un état actif d'onglet — un déclencheur d'action n'en a que faire. Il est inséré par
  `TABS.slice(0, 2)` / `TABS.slice(2)` dans le rendu de la barre.
- **`kicker` fait TROIS choses** : il marque l'entrée comme onglet, il déclenche `.app-header--effacee`,
  et il s'affiche au-dessus du grand titre. Un chemin absent de `TABS` n'a donc ni hero ni en-tête
  effacée. La comparaison est une **égalité stricte** de `pathname`.
- **Bibliothèque, Recettes, Courses et Frigo ne sont plus des onglets.** Leur SEUL point d'entrée est
  le bloc `ACCES` en bas de `AccueilScreen.tsx`. Le supprimer rendrait quatre écrans inatteignables.
  Ils ont rejoint `STACKED` pour retrouver un bouton retour.
- **Les anciennes adresses redirigent** (`/semaine`, `/parametres`, `/parametres/profil`,
  `/diagnostic`) : favoris, historique, et `start_url: '/'` d'une PWA déjà installée. `replace` pour
  ne pas coincer le bouton retour. Le précédent était `/diagnostic`.
- **`/scan` ne résout et n'écrit rien.** Il lit le code, l'affiche pour confirmation, puis **renvoie**
  vers l'écran choisi avec `?scan=<code>` — ou `?ean=` pour la bibliothèque, où le paramètre existait
  déjà et veut dire autre chose (« pré-remplis la référence », pas « traite ce produit »). C'est le
  code déjà éprouvé de chaque destination qui travaille : quantité par défaut, session de courses,
  produit inconnu, doublon de nom. `useScanParam` (`web/src/lib/useScanParam.ts`) rattrape le
  paramètre, le **valide** comme la caméra, l'**efface** de l'URL en `replace` (sinon le geste retour
  rouvre la feuille en boucle) et le **retient** — côté Courses il doit survivre à l'ouverture d'une
  session.
- **Ajouter au chariot exige une session ouverte.** `SessionBar` ouvre d'office sa feuille de
  démarrage quand un code attend, et dit pourquoi.
- **`useDailyTargets`** (`web/src/lib/useDailyTargets.ts`) est la seule source de la cible du jour,
  partagée par `GoalCard` et l'Accueil. Deux copies de ce calcul afficheraient deux objectifs
  différents pour la même journée.
- **L'hydratation** est la **deuxième table cloisonnée par PERSONNE** après `user_profile`. Sa cible
  se recalcule du poids (`hydrationTarget`, 30 ml/kg borné 1,5–4 L), jamais stockée. Le dépôt écrit
  un **delta**, pas un total : deux appareils peuvent ajouter un verre dans la même minute. Le SQL
  utilise des paramètres **numérotés** (`?3` relu dans la branche UPDATE) — avec `excluded.ml` on
  relirait la valeur déjà bornée à zéro et un retrait serait perdu.

## Planning : la semaine et le jour (web)

Deux ecrans, et c'est une decision, pas un accident :

- `/planning` montre **sept lignes de hauteur fixe** : jour, badge, cinq marques de creneau, total,
  tri-barre. Rien qui grandisse avec le nombre de repas. Elle a d'abord porte une puce par repas :
  le mockup en montre trois par jour, la vraie donnee en met huit, et la ligne du mercredi faisait
  trois fois celle du mardi.
- `/planning/:jour` montre **la journee**, avec ses cinq creneaux, le tableau des apports, l'anneau,
  le cout et les outils. Le jour a d'abord ete un depliant sous sa ligne : deux niveaux de cartes
  blanches imbriquees se lisent comme un seul, et l'on ne savait plus si "MATIN" appartenait a
  mercredi ou a jeudi.
- Les **cinq marques** portent la seule information de contenu qui ne grandit pas. Elles ont un
  `aria-label` qui enumere ce qui est prevu et ce qui manque : cinq ronds ne se lisent pas a voix
  haute.
- Le total d'une ligne est celui de **la cuisine** ; le badge "Objectif tenu" compare une part
  **individuelle** (`perEater`) a la cible. Ne jamais ecrire les deux comme un rapport sur la meme
  ligne, ce serait un total de foyer face a une cible personnelle.

## Pieds d'action fixes (web)

Six ecrans posent un pied fixe au-dessus de la barre d'onglets (fiche ingredient, liste et editeur
de recettes, frigo, courses, session). Deux regles vont ENSEMBLE, et n'en tenir qu'une casse
l'ecran :

- le pied reserve `--scan-overlap` en bas, sinon le bouton de scan central, qui deborde de 20 px en
  `z-index: 20`, lui prend le tap sur 56 px de large, exactement au centre ;
- **le contenu reserve la hauteur du pied**, `calc(var(--reserve-pied) + N)`, sinon son dernier
  element passe SOUS le pied et devient intapable. `--reserve-pied` porte la part commune ; le `N`
  est propre a chaque pied, leurs hauteurs different.

**Toutes ces regles doivent doubler la classe** (`.screen.screen--X` et non `.screen--X`) : `.screen`
pose `padding: var(--space-lg)` dans `app.css`, et a specificite egale c'est l'ordre des fichiers
qui tranche. Le defaut s'est produit quatre fois dans ce projet, dont une fois sur ce pied precis,
ou "Annuler" est reste inatteignable un moment.

## Quantites et unites (web)

- **La masse est stockee EN GRAMMES**, partout, toujours. C'est ce qui permet d'additionner un
  yaourt compte en pieces et du riz pese en grammes sans convertir a chaque agregation.
- **L'unite de saisie est stockee A COTE**, en colonne `unit`, sur `recipe_ingredient` depuis la
  0001 et sur `meal_plan_entry` depuis la **0011**. Sans elle, "40 g" d'un produit vendu par pieces
  de 100 g rouvrait en "0,4 piece" : la masse etait juste, la lecture ne l'etait plus.
- `NULL` veut dire "aucun choix enregistre" : l'ecran retombe sur son heuristique, la piece quand
  l'ingredient en a une, le gramme sinon. Les entrees anterieures gardent donc leur comportement.
- **Changer d'unite compte comme une modification a enregistrer**, meme quand le nombre de grammes
  ne bouge pas : c'est une decision de lecture, et la feuille rouvrirait sinon sur l'ancienne.
- `QuantityField` accepte deja `unit` et `onUnitChange` : toute nouvelle surface de saisie doit
  brancher les deux, sinon le choix se perd en silence.

## Profil et objectifs (web) — `shared/src/profile.ts`

Cible journalière en kcal et macros, par Mifflin-St Jeor. Le calcul est un module **pur**, testé
comme une spécification (valeurs de référence calculées à la main, pas relevées sur une exécution).
Ce qui ne se devine pas :

- **`user_profile` est la seule table cloisonnée par PERSONNE**, pas par foyer — d'où un dépôt
  construit à part, hors de l'agrégat `Repositories`. Poids et taille sont des données de santé :
  partager une cuisine ne donne pas le droit de les lire. L'identifiant vient du cookie signé, et
  aucun paramètre ne permet de demander le profil de quelqu'un d'autre.
- **`household.eaters` appartient au foyer**, lui, et sert à diviser le total d'une journée avant
  de le comparer à un objectif personnel. `meal_plan_entry` ne dit toujours pas qui mange : la voie
  exacte (une colonne `user_id`) a été écartée en connaissance de cause, elle imposait de repenser
  l'écran Semaine. C'est une approximation, et l'interface le dit plutôt que de diviser en silence.
- **Les cibles ne sont pas stockées** : elles se recalculent du profil, par la même fonction côté
  Worker et côté navigateur. Deux copies d'un même chiffre finissent toujours par diverger.
- **Deux axes séparés, et c'est le point** : `ENERGY_GOALS` décide du COMBIEN (six objectifs, de la
  sèche à la prise de masse), `MACRO_SPLITS` décide du COMMENT (sept répartitions, dont `perso`).
  Chaque objectif *propose* une répartition (`defaultSplit`) que l'utilisateur peut remplacer. La
  version d'origine les soudait dans une liste de trois : « perdre du poids » imposait alors ses
  pourcentages.
- **Un poids visé plus une allure l'emportent sur le pourcentage de l'objectif** : l'écart vient
  alors de `pace × KCAL_PER_KG / 7`. La direction se lit sur l'écart réel au poids visé, jamais sur
  le libellé de l'objectif.
- `estimateTargets` rend **`null`** dès qu'une mesure manque, et ne descend jamais sous
  `MIN_SAFE_KCAL` (1 200 / 1 500) ni au-delà de `MAX_ADJUST` (25 % de la dépense). Quatre drapeaux
  (`floored`, `capped`, `lowProteins`, `lowFats`) obligent l'écran à dire ce qui a été corrigé.
- **`weeksToTarget` est `null` quand le réglage n'avance pas vers la cible** — le plancher peut
  relever l'apport au-dessus de la dépense, ce qui fait grossir qui voulait maigrir. Annoncer une
  date serait promettre l'inverse de ce qui arriverait.
- Le total des pourcentages manuels n'est **jamais bloquant** : `normalizeSplit` le ramène à 100 des
  deux côtés du réseau, et l'écran affiche le résultat.
- `user_profile` a été **reconstruite** en 0009 (SQLite ne sait pas modifier un CHECK). Toute
  évolution de `goal`, `split` ou `pace` demandera la même manœuvre — copie, bascule, vérification
  du nombre de lignes AVANT le `DROP`.

## Common commands

```bash
# Install (editable + dev deps)
pip install -e ".[dev]"

# Run the app
python -m app.main

# Or, on Windows, just double-click run.bat (handles venv + deps + launch)

# Run all tests
pytest

# Run a single test
pytest tests/test_nutrition.py::test_aggregate_recipe_basic

# Lint
ruff check app tests

# Format
ruff format app tests

# (Re)seed CIQUAL 2025 — idempotent, safe to rerun
python -m app.data.seeds.ciqual_loader
```

The SQLite DB lives at `livre_de_recettes.db` at the repo root by default (override via `LIVRE_DB_PATH` env var). It is git-ignored — every dev gets a fresh empty DB and seeds CIQUAL on first launch.

## Architecture — the 4 layers, in dependency order

```
domain   <-- pure Python, no Qt, no SQLAlchemy. Pydantic models + pure functions.
data     <-- SQLAlchemy ORM + repositories. Imports domain (for return types).
services <-- orchestration. Imports domain + data + external APIs.
ui       <-- ViewModels (Python/QObject) + QML files. Goes through services for
             cross-layer work, but may use repositories directly for trivial
             reads/writes (kept inside the viewmodel — never inside QML).
```

Rules to keep this structure honest:

- `app/domain/` must not import anything from `app/data/`, `app/services/`, `app/ui/`, `PySide6`, or `sqlalchemy`. If a "domain" function needs a session, it's a service.
- QML files (`app/ui/qml/`) must not open a DB session themselves — they go through their viewmodel via a context property (`ingredientVM`, `recipeListVM`, `recipeEditorVM`, `calendarVM`). ViewModels open sessions via `AppContext.session()` (see `app/ui/app_context.py`).
- ViewModels are `QObject` subclasses (with `@QmlElement` for type registration) that expose state via `Property` and accept calls via `@Slot`. They live in `app/ui/viewmodels/` and own short-lived sessions: every mutation opens, commits, closes (`with ctx.session() as s:`). This avoids the classic stale-identity-map issues from long-lived sessions.
- Lists exposed to QML go through `QAbstractListModel` subclasses in `app/ui/models/`. The viewmodel owns a model instance via composition (not inheritance) and exposes it as a `Property(QObject, constant=True)`. The model is `set_items()`-mutated on refresh — full reset, not granular `dataChanged`.

Adding a new page: create `app/ui/qml/pages/<Feature>Page.qml`, register it in `app/ui/qml/Main.qml` (just add a third element in the `StackLayout` and a fourth `AppTabButton` in the `TabBar`). The viewmodel goes in `app/ui/viewmodels/<feature>_vm.py` and is exposed as a context property in `app/main.py`.

## QML structure

```
app/ui/qml/
├── Theme.qml                     # singleton (pragma Singleton + qmlRegisterSingletonType)
├── Main.qml                      # ApplicationWindow + MenuBar + TabBar + StackLayout
├── components/
│   ├── AppButton.qml             # 4 variants: primary / secondary / ghost / danger
│   ├── AppTabButton.qml          # tab with bottom-border selection indicator
│   ├── AppTextField.qml
│   ├── AppComboBox.qml           # delegate handles ListModel (multi-role) AND string array
│   ├── AppSpinBox.qml            # decimal + emptyOnZero option
│   ├── AppCheckBox.qml
│   ├── AppScrollBar.qml          # fine, fades in on hover
│   ├── AppListItem.qml           # selection bar on the left
│   ├── AppDialog.qml             # in-window modal (rarely used — see dialogs/)
│   ├── AppPopup.qml              # autocomplete popups
│   ├── AppMenu.qml               # styled Menu + MenuItem delegate (no native black)
│   ├── FixedUnitField.qml        # spinbox + read-only unit cell
│   ├── QuantityField.qml         # spinbox + unit dropdown, **piece-aware**
│   ├── IngredientSearch.qml      # textfield + suggestions popup, debounced 200 ms
│   ├── NutritionPanel.qml        # 4 colored chips (kcal / P / G / L)
│   └── MealSlot.qml              # calendar cell, entire surface clickable to add
├── pages/
│   ├── IngredientsPage.qml
│   ├── RecipesPage.qml
│   └── CalendarPage.qml
└── dialogs/
    ├── ImportIngredientDialog.qml     # detachable Window (system-level)
    └── AddCalendarEntryDialog.qml     # detachable Window (system-level)
```

**Theme registration** (`app/main.py`): `Theme.qml` MUST start with `pragma Singleton` and is registered via `qmlRegisterSingletonType(themeUrl, "App", 1, 0, "Theme")`. Other QML files import it with `import App` and use `Theme.colorPrimary`, `Theme.spaceMd`, etc. Context-property registration was tried first but doesn't propagate into MenuBar / Popup / Window sub-trees — singleton is mandatory for global access.

**Dialogs as Windows**: `ImportIngredientDialog` and `AddCalendarEntryDialog` are real `QtQuick.Window` objects, not `Dialog` (which is in-window). They're top-level system windows: detachable, draggable outside the main app, non-modal. Use the helper `openCentered(parentWindow)` / `openFor(...)` to position them at the parent's center.

## Data model — non-obvious points

- **All quantities are normalized to grams** in `recipe_ingredient.quantity_g` and `meal_plan_entry.quantity_g`. Unit conversion is done at the UI boundary by `app/ui/qml/components/QuantityField.qml` (value + unit dropdown) and `app/domain/units.py` (table). Storage stays in grams.
- **Nutrition is stored per 100 g** on `ingredient` (CIQUAL convention). Aggregation always passes through `domain/nutrition.py` — do not re-implement the formula in viewmodels.
- **`meal_plan_entry` uses XOR**: exactly one of `recipe_id` / `ingredient_id` is set. Enforced at the repository layer (the DB-level CHECK is too painful with SQLAlchemy migrations); a `MealPlanEntry` Pydantic validator also rejects the malformed case.
- **`iso_week` is the natural key** for the calendar (`'2026-W18'`). Don't store dates — store ISO week + day-of-week (0=Monday, 6=Sunday). This survives DST, makes "this week" trivial, and indexes well.
- **`ingredient.source`**: `'ciqual' | 'openfoodfacts' | 'manual'`. `source_ref` is the CIQUAL `alim_code` or the EAN barcode. Manual ingredients have `source_ref = NULL`.
- **`ingredient.in_personal_library`** (boolean, added later via inline migration) separates the user's *curated working set* from the catalog rows. CIQUAL/OFF rows are seeded with `False` — they exist locally but **don't show up** in the Ingredients tab. The user picks them via the Import dialog or the recipe/calendar pickers, which flip the flag to `True`. Removing a CIQUAL/OFF row from the personal library only flips the flag back; manual rows are hard-deleted.
- **`ingredient.category_l1` / `category_l2`** (TEXT, added by inline migration in `db.py`) hold CIQUAL's `alim_grp_nom_fr` and `alim_ssgrp_nom_fr`. Used to populate the category dropdown of the Import dialog. NULL for OFF and manual rows.
- **`ingredient.piece_weight_g`** (REAL, nullable, added by inline migration `_migrate_add_piece_weight`) is the gram weight of one "piece" — 1 egg ≈ 60 g, 1 onion ≈ 150 g, 1 garlic clove ≈ 5 g. When non-NULL, the `QuantityField` in QML pickers exposes a "pièce (60 g)" entry at the top of its unit dropdown and switches to it automatically. When NULL, no piece unit is offered (oils, milk, rice, salt, …). Editable via the Ingredient form's "Poids unitaire" field.
- **Inline migrations** : evolutions of the `ingredient` schema use idempotent `_migrate_*` functions in `app/data/db.py` (`PRAGMA table_info` then `ALTER TABLE ADD COLUMN`). No Alembic. Each new column gets its own migration; running them is part of `init_schema()`. Current migrations: `_migrate_add_in_personal_library`, `_migrate_add_categories`, `_migrate_add_piece_weight`.

## ViewModels exposed to QML

Each VM is registered with `@QmlElement` (module `App.ViewModels`) and instantiated Python-side in `app/main.py`, then exposed as a context property:

| Context property | Class | Purpose |
|---|---|---|
| `ingredientVM` | `IngredientViewModel` | Bibliotheque personnelle + import OFF / CIQUAL |
| `recipeListVM` | `RecipeListViewModel` | Liste des recettes |
| `recipeEditorVM` | `RecipeEditorViewModel` | Buffer d'edition d'une recette en cours |
| `calendarVM` | `CalendarViewModel` | Semaine ISO courante + entrees + agregats |

**Conventions for VM↔QML**:

- `Property(QObject, constant=True)` named `items` / `entries` exposes the list model. `constant=True` because we reset the inner model (not its identity) on refresh.
- Slots use `camelCase` (Qt convention from QML) — wrappers around the snake_case Python methods (`refreshList()` → `refresh()`, `getAsDict(id)` → `get(id)` + dict conversion). Both APIs coexist; tests use the Python one.
- Decimal → str. QML doesn't know `decimal.Decimal`; prices are serialized as strings (e.g. `"12.0000"`) and formatted in QML via `Number(parseFloat(x)).toLocaleString(Qt.locale(), 'f', 2)`.
- Pydantic enums (`Source`, `MealSlot`) → `.value` (str) at the role boundary.
- For "save" operations, QML passes a `QVariantMap` (JS object) to `saveFromDict(payload)`. Python validates via Pydantic, persists, returns the saved row as a dict.

## Ingredient search — two distinct flows

### `IngredientSearch` (Recipes / Calendar pickers)

`app/ui/qml/components/IngredientSearch.qml` — the live picker used inside the Recipes editor and the Calendar add dialog. Behavior:

- 200 ms `Timer` debounce on `onTextChanged` — never query on every keystroke.
- Query goes to `ingredientVM.searchOnce(query, scope, limit)` (a `@Slot` returning `QVariantList` of dicts), which runs FTS5 against the local DB. **No HTTP call from the keystroke path** — slow and OFF rate-limits.
- **Default scope is `'personal'`**: the picker only suggests ingredients already in the user's personal library. CIQUAL/OFF source rows do not pollute recipe/calendar composition.
- Keyboard navigation built-in (Up / Down / Enter / Escape).
- Each suggestion shows a colored source badge (CIQUAL green / OFF blue / manuel amber) and, when relevant, a "● 1 pc = X g" indicator for piece-aware ingredients.

### `ImportIngredientDialog` (the explicit catalog browser)

`app/ui/qml/dialogs/ImportIngredientDialog.qml` — opened from the Ingredients tab via "Importer un ingrédient". Real `Window` (detachable / draggable / non-modal). Two tabs (CIQUAL local, OpenFoodFacts online):

- **CIQUAL tab**: debounced 250 ms search via `ingredientVM.searchBySource(query, "ciqual", 50)`.
- **OFF tab**: explicit "Chercher en ligne" button (no debounce — OFF is rate-limited). Calls `ingredientVM.fetchOnlineAndList(query, 30)` which hits Search-a-licious, caches results in DB, returns dicts.
- Result list: card per ingredient with star "🌟" prefix when already in the personal library, "+ Ajouter" button per row.
- Double-click or "+ Ajouter" → `ingredientVM.importExisting(id)` flips `in_personal_library = True`.
- Filter panel + pagination + sort were on the old QtWidgets dialog and will return as Phase 4+ polish — current QML version is intentionally simpler.

The Ingredients tab itself filters via a plain top-of-list `AppTextField` that calls `ingredientVM.setFilter(text)`.

### Search options API (`app/data/repositories.py`)

`IngredientRepo.search_fts` accepts a `SearchOptions` dataclass for the rich case (filters + sort + pagination), or a positional `(query, limit, *, scope, source)` for the legacy picker case. Returns `SearchPage` (matches + total_count + page metadata). Sort fields: `'rank' | 'name' | 'kcal' | 'proteins' | 'carbs' | 'fats'`, all with `sort_desc` flag.

### OpenFoodFacts: client-side macro sort

Search-a-licious **rejects** macro fields as `sort_by` (HTTP 400). `_OFF_SORT_MAP` whitelists only `product_name` and popularity-style fields. For macro sorts, the dialog post-sorts the page client-side and shows a hint that the sort is page-local (not over the full result set).

## CIQUAL seeding

The ANSES file lives under `app/data/seeds/`. The loader (`ciqual_loader.py`) **auto-detects** the format from the extension — `.xls` (binary OLE2, requires `xlrd<2.0`), `.xlsx` (requires `openpyxl`), or `.csv` (`;` separator, decimal comma). The user puts the file there manually; the project's `pyproject.toml` declares `xlrd<2.0` as a runtime dependency so the most common case (the .xls export from ciqual.anses.fr) works out of the box.

The loader is **idempotent**: it uses `IngredientRepo.upsert_by_source_ref` matched on `(source='ciqual', source_ref=alim_code)`. Rerunning **updates** existing rows (refreshing nutrition/category data if ANSES publishes a fix) **without** clobbering the user's `in_personal_library` flag — that's preserved across re-seeds via an explicit guard in the loader.

Empty / `-` / `traces` / `<X` cells must be parsed to `None` or 0 respectively — never raise.

CIQUAL header normalization (`_norm`): the 2025 .xls headers contain `\n` characters and lack the `/` in `(kcal/100 g)`. The loader normalizes via lowercase + strip + accent-folding + `[/\n\t]` → space + collapse-whitespace, then matches against `_COLUMN_CANDIDATES`. Add a new candidate string when ANSES changes a header in a future release.

## OpenFoodFacts client

`app/services/openfoodfacts.py`. Two distinct hosts:

- **Barcode lookup** : `world.openfoodfacts.org/api/v2/product/{ean}` via `lookup_barcode(ean) -> Ingredient | None`. Stable.
- **Free-text search** : `search.openfoodfacts.org/search` (Search-a-licious — OFF's dedicated search backend). The legacy `/cgi/search.pl` and `/api/v2/search` endpoints on the main host are saturated and return 503 most of the time.

`search_by_name(query, *, page=1, page_size=25, sort_by=None, filters=None) -> tuple[list[Ingredient], int]`. Returns `(matches, total_count)` — total comes from the API's `count` field.

- `filters` is a plain dict mirroring `SearchFilters` shape: `min_proteins`, `max_proteins`, `category_tag`, etc. The function builds a Lucene-style `q` (e.g. `tomate AND nutriments.proteins_100g:[10 TO *] AND categories_tags:"fr:legumes"`).
- `sort_by` accepts internal codes (`name_asc`, `name_desc`, `proteins_desc`, …) mapped via `_OFF_SORT_MAP`. **Macro sorts are mapped to `None`** because the API rejects `nutriments.*` as a sort key; the import dialog handles the fallback by sorting client-side (page-local) and informing the user.

Empty query AND no filters → return `([], 0)` without hitting the API (avoids `*:*` paging through OFF's millions of products).

Both functions return Pydantic `Ingredient` models. The HTTP client sends `User-Agent: livre-de-recettes/0.1.0 (+https://github.com/MarckuusS/livre-de-recette)` — OFF rate-limits anonymous clients harder. `langs=fr,en` is always passed for French support.

## Testing conventions

- Domain tests use plain `pytest` — no fixtures needed beyond literal Pydantic instances.
- Repository tests use a SQLite in-memory engine via the `db_session` fixture in `tests/conftest.py`. They run the schema init + FTS5 setup but **do not seed CIQUAL** — too slow.
- UI tests : not yet written for QML. Prefer testing the viewmodel's Python API (`vm.refresh()`, `vm.items.rowCount()`, `vm.items.data(idx, NameRole)`) — this is enough for the data flow. Pure QML rendering can be tested later with `QQuickWidget` + `QtTest::QSignalSpy` if needed.

## Shared widgets — quick reference

All in `app/ui/qml/components/`:

- **`QuantityField.qml`** — spinbox + unit combobox, **piece-aware**. Property `pieceWeightG: real` (0 = no piece unit; > 0 = adds "pièce (Xg)" entry at top of dropdown). Stores grams internally regardless of selected unit. Switching unit preserves the gram amount (1000 g → kg → reads `1.0`). Used in Recipes editor (Ajouter ingrédient + each line of the table), Calendar add dialog, Ingredients tab (Quantité de référence du prix). Static unit table mirrors `app/domain/units.py`.
- **`FixedUnitField.qml`** — spinbox + read-only unit cell on the right. Used for the Ingredients tab macro fields (`g/100g`, `kcal/100g`) and the "Poids unitaire" field. The inner `AppSpinBox` has `emptyOnZero: true` so a zero value renders as **empty** (not `0.0`).
- **`AppButton.qml`** — 4 variants: `"primary"` (full color fill), `"secondary"` (border only), `"ghost"` (no chrome), `"danger"` (red text on transparent — used for ✕ remove buttons). Auto-handles disabled state, focus ring, hover/pressed transitions.

## Theme system (`Theme.qml`)

Singleton with all design tokens. Key categories:

- **Palette**: `colorPrimary` / `colorSecondary` / `colorAccent` / `colorError` / `colorSuccess` / `colorWarning` (each with hover / pressed / disabled variants where applicable), `colorBackground` / `colorSurface` / `colorSurfaceHover` / `colorSurfacePressed`, `colorText` / `colorTextSecondary` / `colorTextDisabled` / `colorTextPlaceholder`, `colorBorder` / `colorBorderHover` / `colorBorderFocus`.
- **Typography**: `fontFamily` (platform-aware Segoe UI / SF Pro / Inter), `fontSizeXs/Sm/Md/Lg/Xl/Title`, `fontWeightRegular/Medium/SemiBold/Bold`.
- **Spacings**: `spaceXs=4 / Sm=8 / Md=12 / Lg=16 / Xl=24 / Xxl=32` (multiples of 4).
- **Radii**: `radiusSm=4 / Md=6 / Lg=10 / Xl=14 / Full=9999`.
- **Animations**: `durationFast=150 / Normal=250 / Slow=400` (ms), easing curves.
- **Shadows**: stacked `Rectangle` opacities (no MultiEffect dependency).
- **Mode toggle**: `darkMode: bool` — flip with `Theme.darkMode = !Theme.darkMode` (also in the Affichage menu, Ctrl+Shift+D). Every color reads `darkMode ? "#xxx" : "#yyy"`.
- **Helpers**: `formatMnemonic(text)` converts Qt's `&X` shortcut markers into HTML `<u>X</u>` (use with `textFormat: Text.RichText`).

## What this project is NOT (avoid scope creep)

> **Stale section — this was the MVP scope of April 2026.** Most of what it excludes has since been
> built (shopping list, recipe photos, dietary tags, pantry, price history, receipt import, recipe
> import by URL). And the three biggest exclusions were reversed on 2026-08-01:
> **mobile companion**, **cloud sync** and **camera barcode scanning** are now the whole point of the
> project — see "Project direction" at the top. Treat the list below as history, not as a rule.

Still genuinely out of scope: PDF export, ingredient deduplication.

A barcode scanner gun (HID) the user may eventually plug in behaves as a keyboard — no special integration code needed.

## When in doubt

- Check `architecture.md` for the bigger picture and current state of evolution.
- French is the user-facing language. Code, comments, and tests are in English.
- Phases of the QML migration (Foundation → ViewModels → Pages → Polish) are documented in `architecture.md` under "QML migration history" if you need to understand why a given decision was made.
