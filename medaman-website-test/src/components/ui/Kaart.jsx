import { Link } from "react-router-dom";

const basis = "flex flex-col gap-3 rounded-md border border-rand bg-white p-6";

/** Basiskaart; wordt een link zodra `to` meegegeven is. */
export default function Kaart({ to, className = "", children, ...rest }) {
  if (to) {
    return (
      <Link
        to={to}
        className={`${basis} no-underline transition-colors hover:border-primair-licht ${className}`}
        {...rest}
      >
        {children}
      </Link>
    );
  }

  return (
    <div className={`${basis} ${className}`} {...rest}>
      {children}
    </div>
  );
}
