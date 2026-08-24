"""Ingelezen records typeren en wegschrijven als Parquet."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal, InvalidOperation
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from mzg_parquet.lezer import Veldfout
from mzg_parquet.schema import Recordtekening

# Kolom C3 van de recordtekening -> Parquet-type
TYPES = {
    "C": pa.string,        # ook codes met voorloopnullen, bv. CODE_AGR = 001
    "N": pa.int64,
    "D": pa.date32,        # brongegeven in JJJJMMDD
}


def pa_type(datatype: str, bedrag_als_float: bool = False) -> pa.DataType:
    if datatype == "ND2":
        return pa.float64() if bedrag_als_float else pa.decimal128(18, 2)
    return TYPES.get(datatype, pa.string)()


def zet_om(waarde: str, datatype: str, bedrag_als_float: bool = False):
    """Zet één veldwaarde om naar zijn type; leeg wordt None."""
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
            raise ValueError(f"geen bedrag met 2 decimalen: {waarde!r}") from exc
    if datatype == "D":
        if len(waarde) != 8 or not waarde.isdigit():
            raise ValueError(f"geen datum JJJJMMDD: {waarde!r}")
        return dt.date(int(waarde[:4]), int(waarde[4:6]), int(waarde[6:]))
    return waarde


def bouw_pa_schema(
    recordtekening: Recordtekening,
    bedrag_als_float: bool = False,
    alles_tekst: bool = False,
) -> pa.Schema:
    """Het Parquet-schema van één MZG-bestand, plus de herkomstkolommen."""
    velden = [
        pa.field(v.naam, pa.string() if alles_tekst else pa_type(v.datatype, bedrag_als_float))
        for v in recordtekening.velden
    ]
    velden += [pa.field("_bronbestand", pa.string()), pa.field("_recordnr", pa.int64())]
    return pa.schema(velden, metadata={
        "mzg_code": recordtekening.code,
        "mzg_tabel": recordtekening.tabel,
        "mzg_domein": recordtekening.domeinnaam,
        "mzg_bron": recordtekening.bron,
    })


def typeer(
    rijen: list[dict],
    recordtekening: Recordtekening,
    bedrag_als_float: bool = False,
    alles_tekst: bool = False,
) -> tuple[list[dict], list[Veldfout]]:
    """Zet de tekstwaarden om naar hun type.

    Een waarde die niet in haar type past wordt None; de reden komt in de
    foutenlijst. Met alles_tekst blijft alles zoals het in het bestand stond.
    """
    if alles_tekst:
        return rijen, []
    fouten: list[Veldfout] = []
    for rij in rijen:
        for veld in recordtekening.velden:
            try:
                rij[veld.naam] = zet_om(rij[veld.naam], veld.datatype, bedrag_als_float)
            except ValueError as exc:
                fouten.append(Veldfout(rij["_bronbestand"], rij["_recordnr"], veld.naam,
                                       str(rij[veld.naam])[:60],
                                       f"niet leesbaar als type {veld.datatype}: {exc}"))
                rij[veld.naam] = None
    return rijen, fouten


def schrijf_parquet(
    rijen: list[dict],
    recordtekening: Recordtekening,
    doel: Path,
    bedrag_als_float: bool = False,
    alles_tekst: bool = False,
    compressie: str = "zstd",
) -> pa.Table:
    """Schrijft de records van één MZG-bestand weg als Parquet."""
    tabel = pa.Table.from_pylist(
        rijen, schema=bouw_pa_schema(recordtekening, bedrag_als_float, alles_tekst))
    doel.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(tabel, doel, compression=None if compressie == "none" else compressie)
    return tabel
