(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined" && module.exports) module.exports=api;
  else root.NelloKpiMath=api;
})(typeof globalThis!=="undefined" ? globalThis : this,function(){
  "use strict";

  function ratio(yes,no,rec){
    const den=yes+no;
    if(den<=0) return null;
    return (yes-rec)/den;
  }

  function neededYes(yes,no,rec,target){
    const den=yes+no;
    const numerator=yes-rec;
    if(den<=0) return 0;
    if((numerator/den)>=target) return 0;
    if(target>=1) return Infinity;
    return Math.max(0,Math.ceil((((target*den)-numerator)/(1-target))-1e-12));
  }

  function neededNoToYes(yes,no,rec,target){
    const den=yes+no;
    const numerator=yes-rec;
    if(den<=0) return 0;
    const needed=(target*den)-numerator;
    if(needed<=0) return 0;
    return Math.min(no,Math.ceil(needed-1e-12));
  }

  function validateCounts(yes,no,rec){
    if([yes,no,rec].some(value=>!Number.isFinite(value)||value<0)) return {valid:false,message:"Inserisci solo numeri positivi."};
    if(rec>yes) return {valid:false,message:"Ric non può essere maggiore dei Sì."};
    return {valid:true,message:""};
  }

  return {ratio,neededYes,neededNoToYes,validateCounts};
});
