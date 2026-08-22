/**
 * Centrale bedrijfsgegevens.
 *
 * Alles tussen [[dubbele haken]] is een placeholder: gegevens die niet verzonnen
 * mogen worden. Vul ze hier in, dan kloppen ze meteen overal op de site.
 * Placeholders worden zichtbaar gemarkeerd (gestippelde onderlijn).
 */

export const isPlaceholder = (waarde) =>
  typeof waarde === "string" && waarde.trimStart().startsWith("[[");

export const site = {
  naam: "Medaman",
  tagline: "Healthcare data analytics voor Belgische ziekenhuizen",

  contact: {
    email: "[[info@medaman.be]]",
    telefoon: "[[+32 (0)9 000 00 00]]",
    straat: "[[Straatnaam 1]]",
    postcode: "[[9160]]",
    gemeente: "Lokeren",
    land: "België",
    ondernemingsnummer: "[[BE 0000.000.000]]",
    bereikbaarheid: "Ma–vr, 9–17 u",
  },

  /** Zichtbaar bovenaan elke pagina zolang dit een testomgeving is. */
  testBanner:
    "Testversie — dit is een preview en niet de officiële website van Medaman.",

  navigatie: [
    { to: "/diensten", label: "Diensten" },
    { to: "/over-ons", label: "Over ons" },
    { to: "/contact", label: "Contact" },
  ],
};

/**
 * Koppeling van het contactformulier.
 *
 * Zolang `endpoint` null is, verstuurt het formulier niets: het valideert wel
 * volledig en toont daarna een melding. Aanzetten gebeurt hier, op één plek:
 *   Formspree            → endpoint: 'https://formspree.io/f/xxxxxxx'
 *   Vercel function      → endpoint: '/api/contact'
 */
export const formulier = {
  endpoint: null,
  onderwerpen: [
    "Hospital benchmarking",
    "ICD-10-CM coding audits",
    "APR-DRG/NRG-analyses",
    "Length-of-stay analyse",
    "PSI-indicatoren",
    "Klinische rapportage",
    "Algemene vraag",
  ],
};

/** Vier kernpunten onder de hero. Feitelijk, geen onbewijsbare claims. */
export const vertrouwenspunten = [
  {
    titel: "Belgische ziekenhuiscontext",
    tekst:
      "Vertrouwd met MZG-registratie, APR-DRG-casemix en de eigen spelregels van de Belgische ziekenhuisfinanciering.",
  },
  {
    titel: "Methodologisch transparant",
    tekst:
      "Elke analyse is reproduceerbaar. U weet altijd welke data, welke definities en welke afbakening zijn gebruikt.",
  },
  {
    titel: "GDPR-conform verwerkt",
    tekst:
      "Verwerkersovereenkomst, dataminimalisatie en pseudonimisering waar het kan. Bewaartermijnen vooraf vastgelegd.",
  },
  {
    titel: "Bruikbaar voor beide kanten",
    tekst:
      "Rapporten die zowel de directietafel als de coderingsdienst iets opleveren — cijfers én de handeling die eruit volgt.",
  },
];

/** De drie stappen in de aanpak (home). */
export const aanpak = [
  {
    nummer: "01",
    titel: "Data-intake en validatie",
    tekst:
      "We bekijken samen welke registratie- en facturatiegegevens beschikbaar zijn, controleren volledigheid en consistentie, en leggen de afbakening vast. Wat niet klopt in de bron, lossen we niet op in de grafiek.",
  },
  {
    nummer: "02",
    titel: "Analyse en vergelijking",
    tekst:
      "Casemix-gecorrigeerde berekeningen, vergelijking met een relevante peergroep of met de eigen historiek, en een systematische zoektocht naar de afwijkingen die er werkelijk toe doen.",
  },
  {
    nummer: "03",
    titel: "Rapportage en opvolging",
    tekst:
      "Een rapport dat leesbaar is voor wie geen analist is, met bevindingen die stand houden in een gesprek met artsen. Waar gewenst begeleiden we de interne bespreking.",
  },
];

/** Waarom Medaman (home). */
export const waarom = [
  {
    titel: "Domeinkennis, geen algemene datadienst",
    tekst:
      "Ziekenhuisdata lezen vraagt kennis van codeerregels, groupers en financieringslogica. Wij werken uitsluitend in dit domein, waardoor een afwijking meteen in de juiste context staat.",
  },
  {
    titel: "Cijfers die een tegensprekelijk gesprek overleven",
    tekst:
      "Een bevinding is pas bruikbaar als een arts of coderingsverantwoordelijke ze kan natrekken. We documenteren definities, in- en exclusies en databronnen bij elk resultaat.",
  },
  {
    titel: "Van vaststelling naar handeling",
    tekst:
      "Een analyse eindigt niet bij een percentage. We benoemen wat registratie-effect is, wat organisatie is en wat klinisch signaal — en wat u daar concreet mee kunt doen.",
  },
];

/** Werkwijze-principes (over ons). */
export const principes = [
  {
    titel: "Onafhankelijk",
    tekst:
      "We hebben geen belang bij een bepaalde uitkomst. Als de data een vermoeden niet bevestigt, staat dat zo in het rapport.",
  },
  {
    titel: "Navolgbaar",
    tekst:
      "Elke bevinding is terug te volgen tot de dossiers waarop ze steunt. Definities, in- en exclusies en periodes staan expliciet vermeld.",
  },
  {
    titel: "Terughoudend bij kleine aantallen",
    tekst:
      "Bij lage aantallen tonen we spreiding en onzekerheid, en trekken we geen conclusies die het cijfermateriaal niet draagt.",
  },
  {
    titel: "Overdraagbaar",
    tekst:
      "We bouwen zo dat uw eigen diensten het kunnen overnemen. Afhankelijkheid van een externe partij is geen doel op zich.",
  },
];

/** Afspraken rond gegevensbescherming (over ons). */
export const gegevensafspraken = [
  {
    label: "Verwerkersovereenkomst",
    tekst:
      "Voor elke opdracht waarbij persoonsgegevens verwerkt worden, sluiten we vooraf een verwerkersovereenkomst met het ziekenhuis als verwerkingsverantwoordelijke.",
  },
  {
    label: "Dataminimalisatie",
    tekst:
      "We vragen enkel de velden op die de analyse werkelijk nodig heeft. Wat de vraag niet beantwoordt, hoeft ook niet doorgestuurd te worden.",
  },
  {
    label: "Pseudonimisering",
    tekst:
      "Waar de analyse het toelaat, werken we met gepseudonimiseerde gegevens. De sleutel blijft bij het ziekenhuis.",
  },
  {
    label: "Bewaartermijn",
    tekst:
      "Bewaartermijn en verwijdering na afloop van de opdracht worden op voorhand vastgelegd, niet achteraf besproken.",
  },
  {
    label: "Toegang",
    tekst:
      "Toegang tot de gegevens blijft beperkt tot de medewerkers die aan de opdracht werken, en wordt gelogd.",
  },
];
