# Plan — Medaman bedrijfswebsite (TEST)

> **Status:** voorstel — wacht op goedkeuring vóór de bouw start.
> **Belangrijk:** dit is een testproject. Het vervangt de bestaande medaman.be niet.
> Alles staat geïsoleerd in `medaman-site/`. Deploy gebeurt uitsluitend naar een
> tijdelijke preview-URL (Netlify/Cloudflare Pages), nooit naar het echte domein.

---

## 1. Uitgangspunten

| Onderwerp | Keuze |
|---|---|
| Framework | Astro 5, volledig statisch (`output: 'static'`) |
| Styling | Eigen CSS met design tokens (custom properties), geen framework-afhankelijkheid |
| JavaScript | Minimaal — enkel mobiel menu + client-side formuliervalidatie |
| Taal | Nederlands (NL-BE) als hoofdtaal; structuur voorbereid op latere EN/FR-uitbreiding |
| Content | In losse data-bestanden (`src/data/*.ts`), niet hardgecodeerd in templates |
| Hosting | Statische export → Netlify of Cloudflare Pages preview-URL |

**Waarom Astro statisch:** geen serverkost, snelle laadtijden, uitstekende SEO,
en een ziekenhuis-IT-afdeling kan de output desgewenst zelf hosten zonder runtime.

---

## 2. Paginastructuur

```
/                     Home
/diensten             Overzicht diensten
/diensten/[slug]      Detailpagina per dienst (6 stuks)
/over-ons             Over ons
/contact              Contact + formulier
/privacy              Privacyverklaring (nodig zodra er een formulier is)
/404                  Niet gevonden
```

**Dienst-slugs:**

1. `hospital-benchmarking`
2. `icd-10-cm-coding-audits`
3. `apr-drg-nrg-analyses`
4. `verblijfsduuranalyse` (length of stay)
5. `psi-indicatoren`
6. `klinische-rapportage`

Elke dienst krijgt een eigen pagina, gegenereerd uit één content-collectie —
zo blijft de opbouw consistent en is een dienst toevoegen één bestand.

---

## 3. Content-outline per pagina

### 3.1 Home

| Sectie | Inhoud |
|---|---|
| **Hero** | Waardepropositie: *"Inzicht in uw ziekenhuisdata — van codering tot casemix."* Subtekst over betrouwbare analyse van registratie- en facturatiedata. Twee CTA's: "Bekijk onze diensten" + "Neem contact op". |
| **Vertrouwensbalk** | Vier korte kernpunten: gevestigd in Lokeren · Belgische ziekenhuiscontext (MZG/APR-DRG) · GDPR-conforme verwerking · Rapportage op maat van directie én coderingsdienst. |
| **Diensten in het kort** | Grid met de 6 diensten: titel, één zin, link naar detail. |
| **Aanpak (3 stappen)** | 1. Data-intake & validatie → 2. Analyse & benchmarking → 3. Rapportage & begeleiding. |
| **Waarom Medaman** | Drie blokken: domeinkennis van de Belgische ziekenhuisfinanciering, methodologische transparantie (reproduceerbare analyses), praktische bruikbaarheid (rapporten die intern gedragen worden). |
| **Slot-CTA** | Uitnodiging tot een kennismakingsgesprek → /contact. |

### 3.2 Diensten (overzicht)

Korte intro over het aanbod, daarna kaarten per dienst met titel, doelgroep-label
(directie / codering / kwaliteit) en samenvatting.

### 3.3 Dienst-detailpagina (vaste opbouw)

Elke detailpagina volgt hetzelfde stramien, zodat vergelijken makkelijk is:

1. **Titel + samenvatting** (1 alinea)
2. **Voor wie** — welke afdeling/rol hier baat bij heeft
3. **Wat we doen** — 4 tot 6 concrete punten
4. **Wat u krijgt** — de deliverables (rapport, dashboard, workshop, actielijst)
5. **Aandachtspunten / methodologie** — welke databronnen en indicatoren
6. **CTA** naar contact + links naar verwante diensten

**Inhoudelijke kern per dienst:**

