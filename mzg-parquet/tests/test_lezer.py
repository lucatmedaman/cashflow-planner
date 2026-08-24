"""Leest de voorbeeldregistraties uit de richtlijnen in."""

import datetime as dt
import unittest
from decimal import Decimal
from pathlib import Path

from mzg_parquet.export import typeer, zet_om
from mzg_parquet.lezer import controleer_veld, lees_bestand, splits_record
from mzg_parquet.schema import laad_schema

DATA = Path(__file__).parent / "data"


class TestSplitsen(unittest.TestCase):
    def test_velden_worden_afgesloten_door_hekje(self):
        self.assertEqual(splits_record("001#2015#1#"), ["001", "2015", "1"])

    def test_lege_velden_blijven_behouden(self):
        # 9 velden, de laatste drie leeg
        self.assertEqual(splits_record("001#2015#1#2007#1#1####"),
                         ["001", "2015", "1", "2007", "1", "1", "", "", ""])

    def test_record_zonder_afsluitend_hekje(self):
        with self.assertRaises(ValueError):
            splits_record("001#2015#1")


class TestVoorbeeldregistraties(unittest.TestCase):
    """Elke voorbeeldregistratie uit de richtlijnen moet foutloos inlezen."""

    @classmethod
    def setUpClass(cls):
        cls.schema = laad_schema()
        cls.bestanden = sorted(DATA.glob("*.TXT"))

    def test_er_is_testdata(self):
        self.assertEqual(len(self.bestanden), 22)

    def test_alles_leest_zonder_fouten(self):
        for pad in self.bestanden:
            with self.subTest(bestand=pad.name):
                tekening = self.schema[pad.stem.split("-")[4]]
                rijen, fouten = lees_bestand(pad, tekening)
                self.assertEqual(fouten, [], f"{pad.name}: {fouten}")
                self.assertTrue(rijen)
                for rij in rijen:
                    self.assertEqual(len(rij), len(tekening) + 2)  # + herkomstkolommen

    def test_alles_typeert_zonder_fouten(self):
        for pad in self.bestanden:
            with self.subTest(bestand=pad.name):
                tekening = self.schema[pad.stem.split("-")[4]]
                rijen, _ = lees_bestand(pad, tekening)
                _, fouten = typeer(rijen, tekening)
                self.assertEqual(fouten, [], f"{pad.name}: {fouten}")

    def test_hospital_waarden(self):
        tekening = self.schema["HOSPITAL"]
        rijen, fouten = lees_bestand(DATA / "001-Z-3.0-S-HOSPITAL-2015-1.TXT", tekening)
        self.assertEqual(fouten, [])
        rij, = typeer(rijen, tekening)[0]
        self.assertEqual(rij["CODE_AGR"], "001")        # karakterveld: voorloopnullen blijven
        self.assertEqual(rij["YEAR_REGISTR"], 2015)
        self.assertEqual(rij["S1_YEAR_START_HOSP"], 2007)
        self.assertIsNone(rij["S1_YEAR_END_HOSP"])      # leeg optioneel veld
        self.assertEqual(rij["_recordnr"], 1)

    def test_facturatie_datum_en_bedrag(self):
        tekening = self.schema["PROCRI30"]
        rijen, fouten = lees_bestand(DATA / "001-Z-3.0-F-PROCRI30-2015-1.TXT", tekening)
        self.assertEqual(fouten, [])
        rij, = typeer(rijen, tekening)[0]
        self.assertEqual(rij["F3_DATE_START_PS_FORF_INARIZ"], dt.date(2012, 3, 12))
        self.assertEqual(rij["F3_FACT_PS_FORF_INARIZ"], Decimal("29.74"))
        self.assertEqual(rij["STAYNUM"], "STAY2035691")


class TestControles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = laad_schema()

    def veld(self, code, naam):
        return next(v for v in self.schema[code].velden if v.naam == naam)

    def test_verplicht_veld_mag_niet_leeg_zijn(self):
        self.assertIsNotNone(controleer_veld("", self.veld("S1", "CODE_AGR")))

    def test_optioneel_veld_mag_leeg_zijn(self):
        self.assertIsNone(controleer_veld("", self.veld("S1", "S1_YEAR_END_HOSP")))

    def test_ingevuld_optioneel_veld_heeft_wel_een_minimumlengte(self):
        # "0 of 4": leeg mag, maar ingevuld moeten het er vier zijn
        veld = self.veld("A2", "A2_YEAR_HOSP_OUT")
        self.assertIsNone(controleer_veld("2015", veld))
        self.assertIn("korter dan 4", controleer_veld("20", veld))

    def test_te_lange_waarde(self):
        self.assertIn("langer dan 3", controleer_veld("0012", self.veld("S1", "CODE_AGR")))

    def test_verkeerd_aantal_velden_wordt_overgeslagen(self):
        pad = DATA / "001-Z-3.0-S-HOSPITAL-2015-1.TXT"
        tekening = self.schema["HOSPITAL"]
        kapot = pad.parent / "kapot.tmp"
        kapot.write_text("001#2015#1#\n" + pad.read_text())
        try:
            rijen, fouten = lees_bestand(kapot, tekening)
            self.assertEqual(len(rijen), 1)
            self.assertEqual(len(fouten), 1)
            self.assertIn("3 velden i.p.v. 9", fouten[0].fout)
            self.assertEqual(fouten[0].recordnr, 1)
        finally:
            kapot.unlink()


class TestTyperen(unittest.TestCase):
    def test_leeg_wordt_none(self):
        self.assertIsNone(zet_om("", "N"))

    def test_datum(self):
        self.assertEqual(zet_om("20120312", "D"), dt.date(2012, 3, 12))
        with self.assertRaises(ValueError):
            zet_om("2012031", "D")

    def test_bedrag(self):
        self.assertEqual(zet_om("29.74", "ND2"), Decimal("29.74"))
        self.assertEqual(zet_om("29.74", "ND2", bedrag_als_float=True), 29.74)
        with self.assertRaises(ValueError):
            zet_om("geen bedrag", "ND2")

    def test_karakterveld_blijft_tekst(self):
        self.assertEqual(zet_om("001", "C"), "001")


if __name__ == "__main__":
    unittest.main()
