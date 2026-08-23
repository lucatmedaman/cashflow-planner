#!/usr/bin/env python3
"""Leest MZG/RHM-registratiebestanden in en exporteert ze als Parquet.

De velddefinities komen uit mzg_schema.json, dat afgeleid is uit de
recordtekeningen in de richtlijnen van de FOD Volksgezondheid (domein 1
Structuurgegevens, 2 Personeelsgegevens, 3 Administratieve gegevens,
5 Medische gegevens en 6 Facturatiegegevens).

Een MZG-bestand is een tekstbestand met per regel één record. De velden staan
in de volgorde van de recordtekening en worden afgesloten door een #:

    001#2015#1#2007#1#1####          (HOSPITAL, 9 velden, 3 lege einddatumvelden)

De bestandsnaam bepaalt welke recordtekening geldt:

    XXX-Z-VERS-D-TABEL-YYYY-P.TXT    bv. 001-Z-3.0-S-HOSPITAL-2015-1.TXT

Gebruik:
    python3 tools/mzg_to_parquet.py mzg/ -o parquet/
    python3 tools/mzg_to_parquet.py 001-Z-3.0-S-HOSPITAL-2015-1.TXT -o parquet/
    python3 tools/mzg_to_parquet.py raar_genoemd.txt --tabel S1 -o parquet/
    python3 tools/mzg_to_parquet.py mzg/ -o parquet/ --fouten fouten.csv --streng
    python3 tools/mzg_to_parquet.py --toon A2        # recordtekening tonen
    python3 tools/mzg_to_parquet.py --lijst          # alle gekende bestanden

Vereist: pyarrow (zie tools/requirements.txt).
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import re
import sys
from decimal import Decimal, InvalidOperation
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

SCHEMA_PAD = Path(__file__).with_name("mzg_schema.json")

# XXX-Z-VERS-D-TABEL-YYYY-P.TXT, bv. 001-Z-3.0-S-HOSPITAL-2015-1.TXT
BESTANDSNAAM = re.compile(
    r"^(?P<code_agr>\w{3})-(?P<soort>\w)-(?P<versie>[\d.]+)-(?P<domein>[SPAMF])-"
    r"(?P<tabel>[A-Z0-9_]+)-(?P<jaar>\d{4})-(?P<periode>\d+)$",
    re.IGNORECASE,
)

SCHEIDINGSTEKEN = "#"


class Fout(Exception):
    """Fout die het inlezen van een bestand onmogelijk maakt."""


def laad_schema(pad: Path) -> dict:
    schema = json.loads(pad.read_text())
    return schema["bestanden"]


def herken_bestand(pad: Path, bestanden: dict) -> tuple[str, dict]:
    """Leidt de recordtekening af uit de bestandsnaam."""
    m = BESTANDSNAAM.match(pad.stem)
    if not m:
        raise Fout(
            f"bestandsnaam volgt niet het patroon XXX-Z-VERS-D-TABEL-YYYY-P.TXT; "
            f"gebruik --tabel om de recordtekening op te geven"
        )
    tabel = m.group("tabel").upper()
    for code, definitie in bestanden.items():
        if definitie["tabel"] == tabel:
            return code, m.groupdict()
    raise Fout(f"onbekende tabel '{tabel}' in de bestandsnaam")


# --- typering --------------------------------------------------------------

def pa_type(datatype: str, bedrag_als_float: bool) -> pa.DataType:
    if datatype == "N":
        return pa.int64()
    if datatype == "ND2":
        return pa.float64() if bedrag_als_float else pa.decimal128(18, 2)
    if datatype == "D":
        return pa.date32()
    return pa.string()


def zet_om(waarde: str, datatype: str, bedrag_als_float: bool):
    """Zet één veldwaarde om; lege waarden worden null. Gooit ValueError bij fout."""
    if waarde == "":
        return None
    if datatype == "N":
        return int(waarde)
    if datatype == "ND2":
        if bedrag_als_float:
            return float(waarde)
        try:
            return Decimal(waarde).quantize(Decimal("0.01"))
        except InvalidOperation as exc:
            raise ValueError(str(exc)) from exc
    if datatype == "D":  # formaat JJJJMMDD
        if len(waarde) != 8 or not waarde.isdigit():
            raise ValueError(f"geen datum JJJJMMDD: {waarde!r}")
        return dt.date(int(waarde[:4]), int(waarde[4:6]), int(waarde[6:]))
    return waarde


def bouw_pa_schema(definitie: dict, bedrag_als_float: bool, alles_tekst: bool) -> pa.Schema:
    velden = [
        pa.field(v["naam"], pa.string() if alles_tekst
                 else pa_type(v["datatype"], bedrag_als_float))
        for v in definitie["velden"]
    ]
    velden += [pa.field("_bronbestand", pa.string()), pa.field("_recordnr", pa.int64())]
    return pa.schema(velden, metadata={
        "mzg_code": definitie["code"],
        "mzg_tabel": definitie["tabel"],
        "mzg_domein": definitie["domeinnaam"],
        "mzg_bron": definitie["bron"],
    })


# --- inlezen ---------------------------------------------------------------

def splits_record(regel: str) -> list[str]:
    """Splitst een record in velden; het record eindigt op een scheidingsteken."""
    if not regel.endswith(SCHEIDINGSTEKEN):
        raise ValueError("record eindigt niet op '#'")
    return regel.split(SCHEIDINGSTEKEN)[:-1]


def controleer_veld(waarde: str, veld: dict) -> str | None:
    """Geeft een omschrijving van de eerste inhoudelijke fout, of None."""
    if waarde == "":
        return "verplicht veld is leeg" if veld["verplicht"] else None
    # min_lengte/max_lengte gelden voor een ingevulde waarde; leeg mag zodra
    # het veld optioneel is (in de richtlijnen genoteerd als "0 of 4")
    mn, mx = veld["min_lengte"], veld["max_lengte"]
    if mn is not None and len(waarde) < mn:
        return f"korter dan {mn} karakters (lengte {len(waarde)})"
    if mx is not None and len(waarde) > mx:
        return f"langer dan {mx} karakters (lengte {len(waarde)})"
    return None


def lees_bestand(pad: Path, definitie: dict, opties) -> tuple[list[dict], list[dict]]:
    """Leest één MZG-bestand; geeft (rijen, fouten) terug."""
    velden = definitie["velden"]
    rijen, fouten = [], []
    ruwe = pad.read_bytes()
    try:
        tekst = ruwe.decode(opties.codering)
    except UnicodeDecodeError as exc:
        raise Fout(f"kan niet decoderen als {opties.codering}: {exc}") from exc

    for nr, regel in enumerate(tekst.splitlines(), start=1):
        regel = regel.strip("\r\n").rstrip()
        if not regel:
            continue
        try:
            waarden = splits_record(regel)
        except ValueError as exc:
            fouten.append({"bestand": pad.name, "recordnr": nr, "veld": "",
                           "waarde": regel[:60], "fout": str(exc)})
            continue
        if len(waarden) != len(velden):
            fouten.append({"bestand": pad.name, "recordnr": nr, "veld": "",
                           "waarde": regel[:60],
                           "fout": f"{len(waarden)} velden i.p.v. {len(velden)}"})
            continue

        rij = {"_bronbestand": pad.name, "_recordnr": nr}
        for veld, waarde in zip(velden, waarden):
            probleem = controleer_veld(waarde, veld)
            if probleem:
                fouten.append({"bestand": pad.name, "recordnr": nr,
                               "veld": veld["naam"], "waarde": waarde[:60],
                               "fout": probleem})
            if opties.alles_tekst:
                rij[veld["naam"]] = waarde
                continue
            try:
                rij[veld["naam"]] = zet_om(waarde, veld["datatype"], opties.bedrag_als_float)
            except ValueError as exc:
                fouten.append({"bestand": pad.name, "recordnr": nr,
                               "veld": veld["naam"], "waarde": waarde[:60],
                               "fout": f"niet leesbaar als type {veld['datatype']}: {exc}"})
                rij[veld["naam"]] = None
        rijen.append(rij)
    return rijen, fouten


# --- weergave --------------------------------------------------------------

def toon_lijst(bestanden: dict) -> None:
    for code in sorteer(bestanden):
        d = bestanden[code]
        print(f"{code:3s} {d['tabel']:9s} {len(d['velden']):2d} velden  "
              f"domein {d['domein']} - {d['domeinnaam']}")


def toon_tabel(bestanden: dict, code: str) -> int:
    code = code.upper()
    if code not in bestanden:
        op_tabel = {d["tabel"]: c for c, d in bestanden.items()}
        code = op_tabel.get(code, "")
        if not code:
            print("onbekend bestand; gebruik --lijst voor de mogelijkheden", file=sys.stderr)
            return 1
    d = bestanden[code]
    print(f"{d['code']} {d['tabel']} - {d['domeinnaam']}\nbron: {d['bron']}\n")
    print(f"{'nr':>3} {'veldnaam':32s} {'M/O':3s} {'F/V':3s} {'type':4s} "
          f"{'lengte':22s} {'pk':2s} fk")
    for v in d["velden"]:
        print(f"{v['nr']:3d} {v['naam']:32s} {'M' if v['verplicht'] else 'O':3s} "
              f"{'F' if v['vaste_lengte'] else 'V':3s} {str(v['datatype']):4s} "
              f"{str(v['lengte'] or ''):22s} {'pk' if v['sleutelveld'] else '':2s} "
              f"{v['foreign_key'] or ''}")
    return 0


def sorteer(codes):
    return sorted(codes, key=lambda c: (c[0], int(c[1:])))


# --- hoofdprogramma --------------------------------------------------------

def verzamel_invoer(paden: list[str]) -> list[Path]:
    uit: list[Path] = []
    for p in paden:
        pad = Path(p)
        if pad.is_dir():
            uit += sorted(k for k in pad.rglob("*")
                          if k.is_file() and k.suffix.lower() in (".txt", ".dat", ""))
        else:
            uit.append(pad)
    return uit


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Lees MZG/RHM-bestanden in en exporteer ze als Parquet.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("invoer", nargs="*",
                        help="MZG-bestanden en/of mappen met MZG-bestanden")
    parser.add_argument("-o", "--output", default="parquet",
                        help="map waarin de Parquet-bestanden komen (één per tabel)")
    parser.add_argument("--tabel", metavar="CODE",
                        help="forceer de recordtekening (bv. S1 of HOSPITAL) voor alle invoer")
    parser.add_argument("--schema", type=Path, default=SCHEMA_PAD,
                        help="pad naar mzg_schema.json")
    parser.add_argument("--codering", default="cp1252",
                        help="tekenset van de invoerbestanden")
    parser.add_argument("--alles-tekst", action="store_true",
                        help="lees elk veld als tekst in (verliest niets, typeert niets)")
    parser.add_argument("--bedrag-als-float", action="store_true",
                        help="ND2-velden als float64 i.p.v. decimal(18,2)")
    parser.add_argument("--compressie", default="zstd",
                        choices=["zstd", "snappy", "gzip", "brotli", "lz4", "none"],
                        help="compressie van het Parquet-bestand")
    parser.add_argument("--fouten", type=Path, metavar="CSV",
                        help="schrijf alle vastgestelde fouten naar dit CSV-bestand")
    parser.add_argument("--streng", action="store_true",
                        help="stop met exitcode 1 zodra er één fout vastgesteld is")
    parser.add_argument("--lijst", action="store_true",
                        help="toon alle gekende MZG-bestanden en stop")
    parser.add_argument("--toon", metavar="CODE",
                        help="toon de recordtekening van één bestand en stop")
    return parser.parse_args(argv)


def main(argv=None) -> int:
    opties = parse_args(argv)
    if not opties.schema.is_file():
        print(f"fout: schema niet gevonden: {opties.schema}", file=sys.stderr)
        return 1
    bestanden = laad_schema(opties.schema)

    if opties.lijst:
        toon_lijst(bestanden)
        return 0
    if opties.toon:
        return toon_tabel(bestanden, opties.toon)
    if not opties.invoer:
        print("fout: geef minstens één bestand of map op (of gebruik --lijst/--toon)",
              file=sys.stderr)
        return 1

    geforceerd = None
    if opties.tabel:
        op_tabel = {d["tabel"]: c for c, d in bestanden.items()}
        geforceerd = opties.tabel.upper()
        geforceerd = geforceerd if geforceerd in bestanden else op_tabel.get(geforceerd)
        if not geforceerd:
            print(f"fout: onbekende tabel '{opties.tabel}'", file=sys.stderr)
            return 1

    invoer = verzamel_invoer(opties.invoer)
    if not invoer:
        print("fout: geen invoerbestanden gevonden", file=sys.stderr)
        return 1

    per_tabel: dict[str, list[dict]] = {}
    alle_fouten: list[dict] = []
    overgeslagen = 0
    for pad in invoer:
        if not pad.is_file():
            print(f"overgeslagen (bestaat niet): {pad}", file=sys.stderr)
            overgeslagen += 1
            continue
        try:
            code = geforceerd or herken_bestand(pad, bestanden)[0]
            rijen, fouten = lees_bestand(pad, bestanden[code], opties)
        except Fout as exc:
            print(f"overgeslagen ({exc}): {pad.name}", file=sys.stderr)
            overgeslagen += 1
            continue
        per_tabel.setdefault(code, []).extend(rijen)
        alle_fouten.extend(fouten)
        print(f"{pad.name}: {len(rijen)} records als {code} "
              f"({bestanden[code]['tabel']}), {len(fouten)} fouten")

    if not per_tabel:
        print("fout: geen enkel bestand kon ingelezen worden", file=sys.stderr)
        return 1

    uitmap = Path(opties.output)
    uitmap.mkdir(parents=True, exist_ok=True)
    for code in sorteer(per_tabel):
        definitie = bestanden[code]
        tabel = pa.Table.from_pylist(
            per_tabel[code],
            schema=bouw_pa_schema(definitie, opties.bedrag_als_float, opties.alles_tekst),
        )
        doel = uitmap / f"{definitie['tabel']}.parquet"
        pq.write_table(tabel, doel,
                       compression=None if opties.compressie == "none" else opties.compressie)
        print(f"-> {doel} ({tabel.num_rows} records, {tabel.num_columns} kolommen, "
              f"{doel.stat().st_size / 1024:.1f} KiB)")

    if opties.fouten and alle_fouten:
        with open(opties.fouten, "w", newline="") as fh:
            schrijver = csv.DictWriter(
                fh, fieldnames=["bestand", "recordnr", "veld", "waarde", "fout"])
            schrijver.writeheader()
            schrijver.writerows(alle_fouten)
        print(f"-> {opties.fouten} ({len(alle_fouten)} fouten)")

    if alle_fouten:
        soorten: dict[str, int] = {}
        for f in alle_fouten:
            sleutel = re.sub(r"\d+", "N", f["fout"])
            soorten[sleutel] = soorten.get(sleutel, 0) + 1
        print(f"\n{len(alle_fouten)} fouten vastgesteld:", file=sys.stderr)
        for soort, aantal in sorted(soorten.items(), key=lambda kv: -kv[1])[:10]:
            print(f"  {aantal:6d}x {soort}", file=sys.stderr)

    if opties.streng and (alle_fouten or overgeslagen):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