- **Hospital benchmarking** — positionering tegenover een peergroep van vergelijkbare
  ziekenhuizen; casemix-gecorrigeerde vergelijking; identificeren van afwijkingen die
  de moeite lonen om verder te onderzoeken. Voor: directie, financieel management.
- **ICD-10-CM coding audits** — steekproefgewijze en systematische controle van
  diagnose- en procedurecodering; detectie van onder- en overcodering, ontbrekende
  nevendiagnoses, sequencing-fouten; feedback en opleiding voor codeerders.
  Voor: medische coderingsdienst, MZG-verantwoordelijke.
- **APR-DRG / NRG-analyses** — casemixanalyse, severity of illness en risk of
  mortality, verschuivingen in DRG-mix, financiële impact van coderingskwaliteit.
  Voor: directie, financiële dienst, coderingsdienst.
- **Verblijfsduuranalyse (length of stay)** — vergelijking van gerealiseerde
  verblijfsduur met verwachte duur per DRG/severity, uitschieters, ligduuroverschrijding,
  organisatorische verbeterpistes. Voor: directie, hoofdartsen, zorgmanagement.
- **PSI-indicatoren** — Patient Safety Indicators berekenen op de eigen data,
  duiden welk deel registratie-artefact is en welk deel klinisch signaal,
  evolutie in de tijd. Voor: kwaliteitsafdeling, medische directie.
- **Klinische rapportage** — periodieke en ad-hoc rapporten en dashboards op maat,
  van directiecockpit tot dienstniveau; heldere visualisatie zonder ruis.
  Voor: alle bovenstaande.

### 3.4 Over ons

- Wie is Medaman: healthcare data analytics, gevestigd in Lokeren, werkzaam voor
  Belgische ziekenhuizen.
- Onze aanpak: onafhankelijk, methodologisch transparant, resultaten die
  reproduceerbaar en verdedigbaar zijn tegenover artsen en directie.
- Werken met gevoelige data: GDPR, verwerkersovereenkomst, pseudonimisering,
  dataminimalisatie, afspraken over bewaartermijnen.
- Kort blok over expertise/team — **wordt met placeholder-tekst gebouwd**, zie §7.

### 3.5 Contact

- Contactformulier: naam, ziekenhuis/organisatie, functie, e-mail, telefoon
  (optioneel), onderwerp (keuzelijst met de 6 diensten + "andere"), bericht,
  akkoordvinkje privacyverklaring.
- Validatie in de browser + honeypot-veld tegen spam.
- **Verzending:** in deze fase nog niet gekoppeld. Het formulier wordt gebouwd met
  een `action` die via één configuratieregel omgezet kan worden naar Netlify Forms,
  Formspree of een eigen endpoint. Tot dan toont het een duidelijke melding dat
  koppeling nog volgt, met het e-mailadres als alternatief.
- Daarnaast: adresblok Lokeren, e-mail, telefoon, openingsuren, ondernemingsnummer —
  **placeholders**, zie §7.

### 3.6 Privacy

Beknopte privacyverklaring toegespitst op het contactformulier: welke gegevens,
waarvoor, hoe lang, rechten van betrokkene, contactgegevens verwerkingsverantwoordelijke.
Duidelijk gemarkeerd als concept dat juridisch nagelezen moet worden.

---

## 4. Design — professioneel/klinisch

**Kleuren** (sober, hoog contrast, geen speelse tinten):

| Rol | Waarde |
|---|---|
| Primair (diepblauw) | `#0F3D5C` |
| Primair licht (accent, links, hover) | `#1B6E9B` |
| Achtergrond | `#FFFFFF` |
| Achtergrond secundair | `#F4F7F9` |
| Tekst | `#132029` |
| Tekst gedempt | `#556270` |
| Rand | `#DCE4EA` |
| Accent (spaarzaam, voor data-elementen) | `#0E8F7E` (teal) |

Eén accentkleur, spaarzaam gebruikt. Geen gradients, geen felle kleurvlakken.

**Typografie:** systeemfont-stack met een schreefloze kop (Inter-achtig), ruime
regelafstand, maximale regellengte ~70 tekens. Geen decoratieve fonts.

**Vormtaal:** rechte hoeken tot lichte afronding (4px), 1px randen in plaats van
zware schaduwen, veel witruimte, strak 12-koloms grid, duidelijke sectie-scheidingen.

