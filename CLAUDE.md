# Motol Training – pravidla pro Clauda

Webová aplikace pro trénink na chytrém trenažéru (Tacx Neo 2T, FTMS přes Web Bluetooth) ve 3D Velodromu Praha-Motol. Sesterský projekt hry motol-simulator.

## Soubory

- `index.html` – HUD, ovládání, úvodní obrazovka, CSS.
- `js/velodrom.js` – **vygenerovaný** soubor (cca 430 kB) se scénou z motol-simulator. Needituj ho ručně a nečti celý, hledej přes Grep. Změny grafiky dělej v simulátoru a přegeneruj: `python3 tools/extract-velodrom.py ../motol-simulator/index.html`. Exportuje `window.VELO`.
- `js/ftms.js` – Bluetooth (`window.BLE`): FTMS Indoor Bike Data 0x2AD2, Control Point 0x2AD9 (0x00 řízení, 0x05 ERG, 0x07 start, 0x11 simulace), záloha Cycling Power 0x1818, tep 0x180D.
- `js/app.js` – fyzika (energie: výkon − valivý odpor − vzduch − m·g·Δh), čáry na dráze, kola, vodič se závětřím, kamera, HUD. V konzoli je `window.MT` pro ladění.

## Konvence

- Odpovídej česky, texty v aplikaci jsou česky.
- Žádný build, žádné npm. Three.js r128 z CDN (stejná verze jako simulátor).
- Web Bluetooth funguje jen v Chromu/Edge přes HTTPS nebo localhost.
- Po změně ověř, že stránka jde načíst bez chyby v konzoli a že demo režim jezdí.

## Vydávání a zálohy

- Hotové změny slučuj do `main` automaticky, bez ptaní (GitHub Pages: https://pavellehkyy-arch.github.io/motol-training/). Po sloučení napiš uživateli odkaz.
- Před každým sloučením nech zálohu: ze stávající `main` vytvoř větev `zaloha-RRRR-MM-DD-HHMM` (čas Europe/Prague) přes GitHub MCP `create_branch` (git push tagů a cizích větví proxy odmítá). Slučuj přes `git merge --no-ff`, aby šla každá verze dohledat.
- Historii `main` nikdy nepřepisuj (žádný force-push). Návrat ke staré verzi = nový commit, který obnoví soubory ze zálohy (`git checkout origin/zaloha-… -- .`).
