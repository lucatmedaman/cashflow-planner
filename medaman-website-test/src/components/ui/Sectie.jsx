const achtergronden = {
  wit: "bg-white",
  zacht: "bg-zacht border-y border-rand",
  donker: "bg-primair text-[#DFEAF2]",
};

/** Sectiewrapper met vaste verticale ritmiek en een container eromheen. */
export default function Sectie({
  variant = "wit",
  id,
  className = "",
  containerClassName = "",
  children,
  ...rest
}) {
  return (
    <section
      id={id}
      className={`py-14 md:py-20 lg:py-24 ${achtergronden[variant]} ${className}`}
      {...rest}
    >
      <div className={`mx-auto w-full max-w-[1160px] px-4 sm:px-6 ${containerClassName}`}>
        {children}
      </div>
    </section>
  );
}
