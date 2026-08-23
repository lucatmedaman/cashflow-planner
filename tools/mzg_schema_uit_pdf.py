#!/usr/bin/env python3
"""Leidt mzg_schema.json af uit de MZG-richtlijnen-PDF's van de FOD Volksgezondheid.

Per bestand (HOSPITAL, STAYHOSP, ...) haalt dit script de recordtekening op:
veldnummer, veldnaam, omschrijving, verplicht/optioneel, vaste of variabele
lengte, datatype, lengte, sleutelveld en foreign key.

Draai dit opnieuw wanneer de FOD een nieuwe versie van de richtlijnen publiceert:

    pip install pypdf
    python3 tools/mzg_schema_uit_pdf.py ~/richtlijnen/*.pdf -o tools/mzg_schema.json

De controle onderaan telt de velden van elke voorbeeldregistratie in de PDF's en
vergelijkt die met de afgeleide recordtekening.
"""

from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path

# Domeinletter -> (naam, herkenning in de bestandsnaam van de PDF)
DOMEINEN = {
    'S': ('Structuurgegevens', 'domein_1'),
    'P': ('Personeelsgegevens', 'domein_2'),
    'A': ('Administratieve gegevens', 'domein_3'),
    'M': ('Medische gegevens', 'domein_5'),
    'F': ('Facturatiegegevens', 'domein_6'),
}

TABELKOP = re.compile(r'Recordtekening van\s*([A-Z0-9_]+)\s*\(([SPAMF]\d)\)')
VELDKOP = re.compile(r'([SPAMF]\d)\s*/\s*Veld\s+(\d+)\s+([A-Z][A-Z0-9_]*)\s*:\s*'
                     r'([^\n]*(?:\n(?!\s*[SPAMF]\d\s*/)[^\n]*){0,2})')
VELDRIJ = re.compile(r'\bVeld\s*(\d+)\b')
KOLOMMEN = re.compile(r'\b([MO])\s+([FV])\s+(ND2|N|C|D)\s+(.*)$', re.S)
FK_TOKEN = re.compile(r'^[SPAMF]\d$')
LENGTE_TOKEN = re.compile(
    r'\d+-\d+$|\d+$|of$|t\.?e\.?m\.?$|vanaf$|tot$|en$|MZG\d{4}$|\(?MZG\d{4}\)?$|'
    r'\(\d+$|\)$|karakters?$|cijfers?$|[MO]$|[FV]$|ND2$|[NCD]$', re.I)
# tekst die in de PDF ná de omschrijving volgt en er niet bij hoort
OMSCHRIJVING_EINDE = re.compile(
    r'\s*(?:\.{3,}|\.\s|Sleutelveld|sleutelveld|Verplicht veld|Optioneel veld|Vast formaat|'
    r'Minimale lengte|Maximale lengte|Toegelaten|Voorbeeld|=== PAGINA|\b[SPAMF]\d\s*-\s)')
MAX_OMSCHRIJVING = 100   # langer betekent dat er body-tekst is meegelezen
RUIS = re.compile(
    r'^(?:#\s*$|Veldnr Veldnaam|Kolom C[123]|Rood en schuin|=== PAGINA|Versie \w+ \d{4}|'
    r'Tabel \d+-\d+:|In onderstaande tabel|Sleutelvelden zijn|uniek maakt|voorkomt|'
    r'bestanden in Portahealth|CONTROLES:|foutmelding|Kolom C1:|Kolom C2|leeg is of dat)')


def pdf_naar_tekst(pad: Path) -> str:
    """Platte tekst per pagina; niet-ASCII wordt vervangen (de PDF's gebruiken
    private-use tekens voor pijlen en koppeltekens)."""
    try:
        from pypdf import PdfReader
    except ImportError:  # pragma: no cover - alleen bij ontbrekende afhankelijkheid
        sys.exit("fout: pypdf is niet geinstalleerd (pip install pypdf)")
    vervang = {'–': '-', '—': '-', '‐': '-', '‑': '-', '−': '-'}
    delen = []
    for i, pagina in enumerate(PdfReader(str(pad)).pages, start=1):
        delen.append(f"\n=== PAGINA {i} ===\n" + (pagina.extract_text() or ''))
    tekst = ''.join(delen)
    return ''.join(vervang.get(c, c if ord(c) < 128 else ' ') for c in tekst)


