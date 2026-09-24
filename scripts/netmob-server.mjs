import {createHash} from 'node:crypto';
import {build} from 'vite';
import {mkdir,mkdtemp,rm,readdir,readFile,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
await mkdir('local',{recursive:true});
if(await realpath('local')!==path.resolve('local'))throw new Error('Local input root must not be a symlink.');
await mkdir('local/netmob-runs',{recursive:true});
// One small visible runtime bundle; no public assets, source copies or geometry cache.
const bundle=await mkdtemp(path.resolve('local/netmob-controller-'));
try {
  await build({configFile:false,publicDir:false,logLevel:'warn',build:{ssr:true,outDir:bundle,emptyOutDir:true,rollupOptions:{input:{server:'scripts/netmob/server.ts',run:'scripts/netmob/run.ts'},output:{entryFileNames:'[name].mjs'}}}});
  const files=['package-lock.json',...(await readdir('src/lib')).filter(f=>f.endsWith('.ts')).map(f=>`src/lib/${f}`),'scripts/netmob/run.ts','scripts/netmob/jobStore.ts','scripts/netmob/request.ts'];
  const hash=createHash('sha256');for(const file of files.sort()){hash.update(file);hash.update(await readFile(file));}
  const code=hash.digest('hex');
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[path.join(bundle,'server.mjs')],{stdio:'inherit',env:{...process.env,NETMOB_BUNDLE_CODE:code}});
    const stop=()=>child.kill('SIGTERM');process.on('SIGINT',stop);process.on('SIGTERM',stop);
    const cleanup=()=>{process.off('SIGINT',stop);process.off('SIGTERM',stop);};
    child.once('error',e=>{cleanup();reject(e);});child.once('exit',code=>{cleanup();process.exitCode=code??1;resolve();});
  });
} finally {await rm(bundle,{recursive:true,force:true});}
