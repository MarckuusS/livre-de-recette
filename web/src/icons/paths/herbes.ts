/**
 * Herbes, epices et assaisonnements secs.
 *
 * Les epices moulues sont indiscernables les unes des autres une fois
 * dessinees : paprika, curcuma et cumin donneraient trois fois le meme tas de
 * poudre. La famille ne cherche donc pas a les separer — `poudre` les couvre
 * toutes, et seules celles qui ont une forme propre (batons de cannelle,
 * rhizome de gingembre, gousse de vanille) ont leur icone.
 */

export const HERBE_PATHS = {
  herbes:
    '<path d="M12 21V7.4"/><path d="M12 16.4c-2.6 0-4.6-1.8-4.8-4.4 2.6-.4 4.6 1.2 4.8 4.4ZM12 16.4c2.6 0 4.6-1.8 4.8-4.4-2.6-.4-4.6 1.2-4.8 4.4ZM12 11.4c-2.2 0-3.9-1.6-4.1-3.8 2.2-.3 3.9 1 4.1 3.8ZM12 11.4c2.2 0 3.9-1.6 4.1-3.8-2.2-.3-3.9 1-4.1 3.8Z"/>',
  basilic:
    '<path d="M12 21v-8.6"/><path d="M12 12.4c-3.4-.6-5.4-3.2-5.2-6.8 3.6.2 5.6 2.8 5.2 6.8ZM12 12.4c3.4-.6 5.4-3.2 5.2-6.8-3.6.2-5.6 2.8-5.2 6.8Z"/>',
  persil:
    '<path d="M12 21v-7.6"/><circle cx="12" cy="7.4" r="2.6"/><circle cx="7.6" cy="10.4" r="2.6"/><circle cx="16.4" cy="10.4" r="2.6"/><path d="M12 13.4c-1.4-.8-2.6-1.6-3.4-2.6M12 13.4c1.4-.8 2.6-1.6 3.4-2.6"/>',
  ciboulette:
    '<path d="M8.4 20.6c-1.2-4.6-.8-9.2 1.2-13.8M12 20.6c-.4-5 .4-9.8 2.4-14.2M15.6 20.6c.4-4.4 1.8-8.4 4-11.8M6.6 20.6c-1.6-3.4-2-6.8-1.2-10.2"/>',
  thym: '<path d="M12.4 21c-.8-4.8-.4-9.6 1.2-14.4"/><path d="M13.4 8.4c1.4-1.4 3-2 4.8-1.8M12.8 11.4c1.6-1.2 3.4-1.6 5.2-1.2M12.2 14.4c1.6-1 3.4-1.2 5.2-.6M12.8 10.2c-1.4-1.2-2.2-2.6-2.4-4.2M12.2 13.2c-1.6-1-2.6-2.2-3-3.8M11.8 16.2c-1.6-.8-2.8-1.8-3.4-3.2"/>',
  romarin:
    '<path d="M12 21V4.4"/><path d="m12 8-3.2-2.4M12 8l3.2-2.4M12 11.6l-3.6-2.4M12 11.6l3.6-2.4M12 15.2l-3.8-2.4M12 15.2l3.8-2.4M12 18.4l-3.6-2.2M12 18.4l3.6-2.2"/>',
  laurier:
    '<path d="M6 18c-1.4-4.6.4-9.4 4.4-11.8 2.4-1.4 5.2-1.8 7.8-1.6.4 3-.2 6.4-1.8 8.8-2.4 3.6-6.6 5.2-10.4 4.6Z"/><path d="M17.4 5.2 6.4 17.6"/>',
  menthe:
    '<path d="M12 21v-7.8"/><path d="M11.6 13.4c-3.6 0-6-2.4-6-6 3.8-.6 6.2 1.6 6 6ZM12.4 13.4c3.6 0 6-2.4 6-6-3.8-.6-6.2 1.6-6 6Z"/><path d="M11.6 13.4 6.6 8.2M12.4 13.4l5-5.2"/>',
  coriandre:
    '<path d="M12 21v-6.6"/><path d="M12 14.4c-3.2 0-5.2-2-5.2-5.2 3.2-.4 5.2 1.4 5.2 5.2ZM12 14.4c3.2 0 5.2-2 5.2-5.2-3.2-.4-5.2 1.4-5.2 5.2ZM12 14.4c1.6-2.4 1.6-5.2 0-8.4-1.6 3.2-1.6 6 0 8.4Z"/>',
  poivre:
    '<path d="M9.4 3.6h5.2v2.6l1.4 2v9.6a2.2 2.2 0 0 1-2.2 2.2h-3.6A2.2 2.2 0 0 1 8 17.8V8.2l1.4-2Z"/><path d="M8 12h8M8 15.4h8"/><path d="M11 3.6V2.6h2v1"/>',
  sel: '<path d="M7.4 20.8h9.2a1.4 1.4 0 0 0 1.4-1.6l-1-8.6a5.1 5.1 0 0 0-10 0l-1 8.6a1.4 1.4 0 0 0 1.4 1.6Z"/><path d="M6.8 15.2h10.4"/><circle cx="10.2" cy="8.2" r=".7" fill="currentColor" stroke="none"/><circle cx="13.8" cy="8.2" r=".7" fill="currentColor" stroke="none"/><circle cx="12" cy="6.6" r=".7" fill="currentColor" stroke="none"/>',
  epices:
    '<path d="M6.6 9.4h10.8v10a2 2 0 0 1-2 2H8.6a2 2 0 0 1-2-2Z"/><rect x="8" y="4.4" width="8" height="3.4" rx="1.2"/><path d="M6.6 9.4V8.6a.8.8 0 0 1 .8-.8h9.2a.8.8 0 0 1 .8.8v.8"/><circle cx="10" cy="14" r=".7" fill="currentColor" stroke="none"/><circle cx="13.6" cy="13.2" r=".7" fill="currentColor" stroke="none"/><circle cx="12" cy="16.6" r=".7" fill="currentColor" stroke="none"/><circle cx="15" cy="16.8" r=".7" fill="currentColor" stroke="none"/><circle cx="9.2" cy="17.8" r=".7" fill="currentColor" stroke="none"/>',
  poudre:
    '<path d="M4 19.4c1.6-4 4.6-6.4 8-6.4s6.4 2.4 8 6.4Z"/><circle cx="8.6" cy="8.2" r=".7" fill="currentColor" stroke="none"/><circle cx="12" cy="5.8" r=".7" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.6" r=".7" fill="currentColor" stroke="none"/><circle cx="11.4" cy="9.6" r=".7" fill="currentColor" stroke="none"/><circle cx="14" cy="11" r=".7" fill="currentColor" stroke="none"/>',
  // Deux batons croises : seul et incline, l'un d'eux se lisait comme un crayon.
  cannelle:
    '<path d="M17.8 4.4a2.4 2.4 0 0 1 0 3.4L8 17.6a2.4 2.4 0 1 1-3.4-3.4L14.4 4.4a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.4 4.4 3.4 3.4"/><path d="M20.2 12.4a1.9 1.9 0 0 1 0 2.7l-4 4a1.9 1.9 0 1 1-2.7-2.7l4-4a1.9 1.9 0 0 1 2.7 0Z"/>',
  gingembre:
    '<path d="M5.4 15.6c-1.6-1.6-1.4-4 .4-5.4 1.4-1.1 3-1 4.2-.2.4-1.6 1.8-2.8 3.5-2.8 2 0 3.6 1.6 3.6 3.6 0 .5-.1 1-.3 1.4 1.7.5 2.8 2.1 2.6 3.9-.2 2-2 3.4-4 3.2-.6-.1-1.2-.3-1.7-.6-.7 1.2-2 2-3.5 2-2.2 0-4-1.8-4-4 0-.4.1-.8.2-1.1Z"/>',
  vanille:
    '<path d="M7.4 3.6c.7 0 1.1.6 1.1 1.4 0 5.4-.8 11-2 14.9-.2.7-1 .7-1.2 0C4.1 16 3.3 10.4 3.3 5c0-.8.4-1.4 1.1-1.4Z"/><path d="M17.4 5.6c.7 0 1.1.6 1.1 1.4 0 5-.8 10.2-2 13.8-.2.7-1 .7-1.2 0C14.1 17.2 13.3 12 13.3 7c0-.8.4-1.4 1.1-1.4Z"/>',
  graines:
    '<circle cx="8" cy="8.6" r="1.7"/><circle cx="14.6" cy="7.6" r="1.7"/><circle cx="11.4" cy="12.4" r="1.7"/><circle cx="17.2" cy="12.6" r="1.7"/><circle cx="7" cy="15" r="1.7"/><circle cx="13.4" cy="17.2" r="1.7"/>',
  bouillon:
    '<rect x="5.4" y="5.4" width="13.2" height="13.2" rx="2"/><path d="M5.4 12h13.2M12 5.4v13.2"/>',
} as const
