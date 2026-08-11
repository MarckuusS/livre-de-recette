-- =============================================================================
-- Objectifs precis : plus de trois choix, et une repartition detachable.
--
-- La 0008 confondait deux questions dans une seule colonne : COMBIEN d'energie
-- (perdre / maintenir / prendre) et COMMENT elle se repartit. Les deux etaient
-- soudees, donc « perdre du poids » imposait ses pourcentages, et vouloir des
-- proteines hautes obligeait a changer d'objectif de poids. Elles se separent
-- ici en `goal` d'un cote, `split` de l'autre.
--
-- TABLE RECONSTRUITE plutot qu'alteree : SQLite ne sait pas modifier une
-- contrainte CHECK, et `goal` en portait une qui n'admettait que trois valeurs.
-- La reconstruction est le seul moyen d'en admettre six. Le contenu est recopie
-- avant la bascule — la table tient dans une poignee de lignes, une par
-- personne du foyer.
-- =============================================================================

CREATE TABLE user_profile_new (
  user_id     INTEGER PRIMARY KEY REFERENCES user (id) ON DELETE CASCADE,

  sex         TEXT    CHECK (sex IN ('f', 'm')),
  birth_year  INTEGER CHECK (birth_year BETWEEN 1900 AND 2100),
  height_cm   INTEGER CHECK (height_cm BETWEEN 80 AND 250),
  weight_kg   REAL    CHECK (weight_kg BETWEEN 20 AND 400),
  activity    TEXT    CHECK (activity IN ('sedentaire','leger','actif','sportif','athlete')),

  -- Six objectifs. Les trois premiers codes de la 0008 sont conserves tels
  -- quels : un profil deja enregistre doit continuer de se lire.
  goal        TEXT    CHECK (goal IN
                        ('seche','perte','perte_douce','maintien','prise_seche','prise')),

  -- Repartition des macros. NULL = celle que propose l'objectif, ce qui laisse
  -- le comportement de la 0008 inchange pour qui n'y touche pas.
  split       TEXT    CHECK (split IS NULL OR split IN
                        ('equilibre','proteine','seche','faible_glucides',
                         'endurance','mediterraneen','perso')),

  -- Pourcentages ecrits a la main. Lus UNIQUEMENT quand `split = 'perso'` :
  -- les garder au lieu de les effacer permet de revenir a « personnalisée »
  -- sans avoir a les ressaisir.
  split_proteins INTEGER CHECK (split_proteins IS NULL OR split_proteins BETWEEN 0 AND 100),
  split_carbs    INTEGER CHECK (split_carbs    IS NULL OR split_carbs    BETWEEN 0 AND 100),
  split_fats     INTEGER CHECK (split_fats     IS NULL OR split_fats     BETWEEN 0 AND 100),

  -- Poids vise et allure. Ensemble, ils remplacent le pourcentage de
  -- l'objectif par un deficit calcule — « 74 kg à 0,5 kg par semaine » dit
  -- quelque chose de plus precis que « perdre du poids ».
  target_weight_kg REAL CHECK (target_weight_kg IS NULL OR target_weight_kg BETWEEN 20 AND 400),
  pace             TEXT CHECK (pace IS NULL OR pace IN ('lent','modere','rapide')),

  kcal_target INTEGER CHECK (kcal_target IS NULL OR kcal_target BETWEEN 800 AND 8000),

  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

INSERT INTO user_profile_new
  (user_id, sex, birth_year, height_cm, weight_kg, activity, goal, kcal_target, updated_at)
SELECT user_id, sex, birth_year, height_cm, weight_kg, activity, goal, kcal_target, updated_at
  FROM user_profile;

DROP TABLE user_profile;

ALTER TABLE user_profile_new RENAME TO user_profile;
