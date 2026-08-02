/**
 * Neutralise le zoom du navigateur.
 *
 * Le pincement a deux doigts zoomait par accident — un geste de defilement mal
 * assure suffit — et laissait l'ecran dans un etat incomprehensible : on ne
 * voit plus qu'un morceau d'interface, sans repere pour revenir. L'application
 * est deja dimensionnee pour le telephone (texte a 16 px minimum, cibles a
 * 44 px) : le zoom n'y apporte rien qu'un accident.
 *
 * ---------------------------------------------------------------------------
 * TROIS MECANISMES, PARCE QU'AUCUN NE SUFFIT SEUL
 * ---------------------------------------------------------------------------
 *   1. `maximum-scale=1, user-scalable=no` dans index.html — honore par iOS
 *      UNIQUEMENT quand l'application est installee sur l'ecran d'accueil.
 *      Dans un onglet Safari, iOS l'ignore deliberement.
 *   2. `touch-action: pan-x pan-y` sur la racine (theme.css) — couvre Chrome
 *      et Android, et supprime au passage le zoom par double tape.
 *   3. Les evenements `gesture*` ci-dessous — proprietaires WebKit, c'est le
 *      seul levier qui reste dans un onglet Safari.
 *
 * ---------------------------------------------------------------------------
 * CE QUI RESTE POSSIBLE, ET C'EST VOULU
 * ---------------------------------------------------------------------------
 * Le zoom SYSTEME d'iOS (Reglages > Accessibilite > Zoom) n'est pas concerne :
 * il agit au-dessus du navigateur. Quelqu'un qui a besoin d'agrandir garde
 * donc un chemin, ce qui rend la mesure acceptable — desactiver le zoom d'une
 * page est sinon une faute d'accessibilite caracterisee.
 *
 * Et surtout : un element portant `data-allow-gestures` recupere le pincement
 * pour son propre compte. C'est ce qui permettra a un graphique de gerer zoom
 * et selection a deux doigts — bloquer le zoom du navigateur est precisement
 * ce qui libere le geste.
 */

/** Vrai si l'element, ou l'un de ses ancetres, revendique les gestes. */
function claimsGestures(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-allow-gestures]') !== null
}

/**
 * Installe les gardes. Rend une fonction qui les retire.
 *
 * Appele une fois au demarrage. Le retour n'existe que pour la symetrie et les
 * tests : en pratique rien ne desinstalle ces ecouteurs.
 */
export function preventBrowserZoom(): () => void {
  const block = (event: Event) => {
    if (claimsGestures(event.target)) return
    event.preventDefault()
  }

  // Evenements WebKit, absents du typage standard du DOM : ils n'existent que
  // sur Safari, ou ils sont justement le seul recours.
  const events = ['gesturestart', 'gesturechange', 'gestureend']
  // `passive: false` est INDISPENSABLE : sans lui le navigateur suppose que
  // l'ecouteur ne bloquera rien et ignore purement et simplement le
  // preventDefault, sans avertissement.
  for (const name of events) document.addEventListener(name, block, { passive: false })

  return () => {
    for (const name of events) document.removeEventListener(name, block)
  }
}

/**
 * Facteur de zoom courant, 1 quand la page est a sa taille normale.
 *
 * Sert a l'ecran Parametres : c'est le seul moyen, depuis le telephone, de
 * verifier que le blocage tient. Retombe sur 1 quand `visualViewport` n'existe
 * pas — mieux vaut ne rien annoncer qu'annoncer un chiffre invente.
 */
export function currentZoomScale(): number {
  return window.visualViewport?.scale ?? 1
}
