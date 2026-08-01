# 01 — Couche DOMAINE (`app/domain/`)

Spécification de portage établie par **lecture directe du code source** (aucune confiance accordée à
`CLAUDE.md` / `architecture.md`, qui sont périmés). Version du code lue : fichiers datés du 29/04 au
04/05/2026.

Fichiers couverts (contenu intégral du dossier, `__init__.py` est vide) :

| Fichier | Taille | Rôle |
|---|---|---|
| `app/domain/models.py` | 14 968 o | Modèles Pydantic v2 « cœur » (ingrédient, recette, calendrier, prix, pantry, cooking log) |
| `app/domain/nutrition.py` | 1 633 o | Agrégation nutritionnelle pure |
| `app/domain/pricing.py` | 1 526 o | Calculs de coût en `Decimal` |
| `app/domain/units.py` | 2 107 o | Table de conversion d'unités → grammes |
| `app/domain/shopping.py` | 2 658 o | Modèles de la liste de courses |
| `app/domain/receipt.py` | 6 150 o | Dataclasses du pipeline « ticket de caisse » |
| `app/domain/url_recipe.py` | 3 668 o | Dataclasses du pipeline « import de recette par URL » |

Contrainte d'architecture respectée par le code : **aucun import de Qt, SQLAlchemy, httpx ou de
`app.data` / `app.services` / `app.ui`** dans ce dossier. Les seuls imports sont `datetime`,
`decimal`, `enum`, `dataclasses`, `pydantic`. Le portage TypeScript de cette couche est donc
mécaniquement isolé — c'est le morceau le plus simple à porter.

Dépendances déclarées (pour contexte de sémantique) : Python ≥ 3.11, `pydantic>=2.5`.

---

## 0. Conventions générales à connaître avant de porter

Ces règles s'appliquent transversalement et conditionnent la fidélité du portage.

### 0.1 Sémantique Pydantic v2 à reproduire

- Un champ déclaré `x: T | None = None` est **optionnel ET nullable**. Un champ déclaré `x: T`
  (sans défaut) est **obligatoire**.
- Les `@field_validator` du projet sont tous en **mode « after » (mode par défaut)** : ils
  s'exécutent *après* la coercition de type. Un `str` passé pour un `float` est donc d'abord coercé.
- Pydantic v2 en mode « smart » **coerce** `int` → `float` (`quantity_g=200` est accepté),
  `str` → `Decimal` (`Decimal("1.20")` ou `"1.20"`), `str` → `Enum` par la **valeur** (`"ciqual"` →
  `Source.CIQUAL`). Il ne coerce PAS `str` → `int/float` en mode strict-ish par défaut pour les
  modèles Python… ⚠️ **ambiguïté** : le code ne configure ni `strict=True` ni de `model_config`
  particulier sur ce point, donc le comportement par défaut de Pydantic v2 s'applique (coercition
  laxiste depuis `str` numérique en mode « smart » lors d'une validation depuis JSON, plus stricte
  en Python). Côté web, **valider explicitement au bord** (Zod `z.coerce.number()` sur les payloads
  de formulaire) est le comportement le plus proche de ce qui se passe en pratique dans l'app, où
  les valeurs arrivent de QML sous forme de `QVariantMap`.
- Une violation lève `pydantic.ValidationError` (sous-classe de `ValueError`). Les tests attrapent
  indifféremment `ValueError` ou `ValidationError`.
- `model_config = ConfigDict(frozen=True)` → objet immuable + hashable. `frozen=False` → mutable.
  Aucun modèle n'active `extra="forbid"` : **les champs inconnus sont silencieusement ignorés**
  (comportement Pydantic par défaut `extra="ignore"`). À reproduire : en Zod, `.passthrough()` non —
  plutôt le `.strip()` par défaut de Zod, qui ignore aussi les clés inconnues. Équivalence OK.

### 0.2 Décimal vs flottant — règle absolue du projet

- **Tout ce qui est un montant en euros est un `decimal.Decimal`**, jamais un `float`
  (`price_eur`, `total_eur`, `cost_eur`, `unit_price`, `total_price`).
- **Tout ce qui est une masse en grammes est un `float`** (IEEE 754 double).
- Conversion float → Decimal toujours via `Decimal(str(x))` (représentation décimale courte), jamais
  `Decimal(x)` (qui donnerait le binaire exact). Ex : `Decimal(str(250.0))` → `Decimal("250.0")`.
- Le contexte décimal par défaut de Python est utilisé : **précision 28 chiffres significatifs**,
  arrondi de contexte `ROUND_HALF_EVEN`. Les quantifications explicites du projet utilisent
  `ROUND_HALF_UP` (voir §7).
- **Portage web** : utiliser une lib décimale (`decimal.js`, `big.js`) configurée à
  `precision = 28` et `rounding = ROUND_HALF_UP` pour les `quantize`, OU faire toute l'arithmétique
  en **centimes entiers** — mais attention, `price_per_g` n'est PAS arrondi (voir §7.1), un
  arrondi prématuré en centimes casserait le résultat. `decimal.js` est le choix sûr.
  Stockage D1/SQLite : stocker les euros en `TEXT` (ex. `"12.0000"`) ou en centimes `INTEGER`, jamais
  en `REAL`.

### 0.3 Dates

- Tous les champs date sont des `datetime` Python **naïfs** (pas de timezone dans le code du
  domaine). Aucun champ `date` pur.
- `IsoWeek` est la clé naturelle du calendrier ; on ne stocke pas de date pour les entrées de
  planning (voir §3.7).
- **Portage web** : `Date` JS ou string ISO-8601. Attention à ne pas introduire de décalage de
  timezone lors de la sérialisation (une date naïve « 2026-04-29 00:00 » ne doit pas devenir
  « 2026-04-28T22:00Z »). Recommandation : stocker en ISO local sans suffixe `Z`.

### 0.4 Langue

Les messages d'erreur des validateurs sont **en français** et sont potentiellement affichés à
l'utilisateur. Ils sont recopiés à l'identique ci-dessous et doivent être conservés.

---

## 1. Enums

Deux enums, tous deux `class X(str, Enum)` — donc **`Source.CIQUAL == "ciqual"` est `True`** et la
valeur stockée en base est la chaîne brute.

### 1.1 `Source` (`models.py:12`)

| Membre Python | Valeur stockée en base | Sens |
|---|---|---|
| `Source.CIQUAL` | `"ciqual"` | Table ANSES CIQUAL ; `source_ref` = `alim_code` |
| `Source.OPENFOODFACTS` | `"openfoodfacts"` | OpenFoodFacts ; `source_ref` = code-barres EAN |
| `Source.MANUAL` | `"manual"` | Saisi à la main ; `source_ref = NULL` |
| `Source.LIDL` | `"lidl"` | **Non documenté dans CLAUDE.md.** Ingrédient identifié par son ID produit Lidl Plus ; `source_ref` = `art_id` Lidl. Permet un mapping déterministe lors des imports de tickets Lidl via `IngredientRepo.find_by_source_ref(LIDL, art_id)` |

Défaut du champ `Ingredient.source` : `Source.MANUAL`.

```ts
export const Source = z.enum(["ciqual", "openfoodfacts", "manual", "lidl"]);
```

### 1.2 `MealSlot` (`models.py:23`)

5 créneaux : 3 par défaut (matin / midi / soir) + 2 créneaux collation optionnels activables via le
menu « Affichage ».

| Membre Python | Valeur stockée en base | Libellé métier |
|---|---|---|
| `MealSlot.MORNING` | `"morning"` | matin |
| `MealSlot.SNACK_MORNING` | `"snack_morning"` | collation ~10 h |
| `MealSlot.NOON` | `"noon"` | midi |
| `MealSlot.SNACK_AFTERNOON` | `"snack_afternoon"` | collation ~16 h |
| `MealSlot.EVENING` | `"evening"` | soir |

**Ordre d'affichage de la grille (chronologique)** : `morning → snack_morning → noon →
snack_afternoon → evening`. Cet ordre est celui de déclaration de l'enum ; il ne correspond PAS à un
tri alphabétique. À conserver en dur côté web.

```ts
export const MealSlot = z.enum([
  "morning", "snack_morning", "noon", "snack_afternoon", "evening",
]);
```

---

## 2. `models.py` — modèles Pydantic principaux

### 2.1 `Ingredient` (`models.py:38`)

`model_config = ConfigDict(frozen=False)` → **mutable**.

Nutrition exprimée **pour 100 g** (convention CIQUAL). `None` signifie **« inconnu »** et est
sémantiquement distinct de `0`.

| Champ | Type Python | Défaut | Contrainte | Commentaire de portage |
|---|---|---|---|---|
| `id` | `int \| None` | `None` | — | PK, `None` tant que non persisté |
| `name` | `str` | **obligatoire** | validator : non vide après `strip()` | ⚠️ la valeur n'est **PAS** trimmée, seulement contrôlée |
| `source` | `Source` | `Source.MANUAL` | enum | |
| `source_ref` | `str \| None` | `None` | — | code CIQUAL, EAN, ou `art_id` Lidl selon `source` |
| `brand` | `str \| None` | `None` | — | **Non documenté dans CLAUDE.md.** Marque commerciale (« Pâturages », « Carrefour Bio »). Auto-rempli depuis le champ `brands` de l'API OFF, éditable manuellement |
| `kcal_per_100g` | `float \| None` | `None` | ≥ 0 si non-`None` | |
| `proteins_g` | `float \| None` | `None` | ≥ 0 si non-`None` | pour 100 g |
| `carbs_g` | `float \| None` | `None` | ≥ 0 si non-`None` | pour 100 g |
| `sugars_g` | `float \| None` | `None` | ≥ 0 si non-`None` | pour 100 g |
| `fats_g` | `float \| None` | `None` | ≥ 0 si non-`None` | pour 100 g |
| `saturated_fats_g` | `float \| None` | `None` | ≥ 0 si non-`None` | pour 100 g |
| `fiber_g` | `float \| None` | `None` | ≥ 0 si non-`None` | pour 100 g |
| `salt_g` | `float \| None` | `None` | ≥ 0 si non-`None` | pour 100 g |
| `price_eur` | `Decimal \| None` | `None` | **> 0** strict si non-`None` | prix saisi par l'utilisateur (OFF n'expose pas de prix) |
| `price_quantity_g` | `float \| None` | `None` | **> 0** strict si non-`None` | masse à laquelle `price_eur` se rapporte (ex. paquet de 250 g) |
| `piece_weight_g` | `float \| None` | `None` | **> 0** strict si non-`None` | masse d'« une pièce » : 1 œuf ≈ 60 g, 1 oignon ≈ 150 g, 1 gousse d'ail ≈ 5 g. `None` = pas de taille de pièce naturelle (huile, riz, sel) |
| `cooked_weight_per_100g_raw` | `float \| None` | `None` | **> 0** strict si non-`None` | **Non documenté dans CLAUDE.md.** Poids cuit pour 100 g cru. `NULL` = pas de conversion connue → on assume 1:1. Ex. riz : `300.0` (100 g cru → 300 g cuit). ⚠️ **Les valeurs nutritionnelles restent calculées en CRU** — ce champ ne sert qu'à estimer le poids d'une portion servie sur la page Recettes |
| `in_personal_library` | `bool` | `False` | — | `True` quand l'utilisateur a explicitement ajouté l'entrée à sa bibliothèque de travail. Les lignes CIQUAL/OFF semées démarrent à `False` : cherchables depuis le picker, invisibles dans l'onglet Ingrédients |
| `category_l1` | `str \| None` | `None` | — | catégorie racine (CIQUAL `alim_grp_nom_fr`) ; vide pour OFF/manuel |
| `category_l2` | `str \| None` | `None` | — | sous-catégorie (CIQUAL `alim_ssgrp_nom_fr`) ; le 3ᵉ niveau CIQUAL n'est pas persisté (trop granulaire) |
| `season_months` | `str \| None` | `None` | — | **Non documenté dans CLAUDE.md.** CSV de mois 1..12, ex. `"6,7,8,9"` = juin→septembre. `NULL` = pas de donnée (le badge QML « 🌱 de saison » n'est pas affiché). Semé automatiquement par `app/data/seeds/seasons.py` pour ~50 ingrédients connus, éditable par l'utilisateur |
| `created_at` | `datetime \| None` | `None` | — | |
| `updated_at` | `datetime \| None` | `None` | — | |

#### Validateurs (recopiés)

```python
@field_validator("name")
def _name_not_empty(cls, v: str) -> str:
    if not v or not v.strip():
        raise ValueError("Le nom de l'ingrédient ne peut pas être vide.")
    return v

