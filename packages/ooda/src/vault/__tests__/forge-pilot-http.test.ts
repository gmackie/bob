import {expect,it} from 'vitest';
import {startVaultPilotHost} from '../../../scripts/forge-vault-http-host';
it('requires the pilot secret and routes only bounded vault operations',async()=>{
 const calls:string[]=[];
 const host=await startVaultPilotHost(()=>({write:async(path:string,content:string)=>{calls.push(path);return {state:'published',content};},read:async()=>({content:'hello'}),replayPending:async()=>[]}),'secret');
 try{
  expect((await fetch(host.url,{method:'POST',body:JSON.stringify({action:'write',path:'a',content:'x'})})).status).toBe(401);
  expect(calls).toEqual([]);
  expect(await host.call({action:'write',path:'notes/pilot.md',content:'hello'})).toMatchObject({state:'published'});
  expect(calls).toEqual(['notes/pilot.md']);
  expect(await host.call({action:'read',path:'notes/pilot.md'})).toEqual({content:'hello'});
  expect(await host.call({action:'replay'})).toEqual([]);
  const bad=await fetch(host.url,{method:'POST',headers:{authorization:'Bearer secret'},body:JSON.stringify({action:'write',path:'../outside',content:'x'})});
  expect(bad.status).toBe(400);expect(calls).toHaveLength(1);
 }finally{await host.close();}
});
