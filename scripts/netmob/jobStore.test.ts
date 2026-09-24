// @vitest-environment node
import {it,expect,beforeEach,afterEach} from 'vitest';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRun,readRun,inspectRun,commitPart,lockRun,recoverPending,type RunConfig,type Outcome} from './jobStore';
import {DEFAULT_FIT} from '../../src/lib/netmobTypes';
let root:string,folder:string;
const config:RunConfig={schemaVersion:1,source:'fixture',sourceHash:'hash',sourceRows:5,versions:{test:'1'},settings:DEFAULT_FIT,variation:null,partRows:2,maxOutputBytes:1024*1024,minFreeBytes:0};
const outcome=(rowIndex:number):Outcome=>({rowIndex,sourceKey:`source-${rowIndex}`,raw:{key:`source-${rowIndex}`,mode_1:null},status:'excluded',reasons:['fixture']});
beforeEach(async()=>{root=await mkdtemp(path.join(tmpdir(),'odc-job-test-'));folder=path.join(root,'job');await createRun(folder,config);});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
it('resumes contiguous committed parts, keeps every raw row, and refuses duplicates',async()=>{
  const first=await inspectRun(folder,await readRun(folder));
  await commitPart(folder,config,first,[outcome(0),outcome(1)]);
  const resumed=await inspectRun(folder,config);expect(resumed.nextRow).toBe(2);expect(resumed.counts).toEqual({excluded:2});
  await expect(commitPart(folder,config,resumed,[outcome(1)])).rejects.toThrow('sequence');
  await commitPart(folder,config,resumed,[outcome(2)]);expect((await inspectRun(folder,config)).nextRow).toBe(3);
});
it('detects corruption and incompatible settings before progressing',async()=>{
  await commitPart(folder,config,await inspectRun(folder,config),[outcome(0)]);
  await expect(inspectRun(folder,{...config,settings:{...DEFAULT_FIT,trials:24}})).rejects.toThrow('settings');
  await writeFile(path.join(folder,'part-000000/outcomes.json.gz'),'corrupt');
  await expect(inspectRun(folder,config)).rejects.toThrow('Checksum');
});
it('stops at the byte limit without a partial commit and permits a larger operational budget',async()=>{
  const state=await inspectRun(folder,config);
  await expect(commitPart(folder,{...config,maxOutputBytes:state.bytes+1},state,[outcome(0)])).rejects.toThrow('budget');
  expect((await inspectRun(folder,config)).nextRow).toBe(0);
  await commitPart(folder,config,state,[outcome(0)]);
  expect((await inspectRun(folder,{...config,maxOutputBytes:2*config.maxOutputBytes})).nextRow).toBe(1);
});
it('refuses a second writer, releases its lock and recovers recognized uncommitted staging only',async()=>{
  const unlock=await lockRun(folder);await expect(lockRun(folder)).rejects.toThrow('still owns');await unlock();
  await mkdir(path.join(folder,'pending'));await recoverPending(folder,config);
  await mkdir(path.join(folder,'pending'));await writeFile(path.join(folder,'pending/unrelated.txt'),'keep');
  await expect(recoverPending(folder,config)).rejects.toThrow('Unknown');
  expect(await readFile(path.join(folder,'pending/unrelated.txt'),'utf8')).toBe('keep');
});
it('requires geometry for successes and never replaces existing output folders',async()=>{
  await expect(createRun(folder,config)).rejects.toThrow();
  await expect(commitPart(folder,config,await inspectRun(folder,config),[{...outcome(0),status:'acceptable'}])).rejects.toThrow('mismatch');
});
it('checkpoints filtered selection positions while preserving original row identities',async()=>{
  const cfg:RunConfig={...config,schemaVersion:2,selection:[1,3,4],filter:{mode:'METRO'}};
  const filtered=path.join(root,'filtered');await createRun(filtered,cfg);
  const cp=await inspectRun(filtered,cfg);await commitPart(filtered,cfg,cp,[outcome(1),outcome(3)]);
  expect((await inspectRun(filtered,await readRun(filtered))).nextRow).toBe(2);
  await expect(commitPart(filtered,cfg,cp,[outcome(2)])).rejects.toThrow('sequence');
  await commitPart(filtered,cfg,cp,[outcome(4)]);expect((await inspectRun(filtered,cfg)).counts.excluded).toBe(3);
  await mkdir(path.join(filtered,'pending'));expect((await inspectRun(filtered,cfg,true)).nextRow).toBe(3);
  await expect(inspectRun(filtered,cfg)).rejects.toThrow('pending');
});