@field_validator("kcal_per_100g", "proteins_g", "carbs_g", "sugars_g",
                 "fats_g", "saturated_fats_g", "fiber_g", "salt_g")
def _macros_non_negative(cls, v: float | None) -> float | None:
    if v is not None and v < 0:
        raise ValueError("Les macros par 100 g ne peuvent pas être négatives.")
    return v

@field_validator("price_eur")
def _price_strictly_positive(cls, v: Decimal | None) -> Decimal | None:
    if v is not None and v <= 0:
        raise ValueError("Le prix doit être strictement positif.")
    return v

@field_validator("price_quantity_g", "piece_weight_g", "cooked_weight_per_100g_raw")
def _quantity_strictly_positive(cls, v: float | None) -> float | None:
    if v is not None and v <= 0:
        raise ValueError("Une quantité (g) doit être strictement positive.")
    return v
```

Points fins :
- macros : `0.0` est **valide** (l'eau à 0 kcal est plausible), `-0.1` est rejeté.
- prix : `Decimal("0")` est **rejeté** (`<= 0`), `Decimal("0.01")` accepté.
- quantités : `0.0` **rejeté**, contrairement aux macros.

#### Propriété calculée `price_per_g`

```python
@property
def price_per_g(self) -> Decimal | None:
    if self.price_eur is None or not self.price_quantity_g:
        return None
    return self.price_eur / Decimal(str(self.price_quantity_g))
```

- Retourne `None` si `price_eur is None` **ou** si `price_quantity_g` est falsy (`None` **ou** `0.0`
  — bien que `0.0` soit déjà interdit par le validateur, la garde est défensive).
- **Aucun arrondi** : la division utilise la précision décimale de contexte (28 chiffres
  significatifs). Ex. `3.99 / 250` → `0.01596` exact.
- **Portage** : ne surtout pas arrondir ici, l'arrondi n'intervient qu'au niveau ligne (§7).

#### Esquisse Zod

```ts
export const IngredientSchema = z.object({
  id: z.number().int().nullable().default(null),
  name: z.string().refine(s => s.trim().length > 0,
        "Le nom de l'ingrédient ne peut pas être vide."),
  source: Source.default("manual"),
  source_ref: z.string().nullable().default(null),
  brand: z.string().nullable().default(null),
  kcal_per_100g: z.number().min(0).nullable().default(null),
  proteins_g: z.number().min(0).nullable().default(null),
  carbs_g: z.number().min(0).nullable().default(null),
  sugars_g: z.number().min(0).nullable().default(null),
  fats_g: z.number().min(0).nullable().default(null),
  saturated_fats_g: z.number().min(0).nullable().default(null),
  fiber_g: z.number().min(0).nullable().default(null),
  salt_g: z.number().min(0).nullable().default(null),
  price_eur: DecimalString.refine(d => d.gt(0),
        "Le prix doit être strictement positif.").nullable().default(null),
  price_quantity_g: z.number().positive().nullable().default(null),
  piece_weight_g: z.number().positive().nullable().default(null),
  cooked_weight_per_100g_raw: z.number().positive().nullable().default(null),
  in_personal_library: z.boolean().default(false),
  category_l1: z.string().nullable().default(null),
  category_l2: z.string().nullable().default(null),
  season_months: z.string().nullable().default(null),
  created_at: z.coerce.date().nullable().default(null),
  updated_at: z.coerce.date().nullable().default(null),
});
```

---

### 2.2 `RecipeLine` (`models.py:150`)

Une ligne d'ingrédient dans une recette, **normalisée en grammes**.

| Champ | Type | Défaut | Contrainte |
|---|---|---|---|
| `ingredient` | `Ingredient` | **obligatoire** | objet imbriqué complet (pas un id) |
| `quantity_g` | `float` | **obligatoire** | `Field(gt=0)` — strictement positif |
| `unit` | `str \| None` | `None` | — |
| `notes` | `str \| None` | `None` | — |
| `ordinal` | `int` | `0` | `Field(ge=0)` |

`unit` (**non documenté dans CLAUDE.md**) : code d'unité *saisi par l'utilisateur* dans le
`QuantityField`. Valeurs possibles selon la docstring : `g, kg, ml, cl, dl, L, c_cafe, c_soupe,
tasse, pincee, _piece`. Il est stocké **uniquement pour restituer fidèlement le choix utilisateur au
rechargement** — sans ce champ, l'heuristique du `QuantityField` (« `_piece` si `pieceWeightG > 0` »)
écraserait le choix. `None` = recettes saisies avant la migration → le widget retombe sur son défaut.

⚠️ **`_piece` n'existe PAS dans `units.py`** — voir §6.3.

⚠️ **Aucune validation sur `unit`** : n'importe quelle chaîne est acceptée par le modèle. La
cohérence est purement UI.

Note importante pour le portage : `RecipeLine` embarque l'**objet `Ingredient` entier**, pas un
`ingredient_id`. Les fonctions de nutrition et de coût en dépendent. Côté web, la couche API devra
hydrater les lignes de recette avec l'ingrédient complet avant tout calcul.

---

### 2.3 `Tag` (`models.py:167`)

`model_config = ConfigDict(frozen=False)`. **Non documenté dans CLAUDE.md.**

| Champ | Type | Défaut | Contrainte |
|---|---|---|---|
| `id` | `int \| None` | `None` | — |
| `name` | `str` | **obligatoire** | non vide après `strip()` — message : `"Le nom du tag ne peut pas être vide."` |
| `color_hex` | `str` | `"#9ca3af"` | **aucune validation** — format attendu `#RRGGBB` ou `#RRGGBBAA` |
| `created_at` | `datetime \| None` | `None` | — |

Le défaut `"#9ca3af"` est un gris neutre (Tailwind gray-400). Le commentaire du code assume que
« Qt accepte tout ce qui est raisonnable » — côté web il faudra **ajouter une validation** ou
sanitiser, car une chaîne arbitraire injectée dans du CSS est un risque.

---

### 2.4 `Recipe` (`models.py:188`)

Pas de `model_config` explicite → mutable, `extra="ignore"`.

| Champ | Type | Défaut | Contrainte |
|---|---|---|---|
| `id` | `int \| None` | `None` | — |
| `name` | `str` | **obligatoire** | non vide après `strip()` — `"Le nom de la recette ne peut pas être vide."` |
| `instructions` | `str` | `""` | — |
| `default_portions` | `int` | `1` | `Field(ge=1)` |
| `image_path` | `str \| None` | `None` | chemin **système de fichiers local** — voir §9.1 |
| `lines` | `list[RecipeLine]` | `[]` (`default_factory=list`) | — |
| `tags` | `list[Tag]` | `[]` (`default_factory=list`) | — |
| `created_at` | `datetime \| None` | `None` | — |
| `updated_at` | `datetime \| None` | `None` | — |

⚠️ Il n'y a **pas** de champ `prep_time_min` sur `Recipe`, alors que `ExtractedRecipe` (import URL,
§5.2) en possède un. **Ambiguïté relevée** : le temps de préparation extrait d'une page web n'a
apparemment nulle part où atterrir dans le modèle persisté. À vérifier côté data/VM.

---

### 2.5 `NutritionTotal` (`models.py:208`)

Valeurs **absolues** (pas pour 100 g). Tous les champs sont des `float` avec défaut `0.0`, aucune
contrainte de signe.

Champs : `kcal`, `proteins_g`, `carbs_g`, `sugars_g`, `fats_g`, `saturated_fats_g`, `fiber_g`,
`salt_g` — tous `float = 0.0`.

Deux opérations :

```python
def __add__(self, other: NutritionTotal) -> NutritionTotal:
    # somme champ à champ, retourne un NOUVEL objet
```

```python
def divided_by(self, n: float) -> NutritionTotal:
    if n <= 0:
        raise ValueError("portions must be > 0")
    # divise chaque champ par n, retourne un NOUVEL objet
```

