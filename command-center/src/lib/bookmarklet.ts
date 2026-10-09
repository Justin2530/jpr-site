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
const hint=links.filter(l=>/download|resume|cv|pdf|attach/i.test(l.t+' '+l.u)).slice(0,30).map(l=>l.tag+' | '+l.t+' | '+l.u.replace(/[?#].*$/,'').slice(0,160));
const send=()=>{try{w.postMessage({type:'jpr-capture',url:location.href,title:document.title,text,file,links:hint},O);}catch(e){}};
window.addEventListener('message',e=>{if(e.origin===O&&e.data==='jpr-ready')send();});
send();setTimeout(send,1500);setTimeout(send,4000);
})();`;
  return `javascript:${encodeURIComponent(code.replace(/\n/g, ""))}`;
}
