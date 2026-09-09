/* =========================================================
   FIREBASE CONFIG (ABILITATA!)
========================================================= */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCfhxHKn73vdmhX7PwGrb8U8A4_BxMWtzs",
  authDomain: "nellokpi.firebaseapp.com",
  projectId: "nellokpi",
  appId: "1:425810563891:web:16dd27d8ecd8dd06c02446"
};

let firebaseEnabled = false;
let auth = null;
let db = null;

function initFirebase(){
  try{
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.firestore();
    firebaseEnabled = true;
  }catch(e){
    firebaseEnabled = false;
    db = null;
    console.error("Firebase init error:", e);
  }
}
initFirebase();

/* =========================================================
   STORAGE
========================================================= */
const APP_KEY_BASE = "nello_kpi_clean_step_v3_";
const MONTHS_IT = {"01":"Gennaio","02":"Febbraio","03":"Marzo","04":"Aprile","05":"Maggio","06":"Giugno","07":"Luglio","08":"Agosto","09":"Settembre","10":"Ottobre","11":"Novembre","12":"Dicembre"};
const weeks = [1,2,3,4,5];

function pad2(n){ return String(n).padStart(2,"0"); }
function nowYear(){ return String(new Date().getFullYear()); }
function nowMonth(){ return pad2(new Date().getMonth()+1); }

function defaultChannel(){
  return {
    target: 86,
    // overridePercent: if set (0..1), Stats can show a stored final KPI even without counts
    overridePercent: null,
    mode: "monthly",
    monthly: { yes:0, no:0, rec:0 },
    weeks: Array.from({length:5}, ()=>({yes:0,no:0,rec:0}))
  };
}
function defaultMonth(){
  return { channels: { phone: defaultChannel(), chat: defaultChannel() } };
}
function defaultYear(){ return { months:{} }; }
function defaultData(){
  const y=nowYear(), m=nowMonth();
  const d={ years:{} };
  d.years[y]=defaultYear();
  d.years[y].months[m]=defaultMonth();
  return d;
}

let currentUser = { uid:"guest", name:"Guest" };
let DATA = defaultData();

function storeKey(){ return APP_KEY_BASE + (currentUser?.uid || "guest"); }

function isAuthed(){ return firebaseEnabled && !!db && currentUser && currentUser.uid && currentUser.uid !== "guest"; }
function userDocRef(){ return db.collection("users").doc(currentUser.uid); }

function sanitizeData(obj){
  // Ensure minimum structure; fall back safely
  try{
    if(!obj || typeof obj !== "object") return defaultData();
    if(!obj.years || typeof obj.years !== "object") return defaultData();
    return obj;
  }catch(e){ return defaultData(); }
}

let cloudHydrated = false;
let cloudBaseUpdatedAtMs = null;
let cloudBaseData = null;
let cloudWriteInFlight = false;
function dataFingerprint(value){
  return JSON.stringify(value, (_key, item)=>{
    if(item && typeof item === "object" && !Array.isArray(item)){
      return Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]]));
    }
    return item;
  });
}
function pendingKey(){ return storeKey() + "_pending"; }
function hasPendingData(){ return localStorage.getItem(pendingKey()) !== null; }
function readRecoveryCopies(){
  try{ return JSON.parse(localStorage.getItem(storeKey()+"_backups") || "[]"); }
  catch(e){ return []; }
}
function preserveRecoveryCopy(data, label){
  if(!data?.years) return;
  const copies = readRecoveryCopies();
  if(copies[0] && dataFingerprint(copies[0].data) === dataFingerprint(data)) return;
  copies.unshift({at:new Date().toISOString(),label,data});
  // Separate key: recovery never replaces the active data or pending changes.
  localStorage.setItem(storeKey()+"_backups",JSON.stringify(copies.slice(0,12)));
}

async function loadCloudData(){
  if(!isAuthed()) return { found:false };
  try{
    const snap = await userDocRef().get({ source:"server" });
    if(snap.exists){
      const d = snap.data();
      if(d?.data?.years && typeof d.data.years === "object"){
        return {
          found:true,
          data:sanitizeData(d.data),
          updatedAtMs:d.updatedAt?.toMillis?.() ?? null
        };
      }
      throw new Error("INVALID_CLOUD_DATA");
    }
    return { found:false };
  }catch(e){
    console.warn("Cloud load failed:", e);
    return { found:false, error:e };
  }
}

let cloudSaveTimer = null;
let saveStateTimer = null;
function setSaveState(label, state=""){
  const el = document.getElementById("saveState");
  if(!el) return;
  el.textContent = label;
  el.className = `saveState ${state}`.trim();
  if(retrySyncBtn) retrySyncBtn.classList.toggle("hidden", state!=="error");
}
function scheduleCloudSave(){
  if(!isAuthed() || !cloudHydrated) return;
  clearTimeout(cloudSaveTimer);
  setSaveState("Sincronizzazione…", "saving");
  cloudSaveTimer = setTimeout(()=>{ saveCloudNow(); }, 800);
}

async function saveCloudNow(){
  if(!isAuthed() || !cloudHydrated) return;
  if(cloudWriteInFlight){ scheduleCloudSave(); return; }
  cloudWriteInFlight = true;
  const savingUid = currentUser.uid;
  const savingKey = storeKey();
  const snapshot = JSON.parse(JSON.stringify(DATA));
  const expectedData = cloudBaseData;
  try{
    const ref = userDocRef();
    await db.runTransaction(async transaction=>{
      const snap = await transaction.get(ref);
      const previous = snap.exists ? snap.data() : null;
      if(dataFingerprint(previous?.data ?? null) !== expectedData){
        throw new Error("REMOTE_DATA_CHANGED");
      }
      const payload = {
        schema: 2,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        data: snapshot
      };
      if(previous?.data){
        payload.previousData = previous.data;
        payload.previousUpdatedAt = previous.updatedAt || null;
      }
      transaction.set(ref, payload, { mergeFields:Object.keys(payload) });
    });
    if(currentUser.uid !== savingUid) return;
    cloudBaseData = dataFingerprint(snapshot);
    if(dataFingerprint(DATA) !== cloudBaseData){
      localStorage.setItem(savingKey + "_pending", JSON.stringify({ base:cloudBaseData }));
      scheduleCloudSave();
      return;
    }
    localStorage.removeItem(savingKey + "_pending");
    setSaveState("Sincronizzato", "saved");
  }catch(e){
    if(currentUser.uid !== savingUid) return;
    console.warn("Cloud save failed:", e);
    setSaveState(e?.message === "REMOTE_DATA_CHANGED" ? "Dati aggiornati altrove: ricarica" : "Errore sincronizzazione", "error");
  }finally{
    cloudWriteInFlight = false;
  }
}

window.addEventListener("online", ()=>{ if(isAuthed()) syncFromCloud(); });
window.addEventListener("offline", ()=>setSaveState("Salvato offline", "saving"));

async function syncFromCloud(){
  if(!isAuthed()) return;
  const syncingUid = currentUser.uid;
  cloudHydrated = false;
  setSaveState("Sincronizzazione…", "saving");
  const cloud = await loadCloudData();
  if(currentUser.uid !== syncingUid) return;
  if(cloud.error){
    setSaveState("Errore caricamento dati", "error");
    return;
  }
  const remoteData = dataFingerprint(cloud.found ? cloud.data : null);
  if(hasPendingData()){
    let pending;
    try{ pending = JSON.parse(localStorage.getItem(pendingKey())); }catch(e){}
    if(!pending || pending.base !== remoteData){
      setSaveState("Conflitto: copia locale conservata", "error");
      return;
    }
    cloudBaseData = remoteData;
    cloudHydrated = true;
    await saveCloudNow();
    return;
  }
  cloudBaseData = remoteData;
  if(cloud.found){
    preserveRecoveryCopy(DATA,"Prima del caricamento cloud");
    DATA = cloud.data;
    cloudBaseUpdatedAtMs = cloud.updatedAtMs;
    // persist locally for offline use
    try{ localStorage.setItem(storeKey(), JSON.stringify(DATA)); }catch(e){}
  }else{
    // Il documento e' certamente assente: solo ora crea la prima copia cloud.
    cloudBaseUpdatedAtMs = null;
    cloudHydrated = true;
    await saveCloudNow();
    return;
  }
  cloudHydrated = true;
  rebuildYearMonthSelectors();
  resetSteps();
  updateMiniKpi();
  renderStats();
  setSaveState("Sincronizzato", "saved");
}


function loadData(){
  const raw = localStorage.getItem(storeKey());
  if(!raw){
    DATA = defaultData();
    if(!isAuthed()) saveData();
    return;
  }
  try{
    DATA = JSON.parse(raw);
    if(!DATA.years) throw new Error("bad");
  }catch(e){
    DATA = defaultData();
    if(!isAuthed()) saveData();
  }
}
function saveData(){
  const before = localStorage.getItem(storeKey());
  if(before){
    try{ preserveRecoveryCopy(JSON.parse(before),"Prima della modifica"); }
    catch(e){ setSaveState("Spazio insufficiente per il backup", "error"); return; }
  }
  if(isAuthed() && !hasPendingData()){
    localStorage.setItem(pendingKey(), JSON.stringify({ base:cloudBaseData }));
  }
  localStorage.setItem(storeKey(), JSON.stringify(DATA));
  if(isAuthed()){
    if(cloudHydrated) scheduleCloudSave();
    else setSaveState("Caricamento dati...", "saving");
  }
  else{
    setSaveState("Salvato", "saved");
    clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(()=>setSaveState("Sul dispositivo"), 1600);
  }
}

function ensurePath(year, month){
  if(!DATA.years) DATA.years = {};
  if(!DATA.years[year]) DATA.years[year] = defaultYear();
  if(!DATA.years[year].months) DATA.years[year].months = {};
  if(!DATA.years[year].months[month]) DATA.years[year].months[month] = defaultMonth();
  const mObj = DATA.years[year].months[month];
  if(!mObj.channels) mObj.channels = { phone: defaultChannel(), chat: defaultChannel() };
  if(!mObj.channels.phone) mObj.channels.phone = defaultChannel();
  if(!mObj.channels.chat) mObj.channels.chat = defaultChannel();
  // Back-compat for older saved data
  if(mObj.channels.phone.overridePercent === undefined) mObj.channels.phone.overridePercent = null;
  if(mObj.channels.chat.overridePercent === undefined) mObj.channels.chat.overridePercent = null;
  return mObj;
}
function getChannelObj(year, month, ch){
  const mObj = ensurePath(year, month);
  return mObj.channels[ch];
}

/* =========================================================
   UI refs
========================================================= */
const yearSelect = document.getElementById("yearSelect");
const monthSelect = document.getElementById("monthSelect");
const tabInput = document.getElementById("tabInput");
const tabStats = document.getElementById("tabStats");
const viewInput = document.getElementById("viewInput");
const viewStats = document.getElementById("viewStats");

const loginBtn = document.getElementById("loginBtn");
const userLine = document.getElementById("userLine");
const statsUser = document.getElementById("statsUser");

const miniLabel = document.getElementById("miniLabel");
const miniKpi = document.getElementById("miniKpi");

const avatarImg = document.getElementById("avatarImg");

const btnPhone = document.getElementById("btnPhone");
const btnChat  = document.getElementById("btnChat");

const stepMode = document.getElementById("stepMode");
const btnMonthly = document.getElementById("btnMonthly");
const btnWeekly  = document.getElementById("btnWeekly");

const monthlySection = document.getElementById("monthlySection");
const weeklySection  = document.getElementById("weeklySection");

const m_yes = document.getElementById("m_yes");
const m_no  = document.getElementById("m_no");
const m_rec = document.getElementById("m_rec");
const inputValidation = document.getElementById("inputValidation");
const weeklyValidation = document.getElementById("weeklyValidation");

