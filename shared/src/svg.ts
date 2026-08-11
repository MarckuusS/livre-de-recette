/**
 * Assainissement d'un SVG colle par l'utilisateur.
 *
 * POURQUOI CE FICHIER EXISTE. Le jeu d'icones s'affiche via
 * `dangerouslySetInnerHTML` : c'est acceptable tant que le contenu vient d'une
 * constante du depot, ca ne l'est plus des qu'un utilisateur peut coller le
 * sien. Un SVG est un document XML complet, pas une image inerte — il accepte
 * `<script>`, des attributs `onload`, du HTML dans `<foreignObject>`, des
 * `href="javascript:"`, des `<image>` et des `<use>` qui appellent un serveur
 * distant. Colle en base et servi a l'autre cuisinier, n'importe lequel de ces
 * vecteurs devient une execution de code stockee.
 *
 * LA REGLE : liste blanche, jamais liste noire. On n'essaie pas d'enumerer ce
 * qui est dangereux — cette liste est toujours incomplete et le restera. On
 * enumere le tres petit ensemble de ce dont un dessin a besoin, et TOUT le
 * reste disparait. Un attribut inconnu n'est pas suspect, il est simplement
 * absent de la liste, donc supprime.
 *
 * PAS DE DOMParser. Ce module tourne dans le Worker, ou il n'y a pas de DOM, et
 * c'est le Worker qui fait foi : le navigateur peut assainir pour l'apercu, sa
 * sortie n'est jamais ce qu'on enregistre. L'analyse est donc faite a la main,
 * sur la chaine.
 *
 * CE QUE CE MODULE NE FAIT PAS. Il ne valide pas que le resultat dessine
 * quelque chose de joli, ni qu'il tient dans la grille. Il garantit une seule
 * chose : ce qui sort ne peut ni executer de code, ni joindre le reseau.
 */

/** Balises conservees. Tout le reste est supprime, contenu compris. */
const ALLOWED_TAGS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
])

/**
 * Attributs conserves.
 *
 * `style` en est volontairement absent : il accepte `url(...)`, donc une
 * requete sortante, et son analyse serait un second assainisseur a ecrire.
 * `href`, `xlink:href` et `class` aussi : le premier navigue, le dernier
 * accrocherait la feuille de style de l'application.
 */
const ALLOWED_ATTRS = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'points',
  'transform',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-opacity',
  'fill-opacity',
  'fill-rule',
  'clip-rule',
  'opacity',
])

/** Attributs acceptes sur la racine `<svg>` seulement. */
const ROOT_ONLY_ATTRS = new Set(['viewbox'])

/**
 * Valeur d'attribut manifestement hostile.
 *
 * Le filtre par nom d'attribut suffit deja a bloquer ces cas — aucun attribut
 * de la liste blanche n'est navigable. Ce controle est une SECONDE barriere,
 * pour qu'un elargissement futur de la liste blanche ne rouvre pas la porte en
 * silence.
 */
