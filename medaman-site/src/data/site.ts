/**
 * Centrale bedrijfsgegevens.
 *
 * Alles tussen [[dubbele haken]] is een placeholder: gegevens die ik niet ken en
 * niet ga verzinnen. Vul ze hier in, dan zijn ze meteen overal op de site correct.
 * Placeholders worden op de site zichtbaar gemarkeerd (gestippelde onderlijn).
 */

export const isPlaceholder = (waarde: string): boolean =>
  waarde.trimStart().startsWith('[[');

export const site = {
  naam: 'Medaman',
  tagline: 'Healthcare data analytics voor Belgische ziekenhuizen',
  beschrijving:
    'Medaman analyseert ziekenhuisdata: benchmarking, ICD-10-CM coding audits, ' +
    'APR-DRG- en NRG-analyses, verblijfsduur, PSI-indicatoren en klinische rapportage.',

  contact: {
    email: '[[info@medaman.be]]',
    telefoon: '[[+32 (0)9 000 00 00]]',
    straat: '[[Straatnaam 1]]',
    postcode: '[[9160]]',
    gemeente: 'Lokeren',
    land: 'België',
    ondernemingsnummer: '[[BE 0000.000.000]]',
    bereikbaarheid: 'Ma–vr, 9–17 u',
  },

  /** Zichtbaar in de header/footer zolang dit een testomgeving is. */
  testBanner:
    'Testversie — dit is een preview en niet de officiële website van Medaman.',

  navigatie: [
    { href: '/diensten/', label: 'Diensten' },
    { href: '/over-ons/', label: 'Over ons' },
    { href: '/contact/', label: 'Contact' },
  ],
} as const;

/** Korte vertrouwenspunten onder de hero. Feitelijk, controleerbaar, geen claims. */
export const vertrouwenspunten = [
  {
    titel: 'Belgische ziekenhuiscontext',
    tekst: 'Vertrouwd met MZG-registratie, APR-DRG-casemix en de eigen spelregels van de Belgische ziekenhuisfinanciering.',
  },
  {
    titel: 'Methodologisch transparant',
    tekst: 'Elke analyse is reproduceerbaar en navolgbaar. U weet altijd welke data, welke definities en welke afbakening zijn gebruikt.',
  },
  {
    titel: 'GDPR-conform verwerkt',
    tekst: 'Verwerkersovereenkomst, dataminimalisatie en pseudonimisering waar het kan. Afspraken over bewaring op voorhand vastgelegd.',
  },
  {
    titel: 'Bruikbaar voor beide kanten',
    tekst: 'Rapporten die zowel de directietafel als de coderingsdienst iets opleveren — cijfers én de handeling die eruit volgt.',
  },
] as const;

/** De drie stappen in onze aanpak (home). */
export const aanpak = [
  {
    nummer: '01',
    titel: 'Data-intake en validatie',
    tekst:
      'We bekijken samen welke registratie- en facturatiegegevens beschikbaar zijn, controleren volledigheid en consistentie, en leggen de afbakening van de analyse vast. Wat niet klopt in de bron, lossen we niet op in de grafiek.',
  },
  {
    nummer: '02',
    titel: 'Analyse en vergelijking',
    tekst:
      'Casemix-gecorrigeerde berekeningen, vergelijking met een relevante peergroep of met de eigen historiek, en een systematische zoektocht naar de afwijkingen die er werkelijk toe doen.',
  },
  {
    nummer: '03',
    titel: 'Rapportage en opvolging',
    tekst:
      'Een rapport dat leesbaar is voor wie geen analist is, met bevindingen die stand houden in een gesprek met artsen. Waar gewenst begeleiden we de interne bespreking en de opvolging.',
  },
] as const;

/** Waarom Medaman (home). */
export const waarom = [
  {
    titel: 'Domeinkennis, geen algemene datadienst',
    tekst:
      'Ziekenhuisdata lezen vraagt kennis van codeerregels, groupers en financieringslogica. Wij werken uitsluitend in dit domein, waardoor een afwijking meteen in de juiste context staat.',
  },
  {
    titel: 'Cijfers die een tegensprekelijk gesprek overleven',
    tekst:
      'Een bevinding is pas bruikbaar als een arts of coderingsverantwoordelijke ze kan natrekken. We documenteren definities, in- en exclusies en databronnen bij elk resultaat.',
  },
  {
    titel: 'Van vaststelling naar handeling',
    tekst:
      'Een analyse eindigt niet bij een percentage. We benoemen wat registratie-effect is, wat organisatie is en wat klinisch signaal — en wat u daar concreet mee kunt doen.',
  },
] as const;

/**
 * Koppeling van het contactformulier.
 *
 * Zolang `endpoint` op null staat, verstuurt het formulier niets: het valideert
 * wel volledig en toont daarna een melding met het e-mailadres als alternatief.
 *
 * Aanzetten doe je hier, op één plek:
 *   Netlify Forms → zet `netlify: true` (endpoint mag null blijven)
 *   Formspree     → endpoint: 'https://formspree.io/f/xxxxxxx'
 *   Eigen backend → endpoint: 'https://api.example.be/contact'
 */
export const formulier = {
  endpoint: null as string | null,
  netlify: false,
  /** Onderwerpen in de keuzelijst; sluit aan op de diensten. */
  onderwerpen: [
    'Hospital benchmarking',
    'ICD-10-CM coding audits',
    'APR-DRG- en NRG-analyses',
    'Verblijfsduuranalyse',
    'PSI-indicatoren',
    'Klinische rapportage',
    'Algemene vraag',
  ],
};