function wEl(w,k){ return document.getElementById(`w${w}_${k}`); }
// wBtn helper removed during cleanup.

const weeklyAccordion = document.getElementById("weeklyAccordion");
const accHead = document.getElementById("accHead");
const accChevron = document.getElementById("accChevron");

const calcBtn = document.getElementById("calcBtn");
const resultBox = document.getElementById("resultBox");
const resultMeta = document.getElementById("resultMeta");

const percentEl = document.getElementById("percent");
const messageEl = document.getElementById("message");
const barFill = document.getElementById("barFill");
const barText = document.getElementById("barText");
const kpisEl = document.getElementById("kpis");

const shareTextBtn = document.getElementById("shareTextBtn");
const shareImgBtn  = document.getElementById("shareImgBtn");

const statsChannel = document.getElementById("statsChannel");
const statsYear = document.getElementById("statsYear");
const statsGrid = document.getElementById("statsGrid");

const addHistoryBtn = document.getElementById("addHistoryBtn");

// History/backfill modal refs
const historyOverlay = document.getElementById("historyOverlay");
const histYear = document.getElementById("histYear");
const histMonth = document.getElementById("histMonth");
const histChannel = document.getElementById("histChannel");
const histTarget = document.getElementById("histTarget");
const histType = document.getElementById("histType");
const histCounts = document.getElementById("histCounts");
const histWeekly = document.getElementById("histWeekly");
const histPercentWrap = document.getElementById("histPercentWrap");
const histYes = document.getElementById("histYes");
const histNo = document.getElementById("histNo");
const histRec = document.getElementById("histRec");

const histW1Yes = document.getElementById("histW1Yes");
const histW1No  = document.getElementById("histW1No");
const histW1Rec = document.getElementById("histW1Rec");
const histW2Yes = document.getElementById("histW2Yes");
const histW2No  = document.getElementById("histW2No");
const histW2Rec = document.getElementById("histW2Rec");
const histW3Yes = document.getElementById("histW3Yes");
const histW3No  = document.getElementById("histW3No");
const histW3Rec = document.getElementById("histW3Rec");
const histW4Yes = document.getElementById("histW4Yes");
const histW4No  = document.getElementById("histW4No");
const histW4Rec = document.getElementById("histW4Rec");
const histW5Yes = document.getElementById("histW5Yes");
const histW5No  = document.getElementById("histW5No");
const histW5Rec = document.getElementById("histW5Rec");

const histPercent = document.getElementById("histPercent");
const histSave = document.getElementById("histSave");
const histCancel = document.getElementById("histCancel");
const histError = document.getElementById("histError");


const modalOverlay = document.getElementById("modalOverlay");
const btnCloseModal = document.getElementById("btnCloseModal");

const loginError = document.getElementById("loginError");

const emailInput = document.getElementById("emailInput");
const passInput  = document.getElementById("passInput");
const installAppBtn = document.getElementById("installAppBtn");
const retrySyncBtn = document.getElementById("retrySyncBtn");
if(retrySyncBtn) retrySyncBtn.addEventListener("click", ()=>cloudHydrated ? saveCloudNow() : syncFromCloud());
const targetPill = document.getElementById("targetPill");
const inlineTarget = document.getElementById("inlineTarget");
const inlineTargetWrap = document.getElementById("inlineTargetWrap");
const inlineTargetOk = document.getElementById("inlineTargetOk");


const sectionCanale = document.getElementById("sectionCanale");
const resetMonthlyBtn = document.getElementById("resetMonthlyBtn");
const sumWeeksToMonthBtn = document.getElementById("sumWeeksToMonthBtn");

/* =========================================================
   State
========================================================= */
let selectedYear = nowYear();
let selectedMonth = nowMonth();
let channel = null;     // "phone" | "chat"
let mode = null;        // "monthly" | "weekly"

let soundOn = false;
let hapticOn = true;
let lastAuthUid = null; // used to detect fresh login to show welcome toast

/* =========================================================
   PWA / INSTALLAZIONE
========================================================= */
let deferredInstallPrompt = null;
const isStandalone = ()=>window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone===true;
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

function setInstallButtonVisibility(visible){
  if(!installAppBtn) return;
  installAppBtn.classList.toggle("hidden", !visible || isStandalone());
}

window.addEventListener("beforeinstallprompt", event=>{
  event.preventDefault();
  deferredInstallPrompt = event;
  setInstallButtonVisibility(true);
});

window.addEventListener("appinstalled", ()=>{
  deferredInstallPrompt = null;
  setInstallButtonVisibility(false);
  showWelcome("Nello KPI è stata installata", true);
});

if(installAppBtn){
  if(isIos && !isStandalone()) setInstallButtonVisibility(true);
  installAppBtn.addEventListener("click", async ()=>{
    if(deferredInstallPrompt){
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if(choice.outcome==="accepted") setInstallButtonVisibility(false);
      deferredInstallPrompt = null;
      return;
    }
    if(isIos){
      alert("Per installare Nello KPI: tocca Condividi in Safari, poi ‘Aggiungi alla schermata Home’.");
      return;
    }
    alert("Apri il menu del browser e scegli ‘Installa app’ o ‘Aggiungi alla schermata Home’.");
  });
}

if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("./sw.js").catch(error=>console.warn("Service worker non registrato:",error));
  });
}

/* =========================================================
   Math
========================================================= */
function clampInt(n){ if(!Number.isFinite(n)||n<0) return 0; return Math.floor(n); }
function clampNum(n,min,max){ if(!Number.isFinite(n)) return min; return Math.min(max, Math.max(min,n)); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
const {ratio,neededYes,neededNoToYes,validateCounts}=NelloKpiMath;
function getCurrentTargetPct(){
  if(channel){
    const stored = Number(getChannelObj(selectedYear, selectedMonth, channel).target);
    if(Number.isFinite(stored)) return clampNum(stored,0,100);
  }
  const visibleValue = Number(inlineTarget?.value);
  return Number.isFinite(visibleValue) ? clampNum(visibleValue,0,100) : 86;
}

/* =========================================================
   FX / sound
========================================================= */
let audioCtx=null;
function ensureAudio(){
  if(!soundOn) return null;
  if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==="suspended") audioCtx.resume();
  return audioCtx;
}
function beep({freq=440,dur=0.06,type="sine",gain=0.05,slideTo=null}={}){
  const ctx=ensureAudio(); if(!ctx) return;
  const o=ctx.createOscillator(), g=ctx.createGain();
  o.type=type; o.frequency.setValueAtTime(freq, ctx.currentTime);
  if(slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime+dur);
  g.gain.setValueAtTime(0.0001, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime+0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(); o.stop(ctx.currentTime+dur+0.02);
}
function tick(){
  // Soft, sweet key press: gentle sine with slow-ish decay and lowpass for warmth
  const ctx = ensureAudio(); if(!ctx) return;
  const now = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(860, now); o.frequency.exponentialRampToValueAtTime(680, now + 0.18);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.035, now+0.02); g.gain.exponentialRampToValueAtTime(0.0001, now+0.42);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(3000, now);
  o.connect(g); g.connect(f); f.connect(ctx.destination);
  o.start(now); o.stop(now + 0.44);
}

// Ambient: ensure masterFilter outputs to destination (fix silence issues)
// keep global refs for pad oscillators so we can stop them when stopping ambient
let ambientPad1 = null; let ambientPad2 = null;
function win(){
  beep({freq:523.25,dur:0.08,type:"triangle",gain:0.06});
  setTimeout(()=>beep({freq:659.25,dur:0.08,type:"triangle",gain:0.05}),70);
  setTimeout(()=>beep({freq:783.99,dur:0.10,type:"triangle",gain:0.05}),140);
}
function fail(){ beep({freq:220,dur:0.10,type:"sawtooth",gain:0.05,slideTo:140}); }

// Ambient 'midi-like' background synth + analyser to drive UI colors and background
let ambientCtx = null;
let ambientRunning = false;
let ambientInterval = null;
let ambientAnalyzer = null;
let ambientGain = null;
function startAmbient(){
  if(ambientRunning) return;
  try{
    ambientCtx = new (window.AudioContext || window.webkitAudioContext)();
    ambientGain = ambientCtx.createGain(); ambientGain.gain.value = 0.0001;
    const masterFilter = ambientCtx.createBiquadFilter(); masterFilter.type = 'lowpass'; masterFilter.frequency.value = 1800;
    ambientAnalyzer = ambientCtx.createAnalyser(); ambientAnalyzer.fftSize = 256;
    // route: ambientGain -> masterFilter -> destination, plus analyser taps
    ambientGain.connect(masterFilter); masterFilter.connect(ambientCtx.destination); masterFilter.connect(ambientAnalyzer);

    // gentle evolving pad: two detuned oscillators (keep refs)
    ambientPad1 = ambientCtx.createOscillator(); ambientPad1.type = 'sine'; ambientPad1.frequency.value = 220;
    ambientPad2 = ambientCtx.createOscillator(); ambientPad2.type = 'sine'; ambientPad2.frequency.value = 220 * 1.01;
    const padGain = ambientCtx.createGain(); padGain.gain.value = 0.02;
    ambientPad1.connect(padGain); ambientPad2.connect(padGain); padGain.connect(ambientGain);
    ambientPad1.start(); ambientPad2.start();

    // plinking melody scheduled with setInterval
    const pattern = [0,3,7,10,12,10,7,3]; // scale steps from base
    const base = 220;
    ambientInterval = setInterval(()=>{
      const t = ambientCtx.currentTime;
      ambientGain.gain.cancelScheduledValues(t);
      ambientGain.gain.setValueAtTime(0.0001, t);
      ambientGain.gain.exponentialRampToValueAtTime(0.08, t+0.03);
      ambientGain.gain.exponentialRampToValueAtTime(0.0001, t+1.2);

      // play a couple of bell-like partials
      const step = pattern[Math.floor(Math.random()*pattern.length)];
      const freq = base * Math.pow(2, step/12);
      const bell = ambientCtx.createOscillator(); bell.type = 'triangle'; bell.frequency.value = freq;
      const bellGain = ambientCtx.createGain(); bellGain.gain.value = 0.0001;
      bellGain.gain.exponentialRampToValueAtTime(0.06, t+0.01);
      bellGain.gain.exponentialRampToValueAtTime(0.0001, t+1.0);
      const bFilter = ambientCtx.createBiquadFilter(); bFilter.type='highshelf'; bFilter.frequency.value = 1200; bFilter.gain.value = 4;
      bell.connect(bellGain); bellGain.connect(bFilter); bFilter.connect(ambientGain);
      bell.start(t); bell.stop(t+1.05);
    }, 700);

    // fade ambient in
    ambientGain.gain.linearRampToValueAtTime(0.03, ambientCtx.currentTime + 0.6);
    ambientRunning = true;

    // start visual analyser loop
    runAmbientVisualLoop();
  }catch(e){
    console.warn('Ambient start error', e);
  }
}
function stopAmbient(){
  if(!ambientRunning) return;
  try{
    clearInterval(ambientInterval); ambientInterval = null;
    if(ambientPad1){ try{ ambientPad1.stop(); }catch(e){} ambientPad1.disconnect(); ambientPad1 = null; }
    if(ambientPad2){ try{ ambientPad2.stop(); }catch(e){} ambientPad2.disconnect(); ambientPad2 = null; }
    if(ambientCtx){ ambientCtx.close(); }
  }catch(e){}
  ambientCtx = null; ambientRunning = false;
}

