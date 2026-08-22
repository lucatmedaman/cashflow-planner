import { useEffect, useState } from "react";
import { diensten } from "../data/diensten";

/**
 * Sticky ankernavigatie langs de zes diensten. Markeert de sectie die in beeld
 * is via een IntersectionObserver, zodat de lezer zijn positie behoudt.
 */
export default function DienstNavigatie() {
  const [actief, setActief] = useState(diensten[0].slug);

  useEffect(() => {
    const secties = diensten
      .map((d) => document.getElementById(d.slug))
      .filter(Boolean);

    if (secties.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const zichtbaar = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (zichtbaar) setActief(zichtbaar.target.id);
      },
      // Bovenste band van het scherm bepaalt welke sectie "actief" is.
      { rootMargin: "-120px 0px -60% 0px", threshold: 0 },
    );

    secties.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  return (
    // self-start is nodig: zonder dat rekt het grid-item uit over de volle
    // rijhoogte en heeft sticky geen effect.
    <nav
      aria-label="Diensten op deze pagina"
      className="lg:sticky lg:top-28 lg:self-start"
    >
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-accent">
        Op deze pagina
      </h2>
      <ul className="grid gap-1 border-l border-rand">
        {diensten.map((d) => (
          <li key={d.slug}>
            <a
              href={`#${d.slug}`}
              aria-current={actief === d.slug ? "true" : undefined}
              className={`-ml-px block border-l-2 py-1.5 pl-4 text-sm no-underline transition-colors ${
                actief === d.slug
                  ? "border-accent font-semibold text-primair"
                  : "border-transparent text-gedempt hover:border-rand-sterk hover:text-primair"
              }`}
            >
              {d.titel}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
