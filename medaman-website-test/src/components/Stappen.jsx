import { aanpak } from "../data/site";

/** De drie stappen van de aanpak, als geordende lijst. */
export default function Stappen() {
  return (
    <ol className="grid gap-6 lg:grid-cols-3">
      {aanpak.map((stap) => (
        <li key={stap.nummer} className="rounded-md border border-rand bg-white p-6">
          <span className="mb-3 block font-mono text-sm font-semibold text-accent" aria-hidden="true">
            {stap.nummer}
          </span>
          <h3 className="mb-2 text-lg font-semibold text-primair">{stap.titel}</h3>
          <p className="text-[0.95rem] text-gedempt">{stap.tekst}</p>
        </li>
      ))}
    </ol>
  );
}
