/**
 * Epicerie : huiles, condiments, conserves, sucres.
 *
 * Deux bouteilles, un bocal, une boite : ces quatre contenants couvrent la
 * majorite du rayon. Ce qui les separe tient a un detail interne (la goutte de
 * l'huile, la bande d'etiquette du vinaigre, le bouchon conique de la sauce),
 * pas a la silhouette — c'est suffisant a 24 px et ca garde la famille unie.
 */

export const EPICERIE_PATHS = {
  huile:
    '<path d="M10.2 3.4h3.6v3l1.8 2.8v9.6a2.2 2.2 0 0 1-2.2 2.2h-2.8A2.2 2.2 0 0 1 8.4 18.8V9.2l1.8-2.8Z"/><path d="M12 12.2c-1 1.2-1.6 2.2-1.6 3 0 .9.7 1.6 1.6 1.6s1.6-.7 1.6-1.6c0-.8-.6-1.8-1.6-3Z"/>',
  vinaigre:
    '<path d="M10.2 3.4h3.6v3l1.8 2.8v9.6a2.2 2.2 0 0 1-2.2 2.2h-2.8A2.2 2.2 0 0 1 8.4 18.8V9.2l1.8-2.8Z"/><path d="M8.4 12.4h7.2v4H8.4Z"/>',
  sauce:
    '<path d="M10.4 2.6h3.2v2.2l1.4 2.8v11.6a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V7.6Z"/><path d="M9 11.6h6"/>',
  bocal:
    '<path d="M7 9.4h10v9.8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z"/><rect x="8.4" y="4.6" width="7.2" height="3.4" rx="1"/><path d="M7 9.4V8.6a.6.6 0 0 1 .6-.6h8.8a.6.6 0 0 1 .6.6v.8"/><path d="M9.6 13.6h4.8"/>',
  conserve:
    '<path d="M6.4 6.6c0-1.2 2.5-2.2 5.6-2.2s5.6 1 5.6 2.2v10.8c0 1.2-2.5 2.2-5.6 2.2s-5.6-1-5.6-2.2Z"/><path d="M6.4 6.6c0 1.2 2.5 2.2 5.6 2.2s5.6-1 5.6-2.2"/><path d="M6.4 11h11.2M6.4 15h11.2"/>',
  sachet:
    '<path d="M5.6 5.4h12.8v13.2a2 2 0 0 1-2 2H7.6a2 2 0 0 1-2-2Z"/><path d="M5.6 8.6h12.8"/><path d="M8.4 4.2v1.2M12 4.2v1.2M15.6 4.2v1.2"/>',
  miel: '<path d="M12 3.6 19.2 7.8v8.4L12 20.4 4.8 16.2V7.8Z"/><path d="M12 8.4l3.6 2.1v4.2L12 16.8l-3.6-2.1v-4.2Z"/>',
  sucre:
    '<rect x="4.4" y="10.6" width="7.4" height="7.4" rx="1.2"/><rect x="12.6" y="10.6" width="7" height="7.4" rx="1.2"/><rect x="8.4" y="4.6" width="7.4" height="5.8" rx="1.2"/>',
  chocolat:
    '<rect x="4.6" y="6.4" width="14.8" height="11.2" rx="1.8"/><path d="M9.6 6.4v11.2M14.4 6.4v11.2M4.6 12h14.8"/>',
} as const
