"""Commandoregel: MZG-bestanden inlezen en als Parquet wegschrijven."""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

from mzg_parquet import __version__
from mzg_parquet.export import schrijf_parquet, typeer
from mzg_parquet.lezer import Fout, Veldfout, lees_bestand
from mzg_parquet.schema import Recordtekening, Schema, herken_bestandsnaam, laad_schema

INVOER_EXTENSIES = (".txt", ".dat", "")


def verzamel_invoer(paden: list[str]) -> list[Path]:
    """Bestanden uit de opgegeven paden; mappen worden recursief doorlopen."""
    uit: list[Path] = []
    for p in paden:
        pad = Path(p)
        if pad.is_dir():
            uit += sorted(k for k in pad.rglob("*")
                          if k.is_file() and k.suffix.lower() in INVOER_EXTENSIES)
        else:
            uit.append(pad)
    return uit


def kies_recordtekening(pad: Path, schema: Schema) -> Recordtekening:
    """Leidt de recordtekening af uit de bestandsnaam."""
    naam = herken_bestandsnaam(pad.name)
    if not naam:
        raise Fout("bestandsnaam volgt niet het patroon XXX-Z-VERS-D-TABEL-YYYY-P.TXT; "
                   "gebruik --tabel om de recordtekening op te geven")
    tekening = schema.get(naam.tabel)
    if not tekening:
        raise Fout(f"onbekende tabel '{naam.tabel}' in de bestandsnaam")
    return tekening


def toon_lijst(schema: Schema) -> None:
    for r in schema:
        print(f"{r.code:3s} {r.tabel:9s} {len(r):2d} velden  domein {r.domein} - {r.domeinnaam}")


def toon_tabel(schema: Schema, sleutel: str) -> int:
    tekening = schema.get(sleutel)
    if not tekening:
        print(f"onbekend bestand '{sleutel}'; --lijst toont de mogelijkheden", file=sys.stderr)
        return 1
    print(f"{tekening.code} {tekening.tabel} - {tekening.domeinnaam}\nbron: {tekening.bron}\n")
    print(f"{'nr':>3} {'veldnaam':32s} {'M/O':3s} {'F/V':3s} {'type':4s} {'lengte':22s} {'pk':2s} fk")
    for v in tekening.velden:
        print(f"{v.nr:3d} {v.naam:32s} {'M' if v.verplicht else 'O':3s} "
              f"{'F' if v.vaste_lengte else 'V':3s} {v.datatype or '':4s} "
              f"{v.lengte or '':22s} {'pk' if v.sleutelveld else '':2s} {v.foreign_key or ''}")
    return 0


def schrijf_foutenbestand(fouten: list[Veldfout], doel: Path) -> None:
    with open(doel, "w", newline="", encoding="utf-8") as fh:
        schrijver = csv.writer(fh)
        schrijver.writerow(["bestand", "recordnr", "veld", "waarde", "fout"])
        for f in fouten:
            schrijver.writerow([f.bestand, f.recordnr, f.veld, f.waarde, f.fout])


def vat_fouten_samen(fouten: list[Veldfout]) -> list[tuple[str, int]]:
    """Groepeert fouten per soort, met de getallen weggelaten."""
    soorten: dict[str, int] = {}
    for f in fouten:
        sleutel = re.sub(r"\d+", "N", f.fout)
        soorten[sleutel] = soorten.get(sleutel, 0) + 1
    return sorted(soorten.items(), key=lambda kv: -kv[1])


