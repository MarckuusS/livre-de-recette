-- =============================================================================
-- Chez moi : le lieu, l'unite de saisie, le seuil, le Nutri-Score, les sorties.
--
-- Les ALTER posent un CHECK au passage. SQLite l'autorise sur ADD COLUMN : il
-- refuse PRIMARY KEY, UNIQUE, un DEFAULT non constant, un NOT NULL sans
-- defaut, un REFERENCES avec defaut non nul, et GENERATED STORED. Ce qu'il ne
-- sait pas faire, c'est MODIFIER un CHECK ensuite : la 0009 a du reconstruire
-- `user_profile` pour cela, la 0014 aussi. Ces listes de valeurs sont donc a
-- considerer comme couteuses a elargir.
-- =============================================================================

-- ---------- 1. Ou est range un lot ----------
-- NULLABLE, ET SANS DEFAUT, c'est le coeur du dispositif. Les lots existants
-- viennent tous de la validation d'une session de courses, qui n'a jamais
-- demande ou on les rangeait. Poser DEFAULT 'frigo' affirmerait que le riz
-- complet est au frigo, et l'utilisateur le lirait comme une information.
-- NULL veut dire "pas encore range", etat que l'ecran expose franchement dans
-- un quatrieme onglet "A ranger", qui disparait une fois vide.
--
-- LE LIEU NE SE DEDUIT PAS DE category_l1. "Surgeles" est un rayon de magasin,
-- pas un lieu de rangement ; "Epicerie" contient le paprika et les pates. Deux
-- axes distincts, et les confondre rangerait les petits pois surgeles au frigo.
ALTER TABLE pantry_stock ADD COLUMN storage TEXT
  CHECK (storage IS NULL OR storage IN ('frigo','placard','congelateur'));

-- Depuis quand le lot est a CET endroit. `added_at` ne suffit pas : un lot
-- achete en mai et descendu au congelateur en juillet afficherait mai, et le
-- congelateur compte precisement le temps passe. Ecrit a chaque changement de
-- `storage`, NULL tant qu'il n'y en a pas eu.
ALTER TABLE pantry_stock ADD COLUMN storage_since TEXT;

CREATE INDEX ix_pantry_stock_storage ON pantry_stock (household_id, storage);

-- ---------- 2. L'unite de saisie, a cote de la masse ----------
-- La regle du projet, tenue sur `recipe_ingredient` depuis la 0001 et sur
-- `meal_plan_entry` depuis la 0011, ne l'etait PAS ici : un lait de coco saisi
-- en millilitres ressortait en grammes et se relisait en grammes. Le defaut
-- etait invisible parce que l'ecran n'affichait jamais de volume, et
-- `AddStockSheet` comme `LotSheet` passent `QuantityField` sans `unit` ni
-- `onUnitChange`, ce que CLAUDE.md interdit explicitement pour toute nouvelle
-- surface de saisie.
--
-- Pas de CHECK : le vocabulaire d'unites vit dans shared/src/units.ts et bouge
-- plus vite qu'une contrainte SQLite, qu'on ne sait pas modifier. NULL veut
-- dire "aucun choix enregistre" : l'ecran retombe sur son heuristique, la piece
-- quand l'ingredient en a une, le gramme sinon. Les lots existants gardent donc
-- exactement le comportement qu'ils ont aujourd'hui.
ALTER TABLE pantry_stock ADD COLUMN unit TEXT;

-- ---------- 3. Seuil de reapprovisionnement ----------
-- Sur `ingredient` et non sur `pantry_stock` : un seuil appartient au PRODUIT,
-- pas a un lot ouvert mardi. NULL veut dire "ce produit n'est pas suivi", ce
-- qui est exact pour la totalite des lignes existantes.
--
-- Il alimente une section "Reappro" de la liste de courses, CALCULEE EN DIRECT
-- et jamais stockee : un seuil stocke dans la liste divergerait du seuil du
-- produit des la premiere modification.
ALTER TABLE ingredient ADD COLUMN restock_threshold_g REAL
  CHECK (restock_threshold_g IS NULL OR restock_threshold_g > 0);

-- ---------- 4. Nutri-Score ----------
-- OpenFoodFacts le renvoie DEJA dans la reponse code-barres : c'est
-- `toOffCandidate` qui le jette a la traduction, pas la requete qui l'omet.
--
-- Structurellement vide pour CIQUAL et pour les fiches manuelles, qui n'ont pas
-- de code-barres. Ce n'est donc pas une donnee manquante qu'on finira par
-- completer, c'est une promesse que la source ne tiendra jamais pour ces
-- fiches-la : le comparateur DIT que la note est absente plutot que d'afficher
-- une case grise qui se lirait comme un mauvais score.
ALTER TABLE ingredient ADD COLUMN nutriscore_grade TEXT
  CHECK (nutriscore_grade IS NULL OR nutriscore_grade IN ('a','b','c','d','e'));

-- ---------- 5. Sorties de stock, avec leur motif ----------
-- Le journal distingue deja "consomme" de "retire", mais PAR LE NOM D'UNE CLE
-- dans un blob JSON (`consomme_g` contre `grammes`), accident de deux sites
-- d'appel plutot que decision. Et il ne dit toujours pas POURQUOI : un pot fini
-- et un pot perime laissent la meme trace.
--
-- Le seul instant ou la question a une reponse vraie est celui du geste, et le
-- geste passe deja par une route. On la pose la, une fois, et on n'a plus a
-- deviner.
--
-- UNE TABLE plutot qu'un champ de plus dans `activity_log.details` : un bilan
-- est une requete d'agregation, et `details` est une colonne TEXT sans schema
-- ni index. REFERENCES household est possible ici, contrairement aux colonnes
-- ajoutees en 0005 : la restriction de SQLite ne porte que sur
-- ALTER TABLE ADD COLUMN, pas sur CREATE TABLE.
CREATE TABLE pantry_movement (
  id            INTEGER PRIMARY KEY,
  household_id  INTEGER NOT NULL REFERENCES household (id),
  ingredient_id INTEGER NOT NULL REFERENCES ingredient (id) ON DELETE CASCADE,
  quantity_g    REAL    NOT NULL CHECK (quantity_g > 0),
  reason        TEXT    NOT NULL CHECK (reason IN ('consomme','jete')),
  at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
-- (foyer, date) : le bilan interroge toujours une fenetre de temps d'un foyer.
CREATE INDEX ix_pantry_movement_at ON pantry_movement (household_id, at);
