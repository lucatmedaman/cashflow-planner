#!/usr/bin/env python3
"""Leest alle bestanden in een map in en exporteert ze als één Parquet-bestand.

Elke rij is één bestand: pad, metadata, checksum en — voor tekstbestanden —
de volledige inhoud. Handig om een projectmap in DuckDB/pandas te doorzoeken.

Gebruik:
    python3 tools/files_to_parquet.py                      # huidige map -> bestanden.parquet
    python3 tools/files_to_parquet.py cashflow-cloud -o app.parquet
    python3 tools/files_to_parquet.py --include '*.js' --include '*.jsx'
    python3 tools/files_to_parquet.py --geen-inhoud        # enkel metadata

Vereist: pyarrow (zie tools/requirements.txt).
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import sys
from datetime import datetime, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

# Mappen die standaard overgeslagen worden (afhankelijkheden, build-output, VCS).
STANDAARD_UITGESLOTEN_MAPPEN = (
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "dist",
    "build",
    ".next",
    ".vercel",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".idea",
    ".vscode",
)

# Volgorde waarin we tekst proberen te decoderen; faalt alles -> binair.
CODERINGEN = ("utf-8", "utf-8-sig", "cp1252", "latin-1")

SCHEMA = pa.schema(
    [
        pa.field("pad", pa.string(), nullable=False),
        pa.field("map", pa.string(), nullable=False),
        pa.field("naam", pa.string(), nullable=False),
        pa.field("extensie", pa.string()),
        pa.field("grootte_bytes", pa.int64(), nullable=False),
        pa.field("gewijzigd_utc", pa.timestamp("us", tz="UTC"), nullable=False),
        pa.field("is_tekst", pa.bool_(), nullable=False),
        pa.field("codering", pa.string()),
        pa.field("regels", pa.int64()),
        pa.field("sha256", pa.string(), nullable=False),
        pa.field("inhoud", pa.string()),
        pa.field("inhoud_overgeslagen", pa.string()),
    ]
)


def decodeer(ruwe: bytes) -> tuple[str | None, str | None]:
    """Geeft (tekst, codering) terug, of (None, None) als het binair is."""
    if b"\x00" in ruwe:
        return None, None
    for codering in CODERINGEN:
        try:
            return ruwe.decode(codering), codering
        except UnicodeDecodeError:
            continue
    return None, None


def hoort_erbij(relatief: Path, includes: list[str], excludes: list[str]) -> bool:
    """Past het relatieve pad binnen de include/exclude-globs?"""
    pad = relatief.as_posix()
    kandidaten = (pad, relatief.name)
    if includes and not any(
        fnmatch.fnmatch(k, patroon) for patroon in includes for k in kandidaten
    ):
        return False
    return not any(
        fnmatch.fnmatch(k, patroon) for patroon in excludes for k in kandidaten
    )


def verzamel_bestanden(
    wortel: Path,
    includes: list[str],
    excludes: list[str],
    uitgesloten_mappen: set[str],
    verborgen: bool,
) -> list[Path]:
    """Wandelt de map af en geeft de gesorteerde lijst met te lezen bestanden."""
    gevonden: list[Path] = []
    for pad in sorted(wortel.rglob("*")):
        relatief = pad.relative_to(wortel)
        delen = relatief.parts
        if any(deel in uitgesloten_mappen for deel in delen):
            continue
        if not verborgen and any(deel.startswith(".") for deel in delen):
            continue
        if pad.is_symlink() or not pad.is_file():
            continue
        if not hoort_erbij(relatief, includes, excludes):
            continue
        gevonden.append(pad)
    return gevonden


def lees_bestand(pad: Path, wortel: Path, max_bytes: int, met_inhoud: bool) -> dict:
    """Bouwt één rij op voor het Parquet-bestand."""
    relatief = pad.relative_to(wortel)
    info = pad.stat()
    ruwe = pad.read_bytes()

    tekst: str | None = None
    codering: str | None = None
    regels: int | None = None
    overgeslagen: str | None = None

    if not met_inhoud:
        overgeslagen = "inhoud niet gevraagd"
        is_tekst = decodeer(ruwe[:8192])[0] is not None
    else:
        tekst, codering = decodeer(ruwe)
        is_tekst = tekst is not None
        if not is_tekst:
            overgeslagen = "binair bestand"
        elif info.st_size > max_bytes:
            overgeslagen = f"groter dan {max_bytes} bytes"
            regels = tekst.count("\n") + (0 if tekst.endswith("\n") or not tekst else 1)
            tekst = None
        else:
            regels = tekst.count("\n") + (0 if tekst.endswith("\n") or not tekst else 1)

    return {
        "pad": relatief.as_posix(),
        "map": relatief.parent.as_posix(),
        "naam": pad.name,
        "extensie": pad.suffix.lower() or None,
        "grootte_bytes": info.st_size,
        "gewijzigd_utc": datetime.fromtimestamp(info.st_mtime, tz=timezone.utc),
        "is_tekst": is_tekst,
        "codering": codering,
        "regels": regels,
        "sha256": hashlib.sha256(ruwe).hexdigest(),
        "inhoud": tekst,
        "inhoud_overgeslagen": overgeslagen,
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Lees alle bestanden in een map in en exporteer ze als Parquet.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "map", nargs="?", default=".", help="map die ingelezen wordt (recursief)"
    )
    parser.add_argument(
        "-o", "--output", default="bestanden.parquet", help="pad van het Parquet-bestand"
    )
    parser.add_argument(
        "--include",
        action="append",
        default=[],
        metavar="GLOB",
        help="enkel bestanden die matchen (herhaalbaar), bv. '*.js'",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="GLOB",
        help="bestanden die overgeslagen worden (herhaalbaar)",
    )
    parser.add_argument(
        "--exclude-map",
        action="append",
        default=[],
        metavar="NAAM",
        help="extra mapnaam om over te slaan (herhaalbaar)",
    )
    parser.add_argument(
        "--alle-mappen",
        action="store_true",
        help=f"sla geen enkele map over (standaard: {', '.join(STANDAARD_UITGESLOTEN_MAPPEN)})",
    )
    parser.add_argument(
        "--verborgen", action="store_true", help="neem verborgen bestanden/mappen mee"
    )
    parser.add_argument(
        "--max-bytes",
        type=int,
        default=5 * 1024 * 1024,
        help="tekstbestanden groter dan dit krijgen geen inhoud mee",
    )
    parser.add_argument(
        "--geen-inhoud",
        action="store_true",
        help="exporteer enkel metadata, zonder de kolom inhoud te vullen",
    )
    parser.add_argument(
        "--compressie",
        default="zstd",
        choices=["zstd", "snappy", "gzip", "brotli", "lz4", "none"],
        help="compressie van het Parquet-bestand",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    wortel = Path(args.map).resolve()
    if not wortel.is_dir():
        print(f"fout: '{args.map}' is geen map", file=sys.stderr)
        return 1

    uitgesloten_mappen: set[str] = set(args.exclude_map)
    if not args.alle_mappen:
        uitgesloten_mappen.update(STANDAARD_UITGESLOTEN_MAPPEN)

    uitvoer = Path(args.output).resolve()
    excludes = list(args.exclude)

    bestanden = verzamel_bestanden(
        wortel, args.include, excludes, uitgesloten_mappen, args.verborgen
    )
    # Nooit het doelbestand zelf mee inlezen (bv. bij herhaald draaien in dezelfde map).
    bestanden = [p for p in bestanden if p.resolve() != uitvoer]

    if not bestanden:
        print("fout: geen bestanden gevonden met deze filters", file=sys.stderr)
        return 1

    rijen: list[dict] = []
    for pad in bestanden:
        try:
            rijen.append(lees_bestand(pad, wortel, args.max_bytes, not args.geen_inhoud))
        except OSError as fout:
            print(f"overgeslagen ({fout.strerror}): {pad}", file=sys.stderr)

    if not rijen:
        print("fout: geen enkel bestand kon gelezen worden", file=sys.stderr)
        return 1

    tabel = pa.Table.from_pylist(rijen, schema=SCHEMA)
    uitvoer.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(
        tabel,
        uitvoer,
        compression=None if args.compressie == "none" else args.compressie,
    )

    totaal = sum(rij["grootte_bytes"] for rij in rijen)
    tekst = sum(1 for rij in rijen if rij["is_tekst"])
    print(
        f"{len(rijen)} bestanden ({tekst} tekst, {len(rijen) - tekst} binair, "
        f"{totaal / 1024:.1f} KiB) -> {uitvoer} "
        f"({uitvoer.stat().st_size / 1024:.1f} KiB)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