function runAmbientVisualLoop(){
  if(!ambientAnalyzer) return;
  const data = new Uint8Array(ambientAnalyzer.frequencyBinCount);
  function step(){
    if(!ambientAnalyzer) return;
    ambientAnalyzer.getByteFrequencyData(data);
    let sum = 0; for(let i=0;i<data.length;i++){ sum += data[i]; }
    const avg = sum / data.length / 255; // 0..1
    // map avg to hue change and background positions
    const baseHue = 200; // calm base
    const hue = Math.round(baseHue + (avg * 120) - 30);
    const bg1x = 10 + Math.round(avg * 20);
    const bg2x = 90 - Math.round(avg * 18);
    document.documentElement.style.setProperty('--accent-h', String(hue));
    document.documentElement.style.setProperty('--bg1-x', bg1x + '%');
    document.documentElement.style.setProperty('--bg2-x', bg2x + '%');

    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Show a small live badge and glow when results update live
function showLiveResultPulse(){
  try{
    const b = document.getElementById('liveBadge');
    if(!b) return;
    const box = document.getElementById('resultBox');
    if(!box) return;
    b.classList.add('show');
    box.classList.add('liveShow');
    // remove after a short while
    setTimeout(()=>{ b.classList.remove('show'); box.classList.remove('liveShow'); }, 700);
  }catch(e){ console.warn(e); }
}

// Play sims-like sound for every button click (respecting data-no-sound and avoiding rapid duplicates)
document.addEventListener('click', (e)=>{
  const b = e.target.closest('button'); if(!b) return; if(b.hasAttribute('data-no-sound')) return;
  const t = Date.now(); if(b._lastSnd && (t - b._lastSnd) < 50) return; b._lastSnd = t; tick();
});

// Effetto puntatore disattivato: interfaccia più calma e leggera su mobile.
(function(){
  const trailEnabled=false;
  if(!trailEnabled) return;
  try{
    if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  }catch(e){}
  const layer = document.getElementById('trailLayer'); if(!layer) return;
  let raf=false;
  function spawn(x,y,pressure=0.8){
    const el = document.createElement('div'); el.className='trail';
    const size = 10 + Math.min(36, Math.round(28 * (pressure || 0.8)));
    el.style.width = size + 'px'; el.style.height = size + 'px';
    el.style.left = x + 'px'; el.style.top = y + 'px';
    layer.appendChild(el);
    el.addEventListener('animationend', ()=>{ if(el.parentNode) el.remove(); });
    setTimeout(()=>{ if(el.parentNode) el.remove(); },900);
  }
  document.addEventListener('pointermove', (ev)=>{
    if(raf) return; raf=true; requestAnimationFrame(()=>{ spawn(ev.clientX, ev.clientY, ev.pressure || 0.8); raf=false; });
  }, {passive:true});
  document.addEventListener('touchmove', (ev)=>{ for(const t of ev.touches) spawn(t.clientX, t.clientY, t.force || 0.9); }, {passive:true});
})();

const myConfetti = (typeof confetti !== "undefined")
  ? confetti.create(document.getElementById("confettiCanvas"), { resize:true, useWorker:true })
  : null;
function celebrate(){
  resultBox.classList.add("pulse");
  setTimeout(()=>resultBox.classList.remove("pulse"),450);
  if(myConfetti){
    myConfetti({ particleCount: 120, spread: 80, origin: { y: 0.62 } });
    setTimeout(()=>myConfetti({ particleCount: 70, spread: 110, origin: { y: 0.42 } }),140);
  }
  if(hapticOn && navigator.vibrate) navigator.vibrate([60,40,80,40,120]);
  win();
}
function warn(){
  resultBox.classList.add("shake");
  setTimeout(()=>resultBox.classList.remove("shake"),250);
  if(hapticOn && navigator.vibrate) navigator.vibrate([30,20,30]);
  fail();
}

/* =========================================================
   Tabs
========================================================= */
function setTab(name){
  tabInput.classList.toggle("active", name==="input");
  tabStats.classList.toggle("active", name==="stats");
  if(tabInput) tabInput.setAttribute('aria-pressed', name==='input' ? 'true' : 'false');
  if(tabStats) tabStats.setAttribute('aria-pressed', name==='stats' ? 'true' : 'false');
  viewInput.classList.toggle("hidden", name!=="input");
  viewStats.classList.toggle("hidden", name!=="stats");
  const toolbarEl = document.querySelector('.toolbar'); if(toolbarEl) toolbarEl.style.display = '';
  if(name==="stats") renderStats();
  if(name==="input"){
    if(sectionCanale) sectionCanale.classList.remove('hidden');
    const choiceEl=document.querySelector('#sectionCanale .choiceRow');
    if(choiceEl) choiceEl.style.display='';
  }
  updateMobileDock(name);
}
tabInput.addEventListener("click", ()=>{ tick(); setTab("input"); });
tabStats.addEventListener("click", ()=>{ tick(); setTab("stats"); });

function updateMobileDock(active){
  document.querySelectorAll("[data-mobile-view]").forEach(button=>button.classList.toggle("active",button.dataset.mobileView===active));
}
const mobileDockEl=document.querySelector(".mobileDock");
const mobileDockQuery=window.matchMedia("(max-width: 600px)");
function syncMobileDockVisibility(){
  if(mobileDockEl) mobileDockEl.classList.toggle("hidden",!mobileDockQuery.matches);
  const height=mobileDockQuery.matches && mobileDockEl ? Math.ceil(mobileDockEl.getBoundingClientRect().height) : 0;
  document.documentElement.style.setProperty("--mobile-dock-height",`${height}px`);
}
syncMobileDockVisibility();
mobileDockQuery.addEventListener?.("change",syncMobileDockVisibility);
if(mobileDockEl && typeof ResizeObserver!=="undefined"){
  new ResizeObserver(syncMobileDockVisibility).observe(mobileDockEl);
}
document.querySelectorAll("[data-mobile-view]").forEach(button=>{
  button.addEventListener("click", ()=>{
    const view=button.dataset.mobileView;
    if(view==="input" || view==="stats"){
      setTab(view);
      window.scrollTo({top:0,behavior:"smooth"});
    }else if(view==="history"){
      setTab("stats");
      updateMobileDock("history");
      setTimeout(()=>document.querySelector(".monthList,.emptyState")?.scrollIntoView({behavior:"smooth",block:"start"}),50);
    }else if(view==="profile"){
      updateMobileDock("profile");
      showModal();
    }
  });
});

// Initialize accessible pressed states for buttons and add transient press feedback
(function(){
  try{ if(tabInput) tabInput.setAttribute('aria-pressed', 'true'); if(tabStats) tabStats.setAttribute('aria-pressed','false'); }catch(e){}
  // ensure channel/mode buttons have a default aria-pressed
  try{ if(btnPhone) btnPhone.setAttribute('aria-pressed','false'); if(btnChat) btnChat.setAttribute('aria-pressed','false'); if(btnMonthly) btnMonthly.setAttribute('aria-pressed','false'); if(btnWeekly) btnWeekly.setAttribute('aria-pressed','false'); }catch(e){}

  // transient visual feedback for regular buttons
  document.addEventListener('click', (ev)=>{
    const b = ev.target.closest('button');
    if(!b) return;
    // don't override persistent toggles (they manage aria-pressed themselves)
    if(b === btnPhone || b === btnChat || b === btnMonthly || b === btnWeekly || b === tabInput || b === tabStats) return;
    b.classList.add('pressed'); setTimeout(()=>b.classList.remove('pressed'),180);
  });
})();



/* =========================================================
   Year/Month
========================================================= */
function rebuildYearMonthSelectors(){
  // Ensure a full range from 2017 to 2030 plus any existing years stored in DATA
  const stored = Object.keys(DATA.years||{});
  const minY = 2017, maxY = 2030;
  const range = Array.from({length:(maxY-minY+1)}, (_,i)=>String(minY+i));
  const yearsSet = new Set([...range, ...stored]);
  const years = Array.from(yearsSet).sort();
  const yNow = nowYear();
  if(!years.includes(yNow)) years.push(yNow);
  years.sort();

  yearSelect.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join("");
  if(!years.includes(selectedYear)) selectedYear = yNow;
  yearSelect.value = selectedYear;

  const months = ["01","02","03","04","05","06","07","08","09","10","11","12"];
  monthSelect.innerHTML = months.map(m=>`<option value="${m}">${MONTHS_IT[m]}</option>`).join("");
  if(!months.includes(selectedMonth)) selectedMonth = nowMonth();
  monthSelect.value = selectedMonth;

  ensurePath(selectedYear, selectedMonth);
}
yearSelect.addEventListener("change", ()=>{
  selectedYear = yearSelect.value;
  ensurePath(selectedYear, selectedMonth);
  resetSteps();
  updateMiniKpi();
});
monthSelect.addEventListener("change", ()=>{
  selectedMonth = monthSelect.value;
  ensurePath(selectedYear, selectedMonth);
  resetSteps();
  updateMiniKpi();
});

/* =========================================================
   Step flow
========================================================= */
function resetSteps(){
  channel = null;
  mode = null;

  btnPhone.classList.remove("active");
  btnChat.classList.remove("active");
  try{ btnPhone.setAttribute("aria-pressed","false"); btnChat.setAttribute("aria-pressed","false"); }catch(e){}
  btnPhone.classList.remove('hideOut'); btnPhone.style.display = '';
  btnChat.classList.remove('hideOut'); btnChat.style.display = '';
  if(targetPill){ targetPill.classList.add('hidden'); targetPill.classList.remove('showTarget'); targetPill.setAttribute('aria-hidden','true'); }
  if(inlineTargetWrap){ inlineTargetWrap.classList.add('hidden'); inlineTargetWrap.classList.remove('showInlineWrap'); inlineTargetWrap.setAttribute('aria-hidden','true'); }
  if(inlineTarget){ inlineTarget.classList.remove('hidden'); inlineTarget.removeAttribute('disabled'); inlineTarget.setAttribute('aria-hidden','false'); inlineTarget.value = ''; }

  btnMonthly.classList.remove("active");
  btnWeekly.classList.remove("active");
  try{ btnMonthly.setAttribute("aria-pressed","false"); btnWeekly.setAttribute("aria-pressed","false"); }catch(e){}

  
  stepMode.classList.add("hidden");
  monthlySection.classList.add("hidden");
  weeklySection.classList.add("hidden");
  calcBtn.classList.add("hidden");
  resultBox.classList.add("hidden");
  avatarImg.src="nello_ok.webp";
}

btnPhone.addEventListener("click", ()=>{
  tick();
  channel = "phone";

  // ensure both buttons visible
  try{
    btnPhone.classList.remove("hideOut");
    btnChat.classList.remove("hideOut");
    btnPhone.style.display = "";
    btnChat.style.display = "";
    btnPhone.style.pointerEvents = "";
    btnChat.style.pointerEvents = "";
  }catch(e){}

  btnPhone.classList.add("active");
  btnChat.classList.remove("active");
  try{ btnPhone.setAttribute("aria-pressed","true"); btnChat.setAttribute("aria-pressed","false"); }catch(e){}

  // show target input under the buttons
  if(inlineTargetWrap){
    inlineTargetWrap.classList.remove("hidden");
    inlineTargetWrap.classList.add("showInlineWrap");
    inlineTargetWrap.setAttribute("aria-hidden","false");
  }
  try{
    const chObj = getChannelObj(selectedYear, selectedMonth, "phone");
    if(inlineTarget){
      inlineTarget.value = (chObj && (chObj.target ?? chObj.target === 0)) ? chObj.target : 86;
      inlineTarget.removeAttribute("disabled");
      setTimeout(()=>{ try{ inlineTarget.focus(); inlineTarget.select(); }catch(e){} }, 60);
    }
  }catch(e){}

  loadIntoInputs();
  mode = null;
  btnMonthly.classList.remove("active");
  btnWeekly.classList.remove("active");
  monthlySection.classList.add("hidden");
  weeklySection.classList.add("hidden");
  calcBtn.classList.add("hidden");
  resultBox.classList.add("hidden");

  updateMiniKpi();
});


// Inline target handlers: save and proceed when Enter pressed or on blur
if(inlineTarget){
  function saveInlineAndProceed(){
    tick();
    const v = Number(inlineTarget.value);
    if(!Number.isFinite(v) || v < 0) return showAuthErr('Valore target non valido.');
    if(!channel) return showAuthErr('Seleziona prima un canale.');
    const chObj = getChannelObj(selectedYear, selectedMonth, channel);
    chObj.target = clampNum(v,0,100);
    saveData();

    // Canale e target restano visibili e modificabili durante l'inserimento.
    if(sectionCanale) sectionCanale.classList.add('completed');
    stepMode.classList.remove('hidden');
    if(resetMonthlyBtn) resetMonthlyBtn.classList.remove('hidden');
    if(sumWeeksToMonthBtn) sumWeeksToMonthBtn.classList.remove('hidden');
    monthlySection.classList.add('hidden');
    weeklySection.classList.add('hidden');
    calcBtn.classList.remove('hidden');
    resultBox.classList.add('hidden');

    updateMiniKpi();
  }
  inlineTarget.addEventListener('keydown', (e)=>{ if(e.key==='Enter') saveInlineAndProceed(); });
  // (niente autoskip su blur: confermi con OK o Invio)
  inlineTarget.addEventListener('input', ()=>{
    try{
      if(!channel) return;
      const v = Number(inlineTarget.value);
      if(!Number.isFinite(v)) return;
      const ch = getChannelObj(selectedYear, selectedMonth, channel);
      ch.target = clampNum(v,0,100);
      saveData();
      updateMiniKpi();
    }catch(e){}
  });
  if(inlineTargetOk){ inlineTargetOk.addEventListener('click', ()=>{ saveInlineAndProceed(); }); }
}

btnChat.addEventListener("click", ()=>{
  tick();
  channel = "chat";

  // ensure both buttons visible
  try{
    btnPhone.classList.remove("hideOut");
    btnChat.classList.remove("hideOut");
    btnPhone.style.display = "";
    btnChat.style.display = "";
    btnPhone.style.pointerEvents = "";
    btnChat.style.pointerEvents = "";
  }catch(e){}

  btnChat.classList.add("active");
  btnPhone.classList.remove("active");
  try{ btnChat.setAttribute("aria-pressed","true"); btnPhone.setAttribute("aria-pressed","false"); }catch(e){}

  // show target input under the buttons
  if(inlineTargetWrap){
    inlineTargetWrap.classList.remove("hidden");
    inlineTargetWrap.classList.add("showInlineWrap");
    inlineTargetWrap.setAttribute("aria-hidden","false");
  }
  try{
    const chObj = getChannelObj(selectedYear, selectedMonth, "chat");
    if(inlineTarget){
      inlineTarget.value = (chObj && (chObj.target ?? chObj.target === 0)) ? chObj.target : 86;
      inlineTarget.removeAttribute("disabled");
      setTimeout(()=>{ try{ inlineTarget.focus(); inlineTarget.select(); }catch(e){} }, 60);
    }
  }catch(e){}

  loadIntoInputs();
  mode = null;
  btnMonthly.classList.remove("active");
  btnWeekly.classList.remove("active");
  monthlySection.classList.add("hidden");
  weeklySection.classList.add("hidden");
  calcBtn.classList.add("hidden");
  resultBox.classList.add("hidden");

  updateMiniKpi();
});


btnMonthly.addEventListener("click", ()=>{
  if(!channel) return;
  tick();
  mode = "monthly";
  btnMonthly.classList.add("active");
  btnWeekly.classList.remove("active");
  try{ btnMonthly.setAttribute("aria-pressed","true"); btnWeekly.setAttribute("aria-pressed","false"); }catch(e){}

  loadIntoInputs();
  monthlySection.classList.remove("hidden");
  weeklySection.classList.add("hidden");
  calcBtn.classList.remove("hidden");
  resultBox.classList.add("hidden");

  updateMiniKpi();
});
btnWeekly.addEventListener("click", ()=>{
  if(!channel) return;
  tick();
  mode = "weekly";
  btnWeekly.classList.add("active");
  btnMonthly.classList.remove("active");
  if(btnWeekly) btnWeekly.setAttribute('aria-pressed','true'); if(btnMonthly) btnMonthly.setAttribute('aria-pressed','false');

  loadIntoInputs();
  weeklySection.classList.remove("hidden");
  monthlySection.classList.add("hidden");
  // auto-open the weeks accordion for quick access
  if(weeklyAccordion){ weeklyAccordion.classList.add('open'); }
  if(accChevron) accChevron.textContent = '▴';
  calcBtn.classList.remove("hidden");
  resultBox.classList.add("hidden");

  updateMiniKpi();
});

accHead.addEventListener("click", ()=>{
  weeklyAccordion.classList.toggle("open");
  accChevron.textContent = weeklyAccordion.classList.contains("open") ? "▴" : "▾";
});

/* =========================================================
   Load/save inputs
========================================================= */
function loadIntoInputs(){
  if(!channel) return;
  const chObj = getChannelObj(selectedYear, selectedMonth, channel);

  if(inlineTarget) inlineTarget.value = chObj.target ?? 86; else /* fallback */ {};

  m_yes.value = chObj.monthly?.yes ?? 0;
  m_no.value  = chObj.monthly?.no  ?? 0;
  m_rec.value = chObj.monthly?.rec ?? 0;

  const wk = Array.isArray(chObj.weeks) ? chObj.weeks : Array.from({length:5},()=>({yes:0,no:0,rec:0}));
  for(let i=0;i<5;i++){
    const v = wk[i] || {yes:0,no:0,rec:0};
    wEl(i+1,"yes").value = v.yes ?? 0;
    wEl(i+1,"no").value  = v.no  ?? 0;
    wEl(i+1,"rec").value = v.rec ?? 0;
  }
  updateWeekButtons();
  updateValidationUI();
}

function updateValidationUI(){
  const monthlyCheck=validateCounts(Number(m_yes.value),Number(m_no.value),Number(m_rec.value));
  let weeklyMessage="";
  for(const w of weeks){
    const check=validateCounts(Number(wEl(w,"yes").value),Number(wEl(w,"no").value),Number(wEl(w,"rec").value));
    if(!check.valid){ weeklyMessage=`Settimana ${w}: ${check.message}`; break; }
  }
  if(inputValidation){
    inputValidation.textContent=monthlyCheck.message;
    inputValidation.classList.toggle("hidden",monthlyCheck.valid);
  }
  if(weeklyValidation){
    weeklyValidation.textContent=weeklyMessage;
    weeklyValidation.classList.toggle("hidden",!weeklyMessage);
  }
  const valid=mode==="weekly" ? !weeklyMessage : monthlyCheck.valid;
  if(calcBtn) calcBtn.disabled=!valid;
  return valid;
}

function saveFromInputs(){
  if(!channel) return;
  const chObj = getChannelObj(selectedYear, selectedMonth, channel);

  if(inlineTarget && inlineTarget.value !== "") chObj.target = clampNum(Number(inlineTarget.value), 0, 100);
  if(mode) chObj.mode = mode;
  if(!updateValidationUI()) return false;

  chObj.monthly = {
    yes: clampInt(Number(m_yes.value)),
    no:  clampInt(Number(m_no.value)),
    rec: clampInt(Number(m_rec.value))
  };

  chObj.weeks = weeks.map(w=>({
    yes: clampInt(Number(wEl(w,"yes").value)),
    no:  clampInt(Number(wEl(w,"no").value)),
    rec: clampInt(Number(wEl(w,"rec").value))
  }));

  saveData();
  return true;
}

[m_yes,m_no,m_rec].forEach(el=>el.addEventListener("input", ()=>{
  const valid=saveFromInputs();
  if(valid===false) return;
  updateMiniKpi();
  if(!resultBox.classList.contains("hidden")){
    renderResult(false);
    showLiveResultPulse();
  }
}));

// Inserimento rapido: utile soprattutto da telefono, senza aprire ogni volta la tastiera.
let lastQuickChange = null;
const undoQuickBtn = document.getElementById("undoQuickBtn");
document.querySelectorAll("[data-quick-field]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    const input = document.getElementById(btn.dataset.quickField);
    if(!input) return;
    const before = clampInt(Number(input.value));
    input.value = String(before + 1);
    lastQuickChange = { input, before };
    if(undoQuickBtn) undoQuickBtn.disabled = false;
    input.dispatchEvent(new Event("input", { bubbles:true }));
  });
});
if(undoQuickBtn){
  undoQuickBtn.addEventListener("click", ()=>{
    if(!lastQuickChange) return;
    lastQuickChange.input.value = String(lastQuickChange.before);
    lastQuickChange.input.dispatchEvent(new Event("input", { bubbles:true }));
    lastQuickChange = null;
    undoQuickBtn.disabled = true;
  });
}

