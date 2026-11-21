const $ = (selector) => document.querySelector(selector);
let snapshot = null;
let onchainBalances = null;
let balanceLastFetched = 0;
const asNum = (n) => { const v = Number(n); return Number.isFinite(v) ? v : null; };
const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fmt = (n,d=0) => { const v=asNum(n); return v===null?"—":v.toLocaleString(undefined,{maximumFractionDigits:d}); };
const when = (t) => t ? new Date(t).toLocaleString() : "—";
const ago = (t) => { if(!t) return "Never"; const s=Math.max(0,Math.round((Date.now()-new Date(t).getTime())/1000)); return s<60?s+"s ago":s<3600?Math.floor(s/60)+"m ago":s<86400?Math.floor(s/3600)+"h ago":Math.floor(s/86400)+"d ago"; };
const badge = (value) => '<span class="tag '+safe(String(value||"").toLowerCase())+'">'+safe(value||"none")+"</span>";
function show(data) {
 snapshot=data;
 const c=data.counters||{};
 $("#connection").textContent="Live database";
 $("#updated").textContent="Last refreshed "+when(data.fetchedAt);
 $("#agents-count").textContent=fmt(c.agents);
 $("#agents-sub").textContent=fmt(c.configured)+" configured / "+fmt(c.agents)+" registered";
 $("#episodes-count").textContent=fmt(c.episodes);
 $("#episodes-sub").textContent="Recorded cognitive episodes";
 $("#rate-count").textContent=fmt(c.episodes_hour);
 $("#memory-count").textContent=fmt(c.memories);
 const market=data.market||{}, m=market.context||{};
 $("#bid").textContent=m.bestBidXlm==null?"—":fmt(m.bestBidXlm,7)+" XLM";
 $("#ask").textContent=m.bestAskXlm==null?"—":fmt(m.bestAskXlm,7)+" XLM";
 $("#depth").textContent=fmt(m.askDepthRylo,2);
 $("#market-time").textContent=ago(market.created_at);
 chart(data.hourly||[]);
 agentsTable();
 const events=data.events||[];
 const walletsByAgent = new Map((data.agents||[]).map(a=>[a.id,a.public_key]));
 $("#timeline").innerHTML=events.length?events.map(e=>{
   const key=walletsByAgent.get(e.agent_id);
   const valid=typeof key==="string" && /^G[A-Z2-7]{55}$/.test(key);
   const accountLink=valid?'<a class="decision-link" href="https://stellar.expert/explorer/public/account/'+key+'" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" title="View this wallet publicly on StellarExpert">View wallet ↗</a>':"";
   const termLink=valid?'<a class="decision-link secondary" href="https://stellarterm.com/account/" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" title="Open official StellarTerm. Sign-in is NOT automatic; no wallet key is shared.">StellarTerm ↗</a>':"";
   return '<div class="episode"><time>'+safe(when(e.created_at))+'</time><div><b>'+safe(e.alias)+'</b><small>#'+safe(e.sequence)+" · "+safe(e.type)+" · "+safe(e.source)+'</small><div class="decision-links">'+accountLink+termLink+'</div></div>'+badge(e.action)+'</div>';
 }).join(""):'<div class="empty">No cognitive episodes recorded yet.</div>';
 const alerts=data.alerts||[];
 $("#alerts-count").textContent=fmt(c.alerts_day)+" / 24h";
 $("#alerts-list").innerHTML=alerts.length?alerts.map(a=>'<div class="alert-line"><span>'+safe(a.alias)+" · "+safe(a.code)+'</span><small>'+safe(when(a.created_at))+"</small></div>").join(""):'<div class="empty">No non-routine audit events recorded.</div>';
}
function chart(rows) {
 const target=$("#chart"); if(!rows.length){target.innerHTML='<div class="empty">No episodes in the last 24 hours.</div>';return;}
 const max=Math.max(1,...rows.map(r=>Number(r.episodes)||0));
 target.innerHTML=rows.map((r)=>{
 const value=Number(r.episodes)||0, h=Math.max(2,Math.round(170*value/max));
 const buys=Number(r.buy)||0,sells=Number(r.sell)||0,holds=Number(r.hold)||0,other=Math.max(0,value-buys-sells-holds);
 const segments=[["other",other],["hold",holds],["sell",sells],["buy",buys]];
 return '<div class="bar" title="'+safe(when(r.bucket))+" · "+value+' episodes" style="height:'+h+'px">'+segments.map(([name,count])=>count?'<span class="'+name+'" style="height:'+(100*count/value).toFixed(2)+'%"></span>':"").join("")+"</div>";
 }).join("");
}
function balanceStatus(value) {
 return value === "ok" ? badge("verified") : badge(value === "account_not_found" ? "not funded" : value || "unavailable");
}
function renderBalances(data) {
 onchainBalances = data;
 balanceLastFetched = Date.now();
 $("#total-xlm").textContent = fmt(data.totals.xlm,7);
 $("#total-rylo").textContent = fmt(data.totals.rylo,7);
 $("#wallets-verified").textContent = fmt(data.verified) + " / " + fmt(data.totalAccounts);
 $("#wallets-sub").textContent = fmt(data.totalAccounts - data.verified) + " accounts unverified";
 $("#balance-status").textContent = data.allVerified ? "COMPLETE" : "PARTIAL";
 $("#balances-updated").textContent = "Horizon checked " + when(data.checkedAt) + " · " + data.asset.code + " / " + data.asset.issuer.slice(0,8) + "…";
 const lookup = new Map((snapshot?.agents || []).map(a=>[a.public_key,a.alias]));
 $("#balances-table").innerHTML = (data.accounts || []).map(a=>'<tr><td><span class="agent-link">'+safe(lookup.get(a.publicKey)||"Unknown")+'</span><span class="wallet">'+safe(a.publicKey)+'</span></td><td class="tabular">'+(a.xlm===null?'—':fmt(a.xlm,7))+'</td><td class="tabular">'+(a.rylo===null?'—':fmt(a.rylo,7))+'</td><td>'+ (a.status==="ok" ? badge(a.hasRyloTrustline ? "present" : "absent") : "—")+'</td><td>'+balanceStatus(a.status)+'</td></tr>').join("") || '<tr><td colspan="5">No registered wallets.</td></tr>';
 agentsTable();
}
async function refreshBalances(force=false) {
 if (!force && onchainBalances && Date.now() - balanceLastFetched < 44000) return;
 try {
  const response=await fetch("/api/balances",{cache:"no-store"});
  if(!response.ok)throw new Error("HTTP "+response.status);
  renderBalances(await response.json());
 } catch(err) {
  $("#balance-status").textContent="UNAVAILABLE";
  $("#balances-updated").textContent="Stellar balances unavailable · "+err.message;
 }
}
function agentsTable(){
 if(!snapshot)return;
 const term=$("#search").value.trim().toLowerCase();
 const lookup = new Map((onchainBalances?.accounts || []).map(a=>[a.publicKey,a]));
 const items=(snapshot.agents||[]).filter(a=>(a.alias+" "+a.public_key).toLowerCase().includes(term));
 $("#agents-table").innerHTML=items.length?items.map(a=>'<tr><td><button class="agent-link" data-id="'+safe(a.id)+'">'+safe(a.alias)+'</button><span class="wallet">'+safe((a.public_key||"").slice(0,8))+"…"+safe((a.public_key||"").slice(-6))+'</span></td><td>'+badge(a.configured?"configured":"inactive")+'</td><td>'+badge(a.action)+'</td><td>'+fmt(a.episode_count)+'</td><td>'+fmt(a.confidence,2)+'</td><td>'+fmt(a.stress,2)+'</td><td>'+safe(ago(a.last_decision))+'</td><td><button class="agent-link" data-id="'+safe(a.id)+'">Inspect ›</button></td></tr>').join(""):'<tr><td colspan="8">No matching agents.</td></tr>';
}
async function inspect(id){
 $("#overlay").hidden=false;$("#agent-detail").textContent="Loading agent profile…";
 try{
  const res=await fetch("/api/agent?id="+encodeURIComponent(id),{cache:"no-store"});
  if(!res.ok)throw new Error("HTTP "+res.status);
  const {agent,episodes,memories}=await res.json();
  $("#agent-title").textContent=agent.alias;
  const s=agent.state||{},m=agent.metrics||{};
  const kv=[["Wallet",agent.public_key],["Episodes",s.episodeCount],["Confidence",s.confidence],["Stress",s.stress],["Affect",s.affect],["Urgency",s.urgency],["Behavioral entropy",m.behavioralEntropy],["Prediction error",m.predictionError],["Decision latency (ms)",m.decisionLatencyMs],["Revision",agent.revision]];
  const account = (onchainBalances?.accounts || []).find(a=>a.publicKey===agent.public_key);
  if (account) kv.push(["On-chain XLM",account.xlm??"Unavailable"],["On-chain RYLO",account.rylo??"Unavailable"],["Horizon",account.status]);
  $("#agent-detail").innerHTML='<div class="grid">'+kv.map(([k,v])=>'<div class="kv"><span>'+safe(k)+'</span><strong>'+safe(v??"—")+'</strong></div>').join("")+'</div><h3>Initial cognitive seed</h3><pre>'+safe(JSON.stringify(agent.seed,null,2))+'</pre><h3>Current evolved state</h3><pre>'+safe(JSON.stringify(s,null,2))+'</pre><h3>Last 20 episodes: observations, traces, action tendencies</h3><pre>'+safe(JSON.stringify(episodes,null,2))+'</pre><h3>Recent memories</h3><pre>'+safe(JSON.stringify(memories,null,2))+'</pre>';
 }catch(err){$("#agent-detail").textContent="Agent data unavailable: "+err.message;}
}
async function refresh(){
 try{
 const response=await fetch("/api/snapshot",{cache:"no-store"});
 if(!response.ok)throw new Error("HTTP "+response.status);
 show(await response.json());
 await refreshBalances();
 }catch(err){$("#connection").textContent="Telemetry unavailable";$("#updated").textContent="Connection error · "+err.message;}
}
document.addEventListener("click",(ev)=>{const btn=ev.target.closest("[data-id]");if(btn)inspect(btn.dataset.id);});
$("#search").addEventListener("input",agentsTable);
$("#refresh").addEventListener("click",()=>{refresh();refreshBalances(true);});
$("#close").addEventListener("click",()=>{$("#overlay").hidden=true;});
$("#overlay").addEventListener("click",(e)=>{if(e.target===$("#overlay"))$("#overlay").hidden=true;});
document.addEventListener("keydown",(ev)=>{if(ev.key==="Escape")$("#overlay").hidden=true;});
refresh();
setInterval(()=>{if(document.visibilityState==="visible")refresh();},15000);
