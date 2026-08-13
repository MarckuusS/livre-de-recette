/**
 * Les reperes journaliers : sel, sucres, acides gras satures, fibres.
 *
 * Module PUR, et surtout module SOURCE. Chaque nombre porte ici l'agence qui
 * l'a publie et l'annee. C'est la seule facon de tenir la regle du projet :
 * ne jamais afficher un chiffre de sante que ses sources ne soutiennent pas.
 * Un seuil invente serait cru, et c'est ce qui le rend pire que pas de seuil.
 *
 * ---------------------------------------------------------------------------
 * LE PIEGE DU PERIMETRE, ET IL EST CENTRAL
 * ---------------------------------------------------------------------------
 * L'OMS recommande de rester sous 10 % de l'energie en SUCRES LIBRES : ceux
 * qu'on ajoute, plus ceux du miel, des sirops et des JUS. Elle exclut
 * explicitement les sucres des fruits et legumes entiers et le lactose du
 * lait, faute d'effet indesirable rapporte.
 *
 * Or CIQUAL et OpenFoodFacts ne donnent que les SUCRES TOTAUX. Comparer notre
 * total a la cible de l'OMS surestimerait donc le depassement d'une quantite
 * inconnue. Le repere retenu est celui de l'ANSES, le seul dont le perimetre
 * corresponde a peu pres a la donnee dont on dispose, et l'ecran doit dire ce
 * qui l'en separe encore.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI IL N'Y A PAS DE FORMULE SUCRES-FIBRES
 * ---------------------------------------------------------------------------
 * L'idee est juste dans son mecanisme : une fibre visqueuse ralentit
 * l'absorption du sucre avale AVEC ELLE, dans le meme bol alimentaire. C'est
 * ce qui separe une pomme d'un verre de jus.
 *
 * Mais elle ne se transpose pas a un total de journee, pour trois raisons :
 *
 *   1. la simultaneite est constitutive du mecanisme. Une fibre avalee trois
 *      heures apres un sucre ne ralentit plus rien : le sucre est absorbe ;
 *   2. les metriques qui existent (le rapport glucides/fibres de 10 pour 1 de
 *      l'AHA, le Nutri-Score) jugent un PRODUIT en rayon, ou les fibres sont
 *      physiquement melees aux glucides. Sommer sur 24 heures detruit
 *      exactement l'information qui les rendait pertinentes ;
 *   3. l'OMS, l'EFSA, l'ANSES et l'AHA ont toutes examine le dossier des
 *      sucres et celui des fibres. Aucune ne conditionne l'un a l'autre :
 *      toutes posent un plafond de sucres ET un plancher de fibres,
 *      separement. Quatre agences qui ne produisent pas ce chiffre apres
 *      examen, ce n'est pas un oubli.
 *
 * Et l'intuition, en fait, est RETOURNEE par l'OMS : ce n'est pas que les
 * fibres rachetent le sucre, c'est que le sucre enferme dans une matrice
 * fibreuse n'est pas le meme sucre. D'ou son exclusion du compte, plutot
 * qu'une tolerance accrue.
 *
 * Ce module expose donc quatre reperes independants. Aucune fonction ici ne
 * fait varier l'un en fonction de l'autre, et c'est deliberé.
 */

/** Energie d'un gramme de lipide, en kcal. Sert a convertir un pourcentage. */
const KCAL_PAR_G_LIPIDE = 9

/**
 * Sel : moins de 5 g par jour chez l'adulte.
 *
 * OMS 2012 (recommandation forte, moins de 2 g de sodium) et reperes du PNNS
 * 2019, portes par Sante publique France. L'EFSA 2019 pose la meme valeur
 * mais la qualifie autrement : « apport sur et adequat », faute d'avoir pu
 * fixer une limite superieure toleree. Ce n'est pas la meme chose qu'un
 * plafond, et c'est pourquoi elle n'est pas citee comme telle.
 *
 * L'ANSES N'EST PAS CITEE ICI, et c'est deliberé : sa page sur le sel affiche
 * encore les objectifs du PNNS 3, differencies par sexe (8 g chez l'homme,
 * 6,5 g chez la femme). Le repere unique de 5 g pour tous les adultes ne vient
 * pas d'elle. Lui attribuer un chiffre qu'elle ne publie pas serait le genre
 * d'imprecision que ce module existe pour eviter.
 *
 * L'application stocke des grammes de SEL et non de sodium : la comparaison
 * est directe, sans le facteur 2,5 qui separe les deux.
 */
export const SALT_MAX_G = 5

/**
 * Sucres : au plus 100 g par jour.
 *
 * ANSES 2016, sucres TOTAUX hors lactose et galactose. C'est le seul repere
 * dont le perimetre s'approche de la donnee disponible. Il reste plus large
 * qu'elle : nous ne savons pas retrancher le lactose ligne a ligne, donc le
 * total compare est un peu plus haut que celui que l'ANSES visait.
 */
export const SUGARS_MAX_G = 100

/** Part de l'energie en sucres LIBRES visee par l'OMS 2015. Non calculable ici. */
export const SUGARS_WHO_FREE_PERCENT = 10

