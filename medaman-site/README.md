# Medaman — bedrijfswebsite (TEST)

Statische website voor Medaman, healthcare data analytics in Lokeren.

> **Dit is een testproject.** Het is géén vervanging van de bestaande medaman.be en
> hoort niet op dat domein terecht te komen. De site staat op `noindex` (in
> `robots.txt`, in een meta-tag en in de Netlify-headers) en toont bovenaan elke
> pagina een testbanner. Verwijder die drie dingen pas bewust, als de site ooit
> echt live gaat.

## Aan de slag

```bash
cd medaman-site
npm install
npm run dev      # ontwikkelserver op http://localhost:4321
npm run build    # statische build naar dist/
npm run preview  # bekijk de build lokaal
npm run check    # typecheck van .astro- en .ts-bestanden
```

Vereist Node 22 of nieuwer.

## Opbouw

```
src/
├── components/     Header, Footer, kaarten, contactformulier, logo, datavisual
├── content/
│   └── diensten/   Eén markdown-bestand per dienst (de inhoud van de site)
├── data/site.ts    Bedrijfsgegevens, navigatie, formulierkoppeling
├── layouts/        Base.astro — SEO-head, structured data, header/footer
├── pages/          index, diensten, diensten/[slug], over-ons, contact, privacy, 404
└── styles/         global.css — design tokens en basisstijlen
```

**Een dienst wijzigen of toevoegen** doe je in `src/content/diensten/`. Eén bestand
is één dienst; de bestandsnaam wordt de URL. De frontmatter volgt het vaste
stramien van de detailpagina's, de markdown-body is de inleidende tekst. Een nieuw
bestand verschijnt automatisch op de home, de overzichtspagina, in de footer en in
de sitemap.

Let bij het bewerken op één YAML-valkuil: een waarde met een dubbele punt erin moet
tussen aanhalingstekens (`- 'Sequencing nakijken: is de hoofddiagnose correct?'`).

## Nog in te vullen

Gegevens die ik niet ken, staan als placeholder tussen dubbele haken en worden op de
site zichtbaar gemarkeerd met een gestippelde onderlijn. Ze zitten op één plek:
`src/data/site.ts`. Concreet gaat het om adres, telefoon, e-mailadres en
ondernemingsnummer.

Verder staat er nog een placeholder in de teamsectie van `src/pages/over-ons.astro`
en in de privacyverklaring (bewaartermijn en publicatiedatum).

Placeholders worden bewust weggelaten uit de structured data — half ingevulde
gegevens horen niet machineleesbaar gepubliceerd te worden.

## Contactformulier koppelen

Het formulier valideert volledig maar verstuurt nog niets. Aanzetten gebeurt in
`src/data/site.ts`, in het `formulier`-object:

| Doel | Instelling |
|---|---|
| Netlify Forms | `netlify: true` |
| Formspree | `endpoint: 'https://formspree.io/f/xxxxxxx'` |
| Eigen backend | `endpoint: 'https://…/contact'` |

Zolang beide leeg blijven, toont het formulier na een geldige invoer een melding dat
de koppeling nog volgt. Er zit een honeypot-veld in tegen bots; een ingevuld
honeypot-veld levert een schijnbaar geslaagde verzending op zonder dat er iets
gebeurt.

Vergeet bij het koppelen niet dat de privacyverklaring een concept is die juridisch
nagelezen moet worden.

## Deploy naar een preview-URL

**Netlify** — `netlify.toml` staat klaar met `base = "medaman-site"`. Koppel de repo,
kies de branch, en Netlify bouwt de submap. Je krijgt een `*.netlify.app`-adres.

**Cloudflare Pages** — maak een project op deze repo met:

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `medaman-site`
- Environment variable: `NODE_VERSION = 22`

Pas na de eerste deploy `site` in `astro.config.mjs` aan naar de toegekende
preview-URL, zodat de canonical-links en de sitemap kloppen.

## Wat er bewust niet in zit

Geen analytics, geen cookiebanner, geen externe lettertypes of scripts — de site
laadt niets van buitenaf. Geen CMS, geen meertaligheid en geen blog; die zijn wel
in te passen zonder de structuur om te gooien.
