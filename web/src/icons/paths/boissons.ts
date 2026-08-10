/**
 * Boissons.
 *
 * La goutte pour l'eau plutot qu'une enieme bouteille : elle se distingue au
 * premier coup d'oeil de l'huile et du vinaigre, qui occupent deja la silhouette
 * « bouteille » dans l'epicerie.
 */

export const BOISSON_PATHS = {
  eau: '<path d="M12 3.2 6.8 11.4a6.2 6.2 0 1 0 10.4 0Z"/>',
  verre:
    '<path d="M6.4 4.6h11.2l-1.4 15.2a1.6 1.6 0 0 1-1.6 1.4H9.4a1.6 1.6 0 0 1-1.6-1.4Z"/><path d="M7.2 12.6h9.6"/>',
  jus: '<path d="M6.6 7.4h10.8l-1.2 12.2a1.6 1.6 0 0 1-1.6 1.4H9.4a1.6 1.6 0 0 1-1.6-1.4Z"/><path d="m14.6 7.4 3-4.4"/><path d="M7 11.4h10"/>',
  soda: '<path d="M7.4 5.2c0-.9 2.1-1.6 4.6-1.6s4.6.7 4.6 1.6v13.6c0 .9-2.1 1.6-4.6 1.6s-4.6-.7-4.6-1.6Z"/><path d="M7.4 5.2c0 .9 2.1 1.6 4.6 1.6s4.6-.7 4.6-1.6"/><path d="M7.4 9.6h9.2"/>',
  cafe: '<path d="M4.6 9.4h11.2v6.2a4.4 4.4 0 0 1-4.4 4.4H9a4.4 4.4 0 0 1-4.4-4.4Z"/><path d="M15.8 10.8h1.4a2.6 2.6 0 0 1 0 5.2h-1.4"/><path d="M8 6.6c-.7-1.1-.7-2.1 0-3.2M12 6.6c-.7-1.1-.7-2.1 0-3.2"/>',
  the: '<path d="M5.4 8.6h10.2v7a4.4 4.4 0 0 1-4.4 4.4H9.8a4.4 4.4 0 0 1-4.4-4.4Z"/><path d="M15.6 10h1.6a2.4 2.4 0 0 1 0 4.8h-1.6"/><path d="M10.4 8.6V4.8h3.2v2.4"/>',
  vin: '<path d="M6.8 3.6h10.4c0 4.8-2.1 8-5.2 8.6-3.1-.6-5.2-3.8-5.2-8.6Z"/><path d="M12 12.2v7.4M8.6 20.4h6.8"/>',
  biere:
    '<path d="M6.4 6.6h9.2v12.8a2 2 0 0 1-2 2H8.4a2 2 0 0 1-2-2Z"/><path d="M15.6 8.8h1.8a2.4 2.4 0 0 1 2.4 2.4v2.4a2.4 2.4 0 0 1-2.4 2.4h-1.8"/><path d="M6.4 9.8h9.2"/>',
} as const
