// Motol Training – jízda na Velodromu Praha-Motol s chytrým trenažérem.
// Fyzika: výkon z trenažéru → virtuální rychlost (valivý odpor dřeva + odpor vzduchu + výška v klopení).
(function(){
'use strict';
const V=window.VELO,{THREE,scene,camera,renderer,frameAt,surf,L0,TW,SF,clamp,deg}=V;
const $=id=>document.getElementById(id);

// ---------- nastavení (pamatuje se v prohlížeči) ----------
const DEF={mass:75,bike:8,ftp:250,cda:0.24,mode:'sim',erg:180,pacer:false,pacerKmh:40};
let CFG=Object.assign({},DEF);
try{Object.assign(CFG,JSON.parse(localStorage.getItem('motolTraining')||'{}'));}catch(e){}
const saveCfg=()=>{try{localStorage.setItem('motolTraining',JSON.stringify(CFG));}catch(e){}};

const G=9.81,RHO=1.2,CRR=0.0025;          // hala: vzduch 20 °C, dřevěná dráha
const LINES=[{w:0.2,n:'černá čára'},{w:0.9,n:'sprinterská'},{w:1.9,n:'stayerská'},{w:3.2,n:'nahoře'},{w:4.3,n:'u mantinelu'}];

// ---------- stav jízdy ----------
const S={power:0,cadence:0,hr:null,trainerSpeed:null,src:null,lastData:0,
  v:0,s:SF+L0-8,w:LINES[0].w,line:0,dist:0,time:0,energyJ:0,maxP:0,
  laps:[],lapStart:null,crank:0,lean:0,draft:false,
  pacerS:SF+L0-2,pacerOn:false};
let demoPower=0;

// ---------- modely ----------
const me=V.makeRider({team:'wc',num:1,jersey:0xffffff,discR:true,discF:true,aero:false,shoe:0xffffff,skin:0xe0ad85,hair:0x3b2a1c});V.shadowify(me.g);
const pacer=V.makeRider({team:'dukla',num:12,jersey:0x222222,discR:true,aero:false,skin:0xd9a37c,hair:0x1b1b1b});V.shadowify(pacer.g);pacer.g.visible=false;
const anim=new Map();
function animate(M,dt,v,P,cad,crank){let A=anim.get(M);if(!A)anim.set(M,A={st:0,su:0,sp:0,br:0});
  const e=clamp(P/CFG.ftp,0,2.2);
  const stT=(P>2.2*CFG.ftp||(v<4&&P>150))?1:0;A.st+=(stT-A.st)*Math.min(1,dt*(stT>A.st?6:3));
  const suT=(e<0.3&&v<8)?1:0;A.su+=(suT-A.su)*Math.min(1,dt*1.5);
  const spT=clamp((e-0.95)/0.45,0,1);A.sp+=(spT-A.sp)*Math.min(1,dt*3);
  A.br+=dt*(1.5+2.2*Math.min(e,1.6));
  V.poseRider(M,crank,A.st,A.su*(1-A.st),A.sp*(1-A.st)*(1-A.su),Math.sin(A.br),0,e,0);}
const _p=new THREE.Vector3();
function place(M,s,w,v,dt,leanRef){const f=frameAt(s),heading=Math.atan2(f.fx,f.fz),k=f.k,b=f.b,hc=w*Math.cos(b);
  surf(s,w,_p);M.g.position.copy(_p);M.g.rotation.y=heading;M.g.rotation.x=0;
  const keff=k/(1+k*hc),tgt=-Math.atan(v*v*keff/G)-Math.sin(b)*0.15;leanRef.v+=(tgt-leanRef.v)*Math.min(1,dt*5);M.g.rotation.z=leanRef.v;
  for(const wh of M.wheels)wh.rotation.x+=v/0.34*dt;}
const meLean={v:0},pacerLean={v:0};

// délka dráhy na dané čáře: ds_čára = ds_vnitřní hrana · (1 + k·hc)
function stretch(s,w){const f=frameAt(s);return 1+f.k*w*Math.cos(f.b);}
// výška v klopení
const heightAt=(s,w)=>V.surfY(s,w);

// ---------- trenažér ----------
const trainer=new BLE.Trainer(),hrm=new BLE.HeartRate();
trainer.onData=d=>{if(d.power!=null)S.power=Math.max(0,d.power);if(d.cadence!=null)S.cadence=d.cadence;if(d.speed!=null)S.trainerSpeed=d.speed;if(d.hr)S.hr=d.hr;S.lastData=performance.now();S.src='trainer';};
trainer.onStatus=s=>{$('trStatus').textContent=trainer.name+': '+s+(trainer.kind?' ('+trainer.kind+(trainer.controlled?', řízení odporu':', jen čtení')+')':'');refreshButtons();};
trainer.onLog=s=>toast(s);
hrm.onHr=h=>{S.hr=h;};hrm.onStatus=s=>{$('hrStatus').textContent='Pás: '+s;};

// srozumitelná hláška z chyby Web Bluetooth; null = uživatel jen zavřel výběr zařízení
function bleError(e){const m=(e&&e.message!=null?String(e.message):String(e)).trim(),name=e&&e.name;
  const where=e&&e.step?' (krok: '+e.step+')':'';
  if((name==='NotFoundError'||name==='AbortError')&&/cancel|chooser|zru/i.test(m))return null;
  if(/adapter not available|Bluetooth adapter|powered off|unsupported|unauthori/i.test(m))return 'Bluetooth je vypnutý nebo ho prohlížeč nesmí používat. Zapni Bluetooth a na iPhonu povol Bluefy v Nastavení → Soukromí → Bluetooth.';
  if(name==='SecurityError')return 'Prohlížeč Bluetooth nepovolil: stránka musí běžet přes HTTPS (nebo localhost) a ne ve vloženém okně.';
  if(name==='NotAllowedError')return 'Prohlížeč přístup k Bluetooth zakázal. Povol ho v nastavení webu (ikona zámku vedle adresy).';
  if(name==='NotFoundError')return 'Trenažér se nenašel'+where+'. Je zapnutý (zatoč klikami) a odpojený z jiných aplikací (Zwift, Tacx, Garmin)?';
  if(name==='NetworkError')return 'Spojení se nepodařilo'+where+'. Je trenažér zapnutý a odpojený z jiných aplikací (Zwift, Tacx, Garmin)?';
  // Bluefy hlásí jen číslo: dej aspoň krok a radu
  if(/^-?\d+$/.test(m))return 'Bluetooth hlásí kód '+m+where+'. Zatoč klikami, odpoj trenažér ze Zwiftu/Tacx/Garminu a ťukni na Připojit znovu (ukážou se všechna zařízení, vyber Tacx).';
  return m+where;}
async function connectTrainer(){$('trStatus').textContent='Trenažér: hledám…';
  try{await trainer.connect();S.src='trainer';$('setup').classList.add('hide');applyResistance(true);}
  catch(e){console.warn('Trenažér:',e);const m=bleError(e);$('trStatus').textContent='Trenažér: '+(m?'chyba – '+m:'nepřipojen');if(m)toast(m);}}
// páčky Di2: D-FLY kanál 1 = levá páčka, kanál 2 = pravá
const di2=new BLE.Di2();
di2.onStatus=s=>{$('di2Status').textContent='Páčky '+di2.name+': '+s;};
di2.onButton=ev=>{if(ev.action==='short'){if(ev.ch===1)setLine(-1);else if(ev.ch===2)setLine(1);}
  else if(ev.action==='long'){if(ev.ch===1)cycleCam();else if(ev.ch===2)$('pacerBtn').onclick();}};
di2.onGear=g=>{S.gear=g;$('di2Status').textContent='Páčky '+di2.name+': připojeno, převod '+g.front+' × '+g.rear+'/'+g.rears;};
async function connectDi2(){$('di2Status').textContent='Páčky: hledám…';
  try{await di2.connect();}
  catch(e){console.warn('Di2:',e);const m=bleError(e);$('di2Status').textContent='Páčky: '+(m?'chyba – '+m:'nepřipojeny');if(m)toast(m);}}
async function connectHr(){$('hrStatus').textContent='Pás: hledám…';
  try{await hrm.connect();}
  catch(e){console.warn('Pás:',e);const m=bleError(e);$('hrStatus').textContent='Pás: '+(m?'chyba – '+m:'nepřipojen');if(m)toast(m);}}

// odpor: ERG drží watty; simulace posílá „sklon“ při změně výšky v klopení
let lastSimSent=0,lastGrade=0;
function applyResistance(force){if(!trainer.controlled)return;
  if(CFG.mode==='erg'){trainer.setTargetPower(CFG.erg);return;}
  const now=performance.now(),grade=S.gradeNow||0;
  if(force||Math.abs(grade-lastGrade)>0.3||now-lastSimSent>5000){lastSimSent=now;lastGrade=grade;
    trainer.setSimulation({grade,crr:CRR,cw:0.5*RHO*effCda(),wind:0});}}
const effCda=()=>CFG.cda*(S.draft?0.67:1);

// ---------- simulace ----------
function step(dt){
  const live=S.src==='trainer'&&performance.now()-S.lastData<3000;
  if(S.src!=='trainer'){S.power=demoPower;S.cadence=demoPower>0?85+demoPower/40:0;}
  else if(!live){S.power=0;S.cadence=0;}
  const P=S.power,m=CFG.mass+CFG.bike;
  // změna čáry – plynule, 0,9 m/s do strany
  const wT=LINES[S.line].w,dw=clamp(wT-S.w,-0.9*dt,0.9*dt);
  const h0=heightAt(S.s,S.w);
  // závětří za vodičem: 0,3–2,5 m za ním a do 0,6 m stranou
  S.draft=false;
  if(S.pacerOn){const gap=((S.pacerS-S.s)%L0+L0)%L0;if(gap>0.3&&gap<2.5&&Math.abs(S.w-pacerW())<0.6)S.draft=true;}
  // energie: E_k += (P − odpory·v)·dt − m·g·Δh
  let Ek=0.5*m*S.v*S.v;
  const Fres=CRR*m*G+0.5*RHO*effCda()*S.v*S.v;
  Ek+=(P-Fres*S.v)*dt;
  S.w+=dw;
  const ds=S.v*dt;S.s+=ds/stretch(S.s,S.w);
  const h1=heightAt(S.s,S.w);Ek-=m*G*(h1-h0);
  S.v=Math.sqrt(Math.max(0,2*Ek/m));if(S.v<0.05&&P<=0)S.v=0;
  S.gradeNow=ds>0.01?clamp((h1-h0)/ds*100,-20,20):0;
  if(S.v>0.5||P>0){S.time+=dt;S.energyJ+=P*dt;S.maxP=Math.max(S.maxP,P);}
  S.dist+=ds;
  // kola: průjezd cílovou čarou
  const lapIdx=Math.floor((S.s-SF)/L0);
  if(S.lapIdx==null)S.lapIdx=lapIdx;
  if(lapIdx>S.lapIdx){S.lapIdx=lapIdx;if(S.lapStart!=null){const t=S.time-S.lapStart;S.laps.push(t);lapFlash(t);}S.lapStart=S.time;V.drawLapBoard(S.laps.length);}
  // vodič
  if(S.pacerOn){const pv=CFG.pacerKmh/3.6;S.pacerS+=pv*dt/stretch(S.pacerS,pacerW());}
  // kliky: skutečná kadence z trenažéru
  S.crank+=S.cadence/60*2*Math.PI*dt;
  applyResistance(false);
}
const pacerW=()=>S.line===0?0.95:0.2;   // vodič jede vedle tebe, ne v tobě

// ---------- kamera ----------
let camMode=0;const CAMS=['za jezdcem','z kola','televize','z výšky'];
const camPos=new THREE.Vector3(),camLook=new THREE.Vector3(),_t=new THREE.Vector3(),_l=new THREE.Vector3(),_u=new THREE.Vector3(),camUp=new THREE.Vector3(0,1,0);let camInit=false;
function cameraUpdate(dt){let kk=6;
  if(camMode===0){let f=frameAt(S.s-4.6),b=f.b;surf(S.s-4.6,S.w,_t);_t.x+=-f.nx*Math.sin(b)*2.3;_t.y+=Math.cos(b)*2.3;_t.z+=-f.nz*Math.sin(b)*2.3;
    f=frameAt(S.s+6);b=f.b;surf(S.s+6,S.w,_l);_l.x+=-f.nx*Math.sin(b)*0.5;_l.y+=Math.cos(b)*0.5;_l.z+=-f.nz*Math.sin(b)*0.5;
    f=frameAt(S.s);_u.set(-f.nx*Math.sin(f.b)*0.5,1,-f.nz*Math.sin(f.b)*0.5).normalize();}
  else if(camMode===1){kk=14;let f=frameAt(S.s+0.25),b=f.b;surf(S.s+0.25,S.w,_t);const up=1.42;_t.x+=-f.nx*Math.sin(b)*up;_t.y+=Math.cos(b)*up;_t.z+=-f.nz*Math.sin(b)*up;
    f=frameAt(S.s+9);b=f.b;surf(S.s+9,S.w,_l);_l.y+=0.6;
    f=frameAt(S.s);_u.set(-f.nx*Math.sin(f.b)*0.8,1,-f.nz*Math.sin(f.b)*0.8).normalize();}
  else if(camMode===2){kk=3;surf(S.s,S.w,_l);_l.y+=1;_t.set(_l.x*0.25,V.FLOOR_Y+2.2,_l.z*0.25);_u.set(0,1,0);}
  else{kk=2;surf(S.s,S.w,_l);_t.set(_l.x*0.55,14,_l.z*0.55+0.01);_u.set(0,1,0);}
  if(!camInit){camPos.copy(_t);camLook.copy(_l);camUp.copy(_u);camInit=true;}
  const a=1-Math.exp(-kk*dt);camPos.lerp(_t,a);camLook.lerp(_l,Math.min(1,a*1.6));camUp.lerp(_u,a).normalize();
  camera.position.copy(camPos);camera.up.copy(camUp);camera.lookAt(camLook);
  me.body.visible=camMode!==1;
  const fv=camera.userData.baseFov+(camMode===1?8:0)+clamp((S.v-10)*0.35,0,9);if(Math.abs(camera.fov-fv)>0.05){camera.fov+=(fv-camera.fov)*Math.min(1,dt*2);camera.updateProjectionMatrix();}}

// ---------- HUD ----------
const fmt=t=>{t=Math.max(0,t);const m=Math.floor(t/60),s=t-m*60;return m+':'+(s<10?'0':'')+s.toFixed(1);};
const fmtH=t=>{t=Math.floor(t);const h=Math.floor(t/3600),m=Math.floor(t/60)%60,s=t%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(s).padStart(2,'0');};
let hudT=0,pAvg3=0;
function hud(dt){pAvg3+=(S.power-pAvg3)*Math.min(1,dt/1.5);hudT-=dt;if(hudT>0)return;hudT=0.2;
  $('pw').textContent=Math.round(pAvg3);
  $('spd').textContent=(S.v*3.6).toFixed(1);
  $('cad').textContent=Math.round(S.cadence);
  $('hr').textContent=S.hr?S.hr:'–';$('hrBox').classList.toggle('hide',!S.hr);
  $('dist').textContent=(S.dist/1000).toFixed(2);
  $('time').textContent=fmtH(S.time);
  $('lapN').textContent=S.laps.length;
  $('lapLast').textContent=S.laps.length?fmt(S.laps[S.laps.length-1]):'–';
  $('lapBest').textContent=S.laps.length?fmt(Math.min(...S.laps)):'–';
  $('lineName').textContent=LINES[S.line].n;
  $('draft').classList.toggle('on',S.draft);
  if(S.pacerOn){const gap=((S.pacerS-S.s)%L0+L0)%L0,g=gap>L0/2?gap-L0:gap;$('pacerGap').textContent=(g>=0?'vodič ':'vodič za tebou ')+Math.abs(g).toFixed(1)+' m';}
  $('pacerGap').style.display=S.pacerOn?'':'none';
  $('modeInfo').textContent=S.src==='trainer'?(CFG.mode==='erg'?'ERG '+CFG.erg+' W':'Simulace'+(S.gradeNow>0.5?' · stoupání '+S.gradeNow.toFixed(1)+' %':'')):'Demo (bez trenažéru)';
  const zone=clamp(pAvg3/CFG.ftp,0,2);$('pwBox').style.setProperty('--z',zone<0.55?'#9aa0a6':zone<0.75?'#3b82f6':zone<0.9?'#22c55e':zone<1.05?'#eab308':zone<1.2?'#f97316':'#ef4444');}
function lapFlash(t){const el=$('lapFlash');el.textContent='Kolo '+S.laps.length+' · '+fmt(t)+(t<=Math.min(...S.laps)?' · nejlepší!':'');el.classList.remove('show');void el.offsetWidth;el.classList.add('show');}
let toastT=null;function toast(msg,ms){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),ms||5000);}

