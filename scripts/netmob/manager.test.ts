// @vitest-environment node
import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,readdir,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {request as httpRequest} from 'node:http';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcess,spawn} from 'node:child_process';
import {createManager} from './manager';
import {createRun,commitPart,inspectRun,type RunConfig} from './jobStore';
import {validateRequest} from './request';
import {DEFAULT_FIT} from '../../src/lib/netmobTypes';
import {DEFAULT_SIMULATION} from '../../src/lib/movementSimulation';
import type {LocalRunRequest} from '../../src/lib/localRunTypes';
let root:string,manager:Awaited<ReturnType<typeof createManager>>,base:string,child:ChildProcess;
const request:LocalRunRequest={name:'metro-test',sourceName:'emg.parquet',sourceHash:'a'.repeat(64),expectedRows:2,filter:{mode:'METRO'},settings:{...DEFAULT_FIT,durationModel:'movement'},variation:null,maxAccessM:1500,maxCyclingM:5000,partRows:2,maxOutputMiB:8,minFreeMiB:64};
const config:RunConfig={schemaVersion:2,source:'',sourceHash:request.sourceHash,sourceRows:5,selection:[1,4],filter:request.filter,settings:{...request.settings,movement:DEFAULT_SIMULATION},versions:{fixture:'1'},variation:null,partRows:2,maxOutputBytes:8*2**20,minFreeBytes:0};
let launched:unknown[][]=[];
const spawnFake=((...args:unknown[])=>{launched.push(args);const fake=new EventEmitter() as ChildProcess;fake.stdout=new PassThrough();fake.stderr=new PassThrough();fake.kill=()=>{queueMicrotask(()=>{fake.emit('exit',0,null);fake.emit('close',0,null);});return true;};child=fake;return fake;}) as typeof spawn;
async function api(url:string,body?:unknown,headers:Record<string,string>={}){return fetch(base+url,{method:body===undefined?'GET':'POST',headers:{Origin:'http://127.0.0.1:5198','X-Netmob-Token':manager.token,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
beforeEach(async()=>{
  root=await realpath(await mkdtemp(path.join(tmpdir(),'netmob-manager-test-')));await mkdir(path.join(root,'local'));await writeFile(path.join(root,'local/emg.parquet'),'fixture');launched=[];
  // Mock only the fixed local ORS probe, retaining actual loopback HTTP for controller tests.
  const realFetch=globalThis.fetch;vi.spyOn(globalThis,'fetch').mockImplementation((url,init)=>String(url).includes(':8082/')?Promise.resolve(new Response('{}')):realFetch(url,init));
  manager=await createManager({root,worker:'fixture-worker.mjs',port:0,spawnWorker:spawnFake});await new Promise<void>((resolve,reject)=>{manager.server.once('error',reject);manager.server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(manager.server.address() as {port:number}).port}`;
});
afterEach(async()=>{await manager.close();await rm(root,{recursive:true,force:true});vi.restoreAllMocks();});
it('rejects foreign origins, missing token, rebinding hosts and traversal without writing',async()=>{
  expect((await api('/status',undefined,{Origin:'https://evil.example'})).status).toBe(403);
  expect((await api('/status',undefined,{'X-Netmob-Token':''})).status).toBe(403);
  const rebound=await new Promise<number|undefined>((resolve,reject)=>{const req=httpRequest(base+'/status',{headers:{Host:'evil.example',Origin:'http://127.0.0.1:5198','X-Netmob-Token':manager.token}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});expect(rebound).toBe(403);
  expect((await api('/session')).status).toBe(200);
  expect((await api('/jobs',{...request,name:'../escape'})).status).toBe(400);
  await symlink(path.join(root,'local/emg.parquet'),path.join(root,'local/link.parquet'));
  expect((await api('/jobs',{...request,sourceName:'link.parquet'})).status).toBe(400);
  expect(await readdir(manager.outputRoot)).toEqual([]);expect(launched).toHaveLength(0);
});
it('has one worker, persists pinned filters, reconnects status, pauses and pages committed original rows',async()=>{
  expect((await api('/jobs',request)).status).toBe(202);expect((await api('/jobs',{...request,name:'second'})).status).toBe(400);
  const output=path.join(manager.outputRoot,request.name);await createRun(output,{...config,source:path.join(root,'local/emg.parquet')});
  child.emit('close',0,null);await vi.waitFor(async()=>expect((await (await api('/status')).json()).activeId).toBeNull());
  expect((await api(`/jobs/${request.name}/start`,{maxRows:100})).status).toBe(202);
  child.emit('message',{processed:1,committed:0,total:2,parts:0,counts:{},bytes:0,maxOutputBytes:8*2**20,rowIndex:1,trial:3,trials:12});
  const connected=await (await api('/status')).json();expect(connected.jobs[0].progress.processed).toBe(1);expect(connected.jobs[0].configuration.filter).toEqual({mode:'METRO'});
  const cfg={...config,source:path.join(root,'local/emg.parquet')},cp=await inspectRun(output,cfg);
  await commitPart(output,cfg,cp,[{rowIndex:1,sourceKey:'key',raw:{mode_1:'METRO'},status:'excluded',reasons:['fixture']}]);
  expect((await api(`/jobs/${request.name}/pause`,{})).status).toBe(202);await vi.waitFor(async()=>expect((await (await api('/status')).json()).activeId).toBeNull());
  const rows=await (await api(`/jobs/${request.name}/rows?offset=0`)).json();expect(rows.rows[0].rowIndex).toBe(1);expect(rows.rows[0].raw).toBeUndefined();
  const detail=await (await api(`/jobs/${request.name}/preview?offset=0`)).json();expect(detail.raw).toEqual({mode_1:'METRO'});
  await manager.close();manager=await createManager({root,worker:'fixture-worker.mjs',port:0,spawnWorker:spawnFake});await new Promise<void>((resolve,reject)=>{manager.server.once('error',reject);manager.server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${(manager.server.address() as {port:number}).port}`;
  expect((await (await api('/status')).json()).jobs[0].progress.committed).toBe(1);
});
it('validates resource and fitting bounds and strips unrelated configuration',()=>{
  expect(validateRequest({...request,key:'never persist'})).not.toHaveProperty('key');
  expect(()=>validateRequest({...request,partRows:1001})).toThrow();expect(()=>validateRequest({...request,settings:{...request.settings,trials:0}})).toThrow();
  expect(()=>validateRequest({...request,variation:{seed:1,maxOffsetM:100,knotSpacingM:100}})).toThrow();
});
