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
const els=[...document.querySelectorAll('a[href],iframe[src],embed[src],object[data]')];
const links=els.map(e=>({u:e.href||e.src||e.data||'',t:((e.innerText||'')+' '+(e.getAttribute('aria-label')||'')+' '+(e.title||'')+' '+(e.getAttribute('download')||'')).trim()}));
const pick=links.find(l=>/download/i.test(l.t)&&/resume|cv/i.test(l.t+' '+l.u))||links.find(l=>/resume|cv/i.test(l.u)&&/download|pdf|file|attachment/i.test(l.u))||links.find(l=>/\\.(pdf|docx?)(\\?|$)/i.test(l.u));
if(pick&&pick.u){try{const r=await fetch(pick.u,{credentials:'include'});const ct=r.headers.get('content-type')||'';if(r.ok&&!/text\\/html/i.test(ct)){const b=await r.arrayBuffer();const m=(r.headers.get('content-disposition')||'').match(/filename\\*?=(?:UTF-8'')?"?([^";]+)/i);file={name:m?decodeURIComponent(m[1]):'resume.pdf',type:ct||'application/pdf',buf:b};}}catch(e){}}
const send=()=>{try{w.postMessage({type:'jpr-capture',url:location.href,title:document.title,text,file},O);}catch(e){}};
window.addEventListener('message',e=>{if(e.origin===O&&e.data==='jpr-ready')send();});
send();setTimeout(send,1500);setTimeout(send,4000);
})();`;
  return `javascript:${encodeURIComponent(code.replace(/\n/g, ""))}`;
}
