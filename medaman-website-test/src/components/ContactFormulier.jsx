import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { formulier, site, isPlaceholder } from "../data/site";

const LEEG = {
  naam: "",
  organisatie: "",
  functie: "",
  email: "",
  telefoon: "",
  onderwerp: "",
  bericht: "",
  akkoord: false,
  website: "", // honeypot
};

/** Validatie op één plek, zodat submit en blur dezelfde regels gebruiken. */
function valideer(waarden) {
  const fouten = {};
  if (!waarden.naam.trim()) fouten.naam = "Dit veld is verplicht.";
  if (!waarden.organisatie.trim()) fouten.organisatie = "Dit veld is verplicht.";
  if (!waarden.email.trim()) {
    fouten.email = "Dit veld is verplicht.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(waarden.email.trim())) {
    fouten.email = "Vul een geldig e-mailadres in.";
  }
  if (!waarden.onderwerp) fouten.onderwerp = "Maak een keuze.";
  if (!waarden.bericht.trim()) {
    fouten.bericht = "Dit veld is verplicht.";
  } else if (waarden.bericht.trim().length < 10) {
    fouten.bericht = "Graag iets meer toelichting.";
  }
  if (!waarden.akkoord) fouten.akkoord = "Vink dit aan om verder te kunnen.";
  return fouten;
}

const veldKlasse = (fout) =>
  `w-full rounded border px-3 py-2.5 text-[0.97rem] text-tekst focus:border-primair-licht focus:outline-none focus:ring-2 focus:ring-primair-licht/35 ${
    fout ? "border-[#B3261E]" : "border-rand-sterk"
  }`;

