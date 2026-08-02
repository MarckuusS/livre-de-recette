/**
 * Modeles du domaine — la forme metier fait foi ici.
 *
 * Portage de app/domain/models.py (Pydantic v2) vers Zod. Les messages de
 * validation sont repris MOT POUR MOT : ils sont destines a l'utilisateur et
 * remontent tels quels dans l'interface.
 *
 * Deux conventions de serialisation, tenues sur toute la surface d'API :
 *   - les identifiants sont en camelCase (le SQL reste en snake_case) ;
 *   - les montants sont des CHAINES decimales ("12.0000"), jamais des nombres.
 *     Un float ne represente pas exactement 0,1 € et l'erreur s'accumule sur
 *     une liste de courses. Les calculs passent par decimal.js (voir pricing.ts).
 *
 * Absence = `null`, jamais `""` ni `undefined`. Le desktop melangeait les deux
 * selon le chemin de code (annexe #19 de la spec).
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Chaine decimale positive, ex. "3.9900". Le separateur est le POINT. */
const decimalString = z
  .string()
  .regex(/^\d+(\.\d+)?$/, 'Montant invalide : attendu une chaîne décimale comme "3.99".')

const positiveDecimalString = decimalString.refine(
  (v) => Number(v) > 0,
  'Le prix doit être strictement positif.',
)

/** Horodatage systeme, ISO-8601 UTC suffixe Z. */
const utcTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)

/** Date-jour sans heure, 'YYYY-MM-DD'. Utilisee pour les peremptions. */
const dayDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ.')

/** Macro pour 100 g : `null` signifie « inconnu », ce qui differe de 0. */
const macro = z
  .number()
  .min(0, 'Les macros par 100 g ne peuvent pas être négatives.')
  .nullable()
  .default(null)

const nonEmpty = (message: string) => z.string().trim().min(1, message)

// ---------------------------------------------------------------------------
// Enumerations — la valeur EST ce qui est stocke en base
// ---------------------------------------------------------------------------

export const SOURCES = ['ciqual', 'openfoodfacts', 'manual', 'lidl'] as const
export const sourceSchema = z.enum(SOURCES)
export type Source = z.infer<typeof sourceSchema>

/**
 * Creneaux d'une journee. L'ordre de ce tableau est l'ordre CHRONOLOGIQUE
 * d'affichage : un tri SQL les rendrait par ordre alphabetique, ce que le
 * desktop corrigeait cote client.
 */
export const MEAL_SLOTS = ['morning', 'snack_morning', 'noon', 'snack_afternoon', 'evening'] as const
export const mealSlotSchema = z.enum(MEAL_SLOTS)
export type MealSlot = z.infer<typeof mealSlotSchema>

export const MEAL_SLOT_LABELS: Record<MealSlot, string> = {
  morning: 'Matin',
  snack_morning: 'Collation 10h',
  noon: 'Midi',
  snack_afternoon: 'Goûter 16h',
  evening: 'Soir',
}

/** 0 = lundi, conformement a la convention ISO retenue pour le calendrier. */
export const DAY_LABELS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const

// ---------------------------------------------------------------------------
// Ingredient
// ---------------------------------------------------------------------------

export const ingredientSchema = z.object({
  id: z.number().int().positive().nullable().default(null),
  name: nonEmpty("Le nom de l'ingrédient ne peut pas être vide."),
  source: sourceSchema.default('manual'),
  /** Code CIQUAL, code-barres EAN, ou art_id Lidl selon la source. */
  sourceRef: z.string().nullable().default(null),
  brand: z.string().nullable().default(null),

  // Macros pour 100 g.
  kcal: macro,
  proteins: macro,
  carbs: macro,
  sugars: macro,
  fats: macro,
  saturatedFats: macro,
  fiber: macro,
  salt: macro,

  // Prix : cache denormalise de la derniere observation de l'historique.
  // L'utilisateur ne le saisit pas directement, il enregistre des observations.
  priceEur: positiveDecimalString.nullable().default(null),
  priceQuantityG: z.number().positive('Une quantité (g) doit être strictement positive.').nullable().default(null),

  /** Masse d'une « piece » : 1 oeuf ~60 g, 1 oignon ~150 g. `null` = pas de piece naturelle. */
  pieceWeightG: z.number().positive('Une quantité (g) doit être strictement positive.').nullable().default(null),
  /** Masse cuite pour 100 g cru (riz ~300). `null` = on assume 1:1. Les macros restent en cru. */
  cookedWeightPer100gRaw: z.number().positive('Une quantité (g) doit être strictement positive.').nullable().default(null),

  /** Distingue la bibliotheque de travail de l'utilisateur du catalogue CIQUAL/OFF. */
  inLibrary: z.boolean().default(false),

  categoryL1: z.string().nullable().default(null),
  categoryL2: z.string().nullable().default(null),

  /** CSV de mois 1..12 ("6,7,8,9" = juin a septembre). `null` = pas de donnee. */
  seasonMonths: z
    .string()
    .regex(/^(1[0-2]|[1-9])(,(1[0-2]|[1-9]))*$/, 'Mois de saison attendus sous forme "6,7,8,9".')
    .nullable()
    .default(null),

  createdAt: utcTimestamp.nullable().default(null),
  updatedAt: utcTimestamp.nullable().default(null),
})

