# Plan — Medaman testwebsite (React + Vite + Tailwind)

> **Status:** voorstel — wacht op goedkeuring vóór stap 2 (project opzetten).
> **TEST-project.** Geen wijziging aan de live medaman.be. De site krijgt `noindex`
> en een testbanner, en gaat uitsluitend naar een Vercel-test-URL.

---

## 1. Stack

Afgestemd op je bestaande `cashflow-cloud`-project, zodat het vertrouwd aanvoelt:

| Onderdeel | Versie / keuze |
|---|---|
| React | 18.2 |
| Vite | 5.x, `@vitejs/plugin-react` |
| Tailwind CSS | 3.4 + postcss + autoprefixer |
| Taal | Plain JSX (geen TypeScript, zoals in cashflow-cloud) |
| Routing | `react-router-dom` 6 |
| Iconen | `lucide-react` (heb je al in gebruik) |
| Deploy | Vercel, test-URL |

Eén toevoeging tegenover cashflow-cloud: `react-router-dom`, nodig voor vier
aparte pagina's. Verder geen extra dependencies — geen UI-kit, geen animatie-
library, geen formulierframework.

---

## 2. Paginastructuur

```
/            Home
/diensten    Diensten (alle zes op één pagina, met ankernavigatie)
/over-ons    Over ons
/contact     Contact + formulier
*            404
```

Vier pagina's zoals gevraagd. De zes diensten worden **volwaardige secties op
één Diensten-pagina**, elk met een eigen anker (`/diensten#psi-indicatoren`) en
een sticky zijnavigatie om ertussen te springen. Dat houdt het aantal routes
laag en maakt de hele inhoud in één scroll doorzoekbaar.

> Wil je liever een aparte route per dienst (`/diensten/psi-indicatoren`), dan
> zeg je dat nu — de datastructuur ondersteunt beide, het is alleen een andere
> route-opzet.

### Home

1. **Hero** — waardepropositie, twee CTA's, abstract datavisual (SVG)
2. **Vertrouwensbalk** — vier kernpunten (Belgische ziekenhuiscontext,
   methodologisch transparant, GDPR, bruikbaar voor directie én codering)
3. **Diensten in het kort** — zes kaarten, elk linkend naar het anker op /diensten
4. **Aanpak** — drie stappen: intake & validatie → analyse → rapportage
5. **Waarom Medaman** — drie blokken
6. **Slot-CTA** → /contact

### Diensten

Intro, daarna per dienst een sectie met een vast stramien: samenvatting, voor
wie, wat we doen, wat u krijgt, methodologie/aandachtspunten. De zes:
hospital benchmarking, ICD-10-CM coding audits, APR-DRG/NRG-analyses,
length-of-stay analyse, PSI-indicatoren (AHRQ), klinische rapportage.

### Over ons

Wie Medaman is (Lokeren, Belgische ziekenhuizen), vier werkwijze-principes,
een blok over het werken met gezondheidsgegevens (verwerkersovereenkomst,
dataminimalisatie, pseudonimisering, bewaartermijn, toegang), en een
teamsectie met placeholder.

### Contact

Formulier + contactgegevens + een korte nota over gegevensbescherming.

---

## 3. Componentoverzicht

```
src/
├── main.jsx                     React-root + BrowserRouter
├── App.jsx                      Routes + gedeelde layout
├── index.css                    Tailwind-directives + een paar base-stijlen
│
├── components/
│   ├── layout/
│   │   ├── Header.jsx           Sticky header, logo, nav, mobiel menu, testbanner
│   │   ├── Footer.jsx           Vier kolommen: merk, diensten, bedrijf, contact
│   │   ├── Layout.jsx           Header + <Outlet/> + Footer + skip-link
│   │   └── ScrollNaarBoven.jsx  Scrollt naar boven bij routewissel, respecteert ankers
│   │
│   ├── ui/
│   │   ├── Knop.jsx             Varianten: primair, secundair, opDonker
│   │   ├── Kaart.jsx            Basiskaart, optioneel klikbaar
│   │   ├── Sectie.jsx           Sectie-wrapper: variant wit/zacht/donker + padding
│   │   ├── SectieKop.jsx        Eyebrow + h2 + lede
│   │   ├── Label.jsx            Doelgroeplabel (Directie, Codering, Kwaliteit)
│   │   ├── Lijst.jsx            Opsomming met streepje- of vinkje-marker
│   │   └── Placeholder.jsx      Markeert nog in te vullen gegevens zichtbaar
│   │
│   ├── DienstKaart.jsx          Kaart op home + dienstenoverzicht
│   ├── DienstSectie.jsx         Volledige dienstsectie op /diensten
│   ├── DienstNavigatie.jsx      Sticky ankernavigatie langs de zes diensten
│   ├── DataVisual.jsx           Abstract staaf/lijn-motief in SVG, decoratief
│   ├── Stappen.jsx              De drie stappen van de aanpak
│   ├── CTA.jsx                  Herbruikbaar donker CTA-blok
│   └── ContactFormulier.jsx     Gecontroleerde velden + validatie + honeypot
│
├── pages/
│   ├── Home.jsx
│   ├── Diensten.jsx
│   ├── OverOns.jsx
│   ├── Contact.jsx
│   └── NietGevonden.jsx
│
└── data/
    ├── diensten.js              De zes diensten als data-objecten
    └── site.js                  Bedrijfsgegevens, navigatie, formulierconfig
```

