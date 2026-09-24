import {build} from 'vite';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
const count=Number(process.argv[2]??100);
if(!Number.isInteger(count)||count<0||count>1000)throw new Error('Use 0–1000 source rows; positive counts query local ORS.');
await mkdir('.benchmark-output',{recursive:true});
const bundle=await mkdtemp(path.resolve('.benchmark-output/scale-'));
try{
  await build({configFile:false,publicDir:false,logLevel:'warn',build:{ssr:'scripts/benchmarks/netmob-scale.ts',outDir:bundle,emptyOutDir:true,rollupOptions:{output:{entryFileNames:'netmob-scale.mjs'}}}});
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--expose-gc','--max-old-space-size=2048',path.join(bundle,'netmob-scale.mjs'),String(count)],{stdio:'inherit'});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Scale benchmark exited ${code}`)));
  });
}finally{await rm(bundle,{recursive:true,force:true});}
