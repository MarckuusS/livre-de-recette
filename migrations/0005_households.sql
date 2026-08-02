-- =============================================================================
-- 0005_households.sql — plusieurs cuisines sur la meme adresse.
--
-- Renverse le choix de 0004, et il faut le dire franchement : celle-ci notait
-- que des donnees communes rendaient impossible d'oublier un « AND user_id = ? ».
-- On perd cette garantie. Elle est remplacee par deux mesures, et par rien
-- d'autre :
--
--   1. le foyer est lie a la CONSTRUCTION du Repositories, jamais passe requete
--      par requete — un appelant ne peut pas l'omettre ;
--   2. scripts/smoke-isolation.mjs cree deux foyers, ecrit dans chacun, et
--      verifie qu'aucun ne voit l'autre par AUCUN chemin de lecture.
--
-- SQLite n'a pas de Row-Level Security : sans ces deux mesures, rien ne
-- rattraperait un filtre oublie.
--
-- ---------------------------------------------------------------------------
-- LE CAS DE LA TABLE ingredient
-- ---------------------------------------------------------------------------
-- Elle melange deux natures : 4 177 lignes de catalogue CIQUAL/OpenFoodFacts,
-- identiques pour tout le monde, et trois colonnes intimes — appartenance a la
-- bibliotheque, prix releve, poids unitaire.
--
-- On DUPLIQUE le catalogue par foyer plutot que de scinder la table. Scinder
-- aurait ete plus econome en octets, mais aurait touche chaque requete et
-- chaque ecriture. Dupliquer coute environ 1 Mo par foyer — sans importance
-- pour D1 — et garde une regle simple, donc verifiable : CHAQUE ligne
-- appartient a exactement un foyer.
-- =============================================================================

