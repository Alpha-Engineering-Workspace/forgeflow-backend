import { generateKeyPairSync, randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createInvitationService } from '../apps/core-service/src/modules/invitations/invitation.service.js';
import { workspaceCorePath } from '../apps/api-gateway/src/clients/core-client.js';
import { createApp as gateway } from '../apps/api-gateway/src/app.js';
import { issueAccessToken } from '../shared/auth-security.js';
const w = randomUUID(), owner = randomUUID(), admin = randomUUID(), member = randomUUID(), stranger = randomUUID();
function fixture() {
  let next = 0;
  const invites = new Map();
  const members = new Map([[owner,'OWNER'],[admin,'ADMIN'],[member,'MEMBER']]);
  const mail = { ready: () => true, send: vi.fn(async () => {}) };
  const workspaces = { authorize: async (actor, ws, roles) => {
    if (ws !== w || !members.has(actor)) throw Object.assign(Error('missing'), { status: 404 });
    const role = members.get(actor);
    if (roles && !roles.includes(role)) throw Object.assign(Error('role'), { status: 403 });
    return { id: ws, role, name: 'Demo Workspace' };
  } };
  const repo = {
    async create(ws, actor, { email, role, tokenHash }) {
      if (ws !== w || !['OWNER','ADMIN'].includes(members.get(actor))) return null;
      if ([...invites.values()].some((i) => i.email === email && i.status === 'PENDING')) return null;
      const row = { id: randomUUID(), email, role, status: 'PENDING', tokenHash, sequence: next++ };
      invites.set(row.id, row); return { id:row.id,email:row.email,role:row.role,status:row.status };
    },
    async delivery() {},
    async list() { return [...invites.values()]; },
    async resend(_w, _a, id, hash) { const r = invites.get(id); if (!r || r.status !== 'PENDING') return null; r.tokenHash=hash; return r; },
    async cancel(_w, _a, id) { const r=invites.get(id); if(!r) return null; r.status='CANCELED'; return r; },
    async accept(hash, uid, email) {
      const invite = [...invites.values()].find((i) => i.tokenHash === hash);
      if (!invite || invite.email !== email || invite.status !== 'PENDING') return { kind:'INVALID' };
      if (members.has(uid)) return { kind: 'ALREADY_MEMBER' };
      members.set(uid, invite.role); invite.status='ACCEPTED'; return { kind:'ACCEPTED', workspaceId:w, role:invite.role };
    },
    async changeRole(_w, _a, target, role) { if (members.get(target)==='OWNER') return null; if (!members.has(target)) return null; members.set(target, role); return { userId:target,role }; },
    async remove(_w, _a, target) { if (members.get(target)==='OWNER') return null; return members.delete(target) ? {userId:target} : null; },
  };
  return { service:createInvitationService(repo,workspaces,mail),mail,members };
}
describe('M6 invitation rules', () => {
  it('allows only OWNER/ADMIN invitation and never OWNER invites', async () => {
    const { service } = fixture();
    await expect(service.create(member,w,{ email:'test@example.com',role:'MEMBER' })).rejects.toMatchObject({status:403});
    await expect(service.create(stranger,w,{ email:'test@example.com',role:'MEMBER' })).rejects.toMatchObject({status:404});
    const invite=await service.create(admin,w,{ email:'test@example.com',role:'ADMIN' });
    expect(invite.email).toBe('test@example.com');
    expect(JSON.stringify(invite)).not.toContain('tokenHash'); // token hashes must never be returned by actual repository DTO
    await expect(service.create(owner,w,{ email:'test@example.com',role:'ADMIN' })).rejects.toMatchObject({ status:409 });
  });
  it('matches verified email, rejects replay, protects OWNER and self mutation', async () => {
    const { service,mail,members }=fixture();
    await service.create(owner,w,{ email:'join@example.com',role:'MEMBER' });
    const token=mail.send.mock.calls[0][0].token;
    await expect(service.accept(stranger,'wrong@example.com',token)).rejects.toMatchObject({status:400});
    const accepted=await service.accept(stranger,'join@example.com',token);
    expect(accepted).toMatchObject({workspaceId:w,role:'MEMBER'});
    await expect(service.accept(stranger,'join@example.com',token)).rejects.toMatchObject({status:400});
    await expect(service.changeRole(admin,w,owner,'MEMBER')).rejects.toMatchObject({status:403});
    await expect(service.remove(admin,w,owner)).rejects.toMatchObject({status:403});
    await expect(service.remove(admin,w,admin)).rejects.toMatchObject({status:403});
    await service.changeRole(owner,w,stranger,'ADMIN');
    expect(members.get(stranger)).toBe('ADMIN');
    await service.remove(owner,w,stranger);
    expect(members.has(stranger)).toBe(false);
  });
  it('refuses unconfigured email sender without persisting invitations', async () => {
    const { service, mail }=fixture();
    mail.ready=()=>false;
    await expect(service.create(owner,w,{email:'new@example.com',role:'MEMBER'})).rejects.toMatchObject({status:503});
  });
  it('Gateway reject arbitrary member/invite mutations', () => {
    expect(workspaceCorePath('PATCH',`/${w}/members/${owner}`)).toContain('/members/');
    expect(workspaceCorePath('POST',`/${w}/members/${owner}`)).toBeNull();
    expect(workspaceCorePath('POST',`/${w}/invitations/${owner}/resend`)).toContain('/resend');
    expect(workspaceCorePath('DELETE',`/${w}/invitations/${owner}`)).toBeNull();
  });
});

describe('Gateway invitation acceptance identity provenance', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = { issuer:'m6-test', audience:'m6-test', privateKey:keys.privateKey, publicKey:keys.publicKey };
  const secret = 'a'.repeat(40);
  const access = issueAccessToken(owner, jwt);
  const redis = { multi: () => ({incr(){return this;},expire(){return this;},async exec(){return [1,true];}}) };
  const endpoint = '/api/workspaces/invitations/accept';
  it('never forwards a caller-forged email; gets verified email from Auth /me', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({url:String(url),options});
      if (String(url).includes('/internal/auth/me')) {
        return Response.json({user:{id:owner,email:'trusted@example.test',email_verified_at:new Date().toISOString()}});
      }
      return Response.json({ membership:{workspaceId:w,role:'MEMBER'} });
    });
    const app = gateway({authUrl:'http://auth:3002', coreUrl:'http://core:3003',
      coreInternalKey:secret,internalKey:secret,bffKey:secret,jwt,redis,fetchImpl});
    await request(app).post(endpoint).set('x-forgeflow-bff-key',secret)
      .set('authorization',`Bearer ${access}`)
      .set('x-forgeflow-verified-email','attacker@example.test')
      .send({token:'t'.repeat(43)}).expect(200);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('/internal/auth/me');
    expect(calls[1].options.headers['x-forgeflow-user-id']).toBe(owner);
    expect(calls[1].options.headers['x-forgeflow-verified-email']).toBe('trusted@example.test');
  });
  it('denies acceptance when Auth does not report a verified email', async () => {
    const fetchImpl=vi.fn(async()=>Response.json({user:{id:owner,email:'trusted@example.test',email_verified_at:null}}));
    const app=gateway({authUrl:'http://auth:3002',coreUrl:'http://core:3003',
      coreInternalKey:secret,internalKey:secret,bffKey:secret,jwt,redis,fetchImpl});
    await request(app).post(endpoint).set('x-forgeflow-bff-key',secret)
      .set('authorization',`Bearer ${access}`).send({token:'t'.repeat(43)}).expect(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