**Cas limite** : `divided_by(0)` et `divided_by(-1)` lèvent `ValueError("portions must be > 0")`
(message en anglais, contrairement aux autres). Pas de division par zéro possible.

Arithmétique en **flottant IEEE 754 double**, aucun arrondi. Le portage JS (`number` = double)
produit des résultats bit-à-bit identiques.

---

### 2.6 `IsoWeek` (`models.py:247`)

Clé naturelle du calendrier. Format `'<year>-W<week>'`, ex. `'2026-W18'`.

| Champ | Type | Contrainte |
|---|---|---|
| `value` | `str` | validateur ci-dessous |

```python
@field_validator("value")
def _validate(cls, v: str) -> str:
    # Format YYYY-Www, week 01-53.
    if len(v) != 8 or v[4:6] != "-W":
        raise ValueError(f"invalid ISO week '{v}', expected 'YYYY-Www'")
    year = int(v[:4])
    week = int(v[6:])
    if not (2000 <= year <= 2100):
        raise ValueError(f"year out of range: {year}")
    if not (1 <= week <= 53):
        raise ValueError(f"week out of range: {week}")
    return v
```

Algorithme exact :
1. Longueur **exactement 8** caractères, et les caractères d'indices 4 et 5 valent `"-W"`.
2. `year = int(v[0:4])`, `week = int(v[6:8])` — ⚠️ `int()` lève `ValueError` sur du non-numérique
   (ex. `"abcd-W12"` échoue au parse, pas au format).
   ⚠️ `int()` Python accepte les espaces et un signe : `"  12"` → 12. Avec 8 caractères fixes,
   `"2026-W 5"` passerait donc le parse → **piège de portage**, préférer une regex stricte
   `/^\d{4}-W\d{2}$/` côté web (comportement plus sûr, strictement plus restrictif).
3. Bornes : `2000 <= year <= 2100`, `1 <= week <= 53`.
4. La valeur d'origine est retournée **telle quelle** (pas de normalisation, pas de zero-padding
   ajouté a posteriori).

```python
@classmethod
def from_date(cls, dt: datetime) -> IsoWeek:
    iso = dt.isocalendar()
    return cls(value=f"{iso.year:04d}-W{iso.week:02d}")
```

⚠️ **`iso.year` est l'année ISO**, pas l'année civile : le 31/12/2024 est en `2025-W01`. Le portage
JS doit implémenter le calcul ISO-8601 correct (semaine commençant lundi, semaine 1 = celle qui
contient le premier jeudi). Ne pas utiliser un simple `getFullYear()`.

Padding : année sur 4 chiffres, semaine sur **2 chiffres avec zéro de tête** (`W01`, pas `W1`).

---

### 2.7 `WeeklyCostSnapshot` (`models.py:272`)

`model_config = ConfigDict(frozen=True)` → **immuable**. **Non documenté dans CLAUDE.md.**

Instantané du coût total du planning pour une semaine ISO. Auto-capturé par le viewmodel calendrier à
chaque rafraîchissement ; le snapshot le plus récent d'une semaine reflète l'état courant. Alimente
le mini-graphe « 12 dernières semaines » de la page Calendrier.

| Champ | Type | Défaut | Contrainte |
|---|---|---|---|
| `iso_week` | `str` | **obligatoire** | ⚠️ **`str` brut, pas `IsoWeek`** → aucune validation de format |
| `total_eur` | `Decimal` | **obligatoire** | aucune contrainte (0 accepté, négatif accepté) |
| `missing_count` | `int` | `0` | aucune contrainte |
| `captured_at` | `datetime \| None` | `None` | — |

---

### 2.8 `PriceHistoryEntry` (`models.py:288`)

`model_config = ConfigDict(frozen=False)`. **Non documenté dans CLAUDE.md.**

Un prix observé pour un ingrédient à une date / dans une enseigne. Alimente le tableau + graphe
d'historique des prix (bouton à côté du champ prix sur la page Ingrédients).

**Règle métier explicite** : le prix « courant » porté par l'`Ingredient` reste la valeur de
référence *curatée par l'utilisateur*. Cette table est purement **additive / observationnelle** : on
**n'écrase jamais automatiquement** `Ingredient.price_eur`. Re-stamper le prix de référence est un
choix de l'utilisateur (ex. bouton « Définir comme prix actuel »).

| Champ | Type | Défaut | Contrainte |
|---|---|---|---|
| `id` | `int \| None` | `None` | — |
| `ingredient_id` | `int` | **obligatoire** | FK, pas d'objet imbriqué |
| `price_eur` | `Decimal` | **obligatoire** | `Field(gt=0)` |
| `quantity_g` | `float` | **obligatoire** | `Field(gt=0)` — quantité de référence (taille du paquet) |
| `store` | `str \| None` | `None` | enseigne : Auchan / Lidl / Carrefour / … (texte libre) |
| `recorded_at` | `datetime` | **obligatoire** | date d'observation, saisie par l'utilisateur |
| `notes` | `str \| None` | `None` | — |
| `created_at` | `datetime \| None` | `None` | — |

#### Propriété calculée

```python
@property
def price_per_100g(self) -> Decimal:
    return self.price_eur * Decimal("100") / Decimal(str(self.quantity_g))
```

- Ordre des opérations : **multiplication d'abord**, puis division. À reproduire tel quel (le
  résultat en décimal à 28 chiffres peut différer de `(price/qty)*100` sur les cas non exacts).
- **Aucun arrondi**. Pas de garde `None` nécessaire : `quantity_g > 0` est garanti par `Field(gt=0)`.

---

### 2.9 `CookingLogEntry` (`models.py:316`)

`model_config = ConfigDict(frozen=False)`. **Non documenté dans CLAUDE.md.**

Une observation « j'ai cuisiné cette recette ». Sert à construire l'historique de cuisine : « j'ai
mis trop de sel la dernière fois », nombre de fois cuisinée ce mois-ci, dernière note. Le champ
`notes` est décrit comme le plus utile.

| Champ | Type | Défaut | Contrainte |
|---|---|---|---|
| `id` | `int \| None` | `None` | — |
| `recipe_id` | `int` | **obligatoire** | FK |
| `cooked_at` | `datetime` | **obligatoire** | — |
| `rating` | `int \| None` | `None` | validateur : `None` OU `1 <= rating <= 5` |
| `notes` | `str \| None` | `None` | texte libre court |
| `created_at` | `datetime \| None` | `None` | — |

```python
@field_validator("rating")
def _rating_in_range(cls, v: int | None) -> int | None:
    if v is None:
        return None
    if not 1 <= v <= 5:
        raise ValueError("La note doit être comprise entre 1 et 5.")
    return v
```

⚠️ `rating = 0` est **rejeté** (pas de « zéro étoile »).

---

### 2.10 `PantryStock` (`models.py:344`)

`model_config = ConfigDict(frozen=False)`. **Non documenté dans CLAUDE.md.**

Une entrée de l'inventaire frigo / placard.

| Champ | Type | Défaut | Contrainte |
|---|---|---|---|
| `id` | `int \| None` | `None` | — |
| `ingredient_id` | `int` | **obligatoire** | FK |
| `quantity_g` | `float` | **obligatoire** | `Field(gt=0)` |
| `expiry_date` | `datetime \| None` | `None` | `None` = pas de péremption suivie (ex. le sel) |
| `notes` | `str \| None` | `None` | — |
| `added_at` | `datetime \| None` | `None` | — |
| `updated_at` | `datetime \| None` | `None` | — |

**Règles d'affichage documentées dans la docstring** (implémentées ailleurs — la logique n'est PAS
dans le domaine, seulement décrite ici). La page `PantryPage` dérive trois sections de
`expiry_date - today` :

| Section | Condition | Badge |
|---|---|---|
| « À consommer vite » | `≤ 5 jours` | rouge |
| « À surveiller » | `≤ 14 jours` | orange |
| « En stock » | le reste | groupé par `ingredient.category_l1` |

⚠️ **Ambiguïté** : la docstring ne précise pas le traitement des dates **déjà dépassées** (delta
négatif) ni des entrées sans `expiry_date`. Le libellé « ≤ 5 » les inclurait dans « À consommer
vite » pour les négatifs ; les `None` n'ont pas de section explicite. À vérifier dans la couche UI.

**Lien avec la liste de courses** : `aggregate_shopping_list` lit les niveaux de stock et pré-coche
« déjà au frigo » quand `quantity_g >= required` (voir §4.1).

---

### 2.11 `MealPlanEntry` (`models.py:369`)

Un élément placé dans un créneau du calendrier hebdomadaire. Pas de `model_config` explicite.

| Champ | Type | Défaut | Contrainte |
|---|---|---|---|
| `id` | `int \| None` | `None` | — |
| `iso_week` | `str` | **obligatoire** | ⚠️ **`str` brut, pas `IsoWeek`** → aucune validation de format à ce niveau |
| `day_of_week` | `int` | **obligatoire** | `Field(ge=0, le=6)` — **0 = lundi**, 6 = dimanche |
| `slot` | `MealSlot` | **obligatoire** | enum |
| `recipe_id` | `int \| None` | `None` | XOR avec `ingredient_id` |
| `ingredient_id` | `int \| None` | `None` | XOR avec `recipe_id` |
| `quantity_g` | `float \| None` | `None` | > 0 si non-`None` ; **requis** quand `ingredient_id` est posé |
| `portions` | `float \| None` | `None` | > 0 si non-`None` ; **requis** quand `recipe_id` est posé. ⚠️ **`float`**, pas `int` — on peut planifier 0.5 portion |
| `ordinal` | `int` | `0` | **aucune contrainte** (négatif accepté) |

```python
@field_validator("quantity_g", "portions")
def _strictly_positive_when_set(cls, v: float | None) -> float | None:
    if v is not None and v <= 0:
        raise ValueError("quantity_g et portions doivent être strictement positifs.")
    return v

@model_validator(mode="after")
def _exclusive_target(self) -> MealPlanEntry:
    has_recipe = self.recipe_id is not None
    has_ingredient = self.ingredient_id is not None
    if has_recipe == has_ingredient:
        raise ValueError(
            "MealPlanEntry must reference exactly one of recipe_id / ingredient_id"
        )
    if has_recipe and self.portions is None:
        raise ValueError("portions is required when recipe_id is set")
    if has_ingredient and self.quantity_g is None:
        raise ValueError("quantity_g is required when ingredient_id is set")
    return self
```

