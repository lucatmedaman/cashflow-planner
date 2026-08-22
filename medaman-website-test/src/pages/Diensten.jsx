import PaginaKop from "../components/ui/PaginaKop";
import Sectie from "../components/ui/Sectie";
import DienstSectie from "../components/DienstSectie";
import DienstNavigatie from "../components/DienstNavigatie";
import CTA from "../components/CTA";
import useDocumentTitel from "../hooks/useDocumentTitel";
import { diensten } from "../data/diensten";

export default function Diensten() {
  useDocumentTitel(
    "Diensten · Medaman",
    "Hospital benchmarking, ICD-10-CM coding audits, APR-DRG/NRG-analyses, length-of-stay analyse, PSI-indicatoren en klinische rapportage voor Belgische ziekenhuizen.",
  );

  return (
    <>
      <PaginaKop
        eyebrow="Diensten"
        titel="Wat we voor uw ziekenhuis kunnen analyseren"
        lede="Zes diensten die elkaar aanvullen. Ze staan los te bestellen, maar delen dezelfde bronnen en dezelfde methodologische afspraken — waardoor bevindingen uit verschillende analyses onderling consistent blijven."
        kruimels={[{ label: "Home", to: "/" }]}
        huidig="Diensten"
      />

      <Sectie>
        <div className="grid gap-10 lg:grid-cols-[minmax(220px,0.28fr)_minmax(0,1fr)] lg:gap-14">
          <DienstNavigatie />

          <div>
            {diensten.map((dienst, i) => (
              <DienstSectie
                key={dienst.slug}
                dienst={dienst}
                laatste={i === diensten.length - 1}
              />
            ))}
          </div>
        </div>
      </Sectie>

      <CTA />
    </>
  );
}
