# mzg-parquet

Leest de registratiebestanden van de Minimale Ziekenhuisgegevens (MZG/RHM) in
volgens de recordtekeningen van de FOD Volksgezondheid, en schrijft ze weg als
getypeerde Parquet-bestanden.

```bash
pip install .
mzg-parquet mzg/ -o parquet/
```

## Het formaat

Eén record per regel, velden in de volgorde van de recordtekening, elk veld
afgesloten door `#`. Lege velden zijn dus twee opeenvolgende `#`:

```
001#2015#1#2007#1#1####      HOSPITAL: 9 velden, de 3 einddatumvelden zijn leeg
```

De bestandsnaam bepaalt welke recordtekening geldt:

```
XXX-Z-VERS-D-TABEL-YYYY-P.TXT      bv. 001-Z-3.0-S-HOSPITAL-2015-1.TXT
```

Volgt een bestand die naamgeving niet, geef de recordtekening dan mee met
`--tabel` (zowel `S1` als `HOSPITAL` werkt).

## Gebruik

```bash
mzg-parquet mzg/ -o parquet/                        # hele map, alle domeinen door elkaar
mzg-parquet mzg/ -o parquet/ --fouten fouten.csv    # afwijkingen apart bijhouden
mzg-parquet mzg/ -o parquet/ --streng               # exitcode 1 bij de eerste fout
mzg-parquet zomaar.txt --tabel S1 -o parquet/       # afwijkende bestandsnaam
mzg-parquet --lijst                                 # de 26 gekende bestanden
mzg-parquet --toon A2                               # recordtekening van STAYHOSP
```

Per tabel komt er één Parquet-bestand (`HOSPITAL.parquet`, `STAYHOSP.parquet`,
…). Meerdere invoerbestanden van dezelfde tabel — andere ziekenhuizen, jaren of
periodes — komen samen in één bestand. Elke rij krijgt `_bronbestand` en
`_recordnr`, zodat je ze terugvindt in de invoer. De schema-metadata bevat de
MZG-code, de tabelnaam, het domein en de bron.

Types volgen kolom C3 van de recordtekening:

| C3    | Parquet            | opmerking                                        |
|-------|--------------------|--------------------------------------------------|
| `C`   | `string`           | ook codes met voorloopnullen, bv. `CODE_AGR` 001 |
| `N`   | `int64`            |                                                  |
| `ND2` | `decimal128(18,2)` | `--bedrag-als-float` geeft `float64`             |
| `D`   | `date32`           | brongegeven in JJJJMMDD                          |

Lege velden worden null. Met `--alles-tekst` blijft elk veld een string; dat is
de veiligste keuze als je invoer nog fouten kan bevatten en je niets wil
verliezen.

## Controles

Per record wordt gecontroleerd: het aantal velden, of verplichte velden
ingevuld zijn, en of de lengte binnen de grenzen van de recordtekening valt. De
minimum- en maximumlengte gelden voor een *ingevulde* waarde: een optioneel veld
mag altijd leeg zijn (in de richtlijnen genoteerd als `0 of 4`).

Standaard wordt een fout gemeld en gaat het inlezen door; een veld dat niet in
zijn type past wordt null. Een record met een verkeerd aantal velden wordt
overgeslagen, want dan valt niet uit te maken welke waarde bij welk veld hoort.
`--fouten fouten.csv` schrijft alle afwijkingen weg met bestand, recordnummer,
veld en waarde; `--streng` geeft exitcode 1 zodra er één fout is.

Wat **niet** gecontroleerd wordt: de toegelaten waarden per veld (de codetabellen
uit de richtlijnen) en de links tussen de bestanden. Die staan wel in het schema
als `sleutelveld` en `foreign_key`, zodat je ze in SQL kan nagaan.

## Als bibliotheek

```python
from pathlib import Path
from mzg_parquet import laad_schema, lees_bestand, schrijf_parquet

schema = laad_schema()
tekening = schema["A2"]                     # of schema["STAYHOSP"]
print([v.naam for v in tekening.sleutelvelden])

rijen, fouten = lees_bestand(Path("001-Z-3.0-A-STAYHOSP-2015-1.TXT"), tekening)
schrijf_parquet(rijen, tekening, Path("STAYHOSP.parquet"))
```

## Het schema

`src/mzg_parquet/mzg_schema.json` bevat per bestand de tabelnaam en het domein,
en per veld: nummer, naam, omschrijving, verplicht/optioneel, vaste of variabele
lengte, datatype, lengte, minimum- en maximumlengte, sleutelveld en foreign key.
Samen 26 bestanden en 294 velden uit vijf domeinen.

Het is afgeleid uit de recordtekeningen in de richtlijnen zelf. Draai dit
opnieuw wanneer de FOD een nieuwe versie publiceert:

```bash
pip install ".[schema]"
python3 scripts/schema_uit_pdf.py ~/richtlijnen/*.pdf -o src/mzg_parquet/mzg_schema.json
```

Dat script vergelijkt op het einde elke voorbeeldregistratie uit de PDF's met de
afgeleide recordtekening. 22 van de 26 bestanden zijn zo tegen een echt
voorbeeld gecontroleerd; voor A7, F4, F5 en M1 staat er geen voorbeeld in de
PDF's.

Bronnen: richtlijnen domein 1 Structuurgegevens (december 2019), domein 2
Personeelsgegevens (december 2019), domein 3 Administratieve gegevens
(december 2019), domein 5 Medische gegevens (juni 2022) en domein 6
Facturatiegegevens (december 2019).

## Tests

```bash
python3 -m unittest discover
```

De tests lezen de voorbeeldregistraties uit de richtlijnen in
(`tests/data/`, fictieve gegevens — zie `tests/data/HERKOMST.md`) en controleren
dat elk voorbeeld foutloos door de bijhorende recordtekening komt.

## Verder werken in SQL

```sql
-- DuckDB
SELECT h.STAYNUM, h.A2_HOSPTYPE_FAC, count(*) AS ingrepen
FROM 'parquet/STAYHOSP.parquet' h
JOIN 'parquet/PROCEDUR.parquet' p USING (CODE_AGR, YEAR_REGISTR, PERIOD_REGISTR, STAYNUM)
GROUP BY ALL ORDER BY ingrepen DESC;
```