// Normalizza valori vuoti, decimali o negativi quando l'utente lascia il campo.
document.querySelectorAll('input[type="number"][step="1"]').forEach(input=>{
  input.addEventListener("blur", ()=>{
    const normalized = clampInt(Number(input.value));
    if(input.value !== String(normalized)){
      input.value = String(normalized);
      input.dispatchEvent(new Event("input", { bubbles:true }));
    }
  });
});
for(const w of weeks){
  for(const k of ["yes","no","rec"]){
    wEl(w,k).addEventListener("input", ()=>{
      updateWeekButtons();
      const valid=saveFromInputs();
      if(valid===false) return;
      updateMiniKpi();
      // show live result immediately when editing weekly data
      if(mode === "weekly"){
        resultBox.classList.remove('hidden');
        renderResult(false);
        showLiveResultPulse();
      }else{
        if(!resultBox.classList.contains("hidden")){
          renderResult(false);
          showLiveResultPulse();
        }
      }
    });
  }
}

/* =========================================================
   NO -> SI conversion
========================================================= */
function updateWeekButtons(){
  // NO→SÌ conversion removed; no buttons to enable/disable.
}
// convertWeek removed during cleanup.
// NO→SI conversion buttons removed per UX: no listeners attached.

/* buttons */
document.getElementById("resetMonthlyBtn").addEventListener("click", ()=>{
  m_yes.value="0"; m_no.value="0"; m_rec.value="0";
  tick(); if(hapticOn && navigator.vibrate) navigator.vibrate(18);
  saveFromInputs(); updateMiniKpi();
  if(!resultBox.classList.contains("hidden")) renderResult(false);
});
document.getElementById("resetWeeksBtn").addEventListener("click", ()=>{
  for(const w of weeks){ wEl(w,"yes").value="0"; wEl(w,"no").value="0"; wEl(w,"rec").value="0"; }
  updateWeekButtons();
  tick(); if(hapticOn && navigator.vibrate) navigator.vibrate(18);
  saveFromInputs(); updateMiniKpi();
  if(!resultBox.classList.contains("hidden")) renderResult(false);
});
document.getElementById("sumToMonthBtn").addEventListener("click", sumWeeksToMonth);
document.getElementById("sumWeeksToMonthBtn").addEventListener("click", sumWeeksToMonth);