def domein_van(pad: Path) -> str:
    for letter, (_, merk) in DOMEINEN.items():
        if merk in pad.name:
            return letter
    raise SystemExit(f"fout: kan het domein niet afleiden uit de bestandsnaam {pad.name}")


# --- veldnamen en omschrijvingen -------------------------------------------

def veldnamen(tekst: str) -> dict[str, dict[int, tuple[str, str]]]:
    """{bestandscode: {veldnr: (naam, omschrijving)}} uit alle veldkoppen.

    Elke veldkop komt meermaals voor: in de inhoudstafel van het document, in de
    inhoudstafel van het hoofdstuk en boven de eigenlijke beschrijving. In de
    inhoudstafels breekt de tekst soms over twee regels, dus we lezen telkens
    enkele regels mee, knippen af waar de body begint en houden de langste
    (dus meest volledige) omschrijving over.
    """
    uit: dict[str, dict[int, tuple[str, str]]] = collections.defaultdict(dict)
    for m in VELDKOP.finditer(tekst):
        code, nr, naam = m.group(1), int(m.group(2)), m.group(3)
        oms = OMSCHRIJVING_EINDE.split(m.group(4).replace('\n', ' '), maxsplit=1)[0]
        oms = re.sub(r'\s+', ' ', oms).strip(' .')
        while oms.endswith(')') and oms.count(')') > oms.count('('):
            oms = oms[:-1].strip()
        vorige = uit[code].get(nr, (naam, ''))[1]
        if beter(oms, vorige):
            uit[code][nr] = (naam, oms)
    return uit


def beter(nieuw: str, vorig: str) -> bool:
    """De meest volledige omschrijving wint, maar body-tekst (te lang) verliest."""
    if not vorig:
        return True
    binnen_nieuw, binnen_vorig = len(nieuw) <= MAX_OMSCHRIJVING, len(vorig) <= MAX_OMSCHRIJVING
    if binnen_nieuw != binnen_vorig:
        return binnen_nieuw
    return len(nieuw) > len(vorig) if binnen_nieuw else len(nieuw) < len(vorig)


def sleutelvelden(tekst: str, code: str) -> set[int]:
    """Velden die onder hun beschrijving '<code> - sleutelveld' vermelden."""
    koppen = [m for m in VELDKOP.finditer(tekst) if m.group(1) == code]
    laatste = {int(m.group(2)): i for i, m in enumerate(koppen)}  # body komt na de inhoudstafels
    uit = set()
    for nr, i in laatste.items():
        eind = koppen[i + 1].start() if i + 1 < len(koppen) else koppen[i].end() + 900
        if re.search(rf'\b{code}\s*-\s*Sleutelveld', tekst[koppen[i].end():eind], re.I):
            uit.add(nr)
    return uit


# --- recordtekening ---------------------------------------------------------

def ontleed_lengte(spec: str) -> tuple[str, int | None, int | None, list[str]]:
    """Splitst de lengtekolom in (lengtetekst, min, max, foreign keys).

    De PDF-extractie plakt soms een pagina-hoofding of de kolom 'Controle bij
    opladen' achter de lengte; we lezen daarom enkel tokens die tot een
    lengte-uitdrukking kunnen behoren en stoppen bij het eerste vreemde woord.
    """
    spec = re.sub(r'(\d)\s*-\s*(\d)', r'\1-\2', spec)   # '1 - 15' -> '1-15'
    behouden, fks = [], []
    for token in spec.split():
        kaal = token.strip('()')
        if FK_TOKEN.match(kaal):
            fks.append(kaal)
            continue
        if kaal.lower() == 'x':          # kolom 'Controle bij opladen'
            break
        if LENGTE_TOKEN.match(token):
            if not fks:
                behouden.append(token)
            continue
        break
    schoon = ' '.join(behouden)
    kaal = re.sub(r'MZG\s*\d{4}', ' ', schoon)
    kaal = re.sub(r'\b[MO]\s+[FV]\s+(?:ND2|N|C|D)\b', ' ', kaal)
    # '0 of 4' betekent: leeg, of anders 4 lang. De lege mogelijkheid zit al in
    # 'verplicht', dus min_lengte is de minimumlengte van een ingevulde waarde.
    kaal = re.sub(r'\b0\s+of\b', ' ', kaal)
    getallen = [int(g) for g in re.findall(r'\d+', kaal)]
    return schoon, (min(getallen) if getallen else None), (max(getallen) if getallen else None), fks


