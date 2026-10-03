import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {expect,it} from 'vitest';
import {promoteNote} from '../promote-note';
import {LocalGitStorage} from '../../vault/local-git-storage';
import type {CommitAndPushOptions} from '../../vault/git';
it('returns an unresolved Forge publication for note/provenance instead of local push success',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bob-forge-promote-'));
 try{
  execFileSync('git',['init','-b','main',root],{stdio:'pipe'});
  const local=new LocalGitStorage(root);let calls=0;
  const storage={
   capabilities:()=>({...local.capabilities(),provider:'forge'}),
   resolve:local.resolve.bind(local),commitWorkingTree:local.commitWorkingTree.bind(local),
   currentRef:local.currentRef.bind(local),remoteHead:async()=>({reachable:true as const,head:null}),lastObservedRemoteHead:async()=>null,
   replayPending:async()=>[],listUnpublished:async()=>[],
   publish:async(request:any)=>{calls++;return {intent:{operationId:'publication',ref:request.ref,expectedHead:request.expectedHead,revision:request.revision,createdAt:new Date().toISOString(),inputDigest:'fixture'},state:'indeterminate' as const,attempts:1,leaseHead:null,updatedAt:new Date().toISOString()};},
  } satisfies NonNullable<CommitAndPushOptions['storage']>;
  const result=await promoteNote({storageRoot:root,threadDir:join(root,'thread'),sessionId:'session',kind:'observation',title:'Result',content:'body',provenance:{capabilityId:'test',operationId:'test',sourceType:'agent',queryOrInputRef:'fixture'}},{publication:storage});
  expect(result.publication?.state).toBe('indeterminate');expect(calls).toBe(1);
  const names=execFileSync('git',['-C',root,'ls-tree','-r','--name-only','HEAD'],{encoding:'utf8'});
  expect(names).toContain(result.noteId+'.md');expect(names).toContain(result.noteId+'.provenance.json');
 }finally{await rm(root,{recursive:true,force:true});}
});
