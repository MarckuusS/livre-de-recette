"""Tests for `RecipeUrlImportViewModel`.

We mock `fetch_recipe` (no real HTTP) and exercise the wizard slots
directly. Because the VM uses a worker thread internally, we drive the
extraction synchronously by calling its private `_do_extract` (which
emits the cross-thread signals through Qt — pytest-qt processes those
events in the main thread)."""

from __future__ import annotations

from PySide6.QtTest import QSignalSpy

from app.data.repositories import IngredientRepo, RecipeRepo
from app.domain.models import Ingredient, Source
from app.domain.url_recipe import ExtractedIngredient, ExtractedRecipe
from app.services.recipe_url_importer import RecipeImportError
from app.ui.viewmodels.recipe_url_import_vm import RecipeUrlImportViewModel


def _seed_personal(ctx, name, source=Source.MANUAL, source_ref=None):
    with ctx.session() as s:
        repo = IngredientRepo(s)
        ing = repo.create(Ingredient(
            name=name, source=source, source_ref=source_ref,
            in_personal_library=True,
        ))
        s.commit()
    return ing


def _make_extracted_sample() -> ExtractedRecipe:
    return ExtractedRecipe(
        name="Tarte aux pommes",
        instructions="Préchauffer\nÉtaler la pâte\nEnfourner",
        default_portions=6,
        prep_time_min=45,
        source_url="https://example.com/tarte",
        ingredients=[
            ExtractedIngredient(
                raw_text="6 pommes",
                parsed_name="pommes",
                parsed_quantity=6.0,
                parsed_unit=None,
            ),
            ExtractedIngredient(
                raw_text="100 g de sucre",
                parsed_name="sucre",
                parsed_quantity=100.0,
                parsed_unit="g",
            ),
        ],
    )


# ============================================================ Extraction


def test_extract_populates_buffer(qtbot, monkeypatch, app_ctx):
    """Le _do_extract synchrone doit remplir le buffer + signaler step 1."""
    _seed_personal(app_ctx, "Pommes")
    _seed_personal(app_ctx, "Sucre")

    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.fetch_recipe",
        lambda url: _make_extracted_sample(),
    )
    vm = RecipeUrlImportViewModel(app_ctx)
    spy_completed = QSignalSpy(vm.extraction_completed)

    # Drive synchronously (avoid threading flakiness in tests)
    vm._do_extract("https://example.com/tarte")
    qtbot.wait(50)

    assert vm.hasExtracted is True
    assert vm.stepIndex == 1
    assert vm.name == "Tarte aux pommes"
    assert vm.defaultPortions == 6
    assert vm.lineCount == 2
    assert spy_completed.count() >= 1
    # Last emit was True (success)
    last = spy_completed.at(spy_completed.count() - 1)
    assert last[0] is True


def test_extract_failure_emits_friendly_message(qtbot, monkeypatch, app_ctx):
    def boom(url):
        raise RecipeImportError("Page introuvable (HTTP 404).")

    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.fetch_recipe", boom
    )
    vm = RecipeUrlImportViewModel(app_ctx)
    spy_failed = QSignalSpy(vm.extraction_failed)
    spy_completed = QSignalSpy(vm.extraction_completed)

    vm._do_extract("https://example.com/missing")
    qtbot.wait(50)

    assert vm.hasExtracted is False
    assert vm.stepIndex == 0
    assert spy_failed.count() == 1
    failed_msg = spy_failed.at(0)[0]
    assert "404" in failed_msg or "introuvable" in failed_msg.lower()
    last_completed = spy_completed.at(spy_completed.count() - 1)
    assert last_completed[0] is False


def test_lines_as_list_includes_candidates(qtbot, monkeypatch, app_ctx):
    pommes = _seed_personal(app_ctx, "Pommes")
    sucre = _seed_personal(app_ctx, "Sucre")

    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.fetch_recipe",
        lambda url: _make_extracted_sample(),
    )
    vm = RecipeUrlImportViewModel(app_ctx)
    vm._do_extract("https://example.com/")
    qtbot.wait(50)

    rows = vm.linesAsList()
    assert len(rows) == 2
    # Both lines should have auto-picked the matching personal ingredient
    chosen_ids = {r["chosenIngredientId"] for r in rows}
    assert pommes.id in chosen_ids
    assert sucre.id in chosen_ids
    # Each line has the candidates list populated
    for r in rows:
        assert r["candidates"]
        assert r["candidates"][0]["id"] == r["chosenIngredientId"]


# ============================================================ Mutations


