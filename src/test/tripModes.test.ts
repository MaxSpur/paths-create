import {describe,it,expect} from "vitest";
import {resolvePairMode,nextPointMode,hasTransitPointPairs} from "../lib/tripModes";
import {createDefaultState,loadState,STORAGE_KEY} from "../lib/stateStore";
import type {PointTripMode} from "../lib/types";
const point=(tripMode:PointTripMode)=>({id:tripMode,lat:48.8,lon:2.3,tripMode});
describe("point travel modes",()=>{
  const modes:PointTripMode[]=["metro","cycling_transit","cycling","driving"];
  it("resolves all endpoint combinations consistently and loads transit only when usable",()=>{
    for(let i=0;i<4;i++) for(let j=0;j<4;j++) {
      expect(resolvePairMode(point(modes[i]),point(modes[j]))).toBe(modes[Math.max(i,j)]);
      expect(hasTransitPointPairs([point(modes[i])],[point(modes[j])])).toBe(i<2&&j<2);
    }
    expect(["metro","driving","cycling","cycling_transit"].map(nextPointMode)).toEqual(["driving","cycling","cycling_transit","metro"]);
  });
  it.each(["transit","driving","cycling","cycling_transit"])("migrates old global %s once without losing points", mode=>{
    const state=createDefaultState();
    state.stations=[{id:"area",name:"Saved",lat:48.8,lon:2.3,radiusM:100,walkPoints:[point("driving"),{...point("metro"),label:"Address"}]}];
    localStorage.setItem(STORAGE_KEY,JSON.stringify({...state,schemaVersion:2,generation:{...state.generation,routingMode:mode}}));
    const migrated=loadState();
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.generation.routingMode).toBe("point_modes");
    expect(migrated.stations[0].walkPoints.map(p=>p.tripMode)).toEqual([mode==="transit"?"metro":mode,mode==="transit"?"metro":mode]);
    expect(migrated.stations[0].walkPoints[1].label).toBe("Address");
    migrated.stations[0].walkPoints[0].tripMode="cycling_transit";
    localStorage.setItem(STORAGE_KEY,JSON.stringify(migrated));
    expect(loadState().stations[0].walkPoints[0].tripMode).toBe("cycling_transit");
  });
});
