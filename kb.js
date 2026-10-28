/* Baza wiedzy aplikacji „Jaka to kłódka?”: typy, mechanizmy, marki, materiały, klucze i konserwacja.
   Wszystko statyczne i lokalne. Prawdopodobieństwa a priori to rozsądne szacunki rynkowe, a nie dane producentów.
   Aplikacja służy do rozpoznania i oceny kłódki — nie pokazuje, jak otworzyć kłódkę bez klucza ani szyfru. */
(function () {
  "use strict";

  const KEY_BOW = '<circle cx="11" cy="24" r="7"/><circle cx="11" cy="24" r="2.4"/>';

  /* ---------- Typy kłódek ---------- */
  const TYPES = [
    { id: "standard", name: "Klasyczna na klucz", title: "Kłódka klasyczna na klucz", family: "klucz", range: "2–4",
      desc: "Lity korpus z mosiądzu, stali lub aluminium, pałąk w kształcie litery U, otwór na klucz zwykle od spodu.",
      opis: "Lity korpus i pałąk w kształcie litery U. Otwór na klucz jest zwykle od spodu.",
      base: { cut: 3, impact: 3, weather: 3 }, price: "budżetowa do średniej",
      icon: '<path d="M16.5 22v-6.5a7.5 7.5 0 0 1 15 0V22"/><rect x="10" y="22" width="28" height="20" rx="3"/><circle cx="24" cy="30.5" r="2.6"/><path d="M24 33.1v4.4"/>' },
    { id: "laminowana", name: "Laminowana", title: "Kłódka laminowana", family: "klucz", range: "2–4",
      desc: "Korpus ze stalowych płytek. Z boku widać poziome paski i nity w rogach.",
      opis: "Korpus złożony ze stalowych płytek połączonych nitami. Dobrze znosi uderzenia, bez powłoki rdzewieje.",
      base: { cut: 3, impact: 4, weather: 2 }, price: "budżetowa",
      icon: '<path d="M16.5 22v-6.5a7.5 7.5 0 0 1 15 0V22"/><rect x="10" y="22" width="28" height="20" rx="1.5"/><path d="M10 27h28M10 32h28M10 37h28" stroke-width="1.4"/>' },
    { id: "szyfrowa_kolka", name: "Szyfrowa z kółkami", title: "Kłódka szyfrowa z kółkami", family: "szyfr", range: "1–3",
      desc: "Trzy do pięciu obrotowych kółek z cyframi. Bez klucza.",
      opis: "Otwierana szyfrem ustawianym na obrotowych kółkach z cyframi. W wielu modelach szyfr można zmienić.",
      base: { cut: 2, impact: 2, weather: 3 }, price: "budżetowa",
      icon: '<path d="M17 22v-6a7 7 0 0 1 14 0v6"/><rect x="9" y="22" width="30" height="20" rx="3"/><rect x="12" y="27" width="4.5" height="10" rx="1"/><rect x="18.5" y="27" width="4.5" height="10" rx="1"/><rect x="25" y="27" width="4.5" height="10" rx="1"/><rect x="31.5" y="27" width="4.5" height="10" rx="1"/>' },
    { id: "szyfrowa_tarcza", name: "Szyfrowa z tarczą", title: "Kłódka szyfrowa z tarczą", family: "szyfr", range: "1–2",
      desc: "Jedna obrotowa tarcza z podziałką, jak w szkolnych szafkach. Szyfr z trzech liczb.",
      opis: "Szyfr wybiera się, obracając jedną tarczę z podziałką raz w prawo, raz w lewo.",
      base: { cut: 2, impact: 2, weather: 3 }, price: "budżetowa",
      icon: '<path d="M17 21v-6a7 7 0 0 1 14 0v6"/><rect x="10" y="21" width="28" height="22" rx="7"/><circle cx="24" cy="32" r="6.5"/><circle cx="24" cy="32" r="1.6"/><path d="M24 23.2v2.3"/>' },
    { id: "dyskowa", name: "Dyskowa", title: "Kłódka dyskowa", family: "klucz", range: "3–5",
      desc: "Okrągły korpus, pałąk prawie cały schowany. Otwór na klucz z przodu. Do bram, rolet i busów.",
      opis: "Okrągły, masywny korpus, w którym pałąk jest prawie cały schowany.",
      base: { cut: 4, impact: 4, weather: 3 }, price: "średnia",
      icon: '<circle cx="24" cy="26" r="15.5"/><path d="M14 19.5h20"/><path d="M17.5 19.5V17a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v2.5"/><circle cx="24" cy="31" r="2.2"/>' },
    { id: "oslonieta", name: "Z osłoniętym pałąkiem", title: "Kłódka z osłoniętym pałąkiem", family: "klucz", range: "3–5",
      desc: "Korpus zasłania pałąk z boków. Często wysoka klasa zabezpieczeń.",
      opis: "Korpus ma boczne osłony, które zakrywają pałąk.",
      base: { cut: 4, impact: 4, weather: 3 }, price: "średnia do premium",
      icon: '<path d="M19 24v-8a5 5 0 0 1 10 0v8"/><path d="M9 42V19h8v5h14v-5h8v23z"/><circle cx="24" cy="32" r="2.4"/><path d="M24 34.4v3.6"/>' },
    { id: "linkowa", name: "Z pałąkiem linkowym", title: "Kłódka z pałąkiem linkowym", family: "klucz", range: "1–2",
      desc: "Zamiast pałąka giętka stalowa linka. Wygodna przy kratach i zasuwach.",
      opis: "Zamiast sztywnego pałąka ma giętką stalową linkę.",
      base: { cut: 1, impact: 2, weather: 3 }, price: "budżetowa",
      icon: '<path d="M16 24C9 15 11 5 22 5s16 8 10 19"/><rect x="10" y="24" width="28" height="18" rx="3"/><circle cx="24" cy="31.5" r="2.2"/><path d="M24 33.7v3.3"/>' },
    { id: "tsa", name: "Bagażowa TSA", title: "Kłódka bagażowa TSA", family: "bagaz", range: "1",
      desc: "Mała kłódka z czerwonym rombem TSA, do walizki.",
      opis: "Mała kłódka do walizki z czerwonym rombem TSA. Kontrola bezpieczeństwa na lotniskach w USA może ją otworzyć bez niszczenia.",
      base: { cut: 1, impact: 1, weather: 2 }, price: "budżetowa",
      icon: '<path d="M18.5 22v-5a5.5 5.5 0 0 1 11 0v5"/><rect x="12" y="22" width="24" height="19" rx="3"/><path d="M24 25.5l4.5 5-4.5 5-4.5-5z"/>' },
    { id: "elektroniczna", name: "Elektroniczna", title: "Kłódka elektroniczna", family: "elektronika", range: "2–4",
      desc: "Odcisk palca, kod z klawiatury albo telefon przez Bluetooth. Akumulator ładowany przez USB.",
      opis: "Otwierana odciskiem palca, kodem albo telefonem. Zwykle ma akumulator ładowany przez USB.",
      base: { cut: 3, impact: 2, weather: 2 }, price: "średnia do premium",
      icon: '<path d="M17 21v-6a7 7 0 0 1 14 0v6"/><rect x="10" y="21" width="28" height="22" rx="3"/><g fill="currentColor" stroke="none"><circle cx="17" cy="28.5" r="1.7"/><circle cx="24" cy="28.5" r="1.7"/><circle cx="31" cy="28.5" r="1.7"/><circle cx="17" cy="35.5" r="1.7"/><circle cx="24" cy="35.5" r="1.7"/><circle cx="31" cy="35.5" r="1.7"/></g>' }
  ];
  const OTHER_TYPE = { id: "inna", name: "Nie ustalono", title: "Kłódka", family: "klucz", range: "?", desc: "", opis: "Typu nie udało się ustalić, więc ocena opiera się na ogólnych cechach kłódek.",
    base: { cut: 3, impact: 3, weather: 3 }, price: "zależy od modelu",
    icon: '<circle cx="24" cy="24" r="16"/><path d="M19.5 19.5a4.5 4.5 0 1 1 6.3 4.1c-1.2.6-1.8 1.4-1.8 2.7v1"/><circle cx="24" cy="32.5" r="1.4" fill="currentColor" stroke="none"/>' };

  /* ---------- Mechanizmy ----------
     keyed: true = otwierany kluczem. sec = ocena jakości mechanizmu w skali 1–5 (część oceny odporności). */
  const MECHS = [
    { id: "bebenkowy", name: "Wkładka bębenkowa", en: "pin tumbler", keyed: true, sec: 3,
      key: "Klucz z ząbkami na jednej krawędzi", hole: "Wąska, falista szczelina w okrągłej wkładce",
      opis: "Najczęstszy mechanizm. Ochrona zależy od jakości wkładki: tanie są proste, markowe znacznie lepsze.",
      icon: KEY_BOW + '<path d="M18 20h26v4l-3 4-3-4-3 4-3-3-3 3-3-4-3 3-3-3h-2z"/>' },
    { id: "nawiercany", name: "Wkładka nawiercana", en: "dimple", keyed: true, sec: 4,
      key: "Płaski klucz z okrągłymi wgłębieniami na boku", hole: "Płaska, prosta szczelina (często pozioma)",
      opis: "Klucz ma wgłębienia na płaskiej stronie zamiast ząbków. Zwykle precyzyjniejsza od zwykłej wkładki.",
      icon: KEY_BOW + '<rect x="18" y="19" width="26" height="10" rx="2"/><g fill="currentColor" stroke="none"><circle cx="24" cy="24" r="1.5"/><circle cx="30" cy="24" r="1.5"/><circle cx="36" cy="24" r="1.5"/><circle cx="41" cy="24" r="1.2"/></g>' },
    { id: "tarczowy", name: "Mechanizm tarczowy", en: "disc detainer", keyed: true, sec: 4,
      key: "Klucz półokrągły lub płaski z nacięciami pod różnymi kątami", hole: "Otwór w kształcie półksiężyca albo litery D",
      opis: "Zamiast sprężynujących bolców ma obrotowe tarcze. Spotykany w droższych kłódkach (np. Abloy, ABUS Plus), dobrze znosi brud i mróz.",
      icon: KEY_BOW + '<path d="M18 20h26v8H18z"/><path d="M24 20l-2 8M30 20l2 8M36 20l-2 8M41 20l1.5 8"/>' },
    { id: "plytkowy", name: "Mechanizm płytkowy", en: "wafer", keyed: true, sec: 1,
      key: "Prosty, płaski klucz, często z nacięciami po obu stronach", hole: "Prosta szczelina, przez którą widać płaskie płytki",
      opis: "Najprostszy mechanizm z płaskimi płytkami. Typowy dla tanich kłódek, szafek i skrzynek.",
      icon: KEY_BOW + '<path d="M18 21h5l1.5 2 1.5-2h5l1.5 2 1.5-2H44v6H34l-1.5-2-1.5 2h-5l-1.5-2-1.5 2h-5z"/>' },
    { id: "zapadkowy", name: "Zamek zapadkowy", en: "lever", keyed: true, sec: 3,
      key: "Klucz z bródką, jak do starych drzwi", hole: "Dziurka od klucza: kółko z prostokątem pod spodem",
      opis: "Klasyczny mechanizm z zapadkami, spotykany w starszych i ciężkich kłódkach. Ochrona rośnie z liczbą zapadek.",
      icon: KEY_BOW + '<path d="M18 24h24"/><path d="M35 24v8h7v-3h-3v-5"/>' },
    { id: "przeszkodowy", name: "Zamek przeszkodowy", en: "warded", keyed: true, sec: 1,
      key: "Płaski, tłoczony klucz z wycięciami na końcu", hole: "Cienka szczelina bez okrągłej wkładki",
      opis: "W środku są tylko stałe przeszkody, które omija odpowiednio wycięty klucz. Najsłabsza ochrona wśród kłódek na klucz (np. Master Lock serii 500).",
      icon: KEY_BOW + '<path d="M18 21h22v6H18z"/><path d="M40 21v-2h4v10h-4v-2M34 21v3M30 27v-3"/>' },
    { id: "rurkowy", name: "Zamek rurkowy", en: "tubular", keyed: true, sec: 2,
      key: "Klucz w kształcie rurki z nacięciami na obwodzie", hole: "Okrągły otwór z kołkiem pośrodku",
      opis: "Bolce ułożone w okręgu. Spotykany w kłódkach rowerowych, automatach i niektórych kłódkach dyskowych.",
      icon: KEY_BOW + '<rect x="18" y="20" width="22" height="8" rx="1"/><circle cx="42" cy="24" r="4"/><circle cx="42" cy="24" r="1.4"/>' },
    { id: "kola", name: "Kółka szyfrowe", en: "combination wheels", keyed: false, sec: 1,
      key: "Bez klucza — 3–5 kółek z cyframi", hole: "Brak otworu na klucz",
      opis: "Otwierana szyfrem ustawianym na kółkach z cyframi. Więcej kółek to więcej kombinacji.",
      icon: '<rect x="8" y="16" width="32" height="16" rx="3"/><path d="M15 16v16M24 16v16M33 16v16"/>' },
    { id: "tarcza_szyfrowa", name: "Tarcza szyfrowa", en: "combination dial", keyed: false, sec: 2,
      key: "Bez klucza — jedna tarcza z podziałką", hole: "Brak otworu na klucz",
      opis: "Szyfr z trzech liczb wybiera się obrotami tarczy. Typowa dla szafek w szkole i w pracy.",
      icon: '<circle cx="24" cy="24" r="14"/><circle cx="24" cy="24" r="3"/><path d="M24 10v4M38 24h-4M24 38v-4M10 24h4"/>' },
    { id: "elektroniczny", name: "Zamek elektroniczny", en: "electronic", keyed: false, sec: 2,
      key: "Bez klucza — palec, kod albo telefon", hole: "Brak otworu (czasem awaryjny kluczyk)",
      opis: "Blokadę zwalnia elektronika po autoryzacji. Ochrona zależy od elektroniki i jakości korpusu.",
      icon: '<rect x="12" y="10" width="24" height="28" rx="4"/><path d="M18 18h12M18 24h12M18 30h7"/>' }
  ];
  const MECH_BY_ID = {};
  MECHS.forEach((m) => { MECH_BY_ID[m.id] = m; });
  const KEYED = MECHS.filter((m) => m.keyed).map((m) => m.id);

  /* P(mechanizm | typ) — szacunki rynkowe. */
  const TYPE_MECH = {
    standard: { bebenkowy: 0.78, nawiercany: 0.04, tarczowy: 0.06, plytkowy: 0.07, zapadkowy: 0.01, przeszkodowy: 0.03, rurkowy: 0.01 },
    laminowana: { bebenkowy: 0.80, przeszkodowy: 0.14, plytkowy: 0.04, tarczowy: 0.01, nawiercany: 0.01 },
    dyskowa: { bebenkowy: 0.58, tarczowy: 0.33, nawiercany: 0.05, rurkowy: 0.04 },
    oslonieta: { bebenkowy: 0.55, tarczowy: 0.30, nawiercany: 0.12, rurkowy: 0.02, zapadkowy: 0.01 },
    linkowa: { bebenkowy: 0.60, plytkowy: 0.30, przeszkodowy: 0.10 },
    szyfrowa_kolka: { kola: 1 },
    szyfrowa_tarcza: { tarcza_szyfrowa: 1 },
    tsa: { kola: 0.72, plytkowy: 0.14, przeszkodowy: 0.09, bebenkowy: 0.05 },
    elektroniczna: { elektroniczny: 1 },
    inna: { bebenkowy: 0.70, plytkowy: 0.09, tarczowy: 0.08, przeszkodowy: 0.06, nawiercany: 0.04, rurkowy: 0.02, zapadkowy: 0.01 }
  };

  /* Marki. mech = P(mechanizm | marka, kłódka na klucz). byType = korekty dla konkretnego typu. secBoost = premia do oceny mechanizmu. */
  const BRANDS = [
    { id: "abloy", name: "Abloy", mech: { tarczowy: 0.97, bebenkowy: 0.03 }, secBoost: 1,
      note: "Kłódki Abloy (seria PL3xx) mają mechanizmy tarczowe: Classic, Sento, Novel, Protec, Protec2 — to jedna z najwyższych klas zabezpieczeń.",
      key: "Klucze dorabia tylko Abloy lub autoryzowany partner, na podstawie karty właściciela." },
    { id: "abus", name: "ABUS", mech: { bebenkowy: 0.78, tarczowy: 0.18, nawiercany: 0.03, plytkowy: 0.01 },
      byType: { oslonieta: { tarczowy: 0.62, bebenkowy: 0.36, nawiercany: 0.02 }, dyskowa: { tarczowy: 0.55, bebenkowy: 0.45 } },
      note: "ABUS: większość kłódek ma wkładki bębenkowe; seria Plus (np. Granit 37, Diskus 20/70) ma tarczowy cylinder „Plus”. Diskus 24IB/70 ma wkładkę bębenkową.",
      key: "Klucze do serii Plus i z kartą kodową dorabia ABUS lub autoryzowany punkt." },
    { id: "masterlock", name: "Master Lock", mech: { bebenkowy: 0.82, przeszkodowy: 0.10, plytkowy: 0.05, tarczowy: 0.02, rurkowy: 0.01 },
      byType: { laminowana: { bebenkowy: 0.85, przeszkodowy: 0.15 } },
      note: "Master Lock: laminowane No. 1, 3 i 5 mają 4-pinową wkładkę bębenkową; seria 500 to zamek przeszkodowy.",
      key: "Numer klucza bywa wybity na kluczu — według niego dorobisz duplikat." },
    { id: "multlock", name: "Mul-T-Lock", mech: { bebenkowy: 0.95, nawiercany: 0.05 }, secBoost: 2,
      note: "Mul-T-Lock stosuje teleskopowe bolce (pin-in-pin) — bardzo wysoka klasa zabezpieczeń.",
      key: "Duplikat tylko w autoryzowanym punkcie, na podstawie karty właściciela." },
    { id: "squire", name: "Squire", mech: { bebenkowy: 0.88, tarczowy: 0.07, nawiercany: 0.05 },
      note: "Squire Stronghold (np. SS50CS) ma 6-pinową wkładkę bębenkową.", key: "" },
    { id: "burg", name: "Burg-Wächter", mech: { bebenkowy: 0.86, nawiercany: 0.06, tarczowy: 0.05, plytkowy: 0.03 }, note: "", key: "" },
    { id: "yale", name: "Yale", mech: { bebenkowy: 0.88, tarczowy: 0.05, plytkowy: 0.04, nawiercany: 0.03 }, note: "", key: "" },
    { id: "stanley", name: "Stanley", mech: { bebenkowy: 0.80, plytkowy: 0.15, przeszkodowy: 0.05 }, note: "", key: "" },
    { id: "brinks", name: "Brinks", mech: { bebenkowy: 0.80, plytkowy: 0.10, przeszkodowy: 0.10 }, note: "", key: "" },
    { id: "kryptonite", name: "Kryptonite", mech: { tarczowy: 0.60, bebenkowy: 0.40 }, note: "Kryptonite w wielu zapięciach stosuje cylindry tarczowe.", key: "" }
  ];
  const BRAND_BY_ID = {};
  BRANDS.forEach((b) => { BRAND_BY_ID[b.id] = b; });

  /* ---------- Klucz i konserwacja (dla właściciela) ---------- */
  const DUPLICATE = {
    bebenkowy: "w większości punktów dorabiających klucze",
    plytkowy: "w większości punktów dorabiających klucze",
    przeszkodowy: "u ślusarza",
    zapadkowy: "u ślusarza — klucze z bródką rzadko są w zwykłych punktach",
    rurkowy: "u ślusarza z maszyną do kluczy rurkowych",
    nawiercany: "w punkcie z maszyną do kluczy nawiercanych albo u producenta",
    tarczowy: "zwykle tylko u producenta lub w autoryzowanym punkcie"
  };

  /* ---------- Materiały, poziomy, certyfikaty ---------- */
  const MATERIALS = [
    { id: "mosiadz", name: "Mosiądz", hint: "żółty, złoty połysk", weather: 5, impact: 0, swatch: "#C9A13B" },
    { id: "stal", name: "Stal", hint: "szara albo chromowana", weather: 2, impact: 0, swatch: "#8A9299" },
    { id: "nierdzewna", name: "Stal nierdzewna", hint: "matowa, srebrna", weather: 5, impact: 0, swatch: "#C3C9CE" },
    { id: "aluminium", name: "Aluminium", hint: "lekkie, często kolorowe", weather: 4, impact: -1, swatch: "#3D7DCA" },
    { id: "oslona", name: "Osłona z gumy lub tworzywa", hint: "korpus w obudowie", weather: null, impact: 0, swatch: "#2A2E33" }
  ];
  const MAT_BY_ID = {};
  MATERIALS.forEach((m) => { MAT_BY_ID[m.id] = m; });
  const LEVELS = {
    1: { name: "bardzo niska", uses: "bagaż, skrzynka na drobiazgi" },
    2: { name: "niska", uses: "szafka, skrzynka na narzędzia" },
    3: { name: "średnia", uses: "furtka, szopa, piwnica" },
    4: { name: "wysoka", uses: "garaż, brama, rower" },
    5: { name: "bardzo wysoka", uses: "kontener, magazyn, przyczepa" }
  };
  const EN_LEVEL = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 5 };
  const SS = { bronze: { name: "Bronze", level: 3 }, silver: { name: "Silver", level: 4 }, gold: { name: "Gold", level: 5 }, diamond: { name: "Diamond", level: 5 } };

  const TYPE_BY_ID = { inna: OTHER_TYPE };
  TYPES.forEach((t) => { TYPE_BY_ID[t.id] = t; });

  window.KB = { TYPES, OTHER_TYPE, TYPE_BY_ID, MECHS, MECH_BY_ID, KEYED, TYPE_MECH, BRANDS, BRAND_BY_ID, DUPLICATE,
    MATERIALS, MAT_BY_ID, LEVELS, EN_LEVEL, SS, KEY_BOW };
})();
