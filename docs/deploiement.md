# Déploiement

Le front est servi par **Cloudflare Pages**, l'API par un **Worker** sur `/api/*`,
les données vivent dans **D1**, les photos et tickets dans **R2**.

Production : https://livre-de-recette.pages.dev

---

## 1. Le front (Cloudflare Pages)

À faire **une seule fois**, dans le tableau de bord Cloudflare →
*Workers & Pages* → projet `livre-de-recette` → *Settings* → *Builds & deployments*.

Connecter le dépôt GitHub `MarckuusS/livre-de-recette`, branche de production `main`,
puis renseigner :

| Réglage | Valeur |
|---|---|
| Framework preset | `None` |
| Build command | `npm install && npm run build --workspace @livre/web` |
| Build output directory | `web/dist` |
| Root directory | *(laisser vide — la racine du dépôt)* |

La version de Node est lue dans `.node-version` à la racine (22). Sans ce
fichier, Pages utilise une version ancienne sur laquelle Vite 6 refuse de
démarrer.

Ensuite, **chaque push sur `main` déclenche une construction et un déploiement**.
Aucun identifiant Cloudflare n'est nécessaire en local — ce qui est le
comportement voulu pour un dépôt public.

### Pourquoi `web/public/_redirects` est indispensable

L'application utilise de vraies URL (`/courses`, `/recettes`). Sans ce fichier,
ouvrir directement `https://…/courses` renvoie un 404 : Pages y cherche un
fichier qui n'existe pas. La règle `/* /index.html 200` sert `index.html` en
conservant l'URL, et le routeur prend le relais côté client.

La règle `/api/*` placée **avant** est tout aussi importante : sans elle, un
appel d'API sur un chemin inconnu renverrait `index.html` avec un code 200, et
le client planterait en essayant de parser du HTML comme du JSON.

---

## 2. L'API (Worker + D1 + R2)

Nécessite une authentification locale, à faire par le propriétaire du compte :

```bash
npx wrangler login
```

Puis, une seule fois, créer les ressources :

```bash
npx wrangler d1 create livre-de-recettes
npx wrangler r2 bucket create livre-de-recettes-media
npx wrangler kv namespace create CACHE
```

Chaque commande affiche un identifiant à reporter dans `wrangler.toml`
(`database_id`, `id` du namespace KV). Ces identifiants ne sont **pas** des
secrets : ils n'autorisent rien sans le compte. Ils peuvent donc être versionnés.

Appliquer ensuite le schéma et charger les données :

```bash
npm run db:migrate:remote     # crée les tables, l'index FTS5 et les tags
npm run db:export             # relit le SQLite local -> scripts/_dump/d1-seed.sql
npm run db:load:remote        # charge les données dans D1
```

Et la photo de recette :

```bash
npx wrangler r2 object put livre-de-recettes-media/recipes/6.jpg \
  --file="$HOME/.livre-de-recettes/recipe_photos/6.jpg"
```

Enfin, déployer le Worker :

```bash
npx wrangler deploy
```

### Router `/api/*` vers le Worker

Dans le tableau de bord du Worker → *Settings* → *Domains & Routes*, ajouter la
route `livre-de-recette.pages.dev/api/*`.

---

## 3. Vérifier

```bash
curl https://livre-de-recette.pages.dev/api/health
```

Ou, depuis l'application, l'écran **Diagnostic** (bouton `⋯` en haut à droite) :
il affiche la version déployée, la joignabilité de l'API, l'état de la base et
le nombre d'ingrédients.

---

## 4. Installer sur l'iPhone

Ouvrir https://livre-de-recette.pages.dev dans **Safari** (Chrome iOS ne sait pas
installer de PWA), puis *Partager* → **Sur l'écran d'accueil**.

L'application se lance alors en plein écran, sans barre d'adresse. L'écran
Diagnostic indique « installée sur l'écran d'accueil » quand c'est bien le cas.

---

## Avant chaque mise en production

```bash
npm run test         # domaine partagé
npm run typecheck    # TypeScript strict
npm run db:verify    # fidélité de la migration des données
```

## Authentification

L'application est protégée par un **mot de passe unique**, vérifié par le Worker.

```bash
npx wrangler pages secret put APP_PASSWORD
```

Le secret est stocké chiffré chez Cloudflare et injecté à l'exécution. Il n'est
ni dans le dépôt, ni dans le navigateur, ni dans la base.

**Tant que ce secret n'est pas défini, `/api/login` répond 503 et toute l'API
reste fermée.** Un défaut de configuration ne doit jamais ouvrir la porte.

### Comment ça marche

- `POST /api/login` compare le mot de passe en temps constant, puis pose un
  cookie `HttpOnly; Secure; SameSite=Strict` valable 90 jours ;
- le cookie contient une date d'expiration signée en HMAC-SHA256, dont la clé
  est le mot de passe lui-même. Le modifier invalide donc toutes les sessions ;
- toute route `/api/*` exige ce cookie, sauf `login`, `logout` et `session` ;
- 10 échecs verrouillent les tentatives pendant 15 minutes.

Le détail, limites comprises, est en tête de [`worker/src/auth.ts`](../worker/src/auth.ts).

### Déverrouiller après trop de tentatives

```bash
npx wrangler d1 execute livre-de-recettes --remote \
  --command "DELETE FROM app_setting WHERE key='auth.failures'"
```

### Changer le mot de passe

Rejouer `wrangler pages secret put APP_PASSWORD`. Toutes les sessions ouvertes
sont invalidées, sur tous les appareils.

### Pourquoi pas Cloudflare Access

Access a été utilisé en premier et protégeait mieux — il refusait la requête
avant même d'atteindre notre code. Mais sa page de connexion vit sur une autre
origine, et un `fetch()` ne peut pas lire une réponse issue d'une redirection
cross-origin : l'API devenait « injoignable » dès que la session expirait, sans
qu'on puisse le distinguer d'une panne de réseau. Inutilisable dans une PWA
installée.

Le compromis est assumé : cette vérification s'exécute *dans* le Worker, donc
un bug ici ouvre la porte, là où Access rendait cela impossible.

---

## Sécurité

Le dépôt est **public**. Trois règles :

- aucun secret dans `wrangler.toml` — utiliser `npx wrangler secret put <NOM>`,
  et `.dev.vars` en local (git-ignoré) ;
- aucune adresse mail dans le code — OpenFoodFacts accepte l'URL du projet
  comme moyen de contact dans le `User-Agent` ;
- aucune donnée personnelle — la base locale, les dumps `scripts/_dump/` et les
  tickets de caisse sont git-ignorés.
