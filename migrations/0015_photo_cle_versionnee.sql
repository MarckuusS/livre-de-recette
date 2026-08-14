-- =============================================================================
-- La cle de photo devient versionnee, et une cle pendante s'en va.
--
-- AUCUN CHANGEMENT DE SCHEMA. `image_key` existe depuis la 0001 et suffit : son
-- CONTENU porte desormais l'empreinte SHA-256 de la photo, de la forme
-- 'recipes/<id>/<empreinte>.jpg'. L'URL change donc exactement quand l'image
-- change, ce qui est la condition pour la servir en `immutable`. Les deux
-- decisions se tiennent debout mutuellement : revenir a une cle fixe sans
-- retirer `immutable` ferait afficher l'ancienne photo pendant un an, sur
-- l'appareil meme qui vient de la remplacer.
--
-- LA LIGNE PENDANTE. `scripts/migrate-sqlite-to-d1.mjs` a converti l'ancien
-- `image_path` du desktop en 'recipes/<id>.jpg' pour la recette 6, a une epoque
-- ou le bucket R2 n'existait pas et ou aucun code n'y avait jamais ecrit.
-- Verifie en production le 2026-08-14 : la ligne existe, l'objet non. La
-- garder ferait de la toute premiere photo affichee par cette fonction un 404,
-- sur la seule recette qui pretend en avoir une. On l'annule : la fiche retombe
-- sur son bandeau vert, exactement comme les autres, et la photo se repose en
-- deux gestes.
--
-- LE MOTIF VISE LA FORME, PAS LA VALEUR CONNUE : une base locale de
-- developpement peut porter d'autres cles heritees. En SQLite, le `*` de GLOB
-- traverse les barres obliques, donc 'recipes/*/*.jpg' exige reellement deux
-- niveaux et ne laisse passer que la forme nouvelle.
--
-- PAS DE CHECK sur la forme de la colonne : SQLite ne sait pas en ajouter un
-- sans reconstruire la table (lecon de la 0009 et de la 0014), et la seule
-- route qui ecrit cette colonne fabrique la cle elle-meme, a partir d'une
-- empreinte calculee cote serveur.
-- =============================================================================

UPDATE recipe
   SET image_key = NULL
 WHERE image_key IS NOT NULL
   AND image_key NOT GLOB 'recipes/*/*.jpg';
