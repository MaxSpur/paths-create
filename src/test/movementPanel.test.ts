import {it,expect,vi} from 'vitest';
import {createMovementPanel} from '../ui/movementPanel';
import type {GeneratedTrip} from '../lib/types';
it('does no automatic work, resets observations on source/settings changes and cancels its worker',()=>{
 const jobs:unknown[]=[],terminate=vi.fn();class WorkerMock{postMessage(x:unknown){jobs.push(x);}terminate=terminate;}vi.stubGlobal('Worker',WorkerMock);
 const preview=vi.fn(),panel=createMovementPanel(preview);document.body.append(panel.element);const trip={id:'a',exportInput:{id:'a',orderedLegs:[]}} as unknown as GeneratedTrip;panel.update(trip);expect(jobs).toHaveLength(0);panel.element.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));expect(jobs).toHaveLength(1);panel.element.querySelector<HTMLButtonElement>('[data-cancel]')!.click();expect(terminate).toHaveBeenCalledOnce();expect(panel.element.textContent).toContain('cancelled');panel.update(undefined);expect(preview).toHaveBeenLastCalledWith(null);expect(panel.element.querySelector<HTMLButtonElement>('[type=submit]')!.disabled).toBe(true);panel.element.remove();vi.unstubAllGlobals();
});
it('reuses the selected route fitting parameters when requesting its later preview',()=>{
 const jobs:any[]=[],terminate=vi.fn();class WorkerMock{postMessage(x:unknown){jobs.push(x);}terminate=terminate;}vi.stubGlobal('Worker',WorkerMock);
 const panel=createMovementPanel(vi.fn());document.body.append(panel.element);
 const movement={seed:101,intervalS:3,roadStopsPerKm:.25,roadWaitS:15,stationDwellS:15,noise:true,smoothSigmaM:.5,smoothRangeM:100,localSigmaM:5,localRangeM:20,whiteSigmaM:1,stationaryCorrelationS:30,cruiseKmh:{walking:5.4},roadCruiseSource:'routing',roadCruiseFactor:1.1};
 panel.update({id:'fitted',exportInput:{id:'fitted',orderedLegs:[],netmob:{settings:{movement}}}} as unknown as GeneratedTrip);
 panel.element.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));expect(jobs[0].settings).toEqual(movement);panel.cancel();panel.element.remove();vi.unstubAllGlobals();
});
