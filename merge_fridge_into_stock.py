#!/usr/bin/env python3
"""
Merge fridge + cupboard export lists into beer-in-stock.json.

The two Untappd-style lists (fridge only / cupboard only) are the source of truth
for quantity, in_fridge, and in_cupboard. Existing beer-in-stock.json is used to
preserve image_url, image_source, and other curated fields when item_id matches.

Beers that appear only in the old stock file and not in either list are dropped
(the exports represent your current home inventory).

Usage:
  python3 merge_fridge_into_stock.py [stock.json] [fridge-list.json] [cupboard-list.json]

Defaults:
  stock = beer-in-stock.json (this directory)
  fridge = ../my-beer/beer-data-files-private/fridge beers 2026-03-15.json
  cupboard = ../my-beer/beer-data-files-private/cupboard beers 2026-03-15.json

  --out path   write elsewhere instead of overwriting stock.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
DEFAULT_STOCK = HERE / "beer-in-stock.json"
DATA_DIR = HERE.parent / "my-beer" / "beer-data-files-private"
DEFAULT_FRIDGE = DATA_DIR / "fridge beers 2026-03-15.json"
DEFAULT_CUPBOARD = DATA_DIR / "cupboard beers 2026-03-15.json"


def _load_list(path: Path) -> List[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        return raw.get("beers", raw.get("data", []))
    return []


def _merge_fridge_cupboard(
    fridge_path: Path, cupboard_path: Path
) -> Tuple[List[dict], Dict[int, dict], Dict[int, dict]]:
    fridge_list = _load_list(fridge_path)
    cupboard_list = _load_list(cupboard_path) if cupboard_path.exists() else []

    fridge_count: Dict[int, int] = {}
    fridge_record: Dict[int, dict] = {}
    for item in fridge_list or []:
        if not isinstance(item, dict):
            continue
        try:
            iid = int(item["item_id"])
        except (KeyError, TypeError, ValueError):
            continue
        q = max(0, int(item.get("quantity") or 0))
        fridge_count[iid] = fridge_count.get(iid, 0) + q
        if iid not in fridge_record:
            fridge_record[iid] = item

    cupboard_count: Dict[int, int] = {}
    cupboard_record: Dict[int, dict] = {}
    for item in cupboard_list or []:
        if not isinstance(item, dict):
            continue
        try:
            iid = int(item["item_id"])
        except (KeyError, TypeError, ValueError):
            continue
        q = max(0, int(item.get("quantity") or 0))
        cupboard_count[iid] = cupboard_count.get(iid, 0) + q
        if iid not in cupboard_record:
            cupboard_record[iid] = item

    all_ids = sorted(set(fridge_count) | set(cupboard_count))
    merged: List[dict] = []
    for iid in all_ids:
        fqty = fridge_count.get(iid, 0)
        cqty = cupboard_count.get(iid, 0)
        rec = fridge_record.get(iid) or cupboard_record.get(iid) or {}
        best_by = rec.get("best_by_date_iso")
        if best_by in ("", "0000-00-00", None):
            best_by = None
        merged.append(
            {
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
                "image_source": None,
                "untappd_url": f"https://untappd.com/beer/{iid}",
            }
        )
    return merged, fridge_record, cupboard_record


def _coalesce_best_by(a: Optional[str], b: Optional[str]) -> Optional[str]:
    for v in (a, b):
        if v and v not in ("", "0000-00-00"):
            return v
    return None


def _overlay_stock(merged_row: dict, stock_row: Optional[dict]) -> dict:
    if not stock_row:
        return merged_row
    out = dict(merged_row)
    for key in ("image_url", "image_source"):
        if stock_row.get(key):
            out[key] = stock_row[key]
    if stock_row.get("notes"):
        out["notes"] = stock_row["notes"]
    out["best_by_date_iso"] = _coalesce_best_by(
        stock_row.get("best_by_date_iso"), merged_row.get("best_by_date_iso")
    )
    for key in ("beer_abv", "beer_ibu", "beer_name", "brewery_name", "beer_type"):
        if stock_row.get(key) not in (None, ""):
            out[key] = stock_row[key]
    return out


def main() -> None:
    argv = list(sys.argv[1:])
    out_path: Optional[Path] = None
    if "--out" in argv:
        i = argv.index("--out")
        if i + 1 >= len(argv):
            print("ERROR: --out needs a path")
            sys.exit(1)
        out_path = Path(argv[i + 1]).expanduser().resolve()
        del argv[i : i + 2]

    args = [Path(a).expanduser().resolve() for a in argv]
    stock_path = args[0] if len(args) > 0 else DEFAULT_STOCK
    fridge_path = args[1] if len(args) > 1 else DEFAULT_FRIDGE
    cupboard_path = args[2] if len(args) > 2 else DEFAULT_CUPBOARD

    if not fridge_path.exists():
        print(f"ERROR: Fridge list not found: {fridge_path}")
        sys.exit(1)
    if not cupboard_path.exists():
        print(f"ERROR: Cupboard list not found: {cupboard_path}")
        sys.exit(1)

    merged, _, _ = _merge_fridge_cupboard(fridge_path, cupboard_path)
    stock_by_id: Dict[int, dict] = {}
    if stock_path.exists():
        stock = json.loads(stock_path.read_text(encoding="utf-8"))
        if not isinstance(stock, list):
            stock = stock.get("beers", []) if isinstance(stock, dict) else []
        for b in stock:
            if not isinstance(b, dict):
                continue
            try:
                stock_by_id[int(b["item_id"])] = b
            except (KeyError, TypeError, ValueError):
                continue

    out: List[dict] = []
    for row in merged:
        iid = int(row["item_id"])
        out.append(_overlay_stock(row, stock_by_id.get(iid)))

    write_path = out_path or stock_path
    write_path.parent.mkdir(parents=True, exist_ok=True)
    write_path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")

    n_fridge = sum(1 for b in out if b.get("in_fridge", 0) > 0)
    n_cup = sum(1 for b in out if b.get("in_cupboard", 0) > 0)
    total = sum(int(b.get("quantity") or 0) for b in out)
    print(
        f"Wrote {write_path} ({len(out)} types, {total} bottles · "
        f"{n_fridge} types with fridge · {n_cup} types with cupboard)"
    )


if __name__ == "__main__":
    main()
