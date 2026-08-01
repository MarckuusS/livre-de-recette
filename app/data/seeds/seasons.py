"""Seasonality data for ~50 common French ingredients (C3).

Used at `init_schema()` time to stamp `ingredient.season_months` on rows
whose `name` starts with one of the patterns below — case-insensitive,
prefix match (so "Tomate" hits "Tomate, crue", "Tomate, en conserve", etc.).

Months are 1..12 (1=janvier). The list reflects French seasonal availability
(Côte-d'Or context — locally-grown produce). Greenhouse / imported availability
is intentionally ignored : the goal is to encourage saisonalité, not to
report supermarket year-round shelves.

Sources : Greenpeace France calendrier de saison + ADEME. Approximations
acceptable for a personal cookbook.

The user can override any value by editing the ingredient row directly. The
seeder respects existing values (`WHERE season_months IS NULL`) — a re-run
of `init_schema()` is a no-op for already-set rows.
"""

from __future__ import annotations

# Tuple form (csv, comment) but we only persist the csv. Keys are lowercase
# prefixes (CIQUAL convention : "Tomate", "Pomme", "Carotte", …).
SEASONS_BY_NAME: dict[str, str] = {
    # ---- Légumes ----
    "ail":              "6,7,8,9,10,11,12,1,2",
    "artichaut":        "5,6,7,8,9,10",
    "asperge":          "4,5,6",
    "aubergine":        "7,8,9,10",
    "betterave":        "6,7,8,9,10,11,12",
    "blette":           "6,7,8,9,10,11",
    "brocoli":          "9,10,11,12,1,2,3",
    "carotte":          "1,2,3,4,5,6,7,8,9,10,11,12",  # toute l'année (stockage)
    "céleri":           "8,9,10,11,12,1,2",
    "chou":             "9,10,11,12,1,2,3,4",
    "concombre":        "5,6,7,8,9",
    "courge":           "9,10,11,12",
    "courgette":        "5,6,7,8,9,10",
    "endive":           "10,11,12,1,2,3,4",
    "épinard":          "3,4,5,6,9,10,11",
    "fenouil":          "5,6,7,8,9,10,11",
    "haricot vert":     "6,7,8,9",
    "navet":            "9,10,11,12,1,2,3,4",
    "oignon":           "1,2,3,4,5,6,7,8,9,10,11,12",  # toute l'année
    "panais":           "10,11,12,1,2,3",
    "petit pois":       "5,6,7",
    "poireau":          "9,10,11,12,1,2,3,4,5",
    "poivron":          "6,7,8,9,10",
    "pomme de terre":   "1,2,3,4,5,6,7,8,9,10,11,12",
    "potiron":          "9,10,11,12,1",
    "radis":            "3,4,5,6,7,8,9,10",
    "salade":           "4,5,6,7,8,9,10",
    "tomate":           "6,7,8,9,10",

    # ---- Fruits ----
    "abricot":          "6,7,8",
    "cerise":           "5,6,7",
    "citron":           "11,12,1,2,3,4",
    "clémentine":       "11,12,1",
    "fraise":           "4,5,6,7",
    "framboise":        "6,7,8,9",
    "kiwi":             "11,12,1,2,3",
    "mangue":           "12,1,2,3",   # importée — saison hivernale
    "melon":            "6,7,8,9",
    "mirabelle":        "8,9",
    "myrtille":         "7,8,9",
    "nectarine":        "6,7,8,9",
    "orange":           "11,12,1,2,3,4",
    "pamplemousse":     "11,12,1,2,3,4",
    "pêche":            "6,7,8,9",
    "poire":            "8,9,10,11,12,1",
    "pomme":            "8,9,10,11,12,1,2,3,4",
    "prune":            "7,8,9",
    "raisin":           "8,9,10",
    "rhubarbe":         "4,5,6,7",

    # ---- Champignons ----
    "champignon de Paris": "1,2,3,4,5,6,7,8,9,10,11,12",
    "cèpe":             "9,10,11",
    "girolle":          "6,7,8,9,10",

    # ---- Aromates frais ----
    "basilic":          "5,6,7,8,9",
    "ciboulette":       "4,5,6,7,8,9",
    "menthe":           "5,6,7,8,9,10",
    "persil":           "1,2,3,4,5,6,7,8,9,10,11,12",
    "thym":             "1,2,3,4,5,6,7,8,9,10,11,12",
}
