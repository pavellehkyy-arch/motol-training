// Připojení trenažéru přes Web Bluetooth.
// Tacx Neo 2T (a většina chytrých trenažérů) umí FTMS – Fitness Machine Service 0x1826:
//   0x2AD2 Indoor Bike Data      → výkon, kadence, rychlost (notifikace)
//   0x2AD9 Control Point         → převzetí řízení, ERG (cílový výkon), simulace (sklon, odpor vzduchu)
// Když FTMS chybí, spadneme na Cycling Power Service 0x1818 (jen čtení výkonu a kadence).
// Hrudní pás: Heart Rate Service 0x180D.
(function(){
'use strict';

// UUID jako plné řetězce: Bluefy (iPhone) s číselnými aliasy (0x1826) neumí a hází jen holý kód chyby
const u16=n=>'0000'+n.toString(16).padStart(4,'0')+'-0000-1000-8000-00805f9b34fb';
const FTMS_SVC=u16(0x1826),IBD=u16(0x2ad2),CP=u16(0x2ad9),STATUS=u16(0x2ada);
const CPS_SVC=u16(0x1818),CPM=u16(0x2a63);
const HR_SVC=u16(0x180d),HRM=u16(0x2a37);
const DIS_SVC=u16(0x180a),BAT_SVC=u16(0x180f);
// Shimano Di2 (12rychlostní, přehazovačka RD-…): vlastní služba, "SHIMANO_BLE" v ASCII
const shi=n=>'0000'+n.toString(16).padStart(4,'0')+'-5348-494d-414e-4f5f424c4500';
const DI2_SVC=shi(0x18ef),DI2_GEAR=shi(0x2ac1),DI2_BTN=shi(0x2ac2);

// Chyba s označením kroku, ve kterém vznikla. Bluefy občas místo Error vrátí číslo nebo řetězec.
function stepErr(step,e){
  const err=e instanceof Error?e:new Error(e&&e.message!=null?String(e.message):String(e));
  if(!(e instanceof Error)&&e&&e.name)try{Object.defineProperty(err,'name',{value:String(e.name)});}catch(_){}
  if(err.step==null)err.step=step;if(e&&e.code!=null&&err.code==null)err.code=e.code;return err;}
async function at(step,fn){try{return await fn();}catch(e){throw stepErr(step,e);}}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const isCancel=e=>!!e&&(e.name==='NotFoundError'||e.name==='AbortError')&&/cancel|chooser|zru/i.test(e.message||'');
async function gattConnect(device){let last;
  for(let i=0;i<3;i++){try{return await device.gatt.connect();}catch(e){last=e;await wait(600*(i+1));}}
  throw last;}

const OP={REQUEST_CONTROL:0x00,RESET:0x01,TARGET_POWER:0x05,START:0x07,STOP:0x08,SIM:0x11,RESPONSE:0x80};
const RESULT={1:'OK',2:'nepodporováno',3:'špatný parametr',4:'selhalo',5:'řízení nepovoleno'};

function supported(){return !!(navigator.bluetooth&&navigator.bluetooth.requestDevice);}

// --- parsování Indoor Bike Data (FTMS spec 4.9) ---
function parseIndoorBikeData(dv){
  let o=0;const flags=dv.getUint16(o,true);o+=2;const r={};
  if(!(flags&0x0001)){r.speed=dv.getUint16(o,true)/100;o+=2;}   // km/h (bit 0 = "More Data" → rychlost chybí)
  if(flags&0x0002)o+=2;                                          // průměrná rychlost
  if(flags&0x0004){r.cadence=dv.getUint16(o,true)/2;o+=2;}       // ot/min
  if(flags&0x0008)o+=2;                                          // průměrná kadence
  if(flags&0x0010)o+=3;                                          // celková vzdálenost
  if(flags&0x0020)o+=2;                                          // úroveň odporu
  if(flags&0x0040){r.power=dv.getInt16(o,true);o+=2;}            // W
  if(flags&0x0080)o+=2;                                          // průměrný výkon
  if(flags&0x0100)o+=5;                                          // energie
  if(flags&0x0200){r.hr=dv.getUint8(o);o+=1;}                    // tep (když trenažér přeposílá pás)
  return r;}

// --- parsování Cycling Power Measurement (záložní cesta) ---
function makeCpsParser(){let lastRevs=null,lastT=null,lastAt=0;
  return dv=>{let o=0;const flags=dv.getUint16(o,true);o+=2;const r={power:dv.getInt16(o,true)};o+=2;
    if(flags&0x01)o+=1;          // pedal power balance
    if(flags&0x04)o+=2;          // accumulated torque
    if(flags&0x10)o+=6;          // wheel revolution data
    if(flags&0x20){const revs=dv.getUint16(o,true),t=dv.getUint16(o+2,true);o+=4;
      if(lastRevs!=null&&t!==lastT){const dr=(revs-lastRevs+65536)%65536,dt=((t-lastT+65536)%65536)/1024;if(dt>0&&dr<20){r.cadence=dr/dt*60;lastAt=performance.now();}}
      else if(performance.now()-lastAt>3000)r.cadence=0;
      lastRevs=revs;lastT=t;}
    return r;};}

function parseHr(dv){const f=dv.getUint8(0);return f&1?dv.getUint16(1,true):dv.getUint8(1);}

// GATT operace se nesmí překrývat → fronta zápisů
function queue(){let p=Promise.resolve();return fn=>(p=p.then(fn,fn));}

class Trainer{
  constructor(){this.device=null;this.cp=null;this.kind=null;this.controlled=false;this.onData=null;this.onStatus=null;this.onLog=null;
    this._q=queue();this._wantConnected=false;this.wide=false;this._lastSim=null;this._lastErg=null;}
  get name(){return this.device&&this.device.name||'trenažér';}
  status(s){this.onStatus&&this.onStatus(s);}
  log(s){this.onLog&&this.onLog(s);}

  async connect(){
    if(!supported())throw new Error('Tento prohlížeč neumí Web Bluetooth. Použij Chrome na počítači nebo na Androidu (na iPhonu aplikaci Bluefy).');
    if(this.device&&this.device.gatt&&this.device.gatt.connected)try{this.device.gatt.disconnect();}catch(e){}
    this.device=null;
    const optionalServices=[FTMS_SVC,CPS_SVC,HR_SVC,DIS_SVC];
    // Napoprvé filtr podle služeb; když s ním prohlížeč neumí (Bluefy), ukáže všechna zařízení.
    if(!this.wide){
      try{this.device=await navigator.bluetooth.requestDevice({filters:[{services:[FTMS_SVC]},{services:[CPS_SVC]},{namePrefix:'Tacx'}],optionalServices});}
      catch(e){if(isCancel(e))throw stepErr('výběr zařízení',e);
        this.log('Výběr s filtrem selhal ('+((e&&e.message)||e)+'), zobrazuji všechna zařízení…');this.wide=true;}}
    if(this.wide&&!this.device){
      try{this.device=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices});}
      catch(e){if(e&&e.name==='SecurityError')throw stepErr('výběr zařízení',new Error('Ťukni na Připojit znovu, ukážu všechna zařízení.'));
        throw stepErr('výběr zařízení',e);}}
    this.device.addEventListener('gattserverdisconnected',()=>this._onDisconnect());
    this._wantConnected=true;await this._setup();}

  async _setup(){
    this.status('připojuji…');
    const server=await at('spojení s trenažérem',()=>gattConnect(this.device));
    let ftms=null;try{ftms=await server.getPrimaryService(FTMS_SVC);}catch(e){}
    if(ftms){
      this.kind='FTMS';
      const ibd=await at('čtení výkonu (FTMS)',()=>ftms.getCharacteristic(IBD));
      ibd.addEventListener('characteristicvaluechanged',e=>this.onData&&this.onData(parseIndoorBikeData(e.target.value)));
      await at('zapnutí dat (FTMS)',()=>ibd.startNotifications());
      try{
        this.cp=await ftms.getCharacteristic(CP);
        this.cp.addEventListener('characteristicvaluechanged',e=>this._onCpResponse(e.target.value));
        await this.cp.startNotifications();     // odpovědi Control Pointu chodí jako indikace
        await this._write([OP.REQUEST_CONTROL]);
        await this._write([OP.START]);
        this.controlled=true;
      }catch(e){this.cp=null;this.controlled=false;this.log('Řízení odporu se nepodařilo převzít: '+((e&&e.message)||e));}
    }else{
      this.kind='CPS';this.controlled=false;
      const cps=await at('hledání služby výkonu',()=>server.getPrimaryService(CPS_SVC));
      const ch=await at('čtení výkonu (CPS)',()=>cps.getCharacteristic(CPM)),parse=makeCpsParser();
      ch.addEventListener('characteristicvaluechanged',e=>this.onData&&this.onData(parse(e.target.value)));
      await at('zapnutí dat (CPS)',()=>ch.startNotifications());
    }
    this.status('připojeno');
    // po znovupřipojení obnov poslední nastavení odporu
    if(this._lastErg!=null)this.setTargetPower(this._lastErg);else if(this._lastSim)this.setSimulation(this._lastSim);
  }

  _onCpResponse(dv){if(dv.getUint8(0)!==OP.RESPONSE)return;const op=dv.getUint8(1),res=dv.getUint8(2);
    if(res!==1)this.log('Trenažér odmítl příkaz 0x'+op.toString(16)+': '+(RESULT[res]||res));
    if(op===OP.REQUEST_CONTROL&&res!==1)this.controlled=false;}

  _write(bytes){const cp=this.cp;if(!cp)return Promise.resolve();
    return this._q(()=>{const data=new Uint8Array(bytes);return cp.writeValueWithResponse?cp.writeValueWithResponse(data):cp.writeValue(data);});}

  // ERG: trenažér drží cílový výkon bez ohledu na kadenci
  setTargetPower(w){this._lastErg=w;this._lastSim=null;if(!this.controlled)return Promise.resolve();
    const v=Math.round(Math.max(0,Math.min(2000,w)));return this._write([OP.TARGET_POWER,v&0xff,(v>>8)&0xff]).catch(e=>this.log((e&&e.message)||String(e)));}

  // Simulace: trenažér počítá odpor sám ze sklonu, valivého odporu a odporu vzduchu
  // grade v %, crr bezrozměrné (0,0025 = dřevo), cw = ½·ρ·CdA v kg/m, wind v m/s
  setSimulation(p){this._lastSim=p;this._lastErg=null;if(!this.controlled)return Promise.resolve();
    const wind=Math.round((p.wind||0)*1000),grade=Math.round((p.grade||0)*100),crr=Math.round((p.crr||0.0025)*10000),cw=Math.round((p.cw||0.15)*100);
    const i16=v=>{v=Math.max(-32768,Math.min(32767,v));return [v&0xff,(v>>8)&0xff];};
    return this._write([OP.SIM,...i16(wind),...i16(grade),Math.max(0,Math.min(255,crr)),Math.max(0,Math.min(255,cw))]).catch(e=>this.log((e&&e.message)||String(e)));}

  async _onDisconnect(){this.cp=null;this.controlled=false;if(!this._wantConnected){this.status('odpojeno');return;}
    this.status('spojení ztraceno, zkouším znovu…');
    for(let i=0;i<5&&this._wantConnected;i++){await new Promise(r=>setTimeout(r,1500*(i+1)));
      try{await this._setup();return;}catch(e){this.log('Pokus '+(i+1)+': '+((e&&e.message)||e));}}
    this.status('odpojeno');}

  disconnect(){this._wantConnected=false;try{if(this.controlled)this._write([OP.STOP,0x01]);}catch(e){}
    if(this.device&&this.device.gatt.connected)this.device.gatt.disconnect();}
}

