# Jaka to kłódka? — aplikacja (PWA)

Instalowalna aplikacja webowa. Działa jak zwykła apka: ikona na ekranie głównym,
pełny ekran, działa offline. Rozpoznawanie kłódek liczy się w całości na telefonie —
zdjęcie nie jest nigdzie wysyłane, nie ma Claude ani chmury.

## Pliki
- `index.html` — aplikacja
- `mobilenet.js` — model rozpoznawania obrazu (ok. 8 MB, pobierany raz)
- `manifest.webmanifest` — dane instalacji (nazwa, ikony, tryb pełnoekranowy)
- `sw.js` — service worker (zapis offline)
- `icons/` — ikony aplikacji

## Jak uruchomić na iPhonie

iPhone wymaga, żeby strona była pod adresem **https://** — dlatego trzeba ją raz
opublikować. Bez konta i bez instalowania niczego najprościej tak:

### Wariant A — Netlify Drop (najszybszy, bez konta, 2 minuty)
1. Na komputerze wejdź na **https://app.netlify.com/drop**
2. Przeciągnij **cały folder `klodka-app`** na stronę.
3. Dostaniesz adres typu `https://losowa-nazwa.netlify.app` — to Twoja aplikacja.

### Wariant B — GitHub Pages (jeśli masz konto GitHub)
1. Załóż nowe repozytorium, wgraj zawartość folderu `klodka-app`.
2. Settings → Pages → Branch: `main` / `(root)` → Save.
3. Po chwili dostaniesz adres `https://twój-login.github.io/nazwa-repo/`.

### Dodanie do ekranu głównego iPhone'a
1. Otwórz adres https w **Safari** na iPhonie.
2. Przycisk **Udostępnij** (kwadrat ze strzałką) → **Do ekranu początkowego**.
3. Potwierdź. Na ekranie pojawi się ikona kłódki — stąd otwierasz apkę na pełnym
   ekranie. Po pierwszym uruchomieniu (gdy pobierze model) działa też offline.

## Podgląd na komputerze (opcjonalnie)
W folderze `klodka-app` uruchom w terminalu:
```
python -m http.server 8000
```
i otwórz `http://localhost:8000`. (Na komputerze to tylko podgląd — instalacja na
telefon idzie przez adres https z wariantu A lub B.)

## Aktualizacja
Gdy zmienisz pliki, podmień je u siebie (Netlify: przeciągnij folder jeszcze raz).
Jeśli przeglądarka trzyma starą wersję, zmień numer `CACHE` w `sw.js` (np. `klodka-v8`).