def tabelblok(tekst: str, code: str) -> str | None:
    """Het tekstblok van de recordtekening (de laatste treffer staat in de body)."""
    treffers = [m for m in TABELKOP.finditer(tekst) if m.group(2) == code]
    if not treffers:
        return None
    rest = tekst[treffers[-1].start():]
    eind = re.search(r'BESCHRIJVING VAN DE VELDEN|VOORBEELD', rest[200:])
    return rest[:200 + eind.start()] if eind else rest[:20000]


def parse_recordtekening(blok: str, namen: dict[int, tuple[str, str]]) -> dict[int, dict]:
    schoon = '\n'.join(r for r in blok.splitlines() if not RUIS.match(r.strip()))
    posities = [(int(m.group(1)), m.end()) for m in VELDRIJ.finditer(schoon)]
    grenzen = [m.start() for m in VELDRIJ.finditer(schoon)] + [len(schoon)]
    uit: dict[int, dict] = {}
    for i, (nr, eind_kop) in enumerate(posities):
        if nr in uit or nr not in namen:
            continue
        stuk = schoon[eind_kop:grenzen[i + 1]]
        # de veldnaam mag in de PDF over twee regels gebroken zijn
        patroon = r'\s*'.join(re.escape(c) for c in namen[nr][0])
        stuk = re.sub(r'^\s*' + patroon, '', stuk, count=1)
        m = KOLOMMEN.search(stuk)
        if not m:
            continue
        lengte, mn, mx, fks = ontleed_lengte(re.sub(r'\s+', ' ', m.group(4)).strip())
        uit[nr] = {'verplicht': m.group(1) == 'M', 'vaste_lengte': m.group(2) == 'F',
                   'datatype': m.group(3), 'lengte': lengte or None,
                   'min_lengte': mn, 'max_lengte': mx,
                   'foreign_key': ' '.join(fks) if fks else None}
    return uit


# --- controle tegen de voorbeeldregistraties --------------------------------

BESTANDSNAAM = re.compile(r'\d{3}\s*-\s*Z\s*-\s*[\d.]+\s*-\s*[SPAMF]\s*-\s*([A-Z0-9_]+)\s*-\s*\d{4}\s*-\s*\d')
RECORD = re.compile(r'^[^\s#]*#[^\s]*#$')


