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

Both functions return Pydantic `Ingredient` models. The HTTP client sends `User-Agent: livre-de-recettes/0.1.0 (marius.amalric45@gmail.com)` — OFF rate-limits anonymous clients harder. `langs=fr,en` is always passed for French support.

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
