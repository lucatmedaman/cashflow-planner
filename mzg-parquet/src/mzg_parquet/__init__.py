"""MZG/RHM-registratiebestanden inlezen en exporteren als Parquet.

De recordtekeningen komen uit de richtlijnen van de FOD Volksgezondheid.
"""

from mzg_parquet.schema import (
    Bestandsnaam,
    Recordtekening,
    Veld,
    herken_bestandsnaam,
    laad_schema,
)
from mzg_parquet.lezer import Fout, Veldfout, lees_bestand
from mzg_parquet.export import bouw_pa_schema, schrijf_parquet

__version__ = "1.0.0"

__all__ = [
    "Bestandsnaam",
    "Recordtekening",
    "Veld",
    "Veldfout",
    "Fout",
    "herken_bestandsnaam",
    "laad_schema",
    "lees_bestand",
    "bouw_pa_schema",
    "schrijf_parquet",
    "__version__",
]