def test_set_line_quantity_unit(qtbot, monkeypatch, app_ctx):
    _seed_personal(app_ctx, "Sucre")
    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.fetch_recipe",
        lambda url: _make_extracted_sample(),
    )
    vm = RecipeUrlImportViewModel(app_ctx)
    vm._do_extract("https://example.com/")
    qtbot.wait(50)

    vm.setLineQuantityG(1, 250.0)
    vm.setLineUnitCode(1, "kg")
    rows = vm.linesAsList()
    assert rows[1]["quantityG"] == 250.0
    assert rows[1]["unitCode"] == "kg"


def test_ignore_line_excludes_from_commit(qtbot, monkeypatch, app_ctx):
    _seed_personal(app_ctx, "Pommes")
    _seed_personal(app_ctx, "Sucre")

    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.fetch_recipe",
        lambda url: _make_extracted_sample(),
    )
    vm = RecipeUrlImportViewModel(app_ctx)
    vm._do_extract("https://example.com/")
    qtbot.wait(50)

    vm.ignoreLine(0)  # ignore "pommes"
    result = vm.commit()
    assert result["success"] is True
    # The saved recipe should have only 1 line (sucre).
    with app_ctx.session() as s:
        saved = RecipeRepo(s).get(result["recipeId"])
    assert saved is not None
    assert len(saved.lines) == 1
    assert saved.lines[0].ingredient.name == "Sucre"


def test_create_manual_for_line_attaches_new_ingredient(qtbot, monkeypatch, app_ctx):
    """La ligne 'pommes' n'a aucun match → l'utilisateur crée manuellement."""
    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.fetch_recipe",
        lambda url: _make_extracted_sample(),
    )
    vm = RecipeUrlImportViewModel(app_ctx)
    vm._do_extract("https://example.com/")
    qtbot.wait(50)

    # Aucun ingrédient en perso → toutes les lignes ont chosen=None
    rows = vm.linesAsList()
    assert all(r["chosenIngredientId"] == 0 for r in rows)

    new_id = vm.createManualForLine(0, {"name": "Pommes (custom)"})
    assert new_id > 0
    rows = vm.linesAsList()
    assert rows[0]["chosenIngredientId"] == new_id
    assert rows[0]["chosenIngredientName"] == "Pommes (custom)"

    # L'ingrédient est bien créé en biblio perso
    with app_ctx.session() as s:
        ing = IngredientRepo(s).get(new_id)
    assert ing is not None
    assert ing.in_personal_library is True
    assert ing.source == Source.MANUAL


def test_set_line_parsed_name_triggers_research(qtbot, monkeypatch, app_ctx):
    _seed_personal(app_ctx, "Pommes")
    _seed_personal(app_ctx, "Sucre roux")

    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.fetch_recipe",
        lambda url: _make_extracted_sample(),
    )
    vm = RecipeUrlImportViewModel(app_ctx)
    vm._do_extract("https://example.com/")
    qtbot.wait(50)

    # Initial : ligne 1 (sucre) → match "Sucre roux" probable
    rows = vm.linesAsList()
    initial_chosen = rows[1]["chosenIngredientId"]
    assert initial_chosen > 0

    # User édite → "miel" qui n'existe pas → candidates vidées
    vm.setLineParsedName(1, "miel")
    rows = vm.linesAsList()
    # Pas de match → chosen revient à 0
    assert rows[1]["chosenIngredientId"] == 0


# ============================================================ Commit


def test_commit_creates_recipe_with_lines(qtbot, monkeypatch, app_ctx):
    pommes = _seed_personal(app_ctx, "Pommes")
    sucre = _seed_personal(app_ctx, "Sucre")

    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.fetch_recipe",
        lambda url: _make_extracted_sample(),
    )
    vm = RecipeUrlImportViewModel(app_ctx)
    spy_imported = QSignalSpy(vm.import_completed)
    vm._do_extract("https://example.com/")
    qtbot.wait(50)

    result = vm.commit()
    assert result["success"] is True
    assert result["recipeId"] > 0
    assert spy_imported.count() == 1
    assert vm.stepIndex == 2

    with app_ctx.session() as s:
        saved = RecipeRepo(s).get(result["recipeId"])
    assert saved is not None
    assert saved.name == "Tarte aux pommes"
    assert saved.default_portions == 6
    assert len(saved.lines) == 2
    saved_ids = {ln.ingredient.id for ln in saved.lines}
    assert pommes.id in saved_ids
    assert sucre.id in saved_ids


def test_commit_blocks_when_unmatched(qtbot, monkeypatch, app_ctx):
    """Aucun ingrédient en biblio → tout non-matched → commit refuse."""
    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.fetch_recipe",
        lambda url: _make_extracted_sample(),
    )
    vm = RecipeUrlImportViewModel(app_ctx)
    vm._do_extract("https://example.com/")
    qtbot.wait(50)

    result = vm.commit()
    assert result["success"] is False
    assert "non associé" in result["message"].lower() or "non match" in result["message"].lower()
    assert vm.stepIndex == 1  # reste sur l'écran de review


