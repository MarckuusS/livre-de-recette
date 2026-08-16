#!/usr/bin/env node
/**
 * Tient un navigateur Chromium en mode TELEPHONE, pour de vrai.
 *
 * POURQUOI CE SCRIPT EXISTE, alors qu'on peut retrecir une fenetre : retrecir
 * ne donne QUE la mise en page. Le comportement reste celui d'une souris. Or ce
 * qui casse sur un telephone n'est presque jamais la largeur, c'est le geste :
 * un `:hover` qui n'existe pas au doigt, un glisser qui ne demarre pas, une
 * cible de trente pixels qu'on rate. Rien de cela ne se voit dans une fenetre
 * etroite pilotee a la souris.
 *
 * Trois commandes indissociables :
 *   1. `setDeviceMetricsOverride` pose la taille ET la densite. La densite
 *      compte : c'est elle qui revele une image floue ou un trait d'un demi
 *      pixel qui disparait.
 *   2. `setTouchEmulationEnabled` fait exister l'ecran tactile. La page cesse
 *      alors de repondre aux requetes de survol, ce que la largeur ne provoque
 *      jamais.
 *   3. `setEmitTouchEventsForMouse` TRADUIT la souris en doigt. C'est elle qui
 *      rend le glisser et le balayage testables ; sans elle, les deux premieres
 *      ne changent que l'apparence.
 *
 * IL RESTE OUVERT, ET C'EST LE POINT LE PLUS IMPORTANT. Ces reglages sont lies
 * a la SESSION de debogage, pas au navigateur : des que le pilote se
 * deconnecte, Chromium les annule et la page redevient un ordinateur. Une
 * premiere version envoyait les commandes puis rendait la main ; elle
 * annoncait un succes et ne changeait rien, ce que seule une sonde dans la page
 * a revele. Le script tient donc la ligne ouverte jusqu'a Ctrl+C.
 *
 * Il se branche sur le NAVIGATEUR et non sur un onglet : une seule connexion
 * couvre tous les onglets, y compris ceux ouverts plus tard, qui repartiraient
 * sinon en mode ordinateur.
 *
 * Aucune dependance : Node 22 et au-dela portent un client WebSocket natif.
 */

const PORT = Number(process.env['CDP_PORT'] ?? 9222)

/**
 * iPhone 14 Pro. Le choix n'est pas neutre : 393 points est la largeur de
 * reference de ce projet, celle sur laquelle ses mesures ont ete prises, et sa
 * densite de 3 est celle qui met en defaut une image trop petite.
 */
const APPAREIL = { width: 393, height: 852, deviceScaleFactor: 3, mobile: true }
const NOM = 'iPhone 14 Pro'

const UA_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

const dors = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * L'adresse de la prise du NAVIGATEUR, quand il veut bien repondre.
 *
 * Il met une seconde ou deux a l'ouvrir : on reessaie plutot que d'echouer sur
 * la premiere tentative, qui rate presque toujours.
 */
async function attendreNavigateur(essais = 60) {
  for (let i = 0; i < essais; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) {
        const info = await r.json()
        if (info.webSocketDebuggerUrl) return info
      }
    } catch {
      // Il n'ecoute pas encore. Cas nominal des premieres secondes.
    }
    await dors(250)
  }
  return null
}

