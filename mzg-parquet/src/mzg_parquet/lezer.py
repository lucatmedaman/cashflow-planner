"""Records uit een MZG-bestand halen en aftoetsen aan de recordtekening.

Een MZG-bestand bevat één record per regel. De velden staan in de volgorde van
de recordtekening en worden elk afgesloten door een #:

    001#2015#1#2007#1#1####      HOSPITAL: 9 velden, de 3 laatste zijn leeg
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from mzg_parquet.schema import Recordtekening, Veld

SCHEIDINGSTEKEN = "#"


class Fout(Exception):
    """Fout die het inlezen van een heel bestand onmogelijk maakt."""


@dataclass(frozen=True)
class Veldfout:
    """Eén vastgestelde afwijking van de recordtekening."""

    bestand: str
    recordnr: int
    veld: str        # leeg als de fout op het hele record slaat
    waarde: str
    fout: str


def splits_record(regel: str) -> list[str]:
    """Splitst een record in zijn velden; het record eindigt op een #."""
    if not regel.endswith(SCHEIDINGSTEKEN):
        raise ValueError("record eindigt niet op '#'")
    return regel.split(SCHEIDINGSTEKEN)[:-1]


def controleer_veld(waarde: str, veld: Veld) -> str | None:
    """Geeft de eerste afwijking van de recordtekening terug, of None."""
    if waarde == "":
        return "verplicht veld is leeg" if veld.verplicht else None
    if veld.min_lengte is not None and len(waarde) < veld.min_lengte:
        return f"korter dan {veld.min_lengte} karakters (lengte {len(waarde)})"
    if veld.max_lengte is not None and len(waarde) > veld.max_lengte:
        return f"langer dan {veld.max_lengte} karakters (lengte {len(waarde)})"
    return None


def lees_regels(pad: Path, codering: str = "cp1252") -> Iterator[tuple[int, str]]:
    """Geeft (regelnummer, record) voor elke niet-lege regel."""
    try:
        tekst = pad.read_bytes().decode(codering)
    except UnicodeDecodeError as exc:
        raise Fout(f"kan niet decoderen als {codering}: {exc}") from exc
    except OSError as exc:
        raise Fout(f"kan niet gelezen worden: {exc.strerror}") from exc
    for nr, regel in enumerate(tekst.splitlines(), start=1):
        regel = regel.rstrip()
        if regel:
            yield nr, regel


def lees_bestand(
    pad: Path,
    recordtekening: Recordtekening,
    codering: str = "cp1252",
) -> tuple[list[dict[str, str]], list[Veldfout]]:
    """Leest één MZG-bestand in als lijst van velddictionaries.

    Alle waarden blijven tekst; typeren gebeurt in mzg_parquet.export. Records
    met een verkeerd aantal velden worden overgeslagen, want dan is niet uit te
    maken welke waarde bij welk veld hoort.
    """
    velden = recordtekening.velden
    rijen: list[dict[str, str]] = []
    fouten: list[Veldfout] = []

    for nr, regel in lees_regels(pad, codering):
        try:
            waarden = splits_record(regel)
        except ValueError as exc:
            fouten.append(Veldfout(pad.name, nr, "", regel[:60], str(exc)))
            continue
        if len(waarden) != len(velden):
            fouten.append(Veldfout(pad.name, nr, "", regel[:60],
                                   f"{len(waarden)} velden i.p.v. {len(velden)}"))
            continue

        rij = {"_bronbestand": pad.name, "_recordnr": nr}
        for veld, waarde in zip(velden, waarden):
            probleem = controleer_veld(waarde, veld)
            if probleem:
                fouten.append(Veldfout(pad.name, nr, veld.naam, waarde[:60], probleem))
            rij[veld.naam] = waarde
        rijen.append(rij)
    return rijen, fouten
