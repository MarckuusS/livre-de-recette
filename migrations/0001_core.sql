-- =============================================================================
-- 0001_core.sql — schema de base, porte depuis le SQLite local.
--
-- Reference : docs/portage/00-SPEC-PORTAGE.md section 2.3
--
-- Ecarts assumes vis-a-vis du schema Python, tous documentes en section 2.2 :
--   * les DEFAULT vivent desormais en SQL (ils etaient dans l'ORM SQLAlchemy,
--     ce qui faisait echouer tout INSERT partiel ecrit a la main) ;
--   * les horodatages sont en ISO-8601 UTC suffixe Z (le Python melangeait
--     CURRENT_TIMESTAMP en UTC et datetime.now() en heure locale) ;
--   * l'argent est stocke en TEXT decimal, jamais en REAL ;
--   * les regles metier qui ne vivaient que dans Pydantic ont un CHECK ici,
--     et restent revalidees cote Worker (Zod) ;
--   * ingredient.name_normalized est nouveau : il remplace un find_by_name()
--     qui chargeait ~3 000 lignes en memoire pour comparer en Python.
-- =============================================================================

-- ---------- ingredient ----------
CREATE TABLE ingredient (
  id                          INTEGER PRIMARY KEY,
  name                        TEXT    NOT NULL,
  -- minuscules + NFD sans diacritiques. Maintenu par le Worker a chaque ecriture.
  name_normalized             TEXT    NOT NULL DEFAULT '',
  source                      TEXT    NOT NULL DEFAULT 'manual'
                                CHECK (source IN ('ciqual','openfoodfacts','manual','lidl')),
  source_ref                  TEXT,
  brand                       TEXT,
  -- Macros pour 100 g. NULL = inconnu, ce qui n'est PAS la meme chose que 0.
  kcal_per_100g               REAL    CHECK (kcal_per_100g              IS NULL OR kcal_per_100g              >= 0),
  proteins_g                  REAL    CHECK (proteins_g                 IS NULL OR proteins_g                 >= 0),
  carbs_g                     REAL    CHECK (carbs_g                    IS NULL OR carbs_g                    >= 0),
  sugars_g                    REAL    CHECK (sugars_g                   IS NULL OR sugars_g                   >= 0),
  fats_g                      REAL    CHECK (fats_g                     IS NULL OR fats_g                     >= 0),
  saturated_fats_g            REAL    CHECK (saturated_fats_g           IS NULL OR saturated_fats_g           >= 0),
  fiber_g                     REAL    CHECK (fiber_g                    IS NULL OR fiber_g                    >= 0),
  salt_g                      REAL    CHECK (salt_g                     IS NULL OR salt_g                     >= 0),
  -- Argent : chaine decimale ("1.2000"), 4 decimales comme le NUMERIC(10,4) d'origine.
  price_eur                   TEXT    CHECK (price_eur                  IS NULL OR CAST(price_eur AS REAL)    >  0),
  price_quantity_g            REAL    CHECK (price_quantity_g           IS NULL OR price_quantity_g           >  0),
  piece_weight_g              REAL    CHECK (piece_weight_g             IS NULL OR piece_weight_g             >  0),
  cooked_weight_per_100g_raw  REAL    CHECK (cooked_weight_per_100g_raw IS NULL OR cooked_weight_per_100g_raw >  0),
  in_personal_library         INTEGER NOT NULL DEFAULT 0 CHECK (in_personal_library IN (0,1)),
  category_l1                 TEXT,
  category_l2                 TEXT,
  season_months               TEXT,   -- CSV de mois 1..12, ex. '6,7,8,9'
  created_at                  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at                  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- En SQLite deux NULL sont distincts : tous les ingredients 'manual'
-- (source_ref NULL) cohabitent sous cet index. Comportement d'origine conserve.
CREATE UNIQUE INDEX ix_ingredient_source_ref ON ingredient (source, source_ref);
CREATE INDEX ix_ingredient_personal        ON ingredient (in_personal_library, name);
CREATE INDEX ix_ingredient_name_normalized ON ingredient (name_normalized);
CREATE INDEX ix_ingredient_category_l1     ON ingredient (category_l1);

-- ---------- tag ----------
CREATE TABLE tag (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color_hex  TEXT NOT NULL DEFAULT '#9ca3af'
               CHECK (color_hex GLOB '#*' AND length(color_hex) IN (7,9)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ---------- recipe ----------
CREATE TABLE recipe (
  id               INTEGER PRIMARY KEY,
  name             TEXT    NOT NULL,
  instructions     TEXT    NOT NULL DEFAULT '',
  default_portions INTEGER NOT NULL DEFAULT 1 CHECK (default_portions >= 1),
  -- Cle d'objet R2 ('recipes/<id>.jpg'), remplace l'ancien chemin de fichier local.
  image_key        TEXT,
  -- Nouveaux : extraits par l'import d'URL mais perdus au commit dans le desktop.
  source_url       TEXT,
  prep_time_min    INTEGER CHECK (prep_time_min IS NULL OR prep_time_min > 0),
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE recipe_ingredient (
  recipe_id     INTEGER NOT NULL REFERENCES recipe (id)     ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredient (id) ON DELETE RESTRICT,
  ordinal       INTEGER NOT NULL DEFAULT 0,
  quantity_g    REAL    NOT NULL CHECK (quantity_g > 0),
  notes         TEXT,
  -- Unite d'affichage choisie par l'utilisateur. Purement cosmetique :
  -- la quantite fait foi et est TOUJOURS en grammes.
  unit          TEXT,
  PRIMARY KEY (recipe_id, ingredient_id, ordinal)
);

CREATE TABLE recipe_tag (
  recipe_id INTEGER NOT NULL REFERENCES recipe (id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tag (id)    ON DELETE CASCADE,
  PRIMARY KEY (recipe_id, tag_id)
);
CREATE INDEX ix_recipe_tag_tag ON recipe_tag (tag_id);

-- ---------- planificateur ----------
CREATE TABLE meal_plan_entry (
  id            INTEGER PRIMARY KEY,
  iso_week      TEXT    NOT NULL CHECK (iso_week GLOB '[0-9][0-9][0-9][0-9]-W[0-9][0-9]'),
  day_of_week   INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),   -- 0 = lundi
  slot          TEXT    NOT NULL
                  CHECK (slot IN ('morning','snack_morning','noon','snack_afternoon','evening')),
  recipe_id     INTEGER REFERENCES recipe (id)     ON DELETE CASCADE,
  ingredient_id INTEGER REFERENCES ingredient (id) ON DELETE CASCADE,
  quantity_g    REAL    CHECK (quantity_g IS NULL OR quantity_g > 0),
  portions      REAL    CHECK (portions   IS NULL OR portions   > 0),   -- REAL : 0.5 portion permis
  ordinal       INTEGER NOT NULL DEFAULT 0,
  -- XOR renforce : le desktop n'interdisait pas quantity_g sur une entree
  -- recette, ni portions sur une entree ingredient.
  CONSTRAINT ck_meal_plan_entry_xor CHECK (
      (recipe_id IS NOT NULL AND ingredient_id IS NULL     AND portions   IS NOT NULL AND quantity_g IS NULL) OR
      (recipe_id IS NULL     AND ingredient_id IS NOT NULL AND quantity_g IS NOT NULL AND portions   IS NULL))
);
CREATE INDEX ix_meal_plan_week ON meal_plan_entry (iso_week, day_of_week, slot, ordinal);

CREATE TABLE meal_plan_template (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE weekly_cost_snapshot (
  iso_week      TEXT    PRIMARY KEY,
  total_eur     TEXT    NOT NULL DEFAULT '0.00',
  missing_count INTEGER NOT NULL DEFAULT 0,
  captured_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ---------- frigo / prix / cuisson ----------
CREATE TABLE pantry_stock (
  id            INTEGER PRIMARY KEY,
  ingredient_id INTEGER NOT NULL REFERENCES ingredient (id) ON DELETE CASCADE,
  quantity_g    REAL    NOT NULL CHECK (quantity_g > 0),
  expiry_date   TEXT,   -- 'YYYY-MM-DD' : un jour, pas un instant
  notes         TEXT,
  added_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX ix_pantry_stock_expiry     ON pantry_stock (expiry_date);
CREATE INDEX ix_pantry_stock_ingredient ON pantry_stock (ingredient_id);

CREATE TABLE ingredient_price_history (
  id            INTEGER PRIMARY KEY,
  ingredient_id INTEGER NOT NULL REFERENCES ingredient (id) ON DELETE CASCADE,
  price_eur     TEXT    NOT NULL CHECK (CAST(price_eur AS REAL) > 0),
  quantity_g    REAL    NOT NULL CHECK (quantity_g > 0),
  store         TEXT,
  recorded_at   TEXT    NOT NULL,
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
-- id en 3e position : le depart de l'ordre est (recorded_at DESC, id DESC),
-- utilise pour reconstituer le prix courant de l'ingredient.
CREATE INDEX ix_price_history_ingredient_date ON ingredient_price_history (ingredient_id, recorded_at, id);

CREATE TABLE recipe_cooking_log (
  id         INTEGER PRIMARY KEY,
  recipe_id  INTEGER NOT NULL REFERENCES recipe (id) ON DELETE CASCADE,
  cooked_at  TEXT    NOT NULL,
  rating     INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  notes      TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX ix_cooking_log_recipe_date ON recipe_cooking_log (recipe_id, cooked_at);

-- ---------- tickets de caisse ----------
CREATE TABLE imported_receipt (
  ticket_id    TEXT    PRIMARY KEY,
  store        TEXT    NOT NULL CHECK (store IN ('intermarche','lidl','carrefour')),
  imported_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  receipt_date TEXT,
  total_eur    TEXT,
  line_count   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE receipt_alias (
  id            INTEGER PRIMARY KEY,
  store         TEXT    NOT NULL,
  -- Intermarche : libelle casefold + espaces collapses. Lidl : art_id.
  source_key    TEXT    NOT NULL,
  ingredient_id INTEGER NOT NULL REFERENCES ingredient (id) ON DELETE CASCADE,
  hit_count     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE UNIQUE INDEX ix_receipt_alias_store_key ON receipt_alias (store, source_key);

-- Remplace le dossier surveille ~/Downloads/Tickets de caisse/, qui n'a
-- aucun equivalent navigateur. Une ligne par ticket televerse.
CREATE TABLE receipt_upload (
  id           INTEGER PRIMARY KEY,
  r2_key       TEXT    NOT NULL,
  filename     TEXT    NOT NULL,
  content_type TEXT    NOT NULL,
  byte_size    INTEGER NOT NULL CHECK (byte_size > 0),
  status       TEXT    NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','parsed','committed','failed','discarded')),
  store        TEXT,
  ticket_id    TEXT,
  parse_error  TEXT,
  uploaded_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX ix_receipt_upload_status ON receipt_upload (status, uploaded_at);

-- ---------- rayons / categories ----------
CREATE TABLE category_definition (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  parent_id  INTEGER REFERENCES category_definition (id) ON DELETE CASCADE,
  ordinal    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
-- COALESCE : sans lui, l'unicite ne s'applique pas aux categories racine
-- (parent_id NULL), deux NULL etant distincts en SQLite.
CREATE UNIQUE INDEX ix_category_unique_in_parent
  ON category_definition (COALESCE(parent_id, -1), name);

-- ---------- reglages ----------
-- Generalise l'ancienne table singleton lidl_plus_settings.
-- AUCUN secret ici : les jetons vont dans les secrets Cloudflare.
CREATE TABLE app_setting (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