def controleer(teksten: dict[str, str], bestanden: dict) -> list[str]:
    """Vergelijkt het aantal velden in elke voorbeeldregistratie met het schema."""
    per_tabel = {d['tabel']: c for c, d in bestanden.items()}
    gevonden = collections.defaultdict(list)
    for tekst in teksten.values():
        huidig, buffer = None, ''
        for regel in tekst.splitlines():
            s = regel.strip()
            m = BESTANDSNAAM.search(s)
            if m:
                huidig, buffer = per_tabel.get(m.group(1).replace(' ', '')), ''
                continue
            if s in per_tabel:              # kale tabelnaam boven een voorbeeld
                huidig, buffer = per_tabel[s], ''
                continue
            if not huidig or not RECORD.match(s):
                continue
            buffer += s
            if len(buffer.split('#')) - 1 >= len(bestanden[huidig]['velden']):
                gevonden[huidig].append(buffer)
                buffer = ''
    meldingen = []
    for code in sorted(bestanden, key=lambda c: (c[0], int(c[1:]))):
        verwacht = len(bestanden[code]['velden'])
        voorbeelden = gevonden.get(code, [])
        tellingen = sorted({len(v.split('#')) - 1 for v in voorbeelden})
        if not voorbeelden:
            meldingen.append(f"?? {code:3s} {bestanden[code]['tabel']:9s} "
                             f"{verwacht:2d} velden - geen voorbeeld in de PDF")
        else:
            ok = tellingen == [verwacht]
            meldingen.append(f"{'OK' if ok else '!!'} {code:3s} {bestanden[code]['tabel']:9s} "
                             f"{verwacht:2d} velden - {len(voorbeelden)} voorbeeld(en) "
                             f"met {tellingen} velden")
    return meldingen


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('pdf', nargs='+', type=Path, help='de richtlijnen-PDF\'s (één per domein)')
    parser.add_argument('-o', '--output', type=Path, default=Path('tools/mzg_schema.json'))
    parser.add_argument('--versie', default='3.0', help='versie van het MZG-formaat')
    opties = parser.parse_args(argv)

    teksten = {}
    for pad in opties.pdf:
        if not pad.is_file():
            print(f"fout: {pad} bestaat niet", file=sys.stderr)
            return 1
        teksten[domein_van(pad)] = pdf_naar_tekst(pad)

    bestanden: dict[str, dict] = {}
    for domein, tekst in teksten.items():
        domeinnaam = DOMEINEN[domein][0]
        versie = re.search(r'Versie\s+(\w+\s+\d{4})', tekst)
        bron = (f"Richtlijnen {domeinnaam} (domein {domein})"
                + (f", versie {versie.group(1).lower()}" if versie else ""))
        namen_per_code = veldnamen(tekst)
        for m in TABELKOP.finditer(tekst):
            tabel, code = m.group(1), m.group(2)
            if code in bestanden or code not in namen_per_code:
                continue
            namen = namen_per_code[code]
            blok = tabelblok(tekst, code)
            rijen = parse_recordtekening(blok, namen) if blok else {}
            sleutels = sleutelvelden(tekst, code)
            velden = []
            for nr, (naam, oms) in sorted(namen.items()):
                rij = rijen.get(nr, {})
                velden.append({'nr': nr, 'naam': naam, 'omschrijving': oms,
                               'verplicht': rij.get('verplicht'),
                               'vaste_lengte': rij.get('vaste_lengte'),
                               'datatype': rij.get('datatype'), 'lengte': rij.get('lengte'),
                               'min_lengte': rij.get('min_lengte'),
                               'max_lengte': rij.get('max_lengte'),
                               'sleutelveld': nr in sleutels,
                               'foreign_key': rij.get('foreign_key')})
            bestanden[code] = {'code': code, 'tabel': tabel, 'domein': domein,
                               'domeinnaam': domeinnaam, 'bron': bron, 'velden': velden}

    gesorteerd = {c: bestanden[c] for c in sorted(bestanden, key=lambda c: (c[0], int(c[1:])))}
    opties.output.parent.mkdir(parents=True, exist_ok=True)
    opties.output.write_text(json.dumps({'versie': opties.versie, 'bestanden': gesorteerd},
                                        ensure_ascii=False, indent=1) + '\n')

    zonder_type = [f"{c}.{v['nr']}" for c, d in gesorteerd.items()
                   for v in d['velden'] if not v['datatype']]
    print(f"{len(gesorteerd)} bestanden, "
          f"{sum(len(d['velden']) for d in gesorteerd.values())} velden -> {opties.output}")
    if zonder_type:
        print(f"LET OP: geen datatype gevonden voor {zonder_type}", file=sys.stderr)
    print('\ncontrole tegen de voorbeeldregistraties in de PDF\'s:')
    for melding in controleer(teksten, gesorteerd):
        print('  ' + melding)
    return 1 if zonder_type else 0


if __name__ == '__main__':
    raise SystemExit(main())
