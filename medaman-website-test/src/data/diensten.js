/**
 * De zes diensten als data. Eén object per dienst, met het vaste stramien dat
 * DienstSectie rendert. De ankernavigatie, de kaarten op de home en de
 * footerlinks worden alle drie uit deze array afgeleid — een dienst toevoegen
 * of wijzigen is dus een data-wijziging, geen JSX-wijziging.
 */
export const diensten = [
  {
    slug: "hospital-benchmarking",
    titel: "Hospital benchmarking",
    kort: "Weet waar uw ziekenhuis staat tegenover een vergelijkbare peergroep — casemix-gecorrigeerd, niet appelen met peren.",
    doelgroepen: ["Directie", "Financiële dienst", "Zorgmanagement"],
    intro: [
      "Benchmarking gaat de mist in op twee manieren: door te vergelijken met ziekenhuizen die niets met het uwe te maken hebben, en door een zwaarder patiëntenprofiel te lezen als een zwakkere prestatie. Beide leveren cijfers op die intern meteen — en terecht — worden weggewuifd.",
      "Wij stellen daarom eerst de peergroep samen en corrigeren voor casemix, vóór er ook maar één vergelijking op tafel komt. Wat overblijft is een beperkt aantal afwijkingen die werkelijk vragen oproepen, met per afwijking een aanwijzing of ze in de registratie, in de organisatie of in de zorg zelf zit.",
    ],
    voorWie:
      "Directie, financieel management en zorgmanagement die willen weten of een afwijking in de eigen cijfers uitzonderlijk is of gewoon hoort bij het profiel van het ziekenhuis.",
    watWeDoen: [
      "Een relevante peergroep samenstellen op basis van omvang, ligging, zorgaanbod en patiëntenprofiel — niet zomaar “alle Belgische ziekenhuizen”.",
      "Indicatoren casemix-corrigeren, zodat een zwaarder patiëntenprofiel niet als slechte prestatie wordt gelezen.",
      "De positie van uw ziekenhuis per dienst en per indicator bepalen, met spreiding en niet enkel een gemiddelde.",
      "Afwijkingen scheiden in registratie-effecten, organisatorische effecten en werkelijke klinische verschillen.",
      "Evolutie in de tijd meenemen, zodat een eenmalige uitschieter zich onderscheidt van een trend.",
      "De bevindingen prioriteren naar impact, zodat duidelijk is welke drie dossiers de moeite lonen.",
    ],
    watUKrijgt: [
      "Een benchmarkrapport per dienst en per indicator, met uw positie binnen de peergroep.",
      "Een prioriteitenlijst van afwijkingen, gerangschikt naar potentiële impact.",
      "De onderliggende cijfers en definities, zodat uw eigen diensten alles kunnen natrekken.",
      "Een toelichtingssessie voor directie of medische raad.",
    ],
    methodologie: [
      {
        label: "Databronnen",
        tekst:
          "Eigen MZG-registratie en facturatiegegevens, aangevuld met publiek beschikbare referentiecijfers waar die bestaan.",
      },
      {
        label: "Correctie",
        tekst:
          "Vergelijkingen gebeuren casemix-gecorrigeerd op basis van APR-DRG met severity of illness, zodat het patiëntenprofiel meetelt.",
      },
      {
        label: "Peergroep",
        tekst:
          "De samenstelling van de vergelijkingsgroep wordt vooraf met u afgesproken en expliciet gedocumenteerd in het rapport.",
      },
      {
        label: "Grenzen",
        tekst:
          "We benoemen waar de data een vergelijking niet toelaat. Een indicator die niet betrouwbaar te vergelijken is, rapporteren we niet als vergelijking.",
      },
    ],
  },

  {
    slug: "icd-10-cm-coding-audits",
    titel: "ICD-10-CM coding audits",
    kort: "Systematische controle van diagnose- en procedurecodering, met feedback waar codeerders werkelijk iets aan hebben.",
    doelgroepen: ["Medische coderingsdienst", "MZG-verantwoordelijke", "Directie"],
    intro: [
      "Coderingskwaliteit is zelden een kwestie van slordigheid. Meestal gaat het om documentatie die te weinig houvast biedt, om richtlijnen die op een randgeval geen sluitend antwoord geven, of om afspraken die ooit gemaakt zijn en nooit meer herzien.",
      "Een audit die enkel fouten telt, verandert daar niets aan. Wij zoeken daarom naar het patroon achter de afwijkingen: welk soort dossier loopt telkens mis, welke informatie ontbrak op het moment van coderen, en welke afspraak zou dat verhelpen. Dat maakt het verschil tussen een rapport dat in een la verdwijnt en een audit die de volgende registratieperiode zichtbaar beter maakt.",
    ],
    voorWie:
      "Coderingsdiensten en MZG-verantwoordelijken die willen weten hoe hun codering ervoor staat, en directies die de financiële en kwalitatieve gevolgen van coderingskwaliteit in beeld willen brengen.",
    watWeDoen: [
      "Dossiers selecteren via een combinatie van aselecte steekproef en gerichte, risicogestuurde selectie.",
      "De toegekende ICD-10-CM- en ICD-10-PCS-codes toetsen aan het medisch dossier en aan de geldende codeerrichtlijnen.",
      "Onderregistratie opsporen: ontbrekende nevendiagnoses, niet-gecodeerde complicaties, onvolledig gedocumenteerde comorbiditeit.",
      "Overregistratie en niet-onderbouwde codes signaleren — een audit die maar één kant op kijkt, is geen audit.",
      "Sequencing nakijken: is de hoofddiagnose correct gekozen, en welk effect heeft dat op de groepering?",
      "Terugkerende patronen benoemen en vertalen naar concrete feedback en opleiding voor het codeerteam.",
    ],
    watUKrijgt: [
      "Een auditrapport met bevindingen per dossier en per type afwijking, inclusief onderbouwing.",
      "Een overzicht van terugkerende patronen, met de impact op groepering en casemix.",
      "Aanbevelingen voor documentatie door artsen — vaak ligt daar de oorzaak, niet bij de codeur.",
      "Een feedbacksessie of opleidingsmoment voor de coderingsdienst.",
    ],
    methodologie: [
      {
        label: "Referentiekader",
        tekst:
          "Toetsing aan de officiële ICD-10-CM/PCS-richtlijnen en aan de Belgische registratieafspraken voor MZG.",
      },
      {
        label: "Steekproef",
        tekst:
          "Omvang en selectiewijze worden vooraf vastgelegd, zodat de bevindingen statistisch te duiden zijn.",
      },
      {
        label: "Tweede lezing",
        tekst:
          "Betwistbare dossiers krijgen een tweede beoordeling voordat ze als afwijking in het rapport komen.",
      },
      {
        label: "Toon",
        tekst:
          "Een audit is een verbeterinstrument, geen beoordeling van personen. Bevindingen worden geanonimiseerd besproken.",
      },
    ],
  },

  {
    slug: "apr-drg-nrg-analyses",
    titel: "APR-DRG/NRG-analyses",
    kort: "Casemix, severity of illness en zorgzwaarte doorgelicht — en wat verschuivingen daarin betekenen voor uw ziekenhuis.",
    doelgroepen: ["Directie", "Financiële dienst", "Medische coderingsdienst"],
    intro: [
      "De casemix van een ziekenhuis verandert voortdurend, maar zelden om één reden. Een stijgende gemiddelde severity kan betekenen dat het patiëntenprofiel zwaarder wordt, dat de zorg zich anders organiseert, of eenvoudigweg dat er beter gecodeerd wordt dan vorig jaar. Alle drie hebben ze een heel andere consequentie.",
      "Wij splitsen die effecten uit elkaar. Dat levert een beeld op waarin volume, casemix en registratie elk hun eigen aandeel krijgen — en waarin een bestuursbeslissing niet stoelt op een verschuiving die eigenlijk in de codeerhandleiding zat.",
    ],
    voorWie:
      "Directies en financiële diensten die de casemix van hun ziekenhuis willen begrijpen, en coderingsdiensten die willen zien hoe hun registratie doorwerkt in de groepering.",
    watWeDoen: [
      "De APR-DRG-mix van uw ziekenhuis in kaart brengen, per dienst en over de tijd.",
      "De verdeling van severity of illness en risk of mortality analyseren en vergelijken met de peergroep.",
      "Verschuivingen in de casemix opsporen en uitsplitsen naar oorzaak: veranderd patiëntenaanbod, veranderde zorg of veranderde registratie.",
      "De doorwerking van coderingskwaliteit op de groepering doorrekenen, zodat de impact van registratie zichtbaar wordt.",
      "Zorgzwaarte via de verpleegkundige registratie (NRG-logica) naast de medische casemix leggen, waar die gegevens beschikbaar zijn.",
      "Uitschieters per DRG identificeren en terugkoppelen naar de onderliggende dossiers.",
    ],
    watUKrijgt: [
      "Een casemixrapport met de DRG-mix, SOI/ROM-verdeling en evolutie per dienst.",
      "Een analyse van de verschuivingen, met per verschuiving een geduide oorzaak.",
      "Een doorrekening van het effect van registratiekwaliteit op de groepering.",
      "Werktabellen waarmee uw eigen diensten verder kunnen.",
    ],
    methodologie: [
      {
        label: "Grouper",
        tekst:
          "Analyses vertrekken van de APR-DRG-groepering met bijhorende severity of illness en risk of mortality.",
      },
      {
        label: "Uitsplitsing",
        tekst:
          "Verschuivingen worden opgesplitst in volume-effect, casemix-effect en registratie-effect, zodat conclusies niet door elkaar lopen.",
      },
      {
        label: "Zorgzwaarte",
        tekst:
          "Verpleegkundige zorgzwaarte wordt enkel meegenomen als de onderliggende registratie voldoende volledig is voor de betreffende periode.",
      },
      {
        label: "Voorzichtigheid",
        tekst:
          "Bij kleine aantallen per DRG rapporteren we spreiding en aantallen mee, en trekken we geen conclusies uit toevalsvariatie.",
      },
    ],
  },

  {
    slug: "length-of-stay-analyse",
    titel: "Length-of-stay analyse",
    kort: "Gerealiseerde ligduur tegenover verwachte ligduur per DRG en severity — inclusief de organisatie erachter.",
    doelgroepen: ["Directie", "Hoofdartsen", "Zorgmanagement"],
    intro: [
      "Ligduur is de indicator waar het snelst verkeerde conclusies uit worden getrokken. Een dienst met langere verblijven kan minder efficiënt werken, maar kan evengoed de zwaarste patiënten van het huis opnemen of vastlopen op vervolgzorg die niet beschikbaar is.",
      "Daarom vertrekken wij van de verwachte ligduur per DRG en severityniveau, en kijken we vervolgens naar het traject zelf. De vraag is niet alleen hoeveel dagen er te veel zijn, maar op welk moment in de opname ze ontstaan — want dat bepaalt of er iets aan te doen is.",
    ],
    voorWie:
      "Directies, hoofdartsen en zorgmanagers die willen begrijpen waar ligduur afwijkt van wat het patiëntenprofiel doet verwachten, en wat daar organisatorisch achter zit.",
    watWeDoen: [
      "De gerealiseerde verblijfsduur afzetten tegen de verwachte verblijfsduur per APR-DRG en severityniveau.",
      "Uitschieters apart behandelen, zodat enkele lange verblijven het beeld van een hele dienst niet vertekenen.",
      "Analyseren waar in het traject de tijd verloren gaat: opnamedag, onderzoeken, wachten op beslissing, ontslagvoorbereiding.",
      "Ontslagbestemming en heropnames meenemen — een kortere ligduur die tot heropname leidt, is geen winst.",
      "Verschillen tussen diensten, artsen en dagen van de week in kaart brengen, met de nodige voorzichtigheid bij kleine aantallen.",
      "Concrete verbeterpistes benoemen, van ontslagplanning tot doorstroming naar vervolgzorg.",
    ],
    watUKrijgt: [
      "Een ligduurrapport per dienst en per DRG, met verwachte versus gerealiseerde duur.",
      "Een outlier-analyse met de dossierkenmerken die de uitschieters gemeen hebben.",
      "Een overzicht van organisatorische knelpunten in het zorgtraject.",
      "Verbeterpistes, gerangschikt naar haalbaarheid en verwachte impact.",
    ],
    methodologie: [
      {
        label: "Verwachte duur",
        tekst:
          "De referentie wordt bepaald per APR-DRG en severityniveau, zodat zwaardere patiënten geen artificiële overschrijding vertonen.",
      },
      {
        label: "Outliers",
        tekst:
          "Uitschieters worden volgens een vooraf vastgelegde regel afgebakend en steeds apart gerapporteerd, nooit stilzwijgend weggelaten.",
      },
      {
        label: "Heropnames",
        tekst:
          "Waar de data het toelaat wordt heropname binnen een afgesproken termijn mee opgevolgd als tegenindicator.",
      },
      {
        label: "Interpretatie",
        tekst:
          "Verschillen tussen artsen worden enkel gerapporteerd wanneer de aantallen dat toelaten, en altijd met spreiding erbij.",
      },
    ],
  },

  {
    slug: "psi-indicatoren",
    titel: "PSI-indicatoren (AHRQ)",
    kort: "Patient Safety Indicators op uw eigen data, met een eerlijk onderscheid tussen registratie-artefact en klinisch signaal.",
    doelgroepen: ["Kwaliteitsafdeling", "Medische directie"],
    intro: [
      "De Patient Safety Indicators van AHRQ zijn afgeleid uit administratieve data, en dat maakt ze tegelijk waardevol en kwetsbaar. Ze bestrijken alle opnames zonder extra registratielast, maar ze zijn ook gevoelig voor hoe er gecodeerd wordt. Een ziekenhuis dat zijn complicatieregistratie verbetert, ziet zijn PSI-cijfers stijgen zonder dat de zorg verslechterde.",
      "Wij rapporteren die gevoeligheid mee in plaats van ze te verzwijgen. Per indicator maken we duidelijk welk deel van het signaal aan registratie toe te schrijven valt en welk deel klinische opvolging verdient — dat laatste is waar een kwaliteitscomité zijn tijd aan hoort te besteden.",
    ],
    voorWie:
      "Kwaliteitsafdelingen en medische directies die patiëntveiligheidsindicatoren willen opvolgen zonder vals alarm en zonder blinde vlekken.",
    watWeDoen: [
      "PSI-indicatoren berekenen op uw eigen registratie, volgens een expliciet gedocumenteerde definitie.",
      "Per gesignaleerd geval nagaan of het om een werkelijk veiligheidsvoorval gaat dan wel om een registratie-effect.",
      "De rol van present-on-admission-informatie beoordelen: was de aandoening er al bij opname, of is ze tijdens het verblijf ontstaan?",
      "Evolutie over de tijd volgen en de invloed van gewijzigde codeerpraktijk daarop zichtbaar maken.",
      "Bevindingen aanleveren in een vorm die bruikbaar is voor bespreking in een kwaliteitscomité.",
      "De indicatoren met de meeste verbeterruimte aanduiden, in plaats van de volledige lijst gelijk te behandelen.",
    ],
    watUKrijgt: [
      "Een PSI-rapport met de berekende indicatoren, teller, noemer en gehanteerde definitie.",
      "Een case-lijst van gesignaleerde gevallen voor interne validatie.",
      "Een duiding per indicator: welk deel is registratie, welk deel vraagt klinische opvolging.",
      "Een tijdreeks waarin veranderingen in codeerpraktijk apart zichtbaar zijn.",
    ],
    methodologie: [
      {
        label: "Definities",
        tekst:
          "Elke indicator wordt met teller, noemer, in- en exclusies volledig gedocumenteerd, vertrekkend van de AHRQ-specificaties.",
      },
      {
        label: "Registratie-afhankelijkheid",
        tekst:
          "PSI's zijn gevoelig voor codeerpraktijk. We rapporteren die gevoeligheid expliciet in plaats van ze weg te laten.",
      },
      {
        label: "Validatie",
        tekst:
          "Gesignaleerde gevallen zijn een startpunt voor dossieronderzoek, geen eindoordeel over de zorg.",
      },
      {
        label: "Kleine aantallen",
        tekst:
          "Bij lage teller-aantallen tonen we betrouwbaarheidsmarges en waarschuwen we uitdrukkelijk voor overinterpretatie.",
      },
    ],
  },

  {
    slug: "klinische-rapportage",
    titel: "Klinische rapportage",
    kort: "Periodieke rapporten en dashboards op maat — van directiecockpit tot cijfers per dienst.",
    doelgroepen: [
      "Directie",
      "Kwaliteitsafdeling",
      "Zorgmanagement",
      "Medische coderingsdienst",
    ],
    intro: [
      "Ziekenhuizen hebben zelden een tekort aan cijfers. Wat ontbreekt is meestal een rapport dat op zichzelf leesbaar is, dat elke maand op hetzelfde moment klaarstaat en waarvan iedereen dezelfde definitie hanteert.",
      "Wij bouwen die rapportage rond één vraag: wie leest dit, en welke beslissing moet erop volgen? Dat bepaalt welke indicatoren erin staan, hoe fijn de opsplitsing gaat en welke vorm de cijfers krijgen. De rest laten we weg — ook als het technisch mooi zou staan.",
    ],
    voorWie:
      "Iedereen die in het ziekenhuis met deze cijfers werkt: directie die een overzicht nodig heeft, diensthoofden die hun eigen cijfers willen volgen, en stafmedewerkers die niet elke maand handmatig willen samenstellen.",
    watWeDoen: [
      "Bepalen welke indicatoren er werkelijk toe doen per doelgroep — een directie heeft een ander rapport nodig dan een diensthoofd.",
      "Rapporten opbouwen die op zichzelf leesbaar zijn, zonder mondelinge toelichting.",
      "Terugkerende rapportage automatiseren, zodat een maandelijkse cyclus geen handwerk meer is.",
      "Visualisaties kiezen op leesbaarheid, niet op effect: geen ruis, geen misleidende assen, geen grafiek zonder boodschap.",
      "Definities vastleggen in een meegeleverde documentatie, zodat cijfers niet per afdeling anders geïnterpreteerd worden.",
      "Ad-hocanalyses uitvoeren wanneer een concrete vraag om een antwoord vraagt.",
    ],
    watUKrijgt: [
      "Een rapportageset per doelgroep, met een vaste structuur en een vast ritme.",
      "Een indicatorendefinitiedocument dat als intern referentiepunt dient.",
      "Waar gewenst een dashboard, of aanlevering in een formaat dat aansluit op uw bestaande omgeving.",
      "Ondersteuning bij de eerste rapportagecycli, tot het intern loopt.",
    ],
    methodologie: [
      {
        label: "Doelgroepgericht",
        tekst:
          "Elk rapport heeft één duidelijke lezer. Rapporten die iedereen moeten bedienen, bedienen niemand.",
      },
      {
        label: "Definitiebeheer",
        tekst:
          "Indicatoren worden eenmaal gedefinieerd en centraal beheerd, zodat hetzelfde cijfer overal hetzelfde betekent.",
      },
      {
        label: "Visualisatie",
        tekst:
          "Sobere grafiekkeuzes, nulpunt op de as waar dat hoort, en altijd de aantallen erbij.",
      },
      {
        label: "Overdracht",
        tekst:
          "We bouwen zo dat u het kunt overnemen. Afhankelijkheid van een externe partij is geen doel.",
      },
    ],
  },
];

export const dienstPerSlug = (slug) => diensten.find((d) => d.slug === slug);