def maak_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mzg-parquet",
        description="Lees MZG/RHM-registratiebestanden in en exporteer ze als Parquet.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("invoer", nargs="*", help="MZG-bestanden en/of mappen daarmee")
    parser.add_argument("-o", "--output", default="parquet", type=Path,
                        help="map voor de Parquet-bestanden (één per tabel)")
    parser.add_argument("--tabel", metavar="CODE",
                        help="forceer de recordtekening (bv. S1 of HOSPITAL) voor alle invoer")
    parser.add_argument("--schema", type=Path,
                        help="ander mzg_schema.json dan dat van het pakket")
    parser.add_argument("--codering", default="cp1252", help="tekenset van de invoer")
    parser.add_argument("--alles-tekst", action="store_true",
                        help="lees elk veld als tekst in (verliest niets, typeert niets)")
    parser.add_argument("--bedrag-als-float", action="store_true",
                        help="ND2-velden als float64 i.p.v. decimal(18,2)")
    parser.add_argument("--compressie", default="zstd",
                        choices=["zstd", "snappy", "gzip", "brotli", "lz4", "none"])
    parser.add_argument("--fouten", type=Path, metavar="CSV",
                        help="schrijf alle vastgestelde fouten naar dit CSV-bestand")
    parser.add_argument("--streng", action="store_true",
                        help="stop met exitcode 1 zodra er één fout vastgesteld is")
    parser.add_argument("--lijst", action="store_true",
                        help="toon alle gekende MZG-bestanden en stop")
    parser.add_argument("--toon", metavar="CODE",
                        help="toon de recordtekening van één bestand en stop")
    parser.add_argument("--versie", action="version", version=f"mzg-parquet {__version__}")
    return parser


def main(argv: list[str] | None = None) -> int:
    opties = maak_parser().parse_args(argv)
    try:
        schema = laad_schema(opties.schema)
    except OSError as exc:
        print(f"fout: schema niet leesbaar: {exc}", file=sys.stderr)
        return 1

    if opties.lijst:
        toon_lijst(schema)
        return 0
    if opties.toon:
        return toon_tabel(schema, opties.toon)
    if not opties.invoer:
        print("fout: geef minstens één bestand of map op (of gebruik --lijst/--toon)",
              file=sys.stderr)
        return 1

    geforceerd = None
    if opties.tabel:
        geforceerd = schema.get(opties.tabel)
        if not geforceerd:
            print(f"fout: onbekende tabel '{opties.tabel}'", file=sys.stderr)
            return 1

    invoer = verzamel_invoer(opties.invoer)
    if not invoer:
        print("fout: geen invoerbestanden gevonden", file=sys.stderr)
        return 1

    per_tabel: dict[str, list[dict]] = {}
    tekeningen: dict[str, Recordtekening] = {}
    alle_fouten: list[Veldfout] = []
    overgeslagen = 0

    for pad in invoer:
        if not pad.is_file():
            print(f"overgeslagen (bestaat niet): {pad}", file=sys.stderr)
            overgeslagen += 1
            continue
        try:
            tekening = geforceerd or kies_recordtekening(pad, schema)
            rijen, fouten = lees_bestand(pad, tekening, opties.codering)
        except Fout as exc:
            print(f"overgeslagen ({exc}): {pad.name}", file=sys.stderr)
            overgeslagen += 1
            continue
        rijen, typefouten = typeer(rijen, tekening, opties.bedrag_als_float, opties.alles_tekst)
        fouten += typefouten
        per_tabel.setdefault(tekening.code, []).extend(rijen)
        tekeningen[tekening.code] = tekening
        alle_fouten += fouten
        print(f"{pad.name}: {len(rijen)} records als {tekening.code} "
              f"({tekening.tabel}), {len(fouten)} fouten")

    if not per_tabel:
        print("fout: geen enkel bestand kon ingelezen worden", file=sys.stderr)
        return 1

    for code in sorted(per_tabel, key=lambda c: (c[0], int(c[1:]))):
        tekening = tekeningen[code]
        doel = opties.output / f"{tekening.tabel}.parquet"
        tabel = schrijf_parquet(per_tabel[code], tekening, doel, opties.bedrag_als_float,
                                opties.alles_tekst, opties.compressie)
        print(f"-> {doel} ({tabel.num_rows} records, {tabel.num_columns} kolommen, "
              f"{doel.stat().st_size / 1024:.1f} KiB)")

    if opties.fouten and alle_fouten:
        schrijf_foutenbestand(alle_fouten, opties.fouten)
        print(f"-> {opties.fouten} ({len(alle_fouten)} fouten)")

    if alle_fouten:
        print(f"\n{len(alle_fouten)} fouten vastgesteld:", file=sys.stderr)
        for soort, aantal in vat_fouten_samen(alle_fouten)[:10]:
            print(f"  {aantal:6d}x {soort}", file=sys.stderr)

    return 1 if opties.streng and (alle_fouten or overgeslagen) else 0


if __name__ == "__main__":
    raise SystemExit(main())
