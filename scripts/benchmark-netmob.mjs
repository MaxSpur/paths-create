import {build} from 'vite';
import {mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const counts=(process.argv[2]??'0').split(',').map(Number);
if(counts.some(c=>!Number.isInteger(c)||c<0||c>1000))throw new Error('Use counts 0–1000; 0 measures import only. Positive counts call local ORS only.');
const out=path.resolve('.benchmark-output/netmob');await mkdir(out,{recursive:true});
await build({configFile:false,logLevel:'warn',build:{ssr:'scripts/benchmarks/netmob.ts',outDir:out,emptyOutDir:false}});
for(const count of counts)await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(out,'netmob.js'),String(count),path.join(out,`results-${count}.json`)],{stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Benchmark exited ${code}`)));});
