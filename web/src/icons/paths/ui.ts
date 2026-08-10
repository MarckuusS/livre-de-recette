/**
 * Icones d'interface — chevrons, actions, etats.
 *
 * Regles de dessin communes a TOUTES les familles (voir README.md du dossier) :
 * grille 24x24, trait seul, `stroke-width` 1.6, extremites et jonctions
 * arrondies, masse optique dans le carre 3..21. Aucune couleur n'est ecrite
 * ici : le trait vaut `currentColor`, c'est le contexte qui decide.
 *
 * Les rares aplats (points, pupilles, etoile pleine) portent explicitement
 * `fill="currentColor" stroke="none"` : sans le `stroke="none"`, le contour
 * herite du trait de 1,6 px et un point de 0,7 px de rayon devient une tache.
 */

export const UI_PATHS = {
  // ---------- Navigation ----------
  'ui-chevron-left': '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  'ui-chevron-right': '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  'ui-chevron-up': '<path d="M5.5 14.5 12 8l6.5 6.5"/>',
  'ui-chevron-down': '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
  'ui-arrow-left': '<path d="M19.4 12H4.6m0 0 5.6-5.6M4.6 12l5.6 5.6"/>',
  'ui-arrow-right': '<path d="M4.6 12h14.8m0 0-5.6-5.6M19.4 12l-5.6 5.6"/>',

  // ---------- Actions ----------
  'ui-plus': '<path d="M12 4.8v14.4M4.8 12h14.4"/>',
  'ui-minus': '<path d="M4.8 12h14.4"/>',
  'ui-close': '<path d="m6.2 6.2 11.6 11.6M17.8 6.2 6.2 17.8"/>',
  'ui-check': '<path d="m4.8 12.4 4.9 4.9L19.2 6.6"/>',
  'ui-check-circle':
    '<circle cx="12" cy="12" r="8.6"/><path d="m8.2 12.2 2.6 2.6 5-5.4"/>',
  'ui-close-circle':
    '<circle cx="12" cy="12" r="8.6"/><path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6"/>',
  'ui-edit':
    '<path d="M15.9 4.1a1.8 1.8 0 0 1 2.6 0l1.4 1.4a1.8 1.8 0 0 1 0 2.6L8.4 19.6l-4.8 1.1 1.1-4.8Z"/><path d="m14.5 5.5 4 4"/>',
  'ui-trash':
    '<path d="M4.6 6.6h14.8M9.6 6.6V4.9a1.3 1.3 0 0 1 1.3-1.3h2.2a1.3 1.3 0 0 1 1.3 1.3v1.7"/><path d="m6.6 6.6.9 12.1a1.8 1.8 0 0 0 1.8 1.7h5.4a1.8 1.8 0 0 0 1.8-1.7l.9-12.1"/><path d="M10.2 10.4v6M13.8 10.4v6"/>',
  'ui-eraser':
    '<path d="M8.8 20.6h11.6"/><path d="m14.2 4.5 5.3 5.3a1.8 1.8 0 0 1 0 2.5l-7.6 7.6a1.8 1.8 0 0 1-2.5 0l-5.3-5.3a1.8 1.8 0 0 1 0-2.5l7.6-7.6a1.8 1.8 0 0 1 2.5 0Z"/><path d="m8.4 8.3 5.3 5.3"/>',
  'ui-copy':
    '<path d="M9.4 4.6H7.6a2.1 2.1 0 0 0-2.1 2.1v12a2.1 2.1 0 0 0 2.1 2.1h8.8a2.1 2.1 0 0 0 2.1-2.1v-12a2.1 2.1 0 0 0-2.1-2.1h-1.8"/><rect x="9.4" y="2.9" width="5.2" height="3.4" rx="1.2"/><path d="M8.9 11.6h6.2M8.9 15.2h4.2"/>',
  'ui-save':
    '<path d="M4.6 6.7a2.1 2.1 0 0 1 2.1-2.1h8.8l4 4v8.7a2.1 2.1 0 0 1-2.1 2.1H6.7a2.1 2.1 0 0 1-2.1-2.1Z"/><path d="M8.4 4.6v4.2h6V4.6M8.4 19.4v-5.2h7.2v5.2"/>',
  'ui-folder':
    '<path d="M3.6 7.3a1.9 1.9 0 0 1 1.9-1.9h3.3l2.1 2.4h7.6a1.9 1.9 0 0 1 1.9 1.9v7.7a1.9 1.9 0 0 1-1.9 1.9H5.5a1.9 1.9 0 0 1-1.9-1.9Z"/>',
  'ui-refresh':
    '<path d="M3.6 12a8.4 8.4 0 1 0 2.5-6L3.6 8.5"/><path d="M3.6 3.8v4.7h4.7"/>',
  'ui-download':
    '<path d="M12 3.6v11.5m0 0 4.1-4.1M12 15.1 7.9 11"/><path d="M4.6 16.4v2a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-2"/>',
  'ui-share':
    '<circle cx="17.4" cy="5.8" r="2.5"/><circle cx="6.6" cy="12" r="2.5"/><circle cx="17.4" cy="18.2" r="2.5"/><path d="m8.9 10.8 6.2-3.7M8.9 13.2l6.2 3.7"/>',
  'ui-external-link':
    '<path d="M13.8 4.6h5.6v5.6M19.4 4.6l-8 8"/><path d="M17.8 14v4.5a1.9 1.9 0 0 1-1.9 1.9H5.5a1.9 1.9 0 0 1-1.9-1.9V8.1a1.9 1.9 0 0 1 1.9-1.9H10"/>',

  // ---------- Recherche, tri, filtres ----------
  'ui-search':
    '<circle cx="10.8" cy="10.8" r="6.4"/><path d="m15.4 15.4 4.2 4.2"/>',
  'ui-filter': '<path d="M3.6 5.4h16.8l-6.5 7.6v5.4l-3.8 2v-7.4Z"/>',
  'ui-sliders':
    '<path d="M3.8 7.4h8.4M17.6 7.4h2.6M3.8 16.6h2.6M11.6 16.6h8.6"/><circle cx="14.9" cy="7.4" r="2.4"/><circle cx="8.9" cy="16.6" r="2.4"/>',
  'ui-sort':
    '<path d="M7 19.4V4.6m0 0-3 3M7 4.6l3 3M17 4.6v14.8m0 0-3-3M17 19.4l3-3"/>',
  'ui-list':
    '<path d="M9 6.4h11.4M9 12h11.4M9 17.6h11.4"/><circle cx="4.6" cy="6.4" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.6" cy="17.6" r="1.2" fill="currentColor" stroke="none"/>',
  'ui-grip':
    '<circle cx="9.2" cy="6.4" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.8" cy="6.4" r="1.3" fill="currentColor" stroke="none"/><circle cx="9.2" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.8" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9.2" cy="17.6" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.8" cy="17.6" r="1.3" fill="currentColor" stroke="none"/>',
  'ui-more':
    '<circle cx="5.4" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.6" cy="12" r="1.4" fill="currentColor" stroke="none"/>',

  // ---------- Theme et reglages ----------
  'ui-sun':
    '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.2M12 19v2.2M21.2 12H19M5 12H2.8M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6M18.5 18.5l-1.6-1.6M7.1 7.1 5.5 5.5"/>',
  'ui-moon': '<path d="M20.2 14.7A8.6 8.6 0 0 1 9.3 3.8 8.6 8.6 0 1 0 20.2 14.7Z"/>',
  'ui-settings':
    '<circle cx="12" cy="12" r="6.6"/><circle cx="12" cy="12" r="2.6"/><path d="M12 5.4V3M12 21v-2.4M18.6 12H21M3 12h2.4M16.7 7.3l1.7-1.7M5.6 18.4l1.7-1.7M16.7 16.7l1.7 1.7M5.6 5.6l1.7 1.7"/>',
  'ui-screen-awake':
    '<rect x="6.8" y="2.8" width="10.4" height="18.4" rx="2.4"/><path d="M10.6 5.6h2.8"/><path d="M3 9.6a5.2 5.2 0 0 0 0 4.8M21 9.6a5.2 5.2 0 0 1 0 4.8"/>',

  // ---------- Etats et signaux ----------
  'ui-alert':
    '<path d="M13.4 4.4a1.6 1.6 0 0 0-2.8 0L3.2 18a1.6 1.6 0 0 0 1.4 2.4h14.8A1.6 1.6 0 0 0 20.8 18Z"/><path d="M12 9.4v4.4"/><circle cx="12" cy="17" r=".85" fill="currentColor" stroke="none"/>',
  'ui-info':
    '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5.2"/><circle cx="12" cy="7.9" r=".85" fill="currentColor" stroke="none"/>',
  'ui-star':
    '<path d="m12 3.6 2.65 5.66 5.95.83-4.3 4.36 1.02 6.15L12 17.7l-5.32 2.9 1.02-6.15-4.3-4.36 5.95-.83Z"/>',
  'ui-star-filled':
    '<path d="m12 3.6 2.65 5.66 5.95.83-4.3 4.36 1.02 6.15L12 17.7l-5.32 2.9 1.02-6.15-4.3-4.36 5.95-.83Z" fill="currentColor"/>',
  'ui-heart':
    '<path d="M12 20.4 4.7 13.1a4.8 4.8 0 0 1 0-6.8 4.8 4.8 0 0 1 6.8 0l.5.5.5-.5a4.8 4.8 0 0 1 6.8 0 4.8 4.8 0 0 1 0 6.8Z"/>',
  'ui-clock': '<circle cx="12" cy="12" r="8.6"/><path d="M12 6.9V12l3.5 2.2"/>',
  'ui-timer':
    '<circle cx="12" cy="13.8" r="7.4"/><path d="M12 9.8v4M9.4 2.8h5.2M18.8 7.2l1.4-1.4"/>',
  'ui-flame':
    '<path d="M12 21.2c3.5 0 6.2-2.6 6.2-6 0-4.8-4-6.6-4-10.6-2.3 1-3.6 3.2-3.6 5.3 0 1.2-.8 1.9-1.6 1.9s-1.3-.6-1.5-1.5c-1.1 1.2-1.7 3-1.7 4.9 0 3.4 2.7 6 6.2 6Z"/>',
  'ui-lock':
    '<rect x="4.8" y="10.2" width="14.4" height="10.2" rx="2.2"/><path d="M8.4 10.2V7.8a3.6 3.6 0 0 1 7.2 0v2.4"/>',
  'ui-user':
    '<circle cx="12" cy="8" r="3.8"/><path d="M4.8 20.4a7.2 7.2 0 0 1 14.4 0"/>',
  'ui-logout':
    '<path d="M14.2 3.6H6.6a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h7.6"/><path d="m16.6 8.2 3.8 3.8-3.8 3.8M20.4 12H9.8"/>',

  // ---------- Metiers ----------
  'ui-calendar':
    '<rect x="3.4" y="5.4" width="17.2" height="15.2" rx="2.4"/><path d="M3.4 10.2h17.2M8.2 3.4v4M15.8 3.4v4"/>',
  'ui-cart':
    '<path d="M2.8 4h2.5l2.6 11.4h9.8l2.3-8.2H6.2"/><circle cx="9.6" cy="19.2" r="1.5"/><circle cx="17.2" cy="19.2" r="1.5"/>',
  'ui-basket':
    '<path d="M3.4 9.6h17.2l-1.6 9a2.2 2.2 0 0 1-2.2 1.8H7.2A2.2 2.2 0 0 1 5 18.6Z"/><path d="m8.6 9.6 2.6-6M15.4 9.6l-2.6-6M9.8 13.2v3.4M14.2 13.2v3.4"/>',
  'ui-fridge':
    '<rect x="5.6" y="2.6" width="12.8" height="18.8" rx="2.4"/><path d="M5.6 10h12.8M8.8 6.2v2.2M8.8 12.4v2.6"/>',
  'ui-utensils':
    '<path d="M7.2 2.8v6.6a2.4 2.4 0 0 0 4.8 0V2.8M9.6 12v9.2M7.2 2.8v4.4M12 2.8v4.4"/><path d="M17.6 2.8c-1.7 1.5-2.6 3.5-2.6 5.9 0 1.9 1 3 2.6 3.3v9.2"/>',
  'ui-book':
    '<path d="M4.6 5A2.4 2.4 0 0 1 7 2.6h12.2a.8.8 0 0 1 .8.8v14.2a.8.8 0 0 1-.8.8H7A2.4 2.4 0 0 0 4.6 21Z"/><path d="M4.6 21a2.4 2.4 0 0 1 2.4-2.4h13"/><path d="M8.6 7.2h7.2M8.6 10.6h4.8"/>',
  'ui-scale':
    '<path d="M12 4.2v16M7.4 20.2h9.2M4.8 8.4h14.4"/><path d="M4.8 8.4 2.6 14a2.6 2.6 0 0 0 4.4 0Z"/><path d="M19.2 8.4 21.4 14a2.6 2.6 0 0 1-4.4 0Z"/>',
  'ui-chart':
    '<path d="M3.6 20.4h16.8"/><path d="M7 20.4v-6.6M12 20.4V7.4M17 20.4v-9.8"/>',
  'ui-price':
    '<circle cx="12" cy="12" r="8.6"/><path d="M15.6 8.6a4.2 4.2 0 0 0-6.2 1.3 4.9 4.9 0 0 0 .2 4.8 4.2 4.2 0 0 0 6 1"/><path d="M8 11h5.2M8 13.4h5.2"/>',
  'ui-tag':
    '<path d="M11.5 3.4H4.9a1.5 1.5 0 0 0-1.5 1.5v6.6c0 .4.2.8.4 1.1l7.6 7.6a1.5 1.5 0 0 0 2.2 0l6.4-6.4a1.5 1.5 0 0 0 0-2.2l-7.6-7.6a1.5 1.5 0 0 0-1.1-.6Z"/><circle cx="8.1" cy="8.1" r="1.4"/>',
  'ui-leaf':
    '<path d="M4.8 19.4C3.3 14.7 5.4 9 9.6 6.5c2.9-1.7 6.4-2 9.7-1.9.1 3.4-.5 7.2-2.4 10-2.6 3.9-7.9 5.3-12.1 4.8Z"/><path d="M18.8 5.2 7.2 16.8"/>',
  'ui-barcode':
    '<path d="M3.6 5.6v12.8M7.1 5.6v12.8M10.1 5.6v12.8M13.6 5.6v12.8M16.9 5.6v12.8M20.4 5.6v12.8"/>',
  'ui-camera':
    '<path d="M3.4 9a2.1 2.1 0 0 1 2.1-2.1h2.2l1.5-2.4h5.6l1.5 2.4h2.2A2.1 2.1 0 0 1 20.6 9v8.4a2.1 2.1 0 0 1-2.1 2.1H5.5a2.1 2.1 0 0 1-2.1-2.1Z"/><circle cx="12" cy="13.2" r="3.6"/>',
} as const
