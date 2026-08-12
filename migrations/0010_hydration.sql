-- =============================================================================
-- Hydratation : combien on a bu aujourd'hui.
--
-- CLOISONNEE PAR PERSONNE, comme `user_profile` et pour la meme raison : ce
-- qu'on boit est une donnee de sante, et partager une cuisine ne donne pas le
-- droit de la lire. L'identifiant vient du cookie signe ; aucun parametre de
-- route ne permet de demander la journee de quelqu'un d'autre. C'est la
-- deuxieme table du schema a suivre cette regle — tout le reste appartient au
-- foyer.
--
-- LA CIBLE N'EST PAS ICI, et c'est deliberé. Elle se recalcule du poids du
-- profil par une fonction pure, des deux cotes du reseau, exactement comme les
-- cibles en kcal et en macros. Deux copies d'un meme chiffre finissent toujours
-- par diverger — et une cible stockee resterait a 2 L apres une perte de dix
-- kilos.
--
-- `day` est le jour LOCAL au format AAAA-MM-JJ, pas un horodatage. Un verre bu
-- a 23 h appartient a la journee qu'on vient de vivre, pas a celle que le
-- fuseau UTC a deja commencee.
-- =============================================================================

CREATE TABLE IF NOT EXISTS hydration_day (
  user_id INTEGER NOT NULL REFERENCES user (id) ON DELETE CASCADE,

  day     TEXT    NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

  -- Millilitres. Le plafond n'est pas une regle d'hygiene mais un garde-fou de
  -- saisie : au-dela de 20 L, c'est une faute de frappe, pas une journee.
  ml      INTEGER NOT NULL DEFAULT 0 CHECK (ml >= 0 AND ml <= 20000),

  PRIMARY KEY (user_id, day)
)
WITHOUT ROWID;