export type Ingredient = z.infer<typeof ingredientSchema>

/** Charge utile de creation : pas d'id ni d'horodatages. */
export const ingredientCreateSchema = ingredientSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})

/**
 * Charge utile de mise a jour, semantique « cle presente ».
 *
 * Attention, comportement repris du desktop : un champ ABSENT preserve la
 * valeur existante, tandis qu'un champ present a `null` l'efface. C'est ce qui
 * permet au formulaire de n'envoyer que ce qui a change.
 */
export const ingredientPatchSchema = ingredientCreateSchema.partial()

// ---------------------------------------------------------------------------
// Recette
// ---------------------------------------------------------------------------

export const tagSchema = z.object({
  id: z.number().int().positive().nullable().default(null),
  name: nonEmpty('Le nom du tag ne peut pas être vide.'),
  colorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Couleur attendue au format #RRGGBB.')
    .default('#9ca3af'),
  createdAt: utcTimestamp.nullable().default(null),
})
export type Tag = z.infer<typeof tagSchema>

export const recipeLineSchema = z.object({
  ingredient: ingredientSchema,
  quantityG: z.number().positive('La quantité doit être strictement positive.'),
  /** Unite d'affichage choisie par l'utilisateur. Cosmetique : la quantite est en grammes. */
  unit: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  ordinal: z.number().int().min(0).default(0),
})
export type RecipeLine = z.infer<typeof recipeLineSchema>

export const recipeSchema = z.object({
  id: z.number().int().positive().nullable().default(null),
  name: nonEmpty('Le nom de la recette ne peut pas être vide.'),
  instructions: z.string().default(''),
  defaultPortions: z.number().int().min(1, 'Une recette fait au moins une portion.').default(1),
  /** Cle d'objet R2, ex. 'recipes/12.jpg'. */
  imageKey: z.string().nullable().default(null),
  /** Conserves depuis l'import par URL — le desktop les extrayait puis les perdait. */
  sourceUrl: z.string().url().nullable().default(null),
  prepTimeMin: z.number().int().positive().nullable().default(null),
  lines: z.array(recipeLineSchema).default([]),
  tags: z.array(tagSchema).default([]),
  createdAt: utcTimestamp.nullable().default(null),
  updatedAt: utcTimestamp.nullable().default(null),
})
export type Recipe = z.infer<typeof recipeSchema>

/**
 * Charge utile d'enregistrement d'une recette.
 *
 * Distincte de `recipeSchema` : le formulaire envoie des IDENTIFIANTS
 * d'ingredients et de tags, pas les objets complets. Renvoyer l'ingredient
 * entier ferait transiter 4 000 caracteres de macros a chaque sauvegarde, et
 * surtout laisserait croire qu'on peut modifier un ingredient en modifiant une
 * recette.
 */
export const recipeLineWriteSchema = z.object({
  ingredientId: z.number().int().positive(),
  quantityG: z.number().positive('La quantité doit être strictement positive.'),
  unit: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
})
export type RecipeLineWrite = z.infer<typeof recipeLineWriteSchema>

export const recipeWriteSchema = z.object({
  name: nonEmpty('Le nom de la recette ne peut pas être vide.'),
  instructions: z.string().default(''),
  defaultPortions: z.number().int().min(1, 'Une recette fait au moins une portion.').default(1),
  imageKey: z.string().nullable().default(null),
  sourceUrl: z.string().url('Adresse web invalide.').nullable().default(null),
  prepTimeMin: z.number().int().positive('Le temps de préparation doit être positif.').nullable().default(null),
  lines: z.array(recipeLineWriteSchema).default([]),
  tagIds: z.array(z.number().int().positive()).default([]),
})
export type RecipeWrite = z.infer<typeof recipeWriteSchema>

