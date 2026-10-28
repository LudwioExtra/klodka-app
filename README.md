# Jaka to kłódka? — aplikacja (PWA), wersja 8

Instalowalna aplikacja webowa do rozpoznawania kłódek. Działa jak zwykła apka: ikona na ekranie
głównym, pełny ekran, działa offline. Całe rozpoznawanie liczy się na telefonie — zdjęcie nie jest
nigdzie wysyłane, nie ma chmury.

## Co robi

- **Aparat w aplikacji, zdjęcia automatyczne.** Wycelujesz w kłódkę — aplikacja sama zrobi zdjęcie,
  gdy kłódka będzie ostra w kadrze, i poprosi o zbliżenie otworu na klucz, jeśli to potrzebne.
  Można to wyłączyć i robić zdjęcia przyciskiem.
- **Rozpoznanie:** typ kłódki, marka (gdy widać logo), materiał korpusu i **mechanizm z procentem
  pewności** oraz drugą i trzecią możliwością.
- **Mechanizm** szacuje z kilku źródeł naraz: wyglądu i typu kłódki, marki, zbliżenia otworu na klucz,
  zdjęcia klucza i Twoich wcześniejszych poprawek. Gdy pewność jest niska, zadaje jedno pytanie
  z obrazkami („który kształt klucza widzisz?”) — jedno dotknięcie i wynik jest pewny.
- **Ocena odporności** (przecięcie, uderzenie, mechanizm, pogoda), oznaczenia z korpusu
  (HARDENED, BORON, EN 12320, Sold Secure), zapasowy klucz i konserwacja.
- **Uczy się na poprawkach:** gdy poprawisz wynik, zapamięta liczbowy „odcisk” zdjęcia (512 liczb,
  nie obraz) i następnym razem rozpozna podobną kłódkę. Można wyłączyć w ustawieniach.

Aplikacja rozpoznaje i ocenia kłódki. Nie pokazuje, jak otworzyć kłódkę bez klucza ani szyfru.

## Prywatność i pamięć telefonu

- Zdjęcie z aparatu **nie staje się plikiem**: obraz idzie prosto z podglądu do pamięci roboczej,
  a po analizie jest nadpisywany zerami. Nic nie trafia do galerii.
- Historia zawiera tylko opis wyniku (bez zdjęć). Miniatury zdjęć zapisane przez poprzednią wersję
  aplikacji są usuwane przy pierwszym uruchomieniu wersji 8.
- Zdjęcie wybrane „Z galerii” zostaje w galerii — aplikacja nie może go stamtąd usunąć.
- W ustawieniach „Prywatność i dane” jednym przyciskiem usuniesz historię i naukę.

## Pliki

- `index.html`, `app.js`, `kb.js` — aplikacja i baza wiedzy
- `vision-worker.js` — uruchamia model rozpoznawania w tle
- `model/` — model rozpoznawania obrazu (CLIP ViT-B/32, ok. 91 MB w 4 częściach) i opisy klas
- `ort/` — silnik onnxruntime-web 1.29 (ok. 14 MB)
- `fonts/` — czcionki (lokalnie, żeby działało offline)
- `manifest.webmanifest`, `sw.js`, `icons/` — instalacja i tryb offline
- `_headers` — ustawienia dla Netlify (pozwalają modelowi liczyć na kilku rdzeniach — szybciej)
- `mobilenet.js` — **niepotrzebny** (stary model z wersji 7). Możesz go usunąć.
- `poprzednia-wersja/` — kopia plików wersji 7 na wszelki wypadek.

## Jak uruchomić na iPhonie

iPhone wymaga adresu **https://**, dlatego aplikację trzeba raz opublikować.

### Wariant A — Netlify Drop (zalecany)
1. Na komputerze wejdź na **https://app.netlify.com/drop**
2. Przeciągnij **cały folder `klodka-app`**. Podfolder `poprzednia-wersja` i plik `mobilenet.js`
   nie przeszkadzają, ale możesz je wcześniej usunąć, żeby wysyłka była mniejsza.
3. Dostaniesz adres typu `https://losowa-nazwa.netlify.app`. Plik `_headers` sprawi, że model
   będzie liczył na kilku rdzeniach telefonu.

### Wariant B — GitHub Pages
1. Załóż repozytorium, wgraj zawartość folderu `klodka-app`.
2. Settings → Pages → Branch: `main` / `(root)` → Save.
3. Działa tak samo, tylko model liczy na jednym rdzeniu (GitHub Pages nie obsługuje `_headers`).

### Dodanie do ekranu głównego
1. Otwórz adres https w **Safari** na iPhonie.
2. **Udostępnij** → **Do ekranu początkowego** → Dodaj.
3. **Za pierwszym razem** aplikacja pobierze model (ok. 105 MB) — najlepiej przez Wi-Fi.
   Potem działa offline, a model uruchamia się w 1–3 sekundy.

## Szybkość

Jedno zdjęcie analizuje się zwykle w 0,5–1 s (trzy kadry: cały obraz, środek i zbliżenie).
Wymagany jest iOS 16.4 lub nowszy (albo aktualny Chrome na Androidzie).

## Jak czytać wynik

Procent przy mechanizmie to pewność aplikacji. Powyżej 85% wynik jest pewny; niżej aplikacja
sama poprosi o zbliżenie otworu na klucz albo zada jedno pytanie. Rozpoznanie ze zdjęcia nie jest
nieomylne — wynik potwierdzisz, patrząc na klucz albo otwór (aplikacja pokazuje, po czym poznać
każdy mechanizm).

## Podgląd na komputerze (opcjonalnie)

W folderze `klodka-app` uruchom `python -m http.server 8000` i otwórz `http://localhost:8000`.

## Aktualizacja

Po zmianie plików podmień je na serwerze i zmień numer `SHELL` w `sw.js` (np. `klodka-shell-v9`),
żeby telefony pobrały nową wersję. Model ma osobny schowek i nie pobiera się ponownie.

## Licencje

- Model: OpenCLIP ViT-B/32 (LAION-2B), licencja MIT — przekonwertowany do ONNX i skwantyzowany (int8).
- onnxruntime-web 1.29.0 — licencja MIT.
- Czcionki Archivo, IBM Plex Mono, Big Shoulders Display — SIL Open Font License.
