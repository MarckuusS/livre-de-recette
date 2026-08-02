/**
 * Point d'acces unique aux donnees.
 *
 * Un repository par domaine, agrege ici. Le decoupage suit celui du desktop
 * (`app/data/repositories/`) et sert le meme but : un fichier unique de 1 500
 * lignes de SQL devient impossible a modifier a plusieurs sans conflits.
 *
 * L'instance est construite a chaque requete — un Worker n'a pas d'etat
 * partage fiable entre invocations, et D1 ne coute rien a « ouvrir ».
 */

import { CalendarRepo } from './calendar.js'
import { IngredientRepo } from './ingredients.js'
import { PantryRepo } from './pantry.js'
import { RecipeRepo } from './recipes.js'
import { SettingsRepo } from './settings.js'

export class Repositories {
  readonly ingredients: IngredientRepo
  readonly recipes: RecipeRepo
  readonly calendar: CalendarRepo
  readonly pantry: PantryRepo
  readonly settings: SettingsRepo

  constructor(db: D1Database) {
    this.ingredients = new IngredientRepo(db)
    // Les recettes chargent leurs ingredients : la dependance est explicite
    // plutot que dupliquee, sinon deux chemins liraient la meme table
    // differemment.
    this.recipes = new RecipeRepo(db, this.ingredients)
    this.calendar = new CalendarRepo(db)
    this.pantry = new PantryRepo(db)
    this.settings = new SettingsRepo(db)
  }
}

export { CalendarRepo, IngredientRepo, PantryRepo, RecipeRepo, SettingsRepo }
export type { EntryWrite } from './calendar.js'
export type { IngredientUsage, IngredientWrite } from './ingredients.js'
export type { RecipeLineWrite, RecipeSummary, RecipeWrite } from './recipes.js'
