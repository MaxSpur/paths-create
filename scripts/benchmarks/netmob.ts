import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {gunzipSync} from "node:zlib";
import {asyncBufferFromFile} from "hyparquet";
import {importNetmob} from "../../src/lib/netmobData";
import {DEFAULT_FIT} from "../../src/lib/netmobTypes";
import {generateNetmobBatch,routingContext} from "../../src/lib/netmobRouting";
import {OrsClient} from "../../src/lib/orsClient";
const count=Number(process.argv[2]??0);
const output=process.argv[3];
const supplement=JSON.parse(readFileSync("public/data/netmob-boundaries.json","utf8")).areas;
const imports=[];
let dataset;
for(const name of ["emg-base-des-deplacements","date_heure_1h_micro"]){
  const path=`local/${name}.parquet`;const bytes=readFileSync(path);const id=createHash("sha256").update(bytes).digest("hex");
  const data=await importNetmob(await asyncBufferFromFile(path),name,id,supplement);
  const started=performance.now();const q=data.query({origin:name.startsWith("emg")?"751":"700",timeFrom:"07:00",timeTo:"10:00"},0);
  imports.push({name,rows:data.summary.rows,eligible:data.summary.eligible,areas:data.summary.areas,exclusions:data.summary.exclusions,sha256:data.summary.id,ms:data.summary.importMs,queryMs:performance.now()-started,queryRows:q.total});
  if(name.startsWith("emg"))dataset=data;
}
const report:Record<string,unknown>={created:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,imports,count};
if(count){
  const network=JSON.parse(gunzipSync(readFileSync("public/data/idfm-netmob-transit.json.gz")).toString());
  const timing=JSON.parse(gunzipSync(readFileSync("public/data/idfm-timing.json.gz")).toString());
  const modes=["MAP","VPC","VELO","VAE","METRO","BUS","RER/TRAIN","TROTTINETTE","2RM","AUTRE"];
  const groups=modes.map(mode=>dataset!.records.filter(r=>!r.exclusions.length&&r.durationS&&r.departure&&String(r.raw.mode_principal).toUpperCase()===mode).sort((a,b)=>a.key.localeCompare(b.key)));
  const records=Array.from({length:count},(_,i)=>groups[i%groups.length][Math.floor(i/groups.length)]);
  const context=routingContext(new OrsClient({apiKey:"",local:true,maxRetries:0}),new AbortController().signal,network,timing);
  const result=await generateNetmobBatch(context,dataset!.summary.id,records,dataset!.areas,DEFAULT_FIT,(done,total)=>{if(done%10===0)console.error(`${done}/${total}`);});
  const errors=result.trips.map(t=>Math.abs(t.exportInput!.netmob!.fit.errorS??0)).sort((a,b)=>a-b);
  report.sources={network:network.version,timing:timing.version,gtfsSha256:timing.source.sha256};
  report.settings={...DEFAULT_FIT,maxAccessM:1500,maxCyclingM:5000};
  report.routing={elapsedMs:result.report.netmob.elapsedMs,requests:result.report.netmob.requests,cacheHits:result.report.netmob.cacheHits,generated:result.trips.length,failed:result.report.failedTrips,acceptable:result.report.netmob.acceptable,poor:result.report.netmob.poor,medianAbsoluteErrorS:errors[Math.floor(errors.length/2)]??null,serviceStopped:result.report.netmob.serviceStopped,
    withinArea:records.filter(r=>r.origin===r.destination).length,modes:Object.fromEntries(modes.map(m=>[m,records.filter(r=>String(r.raw.mode_principal).toUpperCase()===m).length])),
    failures:result.report.netmob.failed.map(f=>f.reason)};
}
report.peakRssMiB=process.resourceUsage().maxRSS/1024;
if(output)writeFileSync(output,JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
