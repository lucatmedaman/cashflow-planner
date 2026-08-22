import { Link } from "react-router-dom";

const varianten = {
  primair: "bg-primair text-white border-primair hover:bg-primair-diep hover:border-primair-diep",
  secundair:
    "bg-transparent text-primair border-rand-sterk hover:border-primair hover:bg-zacht",
  opDonker: "bg-white text-primair border-white hover:bg-[#DFEAF2]",
  lijnOpDonker:
    "bg-transparent text-white border-white/45 hover:border-white hover:bg-white/10",
};

const basis =
  "inline-flex items-center justify-center gap-2 rounded border px-5 py-2.5 " +
  "text-sm font-semibold no-underline transition-colors";

/**
 * Eén knop voor de hele site. Wordt een <Link> bij `to`, een <a> bij `href`
 * en anders een echte <button> — zodat semantiek en toetsenbordgedrag kloppen.
 */
export default function Knop({
  to,
  href,
  variant = "primair",
  className = "",
  children,
  ...rest
}) {
  const klassen = `${basis} ${varianten[variant]} ${className}`;

  if (to) {
    return (
      <Link to={to} className={klassen} {...rest}>
        {children}
      </Link>
    );
  }

  if (href) {
    return (
      <a href={href} className={klassen} {...rest}>
        {children}
      </a>
    );
  }

  return (
    <button type="button" className={klassen} {...rest}>
      {children}
    </button>
  );
}
