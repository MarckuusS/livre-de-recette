/**
 * Feculents, cereales, legumineuses et oleagineux.
 *
 * Riz, lentilles et pois chiches arrivent dans la liste de courses sous forme
 * de paquets, mais un paquet ne se distingue pas d'un autre paquet : la famille
 * dessine donc l'aliment, pas son emballage. Seul le riz fait exception avec
 * son bol, parce qu'un tas de grains ovales se confond avec les lentilles.
 */

export const FECULENT_PATHS = {
  riz: '<path d="M3.4 11.6h17.2c0 4.8-3.9 8.6-8.6 8.6s-8.6-3.8-8.6-8.6Z"/><path d="M2.6 11.6h18.8"/><ellipse cx="9" cy="8" rx="2" ry="1.2"/><ellipse cx="13.6" cy="6.6" rx="2" ry="1.2"/><ellipse cx="15.4" cy="9.4" rx="2" ry="1.2"/>',
  pates:
    '<path d="M6.4 20.8c-1.2-4.8-.8-9.6 1.2-14.4M10.2 20.8c-1-5-.4-9.8 1.8-14.4M14 20.8c-.8-5 .2-9.8 2.4-14.2M17.6 20.8c-.6-4.6.6-9 2.8-13"/>',
  macaroni:
    '<path d="M6.4 5.6c5.6 0 10.2 4.6 10.2 10.2 0 1.6-1.3 2.9-2.9 2.9s-2.9-1.3-2.9-2.9c0-2.4-2-4.4-4.4-4.4-1.6 0-2.9-1.3-2.9-2.9s1.3-2.9 2.9-2.9Z"/>',
  pain: '<path d="M4.6 11c0-3.6 3.3-6 7.4-6s7.4 2.4 7.4 6v7.4a2 2 0 0 1-2 2H6.6a2 2 0 0 1-2-2Z"/><path d="M8.8 5.4v15"/>',
  'pain-de-mie':
    '<path d="M5.4 10.4c0-2.6 2.2-4.2 4.4-4.2h4.4c2.2 0 4.4 1.6 4.4 4.2v8a1.8 1.8 0 0 1-1.8 1.8H7.2a1.8 1.8 0 0 1-1.8-1.8Z"/><path d="M5.4 13.6h13.2"/>',
  baguette:
    '<path d="M18.7 5.3a2.2 2.2 0 0 1 0 3.1L8.4 18.7a2.2 2.2 0 1 1-3.1-3.1L15.6 5.3a2.2 2.2 0 0 1 3.1 0Z"/><path d="m8.6 9.6 1.6 1.6M11.4 12.4l1.6 1.6M14.2 15.2l1.6 1.6"/>',
  farine:
    '<path d="M6.6 9.4c0-2 1.4-3 2.6-4 .8-.7 1.2-1.6 1.2-2.4h3.2c0 .8.4 1.7 1.2 2.4 1.2 1 2.6 2 2.6 4v9.8a2 2 0 0 1-2 2H8.6a2 2 0 0 1-2-2Z"/><path d="M9.4 14.4h5.2"/>',
  cereales:
    '<path d="M12 21V4.6"/><path d="M12 9.2c-2 0-3.4-1.4-3.4-3.4 2 0 3.4 1.4 3.4 3.4ZM12 9.2c2 0 3.4-1.4 3.4-3.4-2 0-3.4 1.4-3.4 3.4ZM12 13.4c-2 0-3.4-1.4-3.4-3.4 2 0 3.4 1.4 3.4 3.4ZM12 13.4c2 0 3.4-1.4 3.4-3.4-2 0-3.4 1.4-3.4 3.4ZM12 17.6c-2 0-3.4-1.4-3.4-3.4 2 0 3.4 1.4 3.4 3.4ZM12 17.6c2 0 3.4-1.4 3.4-3.4-2 0-3.4 1.4-3.4 3.4Z"/>',
  lentilles:
    '<ellipse cx="8" cy="9" rx="2.6" ry="1.6"/><ellipse cx="15" cy="8" rx="2.6" ry="1.6"/><ellipse cx="11.6" cy="13" rx="2.6" ry="1.6"/><ellipse cx="17.2" cy="13.4" rx="2.6" ry="1.6"/><ellipse cx="7.4" cy="16.4" rx="2.6" ry="1.6"/><ellipse cx="13.8" cy="18" rx="2.6" ry="1.6"/>',
  'pois-chiche':
    '<circle cx="8.6" cy="10" r="3.2"/><circle cx="15.6" cy="9.4" r="3.2"/><circle cx="12" cy="16" r="3.2"/><path d="M8.6 6.8V5.4M15.6 6.2V4.8M12 12.8v-1.4"/>',
  'haricot-sec':
    '<path d="M9.6 6.4c2.6 0 4.6 2.2 4.6 5s-2 5-4.6 5c-1.4 0-2.2-.8-2.2-1.8 0-1.4 1.6-1.6 1.6-3.2s-1.6-1.8-1.6-3.2c0-1 .8-1.8 2.2-1.8Z"/><path d="M17 12.4c1.8 0 3.2 1.6 3.2 3.6s-1.4 3.6-3.2 3.6c-1 0-1.6-.6-1.6-1.3 0-1 1.2-1.2 1.2-2.3s-1.2-1.3-1.2-2.3c0-.7.6-1.3 1.6-1.3Z"/>',
  // Les quatre arcs internes de la version precedente dessinaient un visage :
  // deux cerneaux symetriques disent la meme chose sans l'effet de pareidolie.
  noix: '<circle cx="12" cy="12" r="8.2"/><path d="M12 3.8v16.4"/><path d="M9.6 6.6c-1.8 1.4-2.8 3.2-2.8 5.4s1 4 2.8 5.4M14.4 6.6c1.8 1.4 2.8 3.2 2.8 5.4s-1 4-2.8 5.4"/>',
  amande:
    '<path d="M12 3.8c-3.4 2.6-5.4 6.2-5.4 9.8 0 4.2 2.4 7 5.4 7s5.4-2.8 5.4-7c0-3.6-2-7.2-5.4-9.8Z"/><path d="M12 6.4v13"/>',
  noisette:
    '<circle cx="12" cy="14.4" r="6"/><path d="M6.6 11.8c1.6-1.4 3.4-2 5.4-2s3.8.6 5.4 2"/><path d="M12 9.8V6.4M9.6 5.4c1.6-.8 3.2-.8 4.8 0-.7 1.4-1.5 2-2.4 2s-1.7-.6-2.4-2Z"/>',
  cacahuete:
    '<path d="M12 3.6c2.6 0 4.6 2 4.6 4.4 0 1.6-.8 2.6-.8 3.8s.8 2.2.8 3.8c0 2.4-2 4.8-4.6 4.8s-4.6-2.4-4.6-4.8c0-1.6.8-2.6.8-3.8s-.8-2.2-.8-3.8C7.4 5.6 9.4 3.6 12 3.6Z"/><path d="M8.4 11.8h7.2"/>',
} as const
