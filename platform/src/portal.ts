/** Minimal single page portal: paste the account token, add destinations, start and stop, get the dashboard link and phone URLs. */
export const portalHtml = () => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Keel account</title>
<link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@500,700,800&display=swap">
<style>*{box-sizing:border-box}body{margin:0;background:#F3EEE4;color:#0E2A2F;font:500 17px 'Cabinet Grotesk',system-ui,sans-serif;padding:20px}main{max-width:620px;margin:32px auto}h1{font-weight:800;font-size:56px;letter-spacing:-.045em;line-height:.95;margin:0 0 10px}p{color:#5B6E70;margin:0 0 18px}
label{display:block;font-weight:700;font-size:14px;margin:14px 0 6px}input{width:100%;border:2px solid #0E2A2F;border-radius:999px;height:50px;padding:0 20px;font:inherit;background:#FBF8F1}.row{display:grid;grid-template-columns:140px 1fr;gap:8px;margin-bottom:8px}
button{font:inherit;font-weight:800;border:2px solid #0E2A2F;border-radius:999px;height:50px;padding:0 24px;background:#FF5B1F;cursor:pointer;margin:14px 8px 0 0}button.g{background:none}.card{background:#FBF8F1;border:2px solid #0E2A2F;border-radius:28px;padding:20px;margin-top:22px}
code{display:block;background:#F3EEE4;border:2px solid #D9D1C0;border-radius:16px;padding:10px 14px;font:13px/1.4 ui-monospace,Menlo,monospace;word-break:break-all;margin:4px 0 10px}.st{font-weight:800;font-size:28px;letter-spacing:-.02em}a{color:#0E2A2F;font-weight:800}</style>
<main><h1>Your Keel server.</h1><p>Paste your account token. Add every platform you stream to, then start. The server stops itself when you are done.</p>
<label>Account token</label><input id=t type=password placeholder="kt_...">
<label>Destinations (name and full URL with stream key)</label><div id=ds></div><button class=g onclick="add()">Add destination</button>
<div><button onclick="start()">Start server</button><button class=g onclick="go('/v1/server/stop','POST')">Stop</button><button class=g onclick="go('/v1/me')">Refresh</button></div>
<div class=card id=out><div class=st>Not loaded.</div><p>Paste your token and press Refresh.</p></div></main>
<script>
const ds=document.getElementById('ds');
function add(n='',u=''){const r=document.createElement('div');r.className='row';r.innerHTML='<input placeholder="Twitch" class=n><input placeholder="rtmp://live.twitch.tv/app/live_..." class=u type=password>';r.querySelector('.n').value=n;r.querySelector('.u').value=u;ds.appendChild(r)}
add('Twitch');
const WORD={none:'No server yet.',provisioning:'Creating your server.',booting:'Booting. About a minute with prebuilt images.',running:'Ready.',stopping:'Stopping.',stopped:'Stopped.',error:'Something went wrong.'};
function show(j){const o=document.getElementById('out');o.textContent='';const st=document.createElement('div');st.className='st';const s=j.server||j;st.textContent=WORD[s.state]||s.state||j.error||'';o.appendChild(st);
 if(s.error||j.error){const p=document.createElement('p');p.textContent=s.error||j.error;o.appendChild(p)}
 const a=j.access;if(a){const l=document.createElement('p');l.innerHTML='Dashboard: <a target=_blank></a>';const link=l.querySelector('a');link.href=a.dashboardUrl;link.textContent=a.dashboardUrl;o.appendChild(l);
  for(const[k,v]of[['Dashboard token',a.dashboardToken],['Phone SRT, primary',a.ingest.primary.srt],['Phone SRT, backup encoder',a.ingest.backup.srt],['SRTLA bonded',a.ingest.primary.srtla],['RTMP',a.ingest.primary.rtmp]]){const b=document.createElement('b');b.textContent=k;o.appendChild(b);const c=document.createElement('code');c.textContent=v;o.appendChild(c)}}
 if(j.usage){const p=document.createElement('p');p.textContent='Last 30 days: '+j.usage.hours+' hours over '+j.usage.sessions+' sessions.';o.appendChild(p)}}
async function go(p,m='GET',b){const r=await fetch(p,{method:m,headers:{authorization:'Bearer '+t.value,'content-type':'application/json'},body:b?JSON.stringify(b):undefined});show(await r.json())}
function start(){const d=[...ds.children].map(r=>({name:r.querySelector('.n').value.trim(),url:r.querySelector('.u').value.trim()})).filter(x=>x.name&&x.url);go('/v1/server/start','POST',{destinations:d})}
setInterval(()=>{if(t.value&&/Creating|Booting/.test(document.querySelector('.st').textContent))go('/v1/me')},5000);
</script></html>`;
