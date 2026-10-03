/** Disposable loopback-only qualification host, never a production endpoint. */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { VaultService } from '../src/vault/vault-service';
import { VaultRouteHost } from '../src/vault/vault-route-host';
import type { VaultAdmissionGate } from '../src/vault/vault-route-host';
import type { AuthInstance } from '@gmacko/core/auth';
interface PilotVault {
 write(path:string,content:string):Promise<unknown>;
 read(path:string):Promise<unknown>;
 replayPending():Promise<unknown>;
}
export async function startVaultPilotHost(service:()=>PilotVault,secret:string,admission?:VaultAdmissionGate){
 if(!secret)throw Error('Pilot secret required');
 // The disposable fixture supplies a trusted actor after bearer verification.
 // No application database is queried by these vault procedures.
 process.env.DATABASE_URL ??= 'postgresql://pilot:unused@127.0.0.1:1/unused';
 const {t}=await import('../src/api/trpc');
 const {vaultRouter}=await import('../src/api/router/vault');
 const host=new VaultRouteHost([{actor:'pilot-user',kind:'personal',service:service() as VaultService}],admission);
 const api=t.createCallerFactory(t.router({vault:vaultRouter}))({
  headers:new Headers(),db:{} as never,vaultHost:host,
  auth:{api:{getSession:async()=>({user:{id:'pilot-user',email:'pilot@example.invalid'},session:{id:'pilot'}})}} as unknown as AuthInstance,
 }).vault;
 const expected=Buffer.from('Bearer '+secret);
 const server=createServer(async(req,res)=>{
  const reply=(status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  const actual=Buffer.from(req.headers.authorization??'');
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected)){reply(401,{code:'Unauthenticated'});return;}
  if(req.method!=='POST'){reply(405,{code:'MethodNotAllowed'});return;}
  try{
   let length=0;const chunks:Buffer[]=[];
   for await(const chunk of req){length+=chunk.length;if(length>65536){reply(413,{code:'PayloadTooLarge'});return;}chunks.push(chunk);}
   const input=JSON.parse(Buffer.concat(chunks).toString());
   if(input.action==='replay'){reply(200,await host.execute('pilot-user','personal',selected=>selected.replayPending()));return;}
   if(typeof input.path!=='string'||!input.path||/[\\\x00-\x1f\x7f]/.test(input.path)||input.path.split('/').some((s:string)=>!s||s==='.'||s==='..'||s.toLowerCase()==='.git')){reply(400,{code:'MalformedRequest'});return;}
   if(input.action==='write'&&typeof input.content==='string'){const result=await api.write({vaultKind:'personal',filePath:input.path,content:input.content});reply(200,result.publication);return;}
   if(input.action==='read'){reply(200,await api.read({vaultKind:'personal',filePath:input.path}));return;}
   reply(400,{code:'MalformedRequest'});
  }catch{reply(500,{code:'PilotOperationFailed'});}
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
 const address=server.address();if(!address||typeof address==='string')throw Error('Pilot listen failed');
 const url=`http://127.0.0.1:${address.port}`;
 return {url,drain:()=>host.closeAndDrain(),async call(input:unknown){
  const r=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(60000)});
  if(!r.ok)throw Error('Pilot HTTP request failed: '+r.status);
  return r.json() as Promise<any>;
 },async close(){server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}};
}