// ---------- ovládání ----------
function setLine(d){S.line=clamp(S.line+d,0,LINES.length-1);}
function cycleCam(){camMode=(camMode+1)%CAMS.length;$('camBtn').textContent='📷 '+CAMS[camMode];toast('Kamera: '+CAMS[camMode],1500);}
// menu ☰: otevře/zavře ovládání; ťuknutí do obrazu menu zavře, nebo přepne kameru
const menuOpen=()=>!$('menu').classList.contains('hide');
function showMenu(on){$('menu').classList.toggle('hide',!on);$('line').classList.toggle('hide',on);$('menuBtn').classList.toggle('on',on);}
$('menuBtn').onclick=()=>showMenu(!menuOpen());
$('c').addEventListener('click',()=>{if(menuOpen())showMenu(false);else cycleCam();});
function refreshButtons(){$('modeBtn').textContent=CFG.mode==='erg'?'Režim: ERG':'Režim: simulace';$('ergBox').style.display=CFG.mode==='erg'?'':'none';$('ergVal').textContent=CFG.erg;
  $('pacerBtn').classList.toggle('on',S.pacerOn);$('pacerKmh').textContent=CFG.pacerKmh;$('demoBox').style.display=S.src==='trainer'?'none':'';}
addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;
  if(e.key==='ArrowUp'||e.key==='ArrowRight'){setLine(1);e.preventDefault();}
  else if(e.key==='ArrowDown'||e.key==='ArrowLeft'){setLine(-1);e.preventDefault();}
  else if(e.key==='c'||e.key==='C')cycleCam();
  else if(e.key==='+'){CFG.erg+=10;saveCfg();refreshButtons();applyResistance(true);}
  else if(e.key==='-'){CFG.erg=Math.max(50,CFG.erg-10);saveCfg();refreshButtons();applyResistance(true);}});
