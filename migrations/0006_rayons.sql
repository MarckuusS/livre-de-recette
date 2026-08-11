-- =============================================================================
-- Rayons editables : la table `category_definition` devient enfin ecrivable.
--
-- Elle existait depuis 0001, portait deja `household_id` depuis 0005, et
-- n'avait AUCUNE route. Le commentaire de 0005 disait explicitement qu'elle
-- prenait la colonne « pour ne pas devenir le trou par lequel on oublie le
-- cloisonnement le jour ou on la branchera ». C'est ce jour.
-- =============================================================================

-- ---------- 1. Apparence ----------
-- Les deux colonnes sont NULLABLES, et c'est le coeur du dispositif : NULL
-- veut dire « deduis-le du nom », comportement actuel de web/src/icons/
-- resolve.ts. Un rayon jamais ouvert dans le gestionnaire garde donc
-- exactement l'aspect qu'il a aujourd'hui, sans migration de donnees.
ALTER TABLE category_definition ADD COLUMN icon      TEXT;
ALTER TABLE category_definition ADD COLUMN color_hex TEXT;

-- ---------- 2. Unicite par FOYER ----------
-- L'index de 0001 porte sur (parent_id, name) seulement. Il a ete cree avant
-- l'existence des foyers, et personne ne l'a repris en 0005 puisque la table
-- n'etait pas ecrite : en l'etat, deux cuisines ne pourraient pas nommer un
-- rayon « Epicerie » toutes les deux. Le defaut est latent tant qu'il n'y a
-- qu'un foyer ; il cesserait de l'etre exactement au moment ou l'on ouvre
-- l'ecriture, donc maintenant.
DROP INDEX IF EXISTS ix_category_unique_in_parent;
CREATE UNIQUE INDEX ix_category_unique_in_parent
  ON category_definition (household_id, COALESCE(parent_id, -1), name);

-- ---------- 3. Rattrapage ----------
-- `ingredient.category_l1` est du texte libre : des rayons ont ete saisis
-- directement dans une fiche sans jamais passer par la table (« Frais »,
-- « Sport nutrition »). Le champ devenant un menu deroulant ferme, un
-- ingredient portant un rayon absent de la table deviendrait inmodifiable —
-- sa valeur ne figurerait dans aucune option.
--
-- On cree donc la ligne manquante pour chaque rayon REELLEMENT utilise. Sans
-- icone ni couleur : elles seront deduites du nom, comme avant.
INSERT INTO category_definition (household_id, name, parent_id, ordinal)
SELECT DISTINCT i.household_id, TRIM(i.category_l1), NULL, 0
  FROM ingredient i
 WHERE i.category_l1 IS NOT NULL
   AND TRIM(i.category_l1) <> ''
   AND NOT EXISTS (
         SELECT 1 FROM category_definition c
          WHERE c.household_id = i.household_id
            AND c.parent_id IS NULL
            AND c.name = TRIM(i.category_l1)
       );
