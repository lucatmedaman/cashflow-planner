import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Bij een routewissel springt de browser niet vanzelf naar boven in een SPA.
 * Is er een anker (#psi-indicatoren), dan scrollen we juist naar dat element —
 * ook wanneer het vanaf een andere pagina wordt aangeklikt.
 */
export default function ScrollNaarBoven() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const doel = document.getElementById(hash.slice(1));
      if (doel) {
        doel.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [pathname, hash]);

  return null;
}
