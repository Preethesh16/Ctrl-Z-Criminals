"""Local validation harness — runs the extractor across the confidential
police dataset and prints AGGREGATE stats only (no transaction contents).

Usage:  cd backend && .venv/bin/python tools/validate_dataset.py
The dataset folder is git-ignored; this script only reads it locally.
"""

import sys
import warnings
from collections import Counter
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ingest.router import UnsupportedFormat, extract_rows  # noqa: E402

ROOT = Path(__file__).resolve().parents[2] / "Bank-statements-dataset"


def main() -> None:
    results = Counter()
    txn_total = 0
    review_needed = 0
    channel_census = Counter()
    failures: list[str] = []
    zero_rows: list[str] = []

    files = sorted(p for p in ROOT.rglob("*") if p.is_file())
    for f in files:
        try:
            txns, info = extract_rows(f)
        except UnsupportedFormat as e:
            results[f"skipped: {e}"] += 1
            continue
        except Exception as e:
            results["error"] += 1
            failures.append(f"{f.name[:50]} :: {type(e).__name__}: {str(e)[:80]}")
            continue
        if not txns:
            results["zero-rows"] += 1
            zero_rows.append(f"{f.name[:50]} [{info.get('file_kind')}/{info.get('extraction_mode', '-')}]")
            continue
        results["ok"] += 1
        txn_total += len(txns)
        review_needed += sum(1 for t in txns if t.confidence < 0.70)
        channel_census.update(t.channel for t in txns)

    print(f"files: {len(files)}")
    for k, v in results.most_common():
        print(f"  {k}: {v}")
    print(f"transactions extracted: {txn_total}  (needs_review: {review_needed})")
    print(f"channels: {dict(channel_census.most_common())}")
    print(f"\nzero-row files ({len(zero_rows)}):")
    for z in zero_rows[:20]:
        print("  " + z)
    print(f"\nfailures ({len(failures)}):")
    for x in failures[:20]:
        print("  " + x)


if __name__ == "__main__":
    main()
