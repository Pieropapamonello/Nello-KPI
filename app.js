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

async function loadCloudData(){
  if(!isAuthed()) return null;
  try{
    const snap = await userDocRef().get();
    if(snap.exists){
      const d = snap.data();
      if(d && d.data) return sanitizeData(d.data);
    }
  }catch(e){ console.warn("Cloud load failed:", e); }
  return null;
}

let cloudSaveTimer = null;
function scheduleCloudSave(){
  if(!isAuthed()) return;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(()=>{ saveCloudNow(); }, 800);
}

async function saveCloudNow(){
  if(!isAuthed()) return;
  try{
    await userDocRef().set({
      schema: 1,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      data: DATA
    }, { merge:true });
  }catch(e){ console.warn("Cloud save failed:", e); }
}

async function syncFromCloud(){
  if(!isAuthed()) return;
  const cloud = await loadCloudData();
  if(cloud){
    DATA = cloud;
    // persist locally for offline use
    try{ localStorage.setItem(storeKey(), JSON.stringify(DATA)); }catch(e){}
  }else{
    // first login: push local data up
    await saveCloudNow();
  }
  rebuildYearMonthSelectors();
  resetSteps();
  updateMiniKpi();
  renderStats();
}


function loadData(){
  const raw = localStorage.getItem(storeKey());
  if(!raw){ DATA = defaultData(); saveData(); return; }
  try{
    DATA = JSON.parse(raw);
    if(!DATA.years) throw new Error("bad");
  }catch(e){
    DATA = defaultData();
    saveData();
  }
}
function saveData(){ localStorage.setItem(storeKey(), JSON.stringify(DATA)); scheduleCloudSave(); }

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
const btnGoogle = document.getElementById("btnGoogle");

const btnLogout = document.getElementById("btnLogout");
const btnResendVerification = document.getElementById("btnResendVerification");
const loginError = document.getElementById("loginError");

const emailInput = document.getElementById("emailInput");
const passInput  = document.getElementById("passInput");
const btnEmailLogin  = document.getElementById("btnEmailLogin");
const btnEmailSignup = document.getElementById("btnEmailSignup");
const btnResetPass   = document.getElementById("btnResetPass");
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

let soundOn = true;
let hapticOn = true;
let lastAuthUid = null; // used to detect fresh login to show welcome toast

