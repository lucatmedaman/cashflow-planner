# Stap 5 en 6 — wat ik niet kon, en wat jij moet doen

Beide stappen lopen vast op rechten van mijn omgeving, niet op de code. Het
project zelf is af, getest en gebouwd.

| Stap | Status |
|---|---|
| 5. Nieuwe GitHub-repo | **Geblokkeerd** — `POST /user/repos` geeft 403: de GitHub-integratie van deze sessie mag geen repo's aanmaken. |
| 6. Vercel-deploy | **Geblokkeerd** — de netwerkpolicy blokkeert `api.vercel.com` (403 op de proxy-gateway). Ook mét token lukt het hier niet. |

De code staat wel veilig: in `medaman-website-test/` op de branch
`claude/medaman-website-iktods` van `lucatmedaman/cashflow-planner`.

---

## Stap 5 — losse repo aanmaken en pushen

Maak op GitHub een lege repo `medaman-website-test` (zonder README, zonder
.gitignore, zonder licentie). Daarna, lokaal:

```bash
# Haal de branch op waar het project staat
git clone -b claude/medaman-website-iktods \
  https://github.com/lucatmedaman/cashflow-planner.git medaman-tmp

# Neem alleen deze map mee, met een schone git-historie
cp -r medaman-tmp/medaman-website-test ./medaman-website-test
rm -rf medaman-tmp
cd medaman-website-test

git init
git add .
git commit -m "Medaman testwebsite: React 18 + Vite + Tailwind"
git branch -M main
git remote add origin https://github.com/<jouw-account>/medaman-website-test.git
git push -u origin main
```

Controleer voor het pushen even dat `node_modules/` en `dist/` niet meegaan —
`.gitignore` regelt dat, maar het is een kleine moeite.

## Stap 6 — deployen naar Vercel

`vercel.json` staat klaar, dus er valt niets meer in te stellen:

```json
framework: vite · build: npm run build · output: dist
+ SPA-rewrite (anders geeft /diensten een 404 bij direct laden)
+ X-Robots-Tag: noindex, nofollow
```

**Via de webinterface (het snelst):** ga naar vercel.com/new, kies de repo
`medaman-website-test`, en klik Deploy. Vercel leest alles uit `vercel.json`.
Je krijgt een URL van de vorm `medaman-website-test-<hash>.vercel.app`.

**Via de CLI, lokaal:**

```bash
npm i -g vercel
vercel login
vercel --prod
```

**Wil je dat ik het alsnog vanaf hier doe?** Dan moet `api.vercel.com` in de
netwerkpolicy van deze omgeving toegelaten worden, en moet `VERCEL_TOKEN` als
omgevingsvariabele op de omgeving zelf ingesteld staan. Beide regel je in de
instellingen van de Claude Code-omgeving; een nieuwe sessie pikt ze dan op.
Plak een token niet in de chat — dat komt in het gespreksverslag terecht.

## Na de deploy

Pas niets aan de `noindex`-instellingen aan zolang dit een testsite is. Wil je
het formulier laten werken, zie dan de sectie *Contactformulier* in `README.md`:
dat is één regel in `src/data/site.js`.
