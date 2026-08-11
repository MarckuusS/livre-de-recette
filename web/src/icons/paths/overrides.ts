/**
 * Dessins maison, qui l'emportent sur ceux de Lucide.
 *
 * CE FICHIER N'EST PAS GENERE — c'est tout son interet. `paths/ui.ts` et
 * `paths/rayons.ts` sont reecrits par `scripts/import-lucide.mjs`, donc toute
 * retouche a la main y serait perdue au prochain import. Ce qu'on veut dessiner
 * soi-meme vit ici, et `registry.ts` le fusionne EN DERNIER : la cle qui
 * apparait des deux cotes prend la version maison.
 *
 * L'entree Lucide correspondante est volontairement CONSERVEE dans `MAP`. Elle
 * ne sert plus a rien tant que l'override existe, mais elle redevient le repli
 * le jour ou on retire une ligne d'ici — plutot qu'une icone qui disparait.
 *
 * A n'utiliser que lorsque Lucide ne dit pas la bonne chose. Chaque dessin
 * ajoute ici est un dessin qu'il faudra maintenir seul, ce qui est exactement
 * la raison pour laquelle le jeu maison a ete abandonne.
 *
 * Memes regles que le reste : grille 24, trait seul, aucune couleur litterale
 * (`none` ou `currentColor`), masse dans le carre 3 → 21. Les tests de
 * `resolve.test.ts` parcourent le registre fusionne et s'appliquent donc ici.
 */

export const OVERRIDE_PATHS = {
  /*
   * Brique de lait a pignon, vue de trois quarts.
   *
   * Lucide propose une BOUTEILLE (`milk`), ce qui n'est pas ce qu'on achete :
   * le lait de la bibliotheque arrive en brique.
   *
   * Quatre constructions ont ete rendues cote a cote a 24, 32 et 96 px. De
   * face, le pignon devient un toit et la brique se lit « maison » ; avec un
   * bouchon, elle se lit « bouteille ». Seule la vue de trois quarts dit
   * « carton », parce que la fuyante donne le volume que la face plate n'a pas.
   *
   * Trois traits, pas plus. La version precedente en avait cinq — deux bandes
   * d'etiquette et un pli de pignon — et se brouillait des 24 px : c'est ce que
   * montrait la capture de l'ecran Ingredients.
   *
   * La vache de la reference n'est pas reprise. L'etiquette laisse environ
   * 10 x 5 unites ; rendue a 20 px, une tete de vache y occupe quatre pixels et
   * salit la brique au lieu de la decorer.
   */
  'rayon-produits-laitiers':
    '<path d="M4 20.6V9.6l3.6-5.2h5l1 5.2v11Z"/>' +
    '<path d="m13.6 9.6 5.8-3v11l-5.8 3"/>' +
    '<path d="M4 13.6h9.6"/>',

  /*
   * Pot de yaourt, opercule souleve.
   *
   * Le rayon « Frais » partageait la brique des produits laitiers, et deux
   * sections voisines au meme dessin ne se distinguent plus.
   *
   * DEUX REGLES TIREES DE NEUF ESSAIS RENDUS A 24, 32 ET 96 px :
   *
   *   - la bouche est une ELLIPSE, jamais un trait. C'est elle qui dit que le
   *     pot est ouvert ; un trait droit donne un gobelet ferme.
   *   - l'opercule est ANGULAIRE et LARGE. Toutes les versions courbes — rabat
   *     en pointe, opercule enroule — se lisent comme une feuille de plante, et
   *     la version en diagonale fine comme une paille. Une feuille d'aluminium
   *     est plate : un quadrilatere ferme, pose sur le bord et incline, est la
   *     seule forme qui la designe sans ambiguite.
   */
  'rayon-frais':
    '<path d="M5.8 12.2 7.4 20.2a1.9 1.9 0 0 0 1.9 1.5h5.4a1.9 1.9 0 0 0 1.9-1.5l1.6-8"/>' +
    '<ellipse cx="12" cy="12" rx="6.2" ry="1.9"/>' +
    '<path d="M7.4 10.2 10.6 3.8l8 1.4-3.2 4.6Z"/>',
} as const