export const tagWriteSchema = tagSchema.omit({ id: true, createdAt: true })

// ---------------------------------------------------------------------------
// Nutrition
// ---------------------------------------------------------------------------

export const nutritionTotalSchema = z.object({
  kcal: z.number().default(0),
  proteins: z.number().default(0),
  carbs: z.number().default(0),
  sugars: z.number().default(0),
  fats: z.number().default(0),
  saturatedFats: z.number().default(0),
  fiber: z.number().default(0),
  salt: z.number().default(0),
})
export type NutritionTotal = z.infer<typeof nutritionTotalSchema>

// ---------------------------------------------------------------------------
// Calendrier
// ---------------------------------------------------------------------------

const isoWeekString = z
  .string()
  .regex(/^\d{4}-W\d{2}$/, "Semaine ISO attendue sous la forme '2026-W18'.")

/**
 * Une entree du calendrier. Regle XOR : exactement une recette OU un
 * ingredient, avec le champ de quantite correspondant.
 *
 * Le desktop n'interdisait pas `quantityG` sur une entree recette ni
 * `portions` sur une entree ingredient (annexe #22) : c'est resserre ici et
 * dans le CHECK SQL.
 */
const mealPlanEntryFields = {
  id: z.number().int().positive().nullable().default(null),
  isoWeek: isoWeekString,
  dayOfWeek: z.number().int().min(0).max(6),
  slot: mealSlotSchema,
  recipeId: z.number().int().positive().nullable().default(null),
  ingredientId: z.number().int().positive().nullable().default(null),
  quantityG: z.number().positive('quantity_g et portions doivent être strictement positifs.').nullable().default(null),
  portions: z.number().positive('quantity_g et portions doivent être strictement positifs.').nullable().default(null),
  ordinal: z.number().int().min(0).default(0),
}

/**
 * La regle XOR, extraite pour etre appliquee a PLUSIEURS schemas.
 *
 * Ne surtout pas la reintroduire via `mealPlanEntrySchema.innerType()` : cette
 * methode rend l'objet SANS son raffinement, et la regle disparait
 * silencieusement — l'erreur ressort alors du CHECK SQLite, en 500 opaque.
 */
function checkMealPlanXor(
  entry: { recipeId: number | null; ingredientId: number | null; quantityG: number | null; portions: number | null },
  ctx: z.RefinementCtx,
): void {
  const hasRecipe = entry.recipeId !== null
  const hasIngredient = entry.ingredientId !== null
  if (hasRecipe === hasIngredient) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Une entrée du calendrier référence soit une recette, soit un ingrédient — pas les deux, pas aucun.',
    })
    return
  }
  if (hasRecipe && entry.portions === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['portions'], message: 'Le nombre de portions est requis pour une recette.' })
  }
  if (hasRecipe && entry.quantityG !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantityG'], message: 'Une entrée recette ne porte pas de quantité en grammes.' })
  }
  if (hasIngredient && entry.quantityG === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quantityG'], message: 'La quantité est requise pour un ingrédient.' })
  }
  if (hasIngredient && entry.portions !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['portions'], message: 'Une entrée ingrédient ne porte pas de portions.' })
  }
}

export const mealPlanEntrySchema = z.object(mealPlanEntryFields).superRefine(checkMealPlanXor)
export type MealPlanEntry = z.infer<typeof mealPlanEntrySchema>

/**
 * Creation d'une entree : meme regle XOR, sans les champs que le serveur
 * attribue lui-meme (identifiant et rang dans le creneau).
 */
export const mealPlanEntryWriteSchema = z
  .object(mealPlanEntryFields)
  .omit({ id: true, ordinal: true })
  .superRefine(checkMealPlanXor)

export const weeklyCostSnapshotSchema = z.object({
  isoWeek: isoWeekString,
  totalEur: decimalString,
  missingCount: z.number().int().min(0).default(0),
  capturedAt: utcTimestamp.nullable().default(null),
})
export type WeeklyCostSnapshot = z.infer<typeof weeklyCostSnapshotSchema>

// ---------------------------------------------------------------------------
// Prix, cuisson, frigo
// ---------------------------------------------------------------------------

