import { Check } from "lucide-react";

/**
 * Opsomming met twee markers: een streepje voor "wat we doen", een vinkje voor
 * "wat u krijgt". De marker is decoratief en blijft buiten de schermlezer.
 */
export default function Lijst({ items, marker = "streep", className = "" }) {
  return (
    <ul className={`grid gap-3 ${className}`}>
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-gedempt">
          {marker === "vink" ? (
            <Check
              className="mt-1 h-4 w-4 flex-none text-accent"
              strokeWidth={2.5}
              aria-hidden="true"
            />
          ) : (
            <span
              className="mt-[0.7em] h-0.5 w-2 flex-none bg-accent"
              aria-hidden="true"
            />
          )}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