class HeartRate{
  constructor(){this.device=null;this.onHr=null;this.onStatus=null;}
  async connect(){
    if(!supported())throw new Error('Tento prohlížeč neumí Web Bluetooth.');
    this.device=await at('výběr pásu',()=>navigator.bluetooth.requestDevice({filters:[{services:[HR_SVC]}]}));
    this.device.addEventListener('gattserverdisconnected',()=>this.onStatus&&this.onStatus('odpojeno'));
    const s=await at('spojení s pásem',()=>gattConnect(this.device));
    const svc=await at('hledání služby tepu',()=>s.getPrimaryService(HR_SVC)),ch=await at('čtení tepu',()=>svc.getCharacteristic(HRM));
    ch.addEventListener('characteristicvaluechanged',e=>this.onHr&&this.onHr(parseHr(e.target.value)));
    await at('zapnutí tepu',()=>ch.startNotifications());this.onStatus&&this.onStatus('připojeno');}
  disconnect(){if(this.device&&this.device.gatt.connected)this.device.gatt.disconnect();}
}

// Páčky Di2: tlačítka D-FLY chodí jako indikace 0x2AC2: [počítadlo, kanál 1, kanál 2, kanál 3, kanál 4].
// Bajt kanálu: horní půlbajt = akce (1 krátký stisk, 2 dlouhý stisk, 3 drží dál, 0 puštěno), dolní = počítadlo stisků; 0xF0 = kanál nic neposlal.
// Přehazování chodí v 0x2AC1 (typ 0x00): bajt 3 = převodník, bajt 5 = pastorek, bajt 6 = počet pastorků.
function parseDi2Buttons(dv,prev){const out=[];
  for(let ch=1;ch<=4&&ch<dv.byteLength;ch++){const b=dv.getUint8(ch);if(b===0xf0||b===prev[ch])continue;
    prev[ch]=b;const a=b>>4;out.push({ch,action:a===1?'short':a===2?'long':a===3?'hold':'release'});}
  return out;}
