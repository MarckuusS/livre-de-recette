-- =============================================================================
-- L'allure devient un nombre, et la reconnaissance des limites s'en va.
--
-- 1. L'ALLURE. Elle etait un code parmi trois (`lent`, `modere`, `rapide`),
--    avec un CHECK, et l'ecran offrait trois arrets. On veut un curseur qui
--    glisse : cela demande un nombre, pas une enumeration.
--
--    Les trois codes sont convertis a leur valeur (0,25 / 0,5 / 0,75 kg par
--    semaine), telle que `PACES` la definissait. Aucun reglage existant n'est
--    perdu : celui qui avait choisi "Moderee" retrouve 0,50.
--
--    L'ancienne colonne est ENSUITE supprimee. La garder ferait deux verites
--    pour un meme reglage, et son CHECK interdirait de toute facon d'y ecrire
--    une valeur intermediaire.
--
-- 2. LES LIMITES. `limits_ack_at` avait ete ajoutee la veille pour une case
--    "J'ai lu et compris". La case est retiree : elle ne protegeait personne,
--    et bloquait l'enregistrement de reglages sans rapport avec la sante.
--    L'encart d'avertissement, lui, reste. La colonne ne contient que des
--    NULL, donc rien ne se perd.
--
-- SQLite sait supprimer une colonne depuis la 3.35, et D1 en est bien au-dela.
-- Les deux colonnes n'ont ni index, ni cle etrangere, ni CHECK au niveau de la
-- table : la suppression est sure.
-- =============================================================================

ALTER TABLE user_profile ADD COLUMN pace_kg_per_week REAL;

-- Meme conversion que `PACES` dans shared/src/profile.ts. Ecrite en clair
-- plutot que par une table de correspondance : trois lignes se relisent.
UPDATE user_profile SET pace_kg_per_week = 0.25 WHERE pace = 'lent';
UPDATE user_profile SET pace_kg_per_week = 0.5  WHERE pace = 'modere';
UPDATE user_profile SET pace_kg_per_week = 0.75 WHERE pace = 'rapide';

ALTER TABLE user_profile DROP COLUMN pace;
ALTER TABLE user_profile DROP COLUMN limits_ack_at;