export default function ContactFormulier() {
  const [waarden, setWaarden] = useState(LEEG);
  const [fouten, setFouten] = useState({});
  const [geprobeerd, setGeprobeerd] = useState(false);
  const [verzonden, setVerzonden] = useState(false);
  const formRef = useRef(null);

  const gekoppeld = formulier.endpoint !== null;
  const emailBekend = !isPlaceholder(site.contact.email);

  const wijzig = (e) => {
    const { name, value, type, checked } = e.target;
    const nieuw = { ...waarden, [name]: type === "checkbox" ? checked : value };
    setWaarden(nieuw);
    // Pas na een eerste verzendpoging live meevalideren — anders krijgt de
    // bezoeker foutmeldingen terwijl hij nog aan het typen is.
    if (geprobeerd) setFouten(valideer(nieuw));
  };

  const verzend = (e) => {
    e.preventDefault();
    setGeprobeerd(true);

    const nieuweFouten = valideer(waarden);
    setFouten(nieuweFouten);

    const eerste = Object.keys(nieuweFouten)[0];
    if (eerste) {
      const veld = formRef.current?.elements[eerste];
      veld?.focus();
      veld?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }

    // Honeypot ingevuld: stil doen alsof alles goed ging.
    if (waarden.website) {
      setWaarden(LEEG);
      setVerzonden(true);
      return;
    }

    if (!gekoppeld) {
      setVerzonden(true);
      return;
    }

    formRef.current.submit();
  };

  const Fout = ({ veld }) =>
    fouten[veld] ? (
      <span id={`fout-${veld}`} className="text-[0.87rem] font-medium text-[#B3261E]">
        {fouten[veld]}
      </span>
    ) : null;

  const aria = (veld) => ({
    "aria-invalid": fouten[veld] ? "true" : undefined,
    "aria-describedby": fouten[veld] ? `fout-${veld}` : undefined,
  });

  return (
    <form
      ref={formRef}
      onSubmit={verzend}
      method="post"
      action={formulier.endpoint ?? undefined}
      noValidate
      className="max-w-[640px]"
    >
      {/* Honeypot: onzichtbaar voor mensen, aantrekkelijk voor bots. */}
      <div className="absolute -left-[9999px] h-px w-px overflow-hidden" aria-hidden="true">
        <label htmlFor="website">Vul dit veld niet in</label>
        <input
          id="website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={waarden.website}
          onChange={wijzig}
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <p className="grid gap-2">
          <label htmlFor="naam" className="text-[0.92rem] font-semibold text-primair">
            Naam <span aria-hidden="true">*</span>
          </label>
          <input
            id="naam"
            name="naam"
            type="text"
            autoComplete="name"
            value={waarden.naam}
            onChange={wijzig}
            className={veldKlasse(fouten.naam)}
            {...aria("naam")}
          />
          <Fout veld="naam" />
        </p>

        <p className="grid gap-2">
          <label htmlFor="organisatie" className="text-[0.92rem] font-semibold text-primair">
            Ziekenhuis of organisatie <span aria-hidden="true">*</span>
          </label>
          <input
            id="organisatie"
            name="organisatie"
            type="text"
            autoComplete="organization"
            value={waarden.organisatie}
            onChange={wijzig}
            className={veldKlasse(fouten.organisatie)}
            {...aria("organisatie")}
          />
          <Fout veld="organisatie" />
        </p>

        <p className="grid gap-2">
          <label htmlFor="functie" className="text-[0.92rem] font-semibold text-primair">
            Functie
          </label>
          <input
            id="functie"
            name="functie"
            type="text"
            autoComplete="organization-title"
            value={waarden.functie}
            onChange={wijzig}
            className={veldKlasse(false)}
          />
        </p>

        <p className="grid gap-2">
          <label htmlFor="email" className="text-[0.92rem] font-semibold text-primair">
            E-mailadres <span aria-hidden="true">*</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={waarden.email}
            onChange={wijzig}
            className={veldKlasse(fouten.email)}
            {...aria("email")}
          />
          <Fout veld="email" />
        </p>

        <p className="grid gap-2">
          <label htmlFor="telefoon" className="text-[0.92rem] font-semibold text-primair">
            Telefoon <span className="font-normal text-gedempt">(optioneel)</span>
          </label>
          <input
            id="telefoon"
            name="telefoon"
            type="tel"
            autoComplete="tel"
            value={waarden.telefoon}
            onChange={wijzig}
            className={veldKlasse(false)}
          />
        </p>

        <p className="grid gap-2">
          <label htmlFor="onderwerp" className="text-[0.92rem] font-semibold text-primair">
            Onderwerp <span aria-hidden="true">*</span>
          </label>
          <select
            id="onderwerp"
            name="onderwerp"
            value={waarden.onderwerp}
            onChange={wijzig}
            className={veldKlasse(fouten.onderwerp)}
            {...aria("onderwerp")}
          >
            <option value="">Maak een keuze</option>
            {formulier.onderwerpen.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <Fout veld="onderwerp" />
        </p>

        <p className="grid gap-2 sm:col-span-2">
          <label htmlFor="bericht" className="text-[0.92rem] font-semibold text-primair">
            Uw vraag <span aria-hidden="true">*</span>
          </label>
          <textarea
            id="bericht"
            name="bericht"
            rows={6}
            value={waarden.bericht}
            onChange={wijzig}
            className={`${veldKlasse(fouten.bericht)} min-h-32 resize-y`}
            {...aria("bericht")}
          />
          <span className="text-[0.85rem] text-gedempt">
            Het helpt als u vermeldt over welke periode en welke gegevens het gaat.
          </span>
          <Fout veld="bericht" />
        </p>

        <p className="grid gap-2 sm:col-span-2">
          <span className="flex items-start gap-3">
            <input
              id="akkoord"
              name="akkoord"
              type="checkbox"
              checked={waarden.akkoord}
              onChange={wijzig}
              className="mt-1 h-4 w-4 flex-none accent-primair"
              {...aria("akkoord")}
            />
            <label htmlFor="akkoord" className="text-[0.92rem] leading-relaxed text-gedempt">
              Ik ga ermee akkoord dat mijn gegevens worden gebruikt om deze vraag te
              beantwoorden. Stuur via dit formulier geen patiëntgegevens door.{" "}
              <span aria-hidden="true">*</span>
            </label>
          </span>
          <Fout veld="akkoord" />
        </p>
      </div>

      <p className="mb-5 mt-4 text-[0.85rem] text-gedempt">
        <span aria-hidden="true">*</span> Verplicht veld
      </p>

      <button
        type="submit"
        className="inline-flex items-center justify-center rounded border border-primair bg-primair px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primair-diep"
      >
        Verstuur uw vraag
      </button>

      <p role="status" aria-live="polite">
        {verzonden && (
          <span className="mt-4 block rounded border border-accent bg-accent-zacht p-4 text-[0.93rem]">
            Alles is correct ingevuld, maar in deze testversie is het formulier nog niet
            aan een mailbox gekoppeld.
            {emailBekend
              ? ` Stuur uw vraag zolang naar ${site.contact.email}.`
              : ""}
          </span>
        )}
      </p>

      {!gekoppeld && (
        <p className="mt-5 border-l-[3px] border-accent bg-zacht p-4 text-[0.9rem] text-gedempt">
          <strong className="text-primair">Let op:</strong> dit is v1 zonder
          backend-koppeling. Het formulier valideert wel volledig, maar verzendt nog
          niets. Koppelen gebeurt op één plek in <code>src/data/site.js</code>. Zie ook de{" "}
          <Link to="/contact" className="text-primair-licht">
            contactgegevens
          </Link>{" "}
          hiernaast.
        </p>
      )}
    </form>
  );
}
