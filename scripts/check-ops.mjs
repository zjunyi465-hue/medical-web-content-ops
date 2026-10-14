import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const str=x=>typeof x==='string'&&x.trim().length>0;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):obj(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
export const hash=x=>crypto.createHash('sha256').update(JSON.stringify(canonical(x)),'utf8').digest('hex');
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const time=x=>{if(!str(x))return false;const m=x.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(Z|[+-](\d\d):(\d\d))$/);if(!m)return false;const d=new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);return Number.isFinite(Date.parse(x))&&d.getUTCFullYear()===Number(m[1])&&d.getUTCMonth()+1===Number(m[2])&&d.getUTCDate()===Number(m[3])&&Number(m[4])<24&&Number(m[5])<60&&Number(m[6])<60&&(m[7]==='Z'||Number(m[8])<24&&Number(m[9])<60);};
const ops=['create_draft','update','publish','schedule','upload_media','restore'];
const contentFields=['title','content','excerpt','slug','categories','tags','featured_media'];
const contentStatus=['draft','pending','private','future','publish'];
export function expected(a){return {...(a.before?.fields??{}),...a.patch};}
function fields(f){need(obj(f),'field object required');for(const [k,v] of Object.entries(f)){
  need([...contentFields,'status','publish_at','alt_text'].includes(k),`unsupported field: ${k}`);
  if(['categories','tags'].includes(k))need(Array.isArray(v)&&v.every(str)&&new Set(v).size===v.length,`invalid terms: ${k}`);
  else if(k==='featured_media')need(v===null||str(v),'invalid media id');
  else if(k==='status')need(contentStatus.includes(v),'invalid status');
  else need(typeof v==='string',`field must be text: ${k}`);
}}
export function check(plan,authorization=null,ledger=null,now=Date.now()){
  need(plan?.schema_version==='1.1'&&str(plan.id)&&['prepare','execute'].includes(plan.mode)&&str(plan.purpose),'plan invalid; schema must be 1.1');
  const t=plan.target;need(obj(t)&&str(t.id)&&str(t.cms)&&str(t.connection_ref)&&str(t.user_ref)&&str(t.capability_evidence)&&time(t.observed_at)&&['test','live','unknown'].includes(t.environment),'target incomplete');
  let url;try{url=new URL(t.origin);}catch{}need(url?.protocol==='https:'&&!url.username&&!url.password&&url.origin===t.origin,'target must be HTTPS origin without credentials/path');
  need(obj(t.capabilities)&&['read',...ops,'conditional_write'].every(k=>typeof t.capabilities[k]==='boolean'),'capabilities incomplete');
  need(Array.isArray(plan.actions)&&plan.actions.length>0,'actions missing');
  const map=new Map(),resources=new Set();
  for(const a of plan.actions){
    need(str(a.id)&&!map.has(a.id)&&ops.includes(a.op)&&str(a.reason),'action invalid/duplicate');map.set(a.id,a);
    need(obj(a.resource)&&['post','page','media'].includes(a.resource.kind),'resource kind invalid');
    const creating=['create_draft','upload_media'].includes(a.op);
    need(creating?a.resource.id===null:str(a.resource.id),'resource id invalid');
    need(a.op==='upload_media'?a.resource.kind==='media':a.resource.kind!=='media','operation/resource mismatch');
    if(!creating){const key=a.resource.kind+':'+a.resource.id;need(!resources.has(key),'multiple actions for same existing resource require separate plans');resources.add(key);}
    fields(a.patch);need(Object.keys(a.patch).length>0,'empty patch');
    if(creating)need(a.before===null,'create before must be null');
    else{need(obj(a.before)&&(a.before.version===null||str(a.before.version))&&obj(a.before.fields)&&a.before.sha256===hash(a.before.fields),'before snapshot invalid');fields(a.before.fields);need(contentStatus.includes(a.before.fields.status),'before status missing');}
    if(a.op==='create_draft')need(a.patch.status==='draft'&&str(a.patch.title)&&str(a.patch.content)&&Object.keys(a.patch).every(k=>[...contentFields,'status'].includes(k)),'draft payload invalid');
    if(['update','restore'].includes(a.op)){
      need(Object.keys(a.patch).every(k=>contentFields.includes(k)),'update cannot hide status/date changes');
      need(Object.keys(a.patch).every(k=>Object.hasOwn(a.before.fields,k)),'before misses modified field');
      need(Object.entries(a.patch).some(([k,v])=>hash(v)!==hash(a.before.fields[k])),'no-op update');
    }
    if(a.op==='publish')need(a.patch.status==='publish'&&Object.keys(a.patch).length===1,'publish payload invalid');
    if(a.op==='schedule')need(a.patch.status==='future'&&time(a.patch.publish_at)&&Object.keys(a.patch).length===2,'schedule needs explicit offset/time');
    if(a.op==='restore'){
      need(obj(a.backup)&&str(a.backup.ref)&&obj(a.backup.fields)&&a.backup.sha256===hash(a.backup.fields),'restore backup missing/stale');fields(a.backup.fields);
      for(const [k,v] of Object.entries(a.patch))need(Object.hasOwn(a.backup.fields,k)&&hash(a.backup.fields[k])===hash(v),`restore differs from backup: ${k}`);
    }else need(a.backup===null,'unexpected backup');
    const publicImpact=['publish','schedule'].includes(a.op)||a.before&&['publish','future'].includes(a.before.fields.status);
    if(publicImpact)need(str(a.before.fields.title)&&str(a.before.fields.content),'public operation requires actual title/content snapshot');
    if(a.op==='upload_media'){
      need(a.readiness===null&&obj(a.asset)&&str(a.asset.file_ref)&&digest(a.asset.sha256)&&Number.isInteger(a.asset.size)&&a.asset.size>0&&['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(a.asset.mime),'media record incomplete or unsupported image type');
      for(const k of ['rights_record','privacy_record'])need(obj(a.asset[k])&&['completed','pending'].includes(a.asset[k].status)&&str(a.asset[k].record),'media permission record incomplete');
      need(Object.keys(a.patch).every(k=>['title','alt_text'].includes(k)),'media payload invalid');
    }else{
      need(a.asset===null&&obj(a.readiness)&&a.readiness.snapshot_sha256===hash(expected(a))&&obj(a.readiness.checks),'readiness snapshot stale/missing');
      for(const k of ['editorial','evidence','medical','channel','privacy']){const c=a.readiness.checks[k];need(obj(c)&&['completed','pending','not_required'].includes(c.status)&&str(c.record),`readiness incomplete: ${k}`);}
    }
  }
  const planHash=hash(plan),approved=new Set(),nonAtomic=new Set();
  if(authorization!==null){
    need(authorization?.schema_version==='1.0'&&authorization.plan_sha256===planHash&&str(authorization.user_evidence)&&time(authorization.recorded_at),'authorization stale/incomplete');
    need(Array.isArray(authorization.action_ids)&&authorization.action_ids.length>0&&new Set(authorization.action_ids).size===authorization.action_ids.length&&authorization.action_ids.every(id=>map.has(id)),'authorization action IDs invalid');
    authorization.action_ids.forEach(id=>approved.add(id));
    need(Array.isArray(authorization.accept_non_atomic)&&new Set(authorization.accept_non_atomic).size===authorization.accept_non_atomic.length&&authorization.accept_non_atomic.every(id=>approved.has(id)),'non-atomic acceptance invalid');
    authorization.accept_non_atomic.forEach(id=>nonAtomic.add(id));
  }
  const states=new Map(),attemptKeys=new Set();
  if(ledger!==null){
    need(ledger?.schema_version==='1.1'&&ledger.plan_sha256===planHash&&Array.isArray(ledger.entries),'ledger stale/incomplete; schema must be 1.1');
    for(const e of ledger.entries){need(map.has(e.action_id)&&!states.has(e.action_id)&&str(e.attempt_key)&&!attemptKeys.has(e.attempt_key)&&str(e.note)&&['not_started','blocked','failed','unknown','verified'].includes(e.state),'ledger entry invalid/duplicate attempt');states.set(e.action_id,e);attemptKeys.add(e.attempt_key);}
  }
  const rows=[];
  for(const a of plan.actions){
    const blockers=[];
    if(!approved.has(a.id))blockers.push('缺本动作实际授权');
    if(t.environment==='unknown')blockers.push('站点环境未确认');
    if(!t.capabilities.read||!t.capabilities[a.op])blockers.push('实际工具能力不足');
    if(a.before&&(!t.capabilities.conditional_write||a.before.version===null)&&!nonAtomic.has(a.id))blockers.push('无可用原子版本保护或明确风险处置');
    const exposed=['publish','schedule'].includes(a.op)||(a.before&&['publish','future'].includes(a.before.fields.status));
    if(exposed&&Object.values(a.readiness.checks).some(c=>c.status==='pending'))blockers.push('公开相关审核尚有待办');
    const currentEntry=states.get(a.id);
    if(a.op==='schedule'&&Date.parse(a.patch.publish_at)<=(currentEntry?.state==='verified'?Date.parse(currentEntry.executed_at):now))blockers.push('执行时定时已过期');
    if(a.op==='upload_media'&&[a.asset.rights_record,a.asset.privacy_record].some(c=>c.status!=='completed'))blockers.push('媒体授权或隐私检查未完成');
    if(a.readiness?.checks.privacy.status==='pending')blockers.push('内容隐私检查未完成');
    const e=states.get(a.id);
    if(e?.state==='unknown')blockers.push('上次结果未知，先回查，不重试');
    if(e?.state==='failed')blockers.push('失败后需确认无部分写入，再准备重试');
    if(e?.state==='blocked')blockers.push('动作仍登记为阻塞，先核对并解除原因');
    if(e?.state==='verified'){
      need(plan.mode==='execute'&&blockers.length===0,'verified action lacks executable authorization/readiness');
      const r=e.readback;need(str(e.receipt_ref)&&time(e.executed_at)&&Date.parse(e.executed_at)>=Date.parse(t.observed_at)&&obj(r)&&r.site_id===t.id&&str(r.resource_id)&&time(r.observed_at)&&Date.parse(r.observed_at)>=Date.parse(e.executed_at)&&str(r.evidence_ref)&&obj(r.fields)&&r.fields_sha256===hash(r.fields),'verified readback missing/stale');
      if(a.resource.id!==null)need(r.resource_id===a.resource.id,'readback resource mismatch');
      for(const [k,v] of Object.entries(expected(a)))need(Object.hasOwn(r.fields,k)&&hash(r.fields[k])===hash(v),`readback field mismatch: ${k}`);
    }
    if(e){
      need(e.receipt_ref===null||str(e.receipt_ref),'receipt reference invalid');
      if(e.public_check!==null){const p=e.public_check;let u;try{u=new URL(p.url);}catch{}need(obj(p)&&u?.protocol==='https:'&&!u.username&&!u.password&&time(p.observed_at)&&str(p.evidence_ref)&&['visible','unconfirmed'].includes(p.status),'public check invalid');if(p.status==='visible'){
        need(e.state==='verified'&&expected(a).status==='publish'&&u.origin===t.origin,'public visibility cannot be asserted for unpublished/unverified/different site action');
        need(p.resource_id===e.readback.resource_id&&p.expected_sha256===hash(expected(a))&&Date.parse(p.observed_at)>=Date.parse(e.readback.observed_at),'public check resource/version/time stale');
      }}
    }
    rows.push({action_id:a.id,op:a.op,state:e?.state??'not_started',executable:plan.mode==='execute'&&blockers.length===0&&!['verified','failed','unknown'].includes(e?.state),blockers,expected:expected(a),record:e??null});
  }
  return {plan_id:plan.id,mode:plan.mode,plan_sha256:planHash,actions:rows,limitations:['仅检查已填记录与版本关系，不认证授权、权限、人审或网站状态。','不联网、不上传、不发布；真实操作由宿主工具执行。']};
}
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=s=>({prepare:'准备方案',execute:'执行记录核对',test:'测试环境',live:'生产环境',unknown:'结果或环境未知',not_started:'未开始',blocked:'被阻塞',failed:'失败',verified:'已登记读回确认',create_draft:'创建草稿',update:'更新内容',publish:'发布',schedule:'登记定时',upload_media:'上传图片',restore:'恢复字段'})[s]??s;
export function html(plan,result){return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>网站内容操作记录</title><style>body{max-width:1000px;margin:30px auto;padding:16px;font:16px/1.7 system-ui;color:#153d47}section{border:1px solid #cddddd;border-radius:10px;padding:16px;margin:15px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}aside{background:#fff2d3;padding:14px}</style><h1>网站内容管理</h1><p>${esc(plan.target.origin)} · ${esc(label(plan.target.environment))} · ${esc(label(plan.mode))}</p><p>${esc(plan.purpose)}</p><aside>${result.limitations.map(esc).join('<br>')}</aside>${result.actions.map(a=>`<section><h2>${esc(a.action_id)} · ${esc(label(a.op))}</h2><p>记录状态：${esc(label(a.state))}；结构上可执行：${a.executable?'是（仍须核真实权限与授权）':'否'}</p><p>${esc(a.blockers.join('；')||'没有登记阻塞；不代表网站操作已成功。')}</p><details><summary>预期字段与实际记录</summary><pre>${esc(JSON.stringify({expected:a.expected,record:a.record},null,2))}</pre></details></section>`).join('')}</html>`;}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{
  const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
  if(process.argv[2]==='--fingerprint'){need(process.argv[3],'plan file required');console.log(JSON.stringify({plan_sha256:hash(read(process.argv[3]))}));}
  else{const [p,a,l,out]=process.argv.slice(2);need(p&&a&&l&&out,'usage: check-ops.mjs PLAN AUTH_OR_DASH LEDGER_OR_DASH NEW_OUTPUT');const plan=read(p),authorization=a==='-'?null:read(a),ledger=l==='-'?null:read(l),result=check(plan,authorization,ledger);need(!fs.existsSync(out),'output directory exists');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'operations-results.json'),JSON.stringify({result,plan,authorization,ledger},null,2)+'\n',{flag:'wx'});fs.writeFileSync(path.join(out,'report.html'),html(plan,result),{flag:'wx'});console.log(JSON.stringify({output:path.resolve(out),actions:result.actions.length,mode:result.mode}));}
}catch(e){console.error(e.message);process.exitCode=1;}}
