-- =============================================================================
-- L'historique de poids, et le tour de taille.
--
-- `user_profile.weight_kg` etait un SCALAIRE : l'application connaissait le
-- poids du jour et rien d'autre. Elle ne pouvait donc dire ni "tu perds
-- 0,22 kg par semaine", ni "tu arriveras le 27 septembre", ni tracer une
-- courbe : toutes ces reponses demandent de comparer plusieurs mesures.
--
-- CLOISONNE PAR PERSONNE, comme `user_profile` et `hydration_day`, et pour la
-- meme raison : un poids est une donnee de sante, et partager une cuisine ne
-- donne pas le droit de la lire. L'identifiant vient du cookie signe.
--
-- UNE MESURE PAR JOUR, d'ou la cle primaire. Se peser deux fois le meme matin
-- est courant ; garder les deux obligerait a choisir laquelle compte, et la
-- moyenne mobile s'en trouverait faussee selon l'heure. La seconde pesee
-- remplace la premiere.
--
-- `weight_kg` reste AUSSI sur `user_profile` : c'est la valeur de reference du
-- calcul de cible, celle que l'ecran de reglage edite. La derniere pesee la met
-- a jour, mais les deux ne se confondent pas : on peut regler un profil sans
-- jamais se peser.
-- =============================================================================

CREATE TABLE IF NOT EXISTS weight_log (
  user_id   INTEGER NOT NULL REFERENCES user (id) ON DELETE CASCADE,

  day       TEXT    NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

  -- Memes bornes que `user_profile.weight_kg` : au-dela, c'est une faute de
  -- frappe et non une personne.
  weight_kg REAL    NOT NULL CHECK (weight_kg BETWEEN 20 AND 400),

  PRIMARY KEY (user_id, day)
)
WITHOUT ROWID;

-- Le tour de taille. En recomposition, le poids seul ment : on peut prendre du
-- muscle et perdre du gras sans que la balance bouge. Une seule valeur, la
-- derniere connue, et non un historique : c'est une mesure qu'on prend une fois
-- par mois, pas tous les matins.
ALTER TABLE user_profile ADD COLUMN waist_cm REAL;
