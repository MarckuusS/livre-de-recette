-- =============================================================================
-- Bibliotheque d'icones personnelles.
--
-- L'utilisateur colle du SVG, on le range ici, et n'importe quel rayon peut
-- ensuite s'y referer. La table est cloisonnee par foyer des sa creation :
-- c'est du contenu televerse, donc exactement ce qu'on ne veut pas voir
-- traverser la frontiere entre deux cuisines.
-- =============================================================================

CREATE TABLE custom_icon (
  id           INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL DEFAULT 1,

  name         TEXT    NOT NULL,

  -- Contenu du `<svg>`, DEJA ASSAINI par shared/src/svg.ts. La balise racine
  -- n'est pas stockee : c'est `<Icon>` qui la pose, avec les attributs communs
  -- du jeu. Stocker deux `<svg>` imbriques donnerait un dessin a la mauvaise
  -- echelle.
  --
  -- Rien ici ne garantit l'assainissement — une colonne TEXT accepte tout. La
  -- garantie vient de la route, seul chemin d'ecriture, qui refuse d'enregistrer
  -- ce qu'elle n'a pas assaini elle-meme. Le front assainit aussi, mais pour
  -- l'apercu seulement : sa sortie n'est jamais ce qu'on envoie.
  markup       TEXT    NOT NULL,

  -- `viewBox` d'origine. Une icone prise ailleurs arrive rarement en grille 24 :
  -- plutot que de remettre ses coordonnees a l'echelle — calcul faux des qu'il y
  -- a un `transform` — on garde sa grille et on la laisse au navigateur.
  view_box     TEXT    NOT NULL DEFAULT '0 0 24 24',

  -- 0 : couleurs retirees, l'icone prend la teinte du rayon et suit le theme.
  -- 1 : apparence d'origine conservee, au prix de cette adaptation.
  keep_colors  INTEGER NOT NULL DEFAULT 0 CHECK (keep_colors IN (0, 1)),

  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Le nom sert a s'y retrouver dans la grille de choix : deux icones
-- homonymes dans la meme cuisine seraient indistinguables.
CREATE UNIQUE INDEX ix_custom_icon_name ON custom_icon (household_id, name);

-- Pas de cle etrangere depuis `category_definition.icon`.
--
-- La colonne porte deja un nom d'icone integree (« rayon-boucherie ») ; une
-- icone personnelle s'y ecrit « custom:12 ». Une contrainte ne saurait pas
-- distinguer les deux formes.
--
-- La consequence est assumee et deja geree : supprimer une icone laisse des
-- rayons pointant vers un identifiant mort, et `makeRayonStyle` retombe alors
-- sur l'icone deduite du nom. Un rayon perd son dessin choisi, il ne casse pas.
