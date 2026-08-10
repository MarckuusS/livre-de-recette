/**
 * Surgeles, sucre et plats prepares.
 *
 * Ce qui ne se ramene ni a un legume, ni a un contenant : ce qui arrive dans
 * l'assiette deja compose. La cloche du plat prepare sert aussi de repli visuel
 * pour une recette dans le planning de la semaine.
 */

export const DIVERS_PATHS = {
  glace:
    '<path d="M12 21.2 8 12.4h8Z"/><circle cx="9.8" cy="9.6" r="3.2"/><circle cx="14.2" cy="9.6" r="3.2"/><circle cx="12" cy="6.6" r="3.2"/>',
  sorbet:
    '<path d="M7 12h10l-1.2 7.2a1.6 1.6 0 0 1-1.6 1.4h-4.4a1.6 1.6 0 0 1-1.6-1.4Z"/><path d="M6.4 12a5.6 5.6 0 0 1 11.2 0"/><path d="M12 6.4V4"/>',
  esquimau:
    '<path d="M8.2 2.8h7.6a1.8 1.8 0 0 1 1.8 1.8v9.6a3.6 3.6 0 0 1-3.6 3.6h-4a3.6 3.6 0 0 1-3.6-3.6V4.6a1.8 1.8 0 0 1 1.8-1.8Z"/><path d="M12 17.8v3.4"/>',
  pizza:
    '<path d="M12 3.4 3.6 19.4a1 1 0 0 0 1.3 1.4c4.6-2 9.6-2 14.2 0a1 1 0 0 0 1.3-1.4Z"/><circle cx="10.4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="13.8" cy="14.6" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="17" r="1" fill="currentColor" stroke="none"/>',
  frites:
    '<path d="M6.6 10.4h10.8l-1.2 9.2a2 2 0 0 1-2 1.8h-4.4a2 2 0 0 1-2-1.8Z"/><path d="M8.4 10.4 7.6 3.6M11.2 10.4l-.4-7.6M14 10.4l.8-7.4M16.4 10.4l2-6.6"/>',
  soupe:
    '<path d="M3.6 11.6h16.8c0 4.6-3.8 8.4-8.4 8.4s-8.4-3.8-8.4-8.4Z"/><path d="M2.8 11.6h18.4"/><path d="M9 8.6c-.8-1.2-.8-2.4 0-3.6M13.4 8.6c-.8-1.2-.8-2.4 0-3.6"/>',
  'plat-prepare':
    '<path d="M3.4 18.6h17.2"/><path d="M5.2 18.6a6.8 6.8 0 0 1 13.6 0"/><path d="M12 11.8v-1.6"/><circle cx="12" cy="9" r="1.2"/>',
  gateau:
    '<path d="M4.6 12.8c0-1.4 1.1-2.4 2.4-2.4h10c1.3 0 2.4 1 2.4 2.4v6a2 2 0 0 1-2 2H6.6a2 2 0 0 1-2-2Z"/><path d="M4.6 15.6c1.2 0 1.2 1.4 2.5 1.4s1.2-1.4 2.5-1.4 1.2 1.4 2.4 1.4 1.2-1.4 2.5-1.4 1.2 1.4 2.5 1.4 1.2-1.4 2.4-1.4"/><path d="M12 10.4V7.6"/><circle cx="12" cy="6.2" r="1.2"/>',
  biscuit:
    '<circle cx="12" cy="12" r="8.4"/><circle cx="9.4" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.6" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="11" cy="15" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="15.4" r="1.1" fill="currentColor" stroke="none"/>',
} as const
