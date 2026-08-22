import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import Logo from "../ui/Logo";
import { site } from "../../data/site";

export default function Header() {
  const [open, setOpen] = useState(false);
  const knopRef = useRef(null);
  const { pathname } = useLocation();

  // Menu sluit bij elke routewissel, anders blijft het openstaan na navigatie.
  useEffect(() => setOpen(false), [pathname]);

  // Escape sluit het menu en geeft de focus terug aan de knop.
  useEffect(() => {
    if (!open) return;
    const opEscape = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        knopRef.current?.focus();
      }
    };
    document.addEventListener("keydown", opEscape);
    return () => document.removeEventListener("keydown", opEscape);
  }, [open]);

  const navKlasse = ({ isActive }) =>
    `block border-b-2 py-2 text-sm font-medium no-underline transition-colors ${
      isActive
        ? "border-accent text-primair"
        : "border-transparent text-tekst hover:text-primair-licht"
    }`;

  return (
    <header className="sticky top-0 z-50 border-b border-rand bg-white">
      <p className="bg-primair-diep px-4 py-1 text-center text-xs text-[#DFEAF2]">
        {site.testBanner}
      </p>

      <div className="mx-auto flex w-full max-w-[1160px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link to="/" className="no-underline" aria-label={`${site.naam} — naar de startpagina`}>
          <Logo />
        </Link>

        <button
          ref={knopRef}
          type="button"
          className="rounded border border-rand-sterk p-2 text-primair lg:hidden"
          aria-expanded={open}
          aria-controls="hoofdmenu"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sr-only">{open ? "Menu sluiten" : "Menu openen"}</span>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <nav
          id="hoofdmenu"
          aria-label="Hoofdnavigatie"
          className={`${
            open ? "block" : "hidden"
          } absolute inset-x-0 top-full border-b border-rand bg-white shadow-lg lg:static lg:block lg:border-0 lg:shadow-none`}
        >
          <ul className="mx-auto flex w-full max-w-[1160px] flex-col gap-0 px-4 pb-5 pt-2 sm:px-6 lg:flex-row lg:items-center lg:gap-6 lg:p-0">
            {site.navigatie.map((item) => (
              <li key={item.to} className="border-b border-rand lg:border-0">
                <NavLink to={item.to} className={navKlasse}>
                  {item.label}
                </NavLink>
              </li>
            ))}
            <li className="pt-4 lg:pt-0">
              <Link
                to="/contact"
                className="flex items-center justify-center rounded border border-primair bg-primair px-5 py-2.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-primair-diep lg:inline-flex"
              >
                Gesprek aanvragen
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