/* =========================================================
   Math
========================================================= */
function clampInt(n){ if(!Number.isFinite(n)||n<0) return 0; return Math.floor(n); }
function clampNum(n,min,max){ if(!Number.isFinite(n)) return min; return Math.min(max, Math.max(min,n)); }
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function ratio(yes,no,rec){
  const den = yes + no;
  if(den <= 0) return null;
  return (yes - rec) / den;
}
function neededYes(yes,no,rec,t){
  const d0 = yes + no, n0 = yes - rec;
  if(d0 <= 0) return 0;
  if((n0/d0) >= t) return 0;
  if(t >= 1) return Infinity;
  const rhs = (t*d0) - n0;
  return Math.max(0, Math.ceil((rhs/(1-t)) - 1e-12));
}
function neededNoToYes(yes,no,rec,t){
  const d = yes + no, n = yes - rec;
  if(d <= 0) return 0;
  const k = (t*d) - n;
  if(k <= 0) return 0;
  return Math.min(no, Math.ceil(k - 1e-12));
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

// Pointer / touch trail (throttled, respects prefers-reduced-motion)
(function(){
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

const myConfetti = confetti.create(document.getElementById("confettiCanvas"), { resize:true, useWorker:true });
function celebrate(){
  resultBox.classList.add("pulse");
  setTimeout(()=>resultBox.classList.remove("pulse"),450);
  myConfetti({ particleCount: 120, spread: 80, origin: { y: 0.62 } });
  setTimeout(()=>myConfetti({ particleCount: 70, spread: 110, origin: { y: 0.42 } }),140);
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
  // set aria-pressed for accessibility
  if(tabInput) tabInput.setAttribute('aria-pressed', name==='input' ? 'true' : 'false');
  if(tabStats) tabStats.setAttribute('aria-pressed', name==='stats' ? 'true' : 'false');

  viewInput.classList.toggle("hidden", name!=="input");
  viewStats.classList.toggle("hidden", name!=="stats");
  // restore toolbar visibility unless we're on input-focused view
  const toolbarEl = document.querySelector('.toolbar'); if(toolbarEl) toolbarEl.style.display = (name === 'input') ? 'none' : '';

  if(name==="stats") renderStats();
  if(name==="input"){
    // show only the channel choices (Telefono & Messaggistica) and hide all other extras for focus
    const choiceEl = document.querySelector('#viewInput .choiceRow');
    if(choiceEl){
      // show the row and ensure the two channel buttons are visible and everything else in the row is hidden
      choiceEl.style.display = '';
      Array.from(choiceEl.children).forEach(ch=>{
        if(ch.id === 'btnPhone' || ch.id === 'btnChat'){
          ch.classList.remove('hidden'); ch.style.display = ''; ch.classList.remove('hideOut');
        }else{
          ch.classList.add('hidden');
        }
      });
    }

    if(inlineTargetWrap){ inlineTargetWrap.classList.add('hidden'); inlineTargetWrap.classList.remove('showInlineWrap'); inlineTargetWrap.setAttribute('aria-hidden','true'); if(inlineTarget) inlineTarget.value=''; }
    if(sectionCanale){ sectionCanale.classList.remove('hidden'); }

    // hide mode selection and data sections so only channel choices show
    if(stepMode) stepMode.classList.add('hidden');
    if(monthlySection) monthlySection.classList.add('hidden');
    if(weeklySection) { weeklySection.classList.add('hidden'); weeklyAccordion.classList.remove('open'); if(accChevron) accChevron.textContent = '▾'; }
    // reset active state for month/week buttons
    if(btnMonthly) { btnMonthly.classList.remove('active'); btnMonthly.setAttribute('aria-pressed','false'); }
    if(btnWeekly) { btnWeekly.classList.remove('active'); btnWeekly.setAttribute('aria-pressed','false'); }

    // restore monthly reset/sum buttons for when user progresses past channel
    if(resetMonthlyBtn) resetMonthlyBtn.classList.remove('hidden');
    if(sumWeeksToMonthBtn) sumWeeksToMonthBtn.classList.remove('hidden');
  }
}
tabInput.addEventListener("click", ()=>{ tick(); setTab("input"); });
tabStats.addEventListener("click", ()=>{ tick(); setTab("stats"); });

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
  avatarImg.src="nello_ok.png";
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

    // hide choices, keep only insertion mode selection
    const choiceEl = document.querySelector('#viewInput .choiceRow'); if(choiceEl) choiceEl.style.display = 'none';
    if(inlineTargetWrap){ inlineTargetWrap.classList.add('hidden'); inlineTargetWrap.classList.remove('showInlineWrap'); inlineTargetWrap.setAttribute('aria-hidden','true'); if(inlineTarget) inlineTarget.value=''; }
    if(sectionCanale){ sectionCanale.classList.add('hidden'); }
    stepMode.classList.remove('hidden');
    if(resetMonthlyBtn) resetMonthlyBtn.classList.add('hidden');
    if(sumWeeksToMonthBtn) sumWeeksToMonthBtn.classList.add('hidden');
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
}

function saveFromInputs(){
  if(!channel) return;
  const chObj = getChannelObj(selectedYear, selectedMonth, channel);

  if(typeof inlineTarget !== 'undefined' && inlineTarget){ chObj.target = clampNum(Number(inlineTarget.value||0), 0, 100); }
  if(mode) chObj.mode = mode;

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
}

[m_yes,m_no,m_rec].forEach(el=>el.addEventListener("input", ()=>{
  saveFromInputs();
  updateMiniKpi();
  if(!resultBox.classList.contains("hidden")){
    renderResult(false);
    showLiveResultPulse();
  }
}));
for(const w of weeks){
  for(const k of ["yes","no","rec"]){
    wEl(w,k).addEventListener("input", ()=>{
      updateWeekButtons();
      saveFromInputs();
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
  const targetPct = clampNum(Number((typeof inlineTarget!=='undefined' && inlineTarget && inlineTarget.value) ? inlineTarget.value : 86), 0, 100);
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
    avatarImg.src="nello_ok.png";
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
    avatarImg.src="nello_ok.png";
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
    avatarImg.src="nello_ok.png";
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
    avatarImg.src="nello_ok.png";
  }else{
    percentEl.className="percent warn";
    messageEl.textContent=pick(frasiNegative);
    avatarImg.src="nello_angry.png";
  }

  const addYes = neededYes(data.yes, data.no, data.rec, t);
  const conv   = neededNoToYes(data.yes, data.no, data.rec, t);

  kpisEl.style.display="grid";
  kpisEl.innerHTML = hit ? `
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
  const targetPct = clampNum(Number((typeof inlineTarget!=='undefined' && inlineTarget && inlineTarget.value) ? inlineTarget.value : 86), 0, 100);
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
  const years = Object.keys(DATA.years||{});
  const yNow = nowYear();
  if(!years.includes(yNow)) years.push(yNow);
  years.sort();
  statsYear.innerHTML = years.map(y=>`<option value="${y}">${y}</option>`).join("");
  statsYear.value = selectedYear;
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

function renderStats(){
  rebuildStatsYears();
  statsUser.textContent = currentUser?.name || "Guest";

  const y = statsYear.value;
  const filter = statsChannel.value;

  const monthsObj = DATA.years?.[y]?.months || {};
  const sumPhone = summarizeYear(monthsObj, "phone");
  const sumChat  = summarizeYear(monthsObj, "chat");

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

  const monthCards = ["01","02","03","04","05","06","07","08","09","10","11","12"].map(mk=>{
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
  }).join("");

  const listHtml = monthCards.trim()
    ? `<div class="monthList">${monthCards}</div>`
    : `<div class="summaryMeta" style="margin-top:12px;">Nessun dato salvato per i filtri selezionati. Usa “Aggiungi dati mesi precedenti”.</div>`;

  statsGrid.innerHTML = summaryHtml + listHtml;
  // bind edit buttons (open backfill modal prefilled)
  statsGrid.querySelectorAll(".miniEdit").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      e.preventDefault(); e.stopPropagation();
      openHistoryModalWith(btn.dataset.y, btn.dataset.m, btn.dataset.ch);
    });
  });
}
statsChannel.addEventListener("change", ()=>{ tick(); renderStats(); });
statsYear.addEventListener("change", ()=>{ tick(); renderStats(); });


/* =========================================================
   HISTORY / BACKFILL (Stats)
========================================================= */
function fillHistYearMonth(){
  // years
  const years = Object.keys(DATA.years||{});
  const yNow = nowYear();
  if(!years.includes(yNow)) years.push(yNow);
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
  loginError.style.display="none";
  loginError.textContent="";
  modalOverlay.style.display="flex";
}
function hideModal(){ modalOverlay.style.display="none"; }

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
  currentUser = { uid: uid || "guest", name: name || "Guest" };
  userLine.textContent = currentUser.name;
  loginBtn.textContent = (currentUser.uid==="guest") ? "Login" : "Logout";

  loadData();
  rebuildYearMonthSelectors();
  resetSteps();
  updateMiniKpi();
  renderStats();
}

function showAuthErr(msg){
  loginError.textContent = msg;
  loginError.style.display = "block";
}

function mapAuthError(e){
  const code = (e && e.code) ? String(e.code) : "";
  if(code.includes("auth/unauthorized-domain")) return "Dominio non autorizzato su Firebase (Authorized domains).";
  if(code.includes("auth/popup-blocked")) return "Popup bloccato: consenti popup o riprova.";
  if(code.includes("auth/popup-closed-by-user")) return "Popup chiuso: riprova.";
  if(code.includes("auth/invalid-email")) return "Email non valida.";
  if(code.includes("auth/user-not-found")) return "Utente non trovato. Premi Registrati.";
  if(code.includes("auth/wrong-password")) return "Password errata.";
  if(code.includes("auth/email-already-in-use")) return "Email già registrata: usa Entra.";
  if(code.includes("auth/weak-password")) return "Password troppo debole (min 6 caratteri).";
  if(code.includes("auth/too-many-requests")) return "Troppi tentativi. Riprova più tardi.";
  return "Operazione non riuscita. Controlla Firebase e riprova.";
}

async function signInWith(provider){
  try{
    await auth.signInWithPopup(provider);
  }catch(e){
    try{
      await auth.signInWithRedirect(provider);
    }catch(e2){
      showAuthErr(mapAuthError(e2));
    }
  }
}

btnGoogle.addEventListener("click", async ()=>{ tick(); await signInWith(new firebase.auth.GoogleAuthProvider()); });

btnEmailLogin.addEventListener("click", async ()=>{
  tick();
  const email = (emailInput.value || "").trim();
  const pass  = passInput.value || "";
  if(!email || !pass) return showAuthErr("Inserisci email e password.");
  try{
    await auth.signInWithEmailAndPassword(email, pass);
  }catch(e){
    showAuthErr(mapAuthError(e));
  }
});

btnEmailSignup.addEventListener("click", async ()=>{
  tick();
  const email = (emailInput.value || "").trim();
  const pass  = passInput.value || "";
  if(!email || !pass) return showAuthErr("Inserisci email e password.");
  try{
    const uc = await auth.createUserWithEmailAndPassword(email, pass);
    // Try to send verification email
    try{
      if(uc && uc.user && !uc.user.emailVerified){
        await uc.user.sendEmailVerification();
        loginError.style.display = "block";
        loginError.style.color = "#a7ffcf";
        loginError.textContent = "Email di conferma inviata. Controlla la posta e conferma.";
        setTimeout(()=>{ loginError.style.color = "#ff9a9a"; }, 3000);
      }
    }catch(er){
      console.warn('Errore invio email verifica', er);
    }
    hideModal();
  }catch(e){
    showAuthErr(mapAuthError(e));
  }
});

btnResetPass.addEventListener("click", async ()=>{
  tick();
  const email = (emailInput.value || "").trim();
  if(!email) return showAuthErr("Inserisci l'email per il reset password.");
  try{
    await auth.sendPasswordResetEmail(email);
    loginError.style.display = "block";
    loginError.style.color = "#a7ffcf";
    loginError.textContent = "Email di reset inviata. Controlla la posta.";
    setTimeout(()=>{ loginError.style.color = "#ff9a9a"; }, 1500);
  }catch(e){
    showAuthErr(mapAuthError(e));
  }
});

// Reinvia email di conferma se l'utente non ha ancora verificato l'email
if(btnResendVerification){
  btnResendVerification.addEventListener('click', async ()=>{
    tick();
    const user = auth.currentUser;
    if(!user) return showAuthErr("Nessun utente loggato.");
    try{
      if(user.emailVerified){
        loginError.style.display = "block";
        loginError.style.color = "#a7ffcf";
        loginError.textContent = "Email già verificata.";
        setTimeout(()=>{ loginError.style.color = "#ff9a9a"; }, 1500);
        return;
      }
      await user.sendEmailVerification();
      loginError.style.display = "block";
      loginError.style.color = "#a7ffcf";
      loginError.textContent = "Email di conferma reinviata. Controlla la posta.";
      setTimeout(()=>{ loginError.style.color = "#ff9a9a"; }, 3000);
    }catch(e){
      showAuthErr(mapAuthError(e));
    }
  });
}

btnLogout.addEventListener("click", async ()=>{
  tick();
  try{ await auth.signOut(); }catch(e){}
  setUser("guest","Guest");
  hideModal();
});

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
  // Try to start ambient music automatically (may be blocked by browser until user gesture)
  try{ soundOn = true; ensureAudio(); startAmbient(); }catch(e){}

}

function showWelcome(name){
  try{
    const t = document.getElementById('welcomeToast');
    const n = document.getElementById('welcomeName');
    if(!t || !n) return;
    n.textContent = "Ben tornato, " + name + "";
    t.classList.remove('hidden');
    // force reflow then show
    void t.offsetWidth;
    t.classList.add('show');
    setTimeout(()=>{ t.classList.remove('show'); t.classList.add('hidden'); }, 2600);
  }catch(e){ console.warn(e); }
}

auth.onAuthStateChanged((user)=>{
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

    // Show or hide resend confirmation button based on email verification
    if(btnResendVerification){
      if(user.emailVerified){
        btnResendVerification.classList.add('hidden');
        loginError.style.display = 'none';
      }else{
        btnResendVerification.classList.remove('hidden');
        loginError.style.display = 'block';
        loginError.style.color = '#ffb84d';
        loginError.textContent = 'Email non verificata. Premi Reinvia conferma.';
      }
    }
  }else{
    setUser("guest","Guest");
    lastAuthUid = null;
    if(btnResendVerification) btnResendVerification.classList.add('hidden');
  }
});
auth.getRedirectResult().catch(()=>{});

loadData();
init();