function parseDi2Gear(dv){if(dv.byteLength<7||dv.getUint8(0)!==0x00)return null;
  return {front:dv.getUint8(3),rear:dv.getUint8(5),rears:dv.getUint8(6)};}

class Di2{
  constructor(){this.device=null;this.onButton=null;this.onGear=null;this.onStatus=null;this.onLog=null;this._prev=[];this._want=false;this.wide=false;}
  get name(){return this.device&&this.device.name||'Di2';}
  status(s){this.onStatus&&this.onStatus(s);}
  async connect(){
    if(!supported())throw new Error('Tento prohlížeč neumí Web Bluetooth.');
    if(this.device&&this.device.gatt&&this.device.gatt.connected)try{this.device.gatt.disconnect();}catch(e){}
    this.device=null;const optionalServices=[DI2_SVC,BAT_SVC,DIS_SVC];
    if(!this.wide){
      try{this.device=await navigator.bluetooth.requestDevice({filters:[{namePrefix:'RD'},{services:[DI2_SVC]}],optionalServices});}
      catch(e){if(isCancel(e))throw stepErr('výběr Di2',e);this.wide=true;}}
    if(!this.device){
      try{this.device=await navigator.bluetooth.requestDevice({acceptAllDevices:true,optionalServices});}
      catch(e){if(e&&e.name==='SecurityError')throw stepErr('výběr Di2',new Error('Ťukni na Připojit znovu, ukážu všechna zařízení.'));throw stepErr('výběr Di2',e);}}
    this.device.addEventListener('gattserverdisconnected',()=>this._onDisconnect());
    this._want=true;await this._setup();}
  async _setup(){
    this.status('připojuji…');this._prev=[];
    const server=await at('spojení s Di2',()=>gattConnect(this.device));
    const svc=await at('služba Shimano',()=>server.getPrimaryService(DI2_SVC));
    const btn=await at('tlačítka Di2',()=>svc.getCharacteristic(DI2_BTN));
    btn.addEventListener('characteristicvaluechanged',e=>{for(const ev of parseDi2Buttons(e.target.value,this._prev))this.onButton&&this.onButton(ev);});
    await at('zapnutí tlačítek',()=>btn.startNotifications());
    try{const g=await svc.getCharacteristic(DI2_GEAR);
      g.addEventListener('characteristicvaluechanged',e=>{const r=parseDi2Gear(e.target.value);if(r&&this.onGear)this.onGear(r);});
      await g.startNotifications();}catch(e){}
    this.status('připojeno');}
  async _onDisconnect(){if(!this._want){this.status('odpojeno');return;}
    this.status('spojení ztraceno, zkouším znovu…');
    for(let i=0;i<5&&this._want;i++){await wait(1500*(i+1));try{await this._setup();return;}catch(e){}}
    this.status('odpojeno');}
  disconnect(){this._want=false;if(this.device&&this.device.gatt.connected)this.device.gatt.disconnect();}
}

window.BLE={supported,Trainer,HeartRate,Di2,parseDi2Buttons,parseDi2Gear,parseIndoorBikeData,makeCpsParser,parseHr};
})();
