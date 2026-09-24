import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {spawn,type ChildProcess} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readdir,mkdir,lstat,realpath,statfs} from 'node:fs/promises';
import path from 'node:path';
import {readRun,inspectRun,runRows,type Checkpoint,type RunConfig} from './jobStore';
import {validateRequest,safeName,integer} from './request';
import {outcomePage,previewRow} from './preview';
import type {LocalJob,LocalRunProgress} from '../../src/lib/localRunTypes';

const allowedOrigins=new Set(['http://127.0.0.1:5198','http://localhost:5198','http://127.0.0.1:4198','http://localhost:4198']);
interface Managed {job:LocalJob;config?:RunConfig;checkpoint?:Checkpoint}
interface Options {root:string;worker:string;port?:number;spawnWorker?:typeof spawn}
/** Loopback-only controller. No uploads, shell strings, arbitrary paths or file deletion API. */
export async function createManager({root,worker,port=5199,spawnWorker=spawn}:Options){
  root=await realpath(root);const sourceRoot=path.join(root,'local'),outputRoot=path.join(sourceRoot,'netmob-runs');
  await mkdir(sourceRoot,{recursive:true});
  if(await realpath(sourceRoot)!==sourceRoot)throw new Error('Local input root must not be a symlink.');
  await mkdir(outputRoot,{recursive:true});
  if(await realpath(outputRoot)!==outputRoot)throw new Error('Local input and output roots must not be symlinks.');
  const token=randomBytes(32).toString('hex'),jobs=new Map<string,Managed>();let active:ChildProcess|undefined,activeId:string|null=null,actionPending=false,closing=false;
  let orsReady=false,orsMessage='Checking local ORS…',orsChild:ChildProcess|undefined,checkingOrs=false,previewBusy=false;
  const folder=(id:string)=>path.join(outputRoot,safeName(id));
  async function refresh(id:string){
    const entry=jobs.get(id)??{job:{id,output:folder(id),label:id,state:'ready'} as LocalJob};jobs.set(id,entry);
    try{
      const config=await readRun(folder(id)),checkpoint=await inspectRun(folder(id),config,true);entry.config=config;entry.checkpoint=checkpoint;
      const old=entry.job.progress;
      entry.job.configuration={source:config.source,sourceHash:config.sourceHash,filter:config.filter??{},settings:config.settings,variation:config.variation,partRows:config.partRows,maxAccessM:config.maxAccessM,maxCyclingM:config.maxCyclingM,minFreeBytes:config.minFreeBytes};
      entry.job.progress={...old,processed:checkpoint.nextRow,committed:checkpoint.nextRow,total:runRows(config),parts:checkpoint.parts,counts:checkpoint.counts,bytes:checkpoint.bytes,maxOutputBytes:config.maxOutputBytes};
      entry.job.label=config.label??id;
      if(entry.job.state!=='error')entry.job.state=checkpoint.nextRow===runRows(config)?'complete':checkpoint.nextRow?'paused':'ready';
    }catch(e){entry.config=undefined;entry.checkpoint=undefined;entry.job.state='error';entry.job.error=String(e);}
  }
  const saved=(await readdir(outputRoot,{withFileTypes:true})).filter(e=>e.isDirectory());
  const dated=await Promise.all(saved.map(async e=>({name:e.name,time:await lstat(path.join(outputRoot,e.name,'run.json')).then(s=>s.mtimeMs,()=>0)})));
  for(const entry of dated.sort((a,b)=>a.time-b.time||a.name.localeCompare(b.name)))await refresh(entry.name);
  async function checkOrs(){if(checkingOrs)return;checkingOrs=true;try{const r=await fetch('http://127.0.0.1:8082/ors/v2/health',{signal:AbortSignal.timeout(2000)});orsReady=r.ok;orsMessage=r.ok?'Local ORS ready':'Local ORS starting or unavailable';}catch{orsReady=false;orsMessage='Local ORS unavailable';}finally{checkingOrs=false;}}
  void checkOrs();const healthTimer=setInterval(()=>void checkOrs(),5000);healthTimer.unref();
  async function launch(id:string,command:'init'|'run',extra:string[],request?:unknown){
    if(active||orsChild||actionPending||closing)throw new Error('Another controlled process is active.');actionPending=true;
    try{
      if(command==='run'){
        await refresh(id);const entry=jobs.get(id)!;if(!entry.config||!entry.checkpoint)throw new Error(entry.job.error??'Cannot resume this job.');
        // A job may only read the selected source inside the local input root.
        if(path.dirname(entry.config.source)!==sourceRoot||await realpath(entry.config.source)!==entry.config.source)throw new Error('Job source is outside the allowed local folder.');
      }
      const entry=jobs.get(id)??{job:{id,output:folder(id),label:id,state:'initializing'} as LocalJob};jobs.set(id,entry);
      entry.job.state=command==='init'?'initializing':'running';entry.job.error=undefined;
      if(entry.job.progress)Object.assign(entry.job.progress,{requestsThisInvocation:0,elapsedS:0,paused:null,rssMiB:undefined,rowIndex:undefined,trial:undefined,trials:undefined});
      const child=spawnWorker(process.execPath,['--expose-gc','--max-old-space-size=2048',worker,command,'--output',folder(id),...extra],{cwd:root,stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,...(request?{NETMOB_REQUEST:JSON.stringify(request)}:{})}});
      active=child;activeId=id;let tail='';const capture=(chunk:Buffer)=>{tail=(tail+chunk.toString()).slice(-3000);};child.stdout?.on('data',capture);child.stderr?.on('data',capture);
      child.on('message',message=>{if(!message||typeof message!=='object')return;if('error'in message&&typeof message.error==='string')entry.job.error=message.error;if('processed'in message)entry.job.progress=message as LocalRunProgress;});
      // Publish committed rows during execution without rescanning the files on every browser poll.
      let finished=false;
      const finish=async(error?:string)=>{if(finished)return;finished=true;if(error){entry.job.state='error';entry.job.error=error;}else entry.job.state='paused';await refresh(id);if(active===child){active=undefined;activeId=null;}};
      child.once('error',e=>void finish(e.message));child.once('close',(code,signal)=>void finish(code===0?undefined:entry.job.error??`Worker stopped (${signal??code}). ${tail}`));
    }finally{actionPending=false;}
  }
  async function body(req:IncomingMessage){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>16384)throw new Error('Request too large.');}return JSON.parse(text||'{}');}
  function reply(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
  const server=createServer(async(req,res)=>{
    const origin=req.headers.origin;
    // Exact Host blocks DNS rebinding. A per-launch token and strict Origin protect every data/control call.
    const listeningPort=(server.address() as {port:number}|null)?.port??port;
    if(req.headers.host!==`127.0.0.1:${listeningPort}`&&req.headers.host!==`localhost:${listeningPort}`){reply(res,403,{error:'Invalid host.'});return;}
    if(!origin||!allowedOrigins.has(origin)){reply(res,403,{error:'Only the local app may connect.'});return;}
    res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
    if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Netmob-Token');reply(res,204,null);return;}
    if(req.url==='/session'&&req.method==='GET'){reply(res,200,{token});return;}
    if(req.headers['x-netmob-token']!==token){reply(res,403,{error:'Reconnect to the local runner.'});return;}
    try{
      const url=new URL(req.url??'/',`http://127.0.0.1:${port}`),parts=url.pathname.split('/').filter(Boolean);
      if(req.method==='GET'&&url.pathname==='/status'){
        const sources=[];for(const entry of await readdir(sourceRoot,{withFileTypes:true}))if(entry.isFile()&&entry.name.endsWith('.parquet'))sources.push({name:entry.name,bytes:(await lstat(path.join(sourceRoot,entry.name))).size});
        const disk=await statfs(outputRoot);reply(res,200,{outputRoot,freeBytes:disk.bavail*disk.bsize,activeId,orsReady,orsMessage,sources,jobs:[...jobs.values()].map(e=>e.job)});return;
      }
      if(req.method==='POST'&&url.pathname==='/jobs'){
        const request=validateRequest(await body(req)),source=path.join(sourceRoot,request.sourceName);if(await realpath(source)!==source||!(await lstat(source)).isFile())throw new Error('Source must be a regular Parquet file in local/.');
        const id=request.name;if(jobs.has(id))throw new Error('That job already exists. Choose another folder name.');
        await launch(id,'init',['--source',source],request);reply(res,202,{id});return;
      }
      if(req.method==='POST'&&url.pathname==='/ors/start'){
        if(active||orsChild||closing)throw new Error('Wait for the current process to finish.');
        orsChild=spawnWorker(process.execPath,[path.join(root,'scripts/local-ors.mjs'),'start'],{cwd:root,stdio:['ignore','pipe','pipe']});
        let tail='';const capture=(b:Buffer)=>{tail=(tail+b.toString()).slice(-1500);};orsChild.stdout?.on('data',capture);orsChild.stderr?.on('data',capture);
        orsMessage='Starting local ORS…';orsChild.once('error',e=>{orsMessage=e.message;orsChild=undefined;});orsChild.once('exit',()=>{orsMessage=tail||'ORS start command finished.';orsChild=undefined;void checkOrs();});reply(res,202,{});return;
      }
      const id=parts[1],entry=id?jobs.get(id):undefined;if(parts[0]!=='jobs'||!entry)throw new Error('Unknown job.');
      if(req.method==='POST'&&parts[2]==='start'){
        const value=await body(req),maxRows=value.maxRows==='all'?'all':String(integer(value.maxRows,1,10000,'Stage rows'));
        if(!orsReady)throw new Error('Start local ORS and wait until it is ready.');await launch(id,'run',['--max-rows',maxRows]);reply(res,202,{});return;
      }
      if(req.method==='POST'&&parts[2]==='pause'){
        if(activeId!==id||!active)throw new Error('This job is not running.');entry.job.state='pausing';active.kill('SIGTERM');reply(res,202,{});return;
      }
      if(req.method==='GET'&&['rows','preview'].includes(parts[2])){
        if(previewBusy)throw new Error('Another preview is loading.');previewBusy=true;
        try{
          // A receipt appears only after the atomic commit, so browsing never sees partial geometry.
          if(entry.checkpoint?.nextRow!==entry.job.progress?.committed)entry.checkpoint=await inspectRun(folder(id),entry.config!,true);
          if(!entry.checkpoint)throw new Error('No committed rows yet.');
          const offset=integer(Number(url.searchParams.get('offset')??0),0,1000000,'Row offset');
          reply(res,200,parts[2]==='rows'?await outcomePage(folder(id),entry.checkpoint,offset):await previewRow(folder(id),entry.checkpoint,offset));return;
        }finally{previewBusy=false;}
      }
      reply(res,404,{error:'Unknown action.'});
    }catch(e){reply(res,400,{error:e instanceof Error?e.message:String(e)});}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  return {server,token,async close(){closing=true;clearInterval(healthTimer);if(active){const child=active;await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill('SIGTERM');});}await new Promise<void>(resolve=>server.close(()=>resolve()));},outputRoot};
}
