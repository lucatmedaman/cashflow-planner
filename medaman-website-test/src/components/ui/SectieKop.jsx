/** Eyebrow + kop + inleiding, met instelbaar kopniveau voor een correcte structuur. */
export default function SectieKop({
  eyebrow,
  titel,
  lede,
  niveau = 2,
  donker = false,
  className = "",
}) {
  const Kop = `h${niveau}`;
  const kopGrootte =
    niveau === 1
      ? "text-3xl sm:text-4xl lg:text-5xl"
      : "text-2xl sm:text-3xl";

  return (
    <div className={`max-w-tekst ${className}`}>
      {eyebrow && (
        <span
          className={`mb-3 block text-xs font-semibold uppercase tracking-[0.12em] ${
            donker ? "text-accent-licht" : "text-accent"
          }`}
        >
          {eyebrow}
        </span>
      )}
      <Kop
        className={`${kopGrootte} font-semibold leading-tight tracking-tight text-balance ${
          donker ? "text-white" : "text-primair"
        }`}
      >
        {titel}
      </Kop>
      {lede && (
        <p
          className={`mt-4 text-base sm:text-lg ${
            donker ? "text-[#DFEAF2]" : "text-gedempt"
          }`}
        >
          {lede}
        </p>
      )}
    </div>
  );
}
