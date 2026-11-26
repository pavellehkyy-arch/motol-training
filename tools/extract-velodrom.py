#!/usr/bin/env python3
"""Vytáhne 3D scénu velodromu z motol-simulator do js/velodrom.js.

Použití:  python3 tools/extract-velodrom.py ../motol-simulator/index.html

Bere vše od začátku hlavního skriptu až po komentář „riders roster“
(dráha, hala, infield, rozhodčí, válce, jezdci a kola) a k tomu funkci shadowify.
Vynechává trenéra (buildCoach) a veškerou závodní logiku.
"""
import re
import sys
from pathlib import Path

src_path = Path(sys.argv[1] if len(sys.argv) > 1 else '../motol-simulator/index.html')
out_path = Path(__file__).resolve().parent.parent / 'js' / 'velodrom.js'
lines = src_path.read_text(encoding='utf-8').split('\n')


def find(pattern, start=0):
    for i in range(start, len(lines)):
        if re.search(pattern, lines[i]):
            return i
    raise SystemExit(f'Nenalezeno: {pattern}')


start = find(r'^const \$=id=>')                       # první řádek hlavního skriptu (helpery $, clamp, …)
end = find(r'// ---------- riders roster ----------')  # konec statické scény
shadow = find(r'^function shadowify\(')

body = '\n'.join(lines[start:end])
body = body.replace('buildStairwell();buildCoach();', 'buildStairwell();')
if 'buildCoach();' in body:
    raise SystemExit('buildCoach se nepodařilo odstranit')
body += '\n' + lines[shadow] + '\n' + lines[shadow + 1]   # shadowify má 2 řádky

head = '''// Velodrom Praha-Motol – 3D scéna převzatá z motol-simulator (index.html).
// VYGENEROVÁNO skriptem tools/extract-velodrom.py – needituj ručně, uprav simulátor a vygeneruj znovu.
// Dráha (153,846 m, klopení 12–52°), hala, infield, rozhodčí, válce, model jezdce a kola.
// Výstup: window.VELO
(function(){
'''
tail = '''
window.VELO={THREE,scene,camera,renderer,resize,appSize,SUN,
  L0,TW,BAND,SF,frameAt,surf,surfY,INF_Y,FLOOR_Y,deg,PI,clamp,sm,
  makeRider,poseRider,makeBike,shadowify,drawLapBoard};
})();
'''
out_path.write_text(head + body + tail, encoding='utf-8')
print(f'{out_path}: {len(head + body + tail) // 1024} kB')
