-- =============================================================================
-- Profil alimentaire et sportif, et objectifs journaliers.
--
-- LA DECISION STRUCTURANTE, prise avec l'utilisateur le 2026-08-11 : un
-- objectif appartient a une PERSONNE, le calendrier reste inchange.
--
-- `meal_plan_entry` continue donc de ne porter que le foyer : un repas est
-- planifie pour la cuisine, pas pour quelqu'un. Comparer le total d'une journee
-- a l'objectif d'une personne serait faux d'un facteur egal au nombre de
-- mangeurs, d'ou `household.eaters` ci-dessous, par lequel on divise.
--
-- C'est une approximation assumee — elle suppose que tout le monde mange la
-- meme chose et en meme quantite. La voie exacte (une colonne `user_id` sur
-- `meal_plan_entry`) a ete ECARTEE en connaissance de cause : elle imposait de
-- repenser l'ecran Semaine, deja le plus contraint en 375 px. La rattraper plus
-- tard restera possible, au prix d'une migration.
-- =============================================================================

-- ---------- Combien de personnes mangent ce qui est planifie ----------
-- Sur le FOYER et non sur la personne : c'est une propriete de la cuisine, et
-- les deux membres doivent lire le meme nombre. Un seul mangeur par defaut,
-- qui laisse le comportement actuel inchange tant que personne n'y touche.
ALTER TABLE household ADD COLUMN eaters INTEGER NOT NULL DEFAULT 1;

-- ---------- Le profil, strictement personnel ----------
--
-- Cle primaire sur `user_id` : une personne a un profil, pas une collection.
-- Cette table n'a deliberement PAS de `household_id` — le cloisonnement se fait
-- par la personne elle-meme, qui ne peut lire et ecrire que le sien. Poids et
-- taille sont des donnees de sante : elles ne se partagent pas avec le foyer
-- au pretexte qu'on partage une cuisine.
CREATE TABLE user_profile (
  user_id     INTEGER PRIMARY KEY REFERENCES user (id) ON DELETE CASCADE,

  -- 'f' | 'm'. La formule de Mifflin-St Jeor n'a que ces deux constantes ;
  -- laisser NULL est parfaitement valide et rend simplement le calcul
  -- indisponible, sans bloquer le reste de l'ecran.
  sex         TEXT    CHECK (sex IN ('f', 'm')),

  -- L'ANNEE et non la date complete. Mifflin-St Jeor retranche 5 kcal par
  -- annee : une erreur de douze mois deplace la cible de 5 kcal. Demander une
  -- date de naissance serait collecter une donnee plus sensible pour rien.
  birth_year  INTEGER CHECK (birth_year BETWEEN 1900 AND 2100),

  height_cm   INTEGER CHECK (height_cm BETWEEN 80 AND 250),
  weight_kg   REAL    CHECK (weight_kg BETWEEN 20 AND 400),

  activity    TEXT    CHECK (activity IN ('sedentaire','leger','actif','sportif','athlete')),
  goal        TEXT    CHECK (goal IN ('perte','maintien','prise')),

  -- Cible saisie a la main. NULL = calculee depuis le profil.
  --
  -- Elle existe parce que l'estimation est une estimation : quelqu'un qui suit
  -- un plan donne par un professionnel doit pouvoir entrer SES chiffres sans
  -- que l'application les recalcule dans son dos. Quand elle est renseignee,
  -- elle l'emporte sur tout le reste.
  kcal_target INTEGER CHECK (kcal_target IS NULL OR kcal_target BETWEEN 800 AND 8000),

  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
