import { Link } from "react-router-dom";

/** Kop van een binnenpagina: kruimelpad, eyebrow, h1 en inleiding. */
export default function PaginaKop({ eyebrow, titel, lede, kruimels = [], huidig }) {
  return (
    <div className="border-b border-rand bg-zacht py-10 md:py-14 lg:py-16">
      <div className="mx-auto w-full max-w-[1160px] px-4 sm:px-6">
        {kruimels.length > 0 && (
          <nav aria-label="Kruimelpad" className="mb-4">
            <ol className="flex flex-wrap items-center gap-2 text-[0.85rem] text-gedempt">
              {kruimels.map((k) => (
                <li key={k.to} className="flex items-center gap-2">
                  <Link to={k.to} className="text-gedempt no-underline hover:text-primair hover:underline">
                    {k.label}
                  </Link>
                  <span className="text-rand-sterk" aria-hidden="true">
                    /
                  </span>
                </li>
              ))}
              {huidig && <li aria-current="page">{huidig}</li>}
            </ol>
          </nav>
        )}

        {eyebrow && (
          <span className="mb-3 block text-xs font-semibold uppercase tracking-[0.12em] text-accent">
            {eyebrow}
          </span>
        )}
        <h1 className="max-w-[20ch] text-3xl font-semibold leading-tight tracking-tight text-primair text-balance sm:text-4xl lg:text-5xl">
          {titel}
        </h1>
        {lede && <p className="mt-4 max-w-tekst text-lg text-gedempt">{lede}</p>}
      </div>
    </div>
  );
}
