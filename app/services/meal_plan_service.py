"""Service-level operations on the weekly meal plan.

Adding a new file (rather than enriching `CalendarViewModel`) so the logic stays
testable without Qt and reusable from a future shopping_service / mobile API.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.data.orm import MealPlanTemplateRow
from app.data.repositories import MealPlanRepo
from app.domain.models import IsoWeek, MealPlanEntry, MealSlot

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class MealPlanTemplate:
    """Lightweight descriptor of a saved template (C1) — what list_templates returns."""
    id: int
    name: str
    entry_count: int
    created_at: datetime | None
    updated_at: datetime | None


def previous_iso_week(iso_week: str) -> str:
    """Return the ISO week one week before `iso_week`.

    Robust against year boundaries (e.g. '2026-W01' -> '2025-W53') because we
    convert via `datetime.fromisocalendar` then back via `IsoWeek.from_date`.
    """
    IsoWeek(value=iso_week)  # validate format
    year = int(iso_week[:4])
    week = int(iso_week[6:])
    monday = datetime.fromisocalendar(year, week, 1)
    prev_monday = monday - timedelta(weeks=1)
    return IsoWeek.from_date(prev_monday).value


def copy_week(s: Session, src_iso_week: str, dst_iso_week: str) -> int:
    """Append every entry from `src_iso_week` to `dst_iso_week`. Returns the
    number of entries copied.

    Behavior :
    - **Append**, doesn't clear `dst` first. Two consecutive calls duplicate
      entries; the caller (UI) shows a confirmation when `dst` is non-empty.
    - Same `(day_of_week, slot)` survives — entries land in the same cells.
    - `ordinal` is preserved (each cell can already have multiple stacked items).
    - The copies are NEW entries (fresh `id`, `created_at`); the source week is
      unchanged.

    No-op (returns 0) when `src == dst` to avoid accidentally doubling the
    current week.
    """
    if src_iso_week == dst_iso_week:
        return 0
    repo = MealPlanRepo(s)
    src_entries = repo.list_by_week(src_iso_week)
    count = 0
    for entry in src_entries:
        new_entry = entry.model_copy(update={"id": None, "iso_week": dst_iso_week})
        repo.add(new_entry)
        count += 1
    return count


def copy_previous_week(s: Session, current_iso_week: str) -> int:
    """Convenience wrapper: compute `previous_iso_week(current_iso_week)` then
    copy. Returns the count of entries copied (0 if previous week is empty)."""
    return copy_week(s, previous_iso_week(current_iso_week), current_iso_week)


# ============================================================ C1 — Named templates


def _entry_to_snapshot_dict(entry: MealPlanEntry) -> dict:
    """Reduce a meal plan entry to a portable snapshot dict (no `id`,
    no `iso_week` — those depend on the target week when applied)."""
    return {
        "day_of_week":   entry.day_of_week,
        "slot":          entry.slot.value,
        "recipe_id":     entry.recipe_id,
        "ingredient_id": entry.ingredient_id,
        "quantity_g":    entry.quantity_g,
        "portions":      entry.portions,
        "ordinal":       entry.ordinal,
    }


def _snapshot_to_entry(d: dict, target_iso_week: str) -> MealPlanEntry:
    return MealPlanEntry(
        iso_week=target_iso_week,
        day_of_week=int(d["day_of_week"]),
        slot=MealSlot(d["slot"]),
        recipe_id=d.get("recipe_id"),
        ingredient_id=d.get("ingredient_id"),
        quantity_g=d.get("quantity_g"),
        portions=d.get("portions"),
        ordinal=int(d.get("ordinal", 0)),
    )


def save_as_template(s: Session, source_iso_week: str, name: str) -> MealPlanTemplate:
    """Snapshot the entries of `source_iso_week` under the given template name.
    Overwrites the existing template if `name` already exists (idempotent
    "save again" — the unique index makes a name collision raise without it).

    Empty week is OK : the template stores `[]` and applying it is a no-op.
    """
    name = (name or "").strip()
    if not name:
        raise ValueError("Le nom du template ne peut pas être vide.")
    entries = MealPlanRepo(s).list_by_week(source_iso_week)
    snapshot = json.dumps([_entry_to_snapshot_dict(e) for e in entries])

    existing = s.execute(
        select(MealPlanTemplateRow).where(MealPlanTemplateRow.name == name)
    ).scalar_one_or_none()
    if existing is not None:
        existing.snapshot_json = snapshot
        row = existing
    else:
        row = MealPlanTemplateRow(name=name, snapshot_json=snapshot)
        s.add(row)
    s.flush()
    log.info("Saved meal plan template %r with %d entries", name, len(entries))
    return MealPlanTemplate(
        id=row.id, name=row.name, entry_count=len(entries),
        created_at=row.created_at, updated_at=row.updated_at,
    )


def apply_template(s: Session, template_id: int, target_iso_week: str) -> int:
    """Append the template's entries to `target_iso_week`. Returns the count
    of entries inserted (0 if the template doesn't exist or is empty).

    Like `copy_week`, this is **append-only** — existing entries on the target
    week stay. The UI is responsible for confirming when the target is not
    empty (the user might want to clear first)."""
    IsoWeek(value=target_iso_week)  # validate
    row = s.get(MealPlanTemplateRow, template_id)
    if row is None:
        return 0
    try:
        snapshot = json.loads(row.snapshot_json)
    except json.JSONDecodeError as exc:
        log.error("Corrupt template snapshot %d : %s", template_id, exc)
        return 0
    repo = MealPlanRepo(s)
    count = 0
    for d in snapshot:
        try:
            entry = _snapshot_to_entry(d, target_iso_week)
            repo.add(entry)
            count += 1
        except Exception as exc:  # noqa: BLE001 — skip malformed entries
            log.warning("Skipping malformed template entry %r : %s", d, exc)
    return count


def list_templates(s: Session) -> list[MealPlanTemplate]:
    """Return all saved templates, alphabetical by name."""
    rows = list(s.execute(
        select(MealPlanTemplateRow).order_by(MealPlanTemplateRow.name)
    ).scalars())
    out = []
    for r in rows:
        try:
            count = len(json.loads(r.snapshot_json))
        except json.JSONDecodeError:
            count = 0
        out.append(MealPlanTemplate(
            id=r.id, name=r.name, entry_count=count,
            created_at=r.created_at, updated_at=r.updated_at,
        ))
    return out


def delete_template(s: Session, template_id: int) -> bool:
    """Remove a template. Returns True on success."""
    row = s.get(MealPlanTemplateRow, template_id)
    if row is None:
        return False
    s.delete(row)
    s.flush()
    return True
