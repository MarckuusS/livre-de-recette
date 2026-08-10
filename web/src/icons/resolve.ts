/**
 * Du libelle a l'icone.
 *
 * Les noms d'ingredients viennent de trois sources qui ne se parlent pas :
 * CIQUAL (« Poulet, haut de cuisse, viande crue »), OpenFoodFacts (« Filet de
 * Poulet Blanc ») et la saisie libre. Aucune ne fournit de code produit
 * exploitable pour choisir un dessin. La correspondance se fait donc sur le
 * libelle, en trois etages :
 *
 *   1. un mot-cle reconnu dans le nom          -> l'icone de l'aliment ;
 *   2. a defaut, le rayon                      -> l'icone du rayon ;
 *   3. a defaut, la cagette                    -> `rayon-autre`.
 *
 * REGLE DE DEPARTAGE : le mot-cle le PLUS LONG gagne, et a longueur egale le
 * plus a gauche. C'est ce qui fait que « Beurre de cacahuètes » donne une
 * cacahuete et non du beurre, et « Pomme de terre » un tubercule et non un
 * fruit — sans dependre de l'ordre des lignes du tableau, qui finirait
 * fatalement par etre casse par un ajout distrait.
 */

import type { IconName } from './registry.js'

/** Bloc « Combining Diacritical Marks » : ce que NFD detache des lettres accentuees. */
const DIACRITICS = /[\u0300-\u036f]/g

/**
 * Minuscules, sans accents, sans ponctuation.
 *
 * `œ` ne se decompose PAS en NFD : sans la substitution explicite, « Œuf »
 * deviendrait « uf » et ne correspondrait plus a rien.
 */
