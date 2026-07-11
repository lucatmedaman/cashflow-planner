# Cashflow Planner — cloud-versie (Vercel + Airtable-proxy)

Deze versie draait volledig in de cloud, zonder lokale server. Airtable-data
wordt bewaard in de base **Cashflow** (base-ID `appnK89Zxu17tWovZ`). Het
Airtable-token staat **nooit** in de browser — een serverless functie
(`api/airtable/[...path].js`) fungeert als tussenlaag.

## Waarom een proxy-functie?

De vorige lokale versie zette het token rechtstreeks in de browser-bundel
(`VITE_AIRTABLE_TOKEN`). Dat is aanvaardbaar zolang je de app alleen zelf
lokaal draait, maar **niet** zodra de URL publiek bereikbaar is: iedereen met
de link kan dan via de browser-devtools het volledige token uitlezen en
daarmee schrijven/lezen in je hele Airtable-base. Deze versie lost dat op
door het token alleen op de server te bewaren.

## Deployen naar Vercel (gratis tier)

1. Zet deze projectmap in een git-repository (GitHub, GitLab, of Bitbucket).
2. Ga naar https://vercel.com, maak een account, en importeer die repository
   ("Add New Project" → kies je repo). Vercel herkent Vite automatisch.
3. Voeg vóór de eerste deploy een **Environment Variable** toe in de
   Vercel-projectinstellingen:
   - Naam: `AIRTABLE_TOKEN`
   - Waarde: je Personal Access Token (zie hieronder)
   - **Geen** `VITE_`-prefix gebruiken — anders belandt hij alsnog in de
     browser-bundel.
4. Deploy. Je krijgt een URL zoals `https://jouw-project.vercel.app` die
   overal werkt, ook op je iPad, zonder dat er iets lokaal moet draaien.

### Personal Access Token aanmaken

https://airtable.com/create/tokens
- Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`
- Access: enkel de base **Cashflow**

## Lokaal ontwikkelen/testen

Gebruik de Vercel CLI in plaats van `vite dev`, zodat de proxy-functie ook
lokaal meedraait:

```
npm install -g vercel
vercel dev
```

Kopieer `.env.example` naar `.env` en vul `AIRTABLE_TOKEN` in — deze wordt
alleen door de serverless functie gelezen (`process.env`), nooit door Vite
in de client-bundel gestopt.

`npm run dev` (kale Vite dev-server) werkt niet meer voor dataverkeer, omdat
die de `api/`-map niet meedraait — gebruik altijd `vercel dev`.

## Beveiliging, ook in de cloud-versie

- Het token verlaat de server nooit. De browser praat alleen met
  `/api/airtable/...` op je eigen domein.
- **Wel nog een aandachtspunt:** de app zelf heeft geen inlogscherm — iedereen
  met de URL kan lezen/schrijven in je cashflow-data (niet in je hele
  Airtable-account, enkel via deze app). Wil je dat afschermen, dan is
  Vercel's ingebouwde "Password Protection" (betaalde tier) of een simpele
  eigen inlogstap een volgende stap — laat het weten als je dat wil.

## Hoe de synchronisatie werkt

- Bij opstarten haalt de app boekhoudingen, posten en debiteuren/crediteuren
  rechtstreeks uit Airtable (via de proxy).
- Elke wijziging wordt meteen weggeschreven — geen aparte opslaan-knop.
- Werk je vanaf meerdere toestellen? Herlaad de pagina om de nieuwste stand
  op te halen (geen realtime push tussen toestellen).
- Airtable tijdelijk onbereikbaar → terugval op de laatste lokale
  `localStorage`-kopie, met duidelijke "Offline"-melding en een
  "Opnieuw verbinden"-knop.

## Export/Import (back-up, niet de hoofdopslag)

- **Exporteer JSON**: momentopname van de huidige data, los van Airtable.
- **Importeer JSON**: voegt de inhoud toe als **nieuwe** records in Airtable
  (geen overschrijving) — gebruik dit bewust, niet routinematig.
