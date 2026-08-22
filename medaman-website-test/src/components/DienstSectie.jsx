import Lijst from "./ui/Lijst";
import { LabelRij } from "./ui/Label";
import Knop from "./ui/Knop";

/** Eén volledige dienst op /diensten, volgens het vaste stramien. */
export default function DienstSectie({ dienst, laatste = false }) {
  return (
    <article
      id={dienst.slug}
      aria-labelledby={`${dienst.slug}-kop`}
      className={laatste ? "" : "mb-14 border-b border-rand pb-14 lg:mb-20 lg:pb-20"}
    >
      <h2
        id={`${dienst.slug}-kop`}
        className="text-2xl font-semibold tracking-tight text-primair sm:text-3xl"
      >
        {dienst.titel}
      </h2>
      <p className="mt-3 max-w-tekst text-lg text-gedempt">{dienst.kort}</p>
      <LabelRij labels={dienst.doelgroepen} className="mt-4" />

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(260px,0.85fr)]">
        <div>
          <div className="max-w-tekst space-y-4">
            {dienst.intro.map((alinea) => (
              <p key={alinea.slice(0, 40)} className="text-gedempt">
                {alinea}
              </p>
            ))}
          </div>

          <h3 className="mb-4 mt-8 border-b border-rand pb-3 text-lg font-semibold text-primair">
            Wat we doen
          </h3>
          <Lijst items={dienst.watWeDoen} />

          <h3 className="mb-4 mt-8 border-b border-rand pb-3 text-lg font-semibold text-primair">
            Wat u krijgt
          </h3>
          <Lijst items={dienst.watUKrijgt} marker="vink" />
        </div>

        <div className="grid content-start gap-4">
          <div className="rounded-md border border-rand p-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-accent">
              Voor wie
            </h3>
            <p className="text-[0.94rem] text-gedempt">{dienst.voorWie}</p>
          </div>

          <div className="rounded-md border border-rand p-5">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-accent">
              Methodologie en aandachtspunten
            </h3>
            <dl className="grid gap-4">
              {dienst.methodologie.map((m) => (
                <div key={m.label} className="border-l-2 border-rand pl-4">
                  <dt className="text-[0.94rem] font-semibold text-primair">{m.label}</dt>
                  <dd className="mt-1 text-[0.94rem] text-gedempt">{m.tekst}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-md border border-rand bg-zacht p-5">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-accent">
              Vraag over deze dienst?
            </h3>
            <p className="mb-4 text-[0.94rem] text-gedempt">
              Vertel kort welke gegevens u beschikbaar heeft, dan laten we weten wat een
              analyse concreet zou opleveren.
            </p>
            <Knop to="/contact" className="w-full">
              Contact opnemen
            </Knop>
          </div>
        </div>
      </div>
    </article>
  );
}
