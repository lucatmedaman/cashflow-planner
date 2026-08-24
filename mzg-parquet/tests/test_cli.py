"""End-to-end: van MZG-bestanden naar Parquet via de commandoregel."""

import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

import pyarrow.parquet as pq

from mzg_parquet.cli import main

DATA = Path(__file__).parent / "data"


class TestCli(unittest.TestCase):
    def draai(self, *argv):
        """Draait de CLI in een tijdelijke uitvoermap."""
        map_ = Path(self.enterContext(tempfile.TemporaryDirectory()))
        code = main([*argv, "-o", str(map_)])
        return code, map_

    def test_alle_voorbeelden_naar_parquet(self):
        code, uit = self.draai(str(DATA))
        self.assertEqual(code, 0)
        parquets = sorted(p.name for p in uit.glob("*.parquet"))
        self.assertEqual(len(parquets), 22)
        self.assertIn("HOSPITAL.parquet", parquets)
        self.assertIn("STAYHOSP.parquet", parquets)

        tabel = pq.read_table(uit / "HOSPITAL.parquet")
        self.assertEqual(tabel.num_rows, 1)
        self.assertEqual(tabel.column("CODE_AGR")[0].as_py(), "001")
        self.assertEqual(tabel.column("YEAR_REGISTR")[0].as_py(), 2015)
        metadata = {k.decode(): v.decode() for k, v in tabel.schema.metadata.items()}
        self.assertEqual(metadata["mzg_code"], "S1")
        self.assertEqual(metadata["mzg_domein"], "Structuurgegevens")

    def test_types_volgen_de_recordtekening(self):
        _, uit = self.draai(str(DATA / "001-Z-3.0-F-PROCRI30-2015-1.TXT"))
        tabel = pq.read_table(uit / "PROCRI30.parquet")
        types = dict(zip(tabel.schema.names, (str(t) for t in tabel.schema.types)))
        self.assertEqual(types["CODE_AGR"], "string")
        self.assertEqual(types["YEAR_REGISTR"], "int64")
        self.assertEqual(types["F3_DATE_START_PS_FORF_INARIZ"], "date32[day]")
        self.assertEqual(types["F3_FACT_PS_FORF_INARIZ"], "decimal128(18, 2)")
        self.assertEqual(tabel.column("F3_FACT_PS_FORF_INARIZ")[0].as_py(), Decimal("29.74"))

    def test_alles_tekst(self):
        _, uit = self.draai(str(DATA / "001-Z-3.0-S-HOSPITAL-2015-1.TXT"), "--alles-tekst")
        tabel = pq.read_table(uit / "HOSPITAL.parquet")
        self.assertEqual(tabel.column("YEAR_REGISTR")[0].as_py(), "2015")

    def test_bedrag_als_float(self):
        _, uit = self.draai(str(DATA / "001-Z-3.0-F-PROCRI30-2015-1.TXT"), "--bedrag-als-float")
        tabel = pq.read_table(uit / "PROCRI30.parquet")
        self.assertEqual(tabel.column("F3_FACT_PS_FORF_INARIZ")[0].as_py(), 29.74)

    def test_meerdere_bestanden_van_dezelfde_tabel_komen_samen(self):
        bron = (DATA / "001-Z-3.0-S-HOSPITAL-2015-1.TXT").read_text()
        with tempfile.TemporaryDirectory() as invoer:
            invoer = Path(invoer)
            (invoer / "001-Z-3.0-S-HOSPITAL-2015-1.TXT").write_text(bron)
            (invoer / "007-Z-3.0-S-HOSPITAL-2015-1.TXT").write_text(bron.replace("001#", "007#", 1))
            code, uit = self.draai(str(invoer))
        self.assertEqual(code, 0)
        tabel = pq.read_table(uit / "HOSPITAL.parquet")
        self.assertEqual(tabel.num_rows, 2)
        self.assertEqual(sorted(tabel.column("CODE_AGR").to_pylist()), ["001", "007"])
        self.assertEqual(len(set(tabel.column("_bronbestand").to_pylist())), 2)

    def test_tabel_forceren_bij_afwijkende_bestandsnaam(self):
        with tempfile.TemporaryDirectory() as invoer:
            raar = Path(invoer) / "zomaar.txt"
            raar.write_text((DATA / "001-Z-3.0-S-HOSPITAL-2015-1.TXT").read_text())
            self.assertEqual(self.draai(str(raar))[0], 1)             # zonder --tabel: onbekend
            code, uit = self.draai(str(raar), "--tabel", "HOSPITAL")  # met --tabel: gaat door
        self.assertEqual(code, 0)
        self.assertEqual(pq.read_table(uit / "HOSPITAL.parquet").num_rows, 1)

    def test_fouten_naar_csv_en_streng(self):
        with tempfile.TemporaryDirectory() as werkmap:
            werkmap = Path(werkmap)
            kapot = werkmap / "001-Z-3.0-S-HOSPITAL-2015-1.TXT"
            kapot.write_text("001#2015#1#\n001#XXXX#1#2007#1#1####\n")
            csv = werkmap / "fouten.csv"
            code, _ = self.draai(str(kapot), "--fouten", str(csv))
            self.assertEqual(code, 0)          # standaard: melden en doorgaan
            regels = csv.read_text().splitlines()
            self.assertEqual(regels[0], "bestand,recordnr,veld,waarde,fout")
            self.assertEqual(len(regels), 3)   # kop + verkeerd aantal velden + fout jaartal
            self.assertEqual(self.draai(str(kapot), "--streng")[0], 1)

    def test_lijst_en_toon(self):
        self.assertEqual(main(["--lijst"]), 0)
        self.assertEqual(main(["--toon", "A2"]), 0)
        self.assertEqual(main(["--toon", "STAYHOSP"]), 0)
        self.assertEqual(main(["--toon", "BESTAAT_NIET"]), 1)

    def test_zonder_invoer(self):
        self.assertEqual(main([]), 1)


if __name__ == "__main__":
    unittest.main()
