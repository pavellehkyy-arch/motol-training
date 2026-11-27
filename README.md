# Motol Training

Trénink na chytrém trenažéru ve 3D Velodromu Praha-Motol, něco jako Rouvy nebo Zwift, jen na dráze. Běží v prohlížeči, nic se neinstaluje.

**Jezdit:** https://pavellehkyy-arch.github.io/motol-training/ (po zapnutí GitHub Pages, viz níže)

## Co to umí

- Připojení trenažéru přes Bluetooth (FTMS, např. **Tacx Neo 2T**). Trenažéry bez FTMS se připojí přes Cycling Power, ale jen pro čtení výkonu.
- Hrudní pás přes Bluetooth (nepovinné). Když tep posílá trenažér, vezme se i odtud.
- Rychlost na dráze se počítá z výkonu: hmotnost, valivý odpor dřeva, odpor vzduchu v dráhové pozici. Při vyjetí do klopení ztrácíš rychlost, při sjezdu ji získáš.
- **Režim simulace:** trenažér dostává sklon, takže při stoupání do klopení přitlačí.
- **Režim ERG:** trenažér drží nastavené watty (tlačítka − / + v menu ☰ nebo klávesy − / +).
- **Vodič:** jezdec, který jede nastavenou rychlostí. Když se za něj zavěsíš (do 2,5 m), máš o třetinu menší odpor vzduchu.
- Volba čáry na dráze: černá, sprinterská, stayerská, nahoře, u mantinelu (šipky ▲▼).
- Časy kol, nejlepší kolo, souhrn jízdy (čas, vzdálenost, průměrný a maximální výkon, kJ).
- Kamery: za jezdcem, z kola, televizní, z výšky (ťuknutí do obrazu nebo klávesa C).
- Ovládání je schované v menu ☰ vpravo nahoře (režim, vodič, kamera, připojení, souhrn, celá obrazovka). Na obrazovce zůstávají jen šipky ▲▼ pro čáru na dráze.
- Bez trenažéru jde vyzkoušet v demu s posuvníkem výkonu.

## Kde to funguje

Web Bluetooth umí jen Chrome a Edge (Windows, macOS, Android, ChromeOS). Na iPhonu a iPadu použij aplikaci **Bluefy**. Safari a Firefox Bluetooth neumí.

Stránka musí běžet přes HTTPS (GitHub Pages) nebo na `localhost`. Před připojením odpoj trenažér ze Zwiftu nebo aplikace Tacx, Bluetooth spojení může mít jen jedna aplikace.

## Zapnutí GitHub Pages

Settings → Pages → Source: *Deploy from a branch* → větev `main`, složka `/ (root)` → Save. Za minutu je stránka na adrese výše.

## Lokální spuštění

```
python3 -m http.server 8000
```

a otevři http://localhost:8000 v Chromu.

## Struktura

| Soubor | Obsah |
|---|---|
| `index.html` | stránka, HUD, ovládání |
| `js/velodrom.js` | 3D scéna velodromu a model jezdce, **vygenerovaná** z [motol-simulator](https://github.com/pavellehkyy-arch/motol-simulator) |
| `js/ftms.js` | Bluetooth: FTMS (výkon, kadence, ERG, simulace), Cycling Power, tep |
| `js/app.js` | fyzika jízdy, kamera, kola, vodič, HUD |
| `tools/extract-velodrom.py` | vytáhne grafiku ze simulátoru do `js/velodrom.js` |

Když se v simulátoru změní grafika dráhy nebo jezdců, přegeneruj ji:

```
python3 tools/extract-velodrom.py ../motol-simulator/index.html
```
