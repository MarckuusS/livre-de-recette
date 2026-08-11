# Jeu d'icônes

67 icônes : **10 rayons** et 57 d'interface. Elles remplacent les émojis, qui
changeaient de dessin d'un appareil à l'autre, ne suivaient pas le thème sombre
et ne pouvaient pas illustrer un rayon.

## Les dessins viennent de Lucide

[lucide.dev](https://lucide.dev), version **0.469.0**, licence **ISC** — et
**MIT** pour ce qui dérive de Feather. Le texte complet est dans
[LICENSE-lucide.txt](LICENSE-lucide.txt), à conserver : c'est la condition de
redistribution, et ce dépôt est public.

Ils ont remplacé un jeu dessiné à la main. Ce n'était pas une question de goût :
un jeu maison demande d'être maintenu à chaque icône manquante, et il vieillit
seul. Lucide est cohérent, maintenu, et déjà en grille 24.

### Pourquoi pas la dépendance `lucide-react`

Le paquet expose un composant par icône, tire React, et laisse **chaque icône
poser ses propres attributs** — exactement ce que `Icon.tsx` interdit depuis le
début. On prend donc la matière (les chemins) et on garde le cadre.

Conséquence utile : Lucide publie ses dessins à `stroke-width: 2`, on les rend à
**1,6**. C'est possible précisément parce que l'épaisseur n'est écrite nulle part
dans les chemins.

## Règles qui tiennent, quelle que soit la source

| Règle | Valeur |
|---|---|
| Grille | `viewBox="0 0 24 24"` |
| Trait | `stroke="currentColor"`, `fill="none"` |
| Épaisseur | `1.6`, posée par `Icon.tsx` |
| Couleur | aucune valeur littérale. `none` ou `currentColor`, rien d'autre |

La dernière ligne est vérifiée par un test : une couleur en dur figerait
l'icône et lui ferait rater la teinte de son rayon comme le thème sombre.
Lucide en pose lui-même quelques-unes (le trou de l'étiquette, l'œil du
poisson), toutes en `currentColor`.

## Où vit quoi

```
icons/
├── Icon.tsx            rendu d'une icône du jeu
├── RayonIcon.tsx       rendu d'un glyphe de rayon (jeu OU icône collée)
├── registry.ts         fusion des deux familles + type `IconName`
├── resolve.ts          libellé de rayon -> icône déduite
├── rayonStyle.ts       réglages de l'utilisateur -> glyphe + teinte
├── LICENSE-lucide.txt  à conserver
└── paths/              les dessins — GÉNÉRÉS, ne pas éditer à la main
    ├── rayons.ts
    └── ui.ts
```

## Ajouter ou changer une icône

`paths/*.ts` est **généré**. Une retouche à la main serait écrasée au prochain
import.

1. Ajouter la ligne dans `MAP`, dans `scripts/import-lucide.mjs`.
2. `node scripts/import-lucide.mjs` — il récupère, filtre et réécrit.
3. `npm --workspace @livre/web run test`.

Le script passe chaque SVG par `sanitizeSvg`, l'assainisseur écrit pour les
icônes collées par l'utilisateur. Même besoin, même code : retirer la balise
racine et ne garder que les formes.

Il refuse une icône dont la grille n'est pas `0 0 24 24`, et connaît quelques
noms de repli — Lucide renomme régulièrement (`filter` est devenu `funnel`
ailleurs, `bar-chart` est devenu `chart-column`). La version est **figée** :
`latest` rendrait le script non reproductible d'un mois sur l'autre.

## Les icônes de l'utilisateur

Un SVG collé dans **Paramètres → Mes icônes** ne passe pas par ici : il vit en
base, assaini par le serveur (`worker/src/routes/icons.ts`), et se réfère depuis
un rayon sous la forme `custom:12`. Voir `rayonStyle.ts`.

## Ce que le jeu ne couvre pas

Il n'y a **pas d'icône par aliment**, délibérément. Un ingrédient porte l'icône
de son rayon, donnée qu'il a déjà. Dessiner par aliment supposerait une table de
mots-clés qui se trompe en silence et rend un dessin faux — pire qu'un dessin
générique.
