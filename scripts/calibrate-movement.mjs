import {build} from 'vite';
import {mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const out=path.resolve('.benchmark-output/calibration');await mkdir(out,{recursive:true});
await build({configFile:false,publicDir:false,logLevel:'warn',build:{ssr:'scripts/benchmarks/calibrate-movement.ts',outDir:out,emptyOutDir:true}});
await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(out,'calibrate-movement.js'),path.resolve(process.env.MOVEMENT_CALIBRATION_STAGE==='fixed'?'local/movement-calibration-results.json':'local/movement-calibration-road-results.json')],{stdio:'inherit'});child.on('error',reject);child.on('exit',c=>c===0?resolve():reject(new Error(`Calibration exited ${c}`)));});
