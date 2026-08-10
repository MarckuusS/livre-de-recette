/**
 * Viandes, volailles, poissons, fruits de mer et oeufs.
 *
 * Le pilon de poulet, le steak et la darne de saumon sont dessines a la piece
 * plutot qu'en barquette : c'est ce que l'on cherche des yeux dans une liste,
 * et une barquette ressemble a toutes les autres barquettes.
 */

export const PROTEINE_PATHS = {
  // Piece de viande : masse irreguliere, liseret de gras suivant le bord haut,
  // une seule marbrure. Deux arcs concentriques dans un rond donnaient une onde.
  boeuf:
    '<path d="M5.2 10.2c1.8-3 5.4-4.8 9.2-4.4 4.2.5 6.8 3.6 6.2 7.2-.6 3.6-4 6.4-8.2 6.6-2.6.2-4.9-.7-6.4-2.2-1.8-1.8-2.2-4.6-.8-7.2Z"/><path d="M7.4 10.6c1.5-2 4-3.1 6.8-2.8"/><path d="M10.6 14.4c1.4-1.2 3.4-1 4.6.4"/>',
  'steak-hache':
    '<ellipse cx="12" cy="12" rx="8.2" ry="5.4"/><path d="M7.4 10.6c1-.8 2.4-.8 3.4 0M13.4 13.6c1-.8 2.4-.8 3.4 0M10.4 14c.8-.6 1.8-.6 2.6 0"/>',
  poulet:
    '<circle cx="15.4" cy="8.6" r="5.2"/><path d="m11.7 12.3-4.1 4.1"/><circle cx="8.7" cy="17.7" r="2.1"/><circle cx="6.5" cy="15.5" r="2.1"/>',
  filet:
    '<path d="M6.2 16.4c-1.8-2.6-.8-6.4 2.4-8.8 3.2-2.4 7.4-2.6 9.6-.4 2.2 2.2 1.6 6-1.4 8.4-3 2.4-8.6 3.6-10.6.8Z"/><path d="M9.4 12.4c1.6-1.2 3.4-1.8 5.4-1.8"/>',
  // Deux tranches empilees, et non une tranche unique : seule vue de dessus,
  // elle se lisait comme une cible.
  jambon:
    '<path d="M4.6 10.4c0-2.5 3.3-4.6 7.4-4.6s7.4 2.1 7.4 4.6-3.3 4.6-7.4 4.6-7.4-2.1-7.4-4.6Z"/><path d="M4.6 13.6v1.8c0 2.5 3.3 4.6 7.4 4.6s7.4-2.1 7.4-4.6v-1.8"/>',
  // Horizontale et segmentee, la ou la baguette est diagonale et entaillee :
  // la meme capsule inclinee servait aux deux et on ne les distinguait plus.
  saucisse:
    '<path d="M4.4 12c0-2.4 1.9-4.3 4.3-4.3h6.6c2.4 0 4.3 1.9 4.3 4.3s-1.9 4.3-4.3 4.3H8.7A4.3 4.3 0 0 1 4.4 12Z"/><path d="M9.8 7.9v8.2M14.2 7.9v8.2"/><path d="M4.4 12H2.8M19.6 12h1.6"/>',
  lardons:
    '<rect x="4.4" y="6.4" width="5.6" height="4" rx="1"/><rect x="12.6" y="5" width="5.6" height="4" rx="1"/><rect x="8.2" y="12.4" width="5.6" height="4" rx="1"/><rect x="14.8" y="13" width="5.2" height="4" rx="1"/><rect x="4.6" y="16.6" width="5.6" height="4" rx="1"/>',
  poisson:
    '<path d="M20.4 12c-1.7 2.6-4.7 4.4-8.2 4.4-2.6 0-5-1-6.8-2.6l-2.6 2.4V7.8l2.6 2.4c1.8-1.6 4.2-2.6 6.8-2.6 3.5 0 6.5 1.8 8.2 4.4Z"/><circle cx="16.4" cy="10.8" r=".85" fill="currentColor" stroke="none"/><path d="M12.6 8.4c-.6 2.4-.6 4.8 0 7.2"/>',
  saumon:
    '<path d="M4.4 16.6c0-4.2 4-8.4 9-9.4 2.4-.5 4.6.2 5.6 1.8 1.1 1.8.3 4.2-1.8 6.2-2.6 2.4-6.6 4-9.6 4-2 0-3.2-1-3.2-2.6Z"/><path d="M7.4 15.4c2.6-.6 5-2 6.8-4M9 18c2.6-.8 4.8-2.2 6.4-4"/>',
  crevette:
    '<path d="M17.6 6.4c-5.4 0-9.8 4.4-9.8 9.8 0 2.2 1.4 3.6 3.4 3.6 3.4 0 6-2.6 6-6"/><path d="M17.6 6.4c1.4 0 2.6.6 3.4 1.6M17.6 6.4 20 4M17.6 6.4l1.4-3M7.8 16.2c-1.6 0-2.8-1-3.4-2.4"/>',
  coquillage:
    '<path d="M4.6 9.4c4.4-1.4 9.6-1.4 14.8 0 .8 4.4-2.4 9.4-7.4 11.2-5-1.8-8.2-6.8-7.4-11.2Z"/><path d="M12 20.6V9M8.6 9.6c-.4 3.8.6 7.4 2.8 10.4M15.4 9.6c.4 3.8-.6 7.4-2.8 10.4"/>',
  moule:
    '<path d="M4.6 16.4c0-2.6 1.6-5.6 4.2-7.8 2.6-2.2 5.8-3.4 8.2-3.2.8 2.4-.2 5.8-2.6 8.4-2.4 2.6-5.8 4.2-8.4 4.2-1 0-1.4-.6-1.4-1.6Z"/><path d="M17 5.4c-2.4 2-4.4 4.4-5.8 7M4.8 15.4c2.4-.4 4.6-1.4 6.4-2.8"/>',
  oeuf: '<path d="M12 3.6c-3.6 3-6 7.2-6 10.8 0 3.9 2.7 6.6 6 6.6s6-2.7 6-6.6c0-3.6-2.4-7.8-6-10.8Z"/>',
  oeufs:
    '<path d="M8.6 5.6c-2.4 2-4 4.8-4 7.2 0 2.6 1.8 4.4 4 4.4s4-1.8 4-4.4c0-2.4-1.6-5.2-4-7.2Z"/><path d="M16.4 9c-1.8 1.6-3 3.6-3 5.4 0 2 1.4 3.4 3 3.4s3-1.4 3-3.4c0-1.8-1.2-3.8-3-5.4Z"/>',
} as const