function sumWeeksToMonth(){
  // Sum weekly values into the monthly fields
  let yes=0,no=0,rec=0;
  for(const w of weeks){
    yes += clampInt(Number(wEl(w,"yes").value));
    no  += clampInt(Number(wEl(w,"no").value));
    rec += clampInt(Number(wEl(w,"rec").value));
  }
  m_yes.value=String(yes); m_no.value=String(no); m_rec.value=String(rec);

  // Switch to monthly mode and show monthly section/result for live feedback
  mode = "monthly";
  btnMonthly.classList.add("active");
  btnWeekly.classList.remove("active");
  monthlySection.classList.remove("hidden");
  weeklySection.classList.add("hidden");
  stepMode.classList.remove("hidden");
  calcBtn.classList.remove("hidden");

  // Hide weekly helper buttons (optional UX cleanup)
  try{ document.getElementById("resetWeeksBtn").classList.add('hidden'); }catch(e){}
  try{ document.getElementById("sumToMonthBtn").classList.add('hidden'); }catch(e){}

  tick(); if(hapticOn && navigator.vibrate) navigator.vibrate(18);
  saveFromInputs(); updateMiniKpi();

  // Show result box and render immediately; renderResult will keep updating live on input changes
  resultBox.classList.remove('hidden');
  renderResult(false);
  showLiveResultPulse();

  // focus first monthly input so edits happen immediately
  try{ m_yes.focus(); }catch(e){}
}

/* =========================================================
   Mini KPI near login
========================================================= */
function getTotalsForMini(){
  if(!channel) return null;
  const localMode = mode || "monthly";
  if(localMode==="monthly"){
    return { yes: clampInt(Number(m_yes.value)), no: clampInt(Number(m_no.value)), rec: clampInt(Number(m_rec.value)) };
  }else{
    let yes=0,no=0,rec=0;
    for(const w of weeks){
      yes += clampInt(Number(wEl(w,"yes").value));
      no  += clampInt(Number(wEl(w,"no").value));
      rec += clampInt(Number(wEl(w,"rec").value));
    }
    return {yes,no,rec};
  }
}

function updateMiniKpi(){
  if(!channel){
    miniLabel.textContent = "KPI";
    miniKpi.textContent = "—";
    return;
  }
  const chName = channel==="phone" ? "TEL" : "CHAT";
  miniLabel.textContent = `KPI ${chName}`;

  const totals = getTotalsForMini();
  const r = totals ? ratio(totals.yes, totals.no, totals.rec) : null;
  miniKpi.textContent = (r===null) ? "—" : (r*100).toFixed(2) + "%";
}

/* =========================================================
   Result
========================================================= */
const frasiNegative=[
  "Sotto target. Recuperabile: spingi i prossimi voti 🚀",
  "Non è il massimo, ma si rimonta ✅",
  "Ancora sotto: basta poco per cambiare tutto 🔥",
  "Target vicino: non mollare 💪",
  "Serve una spinta: vai di Sì 🎯"
];
let lastHit=false;

function getCurrentTotals(){
  if(!mode) return null;
  if(mode==="monthly"){
    return { yes: clampInt(Number(m_yes.value)), no: clampInt(Number(m_no.value)), rec: clampInt(Number(m_rec.value)) };
  }else{
    let yes=0,no=0,rec=0;
    for(const w of weeks){
      yes += clampInt(Number(wEl(w,"yes").value));
      no  += clampInt(Number(wEl(w,"no").value));
      rec += clampInt(Number(wEl(w,"rec").value));
    }
    return {yes,no,rec};
  }
}

function renderResult(triggerFx=false){
  const targetPct = getCurrentTargetPct();
  const t = targetPct/100;

  const data = getCurrentTotals();
  if(!data){
    resultBox.classList.remove("hidden");
    resultMeta.textContent = `${selectedYear}-${selectedMonth} • ${(channel==="phone")?"Telefono":"Messaggistica"} • scegli Mensile/Settimanale`;
    percentEl.textContent="—";
    percentEl.className="percent err";
    messageEl.textContent="Scegli prima Mensile o Settimanale.";
    barFill.style.width="0%";
    barText.textContent="—";
    kpisEl.style.display="none";
    kpisEl.innerHTML="";
    avatarImg.src="nello_ok.webp";
    lastHit=false;
    return;
  }

  const r = ratio(data.yes, data.no, data.rec);
  resultBox.classList.remove("hidden");
  resultMeta.textContent = `${selectedYear}-${selectedMonth} • ${(channel==="phone")?"Telefono":"Messaggistica"} • ${(mode==="monthly")?"Mensile":"Settimanale"}`;

  if(r===null){
    percentEl.textContent="—";
    percentEl.className="percent err";
    messageEl.textContent="Inserisci almeno un Sì o un No.";
    barFill.style.width="0%";
    barText.textContent="—";
    kpisEl.style.display="none";
    kpisEl.innerHTML="";
    avatarImg.src="nello_ok.webp";
    lastHit=false;
    return;
  }

  const pct = r*100;
  percentEl.textContent = pct.toFixed(2)+" %";

  if(targetPct<=0){
    percentEl.className="percent warn";
    messageEl.textContent="Target non impostato.";
    barFill.style.width="0%";
    barText.textContent="Target non impostato";
    kpisEl.style.display="none";
    kpisEl.innerHTML="";
    avatarImg.src="nello_ok.webp";
    lastHit=false;
    return;
  }

  const hit = pct >= targetPct;
  const prog = Math.min(100, Math.max(0, (pct/targetPct)*100));
  barFill.style.width = prog.toFixed(0)+"%";
  barText.textContent = `Progresso verso ${targetPct}%: ${prog.toFixed(0)}%`;

  if(hit){
    percentEl.className="percent ok";
    messageEl.textContent="In obiettivo 🎉";
    avatarImg.src="nello_ok.webp";
  }else{
    percentEl.className="percent warn";
    messageEl.textContent=pick(frasiNegative);
    avatarImg.src="nello_angry.webp";
  }

  const addYes = neededYes(data.yes, data.no, data.rec, t);
  const conv   = neededNoToYes(data.yes, data.no, data.rec, t);

  kpisEl.style.display="grid";
  const recoveryHtml = hit ? `
    <div class="kpiBox si">
      <div class="kpiTitle">SÌ per Obiettivo</div>
      <div class="kpiValue si">0</div>
      <div class="kpiSub">Già in target</div>
    </div>
    <div class="kpiBox no">
      <div class="kpiTitle">NO → SÌ da recuperare</div>
      <div class="kpiValue no">0</div>
      <div class="kpiSub">Nessuna conversione</div>
    </div>
  ` : `
    <div class="kpiBox si">
      <div class="kpiTitle">SÌ per Obiettivo</div>
      <div class="kpiValue si">${addYes===Infinity ? "—" : "+"+addYes}</div>
      <div class="kpiSub">Aggiungendo solo Sì</div>
    </div>
    <div class="kpiBox no">
      <div class="kpiTitle">NO → SÌ da recuperare</div>
      <div class="kpiValue no">${conv}</div>
      <div class="kpiSub">Conversioni necessarie</div>
    </div>
  `;
  const today=new Date();
  const isCurrentPeriod=selectedYear===String(today.getFullYear()) && selectedMonth===pad2(today.getMonth()+1);
  const daysLeft=isCurrentPeriod ? Math.max(1,new Date(today.getFullYear(),today.getMonth()+1,0).getDate()-today.getDate()+1) : 0;
  const weeksLeft=Math.max(1,Math.ceil(daysLeft/7));
  const weeklyPace=hit ? 0 : addYes===Infinity ? null : Math.ceil(addYes/weeksLeft);
  const paceHtml=`<div class="kpiBox pace">
    <div class="kpiTitle">Ritmo consigliato</div>
    <div class="kpiValue pace">${isCurrentPeriod ? (weeklyPace===null ? "—" : weeklyPace) : "—"}</div>
    <div class="kpiSub">${isCurrentPeriod ? (hit ? "Mantieni la qualità attuale" : `Sì a settimana per ${weeksLeft} sett.`) : "Disponibile sul mese corrente"}</div>
  </div>`;
  kpisEl.innerHTML=recoveryHtml+paceHtml;

  if(triggerFx){
    if(hit && !lastHit) celebrate();
    if(!hit) warn();
  }
  lastHit = hit;

  updateMiniKpi();
}

calcBtn.addEventListener("click", ()=>{
  tick();
  if(hapticOn && navigator.vibrate) navigator.vibrate(18);
  saveFromInputs();
  renderResult(true);
  try{
    // ensure result visible
    resultBox.classList.remove('hidden');
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    resultBox.classList.add('pulse');
    setTimeout(()=>resultBox.classList.remove('pulse'), 700);
  }catch(e){ console.warn(e); }
});

/* =========================================================
   Share
========================================================= */
shareTextBtn.addEventListener("click", shareText);
shareImgBtn.addEventListener("click", shareImage);

async function shareText(){
  tick();
  const data = getCurrentTotals();
  const targetPct = getCurrentTargetPct();
  const r = data ? ratio(data.yes, data.no, data.rec) : null;
  const pct = r===null ? "—" : (r*100).toFixed(2)+"%";
  const chName = (channel==="phone") ? "Telefono" : "Messaggistica";
  const modeName = mode ? (mode==="monthly" ? "Mensile" : "Settimanale") : "—";

  const text =
`Nello KPI — ${chName}
Periodo: ${selectedYear}-${selectedMonth} (${modeName})
Target: ${targetPct}%
Sì: ${data?data.yes:0} | No: ${data?data.no:0} | Ric: ${data?data.rec:0}
Risultato: ${pct}`;

  if(navigator.share){
    try{ await navigator.share({ title:"Nello KPI", text }); }catch(e){}
  }else{
    await navigator.clipboard.writeText(text);
    alert("Testo copiato negli appunti 📋");
  }
}

