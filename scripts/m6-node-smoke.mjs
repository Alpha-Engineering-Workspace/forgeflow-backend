// Dependency-free quick check for the M6 security *service rules*, not a replacement
// for Vitest, PostgreSQL integration, browser tests or CI.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { workspaceCorePath } from '../apps/api-gateway/src/clients/core-client.js';
import { createProjectService } from '../apps/core-service/src/modules/projects/project.service.js';
import { createInvitationService } from '../apps/core-service/src/modules/invitations/invitation.service.js';
import { createInvitationMailer } from '../apps/core-service/src/modules/invitations/invitation-mail.js';
import { createInvitationLimiter } from '../apps/api-gateway/src/middleware/invitation-limits.js';

const w=randomUUID(), owner=randomUUID(), member=randomUUID(), outsider=randomUUID();
assert.equal(workspaceCorePath('POST',`/${w}/projects`),`/internal/workspaces/${w}/projects`);
assert.equal(workspaceCorePath('POST','/invitations/accept'),'/internal/workspaces/invitations/accept');
assert.equal(workspaceCorePath('DELETE',`/${w}/projects/${w}`),null);

const roles=new Map([[owner,'OWNER'],[member,'MEMBER']]);
const spaces={async authorize(id,workspace,allowed){
  if(workspace!==w||!roles.has(id))throw Object.assign(Error('missing'),{status:404});
  const role=roles.get(id);
  if(allowed&&!allowed.includes(role))throw Object.assign(Error('forbidden'),{status:403});
  return {id:workspace,name:'Engineering',role};
}};
const data=new Map();
const repo={
  async create(ws,actor,input){ const row={id:randomUUID(),workspaceId:ws,...input,status:'ACTIVE',version:1};data.set(row.id,row);return row; },
  async get(ws,_actor,id){const p=data.get(id);return p?.workspaceId===ws?p:null;},
  async update(ws,_actor,id,input){const p=await this.get(ws,null,id);
    if(!p||p.status!=='ACTIVE'||p.version!==input.expectedVersion)return null;
    const next={...p,...input,version:p.version+1};data.set(id,next);return next;},
  async archive(ws,_actor,id,v){const p=await this.get(ws,null,id);
    if(!p||p.status!=='ACTIVE'||p.version!==v)return null;
    const next={...p,status:'ARCHIVED',version:p.version+1};data.set(id,next);return next;},
};
const projects=createProjectService(repo,spaces);
await assert.rejects(projects.create(member,w,{name:'Denied',description:''}),{status:403});
await assert.rejects(projects.create(outsider,w,{name:'Denied',description:''}),{status:404});
const project=await projects.create(owner,w,{name:'Allowed',description:''});
await projects.update(owner,w,project.id,{name:'Changed',description:'',expectedVersion:1});
await assert.rejects(projects.update(owner,w,project.id,{name:'Stale',description:'',expectedVersion:1}),{status:409});
await projects.archive(owner,w,project.id,2);
await assert.rejects(projects.archive(owner,w,project.id,2),{status:409});

const invitations=new Map();let sent;
const inviteRepo={
 async create(_ws,_actor,{email,role,tokenHash}){const r={id:randomUUID(),email,role,tokenHash,status:'PENDING'};invitations.set(r.id,r);return r;},
 async delivery(){},
 async accept(hash,actor,email){const r=[...invitations.values()].find(i=>i.tokenHash===hash);
   if(!r||r.email!==email||r.status!=='PENDING')return {kind:'INVALID'};
   if(roles.has(actor))return {kind:'ALREADY_MEMBER'};
   roles.set(actor,r.role);r.status='ACCEPTED';return {kind:'ACCEPTED',workspaceId:w,role:r.role};},
 async changeRole(_ws,_actor,id,role){if(roles.get(id)==='OWNER')return null;roles.set(id,role);return {userId:id,role};},
 async remove(_ws,_actor,id){if(roles.get(id)==='OWNER')return null;return roles.delete(id)?{userId:id}:null;},
};
const mailer={ready:()=>true,async send(message){sent=message;}};
const invite=createInvitationService(inviteRepo,spaces,mailer);
const row=await invite.create(owner,w,{email:'join@example.test',role:'MEMBER'});
assert.equal(row.tokenHash,undefined,'Never return a token hash from Core');
await assert.rejects(invite.accept(outsider,'other@example.test',sent.token),{status:400});
await invite.accept(outsider,'join@example.test',sent.token);
await assert.rejects(invite.accept(outsider,'join@example.test',sent.token),{status:400});
await assert.rejects(invite.remove(owner,w,owner),{status:403});

let emailText='';
const live=createInvitationMailer({WORKSPACE_INVITE_EMAIL_MODE:'resend',WORKSPACE_INVITE_RESEND_API_KEY:'FAKE',
  WORKSPACE_INVITE_EMAIL_FROM:'team@example.test',WORKSPACE_INVITE_BASE_URL:'https://forgeflow.example.test'},async(_url,args)=>{
    emailText=JSON.parse(args.body).text;return {ok:true};
  });
await live.send({email:'join@example.test',token:'a'.repeat(43),workspaceName:'Engineering'});
assert.match(emailText,/\/invite#token=/);
assert.equal(createHash('sha256').update(sent.token).digest('hex').length,64);

const counts=new Map();const redis={multi(){let key;return {
  incr(k){key=k;return this;},expire(){return this;},async exec(){const n=(counts.get(key)||0)+1;counts.set(key,n);return [n,true];}
};}};
const limit=createInvitationLimiter(redis);
let limited=0,allowed=0;
const res=()=>({status(code){this.code=code;return this;},setHeader(){},json(){if(this.code===429)limited++;}});
for(let i=0;i<13;i++)await limit({method:'POST',path:`/${w}/invitations`,userId:owner},res(),()=>allowed++);
assert.equal(allowed,12);assert.equal(limited,1);
console.log('M6 dependency-free service smoke: passed');