Algorithme XOR, tel quel :
1. Si les deux ids sont posés **ou** les deux absents → erreur (`has_recipe == has_ingredient`).
2. Branche recette → `portions` obligatoire.
3. Branche ingrédient → `quantity_g` obligatoire.
4. ⚠️ **Aucune règle n'interdit** de poser `quantity_g` sur une entrée recette, ni `portions` sur une
   entrée ingrédient. Les champs « en trop » sont tolérés et simplement ignorés par les
   consommateurs. **Ambiguïté** : le comportement attendu côté web est probablement de les mettre à
   `NULL`, mais le domaine actuel ne le fait pas.

**Portage** : en Zod, un `.superRefine()` sur l'objet ou un `z.discriminatedUnion` sur un champ
`target` synthétique. Attention : le contrat de sortie doit rester le même (les deux colonnes,
l'une `NULL`), la contrainte XOR étant appliquée au niveau repository (pas de CHECK en base).

---

## 3. `shopping.py` — modèles de la liste de courses

Snapshot des ingrédients agrégés pour une période (typiquement une semaine ISO). Construit par
`app.services.shopping_service.aggregate_shopping_list()` (couche service, résumée en §8 parce que
les tests domaine la couvrent).

### 3.1 `ShoppingItem`

`model_config = ConfigDict(frozen=True)` → **immuable**.

| Champ | Type | Défaut | Contrainte |
|---|---|---|---|
| `ingredient_id` | `int` | **obligatoire** | — |
| `name` | `str` | **obligatoire** | — |
| `source` | `str` | **obligatoire** | ⚠️ **`str` brut, pas l'enum `Source`** — alimenté par `ing.source.value` |
| `quantity_g` | `float` | **obligatoire** | `Field(ge=0)` — ⚠️ **≥ 0**, contrairement à `RecipeLine.quantity_g` qui est `> 0` |
| `piece_weight_g` | `float \| None` | `None` | — |
| `category_l1` | `str \| None` | `None` | `None` → regroupé sous « Non catégorisé » |
| `cost_eur` | `Decimal \| None` | `None` | `None` quand l'ingrédient n'a pas de prix |
| `in_pantry_g` | `float` | `0.0` | quantité déjà présente dans le garde-manger, estampillée depuis `PantryRepo` |

#### Propriétés calculées

```python
@property
def has_price(self) -> bool:
    return self.cost_eur is not None

@property
def is_covered_by_pantry(self) -> bool:
    return self.in_pantry_g >= self.quantity_g and self.quantity_g > 0

@property
def piece_count(self) -> float | None:
    if not self.piece_weight_g:
        return None
    return self.quantity_g / self.piece_weight_g
```

Cas limites :
- `is_covered_by_pantry` est `False` quand `quantity_g == 0` **même si** `in_pantry_g > 0` (la
  seconde condition `quantity_g > 0` l'exige). Pilote l'auto-cochage de « déjà au frigo ».
- `piece_count` retourne `None` si `piece_weight_g` est `None` **ou** `0.0` (test de truthiness) →
  pas de division par zéro possible.

### 3.2 `ShoppingList`

`model_config = ConfigDict(frozen=True)` → **immuable**.

| Champ | Type | Défaut |
|---|---|---|
| `iso_week` | `str` | **obligatoire** (str brut, non validé) |
| `items` | `list[ShoppingItem]` | `[]` |
| `total_eur` | `Decimal` | `Decimal("0.00")` |
| `missing_price_count` | `int` | `0` |

Sémantique de `total_eur` : **somme des `cost_eur` des seuls items qui ont un prix**. Les items sans
prix sont exclus du total mais comptés dans `missing_price_count`.

Propriété calculée : `item_count` → `len(self.items)`.

---

## 4. `receipt.py` — pipeline « ticket de caisse » (Plan v3)

⚠️ **Fonctionnalité entièrement absente de `CLAUDE.md`.**

Ce sont des **`@dataclass` Python, PAS des modèles Pydantic** : aucune validation, aucune
coercition, aucun message d'erreur. Le portage TS peut se contenter d'`interface` + fonctions
utilitaires.

Position dans le pipeline :
`parsers (app/services/receipt_parser/*) → ParsedReceipt → matcher (app/services/receipt_matcher.py)
→ MatchedReceipt → viewmodel (app/ui/viewmodels/receipt_import_vm.py) → QML pour revue → commit`.

### 4.1 `ParsedLine` (`@dataclass(frozen=False)`)

Une ligne de ticket extraite, **avant** matching.

| Champ | Type | Défaut |
|---|---|---|
| `raw_name` | `str` | **obligatoire** |
| `store_key` | `str` | **obligatoire** |
| `quantity` | `int` | `1` |
| `unit_price` | `Decimal \| None` | `None` |
| `total_price` | `Decimal \| None` | `None` |
| `vat_code` | `str` | `""` |

- `raw_name` : ce que le ticket imprime, souvent tronqué (exemple donné dans le code :
  `"FRANUI FRAMBSE CHOCO"` pour « Franui Framboise Chocolat »).
- `store_key` : forme normalisée servant de clé de recherche dans la table `receipt_alias` :
  - **Intermarché** : `raw_name.casefold()` après collapse des espaces
  - **Lidl** : le `lidl_art_id` renvoyé par l'API (ID Lidl stable)
  - **Carrefour** : TBD (probablement `raw_name` normalisé) — **non implémenté**
- `vat_code` : bucket TVA du ticket (`A` / `B` / `C` / …).

```python
@property
def effective_total(self) -> Decimal:
    if self.total_price is not None:
        return self.total_price
    if self.unit_price is not None:
        return self.unit_price * Decimal(self.quantity)
    return Decimal("0")
```

Algorithme : « meilleur effort » — priorité au `total_price` s'il est posé ; sinon
`unit_price × quantity` ; sinon `Decimal("0")`. **Aucun arrondi.** Noter `Decimal(self.quantity)`
(depuis un `int`, exact) et non `Decimal(str(...))`.

```python
@property
def is_likely_food(self) -> bool:
    return self.vat_code == "A" or self.vat_code == ""
```

Heuristique métier (recopiée du commentaire) : en France, le **code A = TVA 5,5 % = alimentaire**.
Tout autre code (B = 20 %, C = 10 %) est plus probablement non-alimentaire ou service. Le dialogue de
revue **masque par défaut les lignes non-A** et l'utilisateur peut les inclure manuellement (exemple
donné : l'huile d'olive taxée en B). Le code vide `""` est traité comme alimentaire (cas des parsers
qui n'extraient pas la TVA, ex. Lidl).

### 4.2 `ParsedReceipt` (`@dataclass(frozen=False)`)

| Champ | Type | Défaut |
|---|---|---|
| `store` | `str` | **obligatoire** |
| `ticket_id` | `str \| None` | `None` |
| `date` | `datetime \| None` | `None` |
| `lines` | `list[ParsedLine]` | `[]` (`field(default_factory=list)`) |
| `raw_text` | `str` | `""` |
| `total_eur` | `Decimal \| None` | `None` |

- `store` : slug court — `intermarche` / `lidl` / `carrefour`. Sert de **clé de partition** dans
  `receipt_alias.store` et `imported_receipt.store`.
- `ticket_id` : doit être unique **par ticket réel** (pas par import) — pilote l'anti-doublon.
  Sources : Intermarché = le long code-barres numérique en bas du PDF ; Lidl = `data-return-code`
  (HTML) ou `id` (JSON API) ; Carrefour = TBD.
- `raw_text` : conservé pour le debug / l'affichage de repli.

Propriétés calculées :
- `line_count` → `len(self.lines)`
- `food_lines` → `[line for line in self.lines if line.is_likely_food]`

### 4.3 `MatchedLine` (`@dataclass(frozen=False)`)

Une `ParsedLine` après résolution par le matcher. **Objet mutable de travail** modifié en place par
le dialogue de revue.

| Champ | Type | Défaut | Sens |
|---|---|---|---|
| `parsed` | `ParsedLine` | **obligatoire** | la ligne source |
| `suggestions` | `list[int]` | `[]` | ids d'ingrédients, **le meilleur en premier** |
| `chosen_ingredient_id` | `int \| None` | `None` | pick final de l'utilisateur après revue |
| `match_source` | `str` | `"none"` | voir table ci-dessous |
| `match_score` | `float` | `0.0` | plage **0.0–1.0** ; alias / source_ref = `1.0`, fuzzy variable |
| `add_to_pantry` | `bool` | `False` | toggle utilisateur dans le dialogue |
| `expiry_date` | `datetime \| None` | `None` | si `add_to_pantry`, péremption facultative |
| `user_barcode` | `str` | `""` | EAN saisi par l'utilisateur sur la ligne. Utilisé soit pour un lookup OFF immédiat, soit comme `source_ref` si l'utilisateur clique « Créer » sans ouvrir le mini-formulaire |
| `quantity_g` | `float` | `0.0` | quantité réelle **en grammes** saisie via le `QuantityField`. `0.0` = pas encore saisi |
| `user_price_override` | `bool` | `False` | vrai si l'utilisateur a édité le prix manuellement |

Valeurs de `match_source` (chaînes exactes, recopiées de la docstring) :

| Valeur | Sens |
|---|---|
| `"alias"` | trouvé dans `receipt_alias` (mapping déjà validé par l'utilisateur) |
| `"source_ref"` | match exact via `Source.LIDL` + `lidl_art_id` (pas de fuzzy) |
| `"fuzzy"` | meilleur match flou via `rapidfuzz` |
| `"none"` | pas de match, l'utilisateur doit créer ou choisir manuellement |

**Règles métier critiques encodées dans les commentaires** (à conserver au portage) :

- **Cascade de repli de la quantité au commit** : si `quantity_g > 0`, c'est **cette valeur qui
  prime** et c'est aussi elle qui alimente `PantryStock.quantity_g`. Sinon, le commit retombe sur :
  `ingredient.price_quantity_g` → `piece_weight_g × ticket_qty` → **`1000 g`** (dernier recours).
- **`user_price_override`** : quand vrai, il **bloque les recalculs automatiques** de `total_price`
  lors de l'édition de la quantité — sinon une promo ou un prix corrigé serait écrasé.

### 4.4 `MatchedReceipt` (`@dataclass(frozen=False)`)

| Champ | Type | Défaut |
|---|---|---|
| `parsed` | `ParsedReceipt` | **obligatoire** |
| `lines` | `list[MatchedLine]` | `[]` |
| `_is_duplicate` | `bool` | `False` (champ privé de la dataclass) |

Le code expose `is_duplicate` comme **property + setter** au-dessus du champ privé `_is_duplicate` :

```python
@property
def is_duplicate(self) -> bool:
    return self._is_duplicate

@is_duplicate.setter
def is_duplicate(self, v: bool) -> None:
    self._is_duplicate = v

_is_duplicate: bool = False
```

C'est un artefact Python (property + dataclass field) — **côté TS, un simple champ booléen
`isDuplicate` suffit**. Sémantique : positionné par le matcher quand `parsed.ticket_id` existe déjà
dans `imported_receipt`. Le dialogue affiche alors un avertissement + propose un import forcé.

---

## 5. `url_recipe.py` — pipeline « import de recette par URL »

⚠️ **Fonctionnalité entièrement absente de `CLAUDE.md`.**

Là encore : **`@dataclass`, pas Pydantic**. Aucune validation.

Trois états documentés :
1. **Extracted** — sortie brute du fetch/parse (`recipe-scrapers` ou repli Schema.org JSON-LD).
   Chaînes telles qu'imprimées sur la page, ingrédients encore en vrac (« 200 g de tomates cerises »).
2. **Resolved** — par ligne d'ingrédient, le matcher propose des ids candidats (perso → CIQUAL → OFF
   en cache). L'utilisateur choisit / ignore / crée.
3. **Committed** — l'utilisateur clique « Importer » → le VM construit une `Recipe` Pydantic normale
   avec ses `RecipeLine` et persiste via `RecipeRepo`. À partir de là la recette est
   **indiscernable** d'une recette créée à la main.

### 5.1 `ExtractedIngredient`

| Champ | Type | Défaut |
|---|---|---|
| `raw_text` | `str` | **obligatoire** — chaîne originale exacte, conservée pour debug / ré-extraction |
| `parsed_name` | `str` | **obligatoire** |
| `parsed_quantity` | `float \| None` | `None` |
| `parsed_unit` | `str \| None` | `None` — code issu de `app.domain.units.UNITS`, ou `None` |

Les champs `parsed_*` sont le meilleur effort de `parse_french_quantity`
(`app/services/recipe_url_importer/quantity_parser.py`) et **peuvent être `None`** quand le parseur
n'a pas su trancher (exemples donnés : « Sel, poivre », « une poignée de noisettes ») — l'utilisateur
corrigera dans l'assistant.

### 5.2 `ExtractedRecipe`

| Champ | Type | Défaut |
|---|---|---|
| `name` | `str` | **obligatoire** |
| `instructions` | `str` | `""` |
| `default_portions` | `int` | `1` |
| `prep_time_min` | `int \| None` | `None` |
| `image_url` | `str \| None` | `None` |
| `source_url` | `str` | `""` |
| `ingredients` | `list[ExtractedIngredient]` | `[]` |

**Règle explicite** : `image_url` est **capturée mais PAS téléchargée au commit** — l'utilisateur
pourra attacher une photo plus tard via le `RecipePhotoBlock` habituel. Justification donnée dans le
code : garder le chemin d'import léger (pas de Pillow au commit, moins d'erreurs réseau).

⚠️ **Ambiguïté** : ni `prep_time_min` ni `source_url` n'ont d'équivalent dans le modèle `Recipe`
persisté (§2.4). Ces données semblent perdues au commit. À confirmer côté VM.

### 5.3 `ResolvedLine`

Mutable **à dessein** — le VM le met à jour en place pendant l'assistant.

| Champ | Type | Défaut |
|---|---|---|
| `extracted` | `ExtractedIngredient` | **obligatoire** |
| `candidates` | `list[int]` | `[]` — ids d'ingrédients classés **meilleur en premier** par `resolve_ingredient_name` (perso > CIQUAL > OFF en cache) |
| `chosen_ingredient_id` | `int \| None` | `None` |
| `quantity_g` | `float` | `0.0` |
| `unit_code` | `str` | `"g"` |
| `is_ignored` | `bool` | `False` — exclut la ligne de la `Recipe` finale au commit |
| `is_manual_override` | `bool` | `False` — posé quand l'utilisateur édite `parsed_name`, pour que le VM sache qu'il doit relancer la recherche (vs la sortie d'origine du parseur) |

### 5.4 `ResolvedRecipeImport`

Le buffer mutable complet détenu par le VM pendant l'étape 1 de l'assistant.

| Champ | Type | Défaut |
|---|---|---|
| `extracted` | `ExtractedRecipe` | **obligatoire** |
| `lines` | `list[ResolvedLine]` | `[]` |

---

## 6. `units.py` — table de conversion complète

### 6.1 Structure

```python
@dataclass(frozen=True)
class Unit:
    code: str               # identifiant machine stable (utilisé comme itemData de combobox)
    label: str              # libellé français affiché
    grams_per_unit: float   # combien de grammes pèse une unité
```

### 6.2 Table `UNITS` — **l'ordre est l'ordre d'affichage dans les listes déroulantes**

| # | `code` | `label` | `grams_per_unit` | Note du code source |
|---|---|---|---|---|
| 0 | `g` | `g` | `1.0` | défaut, cas le plus courant |
| 1 | `kg` | `kg` | `1000.0` | |
| 2 | `mg` | `mg` | `0.001` | |
| 3 | `ml` | `ml` | `1.0` | densité 1 g/ml |
| 4 | `cl` | `cl` | `10.0` | |
| 5 | `dl` | `dl` | `100.0` | |
| 6 | `L` | `L` | `1000.0` | ⚠️ **L majuscule** |
| 7 | `c_cafe` | `c. à café` | `5.0` | ≈ 5 ml |
| 8 | `c_soupe` | `c. à soupe` | `15.0` | ≈ 15 ml |
| 9 | `tasse` | `tasse` | `250.0` | ≈ 250 ml |
| 10 | `pincee` | `pincée` | `1.0` | |

Constantes dérivées :
- `UNIT_BY_CODE: dict[str, Unit] = {u.code: u for u in UNITS}`
- `DEFAULT_UNIT_CODE = "g"`

**Hypothèse de densité, documentée dans l'en-tête du module** : les conversions volume → masse
assument une **densité par défaut de 1 g/ml** (type eau). Pour les liquides à densité connue, on
étendrait `Ingredient` plus tard ; pour le MVP ce défaut est « suffisamment bon » et correspond à ce
que font la plupart des applis de cuisine.

### 6.3 ⚠️ Le pseudo-code `_piece` — piège de portage

Le code `_piece` **n'existe PAS dans `UNITS`**. Il est fabriqué **dynamiquement à l'exécution** par
le composant `app/ui/qml/components/QuantityField.qml`, dont la table statique est un **miroir exact
byte-pour-byte de `UNITS`** (vérifié) préfixé conditionnellement :

```qml
function _buildUnits(pw) {
    if (pw && pw > 0) {
        return [{ code: "_piece", label: "pièce (" + _formatG(pw) + ")", factor: pw }]
            .concat(staticUnits)
    }
    return staticUnits
}
```

Conséquences pour le portage :
- Le facteur de `_piece` est **`ingredient.piece_weight_g`** — dynamique, dépendant de l'ingrédient.
- `_piece` est en **index 0** de la liste quand il est présent.
- **`to_grams(v, "_piece")` et `label_for("_piece")` lèvent `KeyError`** — les helpers de `units.py`
  ne connaissent pas ce code. Le code appelant doit court-circuiter, ce que fait bien
  `recipe_url_import_vm.py:225` : `to_grams(qty, unit) if qty > 0 and unit != "_piece" else qty * 1.0`.
  ⚠️ Ce court-circuit précis retourne `qty * 1.0` (donc **traite la quantité comme des grammes**, pas
  comme des pièces) — **ambiguïté / bug potentiel signalé** : dans ce chemin, `_piece` ne multiplie
  pas par `piece_weight_g`.
- `RecipeLine.unit` peut donc contenir `"_piece"` en base.
- **Recommandation web** : centraliser une seule table d'unités partagée front/worker et traiter
  `_piece` explicitement comme un cas spécial paramétré par l'ingrédient.

Le format du libellé de pièce (`_formatG`) : entier si `|g - round(g)| < 1e-6` (ex. `"pièce (60 g)"`),
sinon une décimale avec **virgule** comme séparateur (ex. `"pièce (7,5 g)"`).

### 6.4 Fonctions

```python
def to_grams(value: float, unit_code: str) -> float:
    return value * UNIT_BY_CODE[unit_code].grams_per_unit
```
Lève `KeyError` si le code est inconnu — le contrat est que l'appelant ne passe que des codes issus
de `UNITS`. **Aucun arrondi.**

```python
def from_grams(grams: float, unit_code: str) -> float:
    return grams / UNIT_BY_CODE[unit_code].grams_per_unit
```
Lève `KeyError` idem. Aucun `grams_per_unit` n'est nul → **pas de division par zéro possible**.
**Aucun arrondi.**

```python
def label_for(unit_code: str) -> str:
    return UNIT_BY_CODE[unit_code].label
```
Lève `KeyError` idem.

**Aller-retour** : `from_grams(to_grams(v, u), u) == v` à ~1e-9 près pour toutes les unités (garanti
par test, §10.3). Le seul cas à surveiller est `mg` (facteur `0.001`, non représentable exactement en
binaire) : `to_grams(500, "mg") == 0.5` exactement (500 × 0.001 = 0.5 en double), mais des valeurs
comme `0.1 mg` introduisent une erreur relative ~1e-17. Comportement **identique en JS**.

---

## 7. `pricing.py` — calculs de coût

```python
CENT = Decimal("0.01")
```

Toute l'arithmétique est en `Decimal`, arrondi **`ROUND_HALF_UP`** (arrondi « commercial », 0,5 →
haut) — **différent de l'arrondi bancaire par défaut de Python et de `Math.round` en JS pour les
négatifs**. À reproduire fidèlement.

### 7.1 `_line_cost(line: RecipeLine) -> Decimal | None` (privée)

```python
price_per_g = line.ingredient.price_per_g
if price_per_g is None:
    return None
return (price_per_g * Decimal(str(line.quantity_g))).quantize(CENT, rounding=ROUND_HALF_UP)
```

Algorithme :
1. `price_per_g = price_eur / Decimal(str(price_quantity_g))` — **non arrondi**, 28 chiffres
   significatifs (voir §2.1).
2. Multiplier par `Decimal(str(quantity_g))`.
3. **Quantifier au centime** avec `ROUND_HALF_UP`.
4. Retourne `None` si l'ingrédient n'a pas de prix.

Exemple de référence (verrouillé par test) : fromage à `3.99 €` pour `250 g` →
`price_per_g = 0.01596` → × 80 g = `1.2768` → **`1.28 €`**.

### 7.2 `recipe_cost(recipe: Recipe) -> tuple[Decimal, list[RecipeLine]]`

```python
total = Decimal("0.00")
missing: list[RecipeLine] = []
for line in recipe.lines:
    c = _line_cost(line)
    if c is None:
        missing.append(line)
    else:
        total += c
return total.quantize(CENT, rounding=ROUND_HALF_UP), missing
```

- ⚠️ **Arrondi-puis-somme** (round-then-sum), PAS somme-puis-arrondi : chaque ligne est arrondie au
  centime *avant* d'être ajoutée. C'est une décision de calcul à reproduire exactement, sinon des
  écarts d'un centime apparaîtront sur les recettes à nombreuses lignes.
- Retourne `(total, lignes_sans_prix)` pour que l'UI puisse signaler les données manquantes.
- Recette vide → `(Decimal("0.00"), [])`.
- Le `quantize` final est un no-op arithmétique (la somme de centimes est déjà au centime) mais
  garantit l'échelle `0.01` du `Decimal` retourné (important pour le formatage `"4.50"` vs `"4.5"`).

### 7.3 `recipe_cost_per_portion(recipe: Recipe) -> tuple[Decimal, list[RecipeLine]]`

```python
total, missing = recipe_cost(recipe)
portions = Decimal(recipe.default_portions)
return (total / portions).quantize(CENT, rounding=ROUND_HALF_UP), missing
```

- Divise le **total déjà arrondi** par le nombre de portions, puis re-quantifie au centime en
  `ROUND_HALF_UP`.
- `default_portions >= 1` est garanti par le modèle → **pas de division par zéro possible**.
- La liste `missing` retournée est celle de `recipe_cost` (non filtrée, non dédupliquée).

### 7.4 `ingredient_cost(ingredient: Ingredient, quantity_g: float) -> Decimal | None`

```python
price_per_g = ingredient.price_per_g
if price_per_g is None:
    return None
return (price_per_g * Decimal(str(quantity_g))).quantize(CENT, rounding=ROUND_HALF_UP)
```

Identique à `_line_cost` mais prend un `Ingredient` + une quantité au lieu d'une `RecipeLine`.
Utilisé par le calendrier et la liste de courses.

⚠️ Pas de garde sur `quantity_g` négatif → un coût négatif serait retourné tel quel.

---

## 8. `nutrition.py` — agrégation nutritionnelle

Arithmétique **flottante pure**, aucun arrondi, aucun `Decimal`.

### 8.1 `_macros_for(ingredient, quantity_g) -> NutritionTotal` (privée)

```python
factor = quantity_g / 100.0

def safe(v: float | None) -> float:
    return (v or 0.0) * factor

return NutritionTotal(
    kcal=safe(ingredient.kcal_per_100g),
    proteins_g=safe(ingredient.proteins_g),
    carbs_g=safe(ingredient.carbs_g),
    sugars_g=safe(ingredient.sugars_g),
    fats_g=safe(ingredient.fats_g),
    saturated_fats_g=safe(ingredient.saturated_fats_g),
    fiber_g=safe(ingredient.fiber_g),
    salt_g=safe(ingredient.salt_g),
)
```

**Règle métier centrale** : `None` (« inconnu ») contribue **`0`** à l'agrégat. Cette décision est
délibérée et documentée : « Missing fields contribute 0 ». Conséquence : un total de kcal peut être
sous-estimé silencieusement si des macros manquent — l'UI ne le signale pas depuis cette fonction.

`(v or 0.0)` : en Python, `0.0 or 0.0` → `0.0`, `None or 0.0` → `0.0`. Équivalent JS : `(v ?? 0)`
donne le même résultat pour les valeurs numériques concernées (toutes ≥ 0 par validation).

**Cas limite** : `quantity_g = 0` → `factor = 0` → tous les champs à `0.0`. Pas d'erreur.
`quantity_g` négatif (impossible via `RecipeLine`, possible via `ingredient_macros` direct) →
macros négatives.

### 8.2 `aggregate_lines(lines: list[RecipeLine]) -> NutritionTotal`

```python
total = NutritionTotal()
for line in lines:
    total = total + _macros_for(line.ingredient, line.quantity_g)
return total
```

Liste vide → `NutritionTotal()` = tous les champs à `0.0`.
L'ordre de sommation est l'ordre de la liste (pertinent pour la reproductibilité bit-à-bit en
flottant — à conserver, mais l'écart serait de l'ordre de 1e-15).

### 8.3 `aggregate_recipe(recipe: Recipe) -> tuple[NutritionTotal, NutritionTotal]`

```python
total = aggregate_lines(recipe.lines)
per_portion = total.divided_by(recipe.default_portions)
return total, per_portion
```

Retourne **le couple `(total_recette, par_portion)`**. `per_portion` utilise
`recipe.default_portions` (≥ 1 garanti) → `divided_by` ne peut pas lever.
Recette vide → `(0…, 0…)`.

### 8.4 `ingredient_macros(ingredient: Ingredient, quantity_g: float) -> NutritionTotal`

Simple wrapper public de `_macros_for`, utilisé quand une entrée de calendrier référence un
ingrédient brut (branche `ingredient_id` de `MealPlanEntry`).

### 8.5 ⚠️ Le champ `cooked_weight_per_100g_raw` n'intervient PAS ici

Confirmé par lecture : aucune fonction de `nutrition.py` ne lit
`Ingredient.cooked_weight_per_100g_raw`. La convention CIQUAL est respectée — **les macros sont
toujours calculées sur le poids CRU**. Le ratio cru→cuit sert uniquement à afficher une estimation de
poids de portion servie sur la page Recettes (logique dans la couche UI, hors périmètre de ce
document).

---

## 9. Service voisin nécessaire à la lecture des tests domaine

`app.services.shopping_service.aggregate_shopping_list(session, iso_week) -> ShoppingList` n'est pas
dans le domaine mais **produit les modèles de `shopping.py`** et est couvert par
`tests/test_shopping_service.py` (demandé dans le catalogue). Algorithme exact, pour référence :

1. Charger toutes les `MealPlanEntry` de la semaine (1 SELECT).
2. Pré-charger en une requête toutes les recettes référencées (`list_by_ids` + `selectinload` des
   lignes et tags) — évite le N+1.
3. Parcourir les entrées, agréger dans un dict `qty_by_ing: dict[int, float]` :
   - **Branche recette** : si la recette est absente (référence orpheline) → `continue`
     silencieusement. Sinon `default = max(recipe.default_portions, 1)` puis
     **`ratio = (entry.portions or 1.0) / default`** ; pour chaque ligne dont
     `line.ingredient.id is not None` : `qty_by_ing[id] += line.quantity_g * ratio`.
   - **Branche ingrédient** : `qty_by_ing[ingredient_id] += (entry.quantity_g or 0.0)`.
4. Pré-charger tous les ingrédients référencés en une requête ; pré-charger les totaux de garde-manger
   via `PantryRepo.aggregate_quantity_by_ingredient()` (un `SUM … GROUP BY`).
5. Pour chaque `(ing_id, total_g)` : ingrédient absent → `continue` ; sinon
   `cost = pricing.ingredient_cost(ing, total_g)` ; `cost is None` → `missing_count += 1`, sinon
   `total += cost`. Construire le `ShoppingItem` avec `source=ing.source.value` et
   `in_pantry_g = pantry_totals.get(ing_id, 0.0)`.
6. **Tri** (stable) :
   ```python
   items.sort(key=lambda i: (
       i.category_l1 is None,        # catégorisés d'abord (False < True)
       (i.category_l1 or "").lower(),
       i.name.lower(),
   ))
   ```
7. `total_eur = total.quantize(Decimal("0.01"))` — ⚠️ **sans `rounding=` explicite**, donc arrondi de
   contexte `ROUND_HALF_EVEN`, contrairement à `pricing.py` qui force `ROUND_HALF_UP`.
   **Incohérence signalée** ; en pratique inoffensive car la somme de centimes est déjà exacte au
   centime, mais à reproduire ou à harmoniser sciemment.

Dégradation silencieuse assumée : recettes supprimées, ingrédients manquants, prix manquants → on
saute / on compte, **on ne lève jamais**.

### `format_as_text(shopping_list) -> str` (export texte)

Rendu copiable vers un téléphone. Détails de formatage (verrouillés par tests) :

- Liste vide → `"Liste de courses — {iso_week}\n\n(aucun ingrédient)\n"` (tiret cadratin `—`).
- Sinon en-tête `"Liste de courses — {iso_week}"` puis ligne vide.
- Groupement par catégorie en **préservant l'ordre de tri** de `aggregate_shopping_list` :
  `cat = item.category_l1 or "Non catégorisé"` ; à chaque changement de catégorie, insérer
  `f"== {cat.capitalize()} =="`. ⚠️ `str.capitalize()` en Python **met la première lettre en
  majuscule ET le reste en minuscules** (`"fruits, LEGUMES"` → `"Fruits, legumes"`) — différent de
  `text-transform: capitalize` en CSS.
- Ligne d'item : `f"☐ {name} {qty}{cost}"` où `name = item.name[:40].ljust(40)` (tronqué à 40,
  complété à 40 par des espaces) et
  `cost = f"  ({item.cost_eur:.2f} €)".replace(".", ",")` (présent seulement si `has_price`).
