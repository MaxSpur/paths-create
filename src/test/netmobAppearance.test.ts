import {describe,it,expect,vi} from 'vitest';
import {createAppearancePanel,defaultPalette,legColor} from '../ui/netmobAppearance';
import type {ModeledLeg} from '../lib/netmobTypes';
import type {GeneratedTrip} from '../lib/types';
const leg={mode:'rer',lineId:'A',lineName:'A',lineColor:'EB2132'} as ModeledLeg;
describe('NetMob map appearance',()=>{
 it('uses published line colors with method and line overrides and safe fallbacks',()=>{
  const p=defaultPalette();expect(legColor(leg,p)).toBe('#EB2132');p.modes.rer='#123456';expect(legColor(leg,p)).toBe('#123456');p.lines['rer:A']='#abcdef';expect(legColor(leg,p)).toBe('#abcdef');expect(legColor({...leg,lineId:'B',lineColor:'invalid'},defaultPalette())).toBe('#dc2626');
 });
 it('keeps controls stable, resets brightness and restores default colors without resetting opacity',()=>{
  const a={unfocused:30,points:80,paths:100,outlines:60,saturation:40,brightness:70},p=defaultPalette(),changed=vi.fn();
  const view=createAppearancePanel(a,p,changed);document.body.append(view.element);
  const brightness=view.element.querySelector<HTMLInputElement>('[data-appearance="brightness"]')!;
  brightness.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));expect(a.brightness).toBe(100);expect(brightness.value).toBe('100');
  const trip={exportInput:{orderedLegs:[leg]}} as GeneratedTrip;view.update([trip]);
  const input=view.element.querySelector<HTMLInputElement>('[data-line-color]')!;input.value='#112233';input.dispatchEvent(new Event('input'));expect(legColor(leg,p)).toBe('#112233');view.update([trip]);expect(view.element.querySelector('[data-line-color]')).toBe(input);
  view.element.querySelector<HTMLButtonElement>('[data-default-colors]')!.click();expect(input.value).toBe('#eb2132');expect(a.outlines).toBe(60);expect(view.element.querySelector('[data-appearance="brightness"]')).toBe(brightness);
  view.element.remove();
 });
});