async function shareImage(){
  tick();
  if(typeof html2canvas === "undefined"){
    alert("La condivisione immagine non è disponibile offline.");
    return;
  }
  const canvas = await html2canvas(resultBox, { backgroundColor:null, scale: Math.min(2, window.devicePixelRatio || 1) });
  const blob = await new Promise(res => canvas.toBlob(res, "image/png", 1.0));
  if(!blob) return;

  const file = new File([blob], "nello-kpi.png", { type:"image/png" });
  if(navigator.canShare && navigator.canShare({ files:[file] }) && navigator.share){
    try{ await navigator.share({ title:"Nello KPI", files:[file] }); return; }catch(e){}
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "nello-kpi.png";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  alert("PNG salvato.");
}

/* =========================================================
   Stats
========================================================= */
function pctStr(p){ return p===null ? "—" : (p*100).toFixed(2)+"%"; }
function monthLabel(m){ return MONTHS_IT[m] || m; }

function sumChannelMonth(chObj){
  const m = chObj.mode || "monthly";
  if(m==="weekly"){
    const wk = Array.isArray(chObj.weeks)?chObj.weeks:[];
    let yes=0,no=0,rec=0;
    for(const v of wk){ yes+=clampInt(Number(v.yes)); no+=clampInt(Number(v.no)); rec+=clampInt(Number(v.rec)); }
    return {yes,no,rec};
  }else{
    const mm = chObj.monthly || {yes:0,no:0,rec:0};
    return { yes:clampInt(Number(mm.yes)), no:clampInt(Number(mm.no)), rec:clampInt(Number(mm.rec)) };
  }
}

function rebuildStatsYears(){
  const requestedYear = statsYear.value || selectedYear;
  const years = Object.keys(DATA.years||{});
  const yNow = nowYear();
  for(let year=2017; year<=Math.max(2030,Number(yNow)); year++){
    const value=String(year);
    if(!years.includes(value)) years.push(value);
  }
  years.sort();
  statsYear.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join("");
  statsYear.value = years.includes(requestedYear) ? requestedYear : selectedYear;
}

function hasAnyData(chObj){
  if(!chObj) return false;
  const s = sumChannelMonth(chObj);
  const den = s.yes + s.no;
  if(den > 0) return true;
  return (chObj.overridePercent !== null && chObj.overridePercent !== undefined);
}

function getChannelStats(chObj){
  if(!chObj){
    return { r:null, counts:{yes:0,no:0,rec:0}, denom:0, target:0.86, percentOnly:false };
  }
  const target = (Number(chObj.target) || 86) / 100;
  const counts = sumChannelMonth(chObj);
  const denom = counts.yes + counts.no;

  const override = (chObj.overridePercent !== null && chObj.overridePercent !== undefined)
    ? Number(chObj.overridePercent)
    : null;

  let r = null;
  let percentOnly = false;

  if(override !== null && denom <= 0){
    r = override;
    percentOnly = true;
  }else{
    r = ratio(counts.yes, counts.no, counts.rec);
    // Fallback: if someone saved only % but later counts are 0, still show %
    if(r === null && override !== null){
      r = override;
      percentOnly = true;
    }
  }

  return { r, counts, denom, target, percentOnly };
}

function statusIconHtml(r,t){
  if(r === null) return "";
  const ok = r >= t;
  return `<span class="statusIcon ${ok ? "ok" : "bad"}" title="${ok ? "In obiettivo" : "Sotto obiettivo"}">${ok ? "✓" : "✕"}</span>`;
}

function summarizeYear(monthsObj, chKey){
  let total = {yes:0,no:0,rec:0};
  let weightTarget = 0;
  let weightDen = 0;
  let percents = [];
  let targets = [];
  let percentOnlyMonths = 0;

  for(const mk of ["01","02","03","04","05","06","07","08","09","10","11","12"]){
    const mo = monthsObj[mk];
    const chObj = mo?.channels?.[chKey];
    if(!chObj) continue;

    const st = getChannelStats(chObj);
    if(st.r !== null){
      percents.push(st.r);
      targets.push(st.target);
    }
    if(st.denom > 0){
      total.yes += st.counts.yes;
      total.no  += st.counts.no;
      total.rec += st.counts.rec;
      weightTarget += st.target * st.denom;
      weightDen += st.denom;
    }else if(st.percentOnly){
      percentOnlyMonths++;
    }
  }

  const totalR = ratio(total.yes, total.no, total.rec);
  const yearTarget = (weightDen > 0) ? (weightTarget / weightDen) : 0.86;
  const avgR = percents.length ? (percents.reduce((a,b)=>a+b,0) / percents.length) : null;
  const avgT = targets.length ? (targets.reduce((a,b)=>a+b,0) / targets.length) : yearTarget;

  return { total, totalR, yearTarget, avgR, avgT, percentOnlyMonths, monthsWithPercent: percents.length, weightDen };
}

const MONTH_KEYS = ["01","02","03","04","05","06","07","08","09","10","11","12"];
let statsRange=12;
let statsShowAll=true;

function channelTrend(monthsObj, chKey){
  return MONTH_KEYS.map(mk=>{
    const chObj = monthsObj[mk]?.channels?.[chKey];
    const st = getChannelStats(chObj);
    return { month:mk, value:hasAnyData(chObj) ? st.r : null, target:st.target };
  });
}

function combinedTrend(phone, chat, filter){
  return MONTH_KEYS.map((mk, index)=>{
    const source = filter === "phone" ? [phone[index]] : filter === "chat" ? [chat[index]] : [phone[index], chat[index]];
    const valid = source.filter(item=>item.value !== null);
    return {
      month:mk,
      value:valid.length ? valid.reduce((sum,item)=>sum+item.value,0)/valid.length : null,
      target:valid.length ? valid.reduce((sum,item)=>sum+item.target,0)/valid.length : null
    };
  });
}

function renderTrendInsights(trend){
  const valid = trend.filter(item=>item.value !== null);
  if(!valid.length) return "";
  const latest = valid[valid.length-1];
  const previous = valid.length > 1 ? valid[valid.length-2] : null;
  const delta = previous ? (latest.value-previous.value)*100 : null;
  const best = valid.reduce((winner,item)=>item.value>winner.value ? item : winner, valid[0]);
  const hit = valid.filter(item=>item.target !== null && item.value>=item.target).length;
  const deltaClass = delta === null ? "" : delta >= 0 ? "positive" : "negative";
  const deltaText = delta === null ? "—" : `${delta>=0?"+":""}${delta.toFixed(1)} pt`;
  const recent=valid.slice(-4).map(item=>item.value);
  const changes=recent.slice(1).map((value,index)=>value-recent[index]);
  const projected=changes.length ? clampNum(latest.value+(changes.reduce((a,b)=>a+b,0)/changes.length),0,1) : latest.value;

  return `<div class="insightGrid" aria-label="Indicatori sintetici">
    <div class="insightCard"><div class="insightLabel">Ultimo dato</div><div class="insightValue">${pctStr(latest.value)}</div><div class="insightNote">${monthLabel(latest.month)}</div></div>
    <div class="insightCard"><div class="insightLabel">Variazione</div><div class="insightValue ${deltaClass}">${deltaText}</div><div class="insightNote">rispetto al dato precedente</div></div>
    <div class="insightCard"><div class="insightLabel">Miglior mese</div><div class="insightValue">${pctStr(best.value)}</div><div class="insightNote">${monthLabel(best.month)} · ${hit}/${valid.length} in target</div></div>
    <div class="insightCard forecast"><div class="insightLabel">Trend stimato</div><div class="insightValue">${pctStr(projected)}</div><div class="insightNote">proiezione basata sugli ultimi mesi</div></div>
  </div>`;
}

function svgSeries(items, cssClass, width, height, pad, options={}){
  const plotW = width-pad.left-pad.right;
  const plotH = height-pad.top-pad.bottom;
  const x = i=>pad.left+(plotW*i/Math.max(1,items.length-1));
  const y = value=>pad.top+plotH-(clampNum(value*100,0,100)/100)*plotH;
  const segments = [];
  let current = [];
  items.forEach((item,index)=>{
    if(item.value === null){ if(current.length){segments.push(current);current=[];} return; }
    current.push(`${x(index).toFixed(1)},${y(item.value).toFixed(1)}`);
  });
  if(current.length) segments.push(current);
  const lines = segments.map(points=>`<polyline class="chartLine ${cssClass}" points="${points.join(" ")}"/>`).join("");
  const targets = options.showTarget===false ? [] : items.map((item,index)=>item.value===null ? null : `${x(index).toFixed(1)},${y(item.target).toFixed(1)}`).filter(Boolean);
  const targetLine = targets.length ? `<polyline class="chartTarget ${cssClass}" points="${targets.join(" ")}"/>` : "";
  const dots = options.dots===false ? "" : items.map((item,index)=>item.value===null ? "" : `<circle tabindex="0" role="button" class="chartDot ${cssClass}" cx="${x(index).toFixed(1)}" cy="${y(item.value).toFixed(1)}" r="6" data-chart-label="${options.label||"KPI"}" data-chart-month="${monthLabel(item.month)}" data-chart-value="${(item.value*100).toFixed(2)}%" data-chart-target="${item.target===null?"—":(item.target*100).toFixed(1)+"%"}"><title>${monthLabel(item.month)}: ${(item.value*100).toFixed(2)}%</title></circle>`).join("");
  return targetLine+lines+dots;
}

function renderTrendChart(phone, chat, previous, filter, year, range){
  const hasPhone = phone.some(item=>item.value!==null);
  const hasChat = chat.some(item=>item.value!==null);
  if(!hasPhone && !hasChat) return "";
  const lastIndex=Math.max(
    filter!=="chat" ? phone.reduce((last,item,index)=>item.value!==null?index:last,-1) : -1,
    filter!=="phone" ? chat.reduce((last,item,index)=>item.value!==null?index:last,-1) : -1
  );
  const end=lastIndex<0?11:lastIndex;
  const start=Math.max(0,end-range+1);
  phone=phone.slice(start,end+1);
  chat=chat.slice(start,end+1);
  previous=previous.slice(start,end+1);
  const width=720, height=280, pad={left:42,right:18,top:18,bottom:38};
  const plotH=height-pad.top-pad.bottom;
  const grid=[0,25,50,75,100].map(value=>{
    const y=pad.top+plotH-(value/100)*plotH;
    return `<line class="chartGrid" x1="${pad.left}" y1="${y}" x2="${width-pad.right}" y2="${y}"/><text class="chartAxis" x="${pad.left-8}" y="${y+4}" text-anchor="end">${value}%</text>`;
  }).join("");
  const visibleMonths=MONTH_KEYS.slice(start,end+1);
  const labels=visibleMonths.map((mk,index)=>{
    const x=pad.left+((width-pad.left-pad.right)*index/Math.max(1,visibleMonths.length-1));
    return `<text class="chartAxis" x="${x}" y="${height-12}" text-anchor="middle">${monthLabel(mk).slice(0,3)}</text>`;
  }).join("");
  const showPhone = filter!=="chat" && hasPhone;
  const showChat = filter!=="phone" && hasChat;
  const hasPrevious=previous.some(item=>item.value!==null);
  const series=(hasPrevious?svgSeries(previous,"previous",width,height,pad,{showTarget:false,dots:false}):"")+(showPhone?svgSeries(phone,"phone",width,height,pad,{label:"Telefono"}):"")+(showChat?svgSeries(chat,"chat",width,height,pad,{label:"Messaggistica"}):"");
  const legend=(showPhone?'<span><i class="phone"></i>Telefono</span>':"")+(showChat?'<span><i class="chat"></i>Messaggistica</span>':"")+(hasPrevious?`<span><i class="previous"></i>${Number(year)-1}</span>`:"")+'<span><i class="target"></i>Target</span>';
  const rangeButtons=[3,6,12].map(value=>`<button type="button" class="rangeBtn ${range===value?"active":""}" data-chart-range="${value}">${value}M</button>`).join("");
  return `<section class="trendCard"><div class="trendHeader"><div><strong>Andamento ${year}</strong><span>Tocca i punti per leggere KPI e obiettivo</span></div><div class="chartTools"><div class="rangePicker" aria-label="Intervallo grafico">${rangeButtons}</div><div class="trendLegend">${legend}</div></div></div><div class="chartScroller"><svg class="trendChart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Grafico andamento KPI mensile ${year}">${grid}${labels}${series}</svg></div><div class="chartTooltip hidden" role="status"></div></section>`;
}

function bindChartInteractions(){
  const card=statsGrid.querySelector(".trendCard");
  const tooltip=card?.querySelector(".chartTooltip");
  if(!card || !tooltip) return;
  const show=point=>{
    const cardRect=card.getBoundingClientRect();
    const pointRect=point.getBoundingClientRect();
    tooltip.innerHTML=`<strong>${point.dataset.chartLabel} · ${point.dataset.chartMonth}</strong><span>KPI ${point.dataset.chartValue}</span><small>Target ${point.dataset.chartTarget}</small>`;
    tooltip.style.left=`${pointRect.left-cardRect.left+(pointRect.width/2)}px`;
    tooltip.style.top=`${pointRect.top-cardRect.top-8}px`;
    tooltip.classList.remove("hidden");
  };
  card.querySelectorAll("[data-chart-value]").forEach(point=>{
    point.addEventListener("pointerenter",()=>show(point));
    point.addEventListener("focus",()=>show(point));
    point.addEventListener("click",event=>{event.stopPropagation();show(point);});
    point.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();show(point);}});
  });
  card.addEventListener("pointerleave",()=>tooltip.classList.add("hidden"));
  document.addEventListener("click",event=>{if(!card.contains(event.target)) tooltip.classList.add("hidden");},{once:true});
}

