-- =============================================================================
-- 0003_seed_tags.sql — les 10 tags de recette par defaut.
--
-- Reference : docs/portage/00-SPEC-PORTAGE.md section 2.6
--
-- Reprend a l'identique _seed_default_tags de app/data/db.py, couleurs
-- comprises. INSERT OR IGNORE sur le nom : rejouable sans effet de bord, et
-- surtout sans ecraser une couleur que l'utilisateur aurait changee.
--
-- Note : le desktop expose ces tags en LECTURE SEULE (aucune creation ni
-- edition). La creation de tags est ajoutee en phase 2 du portage.
-- =============================================================================

INSERT OR IGNORE INTO tag (name, color_hex) VALUES
  ('entrée',          '#fbbf24'),
  ('plat principal',  '#3b82f6'),
  ('dessert',         '#ec4899'),
  ('petit-déjeuner',  '#fb923c'),
  ('batch-cooking',   '#14b8a6'),
  ('végétarien',      '#22c55e'),
  ('végan',           '#16a34a'),
  ('sans gluten',     '#a855f7'),
  ('rapide',          '#ef4444'),
  ('du placard',      '#78716c');
