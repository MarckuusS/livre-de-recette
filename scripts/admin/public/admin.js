/*
 * Console d'administration — cote navigateur.
 *
 * Pas de dependance, pas d'etape de construction : le fichier est servi tel
 * quel. Un outil qu'on lance trois fois par an ne doit pas dependre d'un
 * `npm install` qui aura vieilli entre deux usages.
 */

const $ = (sel) => document.querySelector(sel)

/*
 * LA BASE DE DEVELOPPEMENT EST LE DEFAUT, et c'est deliberé.
 *
 * Un ecran d'administration qui s'ouvre sur la production invite a cliquer
 * avant d'avoir regarde ou l'on est. Ici le premier geste dangereux demande
 * un choix conscient.
 */
let cible = 'local'

/*
 * « Vide » couvre AUSSI la chaine "null".
 *
 * Les deux cibles ne rendent pas un NULL de la meme facon : la production
 * rend un vrai `null` JSON, miniflare rend la chaine "null". Sans ce cas, un
 * compte jamais connecte affichait « Derniere connexion : null » — c'est-a-dire
 * l'etat le plus courant dans une console d'administration, ou l'on regarde
 * surtout les comptes qu'on vient de creer.
 */
const estVide = (v) => v === null || v === undefined || v === '' || v === 'null'

const texte = (v) => (estVide(v) ? '—' : String(v))

