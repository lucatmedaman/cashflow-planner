import { useEffect } from "react";

/**
 * Zet titel en meta-description per route. In een SPA gebeurt dat niet vanzelf:
 * zonder dit houdt elke pagina de titel uit index.html.
 */
export default function useDocumentTitel(titel, beschrijving) {
  useEffect(() => {
    document.title = titel;
    if (beschrijving) {
      const tag = document.querySelector('meta[name="description"]');
      if (tag) tag.setAttribute("content", beschrijving);
    }
  }, [titel, beschrijving]);
}