- Quantité (`_format_quantity`) :
  - `quantity_g >= 1000` → kg : `f"{kg:.3f}".rstrip("0").rstrip(".").replace(".", ",") + " kg"`
    (ex. `1234 g` → `"1,234 kg"`, `2000 g` → `"2 kg"`).
  - `quantity_g >= 10` → `f"{quantity_g:.0f} g"`.
  - sinon → `f"{quantity_g:.1f} g"` (une décimale, **point** décimal non converti ici).
  - si `piece_weight_g` truthy et `> 0` → suffixe `" · ≈ {pieces} pièce"` + `"s"` si `pieces > 1`,
    `pieces = quantity_g / piece_weight_g` arrondi à 0,1 puis zéros de queue supprimés, point remplacé
    par une virgule.
- Pied : ligne vide, puis `"─" * 30` (tiret long U+2500), puis
  `f"Total : {total_str} €"` avec `total_str = f"{total_eur:.2f}".replace(".", ",")` ; si
  `missing_price_count > 0`, le total devient
  `f"Total : {total_str} € · {n} ingrédient(s) sans prix"`.
- Le texte se termine par `"\n"`.

---

## 10. Points spécifiques desktop / non portables tels quels

| Élément du domaine | Nature du problème | Équivalent web proposé |
|---|---|---|
| `Recipe.image_path: str \| None` | Chemin **système de fichiers local** (géré par `app/services/photo_service.py` avec Pillow). Aucun sens dans un Worker Cloudflare. | Stocker une clé R2 / une URL. Upload direct navigateur → R2 via URL présignée ; redimensionnement côté client (`canvas`) puisque Pillow n'existe pas dans un Worker. |
| `ParsedReceipt` produit à partir de PDF/HTML | Les parseurs (hors domaine) s'appuient sur `pdfplumber` (extraction texte native de PDF) et un **watcher de dossier** `watchdog` sur `~/Downloads/Tickets de caisse/`. | Upload manuel du PDF depuis le mobile → parsing dans le Worker (`unpdf` / `pdf.js` en WASM) ou côté client. Le watcher de dossier n'a **aucun équivalent web** : le remplacer par un bouton « importer un ticket » + éventuellement le Web Share Target API sur Android. |
| Matching flou `rapidfuzz` (`match_source == "fuzzy"`) | Bibliothèque C++ native. | Implémenter Levenshtein / token-set-ratio en TS (`fastest-levenshtein`, ou une réimplémentation du `token_set_ratio` de RapidFuzz). ⚠️ **Les scores ne seront pas identiques** → les seuils du matcher devront être recalibrés. |
| `Source.LIDL` + `MatchedLine.match_source == "source_ref"` | Dépend du client `lidl-plus` (Python, opt-in) et du stockage du refresh token dans le **Windows Credential Manager via `keyring`**. | Proxy dans le Worker + refresh token chiffré dans D1 ou dans KV avec chiffrement applicatif. Jamais de token côté client. |
| Import URL (`recipe-scrapers`, `beautifulsoup4`, `lxml`) | ~400 sites supportés nativement en Python. Aucun équivalent JS complet. | Fetch dans le Worker + parsing **Schema.org JSON-LD** (le chemin de repli déjà présent dans le projet) via `HTMLRewriter` ou `linkedom`. Accepter une couverture moindre. ⚠️ CORS : le fetch **doit** passer par le Worker. |
| `Decimal` Python | Précision 28 chiffres, `ROUND_HALF_UP` explicite. | `decimal.js` configuré `precision: 28`. Ne PAS utiliser `number`. |
| `datetime` naïf | Pas de timezone. | Éviter la sérialisation `Z` implicite ; stocker des ISO locales. |
| Ordre de l'enum `MealSlot` | Ordre chronologique porté par l'ordre de déclaration Python. | Tableau ordonné en dur côté TS. |
| `str.capitalize()`, `ljust()`, `"─" * 30` de `format_as_text` | Sémantiques Python spécifiques. | Réimplémenter explicitement (voir §9) — `text-transform: capitalize` en CSS ne fait PAS la même chose. |
| Parsing de `season_months` | Hors domaine : les helpers `_parse_season_months` / `_normalize_season_csv` vivent dans `app/ui/viewmodels/ingredient_vm.py`. Le domaine ne stocke que le CSV brut. | À déplacer dans la couche métier partagée lors du portage. Comportement à reproduire (verrouillé par `tests/test_seasonality.py`) : `None`/`""`/`"   "` → ensemble vide ; `"6,7,8,9"` → `{6,7,8,9}` ; les jetons non numériques et les vides sont **ignorés silencieusement** ; les mois hors 1..12 sont **supprimés** (`"0,13,5,99"` → `{5}`). |
| Catégories | ⚠️ Le domaine ne connaît **aucun modèle `Category`**. `CategoryNode` est une `@dataclass` de la couche data (`app/data/repositories/category.py`). Les `Ingredient.category_l1/l2` restent des **chaînes TEXT, pas des FK** — le renommage d'une catégorie fait un cascade-update par **MATCH sur l'ancien nom**, la suppression fait un cascade-clear à `NULL`. | Conserver ce choix (rétrocompat CIQUAL / imports) ou passer en FK, mais alors prévoir une migration explicite. Décision à prendre au niveau schéma. |

