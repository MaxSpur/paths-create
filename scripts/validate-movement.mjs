import {build} from 'vite';
import {mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const out=path.resolve('.benchmark-output/movement-validation');await mkdir(out,{recursive:true});
await build({configFile:false,publicDir:false,logLevel:'warn',build:{ssr:'scripts/benchmarks/validate-movement.ts',outDir:out,emptyOutDir:true}});
await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(out,'validate-movement.js'),path.resolve('local/movement-validation-results.json')],{stdio:'inherit'});child.on('error',reject);child.on('exit',c=>c===0?resolve():reject(new Error(`Validation exited ${c}`)));});
