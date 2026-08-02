-- =============================================================================
-- 0004_users_and_activity.sql — plusieurs identifiants, une seule cuisine.
--
-- Choix structurant : les donnees restent COMMUNES. Aucune colonne de
-- propriete, aucun filtrage par utilisateur. C'est ce qui distingue ce modele
-- de vrais comptes separes, et ce qui le rend sur : il n'existe aucune requete
-- ou l'on puisse oublier un « AND user_id = ? » et fuiter les donnees de
-- l'autre. SQLite n'ayant pas de Row-Level Security, cette garantie ne
-- viendrait de nulle part ailleurs.
--
-- Ce qu'on gagne quand meme : chacun son mot de passe, revocable
-- independamment, et la trace de qui a fait quoi.
-- =============================================================================

-- ---------- utilisateurs ----------
CREATE TABLE user (
  id            INTEGER PRIMARY KEY,
  -- Identifiant de connexion. Court et sans espace : c'est ce qu'on tape sur
  -- un clavier de telephone.
  username      TEXT    NOT NULL UNIQUE,
  -- Nom affiche dans le journal (« Marius a ajouté… »).
  display_name  TEXT    NOT NULL,

  -- PBKDF2-SHA256, sel par utilisateur, nombre d'iterations stocke avec le
  -- hash pour pouvoir l'augmenter plus tard sans invalider les comptes
  -- existants.
  --
  -- PBKDF2 et NON un simple SHA-256 : stocker un mot de passe n'est pas
  -- signer un cookie. Il faut un hachage LENT et SALE, pour qu'une fuite de
  -- cette table ne se casse pas a des milliards d'essais par seconde.
  password_hash TEXT    NOT NULL,
  password_salt TEXT    NOT NULL,
  -- Plafond de Cloudflare Workers ; au-dela, PBKDF2 refuse de deriver.
  iterations    INTEGER NOT NULL DEFAULT 100000,

  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_login_at TEXT
);

CREATE UNIQUE INDEX ix_user_username ON user (username);

-- ---------- journal d'activite ----------
--
-- Repond a « qui a ajoute, modifie ou supprime quoi ».
--
-- Une table dediee plutot que des colonnes created_by / updated_by : celles-ci
-- disparaissent avec la ligne qu'elles decrivent. Or c'est precisement la
-- suppression qu'on veut pouvoir expliquer trois jours plus tard.
CREATE TABLE activity_log (
  id        INTEGER PRIMARY KEY,
  -- ON DELETE SET NULL : supprimer un compte ne doit pas effacer l'histoire
  -- de la cuisine. Le journal affichera « utilisateur supprimé ».
  user_id   INTEGER REFERENCES user (id) ON DELETE SET NULL,
  action    TEXT    NOT NULL CHECK (action IN ('create','update','delete')),
  -- 'recipe' | 'ingredient' | 'pantry_stock' | 'meal_plan_entry' | ...
  entity    TEXT    NOT NULL,
  entity_id INTEGER,
  -- Libelle lisible fige AU MOMENT DE L'ACTION. Indispensable : apres une
  -- suppression, entity_id ne designe plus rien, et « a supprimé #42 » ne
  -- veut rien dire. Ici on lira « a supprimé Chili con carne ».
  label     TEXT    NOT NULL,
  -- Detail optionnel : ce qui a change, en JSON.
  details   TEXT,
  at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX ix_activity_at        ON activity_log (at DESC);
CREATE INDEX ix_activity_entity    ON activity_log (entity, entity_id);
CREATE INDEX ix_activity_user      ON activity_log (user_id, at DESC);

-- ---------- attribution courante ----------
--
-- Le journal dit l'histoire ; ces colonnes disent l'etat present, sans avoir
-- a le reconstituer. « Derniere modification : Marius, hier » se lit alors en
-- une jointure au lieu d'un parcours du journal.
ALTER TABLE recipe          ADD COLUMN updated_by INTEGER REFERENCES user (id) ON DELETE SET NULL;
ALTER TABLE ingredient      ADD COLUMN updated_by INTEGER REFERENCES user (id) ON DELETE SET NULL;
ALTER TABLE pantry_stock    ADD COLUMN updated_by INTEGER REFERENCES user (id) ON DELETE SET NULL;
ALTER TABLE meal_plan_entry ADD COLUMN updated_by INTEGER REFERENCES user (id) ON DELETE SET NULL;