export function normalizeLabel(text: string): string {
  return text
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Mots-cles au singulier, deja normalises (minuscules, sans accent).
 *
 * Le pluriel est gere a la compilation : chaque mot accepte un `s` ou un `x`
 * final. Ecrire « lentilles » ici serait donc une erreur — « lentille » couvre
 * les deux, alors que « lentilles » raterait le singulier.
 */
const KEYWORDS: ReadonlyArray<readonly [string, IconName]> = [
  // ---------- Legumes ----------
  ['carotte', 'carotte'],
  ['oignon', 'oignon'],
  ['echalote', 'oignon'],
  ['ciboule', 'oignon'],
  ['ail', 'ail'],
  ['gousse d ail', 'ail'],
  ['poireau', 'poireau'],
  ['pomme de terre', 'pomme-de-terre'],
  ['patate', 'pomme-de-terre'],
  ['patate douce', 'patate-douce'],
  ['tomate', 'tomate'],
  ['courgette', 'courgette'],
  ['aubergine', 'aubergine'],
  ['poivron', 'poivron'],
  ['piment', 'piment'],
  ['harissa', 'piment'],
  ['sriracha', 'piment'],
  ['tabasco', 'piment'],
  ['cayenne', 'piment'],
  ['concombre', 'concombre'],
  ['cornichon', 'concombre'],
  ['salade', 'salade'],
  ['laitue', 'salade'],
  ['roquette', 'salade'],
  ['mache', 'salade'],
  ['batavia', 'salade'],
  ['sucrine', 'salade'],
  ['epinard', 'epinard'],
  ['chou', 'chou'],
  ['chou rouge', 'chou'],
  ['chou fleur', 'chou-fleur'],
  ['brocoli', 'brocoli'],
  ['haricot vert', 'haricot-vert'],
  ['petit pois', 'petit-pois'],
  ['mais', 'mais'],
  ['champignon', 'champignon'],
  ['cepe', 'champignon'],
  ['girolle', 'champignon'],
  ['shiitake', 'champignon'],
  ['pleurote', 'champignon'],
  ['betterave', 'betterave'],
  ['radis', 'radis'],
  ['navet', 'navet'],
  ['celeri', 'celeri'],
  ['asperge', 'asperge'],
  ['artichaut', 'artichaut'],
  ['courge', 'courge'],
  ['potiron', 'courge'],
  ['potimarron', 'courge'],
  ['citrouille', 'courge'],
  ['butternut', 'courge'],
  ['fenouil', 'fenouil'],
  ['endive', 'endive'],
  ['avocat', 'avocat'],
  ['olive', 'olive'],

  // ---------- Fruits ----------
  ['pomme', 'pomme'],
  ['poire', 'poire'],
  ['banane', 'banane'],
  ['orange', 'orange'],
  ['clementine', 'orange'],
  ['mandarine', 'orange'],
  ['citron', 'citron'],
  ['pamplemousse', 'pamplemousse'],
  ['fraise', 'fraise'],
  ['framboise', 'framboise'],
  ['myrtille', 'myrtille'],
  ['cassis', 'myrtille'],
  ['groseille', 'myrtille'],
  ['mure', 'myrtille'],
  ['cerise', 'cerise'],
  ['raisin', 'raisin'],
  ['peche', 'peche'],
  ['nectarine', 'peche'],
  ['abricot', 'abricot'],
  ['prune', 'prune'],
  ['mirabelle', 'prune'],
  ['quetsche', 'prune'],
  ['pruneau', 'prune'],
  ['ananas', 'ananas'],
  ['mangue', 'mangue'],
  ['kiwi', 'kiwi'],
  ['melon', 'melon'],
  ['pasteque', 'pasteque'],
  ['figue', 'figue'],
  ['grenade', 'grenade'],
  ['noix de coco', 'noix-de-coco'],
  ['lait de coco', 'noix-de-coco'],
  ['coco', 'noix-de-coco'],
  ['datte', 'datte'],

  // ---------- Herbes et epices ----------
  ['basilic', 'basilic'],
  ['pesto', 'basilic'],
  ['persil', 'persil'],
  ['ciboulette', 'ciboulette'],
  ['thym', 'thym'],
  ['romarin', 'romarin'],
  ['laurier', 'laurier'],
  ['menthe', 'menthe'],
  ['coriandre', 'coriandre'],
  ['herbe', 'herbes'],
  ['aromate', 'herbes'],
  ['origan', 'herbes'],
  ['estragon', 'herbes'],
  ['aneth', 'herbes'],
  ['poivre', 'poivre'],
  ['sel', 'sel'],
  ['fleur de sel', 'sel'],
  ['gros sel', 'sel'],
  ['epice', 'epices'],
  ['paprika', 'poudre'],
  ['curcuma', 'poudre'],
  ['cumin', 'poudre'],
  ['muscade', 'poudre'],
  ['curry', 'poudre'],
  ['safran', 'poudre'],
  ['ras el hanout', 'poudre'],
  ['cannelle', 'cannelle'],
  ['gingembre', 'gingembre'],
  ['vanille', 'vanille'],
  ['graine', 'graines'],
  ['sesame', 'graines'],
  ['tournesol', 'graines'],
  ['pavot', 'graines'],
  ['chia', 'graines'],
  ['bouillon', 'bouillon'],
  ['cube', 'bouillon'],

  // ---------- Feculents ----------
  ['riz', 'riz'],
  ['pate', 'pates'],
  ['spaghetti', 'pates'],
  ['tagliatelle', 'pates'],
  ['linguine', 'pates'],
  ['penne', 'pates'],
  ['fusilli', 'pates'],
  ['farfalle', 'pates'],
  ['nouille', 'pates'],
  ['lasagne', 'pates'],
  ['vermicelle', 'pates'],
  ['ravioli', 'pates'],
  ['macaroni', 'macaroni'],
  ['coquillette', 'macaroni'],
  ['pain', 'pain'],
  ['biscotte', 'pain'],
  ['pain de mie', 'pain-de-mie'],
  ['baguette', 'baguette'],
  ['farine', 'farine'],
  ['semoule', 'graines'],
  ['couscous', 'graines'],
  ['boulgour', 'graines'],
  ['quinoa', 'graines'],
  ['polenta', 'poudre'],
  ['avoine', 'cereales'],
  ['flocon', 'cereales'],
  ['muesli', 'cereales'],
  ['cereale', 'cereales'],
  ['ble', 'cereales'],
  ['epeautre', 'cereales'],
  ['orge', 'cereales'],
  ['seigle', 'cereales'],
  ['lentille', 'lentilles'],
  ['pois chiche', 'pois-chiche'],
  ['haricot rouge', 'haricot-sec'],
  ['haricot blanc', 'haricot-sec'],
  ['haricot sec', 'haricot-sec'],
  ['flageolet', 'haricot-sec'],
  ['feve', 'haricot-sec'],
  ['noix', 'noix'],
  ['cajou', 'noix'],
  ['amande', 'amande'],
  ['pistache', 'amande'],
  ['noisette', 'noisette'],
  ['nocciolata', 'noisette'],
  ['cacahuete', 'cacahuete'],
  ['arachide', 'cacahuete'],

  // ---------- Viandes, poissons, oeufs ----------
  ['boeuf', 'boeuf'],
  ['steak', 'boeuf'],
  ['entrecote', 'boeuf'],
  ['bavette', 'boeuf'],
  ['rumsteck', 'boeuf'],
  ['veau', 'boeuf'],
  ['agneau', 'boeuf'],
  ['mouton', 'boeuf'],
  ['gigot', 'boeuf'],
  ['porc', 'boeuf'],
  ['viande', 'boeuf'],
  ['steak hache', 'steak-hache'],
  ['viande hachee', 'steak-hache'],
  ['poulet', 'poulet'],
  ['volaille', 'poulet'],
  ['poule', 'poulet'],
  ['dinde', 'poulet'],
  ['canard', 'poulet'],
  ['escalope', 'filet'],
  ['aiguillette', 'filet'],
  ['jambon', 'jambon'],
  ['charcuterie', 'jambon'],
  ['chorizo', 'jambon'],
  ['saucisson', 'jambon'],
  ['bacon', 'lardons'],
  ['lardon', 'lardons'],
  ['saucisse', 'saucisse'],
  ['merguez', 'saucisse'],
  ['chipolata', 'saucisse'],
  ['montbeliard', 'saucisse'],
  ['poisson', 'poisson'],
  ['cabillaud', 'poisson'],
  ['colin', 'poisson'],
  ['merlu', 'poisson'],
  ['dorade', 'poisson'],
  ['truite', 'poisson'],
  ['sardine', 'poisson'],
  ['maquereau', 'poisson'],
  ['hareng', 'poisson'],
  ['anchois', 'poisson'],
  ['thon', 'poisson'],
  ['calamar', 'poisson'],
  ['encornet', 'poisson'],
  ['saumon', 'saumon'],
  ['crevette', 'crevette'],
  ['gambas', 'crevette'],
  ['langoustine', 'crevette'],
  ['moule', 'moule'],
  ['huitre', 'coquillage'],
  ['saint jacques', 'coquillage'],
  ['palourde', 'coquillage'],
  ['oeuf', 'oeuf'],

  // ---------- Produits laitiers ----------
  ['lait', 'lait'],
  ['creme', 'creme'],
  ['creme fraiche', 'creme'],
  ['beurre', 'beurre'],
  ['yaourt', 'yaourt'],
  ['yogourt', 'yaourt'],
  ['skyr', 'yaourt'],
  ['fromage blanc', 'yaourt'],
  ['petit suisse', 'yaourt'],
  ['fromage', 'fromage'],
  ['cheddar', 'fromage'],
  ['mozzarella', 'fromage'],
  ['parmesan', 'fromage'],
  ['feta', 'fromage'],
  ['chevre', 'fromage'],
  ['gruyere', 'fromage'],
  ['emmental', 'fromage'],
  ['comte', 'fromage-meule'],
  ['camembert', 'fromage-meule'],
  ['brie', 'fromage-meule'],
  ['raclette', 'fromage'],
  ['ricotta', 'fromage'],
  ['mascarpone', 'fromage'],

  // ---------- Epicerie ----------
  ['huile', 'huile'],
  ['huile d olive', 'huile'],
  ['vinaigre', 'vinaigre'],
  ['balsamique', 'vinaigre'],
  ['moutarde', 'bocal'],
  ['confiture', 'bocal'],
  ['marmelade', 'bocal'],
  ['pate a tartiner', 'bocal'],
  ['nutella', 'bocal'],
  ['mayonnaise', 'sauce'],
  ['ketchup', 'sauce'],
  ['sauce', 'sauce'],
  ['tamari', 'sauce'],
  ['soja', 'sauce'],
  ['nuoc mam', 'sauce'],
  ['sirop', 'sauce'],
  ['agave', 'sauce'],
  ['erable', 'sauce'],
  ['conserve', 'conserve'],
  ['levure', 'sachet'],
  ['miel', 'miel'],
  ['sucre', 'sucre'],
  ['cassonade', 'sucre'],
  ['chocolat', 'chocolat'],
  ['chocolate', 'chocolat'],
  ['cacao', 'chocolat'],
  ['praline', 'chocolat'],
  ['bonbon', 'chocolat'],

  // ---------- Boissons ----------
  ['eau', 'eau'],
  ['jus', 'jus'],
  ['smoothie', 'jus'],
  ['soda', 'soda'],
  ['cola', 'soda'],
  ['limonade', 'soda'],
  ['tonic', 'soda'],
  ['cafe', 'cafe'],
  ['expresso', 'cafe'],
  ['the', 'the'],
  ['infusion', 'the'],
  ['tisane', 'the'],
  ['rooibos', 'the'],
  ['vin', 'vin'],
  ['biere', 'biere'],

  // ---------- Surgeles et plats ----------
  ['glace', 'glace'],
  ['creme glacee', 'glace'],
  ['sorbet', 'sorbet'],
  ['esquimau', 'esquimau'],
  ['pizza', 'pizza'],
  ['frite', 'frites'],
  ['soupe', 'soupe'],
  ['veloute', 'soupe'],
  ['potage', 'soupe'],
  ['gateau', 'gateau'],
  ['tarte', 'gateau'],
  ['biscuit', 'biscuit'],
  ['cookie', 'biscuit'],
  ['speculoos', 'biscuit'],
]

interface CompiledKeyword {
  readonly test: RegExp
  readonly icon: IconName
  readonly weight: number
}

/**
 * Les mots-cles ne contiennent que `[a-z0-9 ]` — la meme grammaire que la
 * sortie de `normalizeLabel`. Aucun echappement n'est donc necessaire, et un
 * caractere hors de cet alphabet serait un bug de saisie dans le tableau, pas
 * une entree a assainir.
 */
const COMPILED: readonly CompiledKeyword[] = KEYWORDS.map(([keyword, icon]) => ({
  test: new RegExp(`(?:^|\\s)${keyword.split(' ').map((word) => `${word}[sx]?`).join('\\s')}(?:\\s|$)`),
  icon,
  weight: keyword.length,
}))

const RAYON_RULES: ReadonlyArray<readonly [readonly string[], IconName]> = [
  [['surgel', 'congel'], 'rayon-surgeles'],
  [['boulanger', 'patisser', 'viennoiser'], 'rayon-boulangerie'],
  [['boucher', 'volaille', 'charcut', 'viande'], 'rayon-boucherie'],
  [['poissonner', 'maree', 'poisson', 'fruits de mer'], 'rayon-poissonnerie'],
  [['laitier', 'cremerie', 'fromage', 'oeuf'], 'rayon-produits-laitiers'],
  [['boisson', 'cave', 'liquide'], 'rayon-boissons'],
  [['snack', 'confiserie', 'sucrerie', 'apero', 'biscuit'], 'rayon-snacks-confiseries'],
  [['fruit', 'legume', 'primeur', 'marche'], 'rayon-fruits-legumes'],
  [['epicerie', 'conserve', 'condiment', 'assaisonn'], 'rayon-epicerie'],
]

/** Icone du rayon. Un libelle vide ou inconnu retombe sur la cagette. */
export function iconForRayon(label: string | null | undefined): IconName {
  if (label === null || label === undefined || label.trim() === '') return 'rayon-autre'
  const normalized = normalizeLabel(label)
  for (const [keys, icon] of RAYON_RULES) {
    if (keys.some((key) => normalized.includes(key))) return icon
  }
  return 'rayon-autre'
}

/**
 * Identifiant stable du rayon, pour teinter la section en CSS
 * (`[data-rayon='fruits-legumes']`). Derive de l'icone, donc deux libelles
 * synonymes (« Primeur », « Fruits et légumes ») partagent la meme teinte.
 */
export const rayonSlug = (label: string | null | undefined): string =>
  iconForRayon(label).replace('rayon-', '')

export interface IngredientLike {
  readonly name: string
  readonly categoryL1?: string | null
}

export function iconForIngredient(ingredient: IngredientLike): IconName {
  const haystack = normalizeLabel(ingredient.name)

  let best: { icon: IconName; weight: number; index: number } | null = null
  for (const entry of COMPILED) {
    const match = entry.test.exec(haystack)
    if (match === null) continue
    if (
      best === null ||
      entry.weight > best.weight ||
      (entry.weight === best.weight && match.index < best.index)
    ) {
      best = { icon: entry.icon, weight: entry.weight, index: match.index }
    }
  }

  if (best !== null) return best.icon
  return iconForRayon(ingredient.categoryL1)
}
