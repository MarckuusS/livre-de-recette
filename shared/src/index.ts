/**
 * Couche metier partagee entre le Worker et le front.
 *
 * Elle est PURE : aucun acces base, aucun reseau, aucune API navigateur. C'est
 * ce qui permet de l'executer des deux cotes et de la tester sans harnais.
 * Equivalent de app/domain/ cote Python, dont elle reprend les formules.
 */

export * from './models.js'
export * from './units.js'
export * from './nutrition.js'
export * from './pricing.js'
export * from './shopping.js'
export * from './isoweek.js'
export * from './text.js'
export * from './svg.js'
export * from './password.js'
