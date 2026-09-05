const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const storageSource = source.slice(source.indexOf('const APP_KEY_BASE'),source.indexOf('function ensurePath'));

function harness(){
  const memory = new Map();
  const state = {remote:{data:{years:{2026:{months:{'09':{yes:6}}}}}}, writes:0, fail:false};
  const snap = ()=>({exists:!!state.remote,data:()=>structuredClone(state.remote)});
  const ref = {get:async()=>{if(state.fail) throw Error('offline'); return snap();}};
  const ctx = vm.createContext({
    console:{warn(){}},setTimeout:()=>1,clearTimeout(){},
    localStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},
    document:{getElementById:()=>null},window:{addEventListener(){}},
    firebaseEnabled:true,firebase:{firestore:{FieldValue:{serverTimestamp:()=>null}}},
    db:{collection:()=>({doc:()=>ref}),runTransaction:async fn=>{
      if(state.fail) throw Error('offline');
      await fn({get:async()=>snap(),set:(_ref,payload)=>{state.remote=structuredClone(payload);state.writes++;}});
    }},
    rebuildYearMonthSelectors(){},resetSteps(){},updateMiniKpi(){},renderStats(){}
  });
  vm.runInContext(storageSource,ctx);
  const run = code=>vm.runInContext(code,ctx);
  run('currentUser={uid:"test",name:"Test"}');
  return {state,run,memory};
}

test('first login with empty local storage never writes defaults over cloud',async()=>{
  const h=harness(); h.run('loadData()'); await h.run('syncFromCloud()');
  assert.equal(h.state.writes,0);
  assert.equal(h.run('DATA.years[2026].months["09"].yes'),6);
});
test('offline changes survive reload and are sent after reconnect',async()=>{
  const h=harness(); await h.run('syncFromCloud()');
  h.state.fail=true;
  h.run('DATA.years[2026].months["09"].yes=7;saveData()');
  await h.run('saveCloudNow()');
  h.run('DATA=defaultData();cloudHydrated=false;cloudBaseData=null;loadData()');
  h.state.fail=false; await h.run('syncFromCloud()');
  assert.equal(h.state.remote.data.years[2026].months['09'].yes,7);
  assert.equal(h.run('hasPendingData()'),false);
});
test('concurrent device edit preserves both remote and local copies',async()=>{
  const h=harness(); await h.run('syncFromCloud()');
  h.run('DATA.years[2026].months["09"].yes=7;saveData()');
  h.state.remote.data.years[2026].months['09'].yes=9;
  await h.run('syncFromCloud()');
  assert.equal(h.state.writes,0);
  assert.equal(h.state.remote.data.years[2026].months['09'].yes,9);
  assert.equal(h.run('DATA.years[2026].months["09"].yes'),7);
  assert.equal(h.run('hasPendingData()'),true);
});
test('failed server reads do not create cloud documents',async()=>{
  const h=harness(); h.state.fail=true;
  await h.run('syncFromCloud()'); await h.run('saveCloudNow()');
  assert.equal(h.state.writes,0);
});
test('malformed cloud document is not replaced with defaults',async()=>{
  const h=harness(); h.state.remote={data:{bad:true}};
  await h.run('syncFromCloud()'); await h.run('saveCloudNow()');
  assert.equal(h.state.writes,0);
});
test('object field order does not produce false conflicts',()=>{
  const h=harness();
  assert.equal(h.run('dataFingerprint({b:2,a:1})===dataFingerprint({a:1,b:2})'),true);
});
test('backup history preserves snapshots and keeps the latest twelve',()=>{
  const h=harness();
  h.run('for(let i=0;i<15;i++) preserveRecoveryCopy({years:{2026:{value:i}}},"Edit")');
  assert.equal(h.run('readRecoveryCopies().length'),12);
  assert.equal(h.run('readRecoveryCopies()[0].data.years[2026].value'),14);
  h.run('preserveRecoveryCopy({years:{2026:{value:14}}},"Same")');
  assert.equal(h.run('readRecoveryCopies().length'),12);
});
test('cloud conflict during write blocks the overwrite',async()=>{
  const h=harness();await h.run('syncFromCloud()');
  h.run('DATA.years[2026].months["09"].yes=7;saveData()');
  h.state.remote.data.years[2026].months['09'].yes=10;
  await h.run('saveCloudNow()');
  assert.equal(h.state.writes,0);
  assert.equal(h.run('hasPendingData()'),true);
});
test('backups are separated by account',()=>{
  const h=harness();h.run('preserveRecoveryCopy(DATA,"Edit")');
  h.run('currentUser={uid:"other"}');
  assert.equal(h.run('readRecoveryCopies().length'),0);
});
test('recovery comparison includes added and removed months',()=>{
  const h=harness();
  const recovery=fs.readFileSync(path.join(__dirname,'../recovery.js'),'utf8');
  h.run(recovery.slice(recovery.indexOf('function recoveryDifferences'),recovery.indexOf('function previewRecovery')));
  assert.equal(h.run('recoveryDifferences({years:{2026:{months:{"09":{}}}}},{years:{2026:{months:{"10":{}}}}}).length'),2);
});
