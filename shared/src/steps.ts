/**
 * Decouper des instructions en etapes numerotees.
 *
 * Module PUR, et surtout DERIVATION REVERSIBLE : `recipe.instructions` reste
 * une chaine libre, jamais reecrite. C'est la lecon de l'unite de saisie, qui
 * a coute une migration : ce qui est stocke doit rester ce que la personne a
 * tape, et l'affichage se recalcule. Une renumerotation ecrite en base
 * abimerait un texte que quelqu'un a compose.
 *
 * CE MODULE NE DEVINE AUCUNE DUREE, et c'est deliberé. Le mockup dont vient
 * cet ecran affiche « 5 min », « 3 min », « 15 min » a cote de chaque etape.
 * Le nombre, on saurait souvent l'extraire ; c'est sa NATURE qu'on inventerait.
 * « Fais revenir 3 min puis laisse reposer 30 min » en contient deux,
 * « prechauffe a 180 °C » n'en contient aucune mais porte un nombre, et
 * « 10 cl de creme » non plus. Affichee au meme niveau que le texte, une
 * deduction devient une propriete, et en cuisine un compte a rebours pose sur
 * le mauvais nombre brule un plat.
 */

/** Une etape, telle qu'elle s'affiche. */
export interface Step {
  /** Rang affiche, a partir de 1. Les intertitres n'en ont pas. */
  readonly index: number | null
  readonly text: string
  /**
   * Vrai pour une ligne qui annonce une section (« Pour la sauce : »).
   * Elle se lit comme un titre, pas comme un geste, donc elle ne prend pas
   * de numero et ne decale pas les suivants.
   */
  readonly heading: boolean
}

/**
 * Une ligne qui se termine par deux-points et ne contient pas de verbe
 * d'action est un intertitre. On se contente du deux-points final, seul
 * indice fiable sans analyse de la langue, et on borne la longueur : une
 * phrase de trois lignes finissant par « : » reste une instruction.
 */
const INTERTITRE = /:\s*$/

/** Numerotation deja tapee a la main : « 1. », « 2) », « 3 - », « Etape 4 : ». */
const NUMERO_EN_TETE = /^\s*(?:[ée]tape\s*)?\d{1,2}\s*[.)\]:-]\s+/i

export function parseSteps(instructions: string): Step[] {
  const lignes = instructions
    // `\r\n` : un texte colle depuis un site ou saisi sous Windows en porte,
    // et une ligne qui finirait par `\r` se verrait a l'ecran.
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')

  const etapes: Step[] = []
  let rang = 0

  for (const brute of lignes) {
    const heading = INTERTITRE.test(brute) && brute.length <= 60
    // Le numero deja tape est RETIRE, sinon l'ecran afficherait « 2. 2) Ajoute
    // les lentilles ». Le rang affiche est celui du decoupage, qui reste juste
    // meme quand la numerotation manuelle saute un chiffre.
    const text = heading ? brute : brute.replace(NUMERO_EN_TETE, '')
    if (text === '') continue
    etapes.push({ index: heading ? null : ++rang, text, heading })
  }

  return etapes
}

/**
 * Les durees d'une etape, PROPOSEES et jamais affirmees.
 *
 * L'unite doit etre ECRITE : un nombre nu n'est jamais retenu, ce qui ecarte
 * « 180 °C », « 10 cl » et « 4 oeufs ». L'ecran s'en sert pour offrir un
 * minuteur sous la phrase d'ou il vient, jamais pour poser une propriete a
 * cote du texte.
 *
 * Quand une etape en contient plusieurs, on les rend TOUTES : en retenir une
 * seule reviendrait a choisir a la place du lecteur, et « fais revenir 3 min
 * puis laisse reposer 30 min » n'a pas de duree principale.
 */
export function extractDurations(text: string): number[] {
  const trouvees: number[] = []
  const motif = /(\d{1,3})\s*(?:h(?:eures?)?|min(?:utes?)?|mn)\b/gi
  for (const m of text.matchAll(motif)) {
    const valeur = Number(m[1])
    if (!Number.isFinite(valeur) || valeur <= 0) continue
    const heures = /h/i.test(m[0]) && !/min|mn/i.test(m[0])
    trouvees.push(heures ? valeur * 60 : valeur)
  }
  return trouvees
}
