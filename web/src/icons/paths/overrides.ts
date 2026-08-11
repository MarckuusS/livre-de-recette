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
   * La vache de la reference n'a pas ete reprise, et ce n'est pas un oubli.
   * L'etiquette laisse une zone utile d'environ 10 x 5 unites sur la grille 24 ;
   * rendue a 20 px — la taille reelle en liste — une tete de vache y occupe
   * quatre pixels et devient une salissure au milieu de la brique. Le rendu
   * comparatif a 16, 20, 24, 32 et 64 px l'a montre sans ambiguite. Le pignon,
   * la fuyante et les deux bandes d'etiquette suffisent a designer une brique,
   * et tiennent jusqu'a 16 px.
   */
  'rayon-produits-laitiers':
    '<path d="M3.6 21.4V9.8L7 4.8h5.4l1 5v11.6Z"/>' +
    '<path d="M13.4 9.8 19 6.8v11.6l-5.6 3"/>' +
    '<path d="m12.4 4.8 6.6 2"/>' +
    '<path d="M3.6 12.6h9.8M3.6 18h9.8"/>',
  /*
   * Pot de yaourt, opercule decolle.
   *
   * Le rayon « Frais » partageait la brique des produits laitiers, et deux
   * sections voisines au meme dessin ne se distinguent plus — c'est ce que la
   * capture de l'ecran Ingredients montrait.
   *
   * La bouche est une ellipse et non un trait : c'est ce qui dit que le pot est
   * OUVERT. L'opercule est un rabat ferme, attache au bord gauche et dresse en
   * pointe : parmi trois versions rendues a 16, 20, 24, 32 et 64 px, c'est la
   * seule dont on lit encore le decollement a 24 px. La version enroulee
   * ressemblait a une cuillere, la version rabattue a un couvercle pose.
   */
  'rayon-frais':
    '<path d="M6.6 11.2 8 20a1.8 1.8 0 0 0 1.8 1.5h4.4A1.8 1.8 0 0 0 16 20l1.4-8.8"/>' +
    '<ellipse cx="12" cy="11" rx="5.4" ry="1.7"/>' +
    '<path d="M7.4 9.8c-1.5-3.4.5-6.2 4.4-6.6-1.4 2.3-1 4.2 1 5.6Z"/>',
} as const
