/**
 * Fait arriver les nouvelles versions jusqu'a l'appareil.
 *
 * LE DEFAUT QUE CE FICHIER CORRIGE. `vite.config.ts` demande `autoUpdate`,
 * `skipWaiting` et `clientsClaim`, et c'est correct : le nouveau service worker
 * s'active sans attendre la fermeture des onglets. Mais le script de
 * chargement genere se resume a ceci :
 *
 *   navigator.serviceWorker.register('/sw.js', { scope: '/' })
 *
 * Il enregistre, et rien de plus. Le nouveau worker prend la main sur le cache,
 * pendant que la page DEJA OUVERTE continue d'executer le JavaScript qu'elle a
 * charge il y a trois jours. Aucun evenement ne la ramene a la realite.
 *
 * Sur un navigateur de bureau le defaut se corrige tout seul a la visite
 * suivante, qui repart du cache neuf. Sur une PWA installee sur un iPhone, non :
 * iOS ne ferme jamais vraiment l'application, il la suspend et la restaure. Il
 * n'y a donc pas de « visite suivante », et l'ecran peut rester des jours sur
 * une version publiee depuis longtemps — exactement le symptome observe apres
 * la mise en production du jeu d'icones.
 *
 * DEUX PRECAUTIONS, chacune contre une facon de rendre le remede pire que le mal :
 *
 *   - on ne recharge JAMAIS une page sous les yeux de l'utilisateur. Le tampon
 *     d'edition d'une recette ne vit qu'en memoire (voir `screens/recettes/
 *     draft.ts`, aucune persistance) : recharger pendant la frappe ferait
 *     perdre la saisie. On attend que la page passe en arriere-plan ;
 *   - on ignore la toute premiere prise de controle. Un client sans controleur
 *     au demarrage vient d'installer le service worker : le `controllerchange`
 *     qui suit est cette installation, pas une nouvelle version. Recharger la
 *     donnerait un rechargement gratuit a la premiere visite, et une boucle si
 *     on s'y prenait mal.
 */

/** Deux verifications par minute au plus : `update()` est une requete reseau. */
const UPDATE_CHECK_INTERVAL_MS = 30_000

export function keepAppUpToDate(): void {
  if (!('serviceWorker' in navigator)) return

  const hadControllerAtBoot = navigator.serviceWorker.controller !== null

  let updateWaiting = false
  let alreadyReloaded = false
  let lastCheckAt = 0

  /** Recharge, mais seulement quand ca ne coute rien a personne. */
  const applyWhenOutOfSight = () => {
    if (!updateWaiting || alreadyReloaded) return
    if (document.visibilityState !== 'hidden') return
    alreadyReloaded = true
    window.location.reload()
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtBoot) return
    updateWaiting = true
    applyWhenOutOfSight()
  })

  const checkForUpdate = () => {
    const now = Date.now()
    if (now - lastCheckAt < UPDATE_CHECK_INTERVAL_MS) return
    lastCheckAt = now
    void navigator.serviceWorker.getRegistration().then((registration) => registration?.update())
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      // On interroge le serveur AU MOMENT de partir : le worker s'active
      // pendant que l'application est en arriere-plan, la page se recharge sans
      // spectateur, et l'utilisateur retrouve la version neuve en revenant.
      checkForUpdate()
      applyWhenOutOfSight()
      return
    }
    // Au retour au premier plan : iOS ne rejoue pas le script de chargement
    // apres une simple reprise, donc sans cette verification l'application peut
    // ne jamais apprendre qu'une version plus recente existe.
    checkForUpdate()
  })
}
