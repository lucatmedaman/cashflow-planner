# tools

Python-scripts om bestanden in te lezen en als Parquet weg te schrijven.

```bash
pip install -r tools/requirements.txt
```

## mzg_to_parquet.py — MZG/RHM-registratiebestanden

Leest de registratiebestanden van de Minimale Ziekenhuisgegevens (MZG/RHM) in
volgens de recordtekeningen van de FOD Volksgezondheid, en schrijft per bestand
een getypeerd Parquet-bestand weg.

```bash
python3 tools/mzg_to_parquet.py mzg/ -o parquet/
python3 tools/mzg_to_parquet.py mzg/ -o parquet/ --fouten fouten.csv --streng
python3 tools/mzg_to_parquet.py raar_genoemd.txt --tabel S1 -o parquet/
python3 tools/mzg_to_parquet.py --lijst          # alle gekende bestanden
python3 tools/mzg_to_parquet.py --toon A2        # recordtekening van STAYHOSP
```

### Het formaat

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

### Uitvoer

Per tabel één Parquet-bestand (`HOSPITAL.parquet`, `STAYHOSP.parquet`, ...).
Meerdere invoerbestanden van dezelfde tabel — andere ziekenhuizen, jaren of
periodes — komen samen in één Parquet-bestand. Naast de velden uit de
recordtekening krijgt elke rij `_bronbestand` en `_recordnr`, zodat je een rij
altijd terugvindt in de invoer. De schema-metadata bevat de MZG-code, de
tabelnaam, het domein en de bron.

Types volgen kolom C3 van de recordtekening:

| C3    | Parquet          | opmerking                                        |
|-------|------------------|--------------------------------------------------|
| `C`   | `string`         | ook codes met voorloopnullen, bv. `CODE_AGR` 001 |
| `N`   | `int64`          |                                                  |
| `ND2` | `decimal128(18,2)` | `--bedrag-als-float` geeft `float64`           |
| `D`   | `date32`         | brongegeven in JJJJMMDD                          |

Lege velden worden null. Met `--alles-tekst` blijft elk veld een string; dat is
de veiligste keuze als je invoer nog fouten kan bevatten en je niets wil
verliezen.

### Controles

Bij het inlezen wordt per record gecontroleerd: het aantal velden, of verplichte
velden ingevuld zijn, en of de lengte binnen de grenzen van de recordtekening
valt. De minimum- en maximumlengte gelden voor een *ingevulde* waarde: een
optioneel veld mag altijd leeg zijn (in de richtlijnen `0 of 4`).

Standaard wordt een fout gemeld en gaat het inlezen door (een veld dat niet in
zijn type past wordt null). Met `--fouten fouten.csv` krijg je alle fouten met
bestand, recordnummer, veld en waarde; met `--streng` eindigt het script met
exitcode 1 zodra er één fout is.

Wat het script **niet** controleert: de toegelaten waarden per veld (de
codetabellen uit de richtlijnen) en de links tussen de bestanden (foreign keys).
Die staan wel in `mzg_schema.json` als `foreign_key` en `sleutelveld`, zodat je
ze in SQL kan nagaan.

### mzg_schema.json

De velddefinities: per bestand de tabelnaam, het domein en per veld nummer,
naam, omschrijving, verplicht/optioneel, vaste of variabele lengte, datatype,
lengte, minimum- en maximumlengte, sleutelveld en foreign key.

Afgeleid uit de recordtekeningen in de richtlijnen met
`tools/mzg_schema_uit_pdf.py`. Draai dat script opnieuw wanneer de FOD een
nieuwe versie publiceert:

```bash
python3 tools/mzg_schema_uit_pdf.py ~/richtlijnen/*.pdf -o tools/mzg_schema.json
```

Het script vergelijkt op het einde elke voorbeeldregistratie uit de PDF's met de
afgeleide recordtekening. De huidige `mzg_schema.json` dekt 26 bestanden en 294
velden; 22 daarvan zijn zo tegen een echte voorbeeldregistratie gecontroleerd,
voor A7, F4, F5 en M1 staat er geen voorbeeld in de PDF's.

Bronnen: richtlijnen domein 1 Structuurgegevens (december 2019), domein 2
Personeelsgegevens (december 2019), domein 3 Administratieve gegevens
(december 2019), domein 5 Medische gegevens (juni 2022) en domein 6
Facturatiegegevens (december 2019).

### Verder werken in SQL

```sql
-- DuckDB
SELECT h.STAYNUM, h.A2_HOSPTYPE_FAC, count(*) AS ingrepen
FROM 'parquet/STAYHOSP.parquet' h
JOIN 'parquet/PROCEDUR.parquet' p USING (CODE_AGR, YEAR_REGISTR, PERIOD_REGISTR, STAYNUM)
GROUP BY 1, 2 ORDER BY ingrepen DESC;
```

## files_to_parquet.py — willekeurige bestanden in een map

Zet elke file in een map om in één rij: pad, extensie, grootte,
wijzigingsdatum, sha256 en — voor tekstbestanden — de volledige inhoud.

```bash
python3 tools/files_to_parquet.py                       # huidige map -> bestanden.parquet
python3 tools/files_to_parquet.py cashflow-cloud -o app.parquet
python3 tools/files_to_parquet.py --include '*.js' --include '*.jsx'
python3 tools/files_to_parquet.py --geen-inhoud         # enkel metadata
```

`.git`, `node_modules`, `dist`, `.vercel` en `__pycache__` gaan er standaard
uit, net als verborgen bestanden. Let op met `--verborgen`: dan komt ook de
inhoud van bv. `.env` in het Parquet-bestand terecht.
