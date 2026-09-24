import {it,expect,vi,afterEach} from 'vitest';
import {createLocalRunsPanel,type LocalRunContext} from '../ui/netmobLocalRuns';
import {DEFAULT_FIT} from '../lib/netmobTypes';
import type {LocalRunSnapshot} from '../lib/localRunTypes';
const context:LocalRunContext={sourceName:'emg.parquet',sourceHash:'a'.repeat(64),rows:1459,filter:{mode:'METRO',durationMin:10,durationMax:20},settings:{...DEFAULT_FIT,durationModel:'movement'},maxAccessM:1500,maxCyclingM:5000,browserBusy:false};
const snapshot:LocalRunSnapshot={outputRoot:'/visible/local/netmob-runs',freeBytes:2**30,activeId:null,orsReady:true,orsMessage:'Local ORS ready',sources:[{name:'emg.parquet',bytes:1000}],jobs:[]};
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();document.body.innerHTML='';});
it('sends applied filters and limits, preserves form nodes across polling, and reconnects existing jobs without an import',async()=>{
  vi.stubGlobal('location',{hostname:'127.0.0.1',port:'5198'});vi.useFakeTimers();let state=structuredClone(snapshot),payload:unknown;
  const fetch=vi.fn(async(url:string,options?:RequestInit)=>{
    if(url.endsWith('/session'))return new Response(JSON.stringify({token:'session'}));
    if(url.endsWith('/jobs')){payload=JSON.parse(String(options?.body));state.jobs.push({id:'netmob-run',output:'/visible/netmob-run',label:'netmob-run',state:'initializing'});return new Response(JSON.stringify({id:'netmob-run'}));}
    return new Response(JSON.stringify(state));
  });vi.stubGlobal('fetch',fetch);
  let c:LocalRunContext|undefined=context;const preview=vi.fn(),view=createLocalRunsPanel(()=>c,preview);document.body.append(view.element);view.setVisible(true);await vi.advanceTimersByTimeAsync(0);
  const name=view.element.querySelector<HTMLInputElement>('[name=name]')!;name.value='netmob-run';name.focus();await vi.advanceTimersByTimeAsync(3100);
  expect(view.element.querySelector('[name=name]')).toBe(name);expect(document.activeElement).toBe(name);
  view.element.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));await vi.advanceTimersByTimeAsync(0);
  expect(payload).toMatchObject({expectedRows:1459,filter:context.filter,maxOutputMiB:512,partRows:100,settings:context.settings});expect(payload).not.toHaveProperty('browserBusy');
  c=undefined;view.update();expect(view.element.querySelector<HTMLButtonElement>('[data-new]')!.disabled).toBe(true);expect(view.element.textContent).toContain('netmob-run');view.setVisible(false);
});
it('keeps the published app independent of the local companion',()=>{
  vi.stubGlobal('location',{hostname:'example.com',port:''});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  const view=createLocalRunsPanel(()=>undefined,()=>{});view.setVisible(true);expect(fetch).not.toHaveBeenCalled();expect(view.element.textContent).toContain('published app');view.setVisible(false);
});
