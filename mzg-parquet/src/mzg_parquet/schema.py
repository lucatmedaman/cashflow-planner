"""De recordtekeningen: welke velden staan in welk MZG-bestand, en hoe."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

STANDAARD_SCHEMA = Path(__file__).with_name("mzg_schema.json")

# XXX-Z-VERS-D-TABEL-YYYY-P.TXT, bv. 001-Z-3.0-S-HOSPITAL-2015-1.TXT
BESTANDSNAAM = re.compile(
    r"^(?P<code_agr>\w{3})-(?P<soort>\w)-(?P<versie>[\d.]+)-(?P<domein>[SPAMF])-"
    r"(?P<tabel>[A-Z0-9_]+)-(?P<jaar>\d{4})-(?P<periode>\d+)$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Veld:
    """Eén veld uit een recordtekening.

    min_lengte en max_lengte gelden voor een ingevulde waarde; een optioneel
    veld mag altijd leeg zijn (in de richtlijnen genoteerd als "0 of 4").
    """

    nr: int
    naam: str
    omschrijving: str
    verplicht: bool
    vaste_lengte: bool
    datatype: str          # C (karakter), N (numeriek), ND2 (2 decimalen), D (datum)
    lengte: str | None     # letterlijk zoals in de richtlijnen, bv. "0 of 1-2"
    min_lengte: int | None
    max_lengte: int | None
    sleutelveld: bool
    foreign_key: str | None


@dataclass(frozen=True)
class Recordtekening:
    """De velddefinities van één MZG-bestand, bv. STAYHOSP (A2)."""

    code: str              # A2
    tabel: str             # STAYHOSP
    domein: str            # A
    domeinnaam: str        # Administratieve gegevens
    bron: str
    velden: tuple[Veld, ...]

    def __len__(self) -> int:
        return len(self.velden)

    @property
    def sleutelvelden(self) -> tuple[Veld, ...]:
        return tuple(v for v in self.velden if v.sleutelveld)


@dataclass(frozen=True)
class Bestandsnaam:
    """De onderdelen van een MZG-bestandsnaam."""

    code_agr: str
    soort: str
    versie: str
    domein: str
    tabel: str
    jaar: int
    periode: int


class Schema:
    """Alle gekende recordtekeningen, opzoekbaar op code (A2) of tabel (STAYHOSP)."""

    def __init__(self, versie: str, bestanden: dict[str, Recordtekening]):
        self.versie = versie
        self._op_code = bestanden
        self._op_tabel = {r.tabel: r for r in bestanden.values()}

    def __len__(self) -> int:
        return len(self._op_code)

    def __iter__(self):
        """Loopt in domeinvolgorde: A1..A7, F3..F5, M1..M6, P1, P2, S1..S8."""
        return iter(sorted(self._op_code.values(), key=lambda r: (r.code[0], int(r.code[1:]))))

    def __contains__(self, sleutel: str) -> bool:
        sleutel = sleutel.upper()
        return sleutel in self._op_code or sleutel in self._op_tabel

    def __getitem__(self, sleutel: str) -> Recordtekening:
        sleutel = sleutel.upper()
        if sleutel in self._op_code:
            return self._op_code[sleutel]
        if sleutel in self._op_tabel:
            return self._op_tabel[sleutel]
        raise KeyError(f"onbekend MZG-bestand: {sleutel}")

    def get(self, sleutel: str) -> Recordtekening | None:
        try:
            return self[sleutel]
        except KeyError:
            return None


def laad_schema(pad: Path | str | None = None) -> Schema:
    """Leest mzg_schema.json in (standaard het schema dat bij het pakket zit)."""
    pad = Path(pad) if pad else STANDAARD_SCHEMA
    rauw = json.loads(pad.read_text(encoding="utf-8"))
    bestanden = {
        code: Recordtekening(
            code=d["code"],
            tabel=d["tabel"],
            domein=d["domein"],
            domeinnaam=d["domeinnaam"],
            bron=d["bron"],
            velden=tuple(Veld(**v) for v in d["velden"]),
        )
        for code, d in rauw["bestanden"].items()
    }
    return Schema(rauw.get("versie", ""), bestanden)


def herken_bestandsnaam(naam: str) -> Bestandsnaam | None:
    """Ontleedt XXX-Z-VERS-D-TABEL-YYYY-P(.TXT); None als de naam niet past."""
    m = BESTANDSNAAM.match(Path(naam).stem)
    if not m:
        return None
    delen = m.groupdict()
    return Bestandsnaam(
        code_agr=delen["code_agr"],
        soort=delen["soort"].upper(),
        versie=delen["versie"],
        domein=delen["domein"].upper(),
        tabel=delen["tabel"].upper(),
        jaar=int(delen["jaar"]),
        periode=int(delen["periode"]),
    )
