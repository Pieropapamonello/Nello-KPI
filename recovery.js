/* Recovery uses the same authenticated account and optimistic cloud check as editing. */
const recoveryDialog = document.createElement('dialog');
recoveryDialog.className = 'recoveryDialog';
recoveryDialog.innerHTML = `
  <form method="dialog"><button class="btnTiny recoveryClose" aria-label="Chiudi recupero">Chiudi</button></form>
  <h2>Le tue copie di sicurezza</h2>
  <p>Scarica i tuoi dati o confronta una copia prima di recuperarla. Le ultime 12 copie locali sono conservate su questo dispositivo.</p>
  <p class="recoveryStatus" role="status"></p>
  <button type="button" class="btnTiny recoveryExport">Scarica dati attuali (JSON)</button>
  <label for="recoverySelect">Copia da confrontare</label>
  <select id="recoverySelect"></select>
  <div class="recoveryPreview"></div>
  <button type="button" class="btnTiny recoveryRestore" disabled>Usa questa copia</button>`;
document.body.appendChild(recoveryDialog);
const recoveryButton = document.createElement('button');
recoveryButton.type='button'; recoveryButton.className='btnTiny';
recoveryButton.textContent='Backup e recupero';
document.querySelector('.top').appendChild(recoveryButton);
const recoverySelect=recoveryDialog.querySelector('select');
const recoveryStatus=recoveryDialog.querySelector('.recoveryStatus');
const recoveryPreview=recoveryDialog.querySelector('.recoveryPreview');
const recoveryRestore=recoveryDialog.querySelector('.recoveryRestore');
let recoveryChoices=[], recoveryUid=null, recoveryRemote=null, recoveryReady=false;