async function main() {
  const navigateur = await attendreNavigateur()
  if (navigateur === null) {
    console.error("[mobile] Le navigateur n'a pas ouvert sa prise de débogage.")
    console.error(`[mobile] Lance-le avec --remote-debugging-port=${PORT} et un --user-data-dir à part.`)
    process.exit(1)
  }

  const ws = new WebSocket(navigateur.webSocketDebuggerUrl)
  await new Promise((ok, ko) => {
    ws.addEventListener('open', ok, { once: true })
    ws.addEventListener('error', () => ko(new Error('Connexion au navigateur refusée.')), {
      once: true,
    })
  })

  let id = 0
  const envoyer = (method, params, sessionId) => {
    id += 1
    const trame = { id, method, params }
    // `sessionId` route la commande vers un onglet plutot que vers le
    // navigateur : c'est ce que permet le mode "aplati" demande plus bas.
    if (sessionId !== undefined) trame.sessionId = sessionId
    ws.send(JSON.stringify(trame))
    return id
  }

  const equipes = new Set()

  /** Pose les trois reglages sur un onglet, plus l'identite du telephone. */
  const equiper = (sessionId, url) => {
    if (equipes.has(sessionId)) return
    equipes.add(sessionId)
    envoyer('Emulation.setDeviceMetricsOverride', APPAREIL, sessionId)
    envoyer('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId)
    envoyer(
      'Emulation.setEmitTouchEventsForMouse',
      { enabled: true, configuration: 'mobile' },
      sessionId,
    )
    envoyer('Network.setUserAgentOverride', { userAgent: UA_IPHONE }, sessionId)

    /*
     * UN RECHARGEMENT, ET IL N'EST PAS DECORATIF.
     *
     * Chromium decide a l'ouverture de la page si `ontouchstart` existe sur
     * `window`, et ne revient pas dessus quand on active l'ecran tactile
     * ensuite. Mesure : sans ce rechargement, `maxTouchPoints` vaut bien 5 et
     * le survol a bien disparu, mais `'ontouchstart' in window` reste FAUX.
     *
     * Or c'est exactement la detection qu'emploient beaucoup de bibliotheques
     * de geste pour decider d'ecouter le doigt ou la souris : sans lui, une
     * moitie du code se croit sur un telephone et l'autre sur un ordinateur,
     * ce qui est pire que les deux.
     *
     * Une seule fois par onglet, `equipes` s'en portant garant : recharger a
     * chaque attachement ferait une boucle sans fin.
     */
    if (typeof url === 'string' && /^https?:/.test(url)) {
      envoyer('Page.enable', {}, sessionId)
      envoyer('Page.reload', {}, sessionId)
    }

    const court = (url ?? '').slice(0, 60)
    console.log(`[mobile] Onglet équipé${court ? ` : ${court}` : ''}`)
  }

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)

    // Un onglet apparait : on s'y attache. `flatten` fait passer ses reponses
    // par cette meme connexion, ce qui evite d'en ouvrir une par onglet.
    if (msg.method === 'Target.targetCreated' && msg.params?.targetInfo?.type === 'page') {
      envoyer('Target.attachToTarget', { targetId: msg.params.targetInfo.targetId, flatten: true })
    }

    if (msg.method === 'Target.attachedToTarget' && msg.params?.targetInfo?.type === 'page') {
      equiper(msg.params.sessionId, msg.params.targetInfo.url)
    }

    if (msg.method === 'Target.detachedFromTarget') equipes.delete(msg.params?.sessionId)

    if (msg.error !== undefined) {
      console.error(`[mobile] Le navigateur a refusé une commande : ${msg.error.message}`)
    }
  })

  // `autoAttach` couvre les onglets a venir, `setDiscoverTargets` ceux qui sont
  // deja ouverts : sans les deux, l'onglet ouvert avant nous resterait en mode
  // ordinateur.
  envoyer('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
  envoyer('Target.setDiscoverTargets', { discover: true })

  console.log(`[mobile] ${NOM} : ${APPAREIL.width} x ${APPAREIL.height}, densité ${APPAREIL.deviceScaleFactor}.`)
  console.log('[mobile] Écran tactile actif : la souris produit de vrais événements de doigt.')
  console.log('[mobile] Glisse, balaie, tire une liste : ça se comporte comme un téléphone.')
  console.log('')
  console.log('[mobile] CETTE FENÊTRE DOIT RESTER OUVERTE. Les réglages sont liés à la')
  console.log('[mobile] connexion : la fermer rend au navigateur son comportement de bureau.')
  console.log('[mobile] Ctrl+C pour revenir en mode ordinateur.')

  ws.addEventListener('close', () => {
    console.log('[mobile] Connexion perdue : le navigateur est repassé en mode ordinateur.')
    process.exit(0)
  })

  // On ne rend jamais la main : c'est tout l'objet du script.
  await new Promise(() => {})
}

main().catch((e) => {
  console.error('[mobile]', e.message)
  process.exit(1)
})
