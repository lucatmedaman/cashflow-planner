"""Controleert het schema dat uit de richtlijnen is afgeleid."""

import unittest

from mzg_parquet.schema import herken_bestandsnaam, laad_schema

DATATYPES = {"C", "N", "ND2", "D"}


class TestSchema(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.schema = laad_schema()

    def test_alle_bestanden_aanwezig(self):
        codes = [r.code for r in self.schema]
        self.assertEqual(len(codes), 26)
        self.assertEqual(codes[:3], ["A1", "A2", "A3"])
        for code in ("S1", "S8", "P1", "P2", "A1", "A7", "M1", "M6", "F3", "F5"):
            self.assertIn(code, self.schema)

    def test_opzoeken_op_code_en_tabelnaam(self):
        self.assertIs(self.schema["A2"], self.schema["STAYHOSP"])
        self.assertIs(self.schema["a2"], self.schema["stayhosp"])
        self.assertIsNone(self.schema.get("BESTAAT_NIET"))
        with self.assertRaises(KeyError):
            self.schema["BESTAAT_NIET"]

    def test_veldaantallen(self):
        # aantallen uit de recordtekeningen in de richtlijnen
        verwacht = {"S1": 9, "S2": 10, "S3": 11, "S4": 8, "S5": 15, "S6": 6, "S7": 6, "S8": 8,
                    "P1": 11, "P2": 12, "A1": 5, "A2": 32, "A3": 9, "A4": 15, "A5": 12,
                    "A6": 7, "A7": 6, "M1": 10, "M2": 18, "M3": 12, "M4": 18, "M5": 10,
                    "M6": 7, "F3": 12, "F4": 13, "F5": 12}
        self.assertEqual({r.code: len(r) for r in self.schema}, verwacht)

    def test_elk_veld_is_volledig(self):
        for r in self.schema:
            for v in r.velden:
                with self.subTest(veld=f"{r.code}.{v.nr}"):
                    self.assertTrue(v.naam)
                    self.assertTrue(v.omschrijving)
                    self.assertIn(v.datatype, DATATYPES)
                    self.assertIsInstance(v.verplicht, bool)
                    self.assertIsNotNone(v.min_lengte)
                    self.assertIsNotNone(v.max_lengte)
                    self.assertLessEqual(v.min_lengte, v.max_lengte)

    def test_veldnummers_lopen_door(self):
        for r in self.schema:
            self.assertEqual([v.nr for v in r.velden], list(range(1, len(r) + 1)))

    def test_sleutelvelden(self):
        # elk bestand heeft sleutelvelden; steekproef tegen de richtlijnen
        for r in self.schema:
            self.assertTrue(r.sleutelvelden, f"{r.code} heeft geen sleutelvelden")
        self.assertEqual([v.naam for v in self.schema["S1"].sleutelvelden],
                         ["CODE_AGR", "YEAR_REGISTR", "PERIOD_REGISTR"])
        self.assertEqual([v.naam for v in self.schema["A2"].sleutelvelden],
                         ["CODE_AGR", "YEAR_REGISTR", "PERIOD_REGISTR", "STAYNUM"])

    def test_gedeelde_velden_hebben_hetzelfde_type(self):
        types: dict[str, set] = {}
        for r in self.schema:
            for v in r.velden:
                types.setdefault(v.naam, set()).add(v.datatype)
        for naam in ("CODE_AGR", "YEAR_REGISTR", "PERIOD_REGISTR", "STAYNUM", "PATNUM"):
            self.assertEqual(len(types[naam]), 1, f"{naam} heeft meerdere types: {types[naam]}")
        # CODE_AGR is een karakterveld: de voorloopnullen horen bij het nummer
        self.assertEqual(types["CODE_AGR"], {"C"})

    def test_bestandsnaam_ontleden(self):
        naam = herken_bestandsnaam("001-Z-3.0-S-HOSPITAL-2015-1.TXT")
        self.assertEqual(naam.code_agr, "001")
        self.assertEqual(naam.domein, "S")
        self.assertEqual(naam.tabel, "HOSPITAL")
        self.assertEqual(naam.jaar, 2015)
        self.assertEqual(naam.periode, 1)
        self.assertIsNone(herken_bestandsnaam("zomaar_een_bestand.txt"))
        self.assertIsNone(herken_bestandsnaam("001-Z-3.0-S-HOSPITAL-2015.TXT"))


if __name__ == "__main__":
    unittest.main()
