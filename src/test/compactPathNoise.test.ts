import {describe,it,expect} from 'vitest';
import {varyPathGeometry,DEFAULT_COMPACT_NOISE} from '../lib/compactPathNoise';
import {haversineDistanceM,toLatLon} from '../lib/geo';
import type {LonLat} from '../lib/types';

describe('compact geometric variation',()=>{
  const a:LonLat=[2.3,48.8,12],b:LonLat=[2.301,48.8,13],c:LonLat=[2.302,48.8,14];
  it('preserves counts/elevation/input and makes bounded identity-specific geometry',()=>{
    const legs=[[a,b],[b,c]],before=structuredClone(legs),result=varyPathGeometry(legs,'trip-a');
    expect(legs).toEqual(before);expect(result.map(l=>l.length)).toEqual([2,2]);
    expect(result).toEqual(varyPathGeometry(legs,'trip-a'));expect(result).not.toEqual(varyPathGeometry(legs,'trip-b'));
    expect(result[0][1]).toEqual(result[1][0]);
    result.forEach((leg,i)=>leg.forEach((p,j)=>{
      expect(p[2]).toBe(legs[i][j][2]);
      expect(haversineDistanceM(toLatLon(p),toLatLon(legs[i][j]))).toBeLessThanOrEqual(3.01);
    }));
  });
  it('keeps common samples stable after subdivision of a meridian',()=>{
    const start:LonLat=[2,48],middle:LonLat=[2,48.0005],end:LonLat=[2,48.001];
    const sparse=varyPathGeometry([[start,end]],'same'),dense=varyPathGeometry([[start,middle,end]],'same');
    expect(sparse[0][0]).toEqual(dense[0][0]);
    expect(sparse[0][1][0]).toBeCloseTo(dense[0][2][0],12);
    expect(sparse[0][1][1]).toBeCloseTo(dense[0][2][1],12);
  });
  it('handles empty/singleton geometry and disabled variation',()=>{
    expect(varyPathGeometry([],'x')).toEqual([]);
    expect(varyPathGeometry([[a],[]],'x',{...DEFAULT_COMPACT_NOISE,maxOffsetM:0})).toEqual([[a],[]]);
    expect(()=>varyPathGeometry([[a]],'x',{...DEFAULT_COMPACT_NOISE,knotSpacingM:0})).toThrow();
  });
});
