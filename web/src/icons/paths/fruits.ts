/**
 * Fruits.
 *
 * Le piege de la famille : pomme, orange, peche, prune et tomate finissent
 * toutes en rond si on ne les distingue pas. Chacune porte donc un signe qui la
 * separe des autres a 20 px — l'echancrure et la queue penchee pour la pomme,
 * le pli vertical pour la peche et la prune, l'etoile de calice pour la tomate
 * (rangee avec les legumes), la feuille pointue pour l'orange.
 */

export const FRUIT_PATHS = {
  pomme:
    '<path d="M12 9.8c-1.3-1.2-3.2-1.3-4.5-.2-1.7 1.4-1.9 4.3-.7 6.8 1 2.3 2.6 4 3.7 4 .5 0 .9-.3 1.5-.3s1 .3 1.5.3c1.1 0 2.7-1.7 3.7-4 1.2-2.5 1-5.4-.7-6.8-1.3-1.1-3.2-1-4.5.2Z"/><path d="M12 9.6c-.4-2 .6-3.8 2.6-4.8"/>',
  poire:
    '<path d="M12 6.6c-1 1.6-1.4 3-2.6 4.4-1.6 1.8-2.6 3.6-2.6 5.4 0 2.8 2.4 4.8 5.2 4.8s5.2-2 5.2-4.8c0-1.8-1-3.6-2.6-5.4-1.2-1.4-1.6-2.8-2.6-4.4Z"/><path d="M12 6.6V4.2"/><path d="M12.2 5.4c1.2-1.4 2.8-1.9 4.6-1.6"/>',
  banane:
    '<path d="M5.2 6.4c-.9 0-1.4.7-1.3 1.7.6 6.2 5.8 11 12.1 11 1.9 0 3.3-.7 3.9-1.9.4-.8-.1-1.6-1-1.6-5.6 0-10.2-4.1-11.1-8.4-.2-1-.9-1.8-1.9-1.8Z"/><path d="M18.9 17.2c.6-.4 1.1-1 1.4-1.7"/>',
  orange:
    '<circle cx="12" cy="13.4" r="7"/><path d="M12 6.4V4.4"/><path d="M12.2 5.6c1.2-1.6 3-2.2 5-1.8.1 2-1.2 3.6-3.2 3.9Z"/><path d="M8.4 9.8c-1.2 1-1.9 2.4-2 4"/>',
  citron:
    '<path d="M5.6 17.6c-2-2-1.2-5.6 1.8-8.6 3-3 6.6-3.8 8.6-1.8s1.2 5.6-1.8 8.6c-3 3-6.6 3.8-8.6 1.8Z"/><path d="m5.4 17.8-1.6 1.6M18.6 4.6l-1.6 1.6"/>',
  pamplemousse:
    '<circle cx="12" cy="12" r="8.4"/><path d="M12 3.6v16.8M3.6 12h16.8M6 6l12 12M18 6 6 18"/><circle cx="12" cy="12" r="1.4"/>',
  fraise:
    '<path d="M12 21c-3.4-1.4-5.8-4.4-5.8-7.6 0-2.6 1.8-4.4 4.2-4.4.7 0 1.2.2 1.6.4.4-.2.9-.4 1.6-.4 2.4 0 4.2 1.8 4.2 4.4 0 3.2-2.4 6.2-5.8 7.6Z"/><path d="M12 9.4V6.6"/><path d="M8 6.4c1.2-1.4 2.6-2 4-2s2.8.6 4 2c-1 .8-2.4 1.2-4 1.2s-3-.4-4-1.2Z"/><circle cx="10.2" cy="13.2" r=".65" fill="currentColor" stroke="none"/><circle cx="13.8" cy="13.2" r=".65" fill="currentColor" stroke="none"/><circle cx="12" cy="16.2" r=".65" fill="currentColor" stroke="none"/>',
  framboise:
    '<circle cx="12" cy="9.8" r="2.5"/><circle cx="9.4" cy="13.8" r="2.5"/><circle cx="14.6" cy="13.8" r="2.5"/><circle cx="12" cy="17.6" r="2.5"/><path d="M12 7.3V5.2M9.4 4.6c1.6-1 3.6-1 5.2 0-.9 1.2-1.7 1.8-2.6 1.8s-1.7-.6-2.6-1.8Z"/>',
  myrtille:
    '<circle cx="12" cy="14.4" r="6.2"/><path d="M12 9.4v2.6M10 10.4l1.4 1.8M14 10.4l-1.4 1.8"/><circle cx="12" cy="12.4" r=".8"/>',
  cerise:
    '<circle cx="8.2" cy="17" r="3.4"/><circle cx="16.4" cy="16.2" r="3.4"/><path d="M8.2 13.6C9 9 12 5.4 17.2 4M16.4 12.8c-.6-3.4.2-6.4 2.4-8.4"/><path d="M15.2 3.4c1.6-.4 3 0 4.2 1.2-1.4.8-2.8 1-4.2.6Z"/>',
  raisin:
    '<circle cx="12" cy="9.6" r="2.1"/><circle cx="8.6" cy="12.8" r="2.1"/><circle cx="15.4" cy="12.8" r="2.1"/><circle cx="12" cy="13.6" r="2.1"/><circle cx="10.2" cy="16.8" r="2.1"/><circle cx="13.8" cy="16.8" r="2.1"/><path d="M12 7.5V4.6"/><path d="M12.2 5.6c1.4-1.6 3.2-2.2 5.2-1.8.1 2-1.4 3.6-3.4 3.9Z"/>',
  peche:
    '<circle cx="12" cy="13.4" r="7"/><path d="M12 6.6c-1.4 2-2.1 4.4-2.1 6.8s.7 4.8 2.1 6.8"/><path d="M12 6.4V4.4M12.2 5.6c1.2-1.6 3-2.2 5-1.8.1 2-1.2 3.6-3.2 3.9Z"/>',
  abricot:
    '<circle cx="12" cy="13.6" r="6.4"/><path d="M12 7.2c-1.2 1.8-1.9 4-1.9 6.4s.7 4.6 1.9 6.4"/><path d="M12 7.2V5.2"/>',
  prune:
    '<ellipse cx="12" cy="13.8" rx="6" ry="6.8"/><path d="M12 7c-1.2 2-1.8 4.4-1.8 6.8s.6 4.8 1.8 6.8"/><path d="M12 7V4.8M12.2 6c1.2-1.5 2.9-2 4.8-1.7"/>',
  ananas:
    '<path d="M12 8.4c-3.4 0-5.8 2.4-5.8 6 0 3.8 2.6 6.8 5.8 6.8s5.8-3 5.8-6.8c0-3.6-2.4-6-5.8-6Z"/><path d="m7 12.6 5 5 5-5M7 17.6l5-5 5 5"/><path d="M12 8.4V3.4M9.4 8.2c-1.4-1.4-2-3-1.8-4.8 1.8.2 3.2 1.2 4 2.8M14.6 8.2c1.4-1.4 2-3 1.8-4.8-1.8.2-3.2 1.2-4 2.8"/>',
  mangue:
    '<path d="M6.4 17.8c-2.2-2.4-1.6-6.4 1.4-8.9 3-2.5 7-2.9 9.2-.8 2.2 2.1 1.8 6-1 8.6-2.8 2.6-7.4 3.5-9.6 1.1Z"/><path d="M16.8 7.6c.8-1.4 2-2.2 3.6-2.4"/>',
  kiwi: '<circle cx="12" cy="12" r="8.4"/><circle cx="12" cy="12" r="2.6"/><path d="M12 6.2v1.4M12 16.4v1.4M6.2 12h1.4M16.4 12h1.4M8.1 8.1l1 1M14.9 14.9l1 1M15.9 8.1l-1 1M9.1 14.9l-1 1"/>',
  melon:
    '<circle cx="12" cy="12.4" r="8"/><path d="M12 4.4c-2.4 2.2-3.8 5-3.8 8s1.4 5.8 3.8 8M12 4.4c2.4 2.2 3.8 5 3.8 8s-1.4 5.8-3.8 8"/>',
  pasteque:
    '<path d="M3.8 8.2h16.4a8.2 8.2 0 0 1-16.4 0Z"/><path d="M5 9.6a7.4 7.4 0 0 0 14 0"/><circle cx="10" cy="13.4" r=".7" fill="currentColor" stroke="none"/><circle cx="14" cy="13.4" r=".7" fill="currentColor" stroke="none"/><circle cx="12" cy="15.8" r=".7" fill="currentColor" stroke="none"/>',
  figue:
    '<path d="M12 5.6c-3.2 3-5.6 6.2-5.6 9.2 0 3.4 2.6 5.8 5.6 5.8s5.6-2.4 5.6-5.8c0-3-2.4-6.2-5.6-9.2Z"/><path d="M12 5.6V3.6M12.2 4.8c1.2-1.2 2.6-1.6 4.2-1.4"/>',
  grenade:
    '<circle cx="12" cy="14" r="6.6"/><path d="M12 7.4V5M10 3.6l2 1.6 2-1.6"/><circle cx="10.2" cy="13" r=".7" fill="currentColor" stroke="none"/><circle cx="13.8" cy="13" r=".7" fill="currentColor" stroke="none"/><circle cx="12" cy="16" r=".7" fill="currentColor" stroke="none"/>',
  'noix-de-coco':
    '<circle cx="12" cy="12" r="8.4"/><circle cx="9.4" cy="10.2" r=".9" fill="currentColor" stroke="none"/><circle cx="14.6" cy="10.2" r=".9" fill="currentColor" stroke="none"/><circle cx="12" cy="14.4" r=".9" fill="currentColor" stroke="none"/>',
  datte:
    '<path d="M7.4 18.6c-1.6-1.6-.8-4.8 1.8-7.4 2.6-2.6 5.8-3.4 7.4-1.8 1.6 1.6.8 4.8-1.8 7.4-2.6 2.6-5.8 3.4-7.4 1.8Z"/><path d="m17.4 8.8 1.6-1.6"/>',
} as const
