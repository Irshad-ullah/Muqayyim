"""
CSV reading for the ESCO / O*NET datasets.

Columns are always read by header name, never by position. Files may be UTF-8
with or without a BOM, and fields may span several lines (ESCO altLabels are
newline-separated inside quotes). Required files and headers are validated
before anything is imported, with clear errors.
"""

import csv
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Sequence, Tuple

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


def check_files(directory: Path, spec: Dict[str, Sequence[str]], suffixes: Sequence[str] = ("_en", ""),
                optional: Sequence[str] = ()) -> Tuple[Dict[str, Path], List[str]]:
    """
    spec: {base name: required headers}. Returns ({base: path}, [errors]) with one
    readable error per missing file or file with missing columns. Bases listed in
    `optional` may be absent.
    """
    errors, found = [], {}
    if not Path(directory).is_dir():
        return {}, [f"Dataset folder not found: {directory}"]
    for base, required in spec.items():
        path = resolve_file(directory, base, suffixes)
        if path is None:
            if base not in optional:
                names = " or ".join(f"{base}{s}.csv" for s in suffixes)
                errors.append(f"missing file: {names} in {directory}")
            continue
        try:
            header = read_header(path)
        except UnicodeDecodeError:
            errors.append(f"{path.name}: not UTF-8 encoded")
            continue
        missing = [h for h in required if h not in header]
        if missing:
            errors.append(f"{path.name}: missing column(s) {missing}; found {header}")
            continue
        found[base] = path
    return found, errors


def validate_files(directory: Path, spec: Dict[str, Sequence[str]], suffixes: Sequence[str] = ("_en", ""),
                   optional: Sequence[str] = ()) -> Dict[str, Path]:
    """
    spec: {base name: required headers}. Returns {base: path}; raises
    DatasetError listing every missing file or missing column.
    """
    found, errors = check_files(directory, spec, suffixes, optional)
    if errors:
        raise DatasetError("; ".join(errors))
    return found


def scan_rows(path: Path) -> Tuple[int, Optional[str]]:
    """(data rows, error): reads the whole file as UTF-8 CSV without keeping it.
    The error names the problem and a line number, never file contents."""
    rows = 0
    try:
        with open(path, encoding="utf-8-sig", newline="") as handle:
            reader = csv.reader(handle)
            next(reader, None)  # header
            for _ in reader:
                rows += 1
    except UnicodeDecodeError as exc:
        return rows, f"{Path(path).name}: not UTF-8 encoded (invalid byte at offset {exc.start} of a chunk after row {rows})"
    except csv.Error as exc:
        return rows, f"{Path(path).name}: malformed CSV after row {rows} ({type(exc).__name__})"
    if rows == 0:
        return 0, f"{Path(path).name}: no data rows"
    return rows, None


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
