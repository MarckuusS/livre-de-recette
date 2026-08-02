/**
 * Table de conversion des unites saisies dans l'interface.
 *
 * Portage fidele de app/domain/units.py. Le stockage reste TOUJOURS en grammes
 * (convention CIQUAL) ; l'unite choisie par l'utilisateur n'est que de
 * l'affichage, restituee au rechargement via `recipe_ingredient.unit`.
 *
 * Les conversions volume -> masse supposent une densite de 1 g/ml (celle de
 * l'eau). Pour les liquides a densite connue il faudrait un champ sur
 * `Ingredient` ; ce defaut est celui de la plupart des applications de cuisine.
 */

export interface Unit {
  /** Identifiant machine stable, persiste en base. */
  readonly code: string
  /** Libelle affiche, en francais. */
  readonly label: string
  /** Masse en grammes d'une unite. */
  readonly gramsPerUnit: number
}

/**
 * L'ordre est celui des listes deroulantes. `g` en tete : c'est le defaut et
 * le cas le plus frequent.
 */
export const UNITS: readonly Unit[] = [
  { code: 'g', label: 'g', gramsPerUnit: 1.0 },
  { code: 'kg', label: 'kg', gramsPerUnit: 1000.0 },
  { code: 'mg', label: 'mg', gramsPerUnit: 0.001 },
  { code: 'ml', label: 'ml', gramsPerUnit: 1.0 },
  { code: 'cl', label: 'cl', gramsPerUnit: 10.0 },
  { code: 'dl', label: 'dl', gramsPerUnit: 100.0 },
  { code: 'L', label: 'L', gramsPerUnit: 1000.0 },
  { code: 'c_cafe', label: 'c. à café', gramsPerUnit: 5.0 },
  { code: 'c_soupe', label: 'c. à soupe', gramsPerUnit: 15.0 },
  { code: 'tasse', label: 'tasse', gramsPerUnit: 250.0 },
  { code: 'pincee', label: 'pincée', gramsPerUnit: 1.0 },
] as const

export const UNIT_BY_CODE: ReadonlyMap<string, Unit> = new Map(UNITS.map((u) => [u.code, u]))

export const DEFAULT_UNIT_CODE = 'g'

/**
 * Code de l'unite « piece », qui n'est pas dans UNITS : son facteur depend de
 * l'ingredient (`piece_weight_g`) et ne peut donc pas etre tabule.
 */
export const PIECE_UNIT_CODE = '_piece'

export class UnknownUnitError extends Error {
  constructor(code: string) {
    super(`Unite inconnue : '${code}'`)
    this.name = 'UnknownUnitError'
  }
}

/**
 * Convertit une valeur saisie dans `unitCode` en grammes.
 *
 * `pieceWeightG` n'est requis que pour l'unite « piece ». Le desktop laissait
 * cette conversion a un composant QML ; la centraliser ici evite la
 * divergence constatee dans l'import de recette par URL, qui traitait une
 * piece comme un gramme (annexe #6 de la spec).
 */
export function toGrams(value: number, unitCode: string, pieceWeightG?: number | null): number {
  if (unitCode === PIECE_UNIT_CODE) {
    if (!pieceWeightG || pieceWeightG <= 0) {
      throw new UnknownUnitError(`${PIECE_UNIT_CODE} (poids unitaire inconnu)`)
    }
    return value * pieceWeightG
  }
  const unit = UNIT_BY_CODE.get(unitCode)
  if (!unit) throw new UnknownUnitError(unitCode)
  return value * unit.gramsPerUnit
}

/** Reconvertit une masse stockee en grammes vers `unitCode`, pour l'affichage. */
export function fromGrams(grams: number, unitCode: string, pieceWeightG?: number | null): number {
  if (unitCode === PIECE_UNIT_CODE) {
    if (!pieceWeightG || pieceWeightG <= 0) {
      throw new UnknownUnitError(`${PIECE_UNIT_CODE} (poids unitaire inconnu)`)
    }
    return grams / pieceWeightG
  }
  const unit = UNIT_BY_CODE.get(unitCode)
  if (!unit) throw new UnknownUnitError(unitCode)
  return grams / unit.gramsPerUnit
}

export function labelFor(unitCode: string, pieceWeightG?: number | null): string {
  if (unitCode === PIECE_UNIT_CODE) {
    return pieceWeightG ? `pièce (${formatGrams(pieceWeightG)})` : 'pièce'
  }
  const unit = UNIT_BY_CODE.get(unitCode)
  if (!unit) throw new UnknownUnitError(unitCode)
  return unit.label
}

export function isKnownUnit(unitCode: string): boolean {
  return unitCode === PIECE_UNIT_CODE || UNIT_BY_CODE.has(unitCode)
}

/** Formate une masse pour l'affichage : `1,5 kg`, `250 g`, `12,5 g`. */
export function formatGrams(grams: number): string {
  const [value, suffix] = grams >= 1000 ? [grams / 1000, 'kg'] : [grams, 'g']
  const decimals = Number.isInteger(value) ? 0 : value >= 100 ? 0 : 1
  // Espace insecable ici aussi : « 250 g » ne doit pas se couper.
  return `${value.toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${suffix}`
}

/**
 * Contenance nette d'un produit emballe, ramenee en grammes.
 *
 * Vit ici, teste, parce qu'elle interprete des donnees EXTERIEURES et
 * incoherentes. OpenFoodFacts rend les deux formes selon le point d'acces :
 * `product_quantity: 400` accompagne de `product_quantity_unit: 'g'`, ou
 * `product_quantity: "360 g"` unite comprise dans la chaine. Le repli sur le
 * libelle humain (`quantity: "360 g"`) rattrape les fiches ou seul lui est
 * renseigne.
 *
 * Les millilitres comptent 1 g pour 1 ml. C'est faux pour l'huile (0,92) et le
 * miel (1,4), mais cette valeur ne sert qu'a proposer « 1 pièce = X g » : une
 * approximation utile vaut mieux qu'un champ vide, et l'utilisateur la voit
 * avant de l'accepter.
 *
 * Rend `null` plutot qu'une valeur douteuse — au-dela de 20 kg on tient une
 * erreur de saisie, pas un produit de course.
 */
export function parseQuantityToGrams(
  value: unknown,
  unit?: unknown,
  fallbackText?: unknown,
): number | null {
  const factors: Record<string, number> = {
    mg: 0.001,
    g: 1,
    kg: 1000,
    ml: 1,
    cl: 10,
    dl: 100,
    l: 1000,
  }

  const fromParts = (amount: unknown, rawUnit: unknown): number | null => {
    const n = typeof amount === 'number' ? amount : Number.parseFloat(String(amount ?? '').replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return null
    const factor = factors[String(rawUnit ?? 'g').trim().toLowerCase()]
    return factor === undefined ? null : n * factor
  }

  const fromText = (text: unknown): number | null => {
    const match = /(\d+(?:[.,]\d+)?)\s*(mg|kg|g|ml|cl|dl|l)\b/i.exec(String(text ?? ''))
    return match ? fromParts(match[1], match[2]) : null
  }

  const grams =
    (typeof value === 'number' ? fromParts(value, unit) : fromText(value)) ?? fromText(fallbackText)

  if (grams === null || grams <= 0 || grams > 20_000) return null
  return Math.round(grams * 100) / 100
}
