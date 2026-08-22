import Sectie from "./ui/Sectie";
import Knop from "./ui/Knop";

/** Herbruikbaar donker CTA-blok onderaan de pagina's. */
export default function CTA({
  titel = "Een concrete vraag over uw cijfers?",
  tekst = "Een kennismakingsgesprek van een half uur volstaat meestal om te bepalen of uw data de vraag kan beantwoorden en wat een analyse zou inhouden.",
}) {
  return (
    <Sectie variant="donker">
      <div className="grid items-center gap-6 lg:grid-cols-[1.6fr_auto] lg:gap-12">
        <div className="max-w-tekst">
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {titel}
          </h2>
          <p className="mt-3 text-[#DFEAF2]">{tekst}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Knop to="/contact" variant="opDonker">
            Contact opnemen
          </Knop>
          <Knop to="/diensten" variant="lijnOpDonker">
            Diensten bekijken
          </Knop>
        </div>
      </div>
    </Sectie>
  );
}