function recoveryDifferences(left,right){
  const result=[];
  for(const year of [...new Set([...Object.keys(left.years||{}),...Object.keys(right.years||{})])].sort()){
    const a=left.years?.[year]?.months||{}, b=right.years?.[year]?.months||{};
    for(const month of [...new Set([...Object.keys(a),...Object.keys(b)])].sort()){
      if(dataFingerprint(a[month]??null)!==dataFingerprint(b[month]??null)) result.push({year,month,before:a[month],after:b[month]});
    }
  }
  return result;
}
function recoveryMonthSummary(month){
  if(!month) return 'Mese assente';
  return ['phone','chat'].map(key=>{
    const ch=month.channels?.[key];
    if(!ch) return `${key==='phone'?'Telefono':'Messaggistica'}: assente`;
    const rows=ch.mode==='weekly'?(ch.weeks||[]):[ch.monthly||{}];
    const totals=rows.reduce((a,r)=>a.map((n,i)=>n+Number(r[['yes','no','rec'][i]]||0)),[0,0,0]);
    const value=ch.overridePercent!=null?`${(ch.overridePercent*100).toFixed(2)}%`:totals.join(' / ');
    return `${key==='phone'?'Telefono':'Messaggistica'}: ${value}; target ${ch.target}%`;
  }).join('\n');
}
function previewRecovery(){
  recoveryPreview.replaceChildren();
  const copy=recoveryChoices[Number(recoverySelect.value)];
  if(currentUser.uid!==recoveryUid){
    recoveryRestore.disabled=true;
    recoveryStatus.textContent='Account cambiato: chiudi e riapri il recupero.';
    return;
  }
  recoveryRestore.disabled=!copy || !recoveryReady;
  if(!copy) return;
  const diffs=recoveryDifferences(DATA,copy.data);
  const heading=document.createElement('p');
  heading.textContent=diffs.length?`${diffs.length} mesi cambierebbero. Conteggi: Sì / No / Ricontatti.`:'Questa copia coincide con i dati attuali.';
  recoveryPreview.appendChild(heading);
  recoveryRestore.disabled ||= diffs.length===0;
  for(const diff of diffs){
    const block=document.createElement('article');
    const title=document.createElement('strong');title.textContent=`${MONTHS_IT[diff.month]||diff.month} ${diff.year}`;
    const before=document.createElement('p');before.textContent='Attuale\n'+recoveryMonthSummary(diff.before);
    const after=document.createElement('p');after.textContent='Dopo il recupero\n'+recoveryMonthSummary(diff.after);
    block.append(title,before,after);recoveryPreview.appendChild(block);
  }
}
async function openRecovery(){
  recoveryUid=currentUser.uid; recoveryReady=false; recoveryRemote=null;
  recoveryChoices=readRecoveryCopies();
  recoveryStatus.textContent=isAuthed()?'Verifica delle copie online...':'Copie disponibili su questo dispositivo.';
  recoveryRestore.disabled=true;
  recoverySelect.replaceChildren();recoveryPreview.replaceChildren();
  recoveryDialog.showModal();
  if(isAuthed()){
    try{
      const snap=await userDocRef().get({source:'server'});
      if(currentUser.uid!==recoveryUid || !recoveryDialog.open) return;
      const remote=snap.exists?snap.data():null;
      if(snap.exists && !remote?.data?.years) throw Error('Dati cloud non validi');
      recoveryRemote=dataFingerprint(remote?.data??null);
      if(remote?.previousData?.years) recoveryChoices.unshift({label:'Versione cloud precedente',data:remote.previousData});
      if(remote?.data?.years) recoveryChoices.unshift({label:'Versione cloud attuale',data:remote.data});
      recoveryReady=true;
      recoveryStatus.textContent='Copie verificate. Puoi scegliere il cloud per risolvere un conflitto, oppure una versione precedente.';
    }catch(e){ recoveryStatus.textContent='Cloud non raggiungibile: puoi consultare le copie e scaricare i dati. Il ripristino sarà disponibile online.'; }
  }else recoveryReady=true;
  if(currentUser.uid!==recoveryUid || !recoveryDialog.open) return;
  recoveryChoices.forEach((copy,index)=>{
    const option=document.createElement('option');option.value=index;
    option.textContent=copy.label+(copy.at?' · '+new Date(copy.at).toLocaleString('it-IT'):'');
    recoverySelect.appendChild(option);
  });
  if(!recoveryChoices.length) recoveryStatus.textContent='Nessuna copia precedente disponibile. Le prossime modifiche creeranno copie automaticamente.';
  previewRecovery();
}
recoveryButton.addEventListener('click',openRecovery);
recoverySelect.addEventListener('change',previewRecovery);
recoveryDialog.querySelector('.recoveryExport').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify({schema:2,data:DATA},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url;link.download=`nello-kpi-backup-${new Date().toISOString().slice(0,10)}.json`;
  link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
recoveryRestore.addEventListener('click',async()=>{
  if(!recoveryReady || currentUser.uid!==recoveryUid || cloudWriteInFlight) return;
  const copy=recoveryChoices[Number(recoverySelect.value)];
  if(!copy || !confirm('Confermi il recupero dei mesi mostrati? La versione attuale resterà nelle copie locali.')) return;
  recoveryRestore.disabled=true;
  try{
    preserveRecoveryCopy(DATA,'Prima del recupero');
    cloudBaseData=recoveryRemote;
    DATA=JSON.parse(JSON.stringify(copy.data));
    if(isAuthed()){
      localStorage.setItem(pendingKey(),JSON.stringify({base:recoveryRemote}));
      cloudHydrated=true;
    }
    saveData();
    clearTimeout(cloudSaveTimer);
    if(isAuthed()) await saveCloudNow();
    if(currentUser.uid!==recoveryUid) return;
    rebuildYearMonthSelectors();resetSteps();updateMiniKpi();renderStats();
    recoveryStatus.textContent=isAuthed()&&hasPendingData()?'Copia conservata localmente, invio non completato. Riapri il recupero per verificare il cloud.':'Recupero completato.';
  }catch(e){ recoveryStatus.textContent='Recupero interrotto. Verifica lo spazio disponibile sul dispositivo.'; }
});