---

## 11. Catalogue des tests domaine existants (assertions à rejouer)

Total : **44 tests** répartis sur 5 fichiers. Tous sont à retranscrire dans la suite de tests de la
webapp — ils constituent le contrat de comportement.

### 11.1 `tests/test_nutrition.py` — 6 tests, pur domaine, aucune fixture

| Test | Assertions |
|---|---|
| `test_aggregate_lines_basic` | Farine (350 kcal, 10 P, 70 G, 1 L / 100 g) × 200 g + beurre (720, 0.6, 0, 80 / 100 g) × 100 g → `kcal == 1420.0`, `proteins_g == 20.6`, `carbs_g == 140.0`, `fats_g == 82.0` (égalité flottante **stricte**) |
| `test_aggregate_lines_missing_macros_count_as_zero` | Ingrédient avec `proteins_g=None`, `fats_g=None`, `kcal=100` × 100 g → `kcal == 100.0`, `proteins_g == 0.0`, `fats_g == 0.0` |
| `test_aggregate_recipe_per_portion` | 400 kcal/100 g × 200 g, `default_portions=4` → `total.kcal == 800.0`, `per_portion.kcal == 200.0` |
| `test_ingredient_macros_scaling` | 240 kcal / 12 P pour 100 g, quantité 250 g → `kcal == 600.0`, `proteins_g == 30.0` |
| `test_nutrition_total_arithmetic` | `(10,1) + (20,2)` → `(30,3)` ; `divided_by(2)` → `kcal == 15.0` |
| `test_empty_recipe_yields_zero` | Recette sans ligne, `default_portions=1` → total et par-portion à `0.0` |