function renderStats(){
  rebuildStatsYears();
  statsUser.textContent = currentUser?.name || "Guest";

  const y = statsYear.value;
  const filter = statsChannel.value;

  const monthsObj = DATA.years?.[y]?.months || {};
  const sumPhone = summarizeYear(monthsObj, "phone");
  const sumChat  = summarizeYear(monthsObj, "chat");
  const phoneTrend = channelTrend(monthsObj, "phone");
  const chatTrend = channelTrend(monthsObj, "chat");
  const selectedTrend = combinedTrend(phoneTrend, chatTrend, filter);
  const previousMonths=DATA.years?.[String(Number(y)-1)]?.months || {};
  const previousTrend=combinedTrend(channelTrend(previousMonths,"phone"),channelTrend(previousMonths,"chat"),filter);

  function fmtTarget(t){
    const v = Math.round(t * 1000) / 10;
    return `${v}%`;
  }

  function summaryCard(title, sum){
    const r = (sum.totalR !== null) ? sum.totalR : sum.avgR;
    const t = (sum.totalR !== null) ? sum.yearTarget : sum.avgT;
    const using = (sum.totalR !== null) ? "KPI totale" : "Media mesi";
    const note = (sum.totalR === null && sum.monthsWithPercent > 0) ? " (solo % inserite)" : "";

    return `<div class="summaryCard">
      <div class="summaryTop">
        <div class="name">${title}</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div class="kpi">${pctStr(r)}</div>
          ${statusIconHtml(r, t)}
        </div>
      </div>
      <div class="summaryMeta">
        <b>${using}:</b> ${pctStr(r)} · <b>Target:</b> ${fmtTarget(t)}${note}<br>
        <b>Totali:</b> Sì ${sum.total.yes} · No ${sum.total.no} · Ric ${sum.total.rec}
      </div>
    </div>`;
  }

  let summaryHtml = "";
  if(filter === "phone"){
    summaryHtml = `<div class="statsSummary">${summaryCard(`Anno ${y} — Telefono`, sumPhone)}</div>`;
  }else if(filter === "chat"){
    summaryHtml = `<div class="statsSummary">${summaryCard(`Anno ${y} — Messaggistica`, sumChat)}</div>`;
  }else{
    summaryHtml = `<div class="statsSummary two">${summaryCard(`Anno ${y} — Telefono`, sumPhone)}${summaryCard(`Anno ${y} — Messaggistica`, sumChat)}</div>`;
  }

  function monthBlock(chLabel, chObj, mk, chKey){
    if(!chObj){
      return `<div class="block">
        <div class="blockTop">
          <div class="label">${chLabel}</div>
        </div>
        <div class="blockKpi">—</div>
        <div class="blockMeta">Nessun dato</div>
      </div>`;
    }

    const st = getChannelStats(chObj);
    const countsTxt = (st.percentOnly && st.denom <= 0)
      ? `Sì — · No — · Ric —`
      : `Sì ${st.counts.yes} · No ${st.counts.no} · Ric ${st.counts.rec}`;

    const percentTag = st.percentOnly ? `<span class="chip">solo %</span>` : "";
    const canEdit = hasAnyData(chObj);
    const editBtn = canEdit ? `<button class="miniEdit" type="button" data-y="${y}" data-m="${mk}" data-ch="${chKey}" aria-label="Modifica ${chLabel}">✎</button>` : "";

    return `<div class="block">
      <div class="blockTop">
        <div class="label">${chLabel} ${percentTag}</div>
        <div style="display:flex;align-items:center;gap:10px;">
          ${editBtn}
          ${statusIconHtml(st.r, st.target)}
        </div>
      </div>
      <div class="blockKpi">${pctStr(st.r)}</div>
      <div class="blockMeta">${countsTxt}<br><b>Target:</b> ${fmtTarget(st.target)}</div>
    </div>`;
  }

  const allMonthCards = MONTH_KEYS.map(mk=>{
    const mo = monthsObj[mk];
    const pObj = mo?.channels?.phone;
    const cObj = mo?.channels?.chat;

    const hasP = hasAnyData(pObj);
    const hasC = hasAnyData(cObj);

    if(filter === "phone" && !hasP) return "";
    if(filter === "chat" && !hasC) return "";
    if(filter === "all" && !hasP && !hasC) return "";

    const blocks = (filter === "phone")
      ? `<div class="monthBlocks">${monthBlock("Telefono", pObj, mk, "phone")}</div>`
      : (filter === "chat")
        ? `<div class="monthBlocks">${monthBlock("Messaggistica", cObj, mk, "chat")}</div>`
        : `<div class="monthBlocks two">${monthBlock("Telefono", pObj, mk, "phone")}${monthBlock("Messaggistica", cObj, mk, "chat")}</div>`;

    return `<div class="monthCard">
      <div class="monthHead">
        <div class="monthName">${monthLabel(mk)}</div>
        <div style="color:#9aa1b5;font-size:12px;">${y}</div>
      </div>
      ${blocks}
    </div>`;
  }).filter(Boolean).reverse();

  const visibleMonthCards=statsShowAll ? allMonthCards : allMonthCards.slice(0,3);
  const monthToggle=allMonthCards.length>3 ? `<button class="monthToggle" type="button" data-toggle-months>${statsShowAll?"Mostra solo gli ultimi 3":"Vedi tutti i mesi"}<span aria-hidden="true">${statsShowAll?"↑":"↓"}</span></button>` : "";
  const listHtml = allMonthCards.length
    ? `<div class="historySectionHead"><strong>Storico mensile</strong><span>${allMonthCards.length} ${allMonthCards.length===1?"mese disponibile":"mesi disponibili"}</span></div><div class="monthList">${visibleMonthCards.join("")}</div>${monthToggle}`
    : `<div class="emptyState"><strong>Inizia a costruire il tuo andamento</strong><span>Non ci sono ancora dati per questi filtri. Inserisci un mese e il grafico si aggiornerà subito.</span><button class="btnTiny" type="button" data-empty-add>Aggiungi il primo mese</button></div>`;

  const insightsHtml = renderTrendInsights(selectedTrend);
  const chartHtml = renderTrendChart(phoneTrend, chatTrend, previousTrend, filter, y, statsRange);
  statsGrid.innerHTML = summaryHtml + insightsHtml + chartHtml + listHtml;
  // bind edit buttons (open backfill modal prefilled)
  statsGrid.querySelectorAll(".miniEdit").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      openHistoryModalWith(btn.dataset.y, btn.dataset.m, btn.dataset.ch);
    });
  });
  const emptyAdd = statsGrid.querySelector("[data-empty-add]");
  if(emptyAdd) emptyAdd.addEventListener("click", openHistoryModal);
  const monthToggleButton=statsGrid.querySelector("[data-toggle-months]");
  if(monthToggleButton) monthToggleButton.addEventListener("click",()=>{statsShowAll=!statsShowAll;renderStats();});
  statsGrid.querySelectorAll("[data-chart-range]").forEach(button=>button.addEventListener("click",()=>{statsRange=Number(button.dataset.chartRange);renderStats();}));
  bindChartInteractions();
}
statsChannel.addEventListener("change", ()=>{ tick(); statsShowAll=true; renderStats(); });
statsYear.addEventListener("change", ()=>{ tick(); statsShowAll=true; renderStats(); });


/* =========================================================
   HISTORY / BACKFILL (Stats)
========================================================= */
function fillHistYearMonth(){
  // years
  const years = Object.keys(DATA.years||{});
  const yNow = nowYear();
  for(let year=2017; year<=Math.max(2030,Number(yNow)); year++){
    const value=String(year);
    if(!years.includes(value)) years.push(value);
  }
  years.sort();
  histYear.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join("");

  // months
  histMonth.innerHTML = ["01","02","03","04","05","06","07","08","09","10","11","12"]
    .map(m=>`<option value="${m}">${monthLabel(m)}</option>`).join("");
}

function clearHistInputs(){
  // Blank values (no more default "0" in inputs)
  histYes.value = ""; histNo.value = ""; histRec.value = "";
  histPercent.value = "";
  // weekly
  for(const el of [histW1Yes,histW1No,histW1Rec,histW2Yes,histW2No,histW2Rec,histW3Yes,histW3No,histW3Rec,histW4Yes,histW4No,histW4Rec,histW5Yes,histW5No,histW5Rec]){
    if(el) el.value = "";
  }
}

function setBlankOrNumber(inputEl, num){
  if(!inputEl) return;
  const n = Number(num);
  if(!Number.isFinite(n) || n === 0) inputEl.value = "";
  else inputEl.value = String(Math.trunc(n));
}

function prefillHistoryFromExisting(){
  const y = String(histYear.value||"").trim();
  const m = String(histMonth.value||"").trim();
  const ch = String(histChannel.value||"").trim();
  if(!y || !m || !ch) return;

  ensurePath(y, m);
  const chObj = getChannelObj(y, m, ch);

  // target
  histTarget.value = Number(chObj?.target ?? 86);

  const existing = hasAnyData(chObj);
  histSave.textContent = existing ? "Aggiorna" : "Salva";

  // reset fields, then load
  clearHistInputs();

  // override percent has priority
  if(chObj.overridePercent !== null && chObj.overridePercent !== undefined){
    histType.value = "percent";
    setHistTypeUI();
    const pp = Math.round((Number(chObj.overridePercent) * 100) * 100) / 100;
    histPercent.value = (pp === 0 ? "" : String(pp));
    return;
  }

  // weekly mode
  const mode = chObj.mode || "monthly";
  const wk = Array.isArray(chObj.weeks) ? chObj.weeks : [];
  const wkHas = (mode === "weekly") && wk.some(v => (clampInt(Number(v.yes)) + clampInt(Number(v.no)) + clampInt(Number(v.rec))) > 0);

  if(wkHas){
    histType.value = "weekly";
    setHistTypeUI();
    const w = (i) => wk[i] || {yes:0,no:0,rec:0};
    setBlankOrNumber(histW1Yes, w(0).yes); setBlankOrNumber(histW1No, w(0).no); setBlankOrNumber(histW1Rec, w(0).rec);
    setBlankOrNumber(histW2Yes, w(1).yes); setBlankOrNumber(histW2No, w(1).no); setBlankOrNumber(histW2Rec, w(1).rec);
    setBlankOrNumber(histW3Yes, w(2).yes); setBlankOrNumber(histW3No, w(2).no); setBlankOrNumber(histW3Rec, w(2).rec);
    setBlankOrNumber(histW4Yes, w(3).yes); setBlankOrNumber(histW4No, w(3).no); setBlankOrNumber(histW4Rec, w(3).rec);
    setBlankOrNumber(histW5Yes, w(4).yes); setBlankOrNumber(histW5No, w(4).no); setBlankOrNumber(histW5Rec, w(4).rec);
    return;
  }

  // monthly counts
  histType.value = "monthly";
  setHistTypeUI();
  const mm = chObj.monthly || {yes:0,no:0,rec:0};
  setBlankOrNumber(histYes, mm.yes);
  setBlankOrNumber(histNo,  mm.no);
  setBlankOrNumber(histRec, mm.rec);
}

function openHistoryModal(){
  fillHistYearMonth();

  // default: current stats year, current month, currently selected filter/channel
  histYear.value = statsYear.value || nowYear();
  histMonth.value = nowMonth();

  // if user is filtering by a single channel, preselect it
  const f = statsChannel.value;
  if(f === "phone" || f === "chat") histChannel.value = f;
  else histChannel.value = "phone";

  // default type
  histType.value = "monthly";
  setHistTypeUI();

  histError.style.display="none";
  histError.textContent="";

  // load existing (or blank)
  prefillHistoryFromExisting();

  historyOverlay.style.display = "flex";
}

function openHistoryModalWith(year, month, channel){
  fillHistYearMonth();
  histYear.value = String(year || nowYear());
  histMonth.value = String(month || nowMonth());
  histChannel.value = String(channel || "phone");

  histType.value = "monthly";
  setHistTypeUI();

  histError.style.display="none";
  histError.textContent="";

  prefillHistoryFromExisting();
  historyOverlay.style.display = "flex";
}

function closeHistoryModal(){
  historyOverlay.style.display = "none";
}

