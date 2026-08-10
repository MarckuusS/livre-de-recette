# Jeu d'icônes

Jeu maison, dessiné pour cette application. Il remplace les émojis, qui
changeaient de dessin d'un appareil à l'autre, ne suivaient pas le thème sombre
et ne pouvaient pas illustrer un rayon.

## Règles de dessin

Toute icône ajoutée doit les respecter, sans exception : c'est ce qui fait
qu'un jeu de deux cents dessins reste un jeu, et non une collection.

| Règle | Valeur |
|---|---|
| Grille | `viewBox="0 0 24 24"` |
| Trait | `stroke="currentColor"`, `fill="none"` |
| Épaisseur | `1.6` dans la grille 24 |
| Extrémités | `round`, jonctions `round` |
| Zone utile | le carré `3 → 21`, soit 18 unités sur 24 |
| Couleur | aucune. Jamais de `fill`/`stroke` codé en dur |

Les aplats sont tolérés pour les détails qui ne se lisent pas en contour : un
pépin, une pupille, un grain de poivre. Ils portent alors explicitement
`fill="currentColor" stroke="none"` — sans le `stroke="none"`, le trait de
1,6 unité transforme un point de 0,7 de rayon en pâté.

## Où vit quoi

```
icons/
├── Icon.tsx        composant de rendu — pose les attributs communs
├── registry.ts     fusion des familles + type `IconName`
├── resolve.ts      libellé -> icône (ingrédient et rayon)
└── paths/          les dessins, une famille par fichier
```

`paths/*.ts` ne contient que le CONTENU du `<svg>`, jamais la balise : les
attributs communs sont posés une fois dans `Icon.tsx`, ce qui rend impossible
qu'une icône dérive du système en redéfinissant les siens.

## Ajouter une icône

1. Dessiner dans le fichier de famille, en respectant le tableau ci-dessus.
2. Ajouter le ou les mots-clés dans `KEYWORDS` (`resolve.ts`), **au singulier** :
   le pluriel est géré à la compilation.
3. Vérifier le rendu dans la galerie : **Paramètres → Jeu d'icônes**.

Le mot-clé le plus long l'emporte. Pas besoin de ranger le tableau par
spécificité : `cacahuete` (9) bat `beurre` (6) tout seul, et le jour où
quelqu'un insère une ligne au mauvais endroit, rien ne casse.

## Ce que le jeu ne couvre pas

Un ingrédient sans mot-clé reconnu prend l'icône de son rayon, et un ingrédient
sans rayon prend la cagette. C'est volontaire : mieux vaut un repli honnête
qu'un dessin faux. La couverture se mesure dans la galerie, qui affiche le taux
d'ingrédients de la bibliothèque tombant sur un repli.