Helper : `make_ingredient(**overrides)` — base `name="Test", source=MANUAL, kcal=100, P=10, G=20,
L=5`.

### 11.2 `tests/test_pricing.py` — 5 tests, pur domaine

Helpers : `priced(name, price_eur_str, qty_ref_g)`, `unpriced(name)`.

| Test | Assertions |
|---|---|
| `test_recipe_cost_simple` | Farine 1,00 €/1000 g (0,001 €/g) × 500 g = 0,50 ; beurre 4,00 €/250 g (0,016 €/g) × 250 g = 4,00 → `total == Decimal("4.50")`, `missing == []` |
| `test_recipe_cost_per_portion` | Farine 1,00 €/1000 g × 400 g = 0,40 ; `default_portions=4` → `per_portion == Decimal("0.10")` |
| `test_recipe_cost_flags_missing_prices` | Farine (prix) 500 g + sel (sans prix) 10 g → `total == Decimal("0.50")`, `len(missing) == 1`, `missing[0].ingredient.name == "Salt"` |
| `test_ingredient_cost_returns_none_when_unpriced` | `ingredient_cost(unpriced("Salt"), 100) is None` |
| `test_ingredient_cost_decimal_precision` | Fromage 3,99 €/250 g × 80 g = 1,2768 → `Decimal("1.28")` (**ROUND_HALF_UP verrouillé**) |

### 11.3 `tests/test_units.py` — 6 tests, pur domaine

| Test | Assertions |
|---|---|
| `test_default_unit_is_grams` | `DEFAULT_UNIT_CODE == "g"` ; `UNIT_BY_CODE["g"].grams_per_unit == 1.0` |
| `test_to_grams_basic` | `to_grams(1,"g")==1.0` ; `(1,"kg")==1000.0` ; `(500,"mg")==0.5` ; `(1,"L")==1000.0` ; `(25,"cl")==250.0` ; `(1,"c_soupe")==15.0` ; `(2,"tasse")==500.0` |
| `test_from_grams_inverse` | `from_grams(1000,"kg")==1.0` ; `(0.5,"mg")==500.0` ; `(250,"cl")==25.0` |
| `test_round_trip` | Pour **chaque** unité de `UNITS` et chaque valeur de `(1.0, 12.5, 0.1, 1000.0)` : `\|from_grams(to_grams(v,u),u) - v\| < 1e-9` |
| `test_label_for_known_unit` | `label_for("g")=="g"` ; `label_for("c_soupe")=="c. à soupe"` ; `label_for("tasse")=="tasse"` |
| `test_unknown_unit_raises` | `to_grams(1,"parsec")` et `from_grams(1,"parsec")` lèvent **`KeyError`** |
| `test_units_codes_are_unique` | Les codes de `UNITS` sont tous distincts |

### 11.4 `tests/test_models.py` — 20 tests, pur domaine

**`IsoWeek`**

| Test | Assertions |
|---|---|
| `test_iso_week_validates_format` | Acceptés : `"2026-W01"`, `"2026-W53"`. Rejetés (`ValueError`) : `"2026-01"`, `"2026-W54"`, `"2026-W00"` |
| `test_iso_week_from_date` | `IsoWeek.from_date(datetime(2026,4,29)).value == "2026-W18"` (mercredi) |

**`MealPlanEntry` — XOR**

