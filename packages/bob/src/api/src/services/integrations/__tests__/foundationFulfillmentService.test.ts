import { expect, it, vi } from 'vitest';
vi.mock('@bob/db',()=>({and:(...args:unknown[])=>args,eq:(...args:unknown[])=>args}));
vi.mock('@bob/db/schema',()=>({taskRuns:{id:'id',userId:'userId',planningWorkspaceId:'workspace'}}));
import { reconcileRunFoundationCompletion } from '../foundationFulfillmentService.js';
it('reconciles an authorized terminal task run without executing it again',async()=>{
 let row:any={id:'run',userId:'user',planningWorkspaceId:'workspace',planningItemId:'issue',sessionId:'session',status:'completed',completedAt:'2026-01-01T00:00:00Z'};
 const findFirst=vi.fn(async()=>row),db:any={query:{taskRuns:{findFirst}}};
 const recordCompletion=vi.fn().mockResolvedValue({fulfillmentEndId:'end',runLinkId:'link'});
 const auth={userId:'user',workspaceId:'workspace'};
 await reconcileRunFoundationCompletion(db,auth,'run',{recordCompletion});
 expect(findFirst).toHaveBeenCalledWith({where:[['id','run'],['userId','user'],['workspace','workspace']]});
 expect(recordCompletion).toHaveBeenCalledWith({taskRunId:'run',userId:'user',workspaceId:'workspace',planningItemId:'issue',sessionId:'session',completedAt:'2026-01-01T00:00:00.000Z'});
 row={...row,status:'running'};
 await expect(reconcileRunFoundationCompletion(db,auth,'run',{recordCompletion})).rejects.toThrow('persisted completed');
 row={...row,userId:'foreign'};
 await expect(reconcileRunFoundationCompletion(db,auth,'run',{recordCompletion})).rejects.toThrow('authorized workspace');
 expect(recordCompletion).toHaveBeenCalledTimes(1);
});
