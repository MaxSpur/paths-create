import {build} from 'vite';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
await mkdir('.benchmark-output',{recursive:true});
const bundle=await mkdtemp(path.resolve('.benchmark-output/netmob-run-'));
try{
  await build({configFile:false,publicDir:false,logLevel:'warn',build:{ssr:'scripts/netmob/run.ts',outDir:bundle,emptyOutDir:true,rollupOptions:{output:{entryFileNames:'run.mjs'}}}});
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--expose-gc','--max-old-space-size=2048',path.join(bundle,'run.mjs'),...process.argv.slice(2)],{stdio:'inherit'});
    const stop=()=>child.kill('SIGINT');process.on('SIGINT',stop);process.on('SIGTERM',stop);
    const cleanup=()=>{process.off('SIGINT',stop);process.off('SIGTERM',stop);};
    child.on('error',error=>{cleanup();reject(error);});child.on('exit',code=>{cleanup();code===0?resolve():reject(new Error(`Runner exited ${code}`));});
  });
}finally{await rm(bundle,{recursive:true,force:true});}
