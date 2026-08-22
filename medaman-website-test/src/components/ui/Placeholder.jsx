import { isPlaceholder } from "../../data/site";

/**
 * Toont een gegeven, of markeert het zichtbaar wanneer het nog een placeholder
 * is. Een placeholder wordt nooit een klikbare link.
 */
export default function Placeholder({ waarde, href }) {
  if (isPlaceholder(waarde)) {
    const tekst = waarde.replace(/^\s*\[\[|\]\]\s*$/g, "");
    return (
      <span className="placeholder" title="Nog in te vullen gegeven">
        {tekst}
      </span>
    );
  }

  if (href) {
    return (
      <a href={href} className="text-primair-licht hover:text-primair">
        {waarde}
      </a>
    );
  }

  return <span>{waarde}</span>;
}
