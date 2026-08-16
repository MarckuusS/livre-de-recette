-- =============================================================================
-- Invitations : un compte cree par l'administration, un mot de passe choisi
-- par son proprietaire.
--
-- POURQUOI CETTE TABLE EXISTE. La console d'administration cree des comptes,
-- mais l'administrateur ne doit pas choisir le mot de passe d'autrui : il le
-- verrait, le transmettrait par un canal quelconque, et il finirait reutilise.
-- Le compte est donc cree AVEC UNE EMPREINTE INUTILISABLE, et un lien a usage
-- unique permet a la personne d'en poser une vraie. Le mot de passe ne transite
-- alors ni par le reseau de l'administrateur, ni par son ecran.
--
-- -----------------------------------------------------------------------------
-- SHA-256 ICI, PBKDF2 POUR UN MOT DE PASSE : ce n'est pas une inconsequence.
-- -----------------------------------------------------------------------------
-- La regle est celle deja ecrite en tete de worker/src/auth.ts : le hachage
-- lent protege un secret que l'humain a choisi, donc devinable. Un jeton
-- d'invitation, lui, fait 256 bits tires au hasard : il n'y a rien a deviner,
-- et PBKDF2 n'ajouterait qu'un delai a chaque verification.
--
-- On stocke bien une EMPREINTE et non le jeton : une fuite de cette table ne
-- doit pas permettre de reclamer les invitations en attente.
-- =============================================================================

CREATE TABLE user_invite (
  -- SHA-256 hexadecimal du jeton. Cle primaire : la recherche se fait par
  -- empreinte, jamais par utilisateur.
  token_hash TEXT    PRIMARY KEY,

  -- ON DELETE CASCADE : revoquer une invitation, c'est supprimer le compte en
  -- attente, ce que la console sait deja faire. Sans la cascade, l'invitation
  -- survivrait a son destinataire.
  user_id    INTEGER NOT NULL REFERENCES user (id) ON DELETE CASCADE,

  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- Une invitation qui ne perime pas est un mot de passe permanent range dans
  -- un historique de messagerie.
  expires_at TEXT    NOT NULL,

  -- Usage unique. Renseigne AVANT que le mot de passe ne soit pose : c'est ce
  -- qui fait qu'une seule de deux requetes simultanees peut aboutir.
  used_at    TEXT,

  -- Creation d'un compte, ou reinitialisation d'un mot de passe existant ?
  --
  -- Le mecanisme est le meme, l'ecran ne doit pas l'etre : « Bienvenue, Tom »
  -- adresse a quelqu'un qui a perdu son mot de passe depuis deux ans sonne
  -- faux, et laisse croire qu'un second compte vient d'etre cree.
  --
  -- On le STOCKE plutot que de le deduire de `last_login_at IS NULL`. La
  -- deduction serait juste presque toujours, et fausse precisement dans le cas
  -- ou l'on regarde : un compte cree puis jamais utilise, dont on reinitialise
  -- le mot de passe.
  kind       TEXT    NOT NULL DEFAULT 'creation' CHECK (kind IN ('creation','reinitialisation'))
);

-- Retrouver les invitations d'un compte : la console affiche « en attente »,
-- et remplacer une invitation efface les precedentes.
CREATE INDEX ix_invite_user ON user_invite (user_id);