| Test | Assertions |
|---|---|
| `test_meal_plan_entry_recipe_branch` | `(recipe_id=42, portions=1.0)` valide → `recipe_id == 42`, `ingredient_id is None` |
| `test_meal_plan_entry_ingredient_branch` | `(ingredient_id=7, quantity_g=80.0)` valide |
| `test_meal_plan_entry_rejects_both_targets` | recipe_id + ingredient_id + portions + quantity_g → `ValueError` |
| `test_meal_plan_entry_rejects_neither_target` | aucun des deux → `ValueError` |
| `test_meal_plan_entry_recipe_requires_portions` | `recipe_id` sans `portions` → `ValueError` |
| `test_meal_plan_entry_ingredient_requires_quantity` | `ingredient_id` sans `quantity_g` → `ValueError` |
| `test_meal_plan_entry_quantity_must_be_strictly_positive` | `quantity_g=0.0` et `-100.0` → `ValidationError` |
| `test_meal_plan_entry_portions_must_be_strictly_positive` | `portions=0.0` et `-1.0` → `ValidationError` |

**Validateurs A1**

| Test | Assertions |
|---|---|
| `test_ingredient_name_cannot_be_empty` | `Ingredient(name="")` et `name="   "` → `ValidationError` |
| `test_ingredient_macros_accept_none_but_reject_negatives` | `None` OK ; `0.0` OK (« l'eau à 0 kcal ») ; `kcal=-5.0`, `proteins=-0.1`, `salt=-1.0` → `ValidationError` |
| `test_ingredient_price_must_be_strictly_positive` | `None` OK ; `Decimal("0.01")` OK ; `Decimal("0")` et `Decimal("-2.50")` → `ValidationError` |
| `test_ingredient_quantities_must_be_strictly_positive` | `price_quantity_g=None`+`piece_weight_g=None` OK ; `250.0`/`60.0` OK ; `price_quantity_g=0.0` → erreur ; `piece_weight_g=-1.0` → erreur |
| `test_ingredient_cooked_weight_per_100g_raw_validation` | `None` OK (1:1 implicite) ; `300.0` (riz ×3) et `230.0` (pois chiche) OK ; `0.0` et `-50.0` → `ValidationError` |
| `test_recipe_name_cannot_be_empty` | `Recipe(name="Chili")` OK ; `""` et `"   "` → `ValidationError` |
| `test_recipe_default_portions_must_be_at_least_one` | `1` et `4` OK ; `0` et `-2` → `ValidationError` |
| `test_recipe_line_quantity_must_be_strictly_positive` | `100.0` OK ; `0.0` et `-50.0` → `ValidationError` |
| `test_recipe_line_ordinal_non_negative` | `0` et `5` OK ; `-1` → `ValidationError` |
| `test_tag_name_cannot_be_empty` | `Tag(name="vegetarien")` OK ; `""` et `"   "` → `ValidationError` |

**B3 — créneaux collation**

| Test | Assertions |
|---|---|
| `test_meal_slot_enum_includes_snacks` | Les 5 valeurs exactes : `"morning"`, `"snack_morning"`, `"noon"`, `"snack_afternoon"`, `"evening"` |
| `test_meal_plan_entry_accepts_snack_slot` | `slot=MealSlot.SNACK_AFTERNOON` accepté et conservé à l'identique |

### 11.5 `tests/test_shopping_service.py` — 17 tests (fixture `db_session`, SQLite en mémoire)

Fixture : `db_session` = moteur `sqlite:///:memory:` + `init_schema` (schéma + FTS5), **sans** seed
CIQUAL. Helpers locaux : `_make_ing(db_session, **overrides)` (base : Carotte, CIQUAL,
`category_l1="fruits, legumes"`, `in_personal_library=True`, 41 kcal, `1.20 €` / `1000 g`) et
`_make_recipe(db_session, [(ing, qty), …], name=…, default_portions=4)`.

**`aggregate_shopping_list`**

| Test | Assertions |
|---|---|
| `test_empty_week_returns_empty_list` | Semaine vide → `ShoppingList` avec `iso_week` conservé, `items == []`, `total_eur == Decimal("0.00")`, `missing_price_count == 0` |
| `test_single_ingredient_entry` | 500 g de carotte à 1,20 €/kg → 1 item, `quantity_g == 500.0`, `cost_eur == Decimal("0.60")`, `has_price is True`, `total_eur == Decimal("0.60")` |
| `test_aggregates_same_ingredient_across_entries` | 200 g + 300 g du même ingrédient sur 2 jours/créneaux → **1 seul item** à `500.0` |
| `test_recipe_entry_expands_lines_scaled_by_portions` | Recette `default_portions=4` (carotte 200 g, oignon 100 g) planifiée à `portions=2.0` → carotte `100.0`, oignon `50.0` (**ratio = portions / default_portions**) |
| `test_mixed_entries_recipe_and_raw` | Recette à 4/4 portions (200 g carotte) + entrée brute 100 g carotte → 1 item à `300.0` |
| `test_groups_and_sorts_by_category` | Carotte + Aubergine (`"fruits, legumes"`), Bœuf (`"viandes"`), Sel (`None`) → ordre exact `["Aubergine", "Carotte", "Boeuf", "Sel"]` (catégorisés d'abord, tri alpha catégorie puis nom, `None` en dernier) |
| `test_missing_price_is_counted_not_summed` | 500 g d'un ingrédient à 2,00 €/kg + 200 g d'un sans prix → `missing_price_count == 1`, `total_eur == Decimal("1.00")` |
| `test_orphan_recipe_skipped_silently` | Entrée pointant une recette **supprimée** → `items == []`, `total_eur == Decimal("0.00")`, **aucune exception** |
| `test_piece_weight_propagates` | Œuf `piece_weight_g=60.0`, 180 g planifiés → `piece_weight_g == 60.0`, `piece_count ≈ 3.0` |
| `test_other_weeks_are_independent` | `2026-W17` (100 g) et `2026-W18` (200 g) → chaque semaine ne voit que sa quantité |
| `test_aggregate_uses_constant_query_count` | 3 recettes distinctes / 4 ingrédients / 6 entrées → **≤ 8 SELECT** (garde anti-N+1 via `before_execute` listener SQLAlchemy) ; résultat toujours correct : 4 items, noms `{Carotte, Oignon, Riz, Tomate}` |
| `test_aggregate_handles_empty_week` | `2026-W42` vide → `items == []`, `total_eur == 0.00`, `missing_price_count == 0` |

⚠️ `test_aggregate_uses_constant_query_count` est **spécifique à SQLAlchemy** (compte les
`before_execute`). Équivalent web : compter les appels `D1.prepare()` / `batch()` via un wrapper de
test.

**`format_as_text`** (pur, sans DB)

| Test | Assertions |
|---|---|
| `test_format_as_text_empty` | Contient `"Liste de courses"`, `"2026-W18"`, `"(aucun ingrédient)"` |
| `test_format_as_text_renders_categories_and_total` | Contient `"Carotte"`, `"Boeuf"`, un en-tête de catégorie contenant `"Legumes"`, `"Viandes"`, et le total en locale FR `"4,20"` |
| `test_format_as_text_signals_missing_prices` | Avec `missing_price_count=1` → contient `"1 ingrédient(s) sans prix"` |
| `test_format_as_text_renders_pieces_when_piece_weight_set` | Œuf 180 g / pièce 60 g → contient `"pièce"` et `"Oeuf"` |

### 11.6 Tests domaine-adjacents non demandés mais à connaître

- `tests/test_seasonality.py` teste `_parse_season_months` — logique de parsing de
  `Ingredient.season_months` qui **vit dans le viewmodel**, pas dans le domaine (voir §10).
- `tests/test_receipt_matcher.py`, `test_receipt_parser_intermarche.py`,
  `test_recipe_url_quantity_parser.py` couvrent les services qui *produisent* les dataclasses de §4
  et §5. Hors périmètre de ce document.

---

## 12. Récapitulatif des ambiguïtés et incohérences relevées

1. **`_piece` n'est pas une unité du domaine** — pseudo-code fabriqué dans QML, facteur =
   `ingredient.piece_weight_g`. `to_grams("_piece")` lève `KeyError`. Un chemin d'appel
   (`recipe_url_import_vm.py:225`) traite `_piece` comme des grammes (`qty * 1.0`) au lieu de
   multiplier par `piece_weight_g` — **bug potentiel** à trancher avant portage.
2. **Deux arrondis différents** : `pricing.py` force `ROUND_HALF_UP`, `shopping_service.py` fait un
   `quantize(Decimal("0.01"))` **sans rounding explicite** (→ `ROUND_HALF_EVEN`). Inoffensif en
   pratique mais à harmoniser sciemment.
3. **Arrondi-puis-somme** dans `recipe_cost` : chaque ligne est arrondie au centime avant sommation.
   Décision de calcul non documentée ailleurs, à reproduire à l'identique.
4. **`prep_time_min` et `source_url`** existent sur `ExtractedRecipe` mais **n'ont pas de champ
   correspondant sur `Recipe`** — l'information semble perdue au commit.
5. **`MealPlanEntry` tolère les champs en trop** : rien n'interdit `quantity_g` sur une entrée
   recette ni `portions` sur une entrée ingrédient.
6. **`iso_week` est un `str` non validé** sur `MealPlanEntry` et `WeeklyCostSnapshot` : le modèle
   `IsoWeek` n'est jamais utilisé comme type de champ, seulement comme validateur ad hoc.
7. **`Tag.color_hex` n'est pas validé** — risque d'injection CSS côté web.
8. **Sections du garde-manger** : le traitement des dates de péremption **déjà dépassées** et des
   entrées sans `expiry_date` n'est pas spécifié dans la docstring de `PantryStock`.
9. **`IsoWeek._validate`** utilise `int()` sur les tranches → tolère les espaces (`"2026-W 5"`).
   Une regex stricte est recommandée côté web (strictement plus restrictif, donc sûr).
10. **Le domaine ne connaît aucun modèle `Category`** : `category_l1/l2` sont des chaînes libres, pas
    des FK. `CategoryNode` vit dans la couche data. Le renommage cascade **par MATCH sur le nom**.
11. **`str.capitalize()` de `format_as_text`** minuscule le reste de la chaîne — ne pas remplacer par
    `text-transform: capitalize`.
12. **Coercition Pydantic v2** : aucun modèle ne configure `strict` ni `extra="forbid"`. Les clés
    inconnues sont silencieusement ignorées, les types numériques coercés en mode « smart ».
