#!/usr/bin/env python3
"""
Merge fridge + cupboard lists into a single uploadable stock file.

Writes: ../my-beer/beer-data-files-private/stock fridge and cupboard 2026-03-15.json
Same format as beer-in-stock (no images). Use this file in the app's Load stock picker.

Usage:
  python3 merge_stock_fridge_cupboard.py [fridge.json] [cupboard.json]

Defaults: fridge beers 2026-03-15.json, cupboard beers 2026-03-15.json in beer-data-files-private.
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA_DIR = HERE.parent / "my-beer" / "beer-data-files-private"
DEFAULT_FRIDGE = DATA_DIR / "fridge beers 2026-03-15.json"
DEFAULT_CUPBOARD = DATA_DIR / "cupboard beers 2026-03-15.json"
OUT_NAME = "stock fridge and cupboard 2026-03-15.json"


def _load_list(path):
    raw = json.loads(path.read_text(encoding="utf-8"))
    return raw if isinstance(raw, list) else raw.get("beers", raw.get("data", []))


def _merge_fridge_cupboard(fridge_path, cupboard_path):
    fridge_list = _load_list(fridge_path)
    cupboard_list = _load_list(cupboard_path) if cupboard_path.exists() else []

    fridge_count, fridge_record = {}, {}
    for item in fridge_list or []:
        if not isinstance(item, dict):
            continue
        try:
            iid = int(item.get("item_id"))
        except (TypeError, ValueError):
            continue
        q = max(0, int(item.get("quantity") or 1))
        fridge_count[iid] = fridge_count.get(iid, 0) + q
        if iid not in fridge_record:
            fridge_record[iid] = item

    cupboard_count, cupboard_record = {}, {}
    for item in cupboard_list or []:
        if not isinstance(item, dict):
            continue
        try:
            iid = int(item.get("item_id"))
        except (TypeError, ValueError):
            continue
        q = max(0, int(item.get("quantity") or 1))
        cupboard_count[iid] = cupboard_count.get(iid, 0) + q
        if iid not in cupboard_record:
            cupboard_record[iid] = item

    all_ids = set(fridge_count) | set(cupboard_count)
    merged = []
    for iid in sorted(all_ids):
        fqty = fridge_count.get(iid, 0)
        cqty = cupboard_count.get(iid, 0)
        rec = fridge_record.get(iid) or cupboard_record.get(iid)
        best_by = rec.get("best_by_date_iso") or None
        if best_by in ("", "0000-00-00"):
            best_by = None
        merged.append({
            "item_id": iid,
            "beer_name": rec.get("beer_name") or "",
            "brewery_name": rec.get("brewery_name") or "",
            "beer_type": rec.get("beer_type") or "",
            "beer_abv": rec.get("beer_abv"),
            "beer_ibu": rec.get("beer_ibu"),
            "quantity": fqty + cqty,
            "in_fridge": fqty,
            "in_cupboard": cqty,
            "notes": rec.get("notes"),
            "best_by_date_iso": best_by,
            "image_url": None,
            "untappd_url": "https://untappd.com/beer/" + str(iid) if iid else None,
        })
    return merged


def main() -> None:
    args = [Path(p).expanduser().resolve() for p in sys.argv[1:]]
    fridge_path = args[0] if len(args) > 0 and args[0].exists() else DEFAULT_FRIDGE
    cupboard_path = args[1] if len(args) > 1 and args[1].exists() else DEFAULT_CUPBOARD
    if not fridge_path.exists():
        print(f"ERROR: Fridge list not found: {fridge_path}")
        sys.exit(1)
    if not cupboard_path.exists():
        print(f"ERROR: Cupboard list not found: {cupboard_path}")
        sys.exit(1)

    merged = _merge_fridge_cupboard(fridge_path, cupboard_path)
    out_path = DATA_DIR / OUT_NAME
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")
    total = sum(b["quantity"] for b in merged)
    print(f"Wrote {out_path} ({len(merged)} types, {total} total)")


if __name__ == "__main__":
    main()
