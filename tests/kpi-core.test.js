"use strict";
const assert=require("node:assert/strict");
const {ratio,neededYes,neededNoToYes,validateCounts}=require("../kpi-core.js");

assert.equal(ratio(86,14,0),0.86);
assert.equal(ratio(0,0,0),null);
assert.equal(ratio(90,10,4),0.86);
assert.equal(neededYes(80,20,0,0.86),43);
assert.equal(neededYes(90,10,0,0.86),0);
assert.equal(neededNoToYes(80,20,0,0.86),6);
assert.deepEqual(validateCounts(10,2,3),{valid:true,message:""});
assert.equal(validateCounts(2,1,3).valid,false);
console.log("KPI core tests: OK");