/** Acides gras satures : au plus 10 % de l'energie du jour. OMS 2023. */
export const SATURATED_MAX_PERCENT = 10

/**
 * Le meme plafond selon l'Afssa, devenue l'ANSES, qui retient 12 %.
 *
 * Avis du 1er mars 2010 sur l'actualisation des apports nutritionnels
 * conseilles en acides gras. Deux precisions qui comptent :
 *
 *   - la valeur porte sur l'apport energetique SANS ALCOOL. L'application ne
 *     suit pas l'alcool, donc les deux denominateurs coincident ici ; le jour
 *     ou elle le suivrait, ce repere devrait le retrancher alors que celui de
 *     l'OMS le garde ;
 *   - le meme avis pose une seconde borne, 8 % pour la somme des acides
 *     laurique, myristique et palmitique. Elle n'est pas calculable : ni
 *     CIQUAL ni OpenFoodFacts ne detaillent les satures ligne a ligne.
 */
export const SATURATED_ANSES_PERCENT = 12

/** Fibres : apport satisfaisant de l'ANSES 2016. Un PLANCHER, pas un plafond. */
export const FIBER_TARGET_G = 30

/** Le plancher bas : EFSA 2010 et OMS 2023 s'accordent sur 25 g. */
export const FIBER_MIN_G = 25

export interface DailyLimit {
  /** Le repere du jour, en grammes. */
  readonly grams: number
  /** L'agence et l'annee, tels qu'ils doivent s'afficher. */
  readonly source: string
  /**
   * `plafond` : rester en dessous. `plancher` : atteindre au moins.
   * Les confondre inverserait le sens de la barre.
   */
  readonly sens: 'plafond' | 'plancher'
}

export interface DailyLimits {
  readonly salt: DailyLimit
  readonly sugars: DailyLimit
  readonly saturatedFats: DailyLimit
  readonly fiber: DailyLimit
}

/**
 * Les quatre reperes du jour.
 *
 * Seuls les acides gras satures dependent de la cible energetique : c'est un
 * pourcentage de l'apport, donc quelqu'un qui mange 1 800 kcal a bien un
 * plafond plus bas que quelqu'un qui en mange 3 000. Les trois autres sont
 * des nombres absolus, identiques pour tous les adultes.
 *
 * `kcalTarget` a `null` : le plafond des satures retombe sur 2 000 kcal, la
 * valeur de reference qu'emploient les agences elles-memes pour illustrer
 * leurs pourcentages. L'ecran doit alors dire que c'est un exemple.
 */
export function dailyLimits(kcalTarget: number | null): DailyLimits {
  const kcal = kcalTarget ?? 2000
  return {
    salt: { grams: SALT_MAX_G, source: 'OMS 2012, PNNS 2019', sens: 'plafond' },
    sugars: { grams: SUGARS_MAX_G, source: 'ANSES 2016', sens: 'plafond' },
    saturatedFats: {
      grams: Math.round((kcal * (SATURATED_MAX_PERCENT / 100)) / KCAL_PAR_G_LIPIDE),
      source: 'OMS 2023',
      sens: 'plafond',
    },
    fiber: { grams: FIBER_TARGET_G, source: 'ANSES 2016', sens: 'plancher' },
  }
}

/**
 * Le plafond de satures selon l'Afssa, pour dire la divergence.
 *
 * 10 % contre 12 % de l'energie, soit 22 g contre 27 g pour 2 000 kcal. Deux
 * agences serieuses ne s'accordent pas ; afficher un seul chiffre en silence
 * ferait passer un choix pour un fait.
 */
export function saturatedAnsesG(kcalTarget: number | null): number {
  return Math.round(
    ((kcalTarget ?? 2000) * (SATURATED_ANSES_PERCENT / 100)) / KCAL_PAR_G_LIPIDE,
  )
}

/** Ou en est-on d'un repere. `part` peut depasser 1 : on peut depasser. */
export interface LimitReading {
  readonly grams: number
  readonly limit: DailyLimit
  readonly part: number
  /**
   * `tenu` : sous le plafond, ou au-dessus du plancher.
   * `limite` : dans les 10 % qui precedent le franchissement.
   * `depasse` : franchi.
   */
  readonly etat: 'tenu' | 'limite' | 'depasse'
}

/**
 * Lit une valeur du jour contre son repere.
 *
 * `limite` couvre les dix derniers pour cent AVANT le franchissement, dans le
 * sens du repere. Sans cette zone, un plafond passe de vert a rouge d'un
 * gramme a l'autre, ce qui se lit comme un verdict alors que ces nombres sont
 * des moyennes de long terme.
 */
export function readLimit(grams: number, limit: DailyLimit): LimitReading {
  const part = limit.grams === 0 ? 0 : grams / limit.grams
  const etat: LimitReading['etat'] =
    limit.sens === 'plafond'
      ? part > 1
        ? 'depasse'
        : part >= 0.9
          ? 'limite'
          : 'tenu'
      : part >= 1
        ? 'tenu'
        : part >= 0.9
          ? 'limite'
          : 'depasse'
  return { grams, limit, part, etat }
}
