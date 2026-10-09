// The "Send to JPR" bookmark. Clicked on a candidate's Indeed page, it opens the Command Center's small
// capture window, grabs the page text and (when the page links one) the resume file using Justin's own
// Indeed sign-in, and hands both to that window. Nothing is saved until he presses Add to JPR there.
export function sendToJprBookmarklet(origin: string) {
  const code = `(async()=>{
const O=${JSON.stringify(origin)};
const w=window.open(O+'/capture','jprcapture','width=560,height=780');
if(!w){alert('Allow pop-ups for this site, then click Send to JPR again.');return;}
const text=(document.body.innerText||'').slice(0,30000);
let file=null;
const docs=[document];for(const f of document.querySelectorAll('iframe')){try{if(f.contentDocument)docs.push(f.contentDocument);}catch(e){}}
const els=docs.flatMap(d=>[...d.querySelectorAll('a[href],iframe[src],embed[src],object[data],button,[role=button]')]);
const links=els.map(e=>({u:e.href||e.src||e.data||e.getAttribute('data-href')||'',t:((e.innerText||'')+' '+(e.getAttribute('aria-label')||'')+' '+(e.title||'')+' '+(e.getAttribute('download')||'')).replace(/\\s+/g,' ').trim().slice(0,80),tag:e.tagName}));
const score=l=>{if(!l.u||/^(javascript|mailto|tel):/i.test(l.u))return 0;let s=0;const t=l.t+' '+l.u;if(/download/i.test(t))s+=3;if(/resume|cv/i.test(t))s+=3;if(/\\.(pdf|docx?)(\\?|#|$)/i.test(l.u))s+=4;if(/attachment|file|pdf/i.test(l.u))s+=1;if(/^(IFRAME|EMBED|OBJECT)$/.test(l.tag)&&/resume|pdf|cv/i.test(l.u))s+=3;return s;};
const ranked=links.map(l=>({...l,s:score(l)})).filter(l=>l.s>=3).sort((a,b)=>b.s-a.s);
const seen=new Set();
for(const l of ranked){if(file||seen.has(l.u)||seen.size>=5)continue;seen.add(l.u);try{const r=await fetch(l.u,{credentials:'include'});const ct=r.headers.get('content-type')||'';if(r.ok&&/pdf|msword|officedocument|octet-stream|rtf|text\\/plain/i.test(ct)){const b=await r.arrayBuffer();const m=(r.headers.get('content-disposition')||'').match(/filename\\*?=(?:UTF-8'')?"?([^";]+)/i);file={name:m?decodeURIComponent(m[1]):(/word|officedocument/i.test(ct)?'resume.docx':'resume.pdf'),type:ct,buf:b};}}catch(e){}}
if(!file){
const cands=docs.flatMap(d=>[...d.querySelectorAll('button,[role=button],a')]);const lbl=e=>((e.innerText||'').trim()||e.getAttribute('aria-label')||'').trim();
const btn=cands.find(e=>/^download resume$/i.test(lbl(e)))||cands.find(e=>/^download profile$/i.test(lbl(e)));
if(btn){
const of=window.fetch,oc=URL.createObjectURL,ac=HTMLAnchorElement.prototype.click,wo=window.open,xs=XMLHttpRequest.prototype.send;let nm=null;
const kind=(b,ct)=>{const h=new Uint8Array(b.slice(0,4));if(h[0]==37&&h[1]==80&&h[2]==68&&h[3]==70)return 'application/pdf';if(h[0]==80&&h[1]==75)return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';if(h[0]==208&&h[1]==207)return 'application/msword';return /pdf|msword|officedocument|rtf/i.test(ct||'')?ct:null;};
const keep=(b,ct,n)=>{if(file||!b||b.byteLength<500)return false;const t=kind(b,ct);if(!t)return false;file={name:n||nm||(/pdf/.test(t)?'resume.pdf':'resume.docx'),type:t,buf:b};return true;};
const fn=r=>{const m=(r.headers.get('content-disposition')||'').match(/filename\\*?=(?:UTF-8'')?"?([^";]+)/i);return m?decodeURIComponent(m[1]):null;};
const take=async u=>{try{const r=await of(u,{credentials:'include'});if(r.ok)return keep(await r.arrayBuffer(),r.headers.get('content-type'),fn(r));}catch(e){}return false;};
window.fetch=async function(){const r=await of.apply(this,arguments);try{if(!file){const c=r.clone();c.arrayBuffer().then(b=>keep(b,c.headers.get('content-type'),fn(c))).catch(()=>{});}}catch(e){}return r;};
XMLHttpRequest.prototype.send=function(){this.addEventListener('load',()=>{try{const x=this.response;const ct=this.getResponseHeader('content-type');if(x instanceof Blob)x.arrayBuffer().then(b=>keep(b,ct||x.type));else if(x instanceof ArrayBuffer)keep(x,ct);}catch(e){}});return xs.apply(this,arguments);};
URL.createObjectURL=function(b){try{if(b instanceof Blob)b.arrayBuffer().then(x=>keep(x,b.type));}catch(e){}return oc.apply(this,arguments);};
HTMLAnchorElement.prototype.click=function(){const a=this;if(a.getAttribute('download'))nm=a.getAttribute('download');if(a.href&&(a.hasAttribute('download')||/^blob:/.test(a.href))){take(a.href).then(ok=>{if(!ok)ac.call(a);});return;}return ac.apply(a,arguments);};
const cl=e=>{const a=e.target&&e.target.closest&&e.target.closest('a[href]');if(a&&(a.hasAttribute('download')||/^blob:/.test(a.href))){e.preventDefault();if(a.getAttribute('download'))nm=a.getAttribute('download');take(a.href);}};document.addEventListener('click',cl,true);
window.open=function(u){if(u&&!/^about:/.test(String(u))){take(String(u)).then(ok=>{if(!ok)wo.call(window,u);});return null;}return wo.apply(window,arguments);};
btn.click();
for(let i=0;i<40&&!file;i++)await new Promise(r=>setTimeout(r,250));
window.fetch=of;URL.createObjectURL=oc;HTMLAnchorElement.prototype.click=ac;window.open=wo;XMLHttpRequest.prototype.send=xs;document.removeEventListener('click',cl,true);
}}
const hint=links.filter(l=>/download|resume|cv|pdf|attach/i.test(l.t+' '+l.u)).slice(0,30).map(l=>l.tag+' | '+l.t+' | '+l.u.replace(/[?#].*$/,'').slice(0,160));
const send=()=>{try{w.postMessage({type:'jpr-capture',url:location.href,title:document.title,text,file,links:hint},O);}catch(e){}};
window.addEventListener('message',e=>{if(e.origin===O&&e.data==='jpr-ready')send();});
send();setTimeout(send,1500);setTimeout(send,4000);
})();`;
  return `javascript:${encodeURIComponent(code.replace(/\n/g, ""))}`;
}
