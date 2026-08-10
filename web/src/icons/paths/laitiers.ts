/**
 * Produits laitiers.
 *
 * Bouteille pour le lait, brique pour ce qui se verse et se conserve au frais,
 * pot pour ce qui se cuillere : la silhouette du contenant porte ici plus
 * d'information que le contenu, parce que c'est sous cette forme que le produit
 * existe en rayon comme au frigo.
 */

export const LAITIER_PATHS = {
  lait: '<path d="M9.4 3.4h5.2v3.2l1.8 3v9.6a2.2 2.2 0 0 1-2.2 2.2H9.8a2.2 2.2 0 0 1-2.2-2.2V9.6l1.8-3Z"/><path d="M7.6 13h8.8"/>',
  brique:
    '<path d="M6.8 8.6 12 3.4l5.2 5.2v10.6a1.8 1.8 0 0 1-1.8 1.8H8.6a1.8 1.8 0 0 1-1.8-1.8Z"/><path d="M6.8 8.6h10.4"/>',
  creme:
    '<path d="M7 6.6h10v12.8a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2Z"/><path d="M9.4 6.6V4a1.4 1.4 0 0 1 1.4-1.4h2.4A1.4 1.4 0 0 1 14.6 4v2.6"/><path d="M7 11h10"/>',
  beurre:
    '<rect x="3.6" y="8.6" width="16.8" height="8" rx="1.4"/><path d="M9 8.6v8M9 12.6h11.4"/>',
  yaourt:
    '<path d="M7 8.4h10l-1 11a2 2 0 0 1-2 1.8h-4a2 2 0 0 1-2-1.8Z"/><path d="M5.8 8.4h12.4a.8.8 0 0 0 .8-.8V6.4a.8.8 0 0 0-.8-.8H5.8a.8.8 0 0 0-.8.8v1.2a.8.8 0 0 0 .8.8Z"/>',
  fromage:
    '<path d="M3.6 12.6 16.4 6.2a1.4 1.4 0 0 1 2 1.2v9.4a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2Z"/><circle cx="8.4" cy="15.4" r="1.2"/><circle cx="13.6" cy="13.4" r="1.2"/><circle cx="14.8" cy="16.8" r="1"/>',
  'fromage-meule':
    '<ellipse cx="12" cy="9.4" rx="8.2" ry="3.4"/><path d="M3.8 9.4v5.2c0 1.9 3.7 3.4 8.2 3.4s8.2-1.5 8.2-3.4V9.4"/>',
} as const
