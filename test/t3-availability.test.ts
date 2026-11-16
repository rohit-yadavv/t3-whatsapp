import test from 'node:test';
import assert from 'node:assert/strict';
import {T3Availability, T3_CHECK_INTERVAL_MS, T3_SHUTDOWN_GRACE_MS, type AvailabilityEvent} from '../src/t3-availability.js';

function fixture() {
  let time=0,available=true,stops=0,probes=0;
  const events:AvailabilityEvent[]=[];
  const monitor=new T3Availability(async()=>{
    probes++;
    if (!available) throw new Error('Backend unavailable');
  },()=>{stops++;},event=>events.push(event),()=>time);
  return {monitor,events,setTime:(value:number)=>{time=value;},setAvailable:(value:boolean)=>{available=value;},stops:()=>stops,probes:()=>probes};
}

test('a continuously unavailable T3 stops the bot once after the full 5-minute grace period',async()=>{
  assert.equal(T3_SHUTDOWN_GRACE_MS,5*60*1000);
  const f=fixture();f.setAvailable(false);
  await f.monitor.tick();assert.equal(f.stops(),0);
  for(let time=T3_CHECK_INTERVAL_MS;time<T3_SHUTDOWN_GRACE_MS;time+=T3_CHECK_INTERVAL_MS) {
    f.setTime(time);await f.monitor.tick();assert.equal(f.stops(),0);
  }
  f.setTime(T3_SHUTDOWN_GRACE_MS);await f.monitor.tick();
  assert.equal(f.stops(),1);assert.deepEqual(f.events,['t3-unavailable','t3-auto-stop']);
  const probes=f.probes();
  f.setTime(2*T3_SHUTDOWN_GRACE_MS);await f.monitor.tick();
  assert.equal(f.stops(),1);assert.equal(f.probes(),probes);
});

test('healthy T3 never starts a shutdown countdown',async()=>{
  const f=fixture();
  await f.monitor.tick();f.setTime(10*T3_SHUTDOWN_GRACE_MS);await f.monitor.tick();
  assert.equal(f.stops(),0);assert.deepEqual(f.events,[]);
});

test('recovery resets the countdown and a later outage gets another full 5 minutes',async()=>{
  const f=fixture();f.setAvailable(false);await f.monitor.tick();
  f.setTime(4*60*1000);f.setAvailable(true);await f.monitor.tick();
  assert.deepEqual(f.events,['t3-unavailable','t3-recovered']);
  f.setTime(5*60*1000);f.setAvailable(false);await f.monitor.tick();
  f.setTime(9*60*1000);await f.monitor.tick();assert.equal(f.stops(),0);
  f.setTime(10*60*1000);await f.monitor.tick();assert.equal(f.stops(),1);
});

test('a successful probe at the deadline or after sleep wins over the old countdown',async()=>{
  const f=fixture();f.setAvailable(false);await f.monitor.tick();
  f.setTime(2*T3_SHUTDOWN_GRACE_MS);f.setAvailable(true);await f.monitor.tick();
  assert.equal(f.stops(),0);assert.deepEqual(f.events,['t3-unavailable','t3-recovered']);
});

test('availability checks are rate-limited even when runtime ticks more frequently',async()=>{
  const f=fixture();await f.monitor.tick();
  for(let time=1000;time<T3_CHECK_INTERVAL_MS;time+=1000){f.setTime(time);await f.monitor.tick();}
  assert.equal(f.probes(),1);
  f.setTime(T3_CHECK_INTERVAL_MS);await f.monitor.tick();assert.equal(f.probes(),2);
});

test('checks never overlap and stopping ignores a late failure',async()=>{
  let rejectProbe:(error:Error)=>void=()=>{},probes=0;
  const stops:number[]=[];
  const events:AvailabilityEvent[]=[];
  const monitor=new T3Availability(()=>{probes++;return new Promise((_resolve,reject)=>{rejectProbe=reject;});},()=>stops.push(1),event=>events.push(event));
  const pending=monitor.tick();await monitor.tick();assert.equal(probes,1);
  monitor.stop();rejectProbe(new Error('late error'));
  await pending;await monitor.tick();
  assert.equal(probes,1);assert.deepEqual(events,[]);assert.deepEqual(stops,[]);
});
