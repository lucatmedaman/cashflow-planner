import PaginaKop from "../components/ui/PaginaKop";
import Sectie from "../components/ui/Sectie";
import Placeholder from "../components/ui/Placeholder";
import ContactFormulier from "../components/ContactFormulier";
import useDocumentTitel from "../hooks/useDocumentTitel";
import { site, isPlaceholder } from "../data/site";

export default function Contact() {
  useDocumentTitel(
    "Contact · Medaman",
    "Neem contact op met Medaman in Lokeren voor een vraag over ziekenhuisdata, benchmarking, coderingsaudits of rapportage.",
  );

  const c = site.contact;

  return (
    <>
      <PaginaKop
        eyebrow="Contact"
        titel="Laat weten waar u mee zit"
        lede="Een korte beschrijving van uw vraag en van de gegevens die u ter beschikking heeft, volstaat om een eerste inschatting te maken. Wij laten ook weten wanneer een analyse níét zinvol is."
        kruimels={[{ label: "Home", to: "/" }]}
        huidig="Contact"
      />

      <Sectie>
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)] lg:gap-14">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-primair sm:text-3xl">
              Stel uw vraag
            </h2>
            <p className="mb-8 mt-3 text-lg text-gedempt">
              We antwoorden doorgaans binnen twee werkdagen.
            </p>
            <ContactFormulier />
          </div>

          <aside aria-label="Contactgegevens" className="grid gap-4">
            <div className="rounded-md border border-rand p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-accent">
                Rechtstreeks
              </h2>
              <dl className="grid gap-3">
                <div>
                  <dt className="text-xs text-gedempt">E-mail</dt>
                  <dd className="font-medium">
                    <Placeholder
                      waarde={c.email}
                      href={isPlaceholder(c.email) ? undefined : `mailto:${c.email}`}
                    />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gedempt">Telefoon</dt>
                  <dd className="font-medium">
                    <Placeholder
                      waarde={c.telefoon}
                      href={
                        isPlaceholder(c.telefoon)
                          ? undefined
                          : `tel:${c.telefoon.replace(/\s/g, "")}`
                      }
                    />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-gedempt">Bereikbaarheid</dt>
                  <dd className="font-medium">{c.bereikbaarheid}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-md border border-rand p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-accent">
                Adres
              </h2>
              <address className="not-italic leading-loose text-gedempt">
                {site.naam}
                <br />
                <Placeholder waarde={c.straat} />
                <br />
                <Placeholder waarde={c.postcode} /> {c.gemeente}
                <br />
                {c.land}
              </address>
            </div>

            <div className="rounded-md border border-rand bg-zacht p-5">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-accent">
                Over uw gegevens
              </h2>
              <p className="text-[0.93rem] text-gedempt">
                Wat u hier invult, gebruiken we uitsluitend om uw vraag te beantwoorden.
                Stuur via dit formulier geen patiëntgegevens door — voor de uitwisseling
                van data maken we vooraf afspraken en een verwerkersovereenkomst.
              </p>
            </div>
          </aside>
        </div>
      </Sectie>
    </>
  );
}
