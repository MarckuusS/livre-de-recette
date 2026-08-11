/**
 * Registre unique des icones.
 *
 * Deux familles, et deux seulement : l'interface, et les rayons. Il n'y a
 * DELIBEREMENT pas d'icone par aliment. Un dessin par ingredient supposerait
 * d'en maintenir un pour chaque nouveau produit scanne, et de faire deviner a
 * une table de mots-cles ce que « Rigoni di Asiago - Nocciolata bio » contient.
 * Le rayon, lui, est une donnee que l'ingredient porte deja.
 *
 * Chaque valeur est le CONTENU d'un `<svg viewBox="0 0 24 24">` — jamais la
 * balise elle-meme. Les attributs communs (fill, stroke, epaisseur, jonctions)
 * sont poses une fois par `<Icon>`, ce qui garantit qu'aucune icone ne peut
 * deriver du systeme en redefinissant les siens.
 */

import { OVERRIDE_PATHS } from './paths/overrides.js'
import { RAYON_PATHS } from './paths/rayons.js'
import { UI_PATHS } from './paths/ui.js'

/*
 * `OVERRIDE_PATHS` vient EN DERNIER, et c'est ce qui lui donne son pouvoir : la
 * cle presente des deux cotes prend la version maison. `paths/ui.ts` et
 * `paths/rayons.ts` sont generes par scripts/import-lucide.mjs et reecrits a
 * chaque import ; `paths/overrides.ts` ne l'est pas.
 */
export const ICON_PATHS = {
  ...UI_PATHS,
  ...RAYON_PATHS,
  ...OVERRIDE_PATHS,
} as const

export type IconName = keyof typeof ICON_PATHS

/** Familles, pour la galerie de « Paramètres → Jeu d'icônes ». */
export const ICON_FAMILIES: ReadonlyArray<{ readonly title: string; readonly names: IconName[] }> = [
  { title: 'Rayons', names: Object.keys(RAYON_PATHS) as IconName[] },
  { title: 'Interface', names: Object.keys(UI_PATHS) as IconName[] },
]

export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[]

/** Vrai si la chaine designe une icone connue. Sert aux donnees non typees. */
export const isIconName = (value: string): value is IconName => value in ICON_PATHS
