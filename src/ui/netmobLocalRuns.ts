import './netmobLocalRuns.css';
import {escapeHtml as esc} from './html';
import {DEFAULT_COMPACT_NOISE} from '../lib/compactPathNoise';
import type {FitSettings,NetmobFilter} from '../lib/netmobTypes';
import type {LocalRunRequest,LocalRunSnapshot,LocalOutcomePage,LocalPreview} from '../lib/localRunTypes';

export interface LocalRunContext {sourceName:string;sourceHash:string;rows:number;filter:NetmobFilter;settings:FitSettings;maxAccessM:number;maxCyclingM:number;browserBusy:boolean}
const endpoint='http://127.0.0.1:5199';
const mb=(bytes:number)=>(bytes/2**20).toLocaleString(undefined,{maximumFractionDigits:1})+' MiB';
const summary=(filter:NetmobFilter)=>Object.entries(filter).filter(([,v])=>v!==undefined&&v!==''&&v!==false).map(([k,v])=>`${k}: ${v}`).join(' · ')||'All source rows';

/** Stable DOM: polling only patches status nodes; inputs, focus and disclosure state survive. */
export function createLocalRunsPanel(getContext:()=>LocalRunContext|undefined,onPreview:(preview:LocalPreview|null)=>void){
  const element=document.createElement('details');element.className='netmob-local-runs';element.open=true;
  element.innerHTML=`<summary>Local runs · saved on disk</summary>
    <p class="muted">The browser configures and reviews. A separate local process routes and writes checkpoints, even when this tab closes.</p>
    <p data-connection role="status">Connecting…</p><button type="button" data-connect>Reconnect</button>
    <p data-service></p><button type="button" data-ors>Start local ORS</button>
    <div data-connected hidden>
      <p class="local-output" data-output></p>
      <details data-create><summary>New job from applied filters</summary>
        <p data-context></p><form data-form>
        <label>Local source file<select name="sourceName" aria-label="Local source file"></select></label>
        <label>Output folder name<input name="name" aria-label="Output folder name" required pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}" value="netmob-run"></label>
        <div class="netmob-grid"><label>Rows per saved part<input name="partRows" aria-label="Rows per saved part" type="number" min="1" max="1000" value="100" required></label>
        <label>Output cap (MiB)<input name="maxOutputMiB" aria-label="Output cap (MiB)" type="number" min="1" max="1048576" value="512" required></label>
        <label>Keep free (MiB)<input name="minFreeMiB" aria-label="Keep free (MiB)" type="number" min="64" max="1048576" value="1024" required></label>
        <label>Variation bound (m)<input name="variation" aria-label="Variation bound (m)" type="number" min="0" max="20" step="0.5" value="3" required></label></div>
        <p class="muted">0 m exports clean geometry. Variation adds no points. Source SHA-256, filters, seeds, fitting and access limits are frozen at creation. No input file is copied.</p>
        <button type="submit" data-new>Create job · no routing yet</button></form>
      </details>
      <label>Saved job<select data-jobs aria-label="Saved job"><option value="">Choose a job</option></select></label>
      <div data-job hidden>
        <p data-progress></p><progress data-bar max="1" value="0" aria-label="Local job progress"></progress>
        <p class="local-row" data-row></p><p data-resources></p><p data-counts></p><p data-error role="status"></p>
        <details><summary>Pinned configuration and output folder</summary><pre data-config></pre></details>
        <div class="btn-row"><label>Next stage<select data-stage aria-label="Next stage"><option value="10">10 more rows</option><option value="100" selected>100 more rows</option><option value="1000">1,000 more rows</option><option value="10000">10,000 more rows</option><option value="all">All remaining rows</option></select></label><button type="button" data-start>Start / resume stage</button><button type="button" data-pause>Pause & checkpoint</button></div>
        <p class="muted">Pause keeps completed rows. Resume retries only unfinished work. Failed and excluded rows remain in the report. Closing this tab does not pause the process.</p>
        <div class="btn-row"><button type="button" data-refresh>Review saved rows</button><button type="button" data-clear>Clear saved preview</button></div>
        <div data-results hidden><div class="btn-row"><button type="button" data-prev>Previous saved rows</button><span data-page></span><button type="button" data-next>Next saved rows</button></div><div class="netmob-table"><table><thead><tr><th>Source row</th><th>Fit</th><th></th></tr></thead><tbody data-rows></tbody></table></div></div>
        <div data-preview hidden><p data-preview-summary></p><details><summary>Original row, fit, ordered legs and variation</summary><pre data-preview-metadata></pre></details></div>
      </div>
    </div><p data-message role="status" aria-live="polite"></p>`;
  const el=<T extends HTMLElement=HTMLElement>(selector:string)=>element.querySelector<T>(selector)!;
  let token='',snapshot:LocalRunSnapshot|undefined,selected='',timer:ReturnType<typeof setTimeout>|undefined,visible=false,polling=false,mutating=false,offset=0,revision=0,sourceSignature='',jobSignature='',configSignature='';
  const local=['127.0.0.1','localhost'].includes(location.hostname)&&['5198','4198'].includes(location.port);
  async function api<T>(url:string,body?:unknown):Promise<T>{
    const r=await fetch(endpoint+url,{method:body===undefined?'GET':'POST',headers:{'X-Netmob-Token':token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(10000)});
    const value=await r.json();if(!r.ok){if(r.status===403)token='';throw new Error(value.error??'Local request failed.');}return value;
  }
  const message=(text:string)=>{el('[data-message]').textContent=text;};
  function updateContext(){
    const c=getContext();el('[data-context]').textContent=c?`${c.rows.toLocaleString()} matching rows · ${summary(c.filter)} · ${c.settings.trials} trials · ${c.settings.durationModel??'routing'} timing. Uses the applied Explore and Prepare settings.`:'Import an EMG file above to configure a job. Existing jobs can be supervised without reimporting.';
    el<HTMLButtonElement>('[data-new]').disabled=!c||c.browserBusy||!c.rows||mutating||Boolean(snapshot?.activeId)||!snapshot;
    const select=el<HTMLSelectElement>('[name=sourceName]');if(c&&Array.from(select.options).some(o=>o.value===c.sourceName)&&select.dataset.autoSource!==c.sourceName){select.value=c.sourceName;select.dataset.autoSource=c.sourceName;}
  }
  function paint(){
    if(!snapshot)return;el('[data-connected]').hidden=false;el('[data-connection]').textContent='Connected · local controller';el('[data-service]').textContent=snapshot.orsMessage;
    el<HTMLButtonElement>('[data-ors]').disabled=snapshot.orsReady||Boolean(snapshot.activeId)||mutating;
    el('[data-output]').textContent=`Output: ${snapshot.outputRoot} · ${mb(snapshot.freeBytes)} free`;
    const sources=JSON.stringify(snapshot.sources);if(sources!==sourceSignature){sourceSignature=sources;el('[name=sourceName]').innerHTML=snapshot.sources.map(s=>`<option value="${esc(s.name)}">${esc(s.name)} (${mb(s.bytes)})</option>`).join('');}
    if(!selected&&snapshot.jobs.length)selected=snapshot.activeId??snapshot.jobs.at(-1)!.id;
    const options=JSON.stringify(snapshot.jobs.map(j=>[j.id,j.label]));if(options!==jobSignature){jobSignature=options;el('[data-jobs]').innerHTML='<option value="">Choose a job</option>'+snapshot.jobs.map(j=>`<option value="${esc(j.id)}">${esc(j.label)}</option>`).join('');el<HTMLSelectElement>('[data-jobs]').value=selected;}
    const job=snapshot.jobs.find(j=>j.id===selected);el('[data-job]').hidden=!job;
    if(job){const p=job.progress,active=snapshot.activeId===selected;
      const messageNode=el('[data-message]');if(!active&&/^(Initializing|Stage started|Pausing)/.test(messageNode.textContent??''))messageNode.textContent='';
      el('[data-progress]').textContent=p?`${p.processed.toLocaleString()} / ${p.total.toLocaleString()} processed · ${p.committed.toLocaleString()} saved · ${job.state}`:job.state;
      const bar=el<HTMLProgressElement>('[data-bar]');bar.max=p?.total||1;bar.value=p?.processed??0;
      el('[data-row]').textContent=active&&p?.rowIndex!==undefined?`Source row ${p.rowIndex+1}${p.trial?` · trial ${p.trial}/${p.trials}`:''}`:' '; 
      el('[data-resources]').textContent=p?`${p.parts} saved parts · ${mb(p.bytes)} / ${mb(p.maxOutputBytes)} cap${p.rssMiB?` · ${active?'worker':'last worker'} ${p.rssMiB} MiB RAM`:''}${p.requestsThisInvocation!==undefined?` · ${p.requestsThisInvocation.toLocaleString()} requests this stage`:''}${p.elapsedS?` · ${Math.round(p.elapsedS)} s`:''}`:'';
      el('[data-counts]').textContent=p?Object.entries(p.counts).map(([k,v])=>`${v.toLocaleString()} ${k}`).join(' · '):'';
      el('[data-error]').textContent=job.error||p?.paused||'';
      const configuration=JSON.stringify({output:job.output,...job.configuration},null,2);if(configuration!==configSignature){configSignature=configuration;el('[data-config]').textContent=configuration;}
      el<HTMLButtonElement>('[data-start]').disabled=mutating||Boolean(snapshot.activeId)||job.state==='complete'||!job.configuration||!snapshot.orsReady;
      el<HTMLButtonElement>('[data-pause]').disabled=mutating||!active||job.state==='pausing';
      el<HTMLButtonElement>('[data-refresh]').disabled=!(p?.committed)||mutating;
    }updateContext();
  }
  async function poll(){
    if(!visible||polling||!local)return;polling=true;clearTimeout(timer);
    try{if(!token){const r=await fetch(endpoint+'/session',{signal:AbortSignal.timeout(2500)});if(!r.ok)throw new Error('Controller not available');token=(await r.json()).token;}
      snapshot=await api<LocalRunSnapshot>('/status');paint();
    }catch{snapshot=undefined;token='';el('[data-connection]').textContent='Disconnected. Start npm run netmob:serve in the project folder, then reconnect. Any running job belongs to that process.';el('[data-service]').textContent='';for(const button of element.querySelectorAll<HTMLButtonElement>('[data-start],[data-pause],[data-new],[data-ors],[data-refresh]'))button.disabled=true;
    }finally{polling=false;if(visible)timer=setTimeout(()=>void poll(),snapshot?.activeId?1000:3000);}
  }
  async function mutate(work:()=>Promise<void>){if(mutating)return;mutating=true;paint();message('');try{await work();}catch(e){message(e instanceof Error?e.message:String(e));}finally{mutating=false;await poll();paint();}}
  function clearPreview(){revision++;el('[data-preview]').hidden=true;onPreview(null);}
  async function loadRows(next=offset){const id=selected,rev=++revision;offset=next;try{const page=await api<LocalOutcomePage>(`/jobs/${encodeURIComponent(id)}/rows?offset=${next}`);if(id!==selected||rev!==revision)return;
    el('[data-results]').hidden=false;el('[data-page]').textContent=`${Math.min(next+1,page.total)}–${Math.min(next+25,page.total)} / ${page.total}`;
    el<HTMLButtonElement>('[data-prev]').disabled=next===0;el<HTMLButtonElement>('[data-next]').disabled=next+25>=page.total;
    el('[data-rows]').innerHTML=page.rows.map((row,i)=>`<tr><td>#${row.rowIndex+1}</td><td>${esc(row.status)}${row.errorS==null?'':` · Δ ${(row.errorS/60).toFixed(1)} min`}</td><td><button type="button" data-preview-row="${next+i}" aria-label="Review saved source row ${row.rowIndex+1}">${row.tripId?'View route':'Details'}</button></td></tr>`).join('');
  }catch(e){message(String(e));}}
  el('[data-rows]').addEventListener('click',async e=>{const button=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-preview-row]');if(!button)return;const id=selected,rev=++revision;button.disabled=true;
    try{const preview=await api<LocalPreview>(`/jobs/${encodeURIComponent(id)}/preview?offset=${button.dataset.previewRow}`);if(id!==selected||rev!==revision)return;
      el('[data-preview]').hidden=false;const fit=preview.input?.netmob?.fit;
      el('[data-preview-summary]').textContent=`Source #${preview.outcome.rowIndex+1} · ${preview.input?.orderedLegs?.map(l=>l.sourceMode).join(' → ')||preview.outcome.status}${fit?` · target ${fit.targetS===null?'unknown':(fit.targetS/60).toFixed(1)+' min'} · modeled ${(fit.modeledS/60).toFixed(1)} min`:''}${preview.geometryVariation?' · exported variation shown; timing describes the clean fit':''}`;
      el('[data-preview-metadata]').textContent=JSON.stringify({...preview,input:preview.input?{...preview.input,orderedLegs:preview.input.orderedLegs?.map(({coordinates,...leg})=>({...leg,pointCount:coordinates.length}))}:undefined},null,2);onPreview(preview);
    }catch(error){message(String(error));}finally{button.disabled=false;}
  });
  el<HTMLFormElement>('[data-form]').onsubmit=e=>{e.preventDefault();void mutate(async()=>{
    const c=getContext();if(!c||c.browserBusy)throw new Error('Import EMG and apply its filters first.');const form=new FormData(el<HTMLFormElement>('[data-form]'));const value=(key:string)=>Number(form.get(key));
    const request:LocalRunRequest={sourceHash:c.sourceHash,filter:c.filter,settings:c.settings,maxAccessM:c.maxAccessM,maxCyclingM:c.maxCyclingM,name:String(form.get('name')),sourceName:String(form.get('sourceName')),expectedRows:c.rows,partRows:value('partRows'),maxOutputMiB:value('maxOutputMiB'),minFreeMiB:value('minFreeMiB'),variation:value('variation')?{...DEFAULT_COMPACT_NOISE,maxOffsetM:value('variation')}:null};
    const {id}=await api<{id:string}>('/jobs',request);selected=id;el<HTMLSelectElement>('[data-jobs]').value=id;el('[data-results]').hidden=true;clearPreview();message('Initializing the pinned job. No routing starts until you choose a stage.');
  });};
  el<HTMLSelectElement>('[data-jobs]').onchange=()=>{selected=el<HTMLSelectElement>('[data-jobs]').value;offset=0;clearPreview();el('[data-results]').hidden=true;paint();};
  el('[data-connect]').onclick=()=>{token='';void poll();};
  el('[data-ors]').onclick=()=>void mutate(async()=>{await api('/ors/start',{});message('Local ORS start requested. Readiness is checked automatically.');});
  el('[data-start]').onclick=()=>void mutate(async()=>{const value=el<HTMLSelectElement>('[data-stage]').value;await api(`/jobs/${encodeURIComponent(selected)}/start`,{maxRows:value==='all'?'all':Number(value)});message('Stage started. Outputs go directly to the displayed folder.');});
  el('[data-pause]').onclick=()=>void mutate(async()=>{await api(`/jobs/${encodeURIComponent(selected)}/pause`,{});message('Pausing and saving completed rows…');});
  el('[data-refresh]').onclick=()=>void loadRows();el('[data-prev]').onclick=()=>void loadRows(Math.max(0,offset-25));el('[data-next]').onclick=()=>void loadRows(offset+25);el('[data-clear]').onclick=clearPreview;
  if(!local){el('[data-connection]').textContent='Local runs are available in the local app at http://127.0.0.1:5198/. The published app keeps its browser-only pilot.';el<HTMLButtonElement>('[data-connect]').disabled=true;el<HTMLButtonElement>('[data-ors]').disabled=true;}
  return {element,update:updateContext,setVisible(value:boolean){visible=value;if(value)void poll();else clearTimeout(timer);}};
}
