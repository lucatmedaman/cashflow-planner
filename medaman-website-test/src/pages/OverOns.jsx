import PaginaKop from "../components/ui/PaginaKop";
import Sectie from "../components/ui/Sectie";
import SectieKop from "../components/ui/SectieKop";
import Kaart from "../components/ui/Kaart";
import CTA from "../components/CTA";
import useDocumentTitel from "../hooks/useDocumentTitel";
import { site, principes, gegevensafspraken } from "../data/site";

const kerngegevens = [
  { label: "Vestiging", waarde: `${site.contact.gemeente}, ${site.contact.land}` },
  { label: "Domein", waarde: "Healthcare data analytics" },
  { label: "Werkgebied", waarde: "Belgische ziekenhuizen" },
  { label: "Doelgroepen", waarde: "Directie, coderingsdienst, kwaliteitsafdeling" },
];

export default function OverOns() {
  useDocumentTitel(
    "Over ons · Medaman",
    "Medaman is een healthcare data analytics bedrijf in Lokeren dat werkt voor Belgische ziekenhuizen: onafhankelijk, methodologisch transparant en zorgvuldig met gevoelige gegevens.",
  );

  return (
    <>
      <PaginaKop
        eyebrow="Over ons"
        titel="Een analysebureau dat de taal van het ziekenhuis spreekt"
        lede="Medaman is gevestigd in Lokeren en werkt voor Belgische ziekenhuizen. Wij zijn geen algemeen data-analysebureau dat ook toevallig in de zorg actief is — dit is het enige domein waarin we werken."
        kruimels={[{ label: "Home", to: "/" }]}
        huidig="Over ons"
      />

      <Sectie>
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.6fr)_minmax(260px,0.7fr)] lg:gap-14">
          <div className="max-w-tekst space-y-4">
            <h2 className="text-2xl font-semibold tracking-tight text-primair sm:text-3xl">
              Wat we doen
            </h2>
            <p className="text-gedempt">
              Ziekenhuizen registreren enorm veel: diagnoses, verrichtingen, verblijven,
              verpleegkundige zorgzwaarte, facturatiegegevens. Die registratie dient in de
              eerste plaats een administratief doel, maar ze bevat daarnaast een
              gedetailleerd beeld van wat er in het huis gebeurt.
            </p>
            <p className="text-gedempt">
              Dat beeld eruit halen vraagt meer dan een analysetool. Het vraagt kennis van
              codeerregels, van groepering en van de manier waarop registratie en
              financiering in België aan elkaar hangen. Zonder die kennis wordt elke
              afwijking een vraagteken — en met die kennis meestal een verklaarbaar
              verhaal, met hier en daar een punt dat werkelijk aandacht verdient.
            </p>
            <p className="text-gedempt">
              Wij doen dat werk: van coderingsaudit tot benchmark, van ligduuranalyse tot
              periodieke rapportage. Steeds op de eigen data van het ziekenhuis, en steeds
              op een manier die intern navolgbaar blijft.
            </p>
          </div>

          <div className="rounded-md border border-rand bg-zacht p-6">
            <h2 className="sr-only">Kerngegevens</h2>
            <dl className="grid gap-4">
              {kerngegevens.map((rij) => (
                <div key={rij.label}>
                  <dt className="mb-1 text-xs uppercase tracking-wider text-gedempt">
                    {rij.label}
                  </dt>
                  <dd className="font-semibold text-primair">{rij.waarde}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </Sectie>

      <Sectie variant="zacht">
        <SectieKop
          eyebrow="Werkwijze"
          titel="Vier principes waar we niet van afwijken"
          lede="Ze klinken vanzelfsprekend, maar ze bepalen in de praktijk waar we wél en niet op ingaan."
          className="mb-8"
        />
        <div className="grid gap-6 sm:grid-cols-2">
          {principes.map((p) => (
            <Kaart key={p.titel}>
              <h3 className="text-lg font-semibold text-primair">{p.titel}</h3>
              <p className="text-[0.95rem] text-gedempt">{p.tekst}</p>
            </Kaart>
          ))}
        </div>
      </Sectie>

      <Sectie>
        <SectieKop
          eyebrow="Gegevensbescherming"
          titel="Werken met gevoelige gegevens"
          lede="Ziekenhuisdata zijn gezondheidsgegevens. Dat bepaalt hoe we werken, vanaf het eerste gesprek en niet pas bij de eerste levering."
          className="mb-8"
        />
        <dl className="grid gap-5 sm:grid-cols-2 sm:gap-x-12">
          {gegevensafspraken.map((g) => (
            <div key={g.label} className="border-l-2 border-rand pl-4">
              <dt className="text-[0.95rem] font-semibold text-primair">{g.label}</dt>
              <dd className="mt-1 text-[0.95rem] text-gedempt">{g.tekst}</dd>
            </div>
          ))}
        </dl>
      </Sectie>

      <Sectie variant="zacht">
        <SectieKop eyebrow="Team" titel="Wie u aan tafel krijgt" className="mb-8" />
        <div className="max-w-tekst space-y-4">
          <p className="placeholder block">
            [[ Nog in te vullen: korte voorstelling van het team — achtergrond in
            gezondheidszorg, informatica en statistiek, aantal medewerkers, eventueel
            namen en functies van de mensen die de opdrachten uitvoeren. ]]
          </p>
          <p className="text-gedempt">
            Bij elke opdracht is er één vast aanspreekpunt dat de analyse ook zelf
            uitvoert. U bespreekt de resultaten dus met wie de cijfers gemaakt heeft, niet
            met een tussenpersoon.
          </p>
        </div>
      </Sectie>

      <CTA
        titel="Benieuwd of dit bij uw vraag past?"
        tekst="Een kennismakingsgesprek verplicht tot niets en levert doorgaans al een eerste inschatting op van wat uw gegevens kunnen beantwoorden."
      />
    </>
  );
}
