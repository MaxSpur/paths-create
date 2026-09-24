import { dataFacets, importNetmob, type NetmobDataset } from "./netmobData";
import type { NetmobArea, NetmobFilter } from "./netmobTypes";
let dataset:NetmobDataset|undefined;
self.onmessage=async({data}:{data:{id:number;action:string;file?:File;supplements?:NetmobArea[];filter?:NetmobFilter;page?:number;limit?:number;offset?:number;indices?:number[]}})=>{
  const {id,action}=data;
  try {
    if(action==="import") {
      dataset=undefined;const file=data.file!;
      // File bytes are transient during hashing; browser File slices remain the reader's backing store.
      const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
      const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
      dataset=await importNetmob({byteLength:file.size,slice:(s,e)=>file.slice(s,e).arrayBuffer()},file.name,hash,data.supplements,
        message=>self.postMessage({id,progress:message}));
      self.postMessage({id,result:dataset.summary});return;
    }
    if(!dataset)throw new Error("Import a dataset first.");
    if(action==="query")self.postMessage({id,result:{...dataset.query(data.filter,data.page),facets:dataFacets(dataset.records,data.filter??{})}});
    else if(action==="select") {
      const records=dataset.select(data.filter??{},data.limit??100,data.indices,data.offset);
      const codes=new Set(records.flatMap(r=>[r.origin,r.destination]));
      self.postMessage({id,result:{records,areas:[...dataset.areas.values()].filter(a=>codes.has(a.code))}});
    }else throw new Error("Unknown dataset operation.");
  }catch(error){self.postMessage({id,error:error instanceof Error?error.message:String(error)});}
};