const HOSTILE_VALUE = /javascript:|data:|url\s*\(|expression\s*\(|<|&#/i

const TAG = /<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g
const ATTR = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g
const VIEWBOX = /^\s*-?[\d.]+\s+-?[\d.]+\s+[\d.]+\s+[\d.]+\s*$/

export interface SanitizedSvg {
  /** Contenu du `<svg>`, sans la balise racine. Vide si rien n'a survecu. */
  readonly markup: string
  /** `viewBox` d'origine, ou la grille maison a defaut. */
  readonly viewBox: string
  /** Ce qui a ete retire, pour le dire a l'utilisateur plutot que de le taire. */
  readonly removed: readonly string[]
}

/**
 * Coupe une chaine en jetons de balise, en sautant le contenu des balises
 * interdites.
 *
 * Le saut de contenu est ce qui distingue cet assainisseur d'un simple filtre :
 * supprimer `<script>` sans supprimer ce qu'il contient laisserait le code en
 * texte libre, que le navigateur pourrait ensuite reinterpreter selon le
 * contexte d'insertion.
 */
export function sanitizeSvg(input: string): SanitizedSvg {
  const removed = new Set<string>()
  const out: string[] = []
  let viewBox = '0 0 24 24'
  let sawRoot = false

  // Commentaires et instructions XML : sans interet pour le dessin, et
  // `<!--` mal ferme sert classiquement a masquer la suite d'une charge utile.
  const source = input.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '')

  /** Profondeur d'imbrication dans une balise rejetee dont on jette le contenu. */
  let skipDepth = 0
  let skipTag = ''

  TAG.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TAG.exec(source)) !== null) {
    const closing = match[1] === '/'
    const tag = (match[2] ?? '').toLowerCase()
    const rawAttrs = match[3] ?? ''
    const selfClosing = rawAttrs.trimEnd().endsWith('/')

    if (skipDepth > 0) {
      if (tag === skipTag) skipDepth += closing ? -1 : selfClosing ? 0 : 1
      continue
    }

    if (!ALLOWED_TAGS.has(tag)) {
      removed.add(`<${tag}>`)
      // Une balise interdite AUTOFERMANTE n'ouvre rien : il n'y a pas de
      // contenu a sauter, et incrementer la profondeur ferait tout avaler.
      if (!closing && !selfClosing) {
        skipDepth = 1
        skipTag = tag
      }
      continue
    }

    if (closing) {
      if (tag !== 'svg') out.push(`</${tag}>`)
      continue
    }

    const isRoot = tag === 'svg'
    const kept: string[] = []

    ATTR.lastIndex = 0
    let attr: RegExpExecArray | null
    while ((attr = ATTR.exec(rawAttrs)) !== null) {
      const name = (attr[1] ?? '').toLowerCase()
      const value = attr[3] ?? attr[4] ?? ''

      if (isRoot && ROOT_ONLY_ATTRS.has(name)) {
        if (name === 'viewbox' && VIEWBOX.test(value)) viewBox = value.trim()
        continue
      }
      if (!ALLOWED_ATTRS.has(name)) {
        // `on*` merite d'etre nomme : c'est le vecteur que l'utilisateur a le
        // plus de chances d'avoir colle sans le savoir.
        removed.add(name.startsWith('on') ? `attribut ${name} (gestionnaire d’événement)` : name)
        continue
      }
      if (HOSTILE_VALUE.test(value)) {
        removed.add(`${name} (valeur refusée)`)
        continue
      }
      kept.push(`${name}="${value.replace(/"/g, '&quot;')}"`)
    }

    if (isRoot) {
      // La racine n'est pas recopiee : c'est `<Icon>` qui la pose, avec les
      // attributs communs du jeu. Deux `<svg>` imbriques rendraient de toute
      // facon un dessin a la mauvaise echelle.
      sawRoot = true
      continue
    }

    const attrs = kept.length > 0 ? ` ${kept.join(' ')}` : ''
    out.push(selfClosing ? `<${tag}${attrs}/>` : `<${tag}${attrs}>`)
  }

  if (!sawRoot) removed.add('balise <svg> absente')

  return { markup: out.join(''), viewBox, removed: [...removed] }
}

/**
 * Retire couleurs et remplissages pour que l'icone prenne le style maison.
 *
 * Applique seulement quand l'utilisateur N'A PAS demande de garder les
 * couleurs d'origine. `fill="none"` est conserve : c'est une consigne de
 * dessin, pas une couleur, et l'oter remplirait des contours fermes.
 */
export function stripColors(markup: string): string {
  return markup.replace(
    /\s(fill|stroke|stop-color|fill-opacity|stroke-opacity)\s*=\s*"([^"]*)"/g,
    (whole, attr: string, value: string) =>
      attr === 'fill' && value.trim().toLowerCase() === 'none' ? whole : '',
  )
}
