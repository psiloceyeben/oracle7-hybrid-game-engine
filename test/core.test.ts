import {describe,it,expect} from 'vitest';
import {EngineClock} from '../src/engine/engineClock';
import {emptyRecipe} from '../src/buildRecipe';
describe('standalone runtime',()=>{
  it('advances at fixed time with bounded catch-up',()=>{const c=new EngineClock();c.advance(0);const f=c.advance(1000);expect(f.fixedSteps).toBeLessThanOrEqual(5);expect(f.droppedSeconds).toBeGreaterThan(.8);});
  it('pauses and resumes without simulating suspended time',()=>{const c=new EngineClock();c.advance(0);c.setPaused(true);expect(c.advance(1000).fixedSteps).toBe(0);c.setPaused(false,1000);expect(c.advance(1017).fixedSteps).toBe(1);});
  it('rejects invalid fixed rates',()=>{expect(()=>new EngineClock({fixedHz:0})).toThrow();});
  it('creates independent serializable recipes with stable supplied IDs',()=>{const a=emptyRecipe('structure.room',{id:'room-1'});const b=emptyRecipe('structure.room',{id:'room-2'});a.parts.push({id:'floor',kind:'box'});expect(b.parts).toHaveLength(0);expect(JSON.parse(JSON.stringify(a)).id).toBe('room-1');});
});
