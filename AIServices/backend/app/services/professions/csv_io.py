"""
CSV reading for the ESCO / O*NET datasets.

Columns are always read by header name, never by position. Files may be UTF-8
with or without a BOM, and fields may span several lines (ESCO altLabels are
newline-separated inside quotes). Required files and headers are validated
before anything is imported, with clear errors.
"""

import csv
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Sequence

csv.field_size_limit(2**31 - 1)


class DatasetError(Exception):
    """A required file is missing or does not have the expected columns."""


def resolve_file(directory: Path, base: str, suffixes: Sequence[str] = ("_en", "")) -> Optional[Path]:
    """`occupations` → occupations_en.csv or occupations.csv (first that exists)."""
    for suffix in suffixes:
        candidate = Path(directory) / f"{base}{suffix}.csv"
        if candidate.is_file():
            return candidate
    return None


def read_header(path: Path) -> List[str]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        try:
            return [h.strip() for h in next(csv.reader(handle))]
        except StopIteration:
            return []


def validate_files(directory: Path, spec: Dict[str, Sequence[str]], suffixes: Sequence[str] = ("_en", "")) -> Dict[str, Path]:
    """
    spec: {base name: required headers}. Returns {base: path}; raises
    DatasetError listing every missing file or missing column.
    """
    errors, found = [], {}
    if not Path(directory).is_dir():
        raise DatasetError(f"Dataset folder not found: {directory}")
    for base, required in spec.items():
        path = resolve_file(directory, base, suffixes)
        if path is None:
            names = " or ".join(f"{base}{s}.csv" for s in suffixes)
            errors.append(f"missing file: {names} in {directory}")
            continue
        header = read_header(path)
        missing = [h for h in required if h not in header]
        if missing:
            errors.append(f"{path.name}: missing column(s) {missing}; found {header}")
            continue
        found[base] = path
    if errors:
        raise DatasetError("; ".join(errors))
    return found


def read_rows(path: Path) -> Iterator[Dict[str, str]]:
    """Rows as {header: value}, values stripped (multi-line quoted fields supported)."""
    with open(path, encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        reader.fieldnames = [h.strip() for h in reader.fieldnames or []]
        for row in reader:
            yield {k: (v or "").strip() for k, v in row.items() if k is not None}


def split_labels(value: str) -> List[str]:
    """ESCO multi-value cells: one label per line."""
    return [part.strip() for part in (value or "").splitlines() if part.strip()]


def csv_list(value: str) -> List[str]:
    return [part.strip() for part in (value or "").split(",") if part.strip()]