export const priceHistoryEntrySchema = z.object({
  id: z.number().int().positive().nullable().default(null),
  ingredientId: z.number().int().positive(),
  priceEur: positiveDecimalString,
  quantityG: z.number().positive('Une quantité (g) doit être strictement positive.'),
  store: z.string().nullable().default(null),
  /** Date d'observation, saisie par l'utilisateur. */
  recordedAt: dayDate,
  notes: z.string().nullable().default(null),
  createdAt: utcTimestamp.nullable().default(null),
})
export type PriceHistoryEntry = z.infer<typeof priceHistoryEntrySchema>

export const cookingLogEntrySchema = z.object({
  id: z.number().int().positive().nullable().default(null),
  recipeId: z.number().int().positive(),
  cookedAt: dayDate,
  rating: z.number().int().min(1, 'La note doit être comprise entre 1 et 5.').max(5, 'La note doit être comprise entre 1 et 5.').nullable().default(null),
  notes: z.string().nullable().default(null),
  createdAt: utcTimestamp.nullable().default(null),
})
export type CookingLogEntry = z.infer<typeof cookingLogEntrySchema>

export const pantryStockSchema = z.object({
  id: z.number().int().positive().nullable().default(null),
  ingredientId: z.number().int().positive(),
  quantityG: z.number().positive('Une quantité (g) doit être strictement positive.'),
  /** `null` = peremption non suivie (sel, epices). */
  expiryDate: dayDate.nullable().default(null),
  notes: z.string().nullable().default(null),
  addedAt: utcTimestamp.nullable().default(null),
  updatedAt: utcTimestamp.nullable().default(null),
})
export type PantryStock = z.infer<typeof pantryStockSchema>

// ---------------------------------------------------------------------------
// Charges utiles d'ecriture
// ---------------------------------------------------------------------------
//
// Declarees ici, apres les schemas dont elles derivent : `omit()` s'evalue au
// chargement du module, donc une reference plus haut dans le fichier leverait
// avant meme le premier appel.

/** Deplacement d'une entree vers un autre jour ou creneau. */
export const mealPlanMoveSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  slot: mealSlotSchema,
})

/** Changement de quantite ou de portions, sans toucher au reste. */
export const mealPlanAmountSchema = z.object({
  quantityG: z.number().positive('La quantité doit être strictement positive.').nullable().default(null),
  portions: z.number().positive('Le nombre de portions doit être strictement positif.').nullable().default(null),
})

/** Ajout ou modification d'un lot au frigo. */
export const pantryStockWriteSchema = pantryStockSchema.omit({ id: true, addedAt: true, updatedAt: true })
export type PantryStockWrite = z.infer<typeof pantryStockWriteSchema>

/** Journal de cuisson — `recipeId` vient du chemin, pas du corps. */
export const cookingLogWriteSchema = cookingLogEntrySchema.omit({ id: true, recipeId: true, createdAt: true })

// ---------------------------------------------------------------------------
// Derives calcules cote client
// ---------------------------------------------------------------------------

export const SOURCE_LABELS: Record<Source, string> = {
  ciqual: 'CIQUAL',
  openfoodfacts: 'OpenFoodFacts',
  manual: 'manuel',
  lidl: 'Lidl',
}

/** Couleurs de badge, identiques en clair et en sombre (jetons hors theme). */
export const SOURCE_COLORS: Record<Source, string> = {
  ciqual: '#15803d',
  openfoodfacts: '#1d4ed8',
  manual: '#c2410c',
  lidl: '#c2410c',
}

/** Mois de saison parses depuis le CSV. Tableau vide si non renseigne. */
export function seasonMonths(ingredient: Pick<Ingredient, 'seasonMonths'>): number[] {
  if (!ingredient.seasonMonths) return []
  return ingredient.seasonMonths.split(',').map(Number).filter((m) => m >= 1 && m <= 12)
}

/**
 * Vrai si l'ingredient est de saison au mois courant.
 * Depend du mois LOCAL de l'utilisateur : ce derive ne peut pas etre calcule
 * cote serveur, dont le fuseau est UTC.
 */
export function isInSeasonNow(ingredient: Pick<Ingredient, 'seasonMonths'>, now: Date = new Date()): boolean {
  const months = seasonMonths(ingredient)
  return months.length > 0 && months.includes(now.getMonth() + 1)
}

/** Seaux d'urgence du frigo, identiques au desktop : 5 jours puis 14 jours. */
export type UrgencyBucket = 'soon' | 'watch' | 'stock'

export function urgencyBucket(daysLeft: number | null): UrgencyBucket {
  if (daysLeft === null) return 'stock'
  if (daysLeft <= 5) return 'soon'
  if (daysLeft <= 14) return 'watch'
  return 'stock'
}