CREATE TABLE household (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Le foyer 1 recueille tout l'existant. Le DEFAULT 1 des colonnes ajoutees
-- ci-dessous s'appuie dessus : sans cette ligne, les donnees actuelles
-- pointeraient vers un foyer inexistant.
INSERT INTO household (id, name) VALUES (1, 'Ma cuisine');

-- ---------- rattachement des tables existantes ----------
--
-- `NOT NULL DEFAULT 1` : les lignes deja presentes rejoignent le foyer 1 sans
-- qu'on ait a les mettre a jour, et aucune ecriture future ne peut oublier la
-- colonne.
--
-- Pas de `REFERENCES household (id)` ici, et ce n'est PAS un oubli : SQLite
-- refuse d'ajouter une colonne a la fois REFERENCES et NOT NULL DEFAULT non
-- nul (« Cannot add a REFERENCES column with non-NULL default value »). La
-- seule alternative serait de reconstruire les quatorze tables, ce qui
-- coute bien plus cher en risque que la contrainte n'apporte. Les tables
-- reconstruites plus bas, elles, la portent.

ALTER TABLE user                     ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ingredient               ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ingredient_price_history ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE recipe                   ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE recipe_cooking_log       ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tag                      ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE meal_plan_entry          ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE meal_plan_template       ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE pantry_stock             ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE activity_log             ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;

-- Tables sans route aujourd'hui (tickets de caisse, rayons editables). Elles
-- prennent la colonne pour ne pas devenir le trou par lequel on oublie le
-- cloisonnement le jour ou on les branchera.
ALTER TABLE category_definition      ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE imported_receipt         ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE receipt_alias            ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE receipt_upload           ADD COLUMN household_id INTEGER NOT NULL DEFAULT 1;

-- `recipe_ingredient` et `recipe_tag` n'en prennent PAS : elles n'existent que
-- par leur recette, qui est cloisonnee, et disparaissent avec elle (CASCADE).
-- Leur ajouter la colonne obligerait a la maintenir a chaque ecriture pour une
-- garantie que la cle etrangere donne deja.

-- ---------- unicites a rescoper ----------
--
-- Sans cela, deux foyers ne peuvent pas avoir chacun leur « Tomate » : la
-- moindre duplication du catalogue violerait l'unicite.

DROP INDEX ix_ingredient_source_ref;
CREATE UNIQUE INDEX ix_ingredient_source_ref ON ingredient (household_id, source, source_ref);

DROP INDEX ix_ingredient_personal;
CREATE INDEX ix_ingredient_personal ON ingredient (household_id, in_personal_library, name);

CREATE INDEX ix_recipe_household        ON recipe (household_id, name);
CREATE INDEX ix_tag_household           ON tag (household_id, name);
CREATE INDEX ix_pantry_household        ON pantry_stock (household_id);
CREATE INDEX ix_activity_household      ON activity_log (household_id, at DESC);
CREATE INDEX ix_price_history_household ON ingredient_price_history (household_id, ingredient_id);

DROP INDEX ix_meal_plan_week;
CREATE INDEX ix_meal_plan_week ON meal_plan_entry (household_id, iso_week, day_of_week, slot, ordinal);

-- `tag.name` et `meal_plan_template.name` etaient UNIQUE au niveau colonne.
-- SQLite ne sait pas retirer une contrainte de colonne : on reconstruit.

-- ATTENTION : `recipe_tag` reference `tag` avec ON DELETE CASCADE. Cles
-- etrangeres actives, un DROP TABLE effectue un DELETE implicite de toutes les
-- lignes AVANT de supprimer la table — les associations recette/tag
-- partiraient avec. On les met de cote et on les remet apres.
CREATE TABLE recipe_tag_backup AS SELECT recipe_id, tag_id FROM recipe_tag;

CREATE TABLE tag_new (
  id           INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES household (id),
  name         TEXT NOT NULL,
  color_hex    TEXT NOT NULL DEFAULT '#9ca3af'
                 CHECK (color_hex GLOB '#*' AND length(color_hex) IN (7,9)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
INSERT INTO tag_new (id, household_id, name, color_hex, created_at)
  SELECT id, household_id, name, color_hex, created_at FROM tag;
DROP TABLE tag;
ALTER TABLE tag_new RENAME TO tag;
CREATE UNIQUE INDEX ix_tag_unique ON tag (household_id, name);

-- Les identifiants de tags sont conserves a l'identique : les associations se
-- remettent telles quelles. `OR IGNORE` couvre le cas ou la cascade n'aurait
-- pas eu lieu et ou les lignes seraient encore la.
INSERT OR IGNORE INTO recipe_tag (recipe_id, tag_id)
  SELECT recipe_id, tag_id FROM recipe_tag_backup;
DROP TABLE recipe_tag_backup;

CREATE TABLE meal_plan_template_new (
  id            INTEGER PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES household (id),
  name          TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
INSERT INTO meal_plan_template_new (id, household_id, name, snapshot_json, created_at, updated_at)
  SELECT id, household_id, name, snapshot_json, created_at, updated_at FROM meal_plan_template;
DROP TABLE meal_plan_template;
ALTER TABLE meal_plan_template_new RENAME TO meal_plan_template;
CREATE UNIQUE INDEX ix_template_unique ON meal_plan_template (household_id, name);

-- `weekly_cost_snapshot.iso_week` etait CLE PRIMAIRE : deux foyers n'auraient
-- pas pu archiver la meme semaine. La cle devient (foyer, semaine).
CREATE TABLE weekly_cost_snapshot_new (
  household_id  INTEGER NOT NULL REFERENCES household (id),
  iso_week      TEXT    NOT NULL,
  total_eur     TEXT    NOT NULL DEFAULT '0.00',
  missing_count INTEGER NOT NULL DEFAULT 0,
  captured_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (household_id, iso_week)
);
INSERT INTO weekly_cost_snapshot_new (household_id, iso_week, total_eur, missing_count, captured_at)
  SELECT 1, iso_week, total_eur, missing_count, captured_at FROM weekly_cost_snapshot;
DROP TABLE weekly_cost_snapshot;
ALTER TABLE weekly_cost_snapshot_new RENAME TO weekly_cost_snapshot;

-- `app_setting` porte DEUX natures : des reglages globaux au serveur (le secret
-- de signature des sessions, le compteur d'echecs de connexion) et des donnees
-- de foyer (cases cochees, session de courses). Le foyer 0 designe le global :
-- il n'existe pas dans `household`, et c'est justement ce qui le distingue.
CREATE TABLE app_setting_new (
  household_id INTEGER NOT NULL DEFAULT 0,
  key          TEXT    NOT NULL,
  value_json   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (household_id, key)
);
-- Les cles d'authentification restent globales (foyer 0), le reste rejoint le
-- foyer 1 — c'etaient ses cases cochees et sa session de courses.
INSERT INTO app_setting_new (household_id, key, value_json, updated_at)
  SELECT CASE WHEN key LIKE 'auth.%' THEN 0 ELSE 1 END, key, value_json, updated_at
  FROM app_setting;
DROP TABLE app_setting;
ALTER TABLE app_setting_new RENAME TO app_setting;

-- ---------- FTS5 ----------
--
-- L'index plein-texte est reconstruit : `tag` a ete recreee, mais surtout
-- `ingredient` va accueillir des copies du catalogue pour chaque nouveau foyer.
-- La table virtuelle ne porte PAS le foyer — elle ne sert qu'a proposer des
-- identifiants, que la requete appelante filtre ensuite. C'est volontaire :
-- un `MATCH` reste rapide, et le cloisonnement se joue dans le SELECT qui
-- l'englobe, jamais dans l'index.
INSERT INTO ingredient_fts (ingredient_fts) VALUES ('rebuild');
