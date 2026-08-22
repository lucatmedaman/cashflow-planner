import { ArrowRight } from "lucide-react";
import Kaart from "./ui/Kaart";
import { LabelRij } from "./ui/Label";

/** Kaart voor een dienst; linkt naar de bijhorende sectie op /diensten. */
export default function DienstKaart({ dienst, niveau = 3 }) {
  const Kop = `h${niveau}`;

  return (
    <Kaart to={`/diensten#${dienst.slug}`} className="group">
      <Kop className="text-lg font-semibold text-primair">{dienst.titel}</Kop>
      <p className="text-[0.95rem] text-gedempt">{dienst.kort}</p>
      <LabelRij labels={dienst.doelgroepen} className="mt-auto pt-2" />
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primair-licht group-hover:underline">
        Meer over deze dienst
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </span>
    </Kaart>
  );
}
