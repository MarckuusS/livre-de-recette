"""Tests for `app.services.photo_service`."""

from __future__ import annotations

from pathlib import Path

import pytest
from PIL import Image

from app.services.photo_service import (
    absolute_photo_path,
    delete_recipe_photo,
    save_recipe_photo,
    save_recipe_photo_from_http_url,
)


def _make_test_image(path: Path, size: tuple[int, int] = (800, 600), mode: str = "RGB") -> Path:
    """Create a synthetic PNG/JPG at `path` for testing."""
    img = Image.new(mode, size, color=(255, 0, 0) if mode == "RGB" else (255, 0, 0, 128))
    img.save(path)
    return path


# ============================================================ save_recipe_photo


def test_save_recipe_photo_creates_jpg(tmp_path: Path) -> None:
    src = _make_test_image(tmp_path / "src.png", size=(2000, 1500))
    photo_dir = tmp_path / "photos"

    filename = save_recipe_photo(src, recipe_id=42, photo_dir=photo_dir)

    assert filename == "42.jpg"
    target = photo_dir / "42.jpg"
    assert target.exists()
    # Verify it's a valid JPEG
    with Image.open(target) as out:
        assert out.format == "JPEG"


def test_save_recipe_photo_resizes_oversized(tmp_path: Path) -> None:
    """A 4000×3000 image should be resized to fit in 1024×1024 (preserving ratio)."""
    src = _make_test_image(tmp_path / "huge.png", size=(4000, 3000))
    photo_dir = tmp_path / "photos"

    save_recipe_photo(src, recipe_id=1, photo_dir=photo_dir)

    with Image.open(photo_dir / "1.jpg") as out:
        # 4000×3000 with 1024 max → 1024×768 (ratio 4:3 preserved)
        assert max(out.size) == 1024
        # Aspect ratio preserved within 1 pixel rounding
        assert abs(out.size[0] / out.size[1] - 4 / 3) < 0.01


def test_save_recipe_photo_preserves_small_image(tmp_path: Path) -> None:
    """An image smaller than 1024×1024 should not be upscaled."""
    src = _make_test_image(tmp_path / "small.png", size=(400, 300))
    photo_dir = tmp_path / "photos"

    save_recipe_photo(src, recipe_id=1, photo_dir=photo_dir)

    with Image.open(photo_dir / "1.jpg") as out:
        assert out.size == (400, 300)


def test_save_recipe_photo_handles_rgba(tmp_path: Path) -> None:
    """PNG with alpha channel must be flattened (JPEG doesn't support alpha)."""
    src = _make_test_image(tmp_path / "rgba.png", size=(500, 500), mode="RGBA")
    photo_dir = tmp_path / "photos"

    save_recipe_photo(src, recipe_id=1, photo_dir=photo_dir)

    with Image.open(photo_dir / "1.jpg") as out:
        assert out.mode == "RGB"  # flattened


def test_save_recipe_photo_overwrites_existing(tmp_path: Path) -> None:
    """Saving twice for the same recipe_id replaces the existing photo."""
    src1 = _make_test_image(tmp_path / "v1.png", size=(800, 600))
    src2 = _make_test_image(tmp_path / "v2.png", size=(400, 300))
    photo_dir = tmp_path / "photos"

    save_recipe_photo(src1, recipe_id=1, photo_dir=photo_dir)
    size1 = (photo_dir / "1.jpg").stat().st_size
    save_recipe_photo(src2, recipe_id=1, photo_dir=photo_dir)
    size2 = (photo_dir / "1.jpg").stat().st_size

    assert size2 != size1  # different content → different bytes
    with Image.open(photo_dir / "1.jpg") as out:
        assert out.size == (400, 300)  # = v2


def test_save_recipe_photo_creates_dir(tmp_path: Path) -> None:
    """The photo_dir is created on first use."""
    src = _make_test_image(tmp_path / "src.png")
    photo_dir = tmp_path / "deep" / "nested" / "photos"

    save_recipe_photo(src, recipe_id=1, photo_dir=photo_dir)

    assert (photo_dir / "1.jpg").exists()