$('upBtn').onclick=()=>setLine(1);$('downBtn').onclick=()=>setLine(-1);$('camBtn').onclick=cycleCam;
$('modeBtn').onclick=()=>{CFG.mode=CFG.mode==='erg'?'sim':'erg';saveCfg();refreshButtons();applyResistance(true);};
$('ergMinus').onclick=()=>{CFG.erg=Math.max(50,CFG.erg-10);saveCfg();refreshButtons();applyResistance(true);};
$('ergPlus').onclick=()=>{CFG.erg=Math.min(1500,CFG.erg+10);saveCfg();refreshButtons();applyResistance(true);};
$('pacerBtn').onclick=()=>{S.pacerOn=!S.pacerOn;pacer.g.visible=S.pacerOn;if(S.pacerOn)S.pacerS=S.s+8;refreshButtons();};
$('pacerMinus').onclick=()=>{CFG.pacerKmh=Math.max(20,CFG.pacerKmh-1);saveCfg();refreshButtons();};
$('pacerPlus').onclick=()=>{CFG.pacerKmh=Math.min(70,CFG.pacerKmh+1);saveCfg();refreshButtons();};
$('demoP').oninput=e=>{demoPower=+e.target.value;$('demoVal').textContent=demoPower;};
$('connectBtn').onclick=connectTrainer;$('hrBtn').onclick=connectHr;$('di2Btn').onclick=connectDi2;
$('demoBtn').onclick=()=>{S.src='demo';$('setup').classList.add('hide');refreshButtons();};
$('settingsBtn').onclick=()=>{showMenu(false);$('setup').classList.remove('hide');};
$('endBtn').onclick=()=>{showMenu(false);showSummary();};$('sumClose').onclick=()=>$('summary').classList.add('hide');
$('sumReset').onclick=()=>{Object.assign(S,{dist:0,time:0,energyJ:0,maxP:0,laps:[],lapStart:null});V.drawLapBoard(0);$('summary').classList.add('hide');};
for(const k of ['mass','ftp']){const el=$(k);el.value=CFG[k];el.onchange=()=>{const v=+el.value;if(v>0){CFG[k]=v;saveCfg();}};}
$('fsBtn').onclick=()=>{const d=document.documentElement;if(!document.fullscreenElement)(d.requestFullscreen||d.webkitRequestFullscreen||(()=>{})).call(d);else document.exitFullscreen();};
if(!BLE.supported()){$('bleWarn').style.display='';}

