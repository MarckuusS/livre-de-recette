"""QAbstractListModel subclasses bridging Pydantic domain models to QML ListView.

These models are owned by the viewmodels (composition, not inheritance) so the
viewmodels keep their imperative Python-friendly API for tests / scripts, while
QML gets an efficient model with per-row change notifications.
"""

from .ingredient_list_model import IngredientListModel
from .meal_plan_model import MealPlanModel
from .pantry_list_model import PantryListModel, PantryRow
from .recipe_list_model import RecipeListModel
from .shopping_list_model import ShoppingListModel

__all__ = [
    "IngredientListModel",
    "MealPlanModel",
    "PantryListModel",
    "PantryRow",
    "RecipeListModel",
    "ShoppingListModel",
]
