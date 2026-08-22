/** Tekstlogo met staafmotief. Tijdelijk, tot er een echt logobestand is. */
export default function Logo({ variant = "donker" }) {
  const licht = variant === "licht";

  return (
    <span className="inline-flex items-center gap-2.5 text-xl font-bold leading-none tracking-tight">
      <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" className="flex-none">
        <rect x="3" y="17" width="5" height="10" rx="1" fill={licht ? "rgba(255,255,255,0.5)" : "#7FB2CE"} />
        <rect x="11" y="11" width="5" height="16" rx="1" fill={licht ? "rgba(255,255,255,0.75)" : "#4E8CAE"} />
        <rect x="19" y="5" width="5" height="22" rx="1" fill="#0E8F7E" />
      </svg>
      <span className={licht ? "text-white" : "text-primair"}>Medaman</span>
    </span>
  );
}
