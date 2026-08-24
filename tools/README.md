# tools

```bash
pip install -r tools/requirements.txt
```

## files_to_parquet.py

Zet elke file in een map om in één rij van een Parquet-bestand: pad, extensie,
grootte, wijzigingsdatum, sha256 en — voor tekstbestanden — de volledige inhoud.

```bash
python3 tools/files_to_parquet.py                       # huidige map -> bestanden.parquet
python3 tools/files_to_parquet.py cashflow-cloud -o app.parquet
python3 tools/files_to_parquet.py --include '*.js' --include '*.jsx'
python3 tools/files_to_parquet.py --geen-inhoud         # enkel metadata
```

`.git`, `node_modules`, `dist`, `.vercel` en `__pycache__` gaan er standaard
uit, net als verborgen bestanden. Let op met `--verborgen`: dan komt ook de
inhoud van bv. `.env` in het Parquet-bestand terecht.

---

De MZG/RHM-tooling die hier eerst stond, is een aparte applicatie geworden:
zie `mzg-parquet/` (of de losse repo, zodra die afgesplitst is).
