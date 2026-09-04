"use strict";
const fs=require("node:fs");
const path=require("node:path");
const {execFileSync}=require("node:child_process");

const root=path.resolve(__dirname,"..");
const files=execFileSync("git",["ls-files","-z"],{cwd:root}).toString().split("\0").filter(Boolean);
const patterns=[
  {name:"GitHub token",regex:/\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/},
  {name:"private key",regex:/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/},
  {name:"Telegram bot token",regex:/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/}
];
const findings=[];
for(const file of files){
  const full=path.join(root,file);
  if(!fs.statSync(full).isFile()) continue;
  const content=fs.readFileSync(full,"utf8");
  for(const pattern of patterns) if(pattern.regex.test(content)) findings.push(`${pattern.name}: ${file}`);
}
if(findings.length){
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log("Tracked-file secret scan: OK");
