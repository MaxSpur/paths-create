import type {ModeledLeg} from '../lib/netmobTypes';
import type {GeneratedTrip} from '../lib/types';
import {escapeHtml as esc} from './html';
export const MODE_COLORS = {walking:'#2f855a',cycling:'#0891b2',driving:'#7c3aed',metro:'#2563eb',rer:'#dc2626',train:'#9333ea',tram:'#059669',bus:'#d97706'};
const MODE_LABELS = {walking:'Walking',cycling:'Cycling',driving:'Driving',metro:'Metro',rer:'RER',train:'Train',tram:'Tram',bus:'Bus'};
export interface MapPalette {modes:Partial<Record<ModeledLeg['mode'],string>>;lines:Record<string,string>;origin:string;destination:string;connector:string}
export const defaultPalette=():MapPalette=>({modes:{},lines:{},origin:'#0f766e',destination:'#b45309',connector:'#64748b'});
export const validColor=(color:string|undefined)=>color&&/^#?[0-9a-f]{6}$/i.test(color)?`#${color.replace('#','')}`:undefined;
export const lineKey=(leg:ModeledLeg)=>leg.lineId?`${leg.mode}:${leg.lineId}`:undefined;
export function legColor(leg:ModeledLeg,palette:MapPalette):string {
  const key=lineKey(leg);
  return (key&&validColor(palette.lines[key]))||validColor(palette.modes[leg.mode])||validColor(leg.lineColor)||MODE_COLORS[leg.mode];
}
export interface MapAppearance {unfocused:number;points:number;paths:number;outlines:number;saturation:number;brightness:number}
const labels:Record<keyof MapAppearance,string>={unfocused:'Unfocused visibility',points:'Points visibility',paths:'Paths visibility',outlines:'Outlines visibility',saturation:'Basemap saturation',brightness:'Basemap brightness'};
/** Stable DOM: generation/focus updates never replace sliders or an open color picker. */
export function createAppearancePanel(appearance:MapAppearance,palette:MapPalette,changed:()=>void){
  const element=document.createElement('details');element.className='netmob-map-appearance';element.open=true;
  element.innerHTML=`<summary>Map appearance</summary><div class="netmob-appearance-body"><div class="netmob-grid">${Object.entries(appearance).map(([key,value])=>`<label>${labels[key as keyof MapAppearance]} <output data-value="${key}">${value}%</output><input type="range" data-appearance="${key}" aria-label="${labels[key as keyof MapAppearance]}" min="0" max="${key==='brightness'?200:100}" value="${value}" ${key==='brightness'?'title="Double-click to reset to 100%"':''}></label>`).join('')}</div><p class="muted">0% hides a component. Pinned items retain normal visibility during focus. Double-click brightness to reset to 100%.</p><details class="netmob-colors"><summary>Colors</summary><button type="button" data-default-colors>Default colors</button><p class="muted">Defaults use published transit line colors where available. Method colors override these; individual line colors override the method.</p><div class="netmob-color-grid">${Object.entries(MODE_LABELS).map(([key,label])=>`<label>${label}<input type="color" data-mode-color="${key}" aria-label="${label} color" value="${MODE_COLORS[key as ModeledLeg['mode']]}"></label>`).join('')}${[['origin','Origin outline / point'],['destination','Destination outline / point'],['connector','OD connector']].map(([key,label])=>`<label>${label}<input type="color" data-map-color="${key}" aria-label="${label} color" value="${palette[key as 'origin']}"></label>`).join('')}</div><div data-line-colors></div></details></div>`;
  // Keep interaction with controls out of Leaflet's drag, zoom and focus handlers.
  for(const event of ['click','dblclick','pointerdown','mousedown','touchstart','wheel','keydown'])element.addEventListener(event,e=>e.stopPropagation());
  element.querySelectorAll<HTMLInputElement>('[data-appearance]').forEach(input=>{
    const key=input.dataset.appearance as keyof MapAppearance;
    const update=()=>{appearance[key]=Number(input.value);element.querySelector(`[data-value="${key}"]`)!.textContent=`${input.value}%`;changed();};
    input.oninput=update;
    if(key==='brightness')input.ondblclick=()=>{input.value='100';update();};
  });
  let lines:ModeledLeg[]=[];let signature='';
  function syncColors(){
    element.querySelectorAll<HTMLInputElement>('[data-mode-color]').forEach(input=>{const mode=input.dataset.modeColor as ModeledLeg['mode'];input.value=palette.modes[mode]??MODE_COLORS[mode];input.title=palette.modes[mode]?'Custom method color':'Uses individual published line colors when available';});
    element.querySelectorAll<HTMLInputElement>('[data-map-color]').forEach(input=>{input.value=palette[input.dataset.mapColor as 'origin'];});
    element.querySelectorAll<HTMLInputElement>('[data-line-color]').forEach(input=>{const leg=lines.find(l=>lineKey(l)===input.dataset.lineColor);if(leg)input.value=legColor(leg,palette);});
  }
  element.querySelectorAll<HTMLInputElement>('[data-mode-color]').forEach(input=>input.oninput=()=>{palette.modes[input.dataset.modeColor as ModeledLeg['mode']]=input.value;syncColors();changed();});
  element.querySelectorAll<HTMLInputElement>('[data-map-color]').forEach(input=>input.oninput=()=>{palette[input.dataset.mapColor as 'origin']=input.value;changed();});
  element.querySelector<HTMLButtonElement>('[data-default-colors]')!.onclick=()=>{Object.assign(palette,defaultPalette());syncColors();changed();};
  function update(trips:GeneratedTrip[]){
    const unique=new Map<string,ModeledLeg>();for(const trip of trips)for(const leg of trip.exportInput?.orderedLegs??[]){const key=lineKey(leg);if(key)unique.set(key,leg);}
    const next=[...unique.keys()].sort().join('|');if(next===signature)return;signature=next;lines=[...unique.values()].sort((a,b)=>`${a.mode} ${a.lineName}`.localeCompare(`${b.mode} ${b.lineName}`,undefined,{numeric:true}));
    const host=element.querySelector<HTMLElement>('[data-line-colors]')!;
    host.innerHTML=lines.length?`<p class="muted">Transit lines in retained results</p><div class="netmob-color-grid">${lines.map(leg=>`<label>${esc(MODE_LABELS[leg.mode])} ${esc(leg.lineName??leg.lineId??'')}<input type="color" data-line-color="${esc(lineKey(leg)!)}" aria-label="${esc(MODE_LABELS[leg.mode])} ${esc(leg.lineName??leg.lineId??'')} line color" value="${legColor(leg,palette)}"></label>`).join('')}</div>`:'';
    host.querySelectorAll<HTMLInputElement>('input').forEach(input=>input.oninput=()=>{palette.lines[input.dataset.lineColor!]=input.value;changed();});
  }
  return {element,update};
}
