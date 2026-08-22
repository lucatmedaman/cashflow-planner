import Sectie from "../components/ui/Sectie";
import SectieKop from "../components/ui/SectieKop";
import Kaart from "../components/ui/Kaart";
import Knop from "../components/ui/Knop";
import DienstKaart from "../components/DienstKaart";
import DataVisual from "../components/DataVisual";
import Stappen from "../components/Stappen";
import CTA from "../components/CTA";
import useDocumentTitel from "../hooks/useDocumentTitel";
import { diensten } from "../data/diensten";
import { vertrouwenspunten, waarom } from "../data/site";

export default function Home() {
  useDocumentTitel(
    "Medaman · Healthcare data analytics voor ziekenhuizen",
    "Medaman analyseert ziekenhuisdata voor Belgische ziekenhuizen: benchmarking, ICD-10-CM coding audits, APR-DRG/NRG-analyses, length of stay, PSI-indicatoren en klinische rapportage.",
  );

  return (
    <>
      <section className="border-b border-rand bg-gradient-to-b from-[#FBFCFD] to-white py-14 md:py-20 lg:py-24">
        <div className="mx-auto grid w-full max-w-[1160px] items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <span className="mb-3 block text-xs font-semibold uppercase tracking-[0.12em] text-accent">
              Healthcare data analytics · Lokeren
            </span>
            <h1 className="max-w-[19ch] text-4xl font-semibold leading-tight tracking-tight text-primair text-balance sm:text-5xl">
              Inzicht in uw ziekenhuisdata — van codering tot casemix
            </h1>
            <p className="mt-5 max-w-tekst text-lg text-gedempt">
              Wij analyseren de registratie- en facturatiegegevens van Belgische
              ziekenhuizen en vertalen ze naar bevindingen die stand houden: aan de
              directietafel, in de medische raad en bij de coderingsdienst.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Knop to="/diensten">Bekijk onze diensten</Knop>
              <Knop to="/contact" variant="secundair">
                Neem contact op
              </Knop>
            </div>
          </div>

          <div className="rounded-md border border-rand bg-white p-6 sm:p-8">
            <DataVisual />
          </div>
        </div>
      </section>

      <Sectie variant="zacht">
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {vertrouwenspunten.map((punt) => (
            <li key={punt.titel} className="border-t-2 border-accent pt-4">
              <h2 className="mb-2 text-base font-semibold text-primair">{punt.titel}</h2>
              <p className="text-[0.94rem] text-gedempt">{punt.tekst}</p>
            </li>
          ))}
        </ul>
      </Sectie>

      <Sectie>
        <SectieKop
          eyebrow="Diensten"
          titel="Zes domeinen, één gemeenschappelijke basis"
          lede="Elke opdracht vertrekt van dezelfde bronnen — uw eigen registratie — en van dezelfde eis: elk cijfer moet navolgbaar zijn tot op het dossier."
          className="mb-8"
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {diensten.map((dienst) => (
            <DienstKaart key={dienst.slug} dienst={dienst} />
          ))}
        </div>
      </Sectie>

      <Sectie variant="zacht">
        <SectieKop
          eyebrow="Aanpak"
          titel="Drie stappen, geen verrassingen achteraf"
          className="mb-8"
        />
        <Stappen />
      </Sectie>

      <Sectie>
        <SectieKop
          eyebrow="Waarom Medaman"
          titel="Analyse die de toets van de vakgroep doorstaat"
          className="mb-8"
        />
        <div className="grid gap-6 lg:grid-cols-3">
          {waarom.map((blok) => (
            <Kaart key={blok.titel}>
              <h3 className="text-lg font-semibold text-primair">{blok.titel}</h3>
              <p className="text-[0.95rem] text-gedempt">{blok.tekst}</p>
            </Kaart>
          ))}
        </div>
      </Sectie>

      <CTA />
    </>
  );
}