**Beeld:** geen stockfoto's van lachende mensen. In plaats daarvan: abstracte
data-visuals (lijn/staafmotieven in SVG), iconen in lijnstijl, en veel typografie.
Dit houdt de site licht en vermijdt een generieke uitstraling.

**Toegankelijkheid:** WCAG AA-contrast, zichtbare focus-states, semantische HTML,
skip-link, correcte kopstructuur, `prefers-reduced-motion` gerespecteerd.

**Responsive:** mobile-first, breakpoints op 640 / 900 / 1200px. Hamburgermenu
onder 900px.

---

## 5. Technische opbouw

```
medaman-site/
├── plan.md
├── README.md              # hoe draaien, bouwen, deployen
├── astro.config.mjs
├── package.json
├── public/
│   ├── favicon.svg
│   └── robots.txt         # noindex zolang dit een testsite is
└── src/
    ├── components/        Header, Footer, Hero, ServiceCard, Section,
    │                      CTA, ContactForm, Breadcrumbs, StepList
    ├── content/diensten/  6 markdown-bestanden (content collection)
    ├── data/site.ts       bedrijfsgegevens, navigatie, contactinfo
    ├── layouts/Base.astro SEO-head, skip-link, header/footer
    ├── pages/             index, diensten, diensten/[slug], over-ons,
    │                      contact, privacy, 404
    └── styles/global.css  design tokens + basisstijlen
```

**Verder inbegrepen:** meta-tags en Open Graph per pagina, `sitemap.xml`,
`Organization`/`LocalBusiness` JSON-LD structured data, en `noindex` in
`robots.txt` én meta zolang het om de testsite gaat.

---

## 6. Aanpak in stappen

1. Astro-project opzetten in `medaman-site/`, design tokens en basislayout
2. Header, footer, navigatie, responsive gedrag
3. Content-collectie met de 6 diensten + overzichtspagina + detailtemplate
4. Home met alle secties
5. Over ons + Privacy
6. Contact met formulier (nog niet gekoppeld) en validatie
7. SEO, structured data, 404, favicon, robots
8. Build controleren, toegankelijkheid en responsive nakijken
9. Committen en pushen naar `claude/medaman-website-iktods`
10. Deploy-instructies in README (Netlify/Cloudflare preview) — deploy pas op jouw vraag

---

## 7. Wat ik NIET weet — placeholders

Ik verzin geen bedrijfsfeiten. De volgende zaken bouw ik met duidelijk
gemarkeerde placeholders (`[[ ... ]]`), en ze staan gecentraliseerd in
`src/data/site.ts` zodat jij ze op één plek invult:

- Exact adres, telefoonnummer, algemeen e-mailadres, ondernemingsnummer
- Oprichtingsjaar, teamgrootte, namen/functies van medewerkers
- Referenties, klantnamen, aantal ziekenhuizen, certificeringen
- Concrete cijfers of resultaten ("X% minder ligduur" e.d.)
- Officieel logo — ik maak een sober tekstlogo als tijdelijke invulling

Ik zet ook geen claims op de site die ik niet kan onderbouwen.

---

## 8. Buiten scope (deze ronde)

- Effectieve e-mailkoppeling van het formulier (wel voorbereid)
- CMS, meertaligheid (EN/FR), blog/nieuws, klantenportaal
- Analytics/cookiebanner
- Deploy naar het echte domein — expliciet uitgesloten

---

## 9. Vragen aan jou

1. **Tekstlogo of echt logo?** Heb je een logobestand, of maak ik een tijdelijk tekstlogo?
2. **Kleuraccent** — is het diepblauw + teal uit §4 goed, of volg je liever de
   huisstijl van de bestaande medaman.be?
3. **Contactgegevens** — invullen of overal placeholders laten staan?
4. **Deploy** — wil je dat ik na de bouw ook een preview-deploy klaarzet
   (Netlify/Cloudflare), of eerst enkel de code?
5. **Aanspreking** — "u" (formeel, gekozen in dit plan) of "je"?

Zeg gerust "ga door" en ik bouw dit met de bovenstaande keuzes en placeholders.