function showSummary(){const best=S.laps.length?Math.min(...S.laps):null;
  $('sumBody').innerHTML=[['Čas',fmtH(S.time)],['Vzdálenost',(S.dist/1000).toFixed(2)+' km'],['Průměrná rychlost',S.time>0?(S.dist/S.time*3.6).toFixed(1)+' km/h':'–'],
    ['Průměrný výkon',S.time>0?Math.round(S.energyJ/S.time)+' W':'–'],['Maximální výkon',Math.round(S.maxP)+' W'],['Energie',Math.round(S.energyJ/1000)+' kJ'],
    ['Kol',S.laps.length],['Nejlepší kolo',best?fmt(best)+' ('+(153.846/best*3.6).toFixed(1)+' km/h)':'–']].map(([a,b])=>'<tr><td>'+a+'</td><td>'+b+'</td></tr>').join('');
  $('summary').classList.remove('hide');}

// obrazovka nezhasne
let wake=null;async function keepAwake(){try{if(navigator.wakeLock&&!wake){wake=await navigator.wakeLock.request('screen');wake.addEventListener('release',()=>wake=null);}}catch(e){}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')keepAwake();});keepAwake();

// ---------- smyčka ----------
V.drawLapBoard(0);refreshButtons();
let last=performance.now();
function loop(now){requestAnimationFrame(loop);let dt=Math.min(0.1,(now-last)/1000);last=now;
  const n=Math.ceil(dt/0.02);for(let i=0;i<n;i++)step(dt/n);
  place(me,S.s,S.w,S.v,dt,meLean);animate(me,dt,S.v,S.power,S.cadence,S.crank);
  if(S.pacerOn){const pv=CFG.pacerKmh/3.6;place(pacer,S.pacerS,pacerW(),pv,dt,pacerLean);S.pacerCrank=(S.pacerCrank||0)+pv*dt/2.1*3.6;animate(pacer,dt,pv,CFG.ftp*0.8,95,S.pacerCrank);}
  cameraUpdate(dt);hud(dt);renderer.render(scene,camera);}
requestAnimationFrame(loop);
$('loading').classList.add('hide');
window.MT={S,CFG,trainer,di2};   // pro ladění v konzoli
})();
