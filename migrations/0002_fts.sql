-- =============================================================================
-- 0002_fts.sql — recherche plein-texte sur les noms d'ingredients.
--
-- Reference : docs/portage/00-SPEC-PORTAGE.md section 2.4
--
-- FTS5 fait partie de la compilation SQLite standard et Cloudflare D1 le
-- documente comme supporte (y compris fts5vocab). Aucune extension externe.
--
-- Le tokenizer 'unicode61 remove_diacritics 2' est ce qui rend la recherche
-- insensible aux accents : « tomate » trouve « Tomâte », « creme » trouve
-- « Crème ». C'est le comportement attendu par les 6 ecrans qui l'utilisent.
--
-- ATTENTION — table a contenu externe (content='ingredient') : l'index n'est
-- PAS alimente par les INSERT dans `ingredient`, seulement par les triggers
-- ci-dessous. Tout chargement de masse qui les contourne laisse l'index vide,
-- et la recherche renvoie alors 0 resultat SANS lever la moindre erreur.
-- D'ou le 'rebuild' final, que le code Python d'origine n'appelait jamais.
-- =============================================================================

CREATE VIRTUAL TABLE ingredient_fts USING fts5(
  name,
  content='ingredient',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER ingredient_ai AFTER INSERT ON ingredient BEGIN
  INSERT INTO ingredient_fts (rowid, name) VALUES (new.id, new.name);
END;

CREATE TRIGGER ingredient_ad AFTER DELETE ON ingredient BEGIN
  INSERT INTO ingredient_fts (ingredient_fts, rowid, name) VALUES ('delete', old.id, old.name);
END;

CREATE TRIGGER ingredient_au AFTER UPDATE ON ingredient BEGIN
  INSERT INTO ingredient_fts (ingredient_fts, rowid, name) VALUES ('delete', old.id, old.name);
  INSERT INTO ingredient_fts (rowid, name) VALUES (new.id, new.name);
END;

-- Filet de securite : reconstruit l'index depuis la table source.
-- Sans effet si `ingredient` est vide (cas d'une base neuve), indispensable
-- si des lignes ont ete chargees avant cette migration.
INSERT INTO ingredient_fts (ingredient_fts) VALUES ('rebuild');