def test_commit_downloads_recipe_image(qtbot, monkeypatch, app_ctx, tmp_path):
    """Quand `ExtractedRecipe.image_url` est défini, le commit doit
    télécharger l'image et la persister via `save_recipe_photo_from_http_url`.
    Le test mock le téléchargement pour ne pas dépendre du réseau."""
    _seed_personal(app_ctx, "Pommes")
    _seed_personal(app_ctx, "Sucre")

    sample = _make_extracted_sample()
    sample.image_url = "https://example.com/cover.jpg"
    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.fetch_recipe",
        lambda url: sample,
    )

    # Stub le download : retourne une fonction qui remplace le service
    download_calls: list[tuple[str, int]] = []

    def fake_download(http_url, recipe_id, photo_dir=None, client=None):
        download_calls.append((http_url, recipe_id))
        return f"{recipe_id}.jpg"

    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.save_recipe_photo_from_http_url",
        fake_download,
    )

    vm = RecipeUrlImportViewModel(app_ctx)
    vm._do_extract("https://example.com/recipe")
    qtbot.wait(50)

    result = vm.commit()
    assert result["success"] is True
    assert len(download_calls) == 1
    assert download_calls[0] == ("https://example.com/cover.jpg", result["recipeId"])

    # La recette en DB porte bien l'image_path
    with app_ctx.session() as s:
        saved = RecipeRepo(s).get(result["recipeId"])
    assert saved is not None
    assert saved.image_path == f"{result['recipeId']}.jpg"


def test_commit_survives_image_download_failure(qtbot, monkeypatch, app_ctx):
    """Échec du téléchargement de l'image (URL morte, format inconnu) ne
    doit PAS faire échouer le commit — la recette est créée sans photo,
    l'utilisateur en ajoutera une plus tard."""
    _seed_personal(app_ctx, "Pommes")
    _seed_personal(app_ctx, "Sucre")

    sample = _make_extracted_sample()
    sample.image_url = "https://example.com/dead-link.jpg"
    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.fetch_recipe",
        lambda url: sample,
    )

    def boom(*args, **kwargs):
        raise OSError("simulated 404")

    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.save_recipe_photo_from_http_url",
        boom,
    )

    vm = RecipeUrlImportViewModel(app_ctx)
    vm._do_extract("https://example.com/recipe")
    qtbot.wait(50)

    result = vm.commit()
    assert result["success"] is True
    with app_ctx.session() as s:
        saved = RecipeRepo(s).get(result["recipeId"])
    assert saved is not None
    assert saved.image_path is None  # photo non sauvegardée mais recette OK


def test_set_line_chosen_external_id_adds_to_candidates(qtbot, monkeypatch, app_ctx):
    """Quand le popup de recherche manuelle (CIQUAL/OFF) pousse un id qui
    n'était pas dans `candidates`, le VM doit l'y ajouter en tête pour que
    la combobox puisse afficher son nom."""
    _seed_personal(app_ctx, "Pommes")
    _seed_personal(app_ctx, "Sucre")
    # Crée un 3e ingrédient qui n'apparaîtrait JAMAIS via resolve_ingredient_name
    # ("zzz" — aucune ressemblance avec les noms extraits).
    extra = _seed_personal(app_ctx, "zzz_externe")

    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.fetch_recipe",
        lambda url: _make_extracted_sample(),
    )
    vm = RecipeUrlImportViewModel(app_ctx)
    vm._do_extract("https://example.com/")
    qtbot.wait(50)

    rows_before = vm.linesAsList()
    candidates_before = [c["id"] for c in rows_before[0]["candidates"]]
    assert extra.id not in candidates_before  # vraiment hors candidates

    # Simule la popup : l'utilisateur a cherché manuellement et choisi `extra`
    vm.setLineChosenIngredient(0, extra.id)

    rows_after = vm.linesAsList()
    assert rows_after[0]["chosenIngredientId"] == extra.id
    assert rows_after[0]["chosenIngredientName"] == "zzz_externe"
    candidates_after = [c["id"] for c in rows_after[0]["candidates"]]
    assert extra.id in candidates_after
    assert candidates_after[0] == extra.id   # ajouté en tête


def test_reset_clears_buffer(qtbot, monkeypatch, app_ctx):
    _seed_personal(app_ctx, "Pommes")
    _seed_personal(app_ctx, "Sucre")
    monkeypatch.setattr(
        "app.ui.viewmodels.recipe_url_import_vm.fetch_recipe",
        lambda url: _make_extracted_sample(),
    )
    vm = RecipeUrlImportViewModel(app_ctx)
    vm._do_extract("https://example.com/")
    qtbot.wait(50)
    assert vm.hasExtracted is True

    vm.reset()
    assert vm.hasExtracted is False
    assert vm.stepIndex == 0
    assert vm.lineCount == 0
