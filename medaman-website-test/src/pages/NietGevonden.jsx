import { Link } from "react-router-dom";
import Sectie from "../components/ui/Sectie";
import Knop from "../components/ui/Knop";
import useDocumentTitel from "../hooks/useDocumentTitel";
import { diensten } from "../data/diensten";

export default function NietGevonden() {
  useDocumentTitel("Pagina niet gevonden · Medaman", "Deze pagina bestaat niet of is verplaatst.");

  return (
    <Sectie>
      <div className="max-w-tekst">
        <span className="mb-3 block text-xs font-semibold uppercase tracking-[0.12em] text-accent">
          Foutcode 404
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-primair sm:text-4xl">
          Deze pagina bestaat niet
        </h1>
        <p className="mb-6 mt-4 text-lg text-gedempt">
          De link klopt niet meer, of de pagina is verplaatst. Hieronder staat waar u
          waarschijnlijk naartoe wilde.
        </p>

        <div className="flex flex-wrap gap-3">
          <Knop to="/">Naar de startpagina</Knop>
          <Knop to="/contact" variant="secundair">
            Contact opnemen
          </Knop>
        </div>

        <div className="mt-12 border-t border-rand pt-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-accent">
            Diensten
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {diensten.map((d) => (
              <li key={d.slug}>
                <Link
                  to={`/diensten#${d.slug}`}
                  className="font-medium no-underline hover:underline"
                >
                  {d.titel}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Sectie>
  );
}