**Waarom data apart van componenten:** de inhoud is het grootste deel van deze
site. In `data/diensten.js` staat per dienst één object (slug, titel, korte
tekst, doelgroepen, voorWie, watWeDoen[], watUKrijgt[], methodologie[]).
`DienstSectie` rendert dat stramien; een dienst wijzigen of toevoegen is dan
een data-wijziging, geen JSX-wijziging. De navigatie, de home-kaarten en de
footer worden alle drie uit diezelfde array afgeleid.

---

## 4. Styling — professioneel/klinisch

Design tokens in `tailwind.config.js` onder `theme.extend`, zodat we in de JSX
met `bg-primair`, `text-gedempt` enzovoort werken in plaats van met losse hex-
waarden:

| Token | Waarde | Gebruik |
|---|---|---|
| `primair` | `#0F3D5C` | Koppen, knoppen, donkere vlakken |
| `primair-licht` | `#1B6E9B` | Links, hover |
| `primair-diep` | `#0A2C43` | Footer, hover op knoppen |
| `accent` | `#0E8F7E` | Eén teal accent, spaarzaam |
| `zacht` | `#F4F7F9` | Afwisselende sectie-achtergrond |
| `tekst` / `gedempt` | `#132029` / `#556270` | Lopende tekst |
| `rand` | `#DCE4EA` | 1px randen in plaats van schaduwen |

Verder: systeemfont-stack (geen externe fonts, dus geen requests naar Google),
rechte vormtaal met 4px-afronding, veel witruimte, WCAG AA-contrast, zichtbare
focus-states, `prefers-reduced-motion` gerespecteerd. Geen stockfoto's — wel
abstracte SVG-datavisuals en lijniconen uit lucide-react.

Responsive is mobile-first met de standaard Tailwind-breakpoints; het menu
klapt onder `lg` in een hamburger.

---

## 5. Contactformulier (v1, zonder backend)

- Velden: naam*, ziekenhuis/organisatie*, functie, e-mail*, telefoon,
  onderwerp* (keuzelijst met de zes diensten + "algemene vraag"), bericht*,
  akkoordvinkje privacy*
- Gecontroleerde React-state, validatie bij submit én bij blur na een eerste
  poging, Nederlandse foutmeldingen, focus springt naar het eerste foute veld
- `aria-invalid` + `aria-describedby` op foutmeldingen
- Honeypot-veld tegen bots
- Bij geldige invoer: succesmelding in beeld, met de expliciete vermelding dat
  er in v1 nog niets verstuurd wordt
- Koppelen later is één plek in `data/site.js`: een `endpoint` invullen
  (Formspree, of een Vercel serverless function onder `/api/contact`)

---

## 6. Waar het gebouwd wordt

Ik bouw in `medaman-website-test/` in deze werkmap en commit tussentijds naar de
branch `claude/medaman-website-iktods`. Reden: deze sessie draait in een
tijdelijke container, en zonder commit is het werk weg als de sessie afloopt.
Bij stap 5 wordt het een **eigen, losse repo** met schone git-historie — de
kopie op deze branch is puur een vangnet.

> Ter info: de Astro-versie van eerder blijft in `medaman-site/` staan. Deze
> React-versie staat daar volledig los van; ik hergebruik wel de al
> uitgeschreven dienstteksten, zodat de inhoud niet opnieuw bedacht hoeft te
> worden.

---

## 7. Stappen 5 en 6 — twee dingen die ik niet zelf kan

Ik meld ze nu in plaats van bij de uitvoering, want ze bepalen wat je zelf moet
doen:

**GitHub — nieuwe repo.** De GitHub-toegang van deze sessie is toegewezen aan
`lucatmedaman/cashflow-planner`. Of ik daarmee een nieuwe repo
`medaman-website-test` kan aanmaken en pushen, weet ik pas als ik het probeer.
Lukt het niet, dan zijn er twee uitwegen: jij maakt de lege repo aan en ik push
erheen (als de toegang dat toelaat), of je krijgt het volledige project als map
en zet het zelf in een minuut op GitHub. Ik probeer het pas na jouw akkoord.

**Vercel CLI.** `vercel deploy` vraagt een login via de browser, en deze
container is niet-interactief — die stap kan ik dus niet doorlopen. Twee
werkende alternatieven:

1. **Jij koppelt de repo in Vercel** (importeren, framework Vite,
   `npm run build`, output `dist`). Duurt ongeveer twee minuten en levert
   meteen een `*.vercel.app`-URL op.
2. **Je geeft me een Vercel-token** via een omgevingsvariabele, dan draai ik
   `vercel --token … --prod` vanaf hier. Zet dan wel een token met beperkte
   scope, en trek het achteraf in.

Ik zet `vercel.json` en de buildconfiguratie hoe dan ook klaar, zodat beide
routes meteen werken.

---

## 8. Openstaande punten

Ik verzin geen bedrijfsgegevens. Deze komen als zichtbaar gemarkeerde
placeholders in `data/site.js`, op één plek in te vullen: adres, telefoon,
e-mailadres, ondernemingsnummer, teamvoorstelling. Ook geen referenties,
klantnamen of resultaatcijfers.

Verder graag jouw keuze op:

1. **Diensten** — zes secties op één pagina (mijn voorstel), of toch een aparte
   route per dienst?
2. **Aanspreking** — "u" (gekozen in dit plan) of "je"?
3. **Logo** — heb je een bestand, of blijft het tekstlogo met staafmotief?

Zeg "ga door" en ik zet het project op en bouw het. Voor stap 5 en 6 vraag ik
opnieuw expliciet om akkoord.