def test_save_recipe_photo_raises_on_missing_source(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        save_recipe_photo(tmp_path / "nonexistent.png", recipe_id=1,
                          photo_dir=tmp_path / "photos")


def test_save_recipe_photo_compresses_aggressively(tmp_path: Path) -> None:
    """A 4 MP red image saved as JPEG quality 85 should weigh < 200 KB."""
    src = _make_test_image(tmp_path / "big.png", size=(2048, 2048))
    photo_dir = tmp_path / "photos"

    save_recipe_photo(src, recipe_id=1, photo_dir=photo_dir)

    target_size = (photo_dir / "1.jpg").stat().st_size
    assert target_size < 200_000, f"Expected < 200 KB, got {target_size} bytes"


# ============================================================ absolute_photo_path


def test_absolute_photo_path_returns_path_when_exists(tmp_path: Path) -> None:
    src = _make_test_image(tmp_path / "src.png")
    photo_dir = tmp_path / "photos"
    save_recipe_photo(src, recipe_id=1, photo_dir=photo_dir)

    result = absolute_photo_path("1.jpg", photo_dir=photo_dir)
    assert result is not None
    assert result == photo_dir / "1.jpg"


def test_absolute_photo_path_returns_none_when_missing(tmp_path: Path) -> None:
    assert absolute_photo_path("1.jpg", photo_dir=tmp_path / "photos") is None


def test_absolute_photo_path_returns_none_when_input_empty(tmp_path: Path) -> None:
    assert absolute_photo_path(None) is None
    assert absolute_photo_path("") is None


def test_absolute_photo_path_warns_when_path_set_but_missing(
    tmp_path: Path, caplog
) -> None:
    """A2 : when image_path is set but the file is gone (user deleted it from
    disk), we log a warning so the QML placeholder isn't mysterious."""
    import logging
    photo_dir = tmp_path / "photos"
    photo_dir.mkdir()  # dir exists, file doesn't
    with caplog.at_level(logging.WARNING, logger="app.services.photo_service"):
        result = absolute_photo_path("ghost.jpg", photo_dir=photo_dir)
    assert result is None
    assert any("missing on disk" in r.message for r in caplog.records)


def test_absolute_photo_path_silent_when_image_path_empty(
    tmp_path: Path, caplog
) -> None:
    """No warning when image_path is None/empty — that's the legitimate
    "no photo set" case, not an integrity issue."""
    import logging
    with caplog.at_level(logging.WARNING, logger="app.services.photo_service"):
        absolute_photo_path(None)
        absolute_photo_path("")
    assert not caplog.records


# ============================================================ delete_recipe_photo


def test_delete_recipe_photo_removes_file(tmp_path: Path) -> None:
    src = _make_test_image(tmp_path / "src.png")
    photo_dir = tmp_path / "photos"
    save_recipe_photo(src, recipe_id=1, photo_dir=photo_dir)
    assert (photo_dir / "1.jpg").exists()

    deleted = delete_recipe_photo("1.jpg", photo_dir=photo_dir)

    assert deleted is True
    assert not (photo_dir / "1.jpg").exists()


def test_delete_recipe_photo_idempotent(tmp_path: Path) -> None:
    """Deleting an already-deleted (or never-existing) photo returns False without raising."""
    deleted = delete_recipe_photo("nonexistent.jpg", photo_dir=tmp_path / "photos")
    assert deleted is False


def test_delete_recipe_photo_handles_empty_input(tmp_path: Path) -> None:
    assert delete_recipe_photo(None) is False
    assert delete_recipe_photo("") is False


# ============================================================ save_recipe_photo_from_http_url


def _make_jpeg_bytes(size: tuple[int, int] = (800, 600)) -> bytes:
    """In-memory JPEG payload for the mock HTTP transport to return."""
    import io
    buf = io.BytesIO()
    Image.new("RGB", size, color=(0, 255, 0)).save(buf, "JPEG")
    return buf.getvalue()


def test_save_recipe_photo_from_http_url_downloads_and_resizes(tmp_path: Path) -> None:
    """Le download HTTP doit faire transiter par save_recipe_photo (donc
    resize/recompress JPEG quality 85). Mock httpx via MockTransport pour ne
    pas dépendre du réseau."""
    import httpx

    payload = _make_jpeg_bytes(size=(2000, 1500))

    def handler(request: httpx.Request) -> httpx.Response:
        assert "User-Agent" in request.headers
        return httpx.Response(200, content=payload, headers={"Content-Type": "image/jpeg"})

    photo_dir = tmp_path / "photos"
    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, follow_redirects=True)

    filename = save_recipe_photo_from_http_url(
        "https://example.com/recipe-cover.jpg",
        recipe_id=99,
        photo_dir=photo_dir,
        client=client,
    )
    client.close()

    assert filename == "99.jpg"
    target = photo_dir / "99.jpg"
    assert target.exists()
    with Image.open(target) as out:
        assert out.format == "JPEG"
        # Le resize 1024 max a été appliqué (l'image source était 2000×1500).
        assert max(out.size) <= 1024


def test_save_recipe_photo_from_http_url_404_raises(tmp_path: Path) -> None:
    """404 → httpx.HTTPStatusError remonte ; le caller (le VM ou le wizard
    URL) attrape pour afficher un message friendly."""
    import httpx

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, content=b"Not found")

    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, follow_redirects=True)
    with pytest.raises(httpx.HTTPStatusError):
        save_recipe_photo_from_http_url(
            "https://example.com/missing.jpg",
            recipe_id=99,
            photo_dir=tmp_path / "photos",
            client=client,
        )
    client.close()


def test_save_recipe_photo_from_http_url_rejects_empty_url(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        save_recipe_photo_from_http_url(
            "", recipe_id=1, photo_dir=tmp_path / "photos",
        )


def test_save_recipe_photo_from_http_url_cleans_up_temp(tmp_path: Path) -> None:
    """Le fichier temporaire utilisé pour stocker le download doit être
    supprimé après save (succès comme échec). On vérifie qu'aucun fichier
    inattendu ne reste dans le tmp système après l'opération."""
    import tempfile

    import httpx
    payload = _make_jpeg_bytes()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=payload, headers={"Content-Type": "image/jpeg"})

    photo_dir = tmp_path / "photos"
    transport = httpx.MockTransport(handler)
    client = httpx.Client(transport=transport, follow_redirects=True)

    # Snapshot avant : la liste des fichiers `recipe-photo-*` dans le tmp système
    tmp_root = Path(tempfile.gettempdir())
    before = {p for p in tmp_root.glob("recipe-photo-*")}

    save_recipe_photo_from_http_url(
        "https://example.com/img.jpg",
        recipe_id=42,
        photo_dir=photo_dir,
        client=client,
    )
    client.close()

    after = {p for p in tmp_root.glob("recipe-photo-*")}
    leaked = after - before
    assert leaked == set(), f"Fichiers temp non nettoyés : {leaked}"
