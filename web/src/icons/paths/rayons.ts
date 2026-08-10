/**
 * Icones de rayon — une par en-tete de section de la liste de courses.
 *
 * Un rayon n'est pas un ingredient : son icone doit se lire comme un lieu du
 * magasin, pas comme un produit precis. D'ou le choix systematique d'un objet
 * emblematique du rayon plutot que d'un aliment qui pourrait apparaitre dans
 * la liste juste en dessous (le sac pour l'epicerie, la cagette pour le fourre
 * -tout, le flocon pour les surgeles).
 *
 * Les libelles sont saisis librement par l'utilisateur : la correspondance vit
 * dans `../rayon.ts` et travaille sur un libelle normalise, jamais sur l'egalite
 * stricte. Un rayon inconnu retombe sur `rayon-autre`.
 */

export const RAYON_PATHS = {
  'rayon-fruits-legumes':
    '<path d="M12 9.8c-1.3-1.2-3.2-1.3-4.5-.2-1.7 1.4-1.9 4.3-.7 6.8 1 2.3 2.6 4 3.7 4 .5 0 .9-.3 1.5-.3s1 .3 1.5.3c1.1 0 2.7-1.7 3.7-4 1.2-2.5 1-5.4-.7-6.8-1.3-1.1-3.2-1-4.5.2Z"/><path d="M12 9.6V6.8"/><path d="M12.3 8.4c.3-1.9 2.1-3.2 4.2-3 .3 2.1-1.1 3.9-3.2 4.1Z"/>',
  'rayon-boulangerie':
    '<path d="M4 18.8c-.6-5.1 3-9.4 8-9.4s8.6 4.3 8 9.4Z"/><path d="M8.8 12.6 7.2 15.4M12 12.2l-1.6 3.2M15.2 12.6l-1.6 2.8"/>',
  // Le hachoir plutot qu'une piece de viande : toutes les tentatives de cote
  // avec son os finissaient en sucette ou en bombe, et une piece de viande
  // dupliquait de toute facon `boeuf`. L'outil, lui, ne designe que le metier.
  'rayon-boucherie':
    '<path d="M4.8 5.4h9.8v9.2H4.8a1.6 1.6 0 0 1-1.6-1.6V7a1.6 1.6 0 0 1 1.6-1.6Z"/><path d="M14.6 7.4h5.2a1.6 1.6 0 0 1 0 3.2h-5.2"/><path d="M3.2 19.4h17.6"/>',
  'rayon-poissonnerie':
    '<path d="M20.6 10.9c-1.6 2.6-4.6 4.4-8 4.4-2.6 0-5-1-6.7-2.6l-2.5 2.4V7.1l2.5 2.4c1.7-1.6 4.1-2.6 6.7-2.6 3.4 0 6.4 1.8 8 4Z"/><circle cx="16.6" cy="9.9" r=".85" fill="currentColor" stroke="none"/><path d="M3.4 19.6c1.4-1.2 2.9-1.2 4.3 0s2.9 1.2 4.3 0 2.9-1.2 4.3 0 2.9 1.2 4.3 0"/>',
  'rayon-produits-laitiers':
    '<path d="M6.8 9.2 12 3.4l5.2 5.8v10.4a1.8 1.8 0 0 1-1.8 1.8H8.6a1.8 1.8 0 0 1-1.8-1.8Z"/><path d="M6.8 9.2h10.4M12 3.4v5.8"/><path d="M9.8 13.2h4.4"/>',
  'rayon-boissons':
    '<path d="M8.4 2.8h2.6v3.3l1.3 2.3v11.2a1.6 1.6 0 0 1-1.6 1.6H8.7a1.6 1.6 0 0 1-1.6-1.6V8.4l1.3-2.3Z"/><path d="M7.1 12.4h5.2"/><path d="M14.8 8.6h6.4l-.9 11.1a1.5 1.5 0 0 1-1.5 1.4h-1.6a1.5 1.5 0 0 1-1.5-1.4Z"/><path d="M15.1 12.6h5.8"/>',
  'rayon-surgeles':
    '<path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/><path d="m9.6 5.4 2.4 2.4 2.4-2.4M9.6 18.6 12 16.2l2.4 2.4M4.4 11.2l.8-3.2 3.3-.5M19.6 12.8l-.8 3.2-3.3.5M8.5 16.5l-3.3-.5-.8-3.2M15.5 7.5l3.3.5.8 3.2"/>',
  'rayon-epicerie':
    '<path d="M5.6 8.8h12.8l-1 11a1.9 1.9 0 0 1-1.9 1.7H8.5a1.9 1.9 0 0 1-1.9-1.7Z"/><path d="M9 8.8V6.6a3 3 0 0 1 6 0v2.2"/>',
  'rayon-snacks-confiseries':
    '<ellipse cx="12" cy="12" rx="4.3" ry="3.6"/><path d="M7.8 10.4 3.8 7.6v8.8l4-2.8M16.2 10.4l4-2.8v8.8l-4-2.8"/><path d="M10.4 11c.9-.7 2.3-.7 3.2 0"/>',
  'rayon-autre':
    '<rect x="3.6" y="7.6" width="16.8" height="13" rx="2"/><path d="M3.6 12.4h16.8M9 7.6v13M15 7.6v13"/>',
} as const
