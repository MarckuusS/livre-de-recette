# Jeu d'icônes

Jeu maison, dessiné pour cette application. Il remplace les émojis, qui
changeaient de dessin d'un appareil à l'autre, ne suivaient pas le thème sombre
et ne pouvaient pas illustrer un rayon.

Deux familles, et deux seulement : **les rayons** et **l'interface**.

## Pas d'icône par aliment, et c'est délibéré

Un dessin par ingrédient obligerait à en ajouter un à chaque produit scanné, et
à faire deviner par une table de mots-clés ce que contient un nom commercial.
Cette table se trompe en silence : elle rend un dessin plausible mais faux, ce
qui est pire qu'un dessin générique — personne ne va vérifier.

Le rayon, lui, est une donnée que l'ingrédient **porte déjà**
(`ingredient.category_l1`). Un ingrédient prend donc l'icône de son rayon, et
un ingrédient sans rayon prend la cagette.

## Règles de dessin

Toute icône ajoutée doit les respecter, sans exception : c'est ce qui fait
qu'un jeu reste un jeu, et non une collection.

| Règle | Valeur |
|---|---|
| Grille | `viewBox="0 0 24 24"` |
| Trait | `stroke="currentColor"`, `fill="none"` |
| Épaisseur | `1.6` dans la grille 24 |
| Extrémités | `round`, jonctions `round` |
| Zone utile | le carré `3 → 21`, soit 18 unités sur 24 |
| Couleur | aucune. Jamais de `fill`/`stroke` codé en dur |

Les aplats sont tolérés pour les détails qui ne se lisent pas en contour : une
pupille, un grain. Ils portent alors explicitement
`fill="currentColor" stroke="none"` — sans le `stroke="none"`, le trait de
1,6 unité transforme un point de 0,7 de rayon en pâté.

## Où vit quoi

```
icons/
├── Icon.tsx        composant de rendu — pose les attributs communs
├── registry.ts     fusion des deux familles + type `IconName`
├── resolve.ts      libellé de rayon -> icône, et teinte CSS
└── paths/          les dessins
    ├── rayons.ts
    └── ui.ts
```

`paths/*.ts` ne contient que le CONTENU du `<svg>`, jamais la balise : les
attributs communs sont posés une fois dans `Icon.tsx`, ce qui rend impossible
qu'une icône dérive du système en redéfinissant les siens.

## Ajouter un rayon

1. Dessiner dans `paths/rayons.ts`, en respectant le tableau ci-dessus.
2. Ajouter les fragments de libellé reconnus dans `RAYON_RULES` (`resolve.ts`).
   **L'ordre y est significatif**, contrairement au reste du projet : la
   première règle qui accroche gagne. Deux paires en dépendent et sont
   couvertes par un test — `surgelés` avant `légumes`, `fruits de mer` avant
   `fruits`.
3. Déclarer sa teinte dans `styles/icons.css`, sous les deux thèmes. Un test
   échoue si un rayon n'en a pas.
4. Vérifier le rendu dans la galerie : **Paramètres → Jeu d'icônes**.

## Export

`node scripts/export-icons.mjs` régénère `docs/icones/` : un `.svg` autonome
par icône, plus une galerie HTML. Robinet à sens unique — éditer un `.svg`
exporté n'a aucun effet sur l'application.
