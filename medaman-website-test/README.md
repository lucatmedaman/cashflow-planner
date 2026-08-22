# Medaman — bedrijfswebsite (TEST)

React-website voor Medaman, healthcare data analytics in Lokeren.

> **Dit is een testproject.** Het is géén vervanging van de bestaande medaman.be en
> hoort niet op dat domein terecht te komen. De site staat op `noindex` (in
> `robots.txt`, in een meta-tag en in de Vercel-headers) en toont bovenaan elke
> pagina een testbanner. Verwijder die drie dingen pas bewust, als de site ooit
> echt live gaat.

## Stack

React 18 · Vite 5 · Tailwind 3.4 · react-router-dom 7 · lucide-react.
Plain JSX, geen TypeScript — gelijk aan `cashflow-cloud`.

## Aan de slag

```bash
npm install
npm run dev      # ontwikkelserver op http://localhost:5173
npm run build    # productiebuild naar dist/
npm run preview  # bekijk de build lokaal
```

Vereist Node 20 of nieuwer.

## Opbouw

```
src/
├── main.jsx              React-root + BrowserRouter
├── App.jsx               Routes
├── index.css             Tailwind-directives + base-stijlen
├── components/
│   ├── layout/           Header, Footer, Layout, ScrollNaarBoven
│   ├── ui/               Knop, Kaart, Sectie, SectieKop, PaginaKop,
│   │                     Label, Lijst, Logo, Placeholder
│   ├── DienstKaart.jsx   Kaart op de home
│   ├── DienstSectie.jsx  Volledige dienst op /diensten
│   ├── DienstNavigatie.jsx  Sticky ankernavigatie met scrollspy
│   ├── DataVisual.jsx    Decoratief SVG-motief
│   ├── Stappen.jsx       De drie stappen van de aanpak
│   ├── CTA.jsx           Donker CTA-blok
│   └── ContactFormulier.jsx
├── hooks/
│   └── useDocumentTitel.js  Titel + description per route (nodig in een SPA)
├── data/
│   ├── diensten.js       De zes diensten als data
│   └── site.js           Bedrijfsgegevens, navigatie, formulierconfig
└── pages/                Home, Diensten, OverOns, Contact, NietGevonden
```

**Routes**

| Route | Pagina |
|---|---|
| `/` | Home |
| `/diensten` | Alle zes diensten, elk met een anker (`/diensten#psi-indicatoren`) |
| `/over-ons` | Over ons |
| `/contact` | Contact + formulier |
| `*` | 404 |

**Een dienst wijzigen of toevoegen** doe je in `src/data/diensten.js`. De
ankernavigatie, de kaarten op de home en de footerlinks worden alle drie uit die
array afgeleid, dus één object toevoegen volstaat.

## Nog in te vullen

Gegevens die niet verzonnen mogen worden, staan als placeholder tussen dubbele
haken en worden op de site zichtbaar gemarkeerd met een gestippelde onderlijn.
Ze zitten op één plek: `src/data/site.js` — adres, telefoon, e-mailadres en
ondernemingsnummer. Verder staat er nog een placeholder in de teamsectie van
`src/pages/OverOns.jsx`.

## Contactformulier

v1 heeft bewust geen backend. Het formulier valideert wel volledig: verplichte
velden, e-mailformaat, minimumlengte van het bericht en het akkoordvinkje, met
Nederlandse foutmeldingen, `aria-invalid`/`aria-describedby` en focus die naar
het eerste foute veld springt. Er zit een honeypot-veld in tegen bots.

Koppelen gebeurt op één plek, in `formulier` in `src/data/site.js`:

| Doel | Instelling |
|---|---|
| Formspree | `endpoint: 'https://formspree.io/f/xxxxxxx'` |
| Vercel serverless function | `endpoint: '/api/contact'` |

Zolang `endpoint` op `null` staat, toont het formulier na een geldige invoer een
melding dat de koppeling nog volgt.

## Deploy naar Vercel

`vercel.json` staat klaar: framework `vite`, build `npm run build`, output
`dist`, een SPA-rewrite (nodig omdat client-side routing anders 404 geeft op een
directe URL zoals `/diensten`) en `X-Robots-Tag: noindex`.

Importeer de repo in Vercel; de instellingen worden uit `vercel.json` gelezen.
Je krijgt een `*.vercel.app`-URL.

## Wat er bewust niet in zit

Geen analytics, geen cookiebanner, geen externe lettertypes of scripts — de site
laadt niets van buitenaf. Geen CMS, geen meertaligheid, geen blog.

## Verhouding tot de Astro-versie

Er bestaat een eerdere Astro-uitvoering van dezelfde site in `medaman-site/` op
de branch `claude/medaman-website-iktods`. De dienstteksten zijn gedeeld; de
code staat volledig los van elkaar. Deze React-versie is de versie die naar
Vercel gaat.
