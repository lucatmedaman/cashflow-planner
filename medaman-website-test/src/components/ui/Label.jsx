/** Klein doelgroeplabel (Directie, Coderingsdienst, Kwaliteit …). */
export default function Label({ children }) {
  return (
    <li className="rounded-sm border border-rand bg-zacht px-2 py-0.5 text-[0.7rem] font-semibold uppercase tracking-wide text-primair">
      {children}
    </li>
  );
}

export function LabelRij({ labels, className = "" }) {
  return (
    <ul className={`flex flex-wrap gap-2 ${className}`}>
      {labels.map((label) => (
        <Label key={label}>{label}</Label>
      ))}
    </ul>
  );
}