/** Une date ISO en quelque chose qui se lit d'un coup d'oeil. */
function quand(iso) {
  if (estVide(iso)) return 'jamais'
  const d = new Date(String(iso).endsWith('Z') ? iso : `${iso}Z`)
  if (Number.isNaN(d.getTime())) return texte(iso)
  return d.toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

function banniere(message, estErreur = false) {
  const el = $('#banniere')
  if (!message) {
    el.hidden = true
    return
  }
  el.hidden = false
  el.textContent = message
  el.classList.toggle('banniere--erreur', estErreur)
}

async function api(chemin, options = {}) {
  const reponse = await fetch(`/api${chemin}?cible=${cible}`, options)
  const corps = await reponse.json().catch(() => ({}))
  if (!reponse.ok) throw new Error(corps.erreur ?? `HTTP ${reponse.status}`)
  return corps
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

/**
 * Les cuisines habitees par plus d'un compte.
 *
 * C'est la situation que le projet refuse : une cuisine par compte, le partage
 * ne pouvant venir que d'une invitation acceptee. La console la signale au
 * lieu de la laisser se lire entre les lignes d'un tableau — c'est
 * exactement ce qui est passe inapercu le 16 aout 2026.
 */
function anomalies(comptes) {
  const parFoyer = new Map()
  for (const c of comptes) {
    if (c.household_id === null) continue
    const liste = parFoyer.get(c.household_id) ?? []
    liste.push(c)
    parFoyer.set(c.household_id, liste)
  }

  const conteneur = $('#anomalies')
  conteneur.textContent = ''

  for (const [id, membres] of parFoyer) {
    if (membres.length < 2) continue
    const bloc = document.createElement('div')
    bloc.className = 'anomalie'
    const titre = document.createElement('h3')
    titre.textContent = `Cuisine partagée : « ${texte(membres[0].cuisine)} » (n° ${id})`
    const p = document.createElement('p')
    p.textContent =
      `${membres.map((m) => m.username).join(', ')} voient les mêmes recettes, le même frigo, ` +
      `les mêmes prix et le même planning. Le projet ne prévoit le partage que par invitation ` +
      `acceptée : si personne n'a consenti à cela, c'est à corriger.`
    bloc.append(titre, p)
    conteneur.append(bloc)
  }

  const sansFoyer = comptes.filter((c) => c.cuisine === null)
  if (sansFoyer.length > 0) {
    const bloc = document.createElement('div')
    bloc.className = 'anomalie'
    const titre = document.createElement('h3')
    titre.textContent = 'Compte sans cuisine'
    const p = document.createElement('p')
    p.textContent = `${sansFoyer.map((c) => c.username).join(', ')} pointe vers un foyer qui n'existe pas.`
    bloc.append(titre, p)
    conteneur.append(bloc)
  }
}

function carteCompte(c) {
  const el = document.createElement('article')
  el.className = `compte${c.is_active ? '' : ' compte--inactif'}`

  const gauche = document.createElement('div')

  const nom = document.createElement('div')
  nom.className = 'compte__nom'
  nom.textContent = `${c.username} — ${texte(c.display_name)} `
  const id = document.createElement('span')
  id.className = 'compte__id'
  id.textContent = `n° ${c.id}`
  nom.append(id)
  if (!c.is_active) {
    const badge = document.createElement('span')
    badge.className = 'etiquette etiquette--inactif'
    badge.textContent = 'désactivé'
    nom.append(' ', badge)
  }
  // Un compte invite est actif mais sans mot de passe utilisable : sans cette
  // etiquette, il se lit comme un compte ordinaire dont personne ne comprend
  // pourquoi il ne se connecte jamais.
  if (Number(c.invitation_en_attente ?? 0) > 0) {
    const badge = document.createElement('span')
    badge.className = 'etiquette etiquette--attente'
    badge.textContent = 'invitation en attente'
    nom.append(' ', badge)
  }

  const faits = document.createElement('div')
  faits.className = 'compte__faits'
  for (const t of [
    `Cuisine : ${texte(c.cuisine)} (n° ${texte(c.household_id)})`,
    `${c.recettes} recette(s)`,
    `${c.ingredients} ingrédient(s)`,
    `${c.planning} repas planifié(s)`,
    `Dernière connexion : ${quand(c.last_login_at)}`,
  ]) {
    const s = document.createElement('span')
    s.textContent = t
    faits.append(s)
  }

  gauche.append(nom, faits)

  const actions = document.createElement('div')
  actions.className = 'compte__actions'

  const bascule = document.createElement('button')
  bascule.type = 'button'
  bascule.className = 'bouton'
  bascule.textContent = c.is_active ? 'Désactiver' : 'Réactiver'
  bascule.addEventListener('click', () => void basculer(c))

  const reinit = document.createElement('button')
  reinit.type = 'button'
  reinit.className = 'bouton'
  reinit.textContent = 'Réinitialiser le mot de passe'
  reinit.addEventListener('click', () => void reinitialiser(c))

  /*
   * LA SUPPRESSION DEFINITIVE EXIGE UN COMPTE DEJA DESACTIVE.
   *
   * C'est le « deux temps » : couper l'acces est immediat et se defait, la
   * destruction ne s'offre qu'ensuite. Un clic de trop ne coute alors rien.
   */
  const supprimer = document.createElement('button')
  supprimer.type = 'button'
  supprimer.className = 'bouton bouton--danger'
  supprimer.textContent = 'Supprimer définitivement'
  supprimer.disabled = Boolean(c.is_active)
  supprimer.addEventListener('click', () => void detruire(c))

  actions.append(bascule, reinit, supprimer)

  /*
   * L'indice est un TEXTE A COTE, pas un `title` sur le bouton.
   *
   * Un `title` devient le nom accessible et masque le libelle : le lecteur
   * d'ecran annoncait « Desactive d'abord ce compte » a la place de
   * « Supprimer definitivement ». Constate dans l'arbre d'accessibilite.
   */
  if (c.is_active) {
    const indice = document.createElement('span')
    indice.className = 'indice'
    indice.textContent = "Désactive d'abord ce compte pour pouvoir le supprimer."
    actions.append(indice)
  }
  el.append(gauche, actions)
  return el
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function basculer(c) {
  const verbe = c.is_active ? 'desactiver' : 'activer'
  if (c.is_active && !confirm(`Désactiver « ${c.username} » ?\n\nIl sera déconnecté immédiatement.`))
    return
  try {
    await api(`/comptes/${c.id}/${verbe}`, { method: 'POST' })
    await charger()
  } catch (err) {
    banniere(String(err.message ?? err), true)
  }
}

async function detruire(c) {
  /*
   * On fait ECRIRE l'identifiant. Un « OK / Annuler » se clique sans lire ;
   * recopier « ruddy » oblige a regarder de qui il s'agit.
   */
  const saisi = prompt(
    `Suppression DEFINITIVE de « ${c.username} » sur ${cible === 'production' ? 'la PRODUCTION' : 'la base de développement'}.\n\n` +
      `Ses données personnelles (profil, pesées, hydratation) partent avec lui.\n` +
      `Sa cuisine « ${texte(c.cuisine)} » et son contenu RESTENT.\n\n` +
      `Écris son identifiant pour confirmer :`,
  )
  if (saisi === null) return
  if (saisi.trim().toLowerCase() !== c.username) {
    banniere("L'identifiant saisi ne correspond pas : rien n'a été supprimé.")
    return
  }
  try {
    await api(`/comptes/${c.id}`, { method: 'DELETE' })
    banniere(`Compte « ${c.username} » supprimé.`)
    await charger()
  } catch (err) {
    banniere(String(err.message ?? err), true)
  }
}

/**
 * Cree le compte et affiche le lien d'invitation.
 *
 * LE LIEN EST AFFICHE UNE SEULE FOIS, et on le dit. Seule son empreinte est
 * stockee : la console ne peut pas le retrouver ensuite, pas plus qu'un
 * attaquant qui lirait la base. Perdu, il faut supprimer le compte et
 * recommencer.
 */
async function creer(event) {
  event.preventDefault()
  const formulaire = event.target
  const bouton = formulaire.querySelector('button[type=submit]')
  const donnees = Object.fromEntries(new FormData(formulaire))

  bouton.disabled = true
  bouton.textContent = 'Création…'
  banniere(null)

  try {
    const { identifiant, lien, expiration } = await api('/comptes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(donnees),
    })

    afficherLien({
      titre: `Compte « ${identifiant} » créé.`,
      lien,
      expiration,
      consigne: 'Transmets ce lien à la personne.',
    })
    formulaire.reset()
    await charger()
  } catch (err) {
    banniere(String(err.message ?? err), true)
  } finally {
    bouton.disabled = false
    bouton.textContent = 'Créer et obtenir le lien'
  }
}

/**
 * Affiche un lien fraichement emis, une seule fois.
 *
 * Partage par la creation et la reinitialisation : c'est le meme objet, avec
 * la meme mise en garde. Deux rendus auraient fini par ne plus dire la meme
 * chose de sa duree de vie.
 */
function afficherLien({ titre, lien, expiration, consigne }) {
  const bloc = $('#resultat')
  bloc.hidden = false
  bloc.textContent = ''

  const h = document.createElement('h3')
  h.textContent = titre

  const p = document.createElement('p')
  p.textContent =
    `${consigne} Il vaut jusqu'au ${quand(expiration)} et ne servira qu'une fois. ` +
    `Il n'est affiché qu'ici : seule son empreinte est enregistrée, personne ne peut le ` +
    `retrouver ensuite.`

  const champ = document.createElement('input')
  champ.className = 'champ__saisie lien'
  champ.readOnly = true
  champ.value = lien
  champ.addEventListener('focus', () => champ.select())

  const copier = document.createElement('button')
  copier.type = 'button'
  copier.className = 'bouton'
  copier.textContent = 'Copier le lien'
  copier.addEventListener('click', () => {
    void navigator.clipboard.writeText(lien).then(
      () => (copier.textContent = 'Copié'),
      () => {
        champ.focus()
        copier.textContent = 'Copie refusée : sélectionne le champ'
      },
    )
  })

  bloc.append(h, p, champ, copier)
  bloc.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

async function reinitialiser(c) {
  if (
    !confirm(
      `Émettre un lien de réinitialisation pour « ${c.username} » ?\n\n` +
        `Son mot de passe actuel reste valable jusqu'à ce qu'il suive le lien.\n` +
        `Pour couper l'accès tout de suite, utilise « Désactiver ».`,
    )
  )
    return
  try {
    const { identifiant, lien, expiration } = await api(`/comptes/${c.id}/reinitialiser`, {
      method: 'POST',
    })
    afficherLien({
      titre: `Lien de réinitialisation pour « ${identifiant} »`,
      lien,
      expiration,
      consigne: 'Transmets-le à la personne.',
    })
    await charger()
  } catch (err) {
    banniere(String(err.message ?? err), true)
  }
}

// ---------------------------------------------------------------------------
// Cuisines
// ---------------------------------------------------------------------------

function carteCuisine(k) {
  const el = document.createElement('article')
  el.className = 'compte'

  const gauche = document.createElement('div')

  const nom = document.createElement('div')
  nom.className = 'compte__nom'
  nom.textContent = `${texte(k.name)} `
  const id = document.createElement('span')
  id.className = 'compte__id'
  id.textContent = `n° ${k.id}`
  nom.append(id)

  const faits = document.createElement('div')
  faits.className = 'compte__faits'
  for (const t of [
    Number(k.comptes) === 0 ? 'Aucun habitant' : `Habitants : ${texte(k.habitants)}`,
    `${k.recettes} recette(s)`,
    `${k.ingredients} ingrédient(s)`,
    `${k.planning} repas planifié(s)`,
    `${k.frigo} lot(s) au frigo`,
    `${k.prix} relevé(s) de prix`,
  ]) {
    const s = document.createElement('span')
    s.textContent = t
    faits.append(s)
  }

  gauche.append(nom, faits)

  const actions = document.createElement('div')
  actions.className = 'compte__actions'

  const renommer = document.createElement('button')
  renommer.type = 'button'
  renommer.className = 'bouton'
  renommer.textContent = 'Renommer'
  renommer.addEventListener('click', () => void renommerCuisine(k))

  const supprimer = document.createElement('button')
  supprimer.type = 'button'
  supprimer.className = 'bouton bouton--danger'
  supprimer.textContent = 'Supprimer'
  // Le refus est aussi impose par le serveur : ce bouton grise ce que la
  // console refuserait de toute facon, il ne fait pas office de garde.
  supprimer.disabled = Number(k.comptes) > 0
  supprimer.addEventListener('click', () => void detruireCuisine(k))

  actions.append(renommer, supprimer)

  if (Number(k.comptes) > 0) {
    const indice = document.createElement('span')
    indice.className = 'indice'
    indice.textContent = 'Une cuisine habitée ne se supprime pas.'
    actions.append(indice)
  }

  el.append(gauche, actions)
  return el
}

async function renommerCuisine(k) {
  const nom = prompt(`Nouveau nom pour la cuisine n° ${k.id} :`, k.name ?? '')
  if (nom === null || nom.trim() === '' || nom.trim() === k.name) return
  try {
    await api(`/cuisines/${k.id}/renommer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nom: nom.trim() }),
    })
    await charger()
  } catch (err) {
    banniere(String(err.message ?? err), true)
  }
}

async function detruireCuisine(k) {
  const total = Number(k.recettes) + Number(k.ingredients) + Number(k.planning) + Number(k.frigo)
  const saisi = prompt(
    `Suppression DEFINITIVE de la cuisine « ${k.name} » sur ` +
      `${cible === 'production' ? 'la PRODUCTION' : 'la base de développement'}.\n\n` +
      `Seront détruits : ${k.recettes} recette(s), ${k.ingredients} ingrédient(s), ` +
      `${k.planning} repas planifié(s), ${k.frigo} lot(s) au frigo, ${k.prix} relevé(s) de prix, ` +
      `et tout l'historique associé — ${total} lignes au bas mot.\n\n` +
      `Écris le nom exact de la cuisine pour confirmer :`,
  )
  if (saisi === null) return
  if (saisi.trim() !== k.name) {
    banniere("Le nom saisi ne correspond pas : rien n'a été supprimé.")
    return
  }
  try {
    const { supprimee } = await api(`/cuisines/${k.id}`, { method: 'DELETE' })
    banniere(`Cuisine « ${supprimee} » supprimée.`)
    await charger()
  } catch (err) {
    banniere(String(err.message ?? err), true)
  }
}

// ---------------------------------------------------------------------------
// Controle de sante
// ---------------------------------------------------------------------------

function rendreSante(controles) {
  const conteneur = $('#sante')
  conteneur.textContent = ''

  for (const c of controles) {
    const el = document.createElement('div')
    el.className = `controle${c.grave ? ' controle--grave' : ''}`

    const haut = document.createElement('div')
    haut.className = 'controle__haut'

    const nom = document.createElement('span')
    nom.className = 'controle__nom'
    nom.textContent = c.nom

    const valeur = document.createElement('span')
    valeur.className = 'controle__valeur'
    valeur.textContent = String(c.valeur)

    haut.append(nom, valeur)

    const detail = document.createElement('p')
    detail.className = 'controle__detail'
    detail.textContent = c.detail

    el.append(haut, detail)
    conteneur.append(el)
  }
}

async function charger() {
  $('#etat').textContent = 'Chargement…'
  $('#etat-cuisines').textContent = 'Chargement…'
  $('#liste').textContent = ''
  $('#cuisines').textContent = ''

  const ou = cible === 'production' ? 'la production' : 'la base de développement'

  try {
    // En parallele : trois allers-retours vers wrangler, dont chacun coute une
    // bonne seconde en production. En serie, l'ecran resterait vide trois fois
    // plus longtemps.
    const [comptes, cuisines, etatSante] = await Promise.all([
      api('/comptes'),
      api('/cuisines'),
      api('/sante'),
    ])

    $('#etat').textContent = `${comptes.comptes.length} compte(s) sur ${ou}.`
    anomalies(comptes.comptes)
    for (const c of comptes.comptes) $('#liste').append(carteCompte(c))

    $('#etat-cuisines').textContent = `${cuisines.cuisines.length} cuisine(s) sur ${ou}.`
    for (const k of cuisines.cuisines) $('#cuisines').append(carteCuisine(k))

    rendreSante(etatSante.controles)
  } catch (err) {
    $('#etat').textContent = ''
    $('#etat-cuisines').textContent = ''
    banniere(String(err.message ?? err), true)
  }
}

// ---------------------------------------------------------------------------
// Mise en route
// ---------------------------------------------------------------------------

function choisirCible(nouvelle) {
  cible = nouvelle
  for (const b of document.querySelectorAll('.cible__choix')) {
    b.setAttribute('aria-pressed', String(b.dataset.cible === cible))
  }
  banniere(
    cible === 'production'
      ? 'Tu agis sur la PRODUCTION. Les comptes listés sont ceux des vraies personnes.'
      : null,
  )
  void charger()
}

for (const b of document.querySelectorAll('.cible__choix')) {
  b.addEventListener('click', () => choisirCible(b.dataset.cible))
}
$('#rafraichir').addEventListener('click', () => void charger())
$('#creation').addEventListener('submit', (e) => void creer(e))

choisirCible('local')