function setHistTypeUI(){
  const t = histType.value;
  if(t === "percent"){
    histCounts.classList.add("hidden");
    histWeekly.classList.add("hidden");
    histPercentWrap.classList.remove("hidden");
  }else if(t === "weekly"){
    histCounts.classList.add("hidden");
    histPercentWrap.classList.add("hidden");
    histWeekly.classList.remove("hidden");
  }else{
    histWeekly.classList.add("hidden");
    histPercentWrap.classList.add("hidden");
    histCounts.classList.remove("hidden");
  }
}

function showHistErr(msg){
  histError.textContent = msg;
  histError.style.display = "block";
}

if(addHistoryBtn){
  addHistoryBtn.addEventListener("click", ()=>{ tick(); openHistoryModal(); });
}
histCancel.addEventListener("click", closeHistoryModal);
historyOverlay.addEventListener("click", (e)=>{ if(e.target===historyOverlay) closeHistoryModal(); });
histType.addEventListener("change", ()=>{ tick(); setHistTypeUI(); });
histChannel.addEventListener("change", ()=>{
  tick();
  prefillHistoryFromExisting();
});

histYear.addEventListener("change", ()=>{
  tick();
  prefillHistoryFromExisting();
});

histMonth.addEventListener("change", ()=>{
  tick();
  prefillHistoryFromExisting();
});

histSave.addEventListener("click", ()=>{
  tick();

  const y = String(histYear.value || "").trim();
  const m = String(histMonth.value || "").trim();
  const ch = String(histChannel.value || "").trim();
  if(!y || !m || !ch) return showHistErr("Seleziona anno, mese e canale.");

  ensurePath(y, m);
  const chObj = getChannelObj(y, m, ch);

  // target
  const tVal = Number(histTarget.value);
  if(!Number.isFinite(tVal) || tVal < 0 || tVal > 100) return showHistErr("Target non valido (0–100).");
  chObj.target = tVal;

  const typ = histType.value;

  if(typ === "percent"){
    const p = Number(histPercent.value);
    if(!Number.isFinite(p) || p < 0 || p > 100) return showHistErr("Percentuale non valida (0–100).");
    chObj.overridePercent = p / 100;
    // keep counts at 0 for clarity
    chObj.mode = "monthly";
    chObj.monthly = {yes:0,no:0,rec:0};
    chObj.weeks = Array.from({length:5}, ()=>({yes:0,no:0,rec:0}));
  }else if(typ === "weekly"){
    const w = [
      { yes: clampInt(Number(histW1Yes.value||0)), no: clampInt(Number(histW1No.value||0)), rec: clampInt(Number(histW1Rec.value||0)) },
      { yes: clampInt(Number(histW2Yes.value||0)), no: clampInt(Number(histW2No.value||0)), rec: clampInt(Number(histW2Rec.value||0)) },
      { yes: clampInt(Number(histW3Yes.value||0)), no: clampInt(Number(histW3No.value||0)), rec: clampInt(Number(histW3Rec.value||0)) },
      { yes: clampInt(Number(histW4Yes.value||0)), no: clampInt(Number(histW4No.value||0)), rec: clampInt(Number(histW4Rec.value||0)) },
      { yes: clampInt(Number(histW5Yes.value||0)), no: clampInt(Number(histW5No.value||0)), rec: clampInt(Number(histW5Rec.value||0)) }
    ];

    // validations
    let totYes=0, totNo=0, totRec=0;
    for(const wk of w){
      if(wk.rec > wk.yes) return showHistErr("Ricontatti non possono superare i Sì (per settimana).");
      totYes += wk.yes; totNo += wk.no; totRec += wk.rec;
    }
    if((totYes + totNo) <= 0) return showHistErr("Inserisci almeno un Sì o un No (anche solo in una settimana).");
    if(totRec > totYes) return showHistErr("Ricontatti non possono superare i Sì (totale).");

    chObj.overridePercent = null;
    chObj.mode = "weekly";
    chObj.weeks = w;
    // keep a monthly snapshot too (useful for other UI parts)
    chObj.monthly = { yes: totYes, no: totNo, rec: totRec };
  }else{
    const yes = clampInt(Number(histYes.value||0));
    const no  = clampInt(Number(histNo.value||0));
    const rec = clampInt(Number(histRec.value||0));
    if((yes + no) <= 0) return showHistErr("Inserisci almeno un Sì o un No.");
    if(rec > yes) return showHistErr("Ricontatti non possono superare i Sì.");
    chObj.overridePercent = null;
    chObj.mode = "monthly";
    chObj.monthly = {yes,no,rec};
    chObj.weeks = Array.from({length:5}, ()=>({yes:0,no:0,rec:0}));
  }

  saveData();

  // Refresh selectors + stats
  rebuildYearMonthSelectors();
  rebuildStatsYears();
  renderStats();
  updateMiniKpi();

  closeHistoryModal();
});


/* =========================================================
   LOGIN modal helpers
========================================================= */
function showModal(){
  if(authBusy) return;
  passInput.type="password";
  document.getElementById("togglePassword").textContent="Mostra";
  document.getElementById("togglePassword").setAttribute("aria-pressed","false");
  loginError.style.display="none";
  loginError.textContent="";
  setAuthMode("login");
  modalOverlay.showModal();
  emailInput.focus();
}
function hideModal(){
  modalOverlay.close();
  passInput.value="";
  document.getElementById("confirmPassInput").value="";
  passInput.type="password";
  document.getElementById("togglePassword").textContent="Mostra";
  loginBtn.focus();
  updateMobileDock(viewStats.classList.contains("hidden") ? "input" : "stats");
}

loginBtn.addEventListener("click", async ()=>{
  if(currentUser.uid !== "guest"){
    tick();
    try{ if(firebaseEnabled && auth) await auth.signOut(); }catch(e){}
    setUser("guest","Guest");
    return;
  }
  showModal();
});
btnCloseModal.addEventListener("click", hideModal);
modalOverlay.addEventListener("click", (e)=>{ if(e.target===modalOverlay) hideModal(); });

function setUser(uid, name){
  const nextUid = uid || "guest";
  if(currentUser.uid !== nextUid){
    cloudHydrated = false;
    cloudBaseUpdatedAtMs = null;
    cloudBaseData = null;
    clearTimeout(cloudSaveTimer);
  }
  currentUser = { uid: nextUid, name: name || "Guest" };
  userLine.textContent = currentUser.name;
  loginBtn.textContent = (currentUser.uid==="guest") ? "Accedi" : "Esci";

  loadData();
  rebuildYearMonthSelectors();
  resetSteps();
  updateMiniKpi();
  renderStats();
  setSaveState(isAuthed() ? "Sincronizzazione…" : "Sul dispositivo", isAuthed() ? "saving" : "");
}

function showAuthErr(msg){
  loginError.textContent = msg;
  loginError.style.display = "block";
}

let authMode = "login";
let authBusy = false;
const authForm = document.getElementById("authForm");
const authSubmit = document.getElementById("authSubmit");
const confirmPassInput = document.getElementById("confirmPassInput");
function setAuthMode(mode){
  authMode=mode;
  const signup=mode==="signup";
  document.getElementById("authTitle").textContent=signup?"Crea il tuo account":"Bentornato";
  document.getElementById("authSubtitle").textContent=signup?"Un account per ritrovare i tuoi KPI su tutti i dispositivi.":"Accedi per ritrovare il tuo storico e continuare da dove eri rimasto.";
  document.getElementById("confirmPassWrap").hidden=!signup;
  document.getElementById("signupNote").hidden=!signup;
  confirmPassInput.required=signup;
  passInput.autocomplete=signup?"new-password":"current-password";
  if(signup) passInput.minLength=6; else passInput.removeAttribute("minlength");
  authSubmit.textContent=signup?"Crea account":"Accedi";
  document.querySelectorAll("[data-auth-mode]").forEach(button=>{
    const active=button.dataset.authMode===mode;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",String(active));
  });
  loginError.style.display="none";
}
document.querySelectorAll("[data-auth-mode]").forEach(button=>button.addEventListener("click",()=>{
  if(!authBusy) setAuthMode(button.dataset.authMode);
}));
document.getElementById("togglePassword").addEventListener("click",()=>{
  const visible=passInput.type==="password";
  passInput.type=visible?"text":"password";
  document.getElementById("togglePassword").textContent=visible?"Nascondi":"Mostra";
  document.getElementById("togglePassword").setAttribute("aria-pressed",String(visible));
});
function mapAuthError(e){
  const code=String(e?.code||"");
  if(["auth/invalid-credential","auth/user-not-found","auth/wrong-password"].includes(code)) return "Email o password non corrette. Controlla e riprova.";
  if(code==="auth/invalid-email") return "Inserisci un indirizzo email valido.";
  if(code==="auth/email-already-in-use") return "Questa email ha già un account. Seleziona Accedi.";
  if(code==="auth/weak-password") return "Scegli una password di almeno 6 caratteri.";
  if(code==="auth/too-many-requests") return "Troppi tentativi. Attendi qualche minuto e riprova.";
  if(code==="auth/network-request-failed") return "Connessione assente. Controlla la rete e riprova.";
  return "Accesso non riuscito. Riprova tra poco.";
}
authForm.addEventListener("submit",async event=>{
  event.preventDefault();
  if(authBusy) return;
  if(!authForm.reportValidity()) return;
  if(authMode==="signup" && passInput.value!==confirmPassInput.value) return showAuthErr("Le due password non coincidono.");
  if(!firebaseEnabled || !auth) return showAuthErr("Accesso temporaneamente non disponibile. Controlla la connessione e ricarica la pagina.");
  const email=emailInput.value.trim(), password=passInput.value, mode=authMode;
  authBusy=true;
  authForm.setAttribute("aria-busy","true");
  authSubmit.disabled=true;
  document.querySelectorAll("[data-auth-mode]").forEach(button=>button.disabled=true);
  authSubmit.textContent=mode==="signup"?"Creazione account...":"Accesso in corso...";
  loginError.style.display="none";
  try{
    if(mode==="signup") await auth.createUserWithEmailAndPassword(email,password);
    else await auth.signInWithEmailAndPassword(email,password);
    hideModal();
  }catch(error){ showAuthErr(mapAuthError(error)); }
  finally{
    authBusy=false;
    authForm.removeAttribute("aria-busy");
    authSubmit.disabled=false;
    document.querySelectorAll("[data-auth-mode]").forEach(button=>button.disabled=false);
    authSubmit.textContent=authMode==="signup"?"Crea account":"Accedi";
  }
});
modalOverlay.addEventListener("cancel",()=>{passInput.value="";confirmPassInput.value="";});
/* =========================================================
   INIT
========================================================= */
function init(){
  setUser("guest","Guest");
  selectedYear = nowYear();
  selectedMonth = nowMonth();
  rebuildYearMonthSelectors();
  resetSteps();
  updateMiniKpi();
  setTab("input");
  renderStats();
}

function showWelcome(name, exact=false){
  try{
    const t = document.getElementById('welcomeToast');
    const n = document.getElementById('welcomeName');
    if(!t || !n) return;
    n.textContent = exact ? name : "Ben tornato, " + name;
    t.classList.remove('hidden');
    // force reflow then show
    void t.offsetWidth;
    t.classList.add('show');
    setTimeout(()=>{ t.classList.remove('show'); t.classList.add('hidden'); }, 2600);
  }catch(e){ console.warn(e); }
}

if(auth) auth.onAuthStateChanged((user)=>{
  if(user){
    const name = user.displayName || user.email || "Utente";
    setUser(user.uid, name);
    syncFromCloud();
    hideModal();
    // Show welcome only on fresh login
    if(lastAuthUid !== user.uid){
      showWelcome(name);
    }
    lastAuthUid = user.uid;
  }else{
    setUser("guest","Guest");
    lastAuthUid = null;
  }
});

loadData();
init();
