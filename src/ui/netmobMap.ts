import {defaultPalette,legColor,type MapPalette} from './netmobAppearance';
import L from 'leaflet';
import type {NetmobArea,NetmobPair} from '../lib/netmobTypes';
import type {GeneratedTrip} from '../lib/types';

export interface NetmobMapOptions {
  trips?:GeneratedTrip[]; highlighted?:Set<string>; pinned?:Set<string>;
  appearance?:{unfocused:number;points:number;paths:number;outlines:number;saturation:number;brightness:number};
  observations?:import("../lib/types").LonLat[];
  palette?:MapPalette;
  onClear?:()=>void;
  onTrip?:(id:string)=>void; onArea?:(code:string)=>void;
}
export interface NetmobOverlay {
  show:(pairs:NetmobPair[],focus:boolean,boundaries:NetmobArea[],options:NetmobMapOptions)=>void;
}
/** Lazy, canvas-backed NetMob overlay. Route layers survive selection/progress updates. */
export function createNetmobOverlay(map:L.Map):NetmobOverlay {
  const renderer=L.canvas({padding:0.3});
  const routes=new Map<string,{trip:GeneratedTrip;layers:L.Polyline[]}>();
  const areas=new Map<string,{area:NetmobArea;layer:L.GeoJSON}>();
  const observationLine=L.polyline([],{renderer,color:"#e11d48",weight:2,opacity:0.85,interactive:false}).addTo(map);
  let lastObservations:NetmobMapOptions["observations"];
  const endpoints=L.layerGroup().addTo(map);
  let lastPairs:NetmobPair[]|undefined;let lastExternalIds="";
  let options:NetmobMapOptions={};
  const endpointOwners=new WeakMap<L.Path,{id?:string;point:boolean;destination?:boolean}>();
  const routeOpacity=(id:string)=>!options.highlighted?.size||options.highlighted.has(id)||options.pinned?.has(id)?1:(options.appearance?.unfocused??0)/100;
  let dragged=false;map.getContainer().addEventListener('pointerdown',()=>{dragged=false;});map.on('dragstart',()=>{dragged=true;});
  map.on('click',()=>{if(!dragged)options.onClear?.();});
  const stop=(e:L.LeafletMouseEvent)=>L.DomEvent.stop(e);
  function show(pairs:NetmobPair[],focus:boolean,boundaries:NetmobArea[],next:NetmobMapOptions){
    options=next;if(next.observations!==lastObservations){observationLine.setLatLngs((next.observations??[]).map(([lon,lat])=>[lat,lon] as L.LatLngTuple));lastObservations=next.observations;}observationLine.bringToFront();
    const palette=next.palette??defaultPalette();
    const a=next.appearance??{unfocused:0,points:100,paths:100,outlines:100,saturation:100,brightness:100};
    observationLine.setStyle({opacity:a.paths/100*0.85});
    const pane=map.getPane('tilePane');if(pane)pane.style.filter=next.appearance?`saturate(${a.saturation}%) brightness(${a.brightness}%)`:'';
    const emphasizedAreas=new Set<string>();
    for(const pair of pairs){const id=(pair as NetmobPair & {tripId?:string}).tripId;if(id&&(next.highlighted?.has(id)||next.pinned?.has(id))){emphasizedAreas.add(pair.originArea.code);emphasizedAreas.add(pair.destinationArea.code);}}

    const bounds=L.latLngBounds([]),wanted=new Map<string,NetmobArea>(),colors=new Map<string,string>();
    const add=(area:NetmobArea,color:string)=>{wanted.set(area.code,area);if(!colors.has(area.code))colors.set(area.code,color);};
    boundaries.forEach((area,i)=>add(area,i?palette.destination:palette.origin));
    for(const pair of pairs){add(pair.originArea,palette.origin);add(pair.destinationArea,palette.destination);}
    for(const [code,item] of areas)if(!wanted.has(code)){item.layer.remove();areas.delete(code);}
    for(const [code,area] of wanted){
      if(!areas.has(code)){
        const text=document.createElement('span');text.textContent=`${area.name} (${code}) · highlight visible trips touching this area`;
        const layer=L.geoJSON(area.geometry as GeoJSON.GeoJsonObject,{style:{color:colors.get(code),weight:2,fillOpacity:0.06},onEachFeature:(_feature,layer)=>{
          (layer as L.Path).options.renderer=renderer;
          layer.on('click',(e:L.LeafletMouseEvent)=>{stop(e);if(options.highlighted?.size)options.onClear?.();else if((options.appearance?.outlines??100)>0)options.onArea?.(code);});
        }}).bindTooltip(text).addTo(map);
        layer.bringToBack();areas.set(code,{area,layer});
      }
      const opacity=a.outlines/100*(!next.highlighted?.size||emphasizedAreas.has(code)?1:a.unfocused/100);areas.get(code)!.layer.setStyle({color:colors.get(code),opacity,fillOpacity:0.06*opacity});
      if(focus)bounds.extend(areas.get(code)!.layer.getBounds());
    }
    const trips=next.trips??[],ids=new Set(trips.map(t=>t.id));
    for(const [id,item] of routes)if(!ids.has(id)){item.layers.forEach(l=>l.remove());routes.delete(id);}
    for(const trip of trips){
      let item=routes.get(trip.id);
      if(item?.trip!==trip){item?.layers.forEach(l=>l.remove());const layers=(trip.exportInput?.orderedLegs??[]).map(leg=>{
        const line=L.polyline(leg.coordinates.map(([lon,lat])=>[lat,lon] as L.LatLngTuple),{renderer,bubblingMouseEvents:false,color:legColor(leg,palette),dashArray:leg.mode==='walking'?'6 5':undefined}).addTo(map);
        line.on('click',e=>{stop(e);if(routeOpacity(trip.id)*(options.appearance?.paths??100)>0)options.onTrip?.(trip.id);else options.onClear?.();});return line;
      });item={trip,layers};routes.set(trip.id,item);}
      const highlighted=next.highlighted?.has(trip.id);
      for(const [index,line] of item.layers.entries()){line.setStyle({color:legColor(trip.exportInput!.orderedLegs![index],palette),weight:highlighted?5.5:3,opacity:a.paths/100*routeOpacity(trip.id)});if(highlighted)line.bringToFront();}
    }
    const pairedIds=new Set(pairs.map(p=>(p as NetmobPair & {tripId?:string}).tripId));
    const external=trips.filter(t=>!pairedIds.has(t.id));const externalIds=external.map(t=>t.id).join('|');
    if(pairs!==lastPairs||externalIds!==lastExternalIds){
      lastExternalIds=externalIds;
      endpoints.clearLayers();lastPairs=pairs;
      for(const pair of pairs){
        // Generated trip pairs carry a direct ID; source previews have no selectable route yet.
        const id=(pair as NetmobPair & {tripId?:string}).tripId;
        const from=L.latLng(pair.origin.lat,pair.origin.lon),to=L.latLng(pair.destination.lat,pair.destination.lon);
        if(!id){const line=L.polyline([from,to],{renderer,color:palette.connector,weight:1,dashArray:'4 5',interactive:false}).addTo(endpoints);endpointOwners.set(line,{point:false});}
        for(const [point,color,label] of [[from,palette.origin,'Origin'],[to,palette.destination,'Destination']] as const){
          const text=document.createElement('span');text.textContent=`${label} · candidate ${pair.candidate+1} · ${pair.record.key}`;
          const marker=L.circleMarker(point,{renderer,radius:5,color,fillColor:color,fillOpacity:1,weight:1,bubblingMouseEvents:false}).bindTooltip(text).addTo(endpoints);
          endpointOwners.set(marker,{id,point:true,destination:label==='Destination'});marker.on('click',e=>{stop(e);if(id&&routeOpacity(id)*(options.appearance?.points??100)>0)options.onTrip?.(id);else options.onClear?.();});
        }
      }
    }
    if(external.length&&endpoints.getLayers().length===0)for(const trip of external){
      const coordinates=trip.exportInput?.orderedLegs?.flatMap(l=>l.coordinates)??[];
      for(const [point,destination]of [[coordinates[0],false],[coordinates.at(-1),true]] as const){if(!point)continue;
        const marker=L.circleMarker([point[1],point[0]],{renderer,radius:5,weight:1,bubblingMouseEvents:false}).addTo(endpoints);endpointOwners.set(marker,{id:trip.id,point:true,destination});marker.on('click',e=>{stop(e);options.onTrip?.(trip.id);});
      }
    }
    // Endpoints stay above route highlights and remain clickable.
    endpoints.eachLayer(layer=>{if(layer instanceof L.Path){const owner=endpointOwners.get(layer);const opacity=(owner?.point?a.points:a.paths)/100*(owner?.id?routeOpacity(owner.id):1);const color=owner?.point?(owner.destination?palette.destination:palette.origin):palette.connector;layer.setStyle({color,fillColor:color,opacity,fillOpacity:opacity});layer.bringToFront();}});
    observationLine.bringToFront();
    if(focus&&bounds.isValid())map.fitBounds(bounds.pad(0.15),{maxZoom:15});
  }
  return {show};
}
