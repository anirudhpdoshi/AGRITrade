/* desk-main.js — the desk page logic (moved out of index.html, Nov 2026; code unchanged).
   index.html keeps only the data the publish step rewrites: the fallback DATA / NEWS snapshot, the grain
   contract meta (GMETA) the options job edits, and the shared helpers they need. */
"use strict";

/* ---------------- right-panel rails (frozen at build) ---------------- */
function railCard(title, latestHTML, bodyHTML, open){
  return '<details class="rail-card"'+(open?' open':'')+'><summary><div class="rail-title"><span>'+title+'</span>'+
    '<span class="hint hint-closed">expand &#9662;</span><span class="hint hint-open">collapse &#9652;</span></div>'+
    (latestHTML?'<div class="rail-latest">'+latestHTML+'</div>':'')+'</summary><div class="rail-body">'+bodyHTML+'</div></details>';
}

/* ---------- categorized news rail: FX · Agri · Geopolitics · Macro · Alerts · Others ---------- */
var NEWSCAT=[
  ['geo','Geopolitics',/tariff|sanction|\bwar\b|russia|ukraine|black sea|embargo|\bban\b|geopolit|conflict|middle east|israel|iran|election|ceasefire|trade (war|deal|talks|dispute)|retaliat|export (ban|curb|restriction)|border|nato|opec|houthi|red sea/i],
  ['macro','Macro',/inflation|\bcpi\b|\bgdp\b|jobs|payroll|employment|unemployment|\bfed\b|federal reserve|rate (cut|hike)|interest rate|bank of canada|\bboc\b|recession|retail sales|treasur|bond yield|yields|central bank|economy|economic|deficit|housing starts|consumer/i],
  ['fx','FX',/dollar|loonie|usd\/cad|currenc|forex|\bfx\b|\bcad\b|greenback|exchange rate/i],
  ['agri','Agri',/corn|wheat|soy|grain|crop|harvest|usda|wasde|farm|cattle|oilseed|canola|planting|fertili|cbot|bushel|ethanol|livestock|hog|barley|oats|feed/i]
];
var NEWSALERT=/surge|plunge|soar|tumble|record|halt|emergency|limit (up|down)|crash|spike|week high|week low|lowest|highest|jump|slump|sink|rall(y|ies)|breaking|warns?|shock|default|downgrade/i;
var NSEEN=null, NFIRST=false, NANIM={};
function newsSeen(){ if(NSEEN) return NSEEN; NSEEN={}; try{ var a=JSON.parse(localStorage.getItem('desk.newsSeen2')||'null'); if(a&&typeof a==='object') NSEEN=a; else NFIRST=true; }catch(e){ NFIRST=true; } return NSEEN; }
var NHOT=/usda|wasde|export sales|crop progress|crop production|weather|drought|frost|freeze|flood|heat ?wave|la ni[ñn]a|el ni[ñn]o|monsoon|harvest delay/i;
function newsMark(titles){   /* NEW for 10 min after a headline first reaches this browser; slide-in plays once; first visit only seeds */
  var S=newsSeen(), now=Date.now(), out={};
  var seed=NFIRST||performance.now()<20000;   /* first 20 s after opening: the page swaps its built-in headlines for the latest file, which is not news */
  titles.forEach(function(t){ if(!S[t]){ S[t]=seed?1:now; if(!seed) NANIM[t]=1; } out[t]={isNew:S[t]>1&&now-S[t]<600000, anim:!!NANIM[t]}; });
  return out;
}
function newsCommit(){ NFIRST=false; NANIM={}; var S=newsSeen(), k=Object.keys(S); if(k.length>400) k.slice(0,k.length-400).forEach(function(t){ delete S[t]; }); try{ localStorage.setItem('desk.newsSeen2', JSON.stringify(S)); }catch(e){} }
var NSEL={}; try{ NSEL=JSON.parse(localStorage.getItem('desk.news')||'{}')||{}; }catch(e){}
function newsPool(key){
  var seen={}, out=[], order=[key].concat(['fx','corn','wheat','soybeans','geo','macro'].filter(function(k){ return k!==key; }));
  order.forEach(function(k){ (NEWS[k]||[]).forEach(function(n){ var t=n[2].toLowerCase(); if(seen[t]) return; seen[t]=1; out.push({n:n, own:k===key, q:k}); }); });
  out.forEach(function(o){ var c=null; for(var i=0;i<NEWSCAT.length;i++){ if(NEWSCAT[i][2].test(o.n[2])){ c=NEWSCAT[i][0]; break; } }
    if(!c) c=o.q==='geo'?'geo':o.q==='macro'?'macro':o.q==='fx'?'fx':(o.q==='corn'||o.q==='wheat'||o.q==='soybeans')?'agri':'other';
    o.cat=c; o.alert=NEWSALERT.test(o.n[2]); });
  return out.sort(function(a,b){ return a.n[0]<b.n[0]?1:a.n[0]>b.n[0]?-1:0; });
}
function deskAlerts(key){
  var out=[], K=posK(key), nm=key==='fx'?'CAD funds':GMETA[key].name;
  if(K){ var S=posState(K);
    if(Math.abs(K.z52)>=2) out.push(nm+' positioning z-score '+sgn(K.z52,2,'σ')+' — '+S.zs);
    if(K.cot3>80||K.cot3<20) out.push(nm+' 3-yr COT Index '+fmt(K.cot3,0)+' — '+S.cs);
    if(S.dbl) out.push(nm+' DOUBLE EXTREME '+S.dbl);
    if(Math.abs(K.streak)>=4) out.push(nm+': '+Math.abs(K.streak)+' straight weeks of fund '+(K.streak>0?'buying':'selling'));
    if(K.doi_pct!=null&&Math.abs(K.doi_pct)>=2) out.push(nm+' open interest '+sgn(K.doi_pct,1,'%')+' w/w — '+flowRead(K)); }
  if(key==='fx') (DATA.fx.rates||[]).forEach(function(r){ if(r.dod!=null&&Math.abs(r.dod)>=5) out.push(r.t+' US–Canada spread '+sgn(r.dod,1)+' bps on the day'); });
  return out;
}
function newsBodyHTML(key){
  var P=newsPool(key), A=deskAlerts(key), sel=NSEL[key]||'all';
  var cats=[['all','All'],['fx','FX'],['agri','Agri'],['geo','Geopolitics'],['macro','Macro'],['alert','Alerts'],['other','Others']];
  var cnt={all:P.length, alert:A.length+P.filter(function(o){ return o.alert; }).length};
  P.forEach(function(o){ cnt[o.cat]=(cnt[o.cat]||0)+1; });
  var chips='<div class="nchips">'+cats.map(function(c){ var n=cnt[c[0]]||0; return '<button class="nchip'+(c[0]==='alert'&&n?' hot':'')+'" data-nk="'+key+'" data-nc="'+c[0]+'" aria-pressed="'+(sel===c[0])+'"'+(n?'':' disabled')+'>'+c[1]+' <small>'+n+'</small></button>'; }).join('')+'</div>';
  var lab={fx:'FX',agri:'Agri',geo:'Geo',macro:'Macro',other:'Other'};
  var items=P.filter(function(o){ return sel==='all'||(sel==='alert'?o.alert:o.cat===sel); });
  var lis=(sel==='alert'||sel==='all'?A.map(function(a){ return '<li class="n-desk"><div class="news-meta"><span class="ncat alert">Desk alert</span> computed from the latest CFTC / rates data</div><b>'+esc(a)+'</b></li>'; }):[]).join('')+
    (function(){ var shown=items.slice(0,sel==='all'?14:20), NEWM=newsMark(shown.map(function(o){ return o.n[2]; })); setTimeout(newsCommit,0);
    return shown.map(function(o){ var n=o.n, M=NEWM[n[2]]||{}, isNew=M.isNew, hot=M.anim&&NHOT.test(n[2]);
      return '<li class="'+(M.anim?'n-new':'')+(hot?' n-hot':'')+'"><div class="news-meta">'+(isNew?'<span class="n-newtag">NEW</span>':'')+'<span class="ncat '+o.cat+'">'+lab[o.cat]+'</span>'+(o.alert?'<span class="ncat alert">Alert</span>':'')+n[0].slice(5,16)+' UTC</div><a href="'+safeUrl(n[3])+'" target="_blank" rel="noopener">'+esc(n[2])+'</a></li>'; }).join(''); })();
  return chips+'<ul class="news-list">'+(lis||'<li class="news-meta">No headlines in this category right now.</li>')+'</ul>'+
    '<div class="stamp">Headlines pulled '+asOf('news',true)+' · pooled across all desks, de-duplicated and tagged by keyword · publish times UTC · titles link out to the publisher</div>';
}
function newsRailHTML(items, key){
  key=key||'fx';
  var latest = items[0];
  var latestHTML = 'Latest: <b>'+esc(latest[2])+'</b><br><span class="news-meta">'+esc(latest[0].replace(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d)$/,'$1 $2'))+'</span>';
  var auto=isAuto('news');
  return railCard(auto?'News — auto-refreshed':'News — frozen at build', latestHTML, '<div id="newsb-'+key+'">'+newsBodyHTML(key)+'</div>');
}
document.addEventListener('click', function(ev){
  var b=ev.target.closest&&ev.target.closest('[data-nc]'); if(!b) return; ev.preventDefault();
  var k=b.getAttribute('data-nk'); NSEL[k]=b.getAttribute('data-nc'); try{ localStorage.setItem('desk.news', JSON.stringify(NSEL)); }catch(e){}
  var el=document.getElementById('newsb-'+k); if(el) el.innerHTML=newsBodyHTML(k);
});

function fxAlertsHTML(){
  var fx=DATA.fx, hits=fx.rates.filter(function(r){ return r.dod!=null && Math.abs(r.dod)>=5; })
    .sort(function(x,y){ return Math.abs(y.dod)-Math.abs(x.dod); });
  var cards=hits.map(function(r){
    return '<div class="alert"><div class="a-t">Spread alert · '+r.t+'</div><div class="a-big">'+sgn(r.dod,1)+' bps</div>'+
      '<div class="a-sub">'+r.t+' US–Canada spread move on the day</div>'+
      '<div class="kv"><span class="kk">Current spread</span><span class="vv">'+fmt(r.sp,1)+' bps</span></div>'+
      '<div class="kv"><span class="kk">Prior close</span><span class="vv">'+fmt(r.sp-r.dod,1)+' bps</span></div>'+
      '<div class="kv"><span class="kk">US '+r.t+' · Canada '+r.t+'</span><span class="vv">'+fmt(r.us,2)+'% · '+fmt(r.ca,2)+'%</span></div></div>';
  }).join("");
  var body=(cards||'<div class="checkline">No US–Canada spread moved ≥5 bps on the day (closes '+asOf('yields')+').</div>')+
    '<div class="checkline">Rule: an alert shows when any tenor’s spread moves ≥5 bps versus the prior official close. Price-level crossings pop up as toasts while the page is open.</div>'+
    '<div class="checkline" id="fx-levelcheck">'+fxLevelCheck(DATA.fx.feed.mid)+'</div>'+
    '<div class="stamp">Spread alerts from official closes '+asOf('yields')+' · level check re-priced on every live tick</div>';
  var latest=hits.length?'<b>'+hits[0].t+' US–Canada spread '+sgn(hits[0].dod,1)+' bps</b> · '+fmt(hits[0].sp,1)+' vs '+fmt(hits[0].sp-hits[0].dod,1)+' · closes '+asOf('yields')
    : 'No spread alert · largest move '+(function(){ var m=fx.rates.filter(function(r){return r.dod!=null;}).sort(function(x,y){return Math.abs(y.dod)-Math.abs(x.dod);})[0]; return m?m.t+' '+sgn(m.dod,1)+' bps':'n/a'; })();
  return railCard('Alerts', latest, body);
}

/* ---------------- fan levels: live-re-anchored stack, as the app renders it ----------------
   Every value derives from the fan math, chain IV, trailing MAs and options
   walls already in DATA — the live anchor is the delayed quote frozen at
   build time (fan.intraday). Nothing new is sourced. */

/* Option walls relative to the LIVE underlying price (recomputed on every repaint from the strike rows):
   call wall = most call OI at/above the underlying, put wall = most put OI at/below it. Deferred option months use
   live front price + the settled calendar spread to that contract. The raw "largest anywhere" strikes are kept. */
function applyWalls(k){
  var g=DATA.grains&&DATA.grains[k]; if(!g||!g.fan) return;
  var L=+g.fan.intraday[0], R=g.roll||[], fr=R[0];
  ['near','far'].forEach(function(side){
    var n=g[side]; if(!n||!n.rows||!n.rows.length) return;
    if(!n.call_wall_any){ n.call_wall_any=n.call_wall; n.put_wall_any=n.put_wall; }
    if(!n.wall_pull) n.wall_pull={cw:n.call_wall, pw:n.put_wall, U:n.underlying};   /* walls as stored by the morning pull — the tracking point */
    var rc=R.filter(function(r){ return r.contract===n.contract; })[0], U=L, src='live delayed quote';
    if(rc&&fr&&rc.contract!==fr.contract&&rc.settle!=null&&fr.settle!=null){ U=L+(rc.settle-fr.settle); src='live front price + '+rc.contract+'/'+fr.contract+' settled spread'; }
    if(!(U>0)) return;
    var cw=null, pw=null;
    n.rows.forEach(function(r){ if(r[0]>=U-1e-9&&(!cw||r[1]>cw[1])) cw=[r[0],r[1]]; if(r[0]<=U+1e-9&&(!pw||r[2]>pw[1])) pw=[r[0],r[2]]; });
    n.call_wall=cw||n.call_wall_any; n.put_wall=pw||n.put_wall_any; n.wall_ref=U; n.wall_ref_src=src;
    /* wall shift since the morning pull: why it moved (price traded through the old wall, or open interest changed) */
    var W0=n.wall_pull, sh={};
    if(W0&&W0.pw&&Math.abs(W0.pw[0]-n.put_wall[0])>1e-6) sh.put={from:W0.pw[0], to:n.put_wall[0], why:U<W0.pw[0]-1e-9?'price broke below '+money2(W0.pw[0])+' — support moves down':'price rose — the nearest heavy put strike below is now higher'};
    if(W0&&W0.cw&&Math.abs(W0.cw[0]-n.call_wall[0])>1e-6) sh.call={from:W0.cw[0], to:n.call_wall[0], why:U>W0.cw[0]+1e-9?'price broke above '+money2(W0.cw[0])+' — resistance moves up':'price fell — the nearest heavy call strike above is now lower'};
    n.wall_shift=(sh.put||sh.call)?sh:null;
    if(side==='near'){ g.fan.call_wall=[n.call_wall[0], fmt(n.call_wall[1])]; g.fan.put_wall=[n.put_wall[0], fmt(n.put_wall[1])]; g.fan.pcr=n.pcr!=null?(+n.pcr).toFixed(2):'N/A'; }
  });
  g.oishift=oiShift(g);
}
/* Key insight: day-over-day open-interest shifts by strike (near chain, rows vs rows_prev). A shift is "substantial" when
   |change| >= 1,500 contracts and 5% of that strike's previous OI (or >= 500 and 25%) and it ranks in the chain's top changes. It marks a
   new boundary when it moves the live call wall (resistance) or put wall (support), or builds fresh OI on the correct side. */
function oiShift(g){
  var n=g.near, P=n&&n.rows_prev; if(!n||!n.rows||!P||!P.rows||!n.wall_ref) return null;
  var U=n.wall_ref, pv={}; P.rows.forEach(function(r){ pv[r[0]]=r; });
  var ch=n.rows.map(function(r){ var p=pv[r[0]]||[r[0],0,0]; return {k:r[0], dc:r[1]-p[1], dp:r[2]-p[2], pc:p[1], pp:p[2], c:r[1], p:r[2]}; });
  function wallsOf(rows, ci, pi){ var cw=null, pw=null; rows.forEach(function(r){ if(r[0]>=U-1e-9&&(!cw||r[ci]>cw[1])) cw=[r[0],r[ci]]; if(r[0]<=U+1e-9&&(!pw||r[pi]>pw[1])) pw=[r[0],r[pi]]; }); return [cw,pw]; }
  var pw0=wallsOf(P.rows,1,2), cw0=pw0[0], pwPrev=pw0[1];
  var sub=function(d,prev){ var a=Math.abs(d); return (a>=1500&&a>=0.05*prev)||(a>=500&&a>=0.25*prev); };
  var big=ch.filter(function(x){ return sub(x.dc,x.pc)||sub(x.dp,x.pp); }).sort(function(a,b){ return Math.max(Math.abs(b.dc),Math.abs(b.dp))-Math.max(Math.abs(a.dc),Math.abs(a.dp)); }).slice(0,4);
  var items=[];
  if(cw0&&n.call_wall&&Math.abs(cw0[0]-n.call_wall[0])>1e-6) items.push({lvl:'hot', t:'New resistance: the call wall moved from '+money2(cw0[0])+' to <b>'+money2(n.call_wall[0])+'</b> ('+fmt(n.call_wall[1])+' calls).'});
  if(pwPrev&&n.put_wall&&Math.abs(pwPrev[0]-n.put_wall[0])>1e-6) items.push({lvl:'hot', t:'New support: the put wall moved from '+money2(pwPrev[0])+' to <b>'+money2(n.put_wall[0])+'</b> ('+fmt(n.put_wall[1])+' puts).'});
  big.forEach(function(x){
    var side=x.k>=U?'above':'below';
    if(sub(x.dc,x.pc)) items.push({lvl:x.dc>0&&x.k>=U?'warn':'', t:(x.dc>0?'Calls added':'Calls closed')+' at '+money2(x.k)+': <b>'+sgn(x.dc,0)+'</b> to '+fmt(x.c)+' ('+side+' the price'+(x.dc>0&&x.k>=U?' \u2014 builds resistance':x.dc<0&&Math.abs(x.k-n.call_wall[0])<1e-6?' \u2014 the call wall is weakening':'')+').'});
    if(sub(x.dp,x.pp)) items.push({lvl:x.dp>0&&x.k<=U?'warn':'', t:(x.dp>0?'Puts added':'Puts closed')+' at '+money2(x.k)+': <b>'+sgn(x.dp,0)+'</b> to '+fmt(x.p)+' ('+side+' the price'+(x.dp>0&&x.k<=U?' \u2014 builds support':x.dp<0&&Math.abs(x.k-n.put_wall[0])<1e-6?' \u2014 the put wall is weakening':'')+').'});
  });
  var seen={}; items=items.filter(function(i){ if(seen[i.t]) return false; seen[i.t]=1; return true; }).slice(0,5);
  return {items:items, from:P.date, label:n.oi_label, cwMoved:!!(cw0&&Math.abs(cw0[0]-n.call_wall[0])>1e-6), pwMoved:!!(pwPrev&&Math.abs(pwPrev[0]-n.put_wall[0])>1e-6), range:[n.put_wall[0], n.call_wall[0]], U:U, chain:n.chain};
}
function oiShiftHTML(g){
  var S=g.oishift; if(!S) return '';
  return '<div class="oikey"><div class="oikey-h">\u26a1 Key insight \u2014 open-interest shifts <small>'+esc(S.chain||'')+' \u00b7 OI as of '+esc(typeof fmtShortDate==='function'?fmtShortDate(S.from):S.from)+' close \u2192 '+esc((S.label||'').replace(/^.*OI as of /,''))+'</small></div>'+
    (S.items.length?'<ul>'+S.items.map(function(i){ return '<li class="'+i.lvl+'">'+i.t+'</li>'; }).join('')+'</ul>':'<p>No substantial change at any strike (threshold: \u00b11,500 contracts and 5% of the strike\u2019s open interest, or \u00b1500 and 25%).</p>')+
    '<div class="oikey-r">Range the options market is defining now: <b>'+money2(S.range[0])+'</b> (put wall, support) \u2013 <b>'+money2(S.range[1])+'</b> (call wall, resistance) around the underlying \u2248 '+money2(S.U)+'. Interpretation, not a forecast.</div></div>';
}
function fanLevels(g, meta){
  var f=g.fan, L=f.intraday[0], w10=f.sig*Math.sqrt(10), ivH=L*f.iv_10d_rel;
  var lastH=g.history[g.history.length-1];
  var cw=g.near.call_wall, pwl=g.near.put_wall, cl=meta.chainNear, WS=g.near.wall_shift;
  var E="#e8eef4", C99="#ff9d9d", CY="#38b6c9";
  var levels=[
    {key:"p3", name:"+3σ", label:"+3σ "+money2(L+3*w10), value:L+3*w10, color:E},
    {key:"ci99p", name:"99% CI +", label:"99% CI +"+money2(L+2.58*w10), value:L+2.58*w10, color:C99},
    {key:"p2", name:"+2σ ≈ 95% CI", label:"+2σ ≈ 95% CI "+money2(L+2*w10), value:L+2*w10, color:E},
    {key:"ivp", name:"IV +2σ", label:"IV +2σ "+money2(L+ivH), value:L+ivH, color:CY},
    {key:"p1", name:"+1σ", label:"+1σ "+money2(L+w10), value:L+w10, color:E},
    {key:"ma50", name:"exp MA50", label:"exp MA50 "+money2(lastH.ma50), value:lastH.ma50, color:"#b18cff"},
    {key:"ma20", name:"exp MA20", label:"exp MA20 "+money2(lastH.ma20), value:lastH.ma20, color:"#f0c169"},
    {key:"ctr", name:"anchor", label:"Live anchor "+money2(L), value:L, color:CY, bold:true},
    {key:"m1", name:"−1σ", label:"−1σ "+money2(L-w10), value:L-w10, color:E},
    {key:"ivm", name:"IV −2σ", label:"IV −2σ "+money2(L-ivH), value:L-ivH, color:CY},
    {key:"m2", name:"−2σ ≈ 95% CI", label:"−2σ ≈ 95% CI "+money2(L-2*w10), value:L-2*w10, color:E},
    {key:"ci99m", name:"99% CI −", label:"99% CI "+money2(L-2.58*w10), value:L-2.58*w10, color:C99},
    {key:"m3", name:"−3σ", label:"−3σ "+money2(L-3*w10), value:L-3*w10, color:E},
    {key:"callwall", name:money2(cw[0])+" call wall", value:cw[0], color:"#b18cff",
      lines:[cl+" "+money2(cw[0])+" call wall"+(WS&&WS.call?" (shifted from "+money2(WS.call.from)+")":g.oishift&&g.oishift.cwMoved?" (new — OI moved)":""), fmt(cw[1])+" OI"]},
    {key:"putwall", name:money2(pwl[0])+" put wall", value:pwl[0], color:"#b18cff",
      lines:[cl+" "+money2(pwl[0])+" put wall"+(WS&&WS.put?" (shifted from "+money2(WS.put.from)+")":g.oishift&&g.oishift.pwMoved?" (new — OI moved)":""), fmt(pwl[1])+" OI"]},
    {key:"market", name:"market", label:"MARKET (delayed) "+money2(L), value:L, color:"#ff6b6b", bold:true}
  ];
  /* tracking points: where the walls stood at the morning pull, while they have shifted */
  if(WS&&WS.put) levels.push({key:"putwall_was", name:"old put wall "+money2(WS.put.from)+(L<WS.put.from?" (broken — now resistance)":""), value:WS.put.from, color:"#8a7aa8", lines:["put wall was "+money2(WS.put.from)+" → "+money2(WS.put.to), WS.put.why]});
  if(WS&&WS.call) levels.push({key:"callwall_was", name:"old call wall "+money2(WS.call.from)+(L>WS.call.from?" (broken — now support)":""), value:WS.call.from, color:"#8a7aa8", lines:["call wall was "+money2(WS.call.from)+" → "+money2(WS.call.to), WS.call.why]});
  /* one-line market position read — only from the labeled levels above
     and the same frozen quote that draws the marker */
  var others=levels.filter(function(l){ return l.key!=="market"; });
  var above=others.filter(function(l){ return l.value>L; }).sort(function(a,b){ return a.value-b.value; })[0];
  var below=others.filter(function(l){ return l.value<L; }).sort(function(a,b){ return b.value-a.value; })[0];
  function cents(v){ return Math.round(Math.abs(v)*100)+"¢"; }
  var parts=[];
  function nm(l){ return /\$/.test(l.name)?"the "+l.name:l.name+" "+money2(l.value); }
  if(above) parts.push(cents(above.value-L)+" below "+nm(above));
  if(below) parts.push(cents(L-below.value)+" above "+nm(below));
  /* today's move against the settle-anchored fan, in daily sigmas (the live fan is re-anchored on L, so L is
     compared with the SETTLE, never with itself) */
  var A=+f.anchor, ds=+f.sig, zd=ds>0?(L-A)/ds:0, az=Math.abs(zd);
  var band = (az<=1?"inside the ±1σ day range":az<=2?"inside ±2σ · outside ±1σ":"outside the ±2σ day range")+" of the "+money2(A)+" settle ("+(zd>=0?"+":"−")+az.toFixed(1)+"σ)";
  var read="Market "+money2(L)+" — "+parts.join(" · ")+(parts.length?" · ":"")+band+" · as of "+f.intraday[1];
  return { levels:levels, read:read };
}



/* ---------- fan chart zoom: price zoom in/out around the market, pan up/down, history window, reset; Ctrl/⌘ + wheel or pinch on the chart ---------- */
var FANZ={};
function fanZoomHTML(key){
  var Z=FANZ[key]||{z:1,pan:0,n:0}, n=Z.n||(DATA.grains[key].history||[]).length;
  var b=function(a,l,t){ return '<button class="fanz" data-fanz="'+a+'" data-fank="'+key+'" title="'+t+'">'+l+'</button>'; };
  var h=function(v,l){ return '<button class="fanz'+((Z.n||0)===v?' on':'')+'" data-fanh="'+v+'" data-fank="'+key+'">'+l+'</button>'; };
  return '<div class="fanzoom"><b>Zoom</b>'+b('in','＋','Zoom in (price)')+b('out','－','Zoom out (price)')+b('up','▲','Pan up')+b('down','▼','Pan down')+b('reset','Reset','Reset zoom')+
    '<span class="fz-info">'+(Z.z||1).toFixed(1)+'×'+(Z.lo!=null?' · '+money2(Z.lo)+' – '+money2(Z.hi):'')+'</span><b>History</b>'+h(0,'All')+h(15,'15d')+h(10,'10d')+h(5,'5d')+
    '<span class="fz-tip">Ctrl/⌘ + scroll or pinch on the chart also zooms</span></div>';
}
function fanZoomDo(key, act){
  var Z=FANZ[key]||(FANZ[key]={z:1,pan:0,n:0});
  if(act==='in') Z.z=Math.min(Z.z*1.4, 12); else if(act==='out') Z.z=Math.max(Z.z/1.4, 0.6);
  else if(act==='up') Z.pan+=0.12/Z.z; else if(act==='down') Z.pan-=0.12/Z.z; else if(act==='reset'){ Z.z=1; Z.pan=0; Z.n=0; }
  if(Math.abs(Z.z-1)<0.05&&act!=='reset'&&Math.abs(Z.pan)<1e-9) Z.z=1;
  renderGrain(key);
}
document.addEventListener('click', function(ev){
  var b=ev.target.closest&&ev.target.closest('[data-fanz],[data-fanh]'); if(!b) return;
  var k=b.getAttribute('data-fank');
  if(b.hasAttribute('data-fanh')){ (FANZ[k]=FANZ[k]||{z:1,pan:0,n:0}).n=+b.getAttribute('data-fanh'); renderGrain(k); }
  else fanZoomDo(k, b.getAttribute('data-fanz'));
});
var fanWheelT=0;
document.addEventListener('wheel', function(ev){
  if(!(ev.ctrlKey||ev.metaKey)) return;
  var t=ev.target.closest&&ev.target.closest('.tile[data-grain] svg'); if(!t||t.closest('.fanruler')) return;
  ev.preventDefault(); var now=Date.now(); if(now-fanWheelT<120) return; fanWheelT=now;
  fanZoomDo(t.closest('.tile[data-grain]').getAttribute('data-grain'), ev.deltaY<0?'in':'out');
}, {passive:false});
/* ---------- fan chart: level groups the user can switch on/off, merged near-identical labels, distance to market ---------- */
var FANG={p1:'sig',m1:'sig',p2:'sig',m2:'sig',p3:'sig3',m3:'sig3',ci99p:'ci',ci99m:'ci',ivp:'iv',ivm:'iv',ma20:'ma',ma50:'ma',callwall:'walls',putwall:'walls',putwall_was:'walls',callwall_was:'walls',ctr:'anchor',market:'market'};
var FANV=(function(){ var d={sig:true,sig3:false,ci:false,iv:true,ma:true,walls:true,anchor:false}; try{ var x=JSON.parse(localStorage.getItem('desk.fanv')||'{}'); Object.keys(d).forEach(function(k){ if(typeof x[k]==='boolean') d[k]=x[k]; }); }catch(e){} return d; })();
function fanOn(key){ var g=FANG[key]; return !g||g==='market'||FANV[g]!==false; }
function fanChipsHTML(key){
  var C=[['sig','±1σ / ±2σ','#e8eef4'],['sig3','±3σ','#e8eef4'],['ci','99% CI','#ff9d9d'],['iv','Options IV ±2σ','#38b6c9'],['ma','Moving averages','#f0c169'],['walls','Option walls','#b18cff'],['anchor','Live anchor','#38b6c9']];
  return '<div class="fanchips"><b>Show levels</b>'+C.map(function(c){ return '<button class="fanchip" data-fanv="'+c[0]+'" data-fank="'+key+'" aria-pressed="'+(FANV[c[0]]!==false)+'"><i style="background:'+c[2]+'"></i>'+c[1]+'</button>'; }).join('')+'</div>';
}
document.addEventListener('click', function(ev){
  var b=ev.target.closest&&ev.target.closest('[data-fanv]'); if(!b) return;
  var k=b.getAttribute('data-fanv'); FANV[k]=FANV[k]===false; try{ localStorage.setItem('desk.fanv', JSON.stringify(FANV)); }catch(e){}
  renderGrain(b.getAttribute('data-fank'));
});
/* price ruler: every visible level on one horizontal price axis, with the market and the nearest support / resistance named */
function fanRulerHTML(g, FL){
  var L=+g.fan.intraday[0], all=FL.levels.filter(function(l){ return l.key!=='market'&&l.key!=='ctr'&&fanOn(l.key); }), lv=all.filter(function(l){ return !l.off; }), offs=all.filter(function(l){ return l.off; });
  if(!lv.length) return '';
  var vals=lv.map(function(l){ return l.value; }).concat([L]), lo=Math.min.apply(null,vals), hi=Math.max.apply(null,vals), pad=(hi-lo)*0.04||0.01; lo-=pad; hi+=pad;
  var W=820, H=58, P=14, X=function(v){ return P+(W-2*P)*(v-lo)/(hi-lo); };
  var dn=lv.filter(function(l){ return l.value<L; }).sort(function(a,b){ return b.value-a.value; })[0], up=lv.filter(function(l){ return l.value>L; }).sort(function(a,b){ return a.value-b.value; })[0];
  var nm=function(l){ return (l.lines?l.lines[0].replace(/^[A-Za-z]{3}-\d\d /,''):l.label); };
  var s='<line x1="'+P+'" y1="30" x2="'+(W-P)+'" y2="30" stroke="#2b3e5c" stroke-width="2"/>';
  if(dn&&up) s+='<rect x="'+X(dn.value).toFixed(1)+'" y="25" width="'+(X(up.value)-X(dn.value)).toFixed(1)+'" height="10" fill="rgba(56,182,201,.18)" rx="2"/>';
  lv.forEach(function(l){ var x=X(l.value); s+='<line x1="'+x.toFixed(1)+'" y1="22" x2="'+x.toFixed(1)+'" y2="38" stroke="'+l.color+'" stroke-width="'+(l.lines?2.2:1.4)+'"><title>'+esc((l.lines?l.lines.join(' · '):l.label))+'</title></line>'; });
  var mx=X(L); s+='<path d="M'+mx.toFixed(1)+' 18 l-5 -8 h10z" fill="#ff6b6b"/><line x1="'+mx.toFixed(1)+'" y1="18" x2="'+mx.toFixed(1)+'" y2="42" stroke="#ff6b6b" stroke-width="2"/>';
  s+='<text x="'+P+'" y="54" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono">'+money2(lo+pad)+'</text><text x="'+(W-P)+'" y="54" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="end">'+money2(hi-pad)+'</text>';
  if(dn) s+='<text x="'+X(dn.value).toFixed(1)+'" y="54" fill="'+dn.color+'" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">'+money2(dn.value)+'</text>';
  if(up) s+='<text x="'+X(up.value).toFixed(1)+'" y="54" fill="'+up.color+'" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">'+money2(up.value)+'</text>';
  s+='<text x="'+mx.toFixed(1)+'" y="8" fill="#ff9d9d" font-size="10" font-weight="700" font-family="IBM Plex Mono" text-anchor="middle">'+money2(L)+'</text>';
  var c=function(v){ return (v>=0?'+':'−')+Math.round(Math.abs(v)*100)+'¢'; };
  return '<div class="fanruler"><svg viewBox="0 0 '+W+' '+H+'" class="no-zoom">'+s+'</svg><div class="fanruler-t">'+
    (dn?'<span>▼ Nearest support <b style="color:'+dn.color+'">'+esc(nm(dn))+'</b> '+c(dn.value-L)+'</span>':'<span>No level below the price</span>')+
    '<span class="mk">Market '+money2(L)+(offs.length?' <small>\u00b7 off-scale: '+offs.map(function(l){ return esc(nm(l))+' '+c(l.value-L); }).join(', ')+'</small>':'')+'</span>'+
    (up?'<span>▲ Nearest resistance <b style="color:'+up.color+'">'+esc(nm(up))+'</b> '+c(up.value-L)+'</span>':'<span>No level above the price</span>')+'</div></div>';
}
function fanSVG2(g, meta, FL){
  var fk=String(meta.name||'').toLowerCase(), Z=FANZ[fk]||{z:1,pan:0,n:0};
  var f=g.fan, hist=Z.n?g.history.slice(-Z.n):g.history, A=f.anchor, sig=f.sig, L=f.intraday[0];
  var W=860,H=400,PL=46,PR=250,PT=16,PB=30, pw=W-PL-PR, ph=H-PT-PB;
  var NH=hist.length, FD=10, span=NH-1+FD;
  var lo=Infinity, hi=-Infinity, i, d;
  for(i=0;i<NH;i++){ lo=Math.min(lo,hist[i].s); hi=Math.max(hi,hist[i].s); }
  /* vertical scale = history + the levels switched ON; an option wall far outside that range is pinned at the edge
     ("off-scale") instead of squashing the whole chart */
  if(FANV.ci!==false){ lo=Math.min(lo, f.r10_99[0]); hi=Math.max(hi, f.r10_99[1]); }
  FL.levels.forEach(function(l){ if(fanOn(l.key)&&!l.lines){ lo=Math.min(lo,l.value); hi=Math.max(hi,l.value); } });
  /* the drawn moving-average history stays inside the plot too, not just its last value (UI-FIX-07) */
  for(i=0;i<NH;i++) ['ma20','ma50'].forEach(function(k){ if(fanOn(k)&&hist[i][k]!=null){ lo=Math.min(lo,hist[i][k]); hi=Math.max(hi,hist[i][k]); } });
  var core=hi-lo;
  FL.levels.forEach(function(l){ if(fanOn(l.key)&&l.lines){ if(l.value>=lo-core*0.25&&l.value<=hi+core*0.25){ lo=Math.min(lo,l.value); hi=Math.max(hi,l.value); } else l.off=true; } else delete l.off; });
  var pad=(hi-lo)*0.05; lo-=pad; hi+=pad;
  /* zoom / pan: price window centred on the market (plus pan), narrowed by the zoom factor */
  if(Z.z!==1||Z.pan){ var full=hi-lo, cen=L+Z.pan*full, half=full/2/Z.z; lo=cen-half; hi=cen+half; }
  FANZ[fk]=Z; Z.lo=lo; Z.hi=hi;
  function X(x){ return PL + pw*(x/span); }
  function Y(y){ return PT + ph*(1-(y-lo)/(hi-lo)); }
  var s='';
  for(i=0;i<=4;i++){ var gy=PT+ph*i/4, gv=hi-(hi-lo)*i/4;
    s+='<line x1="'+PL+'" y1="'+gy+'" x2="'+(PL+pw)+'" y2="'+gy+'" stroke="#1e2a3a" stroke-width="1"/>';
    s+='<text x="'+(PL-6)+'" y="'+(gy+4)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">'+gv.toFixed(2)+'</text>'; }
  s+='<clipPath id="fanclip-'+fk+'"><rect x="'+PL+'" y="'+PT+'" width="'+pw+'" height="'+ph+'"/></clipPath><g clip-path="url(#fanclip-'+fk+')">';
  function conePath(anchorVal, mult){
    var pts=[], ptsB=[], dd;
    for(dd=0;dd<=FD;dd++){ var off=mult*sig*Math.sqrt(dd); pts.push([X(NH-1+dd),Y(anchorVal+off)]); ptsB.push([X(NH-1+dd),Y(anchorVal-off)]); }
    ptsB.reverse();
    var all=pts.concat(ptsB), p='M'+all[0][0].toFixed(1)+' '+all[0][1].toFixed(1);
    for(var j=1;j<all.length;j++) p+='L'+all[j][0].toFixed(1)+' '+all[j][1].toFixed(1);
    return p+'Z';
  }
  /* settle-anchored fan (amber family accent) + live-re-anchored fan (cyan) */
  s+='<path d="'+conePath(A,2.58)+'" fill="'+meta.accent+'" opacity="0.07"/>';
  s+='<path d="'+conePath(A,1.96)+'" fill="'+meta.accent+'" opacity="0.12"/>';
  s+='<path d="'+conePath(A,1.0)+'" fill="'+meta.accent+'" opacity="0.15"/>';
  s+='<path d="'+conePath(L,2.0)+'" fill="#38b6c9" opacity="0.08"/>';
  s+='<path d="'+conePath(L,1.0)+'" fill="#38b6c9" opacity="0.15"/>';
  s+='<line x1="'+X(NH-1)+'" y1="'+PT+'" x2="'+X(NH-1)+'" y2="'+(PT+ph)+'" stroke="#3d5a80" stroke-width="1" stroke-dasharray="3 3"/>';
  s+='<text x="'+(X(NH-1)-5)+'" y="'+(PT+ph+18)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">HISTORY · '+NH+' SETTLES</text>';
  s+='<text x="'+(X(NH-1)+6)+'" y="'+(PT+ph+18)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono">10-DAY FAN</text>';
  function maLine(key, color){
    var p='';
    hist.forEach(function(hh,idx){ if(hh[key]==null) return; p+=(p?'L':'M')+X(idx).toFixed(1)+' '+Y(hh[key]).toFixed(1); });
    return '<path d="'+p+'" fill="none" stroke="'+color+'" stroke-width="1.8"/>';
  }
  s+=maLine('ma20','#f0c169')+maLine('ma50','#b18cff');
  var lastH=hist[NH-1];
  /* exp MA extensions: flat zero-drift lines at the last trailing values */
  if(FANV.ma!==false){
  s+='<line x1="'+X(NH-1)+'" y1="'+Y(lastH.ma20)+'" x2="'+X(span)+'" y2="'+Y(lastH.ma20)+'" stroke="#f0c169" stroke-width="1.4" stroke-dasharray="2 3"/>';
  s+='<line x1="'+X(NH-1)+'" y1="'+Y(lastH.ma50)+'" x2="'+X(span)+'" y2="'+Y(lastH.ma50)+'" stroke="#b18cff" stroke-width="1.4" stroke-dasharray="2 3"/>'; }
  /* options wall lines */
  if(FANV.walls!==false&&g.near.call_wall[0]<=hi&&g.near.call_wall[0]>=lo){
  s+='<line x1="'+PL+'" y1="'+Y(g.near.call_wall[0])+'" x2="'+(PL+pw)+'" y2="'+Y(g.near.call_wall[0])+'" stroke="#b18cff" stroke-width="1" stroke-dasharray="2 3" opacity="0.75"/>';
  }
  var WSf=g.near.wall_shift;
  if(FANV.walls!==false&&WSf) ['put','call'].forEach(function(sd){ var w=WSf[sd]; if(!w||w.from>hi||w.from<lo) return;
    s+='<line x1="'+PL+'" y1="'+Y(w.from)+'" x2="'+(PL+pw)+'" y2="'+Y(w.from)+'" stroke="#8a7aa8" stroke-width="1" stroke-dasharray="1 4" opacity="0.8"/>'; });
  if(FANV.walls!==false&&g.near.put_wall[0]<=hi&&g.near.put_wall[0]>=lo){
  s+='<line x1="'+PL+'" y1="'+Y(g.near.put_wall[0])+'" x2="'+(PL+pw)+'" y2="'+Y(g.near.put_wall[0])+'" stroke="#b18cff" stroke-width="1" stroke-dasharray="2 3" opacity="0.75"/>'; }
  /* IV-implied band edges (live fan, day-10 width held across the fan) */
  var ivH=L*f.iv_10d_rel;
  if(FANV.iv!==false){
  s+='<line x1="'+X(NH-1)+'" y1="'+Y(L+ivH)+'" x2="'+X(span)+'" y2="'+Y(L+ivH)+'" stroke="#38b6c9" stroke-width="1" stroke-dasharray="6 4" opacity="0.8"/>';
  s+='<line x1="'+X(NH-1)+'" y1="'+Y(L-ivH)+'" x2="'+X(span)+'" y2="'+Y(L-ivH)+'" stroke="#38b6c9" stroke-width="1" stroke-dasharray="6 4" opacity="0.8"/>'; }
  /* settlements line */
  var sp=''; hist.forEach(function(hh,idx){ sp+=(sp?'L':'M')+X(idx).toFixed(1)+' '+Y(hh.s).toFixed(1); });
  s+='<path d="'+sp+'" fill="none" stroke="#dbe4f0" stroke-width="2"/>';
  s+='<circle cx="'+X(NH-1)+'" cy="'+Y(A)+'" r="3.6" fill="#fff"/>';
  s+='<line x1="'+X(NH-1)+'" y1="'+Y(A)+'" x2="'+X(span)+'" y2="'+Y(A)+'" stroke="#8494ab" stroke-width="1" stroke-dasharray="5 4"/>';
  s+='<line x1="'+X(NH-1)+'" y1="'+Y(L)+'" x2="'+X(span)+'" y2="'+Y(L)+'" stroke="#38b6c9" stroke-width="1.8"/>';
  /* MARKET marker — the frozen build-time delayed quote */
  s+='<line x1="'+PL+'" y1="'+Y(L)+'" x2="'+(PL+pw)+'" y2="'+Y(L)+'" stroke="#ff6b6b" stroke-width="1.6" stroke-dasharray="7 3"/>';
  var mly=Y(L)-8; if(mly<PT+12) mly=Y(L)+16;
  s+='<text x="'+(PL+6)+'" y="'+mly.toFixed(1)+'" fill="#ff9d9d" font-size="10.5" font-weight="600" font-family="IBM Plex Mono">MARKET (delayed) '+money2(L)+' · as of '+f.intraday[1]+'</text>';
  s+='<circle cx="'+X(span)+'" cy="'+Y(L)+'" r="4" fill="#ff6b6b"/>';
  var FE=window.FAN_EVENT; if(FE&&DATA.grains[FE.key]===g&&Date.now()-FE.at<30*60000){
    var ed=new Date(FE.t).toLocaleDateString('en-CA',{timeZone:'America/Toronto'}), ei=-1;
    for(var q=0;q<NH;q++) if(String(hist[q].d).slice(0,10)<=ed) ei=q;
    if(ei>=0){ var ex=X(ei), el=new Date(FE.t).toLocaleString('en-US',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
      s+='<line x1="'+ex.toFixed(1)+'" y1="'+PT+'" x2="'+ex.toFixed(1)+'" y2="'+(PT+ph)+'" stroke="#e8b93d" stroke-width="1.5" stroke-dasharray="4 3"/>'+
        '<text x="'+(ex-4).toFixed(1)+'" y="'+(PT+11)+'" text-anchor="end" fill="#e8b93d" font-size="10.5" font-weight="700" font-family="IBM Plex Mono">⚑ alert '+esc(el)+' ET</text>'; } }
  s+='</g>';
  /* right-edge label stack with de-collision (the app's algorithm):
     labels sit at their true price unless a neighbour is too close, in
     which case they are spaced to a minimum gap and a leader line ties
     each label back to its true level — no overlapping label text */
  var rx=PL+pw, top=PT+6, bot=PT+ph-6;
  /* visible groups only; single-line levels within ~0.3% of each other share one label; each shows its distance to the market */
  var cts=function(v){ return (v>=0?'+':'\u2212')+Math.round(Math.abs(v)*100)+'\u00a2'; };
  var vis=FL.levels.filter(function(l){ return fanOn(l.key); }).slice().sort(function(a,b){ return b.value-a.value; }), merged=[];
  vis.forEach(function(l){
    var m=merged[merged.length-1], mergeable=!l.lines&&l.key!=='market'&&m&&!m.lines&&m.key!=='market'&&Math.abs(m.value-l.value)<=0.003*L;
    if(mergeable){ m.label=m.label+' \u00b7 '+l.label; m.parts.push(l); m.value=(m.value*(m.parts.length-1)+l.value)/m.parts.length; }
    else merged.push(Object.assign({}, l, {parts:[l]}));
  });
  merged.forEach(function(l){ if(!l.lines&&(l.value>hi||l.value<lo)) l.label=(l.value>hi?'\u25b2 ':'\u25bc ')+l.label;
    if(!l.lines&&l.key!=='market'&&l.key!=='ctr') l.label=l.label+' '+cts(l.value-L); else if(l.lines) l.lines=[(l.off?(l.value>L?'\u25b2 ':'\u25bc ')+'off-scale \u00b7 ':'')+l.lines[0], l.lines[1]+' \u00b7 '+cts(l.value-L)]; });
  /* right-edge labels wrap onto extra lines instead of being cut (fan fix): every word stays readable inside the chart */
  var room=W-(rx+13)-4, LH=12.5;
  function wrap(t,fs){ t=String(t); var mx=Math.max(8,Math.floor(room/(fs*0.62))), out=[], cur='';
    t.split(' ').forEach(function(w){ if(!cur) cur=w; else if((cur+' '+w).length<=mx) cur+=' '+w; else { out.push(cur); cur=w; } });
    if(cur) out.push(cur); return out.map(function(x){ return x.length>mx?x.slice(0,mx):x; }); }
  var items=merged.map(function(l){ var rows=l.lines?wrap(l.lines[0],11).concat(wrap(l.lines[1],11)):wrap(l.label,11.5);
      return { l:l, rows:rows, trueY:Math.min(Math.max(Y(l.value),PT),PT+ph), h:rows.length*LH+2 }; })
    .filter(function(it){ return it.trueY>=top-60 && it.trueY<=bot+60; })
    .sort(function(a,b){ return a.trueY-b.trueY; });
  var ys=items.map(function(it){ return Math.min(Math.max(it.trueY, top), bot); });
  for(i=1;i<items.length;i++){ var need=items[i-1].h/2+items[i].h/2+3; ys[i]=Math.max(ys[i], ys[i-1]+need); }
  if(ys.length && ys[ys.length-1]>bot){
    ys[ys.length-1]=bot;
    for(i=items.length-2;i>=0;i--){ need=items[i].h/2+items[i+1].h/2+3; ys[i]=Math.min(ys[i], ys[i+1]-need); }
    if(ys[0]<top){ ys[0]=top;
      for(i=1;i<items.length;i++){ need=items[i-1].h/2+items[i].h/2+3; ys[i]=Math.max(ys[i], ys[i-1]+need); } }
  }
  items.forEach(function(it,idx){
    var ly=ys[idx], y0=ly-(it.rows.length-1)*LH/2+3.5, fs=it.l.lines?11:11.5, fw=it.l.lines?600:(it.l.bold?700:500);
    s+='<line x1="'+(rx-1)+'" y1="'+it.trueY.toFixed(1)+'" x2="'+(rx+9)+'" y2="'+ly.toFixed(1)+'" stroke="'+it.l.color+'" stroke-width="1"/>';
    s+='<circle cx="'+(rx-1)+'" cy="'+it.trueY.toFixed(1)+'" r="2" fill="'+it.l.color+'"/>';
    s+='<text x="'+(rx+13)+'" y="'+y0.toFixed(1)+'" fill="'+it.l.color+'" font-size="'+fs+'" font-weight="'+fw+'" font-family="IBM Plex Mono">'+
      it.rows.map(function(r,k){ return '<tspan x="'+(rx+13)+'"'+(k?' dy="'+LH+'"':'')+'>'+r+'</tspan>'; }).join('')+'</text>';
  });
  s+='<text x="'+PL+'" y="'+(PT+ph+18)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono">'+hist[0].d.slice(0,10)+'</text>';
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Settlement history with settle-anchored and live-re-anchored 10-day sigma fans for '+meta.name+', right-edge labeled levels at day 10, and the market marker frozen at the build-time delayed quote">'+s+'</svg>';
}

/* ---------------- Export Sales — 10-week trend (verified dataset, Oct 22, 2026) ----------------
   Weeks: [week_ending, release_date, actual_mt, estimate_low_mt|null, estimate_high_mt|null].
   Trend: [slope_mt_per_week, start_mt, end_mt] — OLS fit carried in the dataset. */
var EXPORT = {
corn: { trend:[-11172.5, 1155724.8, 1055172.2], weeks:[
 ["2026-08-13","2026-08-20",1049000,null,null],["2026-08-20","2026-08-27",1100000,800000,1600000],
 ["2026-08-27","2026-09-03",1156800,null,null],["2026-09-03","2026-09-11",1928700,700000,1700000],
 ["2026-09-10","2026-09-17",1026700,1000000,2000000],["2026-09-17","2026-09-24",838328,500000,1600000],
 ["2026-09-24","2026-10-01",535989,500000,1300000],["2026-10-01","2026-10-08",769468,635030,1651278],
 ["2026-10-08","2026-10-16",1122400,500000,1200000],["2026-10-15","2026-10-22",1527100,700000,1500000]]},
soybeans: { trend:[-102921.2, 2076438.7, 1150147.7], weeks:[
 ["2026-08-13","2026-08-20",1808000,null,null],["2026-08-20","2026-08-27",2550000,1100000,3100000],
 ["2026-08-27","2026-09-03",1854200,null,null],["2026-09-03","2026-09-11",2637300,null,null],
 ["2026-09-10","2026-09-17",1702000,900000,2400000],["2026-09-17","2026-09-24",582432,500000,2000000],
 ["2026-09-24","2026-10-01",1033545,null,null],["2026-10-01","2026-10-08",549377,435448,1197482],
 ["2026-10-08","2026-10-16",574878,489879,1197482],["2026-10-15","2026-10-22",2841200,1800000,3000000]]},
wheat: { trend:[-6351.3, 348348.1, 291185.9], weeks:[
 ["2026-08-13","2026-08-20",393700,null,null],["2026-08-20","2026-08-27",402500,200000,550000],
 ["2026-08-27","2026-09-03",313500,null,null],["2026-09-03","2026-09-11",194200,null,null],
 ["2026-09-10","2026-09-17",325900,200000,500000],["2026-09-17","2026-09-24",267553,200000,550000],
 ["2026-09-24","2026-10-01",289255,250000,450000],["2026-10-01","2026-10-08",451562,null,null],
 ["2026-10-08","2026-10-16",319900,300000,600000],["2026-10-15","2026-10-22",239600,250000,550000]]}
};
var MONS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtShortDate(iso){ var p=iso.split("-"); return MONS[+p[1]-1]+" "+(+p[2]); }
function fmtDate(iso){ return fmtShortDate(iso)+", "+iso.slice(0,4); }
function fmtKMT(v){ return fmt(Math.round(v/1000))+"k MT"; }
function fmtKVal(v){ var k=v/1000; return (Math.abs(k)>=100 ? fmt(Math.round(k)) : k.toFixed(1))+"k MT"; }
function fmtFullMT(v){ return fmt(Math.round(v))+" MT"; }
function fmtTrendSlope(slope){ var mag=fmt(Math.round(Math.abs(slope))); var sign=slope>0?"+":slope<0?"−":""; return "trend "+sign+mag+" MT/wk"; }
function esVerdict(w){ if(w[3]==null||w[4]==null) return null; if(w[2]>w[4]) return "BEAT"; if(w[2]<w[3]) return "MISS"; return "INLINE"; }

var ES_COL={BEAT:'#3fb97f', MISS:'#e0655f', INLINE:'#38b6c9', NONE:'#4b6584'};
function exportSVG(key){
  var E=(DATA.exports&&DATA.exports[key])||EXPORT[key], weeks=E.weeks, tl=E.trend, n=weeks.length;
  var W=760,H=300,PL=54,PR=12,PT=30,PB=34, pw=W-PL-PR, ph=H-PT-PB;
  var ymax=0;
  weeks.forEach(function(w){ ymax=Math.max(ymax, w[2], w[4]||0); });
  ymax=Math.max(ymax, tl[1], tl[2])*1.16;
  function Y(v){ return PT+ph*(1-v/ymax); }
  var slot=pw/n; function CX(i){ return PL+slot*i+slot/2; }
  var s='', i;
  for(i=0;i<=4;i++){ var gv=ymax*i/4, gy=Y(gv);
    s+='<line x1="'+PL+'" y1="'+gy.toFixed(1)+'" x2="'+(PL+pw)+'" y2="'+gy.toFixed(1)+'" stroke="#1e2a3a"/>'+
       '<text x="'+(PL-6)+'" y="'+(gy+4).toFixed(1)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">'+fmt(Math.round(gv/1000))+'k</text>'; }
  weeks.forEach(function(w,i){
    var v=esVerdict(w)||'NONE', isL=i===n-1, bwid=slot*0.52, x=CX(i)-bwid/2;
    /* consensus range band behind the bar */
    if(w[3]!=null&&w[4]!=null){
      var bx=CX(i)-slot*0.40;
      s+='<rect x="'+bx.toFixed(1)+'" y="'+Y(w[4]).toFixed(1)+'" width="'+(slot*0.80).toFixed(1)+'" height="'+(Y(w[3])-Y(w[4])).toFixed(1)+'" fill="#dbe4f0" opacity="0.10" stroke="#8494ab" stroke-opacity="0.55" stroke-dasharray="3 3"/>';
    }
    s+='<rect x="'+x.toFixed(1)+'" y="'+Y(w[2]).toFixed(1)+'" width="'+bwid.toFixed(1)+'" height="'+(PT+ph-Y(w[2])).toFixed(1)+'" fill="'+ES_COL[v]+'" opacity="'+(isL?1:0.85)+'"'+(isL?' stroke="#e8a33d" stroke-width="2.5"':'')+'/>';
    /* consensus midpoint diamond */
    if(w[3]!=null&&w[4]!=null){
      var my=Y((w[3]+w[4])/2), cx=CX(i);
      s+='<path d="M'+cx.toFixed(1)+' '+(my-5).toFixed(1)+'L'+(cx+5).toFixed(1)+' '+my.toFixed(1)+'L'+cx.toFixed(1)+' '+(my+5).toFixed(1)+'L'+(cx-5).toFixed(1)+' '+my.toFixed(1)+'Z" fill="#0d141f" stroke="#e8eef4" stroke-width="1.5"/>';
    }
  });
  /* trendline (values are printed above the chart, not on it) */
  s+='<line x1="'+CX(0).toFixed(1)+'" y1="'+Y(tl[1]).toFixed(1)+'" x2="'+CX(n-1).toFixed(1)+'" y2="'+Y(tl[2]).toFixed(1)+'" stroke="#b18cff" stroke-width="2" stroke-dasharray="6 4"/>';
  /* one value label per bar, above the bar AND above its consensus band */
  weeks.forEach(function(w,i){
    var top=Math.min(Y(w[2]), w[4]!=null?Y(w[4]):Infinity), ly=top-7, txt=fmt(Math.round(w[2]/1000))+'k';
    var tw=txt.length*6.6+10, isL=i===n-1;
    s+='<rect x="'+(CX(i)-tw/2).toFixed(1)+'" y="'+(ly-11).toFixed(1)+'" width="'+tw.toFixed(1)+'" height="15" rx="3" fill="#0d141f" opacity="0.92"/>'+
       '<text x="'+CX(i).toFixed(1)+'" y="'+ly.toFixed(1)+'" fill="'+(isL?'#e8a33d':'#e8eef4')+'" font-size="11" font-weight="600" font-family="IBM Plex Mono" text-anchor="middle">'+txt+'</text>';
    s+='<text x="'+CX(i).toFixed(1)+'" y="'+(PT+ph+17)+'" fill="#8494ab" font-size="10.5" font-family="IBM Plex Mono" text-anchor="middle">'+fmtShortDate(w[0])+'</text>';
  });
  s+='<text x="'+PL+'" y="'+(H-4)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono">WEEK ENDING · BAR = ACTUAL NET SALES · BAND = CONSENSUS RANGE · ◇ = CONSENSUS MIDPOINT</text>';
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Weekly export net sales, last '+n+' releases, each bar labeled with its actual value, consensus range band and midpoint, dashed trendline">'+s+'</svg>';
}
function exportConsTable(key){
  var weeks=((DATA.exports&&DATA.exports[key])||EXPORT[key]).weeks.slice().reverse();
  var rows=weeks.map(function(w,i){
    var v=esVerdict(w), has=w[3]!=null&&w[4]!=null, mid=has?(w[3]+w[4])/2:null, d=has?w[2]-mid:null;
    var chip=v?'<span class="chip '+(v==='BEAT'?'beat':v==='MISS'?'miss':'inline')+'">'+(v==='BEAT'?'ABOVE':v==='MISS'?'BELOW':'INSIDE')+'</span>':'<span class="neu">no estimate</span>';
    return '<tr'+(i===0?' class="hl-row"':'')+'><td class="lbl" data-l="">'+fmtShortDate(w[0])+(i===0?' · latest':'')+'</td>'+
      '<td data-l="Actual"><b>'+fmt(Math.round(w[2]/1000))+'k</b></td>'+
      '<td data-l="Consensus range">'+(has?fmt(Math.round(w[3]/1000))+'k – '+fmt(Math.round(w[4]/1000))+'k':'—')+'</td>'+
      '<td data-l="Midpoint">'+(has?fmt(Math.round(mid/1000))+'k':'—')+'</td>'+
      '<td data-l="Actual − mid">'+(has?'<span class="'+cls(d)+'">'+sgn(Math.round(d/1000),0)+'k ('+sgn(d/mid*100,0,'%')+')</span>':'—')+'</td>'+
      '<td data-l="vs range">'+chip+'</td></tr>';
  }).join('');
  return '<h3 class="es-tblh">Consensus vs actual — every week</h3><table class="es-tbl"><thead><tr><th>Week ending</th><th>Actual</th><th>Consensus range</th><th>Midpoint</th><th>Actual − mid</th><th>vs range</th></tr></thead><tbody>'+rows+'</tbody></table>';
}

function exportTileHTML(key){
  var E=(DATA.exports&&DATA.exports[key])||EXPORT[key], weeks=E.weeks, tl=E.trend;
  var latest=weeks[weeks.length-1];
  var verdict=esVerdict(latest);
  var chipCls = verdict==="BEAT" ? "beat" : verdict==="MISS" ? "miss" : "inline";
  var vline = verdict
    ? verdict+" — "+(verdict==="BEAT"?"above":verdict==="MISS"?"below":"inside")+" the verified estimate range "+fmtFullMT(latest[3])+" – "+fmtFullMT(latest[4])+"."
    : "No verified estimate range for this week — no beat / miss judged.";
  var estWeeks=weeks.filter(function(w){ return w[3]!=null; });
  var nb=0, nm=0, ni=0;
  estWeeks.forEach(function(w){ var v=esVerdict(w); if(v==="BEAT") nb++; else if(v==="MISS") nm++; else if(v==="INLINE") ni++; });
  var dir = tl[0]>0 ? "trending higher" : tl[0]<0 ? "trending lower" : "flat";
  var slopeTxt=(tl[0]>=0?"+":"−")+fmtKVal(Math.abs(tl[0]))+" per week";
  var trendAtLatest=tl[1]+tl[0]*(weeks.length-1);
  var diff=latest[2]-trendAtLatest;
  var read="Net sales are "+dir+" over the "+weeks.length+" weeks (trendline "+slopeTxt+"). Latest week (ending "+fmtDate(latest[0])+") at "+fmtKMT(latest[2])+" is "+fmtKVal(Math.abs(diff))+" "+(diff>=0?"above":"below")+" the trendline."+
    " Verified estimates on "+estWeeks.length+" of "+weeks.length+" weeks: "+ni+" inline, "+nb+" beat, "+nm+" miss.";
  var ranges=estWeeks.map(function(w){ return fmtShortDate(w[0])+": "+fmtKMT(w[3])+"–"+fmtKMT(w[4]); }).join(" · ");
  var cmid=(latest[3]+latest[4])/2, cspread=latest[2]-cmid, cspct=cspread/cmid*100;
  var consBlock = verdict
    ? '<div class="consensus"><h3>Consensus vs actual — latest week (w/e '+fmtShortDate(latest[0])+')</h3>'+
      '<div class="kv"><span class="kk">Consensus — verified estimate range</span><span class="vv">'+fmtFullMT(latest[3])+' – '+fmtFullMT(latest[4])+'</span></div>'+
      '<div class="kv"><span class="kk">Consensus midpoint</span><span class="vv">'+fmtFullMT(cmid)+'</span></div>'+
      '<div class="kv"><span class="kk">Actual</span><span class="vv">'+fmtFullMT(latest[2])+'</span></div>'+
      '<div class="kv"><span class="kk">Spread — actual minus consensus midpoint</span><span class="vv"><span class="'+cls(cspread)+'">'+sgn(cspread,0)+' MT ('+sgn(cspct,1,'%')+')</span></span></div>'+
      '<div class="kv"><span class="kk">Verdict vs the range</span><span class="vv"><span class="chip '+chipCls+'">'+verdict+'</span></span></div></div>'
    : '';
  return '<div class="tile wide" data-src="exports"><h2>'+flag('us',15)+' Export Sales — 10-week trend <span class="h2note">weekly net sales · current marketing year</span></h2>'+
    '<div class="es-head"><div class="k">Latest release · week ending '+fmtDate(latest[0])+' · released '+fmtDate(latest[1])+'</div>'+
    '<div class="es-big">Latest actual (w/e '+fmtShortDate(latest[0])+'): '+fmtFullMT(latest[2])+(verdict?' <span class="chip '+chipCls+'">'+verdict+'</span>':'')+'</div>'+
    '<p class="read" style="margin-top:4px">'+vline+'</p></div>'+ consBlock +
    '<p class="trendline-note">Trendline: start '+fmtFullMT(tl[1])+' (w/e '+fmtShortDate(weeks[0][0])+') → end '+fmtFullMT(tl[2])+' (w/e '+fmtShortDate(latest[0])+') · '+fmtTrendSlope(tl[0])+'</p>'+
    '<div class="legend"><span><span class="sw" style="background:#3fb97f"></span>Actual above range</span><span><span class="sw" style="background:#38b6c9"></span>Inside range</span><span><span class="sw" style="background:#e0655f"></span>Below range</span><span><span class="sw" style="background:#4b6584"></span>No estimate</span><span><span class="sw" style="background:transparent;border:1px dashed #8494ab"></span>Consensus range</span><span>\u25C7 Consensus midpoint</span><span><span class="sw" style="background:#b18cff"></span>Trendline</span></div>'+
    exportSVG(key)+ exportConsTable(key)+
    '<p class="read"><b>Read:</b> '+read+'</p>'+
    '<div class="stamp">'+esc(E.source||'USDA FAS weekly export sales')+' \u00b7 releases '+fmtDate(weeks[0][1])+' \u2013 '+fmtDate(latest[1])+' \u00b7 consensus ranges on '+estWeeks.length+' of '+weeks.length+' weeks (desk-entered)</div></div>';
}

/* ---------------- SVG chart builders ---------------- */
function oiSVG(rows, ds, cp, prev, lab){
  cp=cp||'both'; var shC=cp!=='put', shP=cp!=='call';
  /* phone: a narrower viewBox keeps text at a readable size, and the strike range is cut to the area around price and the walls */
  var narrow=(typeof window!=='undefined'&&window.innerWidth<640);
  var Ux=ds.wall_ref||ds.underlying;
  if(narrow&&rows.length>44){
    var pi=0; rows.forEach(function(r,i){ if(Ux&&r[0]<=Ux) pi=i; });
    var lo=Math.max(0,pi-18), hi=Math.min(rows.length-1,pi+19);
    rows.forEach(function(r,i){ if((shC&&Math.abs(r[0]-ds.call_wall[0])<0.001)||(shP&&Math.abs(r[0]-ds.put_wall[0])<0.001)){ lo=Math.min(lo,i); hi=Math.max(hi,i); } });
    rows=rows.slice(Math.max(0,lo-3), hi+4);
  }
  var W=narrow?420:760, H=narrow?300:290, PL=narrow?34:46, PR=narrow?8:14, PT=narrow?44:30, PB=narrow?50:52, pw=W-PL-PR, ph=H-PT-PB;
  var FS=narrow?11:10.5, CW=FS*0.62;   /* mono glyph width, for label collision checks */
  var max=0; rows.forEach(function(r){ max=Math.max(max,shC?r[1]:0,shP?r[2]:0); }); max=max||1;
  var mag=Math.pow(10,Math.floor(Math.log10(max/3))), ystep=[1,2,2.5,5,10].map(function(m){ return m*mag; }).filter(function(v){ return max*1.04/v<=4; })[0]||10*mag, nt=Math.ceil(max*1.04/ystep); max=nt*ystep;
  var n=rows.length, bw=pw/n;
  function Y(v){ return PT+ph*(1-v/max); }
  function cx(idx){ return PL+idx*bw+bw/2; }
  function kfmt(v){ return v>=1000?(v/1000).toFixed(v<10000&&v%1000?1:0).replace(/\.0$/,'')+'k':Math.round(v)+''; }
  function T(x,y,txt,o){ o=o||{}; return '<text x="'+(+x).toFixed(1)+'" y="'+(+y).toFixed(1)+'" fill="'+(o.c||'#8f9db3')+'" font-size="'+(o.fs||FS)+'"'+(o.w?' font-weight="'+o.w+'"':'')+' font-family="IBM Plex Mono" text-anchor="'+(o.a||'middle')+'">'+txt+'</text>'; }
  var s='';
  for(var i=0;i<=nt;i++){ var gy=PT+ph*i/nt, gv=max*(1-i/nt);
    s+='<line x1="'+PL+'" y1="'+gy+'" x2="'+(PL+pw)+'" y2="'+gy+'" stroke="#1e2a3a"/>';
    s+=T(PL-5,gy+4,kfmt(gv),{a:'end'}); }
  rows.forEach(function(r,idx){
    var x=PL+idx*bw, gap=bw>4?1:0, cw=Math.max(1,(cp==='both'?(bw-gap)*0.44:bw*0.7));
    var isCW = Math.abs(r[0]-ds.call_wall[0])<0.001, isPW = Math.abs(r[0]-ds.put_wall[0])<0.001;
    var itmC=Ux&&r[0]<Ux-1e-9, itmP=Ux&&r[0]>Ux+1e-9;   /* in-the-money strikes are faded: they are positions from when price was elsewhere, not levels ahead */
    var x0=x+(bw-(cp==='both'?2*cw+gap:cw))/2;
    if(shC&&r[1]>0) s+='<rect x="'+x0.toFixed(1)+'" y="'+Y(r[1]).toFixed(1)+'" width="'+cw.toFixed(1)+'" height="'+(PT+ph-Y(r[1])).toFixed(1)+'" fill="'+(isCW?'#ffd27a':'#3fb97f')+'"'+(itmC?' opacity=".35"':'')+'/>';
    if(shP&&r[2]>0) s+='<rect x="'+(cp==='both'?x0+cw+gap:x0).toFixed(1)+'" y="'+Y(r[2]).toFixed(1)+'" width="'+cw.toFixed(1)+'" height="'+(PT+ph-Y(r[2])).toFixed(1)+'" fill="'+(isPW?'#ff9d97':'#b34a44')+'"'+(itmP?' opacity=".35"':'')+'/>';
  });
  s+='<line x1="'+PL+'" y1="'+(PT+ph)+'" x2="'+(PL+pw)+'" y2="'+(PT+ph)+'" stroke="#2c3a4e"/>';
  /* strike labels: as many as fit without touching; walls and the strike next to price always get one */
  var lw=5*CW+8, keep=[], must={};
  rows.forEach(function(r,idx){ if(Math.abs(r[0]-ds.call_wall[0])<0.001&&shC) must[idx]=1; if(Math.abs(r[0]-ds.put_wall[0])<0.001&&shP) must[idx]=1; });
  var nice=[0.05,0.1,0.25,0.5,1,2,5], span=(rows[n-1][0]-rows[0][0])||1, want=Math.max(2,Math.floor(pw/(lw*1.15))), stepK=nice.filter(function(v){ return span/v<=want; })[0]||10;
  Object.keys(must).forEach(function(k){ keep.push(+k); });
  rows.forEach(function(r,idx){ var m=r[0]/stepK; if(Math.abs(m-Math.round(m))<1e-6) keep.push(idx); });
  keep.sort(function(a,b){ return (must[b]?1:0)-(must[a]?1:0)||a-b; });
  var placed=[]; keep.forEach(function(idx){ var x=cx(idx); if(!must[idx]&&(x-lw/2<PL-8||x+lw/2>W-2)) return; var lx=Math.min(Math.max(x,PL-8+lw/2),W-2-lw/2); if(placed.some(function(p){ return Math.abs(p-lx)<lw; })) return; placed.push(lx);
    s+='<line x1="'+x.toFixed(1)+'" y1="'+(PT+ph)+'" x2="'+x.toFixed(1)+'" y2="'+(PT+ph+3)+'" stroke="#2c3a4e"/>'+T(lx,PT+ph+15,rows[idx][0].toFixed(2),{c:must[idx]?'#c9d4e3':'#8f9db3'}); });
  var PV={}; if(prev&&prev.rows) prev.rows.forEach(function(r){ PV[r[0]]=r; });
  rows.forEach(function(r,idx){ var q=PV[r[0]], tot=r[1]+r[2];
    var tip=(lab?esc(lab)+' · ':'')+'strike '+r[0].toFixed(2)+'|Calls '+fmt(r[1])+(q?' ('+sgn(r[1]-q[1],0)+')':'')+'|Puts '+fmt(r[2])+(q?' ('+sgn(r[2]-q[2],0)+')':'')+'|P/C '+(r[1]?fmt(r[2]/r[1],2):'—')+' · total '+fmt(tot)+(q?'|change vs '+fmtShortDate(prev.date)+' close':'');
    s+='<rect class="oi-hit" x="'+(PL+idx*bw).toFixed(1)+'" y="'+PT+'" width="'+bw.toFixed(1)+'" height="'+ph+'" fill="transparent" data-tip="'+tip+'"/>'; });
  /* wall labels live in their own lane above the plot; two labels that would touch are stacked on two lines,
     and every label is kept inside the chart edges */
  function idxOf(k){ var ii=-1; rows.forEach(function(r,i2){ if(Math.abs(r[0]-k)<0.001) ii=i2; }); return ii; }
  var walls=[];
  if(shP){ var ip=idxOf(ds.put_wall[0]); if(ip>=0) walls.push({x:cx(ip), t:(narrow?'PUT ':'PUT WALL ')+ds.put_wall[0].toFixed(2)+' · '+fmt(ds.put_wall[1]), c:'#ff9d97'}); }
  if(shC){ var ic=idxOf(ds.call_wall[0]); if(ic>=0) walls.push({x:cx(ic), t:(narrow?'CALL ':'CALL WALL ')+ds.call_wall[0].toFixed(2)+' · '+fmt(ds.call_wall[1]), c:'#ffd27a'}); }
  walls.sort(function(a,b){ return a.x-b.x; });
  var lane=[PT-8, PT-8];
  walls.forEach(function(w){ w.w=w.t.length*CW*1.05; w.l=Math.min(Math.max(w.x-w.w/2,2),W-2-w.w); w.y=lane[0]; });
  if(walls.length===2&&walls[0].l+walls[0].w+10>walls[1].l){
    /* not enough room side by side: push them apart if the chart is wide enough, else stack */
    var need=walls[0].w+walls[1].w+10;
    if(need<=W-4){ var mid=(walls[0].x+walls[1].x)/2, L0=Math.max(2,Math.min(mid-need/2,W-2-need)); walls[0].l=L0; walls[1].l=L0+walls[0].w+10; }
    else { walls[0].y=PT-8-(FS+5); }
  }
  walls.forEach(function(w){
    s+='<line x1="'+w.x.toFixed(1)+'" y1="'+(w.y+3)+'" x2="'+w.x.toFixed(1)+'" y2="'+(PT+ph)+'" stroke="'+w.c+'" stroke-width="1.4" stroke-dasharray="4 3"/>';
    s+=T(w.l,w.y,w.t,{c:w.c,a:'start',w:600}); });
  /* live price: line through the plot, badge in the lane under the strike axis so it never covers bars or strike labels */
  if(Ux){ var xi=null; for(var q=0;q<rows.length-1;q++){ if(rows[q][0]<=Ux&&Ux<=rows[q+1][0]){ xi=PL+(q+(Ux-rows[q][0])/((rows[q+1][0]-rows[q][0])||1))*bw+bw/2; break; } }
    if(xi!=null){ var bt='PRICE '+(+Ux).toFixed(4), bwd=bt.length*CW+14, bx=Math.min(Math.max(xi-bwd/2,2),W-2-bwd), by=PT+ph+22;
      s+='<line x1="'+xi.toFixed(1)+'" y1="'+PT+'" x2="'+xi.toFixed(1)+'" y2="'+(by)+'" stroke="#e8eef4" stroke-width="1.6"/>'+
        '<rect x="'+bx.toFixed(1)+'" y="'+by+'" width="'+bwd.toFixed(1)+'" height="'+(FS+8)+'" rx="4" fill="#0b1220" stroke="#e8eef4" stroke-width=".8"/>'+
        T(bx+bwd/2,by+FS+3,bt,{c:'#fff',w:700}); } }
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Open interest by strike" data-oi-narrow="'+(narrow?1:0)+'">'+s+'</svg>';
}

function skewSVG(g, meta){
  var pts=g.skew, A=(g.near&&g.near.underlying)||g.fan.anchor;  /* skew strikes are priced off the option's own futures */
  var W=760,H=250,PL=46,PR=16,PT=18,PB=30, pw=W-PL-PR, ph=H-PT-PB;
  var xs=pts.map(function(p){return p[0];}), ys=pts.map(function(p){return p[1];});
  var x0=Math.min.apply(null,xs), x1=Math.max.apply(null,xs);
  var y0=Math.min.apply(null,ys)*0.92, y1=Math.max.apply(null,ys)*1.06;
  function X(v){ return PL+pw*(v-x0)/(x1-x0); } function Y(v){ return PT+ph*(1-(v-y0)/(y1-y0)); }
  var s='';
  for(var i=0;i<=3;i++){ var gy=PT+ph*i/3, gv=y1-(y1-y0)*i/3;
    s+='<line x1="'+PL+'" y1="'+gy+'" x2="'+(PL+pw)+'" y2="'+gy+'" stroke="#1e2a3a"/>';
    s+='<text x="'+(PL-6)+'" y="'+(gy+4)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">'+gv.toFixed(0)+'%</text>'; }
  function seg(type, color){
    var pp=pts.filter(function(p){return p[2]===type;}); if(!pp.length) return '';
    var d=''; pp.forEach(function(p){ d+=(d?'L':'M')+X(p[0]).toFixed(1)+' '+Y(p[1]).toFixed(1); });
    var out='<path d="'+d+'" fill="none" stroke="'+color+'" stroke-width="1.8"/>';
    pp.forEach(function(p){ out+='<circle cx="'+X(p[0]).toFixed(1)+'" cy="'+Y(p[1]).toFixed(1)+'" r="2.4" fill="'+color+'"/>'; });
    return out;
  }
  s+=seg('P','#e0655f')+seg('C','#3fb97f');
  s+='<line x1="'+X(A)+'" y1="'+PT+'" x2="'+X(A)+'" y2="'+(PT+ph)+'" stroke="#3d5a80" stroke-dasharray="3 3"/>';
  s+='<text x="'+X(A)+'" y="'+(PT+ph+18)+'" fill="#8494ab" font-size="10.5" font-family="IBM Plex Mono" text-anchor="middle">FUT '+A.toFixed(2)+'</text>';
  s+='<text x="'+PL+'" y="'+(PT+ph+18)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono">'+x0.toFixed(2)+'</text>';
  s+='<text x="'+(PL+pw)+'" y="'+(PT+ph+18)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">'+x1.toFixed(2)+'</text>';
  s+='<line x1="'+PL+'" y1="'+Y(g.fan.iv_chain_iv)+'" x2="'+(PL+pw)+'" y2="'+Y(g.fan.iv_chain_iv)+'" stroke="#e8a33d" stroke-width="1" stroke-dasharray="5 4"/>';
  s+='<text x="'+(PL+pw)+'" y="'+(Y(g.fan.iv_chain_iv)-6)+'" fill="#e8a33d" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">CHAIN IV '+g.fan.iv_chain_iv.toFixed(2)+'%</text>';
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Implied volatility skew for '+meta.name+'">'+s+'</svg>';
}

function cftcSVG(series, opt){
  opt=opt||{};
  var useMean=series.some(function(r){ return r.px_mean!=null; });
  series=series.map(function(r){ var o=Object.assign({},r); if(useMean){ o.px=r.px_mean; o.px_chg=r.px_mean_chg; } return o; });
  var hasPx=series.some(function(r){ return r.px!=null; });
  var W=760,H=hasPx?310:280,PL=58,PR=hasPx?64:16,PT=38,PB=hasPx?62:42, pw=W-PL-PR, ph=H-PT-PB;
  var vals=series.map(function(r){return r.net;});
  var rawMx=Math.max.apply(null,vals.concat([0])), rawMn=Math.min.apply(null,vals.concat([0]));
  var rng=(rawMx-rawMn)||1, mx=rawMx+rng*0.16, mn=rawMn-rng*0.16;
  var slot=pw/series.length, bw=slot*0.55;
  function Y(v){ return PT+ph*(1-(v-mn)/(mx-mn)); }
  function CX(i){ return PL+slot*i+slot/2; }
  var s='';
  /* hover / tap columns + rolling-ball tracker data (net position and weekly price) */
  var pf0=opt.pfmt||function(v){ return '$'+v.toFixed(2); }, cf0=opt.cfmt||centsFmt;
  var pv0=series.filter(function(r){ return r.px!=null; }).map(function(r){ return r.px; }).concat(opt.basis&&opt.basis.avg_entry?[opt.basis.avg_entry]:[]);
  var pmx0=pv0.length?Math.max.apply(null,pv0):0, pmn0=pv0.length?Math.min.apply(null,pv0):0, pr0=(pmx0-pmn0)||pmx0*0.01||1, plo0=pmn0-pr0*0.25, phi0=pmx0+pr0*0.25;
  function PY0(v){ return PT+ph*(1-(v-plo0)/(phi0-plo0)); }
  var tid='b'+(++BTN);
  BTIPS[tid]=series.map(function(r,i){
    var p=i?series[i-1]:null, sg=function(v){ return (v>0?'+':v<0?'\u2212':'')+fmt(Math.abs(v)); };
    var h='<div class="bt-h">Week to '+esc(fmtDate(r.date))+'</div>'+
      (r.long!=null?'<div class="bt-row"><span>Long</span><b>'+fmt(r.long)+'</b>'+(p&&p.long!=null?'<small class="'+cls(r.long-p.long)+'">'+sg(r.long-p.long)+' w/w</small>':'')+'</div>'+
        '<div class="bt-row"><span>Short</span><b>'+fmt(r.short)+'</b>'+(p&&p.short!=null?'<small class="'+cls(p.short-r.short)+'">'+sg(r.short-p.short)+' w/w</small>':'')+'</div>':'')+
      '<div class="bt-row bt-strong"><span>Net position</span><b class="'+cls(r.net)+'">'+sg(r.net)+'</b>'+(p?'<small class="'+cls(r.net-p.net)+'">'+sg(r.net-p.net)+' w/w</small>':'')+'</div>'+
      (r.long!=null?'<div class="bt-math">'+fmt(r.long)+' \u2212 '+fmt(r.short)+' = <b>'+sg(r.long-r.short)+'</b> contracts</div>':'');
    if(r.px!=null){ h+='<div class="bt-sub">'+(useMean?'report-week average price':'price on report date')+'</div><div class="bt-row"><span>'+(useMean?'Week avg':'Close')+(r.px_n?' ('+r.px_n+' sessions)':'')+'</span><b>'+pf0(r.px)+'</b>'+(r.px_chg!=null?'<small class="'+cls(r.px_chg)+'">'+cf0(r.px_chg)+' w/w</small>':'')+'</div>';
      var orig=(opt.series0||[])[i]; if(useMean&&orig&&orig.px!=null&&orig.px!==r.px) h+='<div class="bt-row"><span>Close on '+esc(fmtShortDate(orig.px_date||r.date))+'</span><b>'+pf0(orig.px)+'</b></div>';
      if(p&&p.px!=null){ var dn=r.net-p.net, dp=r.px-p.px; if(opt.inverse) h+='<div class="bt-note">Funds '+(dn<0?'sold CAD':'bought CAD')+' as USD/CAD '+(dp>0?'rose':dp<0?'fell':'was flat')+' \u2014 '+((dn<0)===(dp>0)?'positioning confirms the move':'positioning diverges from the move')+'.</div>';
      else h+='<div class="bt-note">'+(dn>0?'Funds added length':'Funds cut length / added shorts')+' as price '+(dp>0?'rose':dp<0?'fell':'was flat')+' \u2014 '+((dn>0)===(dp>0)?'positioning confirms the move':'positioning diverges from the move')+'.</div>'; } }
    return h;
  });
  series.forEach(function(r,i){ s+='<g class="btip fcol" data-tid="'+tid+'" data-i="'+i+'" data-trk="'+CX(i).toFixed(1)+','+Y(r.net).toFixed(1)+','+(r.px!=null&&hasPx?PY0(r.px).toFixed(1):'')+'" tabindex="0"><rect class="colbg" x="'+(PL+slot*i).toFixed(1)+'" y="'+(PT-8)+'" width="'+slot.toFixed(1)+'" height="'+(ph+(hasPx?44:22))+'" rx="3" fill="transparent"/></g>'; });
  for(var gi=0;gi<=4;gi++){ var gy=PT+ph*gi/4, gv=mx-(mx-mn)*gi/4;
    s+='<line x1="'+PL+'" y1="'+gy+'" x2="'+(PL+pw)+'" y2="'+gy+'" stroke="#1e2a3a"/>';
    s+='<text x="'+(PL-6)+'" y="'+(gy+4)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">'+(gv>=0?'+':'\u2212')+fmt(Math.round(Math.abs(gv)/1000))+'k</text>'; }
  if(mn<0) s+='<line x1="'+PL+'" y1="'+Y(0)+'" x2="'+(PL+pw)+'" y2="'+Y(0)+'" stroke="#3d5a80" stroke-width="1.2"/>';
  /* bars */
  series.forEach(function(r,i){
    var x=CX(i)-bw/2, top=r.net>=0?Y(r.net):Y(0), h=Math.max(Math.abs(Y(r.net)-Y(0)),1);
    s+='<rect x="'+x.toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+h.toFixed(1)+'" fill="'+(r.net>=0?'#3fb97f':'#e0655f')+'"/>';
  });
  /* trend line connecting the weekly nets */
  var tp=''; series.forEach(function(r,i){ tp+=(tp?'L':'M')+CX(i).toFixed(1)+' '+Y(r.net).toFixed(1); });
  s+='<path d="'+tp+'" fill="none" stroke="#e8eef4" stroke-width="2"/>';
  series.forEach(function(r,i){ s+='<circle cx="'+CX(i).toFixed(1)+'" cy="'+Y(r.net).toFixed(1)+'" r="3" fill="#e8eef4"/>'; });
  /* every bar labeled with its net value (backing plate, clear of the trend line) */
  series.forEach(function(r,i){
    var txt=(r.net>=0?'+':'\u2212')+fmt(Math.abs(r.net));
    var ly = r.net>=0 ? Y(r.net)-17 : Y(r.net)+21;
    var twd=txt.length*5.9+8;
    s+='<rect x="'+(CX(i)-twd/2).toFixed(1)+'" y="'+(ly-10).toFixed(1)+'" width="'+twd.toFixed(1)+'" height="14" rx="3" fill="#0d141f" opacity="0.88"/>';
    s+='<text x="'+CX(i).toFixed(1)+'" y="'+ly.toFixed(1)+'" fill="'+(r.net>=0?'#5fd598':'#ff9d97')+'" font-size="9.5" font-weight="600" font-family="IBM Plex Mono" text-anchor="middle">'+txt+'</text>';
  });
  /* every bar labeled with its week date */
  var dateY=PT+ph+17;
  if(hasPx){
    /* price on each report date: own scale on the right, amber line, labeled value + week change under every bar */
    var pf=opt.pfmt||function(v){ return '$'+v.toFixed(2); }, cf=opt.cfmt||centsFmt;
    var pv=series.filter(function(r){ return r.px!=null; }).map(function(r){ return r.px; }).concat(opt.basis&&opt.basis.avg_entry?[opt.basis.avg_entry]:[]), pmx=Math.max.apply(null,pv), pmn=Math.min.apply(null,pv), pr=(pmx-pmn)||pmx*0.01;
    var plo=pmn-pr*0.25, phi=pmx+pr*0.25;
    function PY(v){ return PT+ph*(1-(v-plo)/(phi-plo)); }
    for(var pi=0;pi<=4;pi++){ var pyv=phi-(phi-plo)*pi/4; s+='<text x="'+(PL+pw+6)+'" y="'+(PT+ph*pi/4+4).toFixed(1)+'" fill="#c99a4a" font-size="10" font-family="IBM Plex Mono">'+pf(pyv)+'</text>'; }
    var pp='', st=false; series.forEach(function(r,i){ if(r.px==null){ st=false; return; } pp+=(st?'L':'M')+CX(i).toFixed(1)+' '+PY(r.px).toFixed(1); st=true; });
    s+='<path d="'+pp+'" fill="none" stroke="#e8a33d" stroke-width="2" stroke-dasharray="6 3"/>';
    if(opt.basis&&opt.basis.avg_entry){ var by=PY(opt.basis.avg_entry).toFixed(1);
      s+='<line x1="'+PL+'" x2="'+(PL+pw)+'" y1="'+by+'" y2="'+by+'" stroke="#c084fc" stroke-width="1.4" stroke-dasharray="3 3"/>';
    }
    series.forEach(function(r,i){ if(r.px==null) return; s+='<rect x="'+(CX(i)-3.5).toFixed(1)+'" y="'+(PY(r.px)-3.5).toFixed(1)+'" width="7" height="7" transform="rotate(45 '+CX(i).toFixed(1)+' '+PY(r.px).toFixed(1)+')" fill="#e8a33d"/>'; });
    series.forEach(function(r,i){ if(r.px==null) return;
      var c=r.px_chg, col=c==null?'#c9d6e6':c>0?'#5fd598':c<0?'#ff9d97':'#8494ab', arr=c==null?'':c>0?'\u25b2':c<0?'\u25bc':'\u25b8';
      s+='<text x="'+CX(i).toFixed(1)+'" y="'+(PT+ph+15)+'" fill="#e8a33d" font-size="9.5" font-weight="600" font-family="IBM Plex Mono" text-anchor="middle">'+pf(r.px)+'</text>';
      s+='<text x="'+CX(i).toFixed(1)+'" y="'+(PT+ph+27)+'" fill="'+col+'" font-size="9" font-family="IBM Plex Mono" text-anchor="middle">'+(c==null?'\u2014':arr+cf(c))+'</text>'; });
    dateY=PT+ph+41;
  }
  series.forEach(function(r,i){
    s+='<text x="'+CX(i).toFixed(1)+'" y="'+dateY+'" fill="#8494ab" font-size="9.5" font-family="IBM Plex Mono" text-anchor="middle">'+fmtShortDate(r.date)+'</text>';
  });
  s+='<text x="'+PL+'" y="'+(dateY+17)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono">'+(hasPx?'REPORT DATES \u00b7 WHITE = NET TREND':'WEEKLY REPORT DATES \u00b7 WHITE LINE = TREND ACROSS THE '+series.length+' WEEKLY NETS')+(hasPx?' \u00b7 AMBER = '+(useMean?'REPORT-WEEK AVG':'PRICE')+' (RIGHT)':'')+(hasPx&&opt.basis&&opt.basis.avg_entry?' \u00b7 PURPLE = FUNDS EST. AVG ENTRY '+(opt.pfmt||function(v){ return '$'+v.toFixed(2); })(opt.basis.avg_entry):'')+'</text>';
  s+=trkSVG(['#e8eef4','#e8a33d'], PT, PT+ph);
  return '<svg viewBox="0 0 '+W+' '+H+'" class="flowchart" role="img" aria-label="Managed money net position by week, every bar labeled with its net value and report date, with a trend line connecting the weekly nets">'+s+'</svg>';
}

function centsFmt(c){ var v=Math.round(Math.abs(c)*400)/4; return (c>0?'+':c<0?'\u2212':'')+(v%1?v.toFixed(2):v.toFixed(0))+'\u00a2'; }
var FXPX={inverse:true, pname:'USD/CAD CLOSE', pfmt:function(v){ return v.toFixed(4); }, cfmt:function(c){ return (c>0?'+':c<0?'\u2212':'')+Math.abs(c*1e4).toFixed(0)+' pips'; }};
function cftcRead(series, opt){
  var last=series[series.length-1], prev=series[series.length-2], ref4=series[series.length-5];
  var wow=last.net-prev.net, four=last.net-ref4.net;
  var vals=series.map(function(r){return r.net;});
  var mn=Math.min.apply(null,vals), mx=Math.max.apply(null,vals);
  var pctR=(mx>mn)?Math.round((last.net-mn)/(mx-mn)*100):50;
  var zone = pctR>=80 ? 'near the top of the range' : pctR<=20 ? 'near the bottom of the range' : 'mid-range';
  return 'Net exposure trend: week over week <b>'+sgn(wow,0)+'</b> \u00b7 4-week direction '+(four>0?'<b>rising</b>':four<0?'<b>falling</b>':'<b>flat</b>')+
    ' ('+sgn(four,0)+' vs '+fmtDate(ref4.date)+') \u00b7 latest net sits at <b>'+pctR+'%</b> of its 10-week range ('+sgn(mn,0)+' to '+sgn(mx,0)+') \u2014 '+zone+'.'+cftcPriceRead(series, opt);
}
function cftcPriceRead(series, opt){
  opt=opt||{};
  if(series.some(function(r){ return r.px_mean!=null; })) series=series.map(function(r){ var o=Object.assign({},r); o.px=r.px_mean; return o; });
  var last=series[series.length-1], ref=series[series.length-5];
  if(!last||!ref||last.px==null||ref.px==null) return '';
  var B=opt.basis, extra='';
  if(B&&B.avg_entry&&opt.F){ var per=opt.inverse?(1/opt.F-1/B.avg_entry)*100000*(B.net>0?1:-1):(opt.F-B.avg_entry)*(B.net>0?1:-1)*5000;
    extra=' <b>Where funds sit:</b> pricing each week\u2019s net change at that report week\u2019s average gives an estimated average entry of <b>'+(opt.pfmt||function(v){ return '$'+v.toFixed(2); })(B.avg_entry)+'</b> for the current net '+(B.net>0?'long':'short')+' ('+B.weeks+' weeks since '+esc(B.since)+'). At today\u2019s '+(opt.pfmt||function(v){ return '$'+v.toFixed(2); })(opt.F)+' that is <b class="'+cls(per)+'">'+(per>=0?'in profit':'underwater')+' ~$'+fmt(Math.abs(per),0)+'/contract (~$'+fmt(Math.abs(per*B.net)/1e6,0)+'M)</b> \u2014 '+(per<0?'pressure to cut if price keeps moving against them':'room to hold; profit-taking risk on reversals')+'.'; }
  var pf=opt.pfmt||function(v){ return '$'+v.toFixed(2); }, dp=last.px-ref.px, dn=last.net-ref.net;
  if(opt.inverse){ /* CAD futures: a falling net = funds selling CAD, which shows up as USD/CAD rising */
    var rel2=(dp>0&&dn<0)?'funds sold CAD as USD/CAD rose \u2014 positioning <b>confirms</b> the CAD weakness':(dp<0&&dn>0)?'funds bought CAD as USD/CAD fell \u2014 positioning <b>confirms</b> the CAD strength':
      (dp>0&&dn>0)?'USD/CAD rose even as funds bought CAD \u2014 a <b>divergence</b>':(dp<0&&dn<0)?'USD/CAD fell even as funds sold CAD \u2014 a <b>divergence</b> (short-squeeze risk if CAD keeps firming)':'price and positioning roughly flat';
    return ' Report-week average USD/CAD over 4 weeks: '+pf(ref.px)+' \u2192 <b>'+pf(last.px)+'</b> ('+opt.cfmt(dp)+'): '+rel2+'.'+extra; }
  var rel=(dp>0&&dn>0)?'funds added length as price rose \u2014 positioning <b>confirms</b> the up-move':(dp<0&&dn<0)?'funds cut exposure as price fell \u2014 positioning <b>confirms</b> the down-move':
    (dp>0&&dn<0)?'price rose while funds cut exposure \u2014 a <b>divergence</b> (short-covering or commercial buying)':(dp<0&&dn>0)?'price fell while funds added length \u2014 a <b>divergence</b> (funds buying the dip)':'price and positioning roughly flat';
  return ' Report-week average price over 4 weeks: '+pf(ref.px)+' \u2192 <b>'+pf(last.px)+'</b> ('+(opt.cfmt||centsFmt)(dp)+'): '+rel+'.'+extra;
}

/* ---------------- rollover (same drop-in series as the per-commodity rollover cards) ---------------- */
var ROLLS = {"corn":{"front":"ZCZ26","def":"ZCH27","dailyN":[["09-25",926030,392452,29.8,-13.75],["09-28",926746,395855,29.9,-13.5],["09-29",913756,395423,30.2,-14.0],["09-30",919540,396542,30.1,-14.75],["10-05",894052,403490,31.1,-14.25],["10-06",896602,409553,31.4,-14.25],["10-07",894150,419031,31.9,-15.0],["10-08",887521,430359,32.7,-15.0],["10-09",866535,435516,33.4,-14.5],["10-12",848216,431070,33.7,-14.25],["10-13",845756,427047,33.6,-13.75],["10-14",843697,428278,33.7,-13.5],["10-15",835215,427717,33.9,-13.0],["10-16",839199,426342,33.7,-12.25],["10-19",823888,425970,34.1,-13.5],["10-20",810759,431897,34.8,-14.0]],"dailyT":[["Sep 25","926,030","392,452","—","29.8%","—","-13.8¢","—"],["Sep 28","926,746","395,855","+4,119","29.9%","+0.2","-13.5¢","+0.3"],["Sep 29","913,756","395,423","-13,422","30.2%","+0.3","-14.0¢","-0.5"],["Sep 30","919,540","396,542","+6,903","30.1%","-0.1","-14.7¢","-0.7"],["Oct 05","894,052","403,490","-18,540","31.1%","+1.0","-14.3¢","+0.5"],["Oct 06","896,602","409,553","+8,613","31.4%","+0.3","-14.3¢","+0.0"],["Oct 07","894,150","419,031","+7,026","31.9%","+0.6","-15.0¢","-0.8"],["Oct 08","887,521","430,359","+4,699","32.7%","+0.7","-15.0¢","+0.0"],["Oct 09","866,535","435,516","-15,829","33.4%","+0.8","-14.5¢","+0.5"],["Oct 12","848,216","431,070","-22,765","33.7%","+0.2","-14.3¢","+0.2"],["Oct 13","845,756","427,047","-6,483","33.6%","-0.1","-13.8¢","+0.5"],["Oct 14","843,697","428,278","-828","33.7%","+0.1","-13.5¢","+0.3"],["Oct 15","835,215","427,717","-9,043","33.9%","+0.2","-13.0¢","+0.5"],["Oct 16","839,199","426,342","+2,609","33.7%","-0.2","-12.3¢","+0.7"],["Oct 19","823,888","425,970","-15,683","34.1%","+0.4","-13.5¢","-1.2"],["Oct 20","810,759","431,897","-7,202","34.8%","+0.7","-14.0¢","-0.5"]],"beh":[["Sep 28","+716 OI / -5.2¢ → new shorts","+3,403 OI / -5.5¢ → new shorts"],["Sep 29","-12,990 OI / -1.0¢ → long liquidation","-432 OI / -0.5¢ → steady"],["Sep 30","+5,784 OI / -21.2¢ → new shorts","+1,119 OI / -20.5¢ → new shorts"],["Oct 05","-25,488 OI / -3.5¢ → long liquidation","+6,948 OI / -4.0¢ → new shorts"],["Oct 06","+2,550 OI / +10.7¢ → new longs","+6,063 OI / +10.7¢ → new longs"],["Oct 07","-2,452 OI / -6.0¢ → long liquidation","+9,478 OI / -5.3¢ → new shorts"],["Oct 08","-6,629 OI / -1.7¢ → long liquidation","+11,328 OI / -1.8¢ → new shorts"],["Oct 09","-20,986 OI / -20.5¢ → long liquidation","+5,157 OI / -21.0¢ → new shorts"],["Oct 12","-18,319 OI / +3.2¢ → short covering","-4,446 OI / +3.0¢ → short covering"],["Oct 13","-2,460 OI / -0.3¢ → long liquidation","-4,023 OI / -0.8¢ → long liquidation"],["Oct 14","-2,059 OI / -2.0¢ → long liquidation","+1,231 OI / -2.2¢ → steady"],["Oct 15","-8,482 OI / -2.7¢ → long liquidation","-561 OI / -3.2¢ → steady"],["Oct 16","+3,984 OI / -3.8¢ → new shorts","-1,375 OI / -4.5¢ → steady"],["Oct 19","-15,311 OI / -7.2¢ → long liquidation","-372 OI / -6.0¢ → long liquidation"],["Oct 20","-13,129 OI / -5.0¢ → long liquidation","+5,927 OI / -4.5¢ → new shorts"]],"stats":{"roll":"34.8%","fnet":"-115,271","dnet":"+39,445","cnet":"-75,826","pace":"+1.4 pp/wk","thr":"not crossed","sp":"-14.0¢ contango","mm":"+246,425 (COT 2026-10-13)","fnd":"Mon Nov 30, 2026","hard":"Fri Nov 27, 2026","state":"PRE-ROLL (39 days to FND)","plan":"Monitor carry & liquidity; core roll window T-10 to T-5"}},"soybeans":{"front":"ZSX26","def":"ZSF27","dailyN":[["09-25",458563,214979,31.9,-13.5],["09-28",441623,203318,31.5,-14.75],["09-29",436210,205120,32.0,-15.0],["09-30",428759,212123,33.1,-16.25],["10-05",427316,222563,34.2,-16.75],["10-06",430283,226570,34.5,-16.25],["10-07",409691,238441,36.8,-17.0],["10-08",378062,236646,38.5,-16.75],["10-09",350258,246303,41.3,-16.75],["10-12",333261,256676,43.5,-17.0],["10-13",313504,277593,47.0,-16.25],["10-14",301636,278885,48.0,-14.75],["10-15",295219,284638,49.1,-14.75],["10-16",289307,294024,50.4,-14.5],["10-19",269046,306739,53.3,-15.25],["10-20",254438,323480,56.0,-15.25]],"dailyT":[["Sep 25","458,563","214,979","—","31.9%","—","-13.5¢","—"],["Sep 28","441,623","203,318","-28,601","31.5%","-0.4","-14.7¢","-1.2"],["Sep 29","436,210","205,120","-3,611","32.0%","+0.5","-15.0¢","-0.3"],["Sep 30","428,759","212,123","-448","33.1%","+1.1","-16.2¢","-1.2"],["Oct 05","427,316","222,563","+8,997","34.2%","+1.1","-16.8¢","-0.5"],["Oct 06","430,283","226,570","+6,974","34.5%","+0.2","-16.3¢","+0.5"],["Oct 07","409,691","238,441","-8,721","36.8%","+2.3","-17.0¢","-0.7"],["Oct 08","378,062","236,646","-33,424","38.5%","+1.7","-16.8¢","+0.2"],["Oct 09","350,258","246,303","-18,147","41.3%","+2.8","-16.8¢","+0.0"],["Oct 12","333,261","256,676","-6,624","43.5%","+2.2","-17.0¢","-0.2"],["Oct 13","313,504","277,593","+1,160","47.0%","+3.5","-16.2¢","+0.8"],["Oct 14","301,636","278,885","-10,576","48.0%","+1.1","-14.7¢","+1.5"],["Oct 15","295,219","284,638","-664","49.1%","+1.0","-14.7¢","+0.0"],["Oct 16","289,307","294,024","+3,474","50.4%","+1.3","-14.5¢","+0.2"],["Oct 19","269,046","306,739","-7,546","53.3%","+2.9","-15.2¢","-0.8"],["Oct 20","254,438","323,480","+2,133","56.0%","+2.7","-15.2¢","+0.0"]],"beh":[["Sep 28","-16,940 OI / -30.7¢ → long liquidation","-11,661 OI / -29.5¢ → long liquidation"],["Sep 29","-5,413 OI / +9.5¢ → short covering","+1,802 OI / +9.8¢ → new longs"],["Sep 30","-7,451 OI / -4.7¢ → long liquidation","+7,003 OI / -3.5¢ → new shorts"],["Oct 05","-1,443 OI / -12.3¢ → long liquidation","+10,440 OI / -11.7¢ → new shorts"],["Oct 06","+2,967 OI / +22.3¢ → new longs","+4,007 OI / +21.8¢ → new longs"],["Oct 07","-20,592 OI / -5.5¢ → long liquidation","+11,871 OI / -4.8¢ → new shorts"],["Oct 08","-31,629 OI / -10.0¢ → long liquidation","-1,795 OI / -10.2¢ → long liquidation"],["Oct 09","-27,804 OI / +4.5¢ → short covering","+9,657 OI / +4.5¢ → new longs"],["Oct 12","-16,997 OI / -4.3¢ → long liquidation","+10,373 OI / -4.0¢ → new shorts"],["Oct 13","-19,757 OI / -4.0¢ → long liquidation","+20,917 OI / -4.7¢ → new shorts"],["Oct 14","-11,868 OI / -6.5¢ → long liquidation","+1,292 OI / -8.0¢ → new shorts"],["Oct 15","-6,417 OI / -14.3¢ → long liquidation","+5,753 OI / -14.3¢ → new shorts"],["Oct 16","-5,912 OI / -1.8¢ → long liquidation","+9,386 OI / -2.0¢ → new shorts"],["Oct 19","-20,261 OI / -7.8¢ → long liquidation","+12,715 OI / -7.0¢ → new shorts"],["Oct 20","-14,608 OI / -5.3¢ → long liquidation","+16,741 OI / -5.3¢ → new shorts"]],"stats":{"roll":"56.0%","fnet":"-204,125","dnet":"+108,501","cnet":"-95,624","pace":"+6.7 pp/wk","thr":"crossed","sp":"-15.2¢ contango","mm":"+249,807 (COT 2026-10-13)","fnd":"Fri Oct 30, 2026","hard":"Thu Oct 29, 2026","state":"ROLL WINDOW OPEN (8 days to FND)","plan":"Execute core roll now; zero longs by FND-1"}},"wheat":{"front":"ZWZ26","def":"ZWH27","dailyN":[["09-25",255623,106916,29.5,-15.0],["09-28",253338,107818,29.9,-14.75],["09-29",252789,107707,29.9,-14.25],["09-30",258584,113583,30.5,-15.0],["10-05",251979,112087,30.8,-14.0],["10-06",254587,114566,31.0,-13.25],["10-07",254554,115676,31.2,-14.5],["10-08",251400,117122,31.8,-14.5],["10-09",252568,120762,32.3,-14.25],["10-12",251302,122686,32.8,-13.75],["10-13",249549,123281,33.1,-14.0],["10-14",252366,125669,33.2,-13.25],["10-16",246446,133371,35.1,-14.5],["10-19",244814,133969,35.4,-14.75],["10-20",246598,132481,34.9,-15.25]],"dailyT":[["Sep 25","255,623","106,916","—","29.5%","—","-15.0¢","—"],["Sep 28","253,338","107,818","-1,383","29.9%","+0.4","-14.7¢","+0.3"],["Sep 29","252,789","107,707","-660","29.9%","+0.0","-14.3¢","+0.5"],["Sep 30","258,584","113,583","+11,671","30.5%","+0.6","-15.0¢","-0.7"],["Oct 05","251,979","112,087","-8,101","30.8%","+0.3","-14.0¢","+1.0"],["Oct 06","254,587","114,566","+5,087","31.0%","+0.2","-13.2¢","+0.8"],["Oct 07","254,554","115,676","+1,077","31.2%","+0.2","-14.5¢","-1.3"],["Oct 08","251,400","117,122","-1,708","31.8%","+0.5","-14.5¢","-0.0"],["Oct 09","252,568","120,762","+4,808","32.3%","+0.6","-14.3¢","+0.3"],["Oct 12","251,302","122,686","+658","32.8%","+0.5","-13.8¢","+0.5"],["Oct 13","249,549","123,281","-1,158","33.1%","+0.3","-14.0¢","-0.2"],["Oct 14","252,366","125,669","+5,205","33.2%","+0.2","-13.3¢","+0.7"],["Oct 16","246,446","133,371","+1,782","35.1%","+1.9","-14.5¢","-1.2"],["Oct 19","244,814","133,969","-1,034","35.4%","+0.3","-14.7¢","-0.3"],["Oct 20","246,598","132,481","+296","34.9%","-0.4","-15.2¢","-0.5"]],"beh":[["Sep 28","-2,285 OI / -14.5¢ → long liquidation","+902 OI / -14.7¢ → new shorts"],["Sep 29","-549 OI / +4.0¢ → steady","-111 OI / +3.5¢ → steady"],["Sep 30","+5,795 OI / -17.0¢ → new shorts","+5,876 OI / -16.3¢ → new shorts"],["Oct 05","-6,605 OI / +16.5¢ → short covering","-1,496 OI / +15.5¢ → short covering"],["Oct 06","+2,608 OI / +12.0¢ → new longs","+2,479 OI / +11.2¢ → new longs"],["Oct 07","-33 OI / -17.8¢ → long liquidation","+1,110 OI / -16.5¢ → new shorts"],["Oct 08","-3,154 OI / -3.3¢ → long liquidation","+1,446 OI / -3.2¢ → steady"],["Oct 09","+1,168 OI / -12.2¢ → new shorts","+3,640 OI / -12.5¢ → new shorts"],["Oct 12","-1,266 OI / +1.3¢ → steady","+1,924 OI / +0.8¢ → steady"],["Oct 13","-1,753 OI / -3.0¢ → steady","+595 OI / -2.8¢ → steady"],["Oct 14","+2,817 OI / +4.0¢ → new longs","+2,388 OI / +3.3¢ → new longs"],["Oct 16","-5,920 OI / -12.7¢ → long liquidation","+7,702 OI / -11.5¢ → new shorts"],["Oct 19","-1,632 OI / -5.3¢ → long liquidation","+598 OI / -5.0¢ → steady"],["Oct 20","+1,784 OI / -12.0¢ → new shorts","-1,488 OI / -11.5¢ → long liquidation"]],"stats":{"roll":"34.9%","fnet":"-9,025","dnet":"+25,565","cnet":"+16,540","pace":"+1.5 pp/wk","thr":"not crossed","sp":"-15.2¢ contango","mm":"-32,555 (COT 2026-10-13)","fnd":"Mon Nov 30, 2026","hard":"Fri Nov 27, 2026","state":"PRE-ROLL (39 days to FND)","plan":"Monitor carry & liquidity; core roll window T-10 to T-5"}}};

function rollSVG2(R){
  var rows=R.dailyN, n=rows.length;
  var W=760,H=300,PL=48,PR=48,PT=30,PB=28, pw=W-PL-PR, ph=H-PT-PB;
  var maxOI=0, spMin=0, i, r;
  rows.forEach(function(r){ maxOI=Math.max(maxOI,r[1]+r[2]); spMin=Math.min(spMin,r[4]); });
  var yMax=maxOI*1.30, spLo=spMin*1.18;
  var gw=pw/n, bw=Math.max(3,Math.min(15,gw*0.36));
  function Y(v){ return PT+ph*(1-v/yMax); }
  function YS(v){ return PT+ph*(1-(v-spLo)/(0-spLo)); }
  function X(i){ return PL+gw*i+gw/2; }
  var s='';
  /* hover / tap columns: one per session, with the full day's numbers */
  var tid='b'+(++BTN), beh={}; (R.beh||[]).forEach(function(b){ beh[String(b[0]).replace(/[^\w ]/g,'').trim()]=b; });
  BTIPS[tid]=rows.map(function(r,i){
    var p=i?rows[i-1]:null, lab=MON3[r[0].slice(0,2)]+' '+r[0].slice(3), src=(R.src||{})[r[0]]||'', tot=r[1]+r[2];
    function d(v,suf,dec){ return v==null?'':'<small class="'+cls(v)+'">'+(v>0?'+':v<0?'\u2212':'')+fmt(Math.abs(v),dec||0)+(suf||'')+' vs prior day</small>'; }
    var h='<div class="bt-h">'+lab+(/^P/.test(src)?' <span class="chip inline">PRELIM</span>':'')+'</div>'+
      '<div class="bt-row"><span>Front OI ('+esc(R.front)+')</span><b>'+fmt(r[1])+'</b>'+(p?d(r[1]-p[1]):'')+'</div>'+
      '<div class="bt-row"><span>Deferred OI ('+esc(R.def)+')</span><b>'+fmt(r[2])+'</b>'+(p?d(r[2]-p[2]):'')+'</div>'+
      '<div class="bt-row bt-strong"><span>Combined OI</span><b>'+fmt(tot)+'</b>'+(p?d(tot-p[1]-p[2]):'')+'</div>'+
      '<div class="bt-row"><span>Roll progress</span><b>'+r[3].toFixed(1)+'%</b>'+(p?d(r[3]-p[3],' pp',1):'')+'</div>'+
      '<div class="bt-math">'+fmt(r[2])+' \u00f7 ('+fmt(r[1])+' + '+fmt(r[2])+') = <b>'+(r[2]/tot*100).toFixed(1)+'%</b></div>'+
      '<div class="bt-row"><span>Calendar spread</span><b>'+(r[4]<0?'\u2212':'')+Math.abs(r[4]).toFixed(2)+'\u00a2</b>'+(p?d(r[4]-p[4],'\u00a2',2):'')+'</div>'+
      (r[5]!=null&&r[6]!=null?'<div class="bt-math">'+r[5].toFixed(4)+' \u2212 '+r[6].toFixed(4)+' = <b>'+((r[5]-r[6])<0?'\u2212':'')+Math.abs((r[5]-r[6])*100).toFixed(2)+'\u00a2</b> '+(r[4]<0?'(contango)':'(backwardation)')+'</div>':'');
    var b=beh[lab];
    if(b) h+='<div class="bt-sub">what traders did</div><div class="bt-note" style="margin-top:0;border:0;padding-top:0"><b>'+esc(R.front)+':</b> '+esc(b[1])+'<br><b>'+esc(R.def)+':</b> '+esc(b[2])+'</div>';
    return h;
  });
  rows.forEach(function(r,i){ s+='<g class="btip fcol" data-tid="'+tid+'" data-i="'+i+'" data-trk="'+X(i).toFixed(1)+','+YS(r[4]).toFixed(1)+','+Y(r[1]).toFixed(1)+','+Y(r[2]).toFixed(1)+'" tabindex="0"><rect class="colbg" x="'+(PL+gw*i).toFixed(1)+'" y="'+(PT-6)+'" width="'+gw.toFixed(1)+'" height="'+(ph+30)+'" rx="3" fill="transparent"/></g>'; });
  for(i=0;i<=4;i++){ var gy=PT+ph*i/4, gv=yMax*(1-i/4), gs=spLo*(i/4);
    s+='<line x1="'+PL+'" y1="'+gy+'" x2="'+(PL+pw)+'" y2="'+gy+'" stroke="#1e2a3a"/>';
    s+='<text x="'+(PL-6)+'" y="'+(gy+4)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">'+Math.round(gv/1000)+'k</text>';
    s+='<text x="'+(PL+pw+6)+'" y="'+(gy+4)+'" fill="#a8894a" font-size="10.5" font-family="IBM Plex Mono">'+gs.toFixed(0)+'¢</text>'; }
  rows.forEach(function(r,i){
    var cx=X(i);
    s+='<rect x="'+(cx-bw-1).toFixed(1)+'" y="'+Y(r[1]).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+(PT+ph-Y(r[1])).toFixed(1)+'" fill="#2f6db3" pointer-events="none"/>';
    s+='<rect x="'+(cx+1).toFixed(1)+'" y="'+Y(r[2]).toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+(PT+ph-Y(r[2])).toFixed(1)+'" fill="#2b8f61" pointer-events="none"/>';
  });
  s+='<line x1="'+PL+'" y1="'+YS(0)+'" x2="'+(PL+pw)+'" y2="'+YS(0)+'" stroke="#28374e"/>';
  var lp=''; rows.forEach(function(r,i){ lp+=(lp?'L':'M')+X(i).toFixed(1)+' '+YS(r[4]).toFixed(1); });
  s+='<path d="'+lp+'" fill="none" stroke="#f5c542" stroke-width="1.8" pointer-events="none"/>';
  rows.forEach(function(r,i){ s+='<circle cx="'+X(i).toFixed(1)+'" cy="'+YS(r[4]).toFixed(1)+'" r="2.6" fill="#f5c542" pointer-events="none"/>'; });
  /* spread line labeled with its first and latest values, on the line */
  s+='<text x="'+X(0).toFixed(1)+'" y="'+(YS(rows[0][4])-8).toFixed(1)+'" fill="#f5c542" font-size="10" font-weight="600" font-family="IBM Plex Mono" text-anchor="middle">'+rows[0][4].toFixed(1)+'¢</text>';
  s+='<text x="'+X(n-1).toFixed(1)+'" y="'+(YS(rows[n-1][4])-8).toFixed(1)+'" fill="#f5c542" font-size="10" font-weight="600" font-family="IBM Plex Mono" text-anchor="middle">'+rows[n-1][4].toFixed(1)+'¢</text>';
  /* roll % labels run vertically above each bar — neighbours never collide */
  rows.forEach(function(r,i){
    var top=Math.max(r[1],r[2]), ty=Y(top)-4, cx=X(i);
    s+='<text x="'+cx.toFixed(1)+'" y="'+ty.toFixed(1)+'" transform="rotate(-90 '+cx.toFixed(1)+' '+ty.toFixed(1)+')" fill="#f5c542" font-size="9.5" font-weight="600" font-family="IBM Plex Mono" text-anchor="start">'+r[3].toFixed(1)+'%</text>';
  });
  var MN=MON3;
  rows.forEach(function(r,i){
    if(i%3!==0 && i!==n-1) return;
    s+='<text x="'+X(i).toFixed(1)+'" y="'+(PT+ph+18)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono" text-anchor="middle">'+MN[r[0].slice(0,2)]+' '+r[0].slice(3)+'</text>';
  });
  s+=trkSVG(['#f5c542','#4f8fe0','#3fbf7f'], PT, PT+ph);
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Open interest migration front versus deferred with calendar spread, roll percent labels vertical, spread line labeled first and latest">'+s+'</svg>';
}

/* Rollover: embedded base series + daily rows from data.json (DATA.rolls_add[key] = [[MM-DD, frontOI, defOI, frontSettle, defSettle, source]]).
   Table, behaviour rows and statistics are recomputed from the merged series so the card never goes stale. */
var MON3={'01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun','07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec'};
function rollData(key){
  var B=(DATA.rolls_base&&DATA.rolls_base[key])||ROLLS[key], R=JSON.parse(JSON.stringify(B)), add=(DATA.rolls_add&&DATA.rolls_add[key])||[], g=DATA.grains[key];
  var hist={}; (g.history||[]).forEach(function(h){ hist[h.d.slice(5,10)]=h.s; });
  var have={}; R.dailyN.forEach(function(x){ have[x[0]]=1; });
  function n0(v){ return (v>0?'+':v<0?'-':'')+fmt(Math.abs(v)); }
  function beh(dOI, dP){ var t=dOI>0&&dP>0?'new longs':dOI>0&&dP<0?'new shorts':dOI<0&&dP>0?'short covering':dOI<0&&dP<0?'long liquidation':'steady';
    return n0(dOI)+' OI / '+(dP>0?'+':dP<0?'-':'')+Math.abs(dP).toFixed(1)+'¢ → '+t; }
  R.src={}; R.oldPrelim=[]; var lastAdd=add.length?add[add.length-1][0]:'';
  add.forEach(function(a){
    if(have[a[0]]) return;
    var prev=R.dailyN[R.dailyN.length-1], fOI=a[1], dOI=a[2], roll=+(dOI/(fOI+dOI)*100).toFixed(1), sp=+((a[3]-a[4])*100).toFixed(2);
    var pfS=prev[5]!=null?prev[5]:hist[prev[0]], pdS=prev[6]!=null?prev[6]:(pfS!=null?pfS-prev[4]/100:null);
    var row=[a[0],fOI,dOI,roll,sp,a[3],a[4]]; R.dailyN.push(row); have[a[0]]=1; R.src[a[0]]=a[5]||'';
    /* only the newest session can still be waiting for its final OI; an older row sourced from a preliminary bulletin is flagged ᵖ and footnoted */
    var isP=/^P/.test(a[5]||''), lab=MON3[a[0].slice(0,2)]+' '+a[0].slice(3)+(isP?(a[0]===lastAdd?' (prelim)':' ᵖ'):'');
    if(isP&&a[0]!==lastAdd) R.oldPrelim.push(MON3[a[0].slice(0,2)]+' '+a[0].slice(3)+' ('+String(a[5]).replace(/^P-/,'')+')');
    R.dailyT.push([lab, fmt(fOI), fmt(dOI), n0((fOI+dOI)-(prev[1]+prev[2])), roll.toFixed(1)+'%', ((roll-prev[3])>=0?'+':'')+(roll-prev[3]).toFixed(1), sp.toFixed(1)+'¢', ((sp-prev[4])>=0?'+':'')+(sp-prev[4]).toFixed(1)]);
    if(pfS!=null) R.beh.push([MON3[a[0].slice(0,2)]+' '+a[0].slice(3)+(isP?'ᵖ':''), beh(fOI-prev[1], (a[3]-pfS)*100), beh(dOI-prev[2], (a[4]-pdS)*100)]);
  });
  var N=R.dailyN, F=N[0], L=N[N.length-1], k5=N[Math.max(0,N.length-6)], st=R.stats;
  st.roll=L[3].toFixed(1)+'%'; st.fnet=n0(L[1]-F[1]); st.dnet=n0(L[2]-F[2]); st.cnet=n0((L[1]+L[2])-(F[1]+F[2]));
  st.pace=((L[3]-k5[3])>=0?'+':'')+(L[3]-k5[3]).toFixed(1)+' pp / last 5 sessions'; st.thr=L[3]>=40?'crossed':'not crossed';
  st.sp=L[4].toFixed(1)+'¢ '+(L[4]<0?'contango':'backwardation');
  var c=g.cftc[g.cftc.length-1]; st.mm=n0(c.net)+' (COT '+c.date+')';
  var fd=new Date(st.fnd.replace(/^[A-Za-z]+ /,'')+' 12:00'), days=Math.ceil((fd-Date.now())/86400000);
  if(!isNaN(days)){ st.state=days<=0?'IN DELIVERY (FND passed)':days<=10?'ROLL WINDOW OPEN ('+days+' days to FND)':'PRE-ROLL ('+days+' days to FND)';
    st.plan=days<=0?'Front month in delivery — positions should be out':days<=10?'Execute core roll now; zero longs by FND-1':'Monitor carry & liquidity; core roll window T-10 to T-5'; }
  R.lastLabel=MON3[L[0].slice(0,2)]+' '+L[0].slice(3)+(R.src[L[0]]&&/^P/.test(R.src[L[0]])?' (prelim)':'');
  return R;
}
function rollBadges(R){
  var st=R.stats, m=/\((\d+) days? to FND\)/.exec(st.state);
  var fnd=st.fnd.replace(/^[A-Za-z]+ /,''), hard=st.hard.replace(/^[A-Za-z]+ /,'');
  return '<div class="badges"><span class="badge">FND '+fnd+(m?' · '+m[1]+' days':'')+'</span>'+
    '<span class="badge">Hard exit '+hard+' (FND−1)</span>'+
    '<span class="badge dim">Chart axis shows the data window only — not stretched to FND</span><span class="badge dim">Hover or tap a day for its numbers · click to highlight</span></div>';
}

function rollSpreadLine(R){
  var rows=R.dailyN, MN=MON3;
  function dl(r){ return MN[r[0].slice(0,2)]+' '+r[0].slice(3); }
  var a=rows[0], b=rows[rows.length-1];
  return '<p class="spreadline">Spread '+R.front+' − '+R.def+': first '+a[4].toFixed(1)+'¢ ('+dl(a)+') → latest '+b[4].toFixed(1)+'¢ ('+dl(b)+') · roll % labels run vertically above each bar so neighbours never collide</p>';
}

/* ================= POSITION FLOW SIGNAL =================
   Reads the daily futures open-interest rows (front + next month) with price to classify each session:
   price↑ OI↑ new longs · price↓ OI↑ new shorts · price↑ OI↓ short covering · price↓ OI↓ long liquidation.
   Roll-proof: uses COMBINED front+next OI so a position moving from one month to the next cancels out; price is
   taken from ONE reference contract for the whole window (the default front contract), so the
   series never jumps by the calendar spread. In the delivery window, falling combined OI is partly delivery
   avoidance / rolls to a third month, so those sessions count at half strength. */
var FLOWN={}; try{ FLOWN=JSON.parse(localStorage.getItem('desk.flown')||'{}')||{}; }catch(e){}
var FLOWQ={NL:{l:'New longs',w:1,c:'#3fb97f',read:'fresh buying'},SC:{l:'Short covering',w:0.5,c:'#9be3bd',read:'shorts buying back'},
  NS:{l:'New shorts',w:-1,c:'#e0655f',read:'fresh selling'},LL:{l:'Long liquidation',w:-0.5,c:'#f0a35e',read:'longs exiting'},FL:{l:'Flat',w:0,c:'#6b7a90',read:'no change'}};
function flowSessions(key){
  var R=rollData(key), N=R.dailyN, g=DATA.grains[key], hist={}; (g.history||[]).forEach(function(h){ hist[h.d.slice(5,10)]=h.s; });
  var useDef=false, dF=daysToFnd(key);   /* BR-CR-1: the reference is the default contract, with no OI threshold */
  function px(r){ var f=r[5]!=null?r[5]:hist[r[0]]; if(f==null) return null; return useDef?(r[6]!=null?r[6]:f-r[4]/100):f; }
  var out=[], FV=(DATA.flow_vol&&DATA.flow_vol[key])||{}, vf=FV[R.front]||{}, vd=FV[R.def]||{};
  for(var i=1;i<N.length;i++){ var a=N[i-1], b=N[i], pa=px(a), pb=px(b); if(pa==null||pb==null) continue;
    var dOI=(b[1]+b[2])-(a[1]+a[2]), dP=(pb-pa)*100, q=Math.abs(dP)<0.25?'FL':dP>0?(dOI>0?'NL':'SC'):(dOI>0?'NS':'LL');
    out.push({d:b[0], lab:MON3[b[0].slice(0,2)]+' '+b[0].slice(3), P:pb, dP:dP, dOI:dOI, dF:b[1]-a[1], dD:b[2]-a[2], q:q, prelim:/^P/.test(R.src[b[0]]||''), vol:(vf[b[0]]!=null||vd[b[0]]!=null)?(vf[b[0]]||0)+(vd[b[0]]||0):null}); }
  /* relative volume: session volume ÷ median of up to 20 prior sessions (needs at least 5) */
  out.forEach(function(x,i){ if(x.vol==null) return; var prev=out.slice(Math.max(0,i-20),i).filter(function(y){ return y.vol!=null; }).map(function(y){ return y.vol; });
    if(prev.length>=5) x.rv=x.vol/pfMedian(prev); });
  /* delivery window: the last 10 sessions before first notice — falling OI there is partly delivery avoidance */
  if(dF!=null){ var lastIdx=out.length-1; out.forEach(function(x,i){ x.dw=(dF+(lastIdx-i))<=14 && x.dOI<0; }); }
  return {ses:out, ref:useDef?R.def:R.front, front:R.front, def:R.def, R:R};
}
function pfMedian(a){ var b=a.slice().sort(function(x,y){ return x-y; }), n=b.length; return n?(n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2):0; }
function flowStats(key, n){
  var F=flowSessions(key), all=F.ses, w=all.slice(-n); if(w.length<3) return null;
  var mo=pfMedian(all.map(function(x){ return Math.abs(x.dOI); }))||1, mp=pfMedian(all.map(function(x){ return Math.abs(x.dP); }))||1;
  var num=0, den=0, mix={NL:0,SC:0,NS:0,LL:0,FL:0};
  w.forEach(function(x,i){ var k=Math.sqrt(Math.min(3,Math.abs(x.dOI)/mo)*Math.min(3,Math.abs(x.dP)/mp))*(x.dw?0.5:1)*(x.rv?Math.sqrt(Math.max(0.6,Math.min(1.6,x.rv))):1), r=0.5+0.5*(i+1)/w.length;
    x.k=k; num+=FLOWQ[x.q].w*k*r; den+=k*r; mix[x.q]+=k*r; });
  var score=den?Math.round(100*num/den):0, tot=den||1; Object.keys(mix).forEach(function(q){ mix[q]=mix[q]/tot*100; });
  function avg(q){ var L=w.filter(function(x){ return x.q===q; }), s=0, sp=0; L.forEach(function(x){ s+=Math.abs(x.dOI); sp+=Math.abs(x.dOI)*x.P; }); return L.length?{n:L.length, oi:s, px:sp/s}:null; }
  var last=w[w.length-1], streak=1; for(var i=w.length-2;i>=0&&w[i].q===last.q;i--) streak++;
  var sameSign=1; for(var j=w.length-2;j>=0&&Math.sign(FLOWQ[w[j].q].w)===Math.sign(FLOWQ[last.q].w)&&FLOWQ[last.q].w!==0;j--) sameSign++;
  var P0=w[0].P-w[0].dP/100, dOIsum=w.reduce(function(a,x){ return a+x.dOI; },0);
  return {key:key, n:w.length, w:w, all:all, ref:F.ref, front:F.front, def:F.def, score:score, mix:mix, ns:avg('NS'), nl:avg('NL'), last:last, streak:streak, sameSign:sameSign,
    P:last.P, chg:(last.P-P0)*100, dOI:dOIsum, dw:w.some(function(x){ return x.dw; }),
    vconf:(function(){ var b=w.filter(function(x){ return (x.q==='NL'||x.q==='NS')&&x.rv; }); if(!b.length) return null; var hi=b.filter(function(x){ return x.rv>=1; }); return {n:b.length, hi:hi.length}; })(),
    climax:w.slice(-3).filter(function(x){ return x.rv&&x.rv>=1.8; })[0]||null, hasVol:w.some(function(x){ return x.rv; })};
}
/* WHO is behind the flow: CFTC weekly (managed money = trend-following funds, producer/merchant = commercial hedgers),
   fund crowding (3-year percentile) and the harvest-hedging season */
function flowWho(key, S){
  var g=DATA.grains[key], K=g.cftc_stats&&g.cftc_stats.kpi; if(!K) return null;
  var m=+new Date().toLocaleDateString('en-CA',{timeZone:'America/Toronto'}).slice(5,7), harvest=key==='wheat'?(m>=6&&m<=8):(m>=9&&m<=11);
  var mm=K.d1, cm=K.comm_d1, pct=K.cot3, out=[];
  if(mm!=null&&cm!=null){
    if(mm<0&&cm>0) out.push('Funds (managed money) <b>sold '+fmt(-mm)+'</b> net in the week to '+esc(fmtShortDate(K.date))+' while commercial hedgers <b>bought back '+fmt(cm)+'</b> — the selling is speculative and commercials are taking the other side, which tends to cushion declines.');
    else if(mm>0&&cm<0) out.push('Funds <b>bought '+fmt(mm)+'</b> net in the week to '+esc(fmtShortDate(K.date))+' while commercials <b>sold '+fmt(-cm)+'</b> into it — a fund-led move with hedgers selling the rally.');
    else if(mm<0&&cm<0) out.push('Both funds ('+sgn(mm,0)+') and commercials ('+sgn(cm,0)+') added to the sell side in the week to '+esc(fmtShortDate(K.date))+' — broad selling'+(harvest?', including harvest hedging':'')+'.');
    else out.push('Both funds ('+sgn(mm,0)+') and commercials ('+sgn(cm,0)+') bought in the week to '+esc(fmtShortDate(K.date))+'.');
  }
  if(harvest&&S.mix.NS>=25&&cm!=null&&cm<0) out.push('<span class="neu">Harvest season: part of the new shorts is likely farmer/elevator hedging (commercials sold), which is price-insensitive and not a bearish bet in itself.</span>');
  if(pct!=null){ if(pct>=85) out.push('Funds are <b>crowded long</b> ('+ordn(pct)+' percentile of 3 years) — further long liquidation is the main downside risk.');
    else if(pct<=15) out.push('Funds are <b>crowded short</b> ('+ordn(pct)+' percentile of 3 years) — the market is vulnerable to short covering.');
    else out.push('Fund positioning is mid-range ('+ordn(pct)+' percentile of 3 years) — not crowded either way.'); }
  return {lines:out, mm:mm, cm:cm, pct:pct, date:K.date, harvest:harvest};
}
function flowChecks(key, S, W, multi){
  var dir=Math.sign(S.score), c=[];
  var agree=multi.length>1&&multi.every(function(m){ return Math.sign(m[1])===dir&&Math.abs(m[1])>=15; });
  c.push(['Windows agree', agree?1:multi.filter(function(m){ return Math.sign(m[1])===dir; }).length>=multi.length-1?0.5:0, multi.map(function(m){ return m[0]+'d '+(m[1]>0?'+':'')+m[1]; }).join(' · ')]);
  if(S.vconf) c.push(['Volume confirms new positions', S.vconf.hi/S.vconf.n>=0.6?1:S.vconf.hi/S.vconf.n>=0.4?0.5:0, S.vconf.hi+' of '+S.vconf.n+' position-building sessions on above-average volume']);
  else c.push(['Volume confirms new positions', null, S.hasVol?'no position-building sessions in window':'volume history building']);
  if(W&&W.mm!=null) c.push(['Funds (CFTC) agree', Math.sign(W.mm)===dir?1:0, 'managed money '+sgn(W.mm,0)+' w/w to '+fmtShortDate(W.date)]);
  if(W&&W.pct!=null){ var crowdedWith=(dir<0&&W.pct<=15)||(dir>0&&W.pct>=85); c.push(['Not crowded in the signal’s direction', crowdedWith?0:1, 'funds at '+ordn(W.pct)+' percentile (3y)']); }
  var got=c.filter(function(x){ return x[1]!=null; }), sc=got.reduce(function(a,x){ return a+x[1]; },0), mx=got.length;
  var conf=Math.abs(S.score)<15?'Low':sc>=mx-0.5?(Math.abs(S.score)>=35?'High':'Medium'):sc>=mx/2?'Medium':'Low';
  return {list:c, conf:conf, sc:sc, mx:mx};
}
function ordn(n){ n=Math.round(n); var t=n%100, u=n%10; return n+(t>=11&&t<=13?'th':u===1?'st':u===2?'nd':u===3?'rd':'th'); }
function flowBias(sc){ return sc>=35?['BULLISH','up']:sc>=15?['LEANING BULLISH','up']:sc<=-35?['BEARISH','dn']:sc<=-15?['LEANING BEARISH','dn']:['NEUTRAL','neu']; }
function pflowRead(key, S){
  var g=DATA.grains[key], P=S.P, out=[], B=flowBias(S.score), dom=Object.keys(S.mix).filter(function(q){ return q!=='FL'; }).sort(function(a,b){ return S.mix[b]-S.mix[a]; })[0];
  var iv=(g.vol&&g.vol.near&&g.vol.near.iv)||g.near.iv||20, s5=P*iv/100*Math.sqrt(5/252);
  var near=g.near, cw=near.call_wall&&near.call_wall[0], pw=near.put_wall&&near.put_wall[0];
  var desc={NS:'Fresh shorts are driving it — new money is selling, not just longs leaving. That gives the move conviction.',
    LL:'Mostly longs exiting rather than new shorts. Bearish, but the selling runs out once the liquidation is done — watch for open interest to stop falling.',
    NL:'Fresh longs are driving it — new money is buying. That gives the move conviction.',
    SC:'Mostly shorts buying back rather than new longs. Bullish, but fragile — rallies built on covering fade unless open interest starts rising.'}[dom];
  out.push('<b>'+FLOWQ[dom].l+'</b> is the biggest force over '+S.n+' sessions ('+fmt(S.mix[dom],0)+'% of the weighted flow). '+desc);
  if(S.sameSign>=3) out.push('<b>'+S.sameSign+' sessions in a row</b> '+(FLOWQ[S.last.q].w<0?'on the sell side':'on the buy side')+' (latest: '+FLOWQ[S.last.q].l.toLowerCase()+')'+
    (S.streak>=3?' — '+S.streak+' straight sessions of '+FLOWQ[S.last.q].l.toLowerCase():'')+'.');
  if(S.ns){ var pl=(S.ns.px-P)*100;
    out.push('New shorts ('+fmt(S.ns.oi)+' contracts on '+S.ns.n+' day'+(S.ns.n>1?'s':'')+') sold at an average <b>'+fmt(S.ns.px,4)+'</b> — they are '+(pl>=0?'<span class="up">'+fmt(pl,1)+'¢ in profit</span>, so no pressure on them to cover':'<span class="dn">'+fmt(-pl,1)+'¢ under water</span> — a push higher could force covering (squeeze risk)')+'. That level is <b>resistance</b>: a close above it puts those shorts under pressure.'); }
  if(S.nl){ var pl2=(P-S.nl.px)*100;
    out.push('New longs ('+fmt(S.nl.oi)+' contracts on '+S.nl.n+' day'+(S.nl.n>1?'s':'')+') bought at an average <b>'+fmt(S.nl.px,4)+'</b> — '+(pl2>=0?'<span class="up">'+fmt(pl2,1)+'¢ in profit</span>; that level is <b>support</b>':'<span class="dn">'+fmt(-pl2,1)+'¢ under water</span> — if price stays below, their exits add to selling')+'.'); }
  if(S.chg<0&&S.dOI>0) out.push('Price down '+fmt(-S.chg,1)+'¢ while open interest rose '+fmt(S.dOI)+' — positions are being added into the decline: a trending market.');
  else if(S.chg<0&&S.dOI<0) out.push('Price down '+fmt(-S.chg,1)+'¢ with open interest falling '+fmt(-S.dOI)+' — the decline is fuelled by exits, which usually loses steam.');
  else if(S.chg>0&&S.dOI>0) out.push('Price up '+fmt(S.chg,1)+'¢ with open interest rising '+fmt(S.dOI)+' — new money behind the rally.');
  else if(S.chg>0&&S.dOI<0) out.push('Price up '+fmt(S.chg,1)+'¢ while open interest fell '+fmt(-S.dOI)+' — a covering rally, not new buying.');
  var lw=S.w.slice(-3), early=S.w.slice(0,-3), avgK=function(L){ return L.length?L.reduce(function(a,x){ return a+x.k; },0)/L.length:0; };
  if(early.length&&avgK(lw)<0.6*avgK(early)&&S.sameSign>=3) out.push('The last 3 sessions are <b>weaker</b> than the window average — the move may be tiring.');
  if(early.length&&avgK(lw)>1.4*avgK(early)) out.push('The last 3 sessions are <b>stronger</b> than the window average — the flow is accelerating.');
  var l2=S.w.slice(-2), avgAbs=S.w.reduce(function(a,x){ return a+Math.abs(x.dOI); },0)/S.w.length;
  if(dom==='LL'&&l2.length===2&&l2.every(function(x){ return Math.abs(x.dOI)<0.35*avgAbs; })) out.push('Open interest has <b>stopped falling</b> in the last 2 sessions — classic sign the liquidation is ending and a base can form.');
  if(S.chg>0&&S.w.slice(-3).reduce(function(a,x){ return a+x.dOI; },0)<=0&&S.w.length>=6) out.push('Price is up but open interest has <b>flattened or fallen</b> over the last 3 sessions — a warning that the rally is losing new buyers.');
  if(S.climax) out.push('<b>Volume spike</b> on '+S.climax.lab+' ('+fmt(S.climax.rv,1)+'× normal) during '+FLOWQ[S.climax.q].l.toLowerCase()+' — volume usually peaks at turning points; watch the next sessions for a reversal.');
  if(S.dw) out.push('<span class="neu">Delivery window: falling open interest near first notice is partly longs avoiding delivery or rolling past '+esc(S.def)+' — counted at half strength.</span>');
  if(pw&&P<pw) out.push('Price ('+fmt(P,4)+') is <b>below the put wall '+fmt(pw,2)+'</b> — the strike with the most put open interest has given way as support; dealer hedging can add to selling until price recovers it.');
  if(cw&&P>cw) out.push('Price ('+fmt(P,4)+') is <b>above the call wall '+fmt(cw,2)+'</b> — the main call-OI resistance has given way.');
  /* where price is likely to be tested next */
  var lv=[];
  if(B[1]==='dn'){ lv.push('downside reference '+fmt(P-s5,2)+' (5-session 1σ from IV)'); if(pw&&pw<P) lv.push('put wall '+fmt(pw,2)); if(S.ns) lv.push('bias stays down while below '+fmt(S.ns.px,2)); }
  else if(B[1]==='up'){ lv.push('upside reference '+fmt(P+s5,2)+' (5-session 1σ from IV)'); if(cw&&cw>P) lv.push('call wall '+fmt(cw,2)); if(S.nl) lv.push('bias stays up while above '+fmt(S.nl.px,2)); }
  else lv.push('5-session 1σ range '+fmt(P-s5,2)+'–'+fmt(P+s5,2)+' (IV)');
  return {lines:out, levels:lv, bias:B, s5:s5};
}
function flowSVG(S, key){
  var w=S.w, W=760, H=300, PL=54, PR=96, PT=16, mid=170, PB=26, pw=W-PL-PR, n=w.length, bw=pw/n;
  var ps=w.map(function(x){ return x.P; }).concat([w[0].P-w[0].dP/100]); if(S.ns) ps.push(S.ns.px); if(S.nl) ps.push(S.nl.px);
  var lo=Math.min.apply(null,ps), hi=Math.max.apply(null,ps), pad=(hi-lo)*0.12||0.02; lo-=pad; hi+=pad;
  function Y(p){ return PT+(mid-PT-14)*(1-(p-lo)/(hi-lo)); }
  var mx=Math.max.apply(null,w.map(function(x){ return Math.abs(x.dOI); }))||1, z=mid+(H-PB-mid)/2, bh=(H-PB-mid)/2-4;
  var s='';
  for(var t=0;t<=3;t++){ var v=lo+(hi-lo)*t/3; s+='<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'" stroke="#1e2a3a"/><text x="'+(PL-6)+'" y="'+(Y(v)+4).toFixed(1)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">'+v.toFixed(2)+'</text>'; }
  function hl(p, c, lab){ if(p==null) return ''; var y=Y(p).toFixed(1); return '<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+y+'" y2="'+y+'" stroke="'+c+'" stroke-dasharray="5 4" stroke-width="1.3"/><text x="'+(W-PR+4)+'" y="'+(+y+4)+'" fill="'+c+'" font-size="10" font-weight="600" font-family="IBM Plex Mono">'+lab+'</text>'; }
  s+=hl(S.ns&&S.ns.px,'#e0655f','SHORTS '+(S.ns?S.ns.px.toFixed(2):'')); s+=hl(S.nl&&S.nl.px,'#3fb97f','LONGS '+(S.nl?S.nl.px.toFixed(2):''));
  var path=''; w.forEach(function(x,i){ var cx=PL+i*bw+bw/2; path+=(i?'L':'M')+cx.toFixed(1)+' '+Y(x.P).toFixed(1); });
  s+='<path d="'+path+'" fill="none" stroke="#dfe7f1" stroke-width="1.6"/>';
  s+='<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+z+'" y2="'+z+'" stroke="#3a4a60"/><text x="'+(PL-6)+'" y="'+(z+4)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="end">0</text>';
  s+='<text x="'+(PL-6)+'" y="'+(z-bh+4)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="end">+'+Math.round(mx/1000)+'k</text><text x="'+(PL-6)+'" y="'+(z+bh+4)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="end">−'+Math.round(mx/1000)+'k</text>';
  s+='<text x="'+PL+'" y="'+(mid+2)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono">Δ open interest (front + next)</text><text x="'+PL+'" y="'+(PT-4)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono">'+esc(S.ref)+' settle</text>';
  w.forEach(function(x,i){ var cx=PL+i*bw+bw/2, q=FLOWQ[x.q], h=Math.abs(x.dOI)/mx*bh, bw2=Math.max(3,bw*0.55);
    s+='<rect x="'+(cx-bw2/2).toFixed(1)+'" y="'+(x.dOI>=0?z-h:z).toFixed(1)+'" width="'+bw2.toFixed(1)+'" height="'+Math.max(1,h).toFixed(1)+'" fill="'+q.c+'"'+(x.dw?' opacity=".55"':'')+'/>';
    s+='<circle cx="'+cx.toFixed(1)+'" cy="'+Y(x.P).toFixed(1)+'" r="4.2" fill="'+q.c+'" stroke="#0b1220" stroke-width="1.2"/>';
    if(i%Math.ceil(n/10)===0||i===n-1) s+='<text x="'+cx.toFixed(1)+'" y="'+(H-8)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">'+x.lab+'</text>';
    var tip=x.lab+(x.prelim?' (prelim)':'')+' · '+q.l+'|'+esc(S.ref)+' '+x.P.toFixed(4)+' ('+sgn(x.dP,1,'¢')+')|Open interest '+sgn(x.dOI,0)+' (front '+sgn(x.dF,0)+' · next '+sgn(x.dD,0)+')'+(x.vol!=null?'|Volume '+fmt(x.vol)+(x.rv?' ('+fmt(x.rv,1)+'× normal)':''):'')+(x.dw?'|delivery window — half weight':'');
    s+='<rect class="oi-hit" x="'+(PL+i*bw).toFixed(1)+'" y="'+PT+'" width="'+bw.toFixed(1)+'" height="'+(H-PB-PT)+'" fill="transparent" data-tip="'+tip+'"/>'; });
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Price and open-interest flow by session">'+s+'</svg>';
}
function flowTileHTML(key){
  var n=FLOWN[key]||10, S=flowStats(key, n); if(!S) return '<div class="tile wide"><h2>Position flow signal</h2><p class="note">Needs at least 3 sessions of open-interest data.</p></div>';
  var avail=S.all.length, R=pflowRead(key, S), B=R.bias, wins=[5,10,15,20].filter(function(x){ return x<=avail; });
  var multi=wins.map(function(x){ var T=flowStats(key,x); return [x,T.score]; });
  var Who=flowWho(key, S), CK=flowChecks(key, S, Who, multi), conf=CK.conf;
  var turn=multi.length>=2&&Math.sign(multi[0][1])!==Math.sign(multi[multi.length-1][1])&&Math.abs(multi[0][1])>=15;
  function btn(v){ return '<button data-flown="'+v+'" data-k="'+key+'" aria-pressed="'+(n===v)+'">'+v+' SESSIONS</button>'; }
  var mixBar='<div class="fl-mix">'+['NL','SC','LL','NS'].map(function(q){ return S.mix[q]>0.5?'<span style="width:'+S.mix[q].toFixed(1)+'%;background:'+FLOWQ[q].c+'" title="'+FLOWQ[q].l+' '+fmt(S.mix[q],0)+'%"></span>':''; }).join('')+'</div>'+
    '<div class="fl-mixl">'+['NL','SC','LL','NS'].map(function(q){ return '<span><i style="background:'+FLOWQ[q].c+'"></i>'+FLOWQ[q].l+' '+fmt(S.mix[q],0)+'%</span>'; }).join('')+'</div>';
  var rows=S.w.slice().reverse().map(function(x){ var q=FLOWQ[x.q];
    return '<tr><td>'+x.lab+(x.prelim?' <small>prelim</small>':'')+'</td><td>'+x.P.toFixed(4)+'</td><td class="'+cls(x.dP)+'">'+sgn(x.dP,1,'¢')+'</td><td class="'+cls(x.dOI)+'">'+sgn(x.dOI,0)+'</td><td class="fl-sm">'+sgn(x.dF,0)+' / '+sgn(x.dD,0)+'</td><td class="fl-sm">'+(x.vol!=null?fmt(x.vol)+(x.rv?' <small>'+fmt(x.rv,1)+'×</small>':''):'—')+'</td><td><span class="fl-q" style="--qc:'+q.c+'">'+q.l+'</span>'+(x.dw?' <small>½ wt</small>':'')+'</td></tr>'; }).join('');
  var cf=DATA.grains[key].cftc||[], c1=cf[cf.length-1], c0=cf[cf.length-2], mmD=c1&&c0?c1.net-c0.net:null;
  var mmAgree=mmD==null?'':(Math.sign(mmD)===Math.sign(S.score)?'agrees':'disagrees');
  return '<div class="tile wide fl-tile" data-src="options"><div class="tile-head"><h2>Position flow signal <span class="h2note">— who is building positions, at what price, and which way it points · '+esc(GMETA[key].name)+'</span></h2>'+
    '<div class="oi-ctl"><span class="toggle" role="group" aria-label="Window">'+wins.map(btn).join('')+'</span></div></div>'+
    '<div class="fl-top"><div class="fl-verdict '+B[1]+'"><div class="fl-vl">Signal · '+S.n+' sessions</div><div class="fl-vv">'+B[0]+'</div><div class="fl-vs">score <b>'+(S.score>0?'+':'')+S.score+'</b> / ±100 · confidence <b>'+conf+'</b></div>'+
      '<div class="fl-multi">'+multi.map(function(m){ var b=flowBias(m[1]); return '<span class="'+b[1]+'">'+m[0]+'d '+(m[1]>0?'+':'')+m[1]+'</span>'; }).join('')+'</div>'+(turn?'<div class="fl-turn">⚑ short-term flow differs from the longer window — a shift may be under way</div>':'')+'</div>'+
    '<div class="fl-kpis">'+
      '<div><span>Price ('+esc(S.ref)+')</span><b>'+S.P.toFixed(4)+'</b><small class="'+cls(S.chg)+'">'+sgn(S.chg,1,'¢')+' over window</small></div>'+
      '<div><span>Net open interest</span><b class="'+cls(S.dOI)+'">'+sgn(S.dOI,0)+'</b><small>front + next combined</small></div>'+
      '<div><span>Shorts built at</span><b>'+(S.ns?S.ns.px.toFixed(4):'—')+'</b><small>'+(S.ns?fmt(S.ns.oi)+' contracts · '+S.ns.n+' day'+(S.ns.n>1?'s':''):'no new shorts in window')+'</small></div>'+
      '<div><span>Longs built at</span><b>'+(S.nl?S.nl.px.toFixed(4):'—')+'</b><small>'+(S.nl?fmt(S.nl.oi)+' contracts · '+S.nl.n+' day'+(S.nl.n>1?'s':''):'no new longs in window')+'</small></div>'+
      '<div><span>Current run</span><b>'+S.sameSign+' session'+(S.sameSign>1?'s':'')+'</b><small>'+(FLOWQ[S.last.q].w<0?'sell side':FLOWQ[S.last.q].w>0?'buy side':'flat')+' · latest '+FLOWQ[S.last.q].l.toLowerCase()+'</small></div>'+
      '<div><span>CFTC managed money w/w</span><b class="'+cls(mmD||0)+'">'+(mmD==null?'—':sgn(Math.round(mmD/100)/10,1,'k'))+'</b><small>'+(mmAgree?mmAgree+' with the flow · '+esc(fmtShortDate(c1.date)):'')+'</small></div>'+
    '</div></div>'+mixBar+
    '<div class="fl-body"><div class="fl-chart">'+flowSVG(S,key)+'<div class="legend">'+['NL','SC','LL','NS'].map(function(q){ return '<span><span class="sw" style="background:'+FLOWQ[q].c+'"></span>'+FLOWQ[q].l+'</span>'; }).join('')+'<span>dots = '+esc(S.ref)+' settle · dashed = average price where the window’s new shorts / longs were built</span></div></div>'+
    '<div class="fl-read"><h3>What the flow is saying</h3><ul>'+R.lines.map(function(l){ return '<li>'+l+'</li>'; }).join('')+'</ul>'+
      (Who?'<h3>Who is behind it <span class="h2note">— CFTC weekly</span></h3><ul>'+Who.lines.map(function(l){ return '<li>'+l+'</li>'; }).join('')+'</ul>':'')+
      '<h3>Confirmation checklist <span class="h2note">— confidence '+conf+' ('+fmt(CK.sc,1)+' of '+CK.mx+')</span></h3><div class="fl-ck">'+CK.list.map(function(x){ var ic=x[1]==null?'○':x[1]>=1?'✓':x[1]>0?'◐':'✗', c=x[1]==null?'neu':x[1]>=1?'up':x[1]>0?'neu':'dn';
        return '<div><span class="'+c+'">'+ic+'</span><b>'+x[0]+'</b><small>'+esc(x[2])+'</small></div>'; }).join('')+'</div>'+
      '<div class="fl-lv"><b>Levels to watch:</b> '+R.levels.join(' · ')+'</div></div></div>'+
    '<details class="fl-det"><summary>Session by session ('+S.n+')</summary><table class="oi-mtab fl-tab"><thead><tr><th>Date</th><th>'+esc(S.ref)+'</th><th>Δ price</th><th>Δ OI</th><th>front / next</th><th>Volume</th><th>Read</th></tr></thead><tbody>'+rows+'</tbody></table></details>'+
    '<div class="stamp">How it works: each session is classed by price change × change in combined front + next-month open interest (price↑OI↑ new longs, price↓OI↑ new shorts, price↑OI↓ short covering, price↓OI↓ long liquidation). Combined OI cancels pure rolling; price is one contract ('+esc(S.ref)+(S.ref===S.def?', the next month, because the roll is past 40%':', the front month')+') so it never jumps by the spread. Every contract has a buyer and a seller, so rising OI is never “longs” alone — the price direction shows which side opened the new positions aggressively. Score = direction weight (new positions ±1, exits ±½) × size of the OI change and price move vs their medians × relative volume (front + next, IB daily bars), recent sessions weighted more; ±35 = clear signal. Confidence comes from the checklist: windows agreeing, volume confirming, CFTC funds agreeing, and not being crowded in the signal’s direction. Shorts/longs “built at” = OI-weighted average settle on the days those positions were added. Through '+esc(S.last.lab)+(S.last.prelim?' (preliminary OI)':'')+' · a reading of positioning, not a forecast or trading advice.</div></div>';
}
document.addEventListener('click', function(e){ var b=e.target.closest&&e.target.closest('[data-flown]'); if(!b) return; var k=b.getAttribute('data-k'); FLOWN[k]=+b.getAttribute('data-flown');
  try{ localStorage.setItem('desk.flown', JSON.stringify(FLOWN)); }catch(x){} var t=b.closest('.fl-tile'); if(t) t.outerHTML=flowTileHTML(k); });
/* next-month (deferred) futures: open interest and how it is changing, next to the front month */
function rollNextHTML(key, R){
  var N=R.dailyN, L=N[N.length-1], P=N[N.length-2], P5=N[Math.max(0,N.length-6)];
  if(!L||!P) return '';
  function c(v){ return '<span class="'+cls(v)+'">'+(v>0?'+':v<0?'−':'')+fmt(Math.abs(v))+'</span>'; }
  function pct(a,b){ return b?' ('+(a>=b?'+':'−')+fmt(Math.abs(a/b-1)*100,1)+'%)':''; }
  var lab=R.lastLabel, comb=L[1]+L[2], combP=P[1]+P[2];
  var open=L[3]>=40;
  return '<div class="roll-next">'+
    '<div class="rn-c rn-next'+(open?'':' rn-locked')+'"><div class="rn-h">Next month · '+esc(R.def)+' <span class="rn-gate">'+(open?'✓ OPEN · ≥40%':'🔒 opens at 40%')+'</span></div><div class="rn-v">'+fmt(L[2])+'</div>'+
      '<div class="rn-s">day '+c(L[2]-P[2])+pct(L[2],P[2])+' · 5 sessions '+c(L[2]-P5[2])+'</div><div class="rn-s">'+fmt(L[2]/comb*100,1)+'% of combined OI</div></div>'+
    '<div class="rn-c"><div class="rn-h">Front month · '+esc(R.front)+'</div><div class="rn-v">'+fmt(L[1])+'</div>'+
      '<div class="rn-s">day '+c(L[1]-P[1])+pct(L[1],P[1])+' · 5 sessions '+c(L[1]-P5[1])+'</div><div class="rn-s">'+fmt(L[1]/comb*100,1)+'% of combined OI</div></div>'+
    '<div class="rn-c"><div class="rn-h">Combined · both months</div><div class="rn-v">'+fmt(comb)+'</div>'+
      '<div class="rn-s">day '+c(comb-combP)+' · '+(L[2]-P[2]>=-(L[1]-P[1])*0.8?'front exits are moving into '+esc(R.def):'positions are closing, not rolling')+'</div><div class="rn-s">⏱ '+esc(lab)+'</div></div>'+
  '</div>';
}
function rollTileHTML(key){
  var R=rollData(key), meta=GMETA[key], st=R.stats, lastT=R.dailyT[R.dailyT.length-1];
  var dT=R.dailyT.slice(-10), N=R.dailyN, off=N.length-R.dailyT.length;
  function dd(i){ var a=N[i+off], b=N[i+off-1]; return a&&b?[a[1]-b[1], a[2]-b[2]]:null; }
  function sg0(v){ return v==null?'—':'<span class="'+cls(v)+'">'+(v>0?'+':v<0?'−':'')+fmt(Math.abs(v))+'</span>'; }
  var dRows=dT.map(function(r,i){ var D=dd(R.dailyT.length-dT.length+i);
    return '<tr'+(i===dT.length-1?' class="hl"':'')+'><td class="lbl" data-l="">'+r[0]+'</td><td data-l="Front OI">'+r[1]+'</td><td data-l="Δ front">'+sg0(D&&D[0])+'</td><td data-l="Next OI">'+r[2]+'</td><td data-l="Δ next">'+sg0(D&&D[1])+'</td><td data-l="Net ΔOI">'+r[3]+'</td><td data-l="Roll %">'+r[4]+'</td><td data-l="Δ pp">'+r[5]+'</td><td data-l="Spread">'+r[6]+'</td><td data-l="Δ¢">'+r[7]+'</td></tr>';
  }).join("");
  var statRows=[
    ['Front month (futures)', meta.name+' '+R.front],
    ['Deferred month (futures)', meta.name+' '+R.def],
    ['Current roll progress','<b>'+st.roll+'</b>'],
    ['Front OI net (window)', st.fnet],
    ['Deferred OI net (window)', st.dnet],
    ['Combined OI net (window)','<b>'+st.cnet+'</b>'],
    ['Roll pace', st.pace],
    ['Option-month unlock at 40% rolled', st.thr],
    ['Calendar spread', st.sp],
    ['Managed money net', st.mm],
    ['First notice day (FND)', st.fnd],
    ['Hard exit deadline (FND−1)', st.hard],
    ['Delivery window status','<b>'+st.state+'</b>'],
    ['Action plan', st.plan]
  ].map(function(kv){ return '<div class="kv"><span class="kk">'+kv[0]+'</span><span class="vv" style="font-family:inherit;font-weight:500;font-size:12.5px">'+kv[1]+'</span></div>'; }).join("");
  var bT=R.beh.slice(-9);
  var behRows=bT.map(function(b,i){
    return '<div class="beh-row'+(i===bT.length-1?' hl':'')+'"><span class="bd">'+b[0]+'</span><span class="bt">'+esc(b[1])+'</span><span class="bt">'+esc(b[2])+'</span></div>';
  }).join("");
  return '<div class="tile wide roll-tile" data-src="grains_settle"><div class="tile-head"><h2>Futures roll — '+R.front+' → '+R.def+' <span class="h2note">· OI migration &amp; calendar spread · through '+esc(R.lastLabel)+'</span></h2></div>'+
    '<div class="stat-row" style="margin-top:8px">'+
    stat('Roll progress · '+R.lastLabel, st.roll) + stat('Front OI · '+R.lastLabel, lastT[1]) +
    stat('Deferred OI · '+R.lastLabel, lastT[2]) + stat('Calendar spread', st.sp) +
    stat('Roll pace', st.pace) + stat('Delivery window', st.state) +
    '</div>'+rollNextHTML(key, R)+
    '<div class="flowwrap">'+rollSVG2(R).replace('<svg ','<svg class="flowchart" ')+'</div>'+
    rollBadges(R)+
    rollSpreadLine(R)+
    '<div class="legend"><span><span class="sw" style="background:#2f6db3"></span>Front OI ('+R.front+')</span><span><span class="sw" style="background:#2b8f61"></span>Deferred OI ('+R.def+')</span><span><span class="sw" style="background:#f5c542"></span>Calendar spread ¢/bu (right axis)</span><span>Bar labels: roll % = deferred OI ÷ (front + deferred OI)</span></div>'+
    '<div class="roll-grid"><div><h3>Daily summary — last 10 sessions</h3><table class="mini"><thead><tr><th>Date</th><th>Front OI</th><th>Δ front</th><th>Next OI</th><th>Δ next</th><th>Net ΔOI</th><th>Roll %</th><th>Δ pp</th><th>Spread</th><th>Δ¢</th></tr></thead><tbody>'+dRows+'</tbody></table></div>'+
    '<div><h3>Roll statistics &amp; timing</h3>'+statRows+'</div></div>'+
    '<div class="roll-opt"><h3>Options open interest by month — for roll planning</h3>'+oiMonthsHTML(key).replace('<div class="oi-mt">What happened in each option month</div>','')+'<p class="note" style="margin:6px 0 0">Strike-by-strike view and change chart: <a href="#" data-secjump="'+key+':opt">Options data → Open interest by strike</a> (NEAR · FAR · BOTH)</p></div>'+
    '<div class="beh-wrap"><h3>Trader behaviour — what each session\u2019s flow says · last 9 session deltas</h3>'+
    '<div class="beh-row beh-head"><span class="bd">Date</span><span class="bt">Front ('+R.front+') — unwinding</span><span class="bt">Deferred ('+R.def+') — adding</span></div>'+behRows+
    '<p class="decode">Decode: price↑+OI↑ = new longs · price↓+OI↑ = new shorts · price↑+OI↓ = short covering · price↓+OI↓ = long liquidation</p>'+
    '<div class="stamp" style="border:0;margin-top:4px;padding-top:8px">Latest session ('+esc(R.lastLabel)+') highlighted'+(/prelim/.test(R.lastLabel)?' · preliminary until the exchange final is confirmed (exchange preliminary — has matched the final within ~0.6% on this desk)':'')+
      (R.oldPrelim.length?' · ᵖ '+esc(R.oldPrelim.join(', ').replace(/\s*\(?\b(IBKR|CME)\b\)?/g,''))+': exchange preliminary open interest, the desk uses the preliminary figure (it has matched the exchange final within ~0.6%) from our sources, so the preliminary figure is kept and marked':'')+'</div></div>'+
    '<div class="stamp">Per-contract open interest: rollover-card history through Oct 20, then the exchange daily bulletin (prelim = exchange preliminary OI, published ~10:30 pm ET on trade date; final ~10:30 am ET next day) · settles: CBOT daily settlements · behaviour rule: OI and price change of each contract that session</div></div>';
}

/* ---------------- grain tab render ---------------- */
var grainState = { corn:"near", wheat:"near", soybeans:"near" };

function positioningHTML(key){
  var g=DATA.grains[key], meta=GMETA[key], side=grainState[key], ds=g[side];
  var isNear = side==="near";
  var head = (isNear?meta.chainNear:meta.chainFar)+' options · '+oiLabel(ds);
  var extra = isNear
    ? stat("Chain IV", fmt(ds.iv,2)+"%") + stat("Options expire", ds.expires?fmtDate(ds.expires):meta.optExp)
    : stat("Range read", "Put wall "+money2(ds.put_wall[0])+" → call wall "+money2(ds.call_wall[0]));
  return '<div class="tile-head"><h2>Options positioning — <span class="h2note">'+head+'</span></h2>'+
    '<span class="toggle" role="group" aria-label="Near or far option month">'+
    '<button data-grain="'+key+'" data-side="near" aria-pressed="'+(isNear)+'">NEAR · '+meta.chainNear.toUpperCase()+'</button>'+
    '<button data-grain="'+key+'" data-side="far" aria-pressed="'+(!isNear)+'">FAR · '+meta.chainFar.toUpperCase()+'</button></span></div>'+
    '<div class="stat-row">'+
    stat("Call OI", fmt(ds.calls)) + stat("Put OI", fmt(ds.puts)) +
    stat("Put/Call (OI)", ds.pcr==null?'N/A':fmt(ds.pcr,2)) +
    stat("Call wall", money2(ds.call_wall[0]), fmt(ds.call_wall[1])+" OI \u00b7 at/above "+money2(ds.wall_ref||0)) +
    stat("Put wall", money2(ds.put_wall[0]), fmt(ds.put_wall[1])+" OI \u00b7 at/below "+money2(ds.wall_ref||0)) + extra +
    '</div>'+
    (isNear?oiShiftHTML(DATA.grains[key]):'')+
    (ds.wall_ref?'<p class="note">Walls follow the live price: call wall = strike with the most call OI at or above the underlying, put wall = most put OI at or below it (underlying '+esc(ds.contract||'')+' \u2248 '+money2(ds.wall_ref)+', '+esc(ds.wall_ref_src)+'). '+
      ((ds.put_wall_any&&Math.abs(ds.put_wall_any[0]-ds.put_wall[0])>1e-6)?'Largest put OI anywhere: '+money2(ds.put_wall_any[0])+' ('+fmt(ds.put_wall_any[1])+', in the money). ':'')+
      ((ds.call_wall_any&&Math.abs(ds.call_wall_any[0]-ds.call_wall[0])>1e-6)?'Largest call OI anywhere: '+money2(ds.call_wall_any[0])+' ('+fmt(ds.call_wall_any[1])+', in the money). ':'')+
      'Open interest is exchange end-of-day data ('+esc(oiLabel(ds))+'); the walls move intraday only because the price does.</p>':'')+
    (ds.note ? '<p class="note">'+esc(ds.note)+(ds.underlying?' \u00b7 underlying futures '+money2(ds.underlying):'')+(ds.partial?' \u00b7 totals and P/C cover the pulled strikes only':'')+'</p>' : '')+
    (isNear ? '' : '<div class="stamp" style="border:0;margin-top:10px;padding-top:0">FAR MONTH — '+oiLabel(ds)+'. Range the market is defining: '+money2(ds.put_wall[0])+' – '+money2(ds.call_wall[0])+'.</div>');
}
/* the pull date comes from the data (written by the daily options refresh) — never fixed text */
function oiLabel(ds){ return ds&&ds.oi_label ? ds.oi_label : 'chain pull Oct 22, 2026 · OI as of Oct 21 close'; }

var OIV={}; try{ OIV=JSON.parse(localStorage.getItem('desk.oiv')||'{}')||{}; }catch(e){}
function daysToFnd(key){
  var st=(DATA.rolls_base&&DATA.rolls_base[key]&&DATA.rolls_base[key].stats)||(typeof ROLLS!=='undefined'&&ROLLS[key]&&ROLLS[key].stats)||{}, t=st.fnd?new Date(st.fnd.replace(/^[A-Za-z]+ /,'')+' 12:00'):null;
  return t&&!isNaN(t)?Math.ceil((t-Date.now())/86400000):null;
}
/* futures roll level for the 40% liquidity gate: deferred OI ÷ (front + deferred) on the latest session */
function rollLevel(key){
  var R=rollData(key), N=R.dailyN, L=N[N.length-1], P5=N[Math.max(0,N.length-6)], crossed=null;
  for(var i=N.length-1;i>0;i--){ if(N[i][3]>=40&&N[i-1][3]<40){ crossed=MON3[N[i][0].slice(0,2)]+' '+N[i][0].slice(3); break; } }
  if(!crossed&&N[0][3]>=40) crossed='before '+MON3[N[0][0].slice(0,2)]+' '+N[0][0].slice(3);
  return {pct:L[3], open:L[3]>=40, front:R.front, def:R.def, crossed:crossed, pace:(L[3]-P5[3])/Math.max(1,N.length-1-Math.max(0,N.length-6))};
}
function oiTileHTML(key){
  var g=DATA.grains[key], meta=GMETA[key], st=OIV[key]||(OIV[key]={cp:'both',mon:'near',view:'oi'});
  if(st.mon==='cur') st.mon='near'; if(st.mon==='next') st.mon='far'; if(['near','far','both'].indexOf(st.mon)<0) st.mon=grainState[key]==='far'?'far':'near';
  var cp=st.cp||'both', view=st.view||'oi', dF=daysToFnd(key), RL=rollLevel(key), unlocked=RL.open, hasFar=g.far&&g.far.rows&&g.far.rows.length&&unlocked;
  /* the next option month opens once 40% of futures open interest has rolled; on first opening, show both months */
  if(unlocked&&!st.seenOpen){ st.seenOpen=1; if(st.mon==='near') st.mon='both'; }
  if(!unlocked) st.seenOpen=0;
  var mons=st.mon==='both'&&hasFar?['near','far']:[st.mon==='far'&&hasFar?'far':'near'];
  function btn(attr,val,on,lab,tip){ return '<button data-oiv="'+attr+'" data-v="'+val+'" data-k="'+key+'" aria-pressed="'+on+'"'+(tip?' title="'+tip+'"':'')+'>'+lab+'</button>'; }
  var ctl='<span class="toggle" role="group" aria-label="Option month">'+btn('mon','near',st.mon==='near'||!hasFar,'NEAR · '+meta.chainNear.toUpperCase())+(hasFar?btn('mon','far',st.mon==='far','FAR · '+meta.chainFar.toUpperCase())+btn('mon','both',st.mon==='both','BOTH'):
      '<button disabled class="oi-lock" title="Opens when the futures roll passes 40% (now '+fmt(RL.pct,1)+'%)">🔒 FAR · '+meta.chainFar.toUpperCase()+'</button><button disabled class="oi-lock" title="Opens when the futures roll passes 40%">🔒 BOTH</button>')+'</span>'+
    '<span class="toggle" role="group" aria-label="Measure">'+btn('view','oi',view==='oi','OPEN INTEREST')+btn('view','chg',view==='chg','CHANGE IN OI','Change since the previous pull, by strike')+'</span>'+
    '<span class="toggle" role="group" aria-label="Calls or puts">'+btn('cp','call',cp==='call','CALLS')+btn('cp','put',cp==='put','PUTS')+btn('cp','both',cp==='both','BOTH')+'</span>';
  var charts=mons.map(function(m){
    var ds=g[m], lab=m==='near'?meta.chainNear:meta.chainFar, prev=ds.rows_prev&&ds.rows_prev.rows?ds.rows_prev:null;
    var ex=ds.expires?new Date(ds.expires+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'}):'';
    var Uh=ds.wall_ref||ds.underlying, bp=ds.rows.reduce(function(a,r){ return r[2]>a[2]?r:a; },ds.rows[0]), bc=ds.rows.reduce(function(a,r){ return r[1]>a[1]?r:a; },ds.rows[0]);
    var itmNote=Uh?((bp[0]>Uh+1e-9&&cp!=='call'?'<div class="oi-itm">Largest put open interest is at <b>'+fmt(bp[0],2)+'</b> ('+fmt(bp[2])+') — that strike is <b>in the money</b> with price at '+fmt(Uh,4)+': protection bought when the market was higher, not support below today’s price. The put wall below price is <b>'+fmt(ds.put_wall[0],2)+'</b>.</div>':'')+
      (bc[0]<Uh-1e-9&&cp!=='put'?'<div class="oi-itm">Largest call open interest is at <b>'+fmt(bc[0],2)+'</b> ('+fmt(bc[1])+') — <b>in the money</b> with price at '+fmt(Uh,4)+'. The call wall above price is <b>'+fmt(ds.call_wall[0],2)+'</b>.</div>':'')):'';
    var head='<div class="oi-mh"><b>'+esc(lab)+' monthly options</b> on '+esc(ds.contract||'')+' <span class="h2note">· standard monthly expiry'+(ex?' <b>'+esc(ex)+'</b>':'')+' (weeklies listed below) · '+(m==='near'?'near month':'far month')+' · '+esc(oiLabel(ds))+'</span></div>'+itmNote;
    head+='<div class="oi-chk-row">'+oiChkHTML(ds)+(oiPrevText(ds)?' · <span class="oi-prev">'+oiPrevText(ds)+'</span>':'')+'</div>';
    if(view==='chg') return head+(prev?oiDeltaSVG(ds, prev, cp, key, lab):'<p class="note oi-nochg">Change by strike for '+esc(lab)+' needs two pulls — the previous pull was not stored for this month yet. It appears after the next 8:23 ET daily options run.</p>');
    return head+oiSVG(ds.rows, ds, cp, prev, lab);
  }).join('');
  var leg=view==='chg'?'<span><span class="sw" style="background:var(--call)"></span>Calls added</span><span><span class="sw" style="background:#1f7a52"></span>Calls closed</span><span><span class="sw" style="background:var(--put)"></span>Puts added</span><span><span class="sw" style="background:#7a2f2b"></span>Puts closed</span>':
    (cp!=='put'?'<span><span class="sw" style="background:var(--call)"></span>Call OI</span><span><span class="sw" style="background:#ffd27a"></span>Call wall strike</span>':'')+(cp!=='call'?'<span><span class="sw" style="background:var(--put)"></span>Put OI</span><span><span class="sw" style="background:#ff9d97"></span>Put wall strike</span>':'');
  return '<div class="tile-head"><h2>Open interest by strike <span class="h2note">— hover or tap a strike for its numbers</span></h2><div class="oi-ctl">'+ctl+'</div></div>'+'<div class="oi-snap-row">'+oiBadgeHTML()+'</div>'+
    '<p class="note oi-gate'+(unlocked?' on':'')+'" style="margin:4px 0 0">'+(unlocked
      ? '✓ Next month open — '+esc(RL.def)+' holds <b>'+fmt(RL.pct,1)+'%</b> of '+esc(RL.front)+'+'+esc(RL.def)+' open interest (≥ 40% liquidity threshold, crossed '+esc(RL.crossed||'')+')'+(dF!=null&&dF>0?' · '+dF+' day'+(dF===1?'':'s')+' to first notice':'')
      : '🔒 Next option month opens when the futures roll passes <b>40%</b> — '+esc(RL.def)+' holds '+fmt(RL.pct,1)+'% of open interest ('+fmt(40-RL.pct,1)+' pp to go'+(RL.pace>0?', ~'+Math.ceil((40-RL.pct)/RL.pace)+' sessions at the current pace':'')+')')+'</p>'+
    charts+'<div class="legend">'+leg+(view==='chg'?'':'<span>faded bars = in the money · white line = live price</span>')+'</div>'+oiMonthsHTML(key)+oiWeekliesHTML(key)+
    '<div class="stamp">Pulled '+esc(asofStamp('options'))+' · open interest is the prior session’s close as published before the open (exchange preliminary; on this desk it has matched the ~10:30 AM final within about 0.2% of each chain), pulled by the daily options run (8:23 AM ET, due on the desk by 8:45 AM ET) · change = latest pull vs the previous stored pull for that month</div>';
}
/* weekly / short-dated option expiries (pulled by the morning run): totals, biggest strikes, and any strike whose open
   interest is large next to the monthly chain's biggest strike gets highlighted */
function oiWeekliesHTML(key){
  var g=DATA.grains[key], W=g.weeklies;
  if(!W||!W.length) return '<div class="oi-wk"><div class="oi-mt">Weekly &amp; short-dated expiries</div><p class="note" style="margin:2px 0">Not pulled yet — the 8:23 ET daily run adds the next weekly expiries for each grain from tomorrow.</p></div>';
  var mx=Math.max.apply(null,(g.near.rows||[]).map(function(r){ return Math.max(r[1],r[2]); }))||1, U=g.near.wall_ref||g.near.underlying;
  return '<div class="oi-wk"><div class="oi-mt">Weekly &amp; short-dated expiries <span class="h2note">— ±6 strikes around the money · highlighted when a strike holds ≥ 20% of the monthly chain’s biggest strike</span></div>'+
    W.map(function(w){ var big=(w.rows||[]).filter(function(r){ return Math.max(r[1],r[2])>=0.2*mx; });
      var top=(w.rows||[]).slice().sort(function(a,b){ return Math.max(b[1],b[2])-Math.max(a[1],a[2]); }).slice(0,3);
      return '<div class="oi-wkr'+(big.length?' hot':'')+'"><b>'+esc(w.label||w.expiry)+'</b> <small>'+esc(w.class||'')+' · expires '+esc(w.expiry)+' · on '+esc(w.contract||'')+'</small>'+
        '<span>calls '+fmt(w.calls||0)+' · puts '+fmt(w.puts||0)+'</span><span>top: '+top.map(function(r){ var c=r[1]>=r[2]; return fmt(r[0],2)+(c?' C ':' P ')+fmt(Math.max(r[1],r[2]))+(U?(c?(r[0]<U?' (ITM)':''):(r[0]>U?' (ITM)':'')):''); }).join(' · ')+'</span>'+
        (big.length?'<span class="oi-hot">⚑ large OI at '+big.map(function(r){ return fmt(r[0],2); }).join(', ')+'</span>':'')+'</div>'; }).join('')+
    '<div class="stamp">'+esc(W[0].asof||'')+' · weeklies expire on Fridays; daily (Mon–Wed) and new-crop short-dated classes are not pulled</div></div>';
}
/* one row per option month: totals, change vs previous pull, walls and wall moves */
function oiMonthSum(ds){
  var P=ds.rows_prev&&ds.rows_prev.rows, pc=0, pp=0, map={};
  if(P){ P.forEach(function(r){ map[r[0]]=r; }); ds.rows.forEach(function(r){ var q=map[r[0]]; if(q){ pc+=q[1]; pp+=q[2]; } }); }
  var cc=0, cpu=0; ds.rows.forEach(function(r){ if(!P||map[r[0]]){ cc+=r[1]; cpu+=r[2]; } });
  var pw=null, cw=null, U=ds.wall_ref||ds.underlying;
  if(P&&U){ P.forEach(function(r){ if(r[0]>=U-1e-9&&(!cw||r[1]>cw[1])) cw=r; if(r[0]<=U+1e-9&&(!pw||r[2]>pw[1])) pw=[r[0],r[2]]; }); }
  return {dc:P?cc-pc:null, dp:P?cpu-pp:null, from:P?ds.rows_prev.date:null, cw0:cw, pw0:pw};
}
function oiMonthsHTML(key){
  var g=DATA.grains[key], meta=GMETA[key];
  var rows=['near','far'].filter(function(m){ return g[m]&&g[m].rows&&g[m].rows.length; }).map(function(m){
    var ds=g[m], S=oiMonthSum(ds), lab=m==='near'?meta.chainNear:meta.chainFar;
    function d(v){ return v==null?'<span class="neu">—</span>':'<span class="'+cls(v)+'">'+sgn(v,0)+'</span>'; }
    var mv=function(old,now,word){ return old&&Math.abs(old[0]-now[0])>1e-6?' <span class="oi-mv">moved from '+fmt(old[0],2)+' — new '+word+'</span>':''; };
    return '<tr><td><b>'+esc(lab)+'</b><small>'+(m==='near'?'near':'far')+'</small></td><td>'+fmt(ds.calls)+'<br>'+d(S.dc)+'</td><td>'+fmt(ds.puts)+'<br>'+d(S.dp)+'</td><td>'+(ds.pcr==null?'<span title="No call open interest: the ratio is undefined">N/A</span>':fmt(ds.pcr,2))+'</td>'+
      '<td>'+fmt(ds.call_wall[0],2)+' · '+fmt(ds.call_wall[1])+mv(S.cw0,ds.call_wall,'resistance')+'</td><td>'+fmt(ds.put_wall[0],2)+' · '+fmt(ds.put_wall[1])+mv(S.pw0,ds.put_wall,'support')+'</td>'+
      '<td class="oi-asof">'+esc(oiLabel(ds).replace(/^.*OI as of /,'OI ').replace(' close (preliminary)',' close · prelim'))+(S.from?'<br>Δ vs '+esc(fmtShortDate(S.from))+' pull'+(ds._prev_sessions>1?' <b class="oi-gapn">('+ds._prev_sessions+' sessions)</b>':''):ds._prev_bad?'<br>Δ n/a — '+esc(ds._prev_bad):'<br>Δ from next pull')+'</td></tr>';
  }).join('');
  return '<div class="oi-months"><div class="oi-mt">What happened in each option month</div><table class="oi-mtab"><thead><tr><th>Month</th><th>Calls · Δ</th><th>Puts · Δ</th><th>P/C</th><th>Call wall</th><th>Put wall</th><th>Data</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
/* change in open interest by strike (bars above zero = contracts added, below = closed) */
function oiDeltaSVG(ds, prev, cp, key, lab){
  var shC=cp!=='put', shP=cp!=='call', P={}; prev.rows.forEach(function(r){ P[r[0]]=r; });
  var rows=ds.rows.filter(function(r){ return P[r[0]]; }).map(function(r){ var q=P[r[0]]; return [r[0], r[1]-q[1], r[2]-q[2], r[1], r[2], q[1], q[2], (r[3]!=null&&q[3]!=null)?r[3]-q[3]:null, (r[4]!=null&&q[4]!=null)?r[4]-q[4]:null]; });
  /* option OI never shows who bought or wrote: OI up with that strike's IV up = buyers paying up (bought); OI up with IV down = sellers (written) */
  function side(dOI, dIV){ if(dIV==null||Math.abs(dOI)<50) return ''; if(dOI>0) return dIV>0.2?' · likely bought (IV '+sgn(dIV,1)+')':dIV<-0.2?' · likely written (IV '+sgn(dIV,1)+')':' · IV flat'; return dIV<-0.2?' · closing, IV '+sgn(dIV,1):''; }
  if(!rows.length) return '<p class="note">No overlapping strikes between the two pulls.</p>';
  var W=760,H=240,PL=50,PR=14,PT=14,PB=30, pw=W-PL-PR, ph=H-PT-PB, mx=0;
  rows.forEach(function(r){ mx=Math.max(mx, shC?Math.abs(r[1]):0, shP?Math.abs(r[2]):0); }); mx=(mx||1)*1.1;
  var n=rows.length, bw=pw/n, Z=PT+ph/2; function Y(v){ return Z-v/mx*ph/2; }
  var s='<line x1="'+PL+'" y1="'+Z+'" x2="'+(PL+pw)+'" y2="'+Z+'" stroke="#3a4a60"/>';
  [1,-1].forEach(function(k){ s+='<text x="'+(PL-6)+'" y="'+(Y(k*mx/1.1)+4)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">'+(k>0?'+':'−')+fmt(Math.round(mx/1.1))+'</text>'; });
  s+='<text x="'+(PL-6)+'" y="'+(Z+4)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">0</text>';
  var step=n>110?16:n>70?10:6;
  rows.forEach(function(r,i){ var x=PL+i*bw, w=Math.max(1,bw*(cp==='both'?0.38:0.7));
    if(shC&&r[1]) s+='<rect x="'+x.toFixed(1)+'" y="'+Math.min(Y(r[1]),Z).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+Math.abs(Y(r[1])-Z).toFixed(1)+'" fill="'+(r[1]>0?'#3fb97f':'#1f7a52')+'"/>';
    if(shP&&r[2]) s+='<rect x="'+(cp==='both'?x+w+1:x).toFixed(1)+'" y="'+Math.min(Y(r[2]),Z).toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+Math.abs(Y(r[2])-Z).toFixed(1)+'" fill="'+(r[2]>0?'#e0655f':'#7a2f2b')+'"/>';
    if(i%step===0) s+='<text x="'+(x+bw/2).toFixed(1)+'" y="'+(PT+ph+16)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">'+r[0].toFixed(2)+'</text>';
    var tip=esc(lab)+' · strike '+r[0].toFixed(2)+'|Calls '+fmt(r[3])+' ('+sgn(r[1],0)+' vs '+fmt(r[5])+')'+side(r[1],r[7])+'|Puts '+fmt(r[4])+' ('+sgn(r[2],0)+' vs '+fmt(r[6])+')'+side(r[2],r[8])+'|vs '+fmtShortDate(prev.date)+' close';
    s+='<rect class="oi-hit" x="'+x.toFixed(1)+'" y="'+PT+'" width="'+bw.toFixed(1)+'" height="'+ph+'" fill="transparent" data-tip="'+tip+'"/>';
  });
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Change in open interest by strike">'+s+'</svg>';
}
/* "Mon DD h:mm AM ET" for a data block's as-of time */
/* open interest is a once-a-day exchange figure: name the CME trade date it describes and when the desk pulled it (OI-01/02) */
function oiTradeDate(){ var a=DATA.meta&&DATA.meta.asof&&DATA.meta.asof.options; if(!a) return null; var d=new Date(Date.parse(a)), et=new Date(d.toLocaleString('en-US',{timeZone:'America/Toronto'}));
  do { et.setDate(et.getDate()-1); } while(et.getDay()===0||et.getDay()===6); return et; }
function oiBadgeHTML(){ var td=oiTradeDate(), a=DATA.meta&&DATA.meta.asof&&DATA.meta.asof.options;
  return '<span class="oi-snap" title="Open interest is published by CME once a day for the prior session. It is not live and does not show who bought or sold.">DAILY SNAPSHOT</span> <span class="oi-snap-t">CME trade date <b>'+(td?td.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}):'n/a')+'</b> · pulled '+(a?esc(asofStamp('options')):'n/a')+' · runs 8:23 AM ET, due by 8:45 AM ET</span>'; }
function asofStamp(k){ var a=DATA.meta&&DATA.meta.asof&&DATA.meta.asof[k]; if(!a) return 'n/a';
  return new Date(a).toLocaleString('en-US',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET'; }
function kAsof(txt){ return '<div class="kasof">⏱ '+txt+'</div>'; }

/* ---------------- grain dashboard pieces ---------------- */
var USDA_WASDE=["2026-11-10","2026-12-10"];   /* 12:00 ET · confirmed 2026 schedule */
function usdaEvents(key, fromMs, days){
  var out=[], meta=GMETA[key], d=new Date(fromMs);
  function at(y,m,dd,h,mi,label,kind){ var t=zonedMs(y,m,dd,h,mi,"America/Toronto"); if(t>=fromMs-6*3600000 && t<=fromMs+days*86400000) out.push({t:t,label:label,kind:kind}); }
  for(var i=-1;i<=days;i++){
    var x=new Date(fromMs+i*86400000), p={};
    new Intl.DateTimeFormat("en-US",{timeZone:"America/Toronto",year:"numeric",month:"numeric",day:"numeric",weekday:"short"}).formatToParts(x).forEach(function(q){ p[q.type]=q.value; });
    var y=+p.year, m=+p.month, dd=+p.day, wd=p.weekday, iso=y+"-"+String(m).padStart(2,"0")+"-"+String(dd).padStart(2,"0");
    var thanks=(m===11&&wd==="Thu"&&dd>=22&&dd<=28);
    if(wd==="Mon"){ at(y,m,dd,11,0,"Export inspections","usda"); if(m>=4&&m<=11&&!(m===11&&dd>30)) at(y,m,dd,16,0,"Crop progress","usda"); }
    if(wd==="Thu"&&!thanks) at(y,m,dd,8,30,"Export sales","usda");
    if(wd==="Fri"&&m===11&&dd>=23&&dd<=29) at(y,m,dd,8,30,"Export sales (Thanksgiving week)","usda");
    if(window.cotSync) cotSync();
    if(wd==="Fri"&&!(window.COT_DELAY&&COT_DELAY[iso])) at(y,m,dd,15,30,"CFTC Commitments of Traders","cftc");
    if(window.COT_REL&&COT_REL[iso]) at(y,m,dd,15,30,"CFTC Commitments of Traders (holiday-delayed)","cftc");
    if(USDA_WASDE.indexOf(iso)>=0) at(y,m,dd,12,0,"WASDE + Crop Production","wasde");
    (meta.dates||[]).forEach(function(cd){ if(cd[0]===iso) at(y,m,dd,14,20,cd[1],"contract")  /* CBOT close 1:20 CT = 2:20 ET */; });
  }
  return out.sort(function(a,b){ return a.t-b.t; });
}
function grainCalendarHTML(key){
  var now=Date.now(), ev=usdaEvents(key, now, 45).concat(caEvents(now, 45)).sort(function(a,b){ return a.t-b.t; });
  var nx=ev.filter(function(e){ return e.t>now; });
  var big=nx.filter(function(e){ return e.kind==="wasde"||e.kind==="contract"; })[0];
  var soon=now+10*86400000;
  var rows=ev.filter(function(e){ return e.kind==="wasde"||e.kind==="contract"||e.kind==="ca"||e.t<=soon; }).slice(0,16).map(function(e){
    var past=e.t<now, chip=e.kind==="ca"?' <span class="chip demo">CANADA</span>':e.kind==="wasde"?' <span class="chip miss">HIGH</span>':e.kind==="contract"?' <span class="chip demo">CONTRACT</span>':'';
    return '<div class="kv'+(past?' ev-past':'')+'"><span class="kk">'+etLabel(e.t,true)+' · '+esc(e.label)+chip+(past?' <span class="chip inline">OUT</span>':'')+'</span><span class="vv">'+(past?'':'<span class="countdown" data-t="'+e.t+'">'+cdText(e.t-now)+'</span>')+'</span></div>';
  }).join("");
  var latest=big?'Next key date: <b>'+esc(big.label)+'</b> · '+etLabel(big.t,true)+' ET · <span class="countdown" data-t="'+big.t+'">'+cdText(big.t-now)+'</span>':'';
  return railCard('USDA, Canada &amp; contract calendar', latest, rows+
    '<div class="stamp">Times in Toronto (ET) · weekly USDA reports by rule (holiday weeks can shift) · WASDE dates per the 2026 USDA schedule · contract dates from CBOT calendars · Canada dates from AAFC’s latest Outlook</div>');
}
function cdText(ms){ if(ms<=0) return 'now'; var m=Math.floor(ms/60000), d=Math.floor(m/1440), h=Math.floor(m%1440/60); return d?d+'d '+h+'h':h?h+'h '+(m%60)+'m':(m%60)+'m'; }
function grainKpiHTML(key){
  var g=DATA.grains[key], f=g.fan, meta=GMETA[key], q=f.intraday[0], chg=(q/f.anchor-1)*100;
  var last=g.cftc[g.cftc.length-1], prev=g.cftc[g.cftc.length-2];
  var E=(DATA.exports&&DATA.exports[key])||EXPORT[key], w=E.weeks[E.weeks.length-1], v=esVerdict(w);
  var spark=sparkPath(g.history.map(function(h){ return h.s; }),120,26);
  return '<div class="tile wide kpi-strip">'+
    kpi(meta.contract+' (delayed)', '<span class="g-kpi" data-grain="'+key+'" data-tick="kpi-'+key+'" data-roll>$'+fmt(q,4)+'</span>', '<span class="'+cls(chg)+'">'+sgn(chg,2,'%')+'</span> vs settle · '+esc(f.intraday[1]), spark)+
    kpi('Settle · '+fmtShortDate(f.settle_date), '$'+fmt(+f.anchor,4), 'z '+f.z+' · MA20 $'+f.ma20)+
    kpi('Options ('+meta.chainNear+')', 'P/C '+f.pcr, 'P $'+fmt(f.put_wall[0],2)+' · C $'+fmt(f.call_wall[0],2))+
    kpi('Managed money', sgn(Math.round(last.net/1000),0)+'<small>k</small>', '<span class="'+cls(last.net-prev.net)+'">'+sgn(Math.round((last.net-prev.net)/100)/10,1)+'k</span> w/w · '+fmtShortDate(last.date))+
    kpi('Export sales', fmt(Math.round(w[2]/1000))+'<small>k MT</small>', (v?'<span class="'+(v==='BEAT'?'up':v==='MISS'?'dn':'neu')+'">'+(v==='BEAT'?'above':v==='MISS'?'below':'inside')+' range</span>':'no estimate')+' · w/e '+fmtShortDate(w[0]))+
    '</div>';
}
function grainInsight(key){
  var g=DATA.grains[key], f=g.fan, meta=GMETA[key], a=f.anchor, m20=+f.ma20, m50=+f.ma50, m100=f.ma100?+f.ma100:null, z=+f.z;
  function rel(v,n){ return v==null?'':(a>=v?'above':'below')+' the '+n+' ($'+fmt(v,2)+')'; }
  var mas=[rel(m20,'20-day'),rel(m50,'50-day'),m100?rel(m100,'100-day'):''].filter(Boolean);
  var band=Math.abs(z)>=2?'beyond '+(z<0?'−':'+')+'2σ — statistically stretched':Math.abs(z)>=1?'between 1σ and 2σ '+(z<0?'below':'above')+' the mean':'within 1σ of the mean';
  var pc=+f.pcr, lean=!isFinite(pc)?'undefined (no call open interest)':pc<0.8?'call-heavy':pc>1.2?'put-heavy':'balanced';
  var last=g.cftc[g.cftc.length-1];
  return 'Settle <b>'+money2(a)+'</b> ('+fmtShortDate(f.settle_date)+') sits '+mas.join(', ')+'; z-score <b>'+f.z+'</b> — '+band+'. '+
    meta.chainNear+' options: call wall $'+fmt(f.call_wall[0],2)+' ('+f.call_wall[1]+'), put wall $'+fmt(f.put_wall[0],2)+' ('+f.put_wall[1]+'), P/C '+f.pcr+' reads '+lean+'. '+
    'Managed money is net '+(last.net>=0?'long ':'short ')+fmt(Math.abs(last.net))+' contracts ('+fmtShortDate(last.date)+').'+
    (g.oishift&&g.oishift.items.length?' <b>Options open interest:</b> '+g.oishift.items.slice(0,2).map(function(i){ return i.t.replace(/<[^>]+>/g,''); }).join(' '):'');
}
function grainSpreadsHTML(key){
  var g=DATA.grains[key], R=g.roll, rows='';
  for(var i=0;i<R.length-1;i++){
    var a=R[i], b=R[i+1], sp=(a.settle-b.settle)*100, pv=(a.prev!=null&&b.prev!=null)?(a.prev-b.prev)*100:null;
    rows+='<div class="kv"><span class="kk">'+a.expiry+' / '+b.expiry+'</span><span class="vv">'+sgn(sp,2,'¢')+' <span class="neu" style="font-weight:400">('+(sp<0?'contango':'backwardation')+(pv!=null?' · Δ '+sgn(sp-pv,2,'¢'):'')+')</span></span></div>';
  }
  var legs=R.map(function(r){ return '<div class="kv"><span class="kk">'+r.contract+' · '+r.expiry+'</span><span class="vv">'+money2(r.settle)+(r.prev!=null?' <span class="'+cls(r.settle-r.prev)+'" style="font-weight:400">'+sgn((r.settle-r.prev)*100,2,'¢')+'</span>':'')+'</span></div>'; }).join('');
  return '<div class="tile" data-src="grains_settle"><h2>Curve &amp; calendar spreads <span class="h2note">— settles '+fmtShortDate((R[0].settle_date)||g.fan.settle_date)+'</span></h2>'+rows+'<div style="margin-top:10px">'+legs+'</div>'+
    '<div class="stamp">Front minus next, in cents · negative = contango · Δ vs prior settle</div></div>';
}
function grainAlertsLiveHTML(key){
  var g=DATA.grains[key], f=g.fan, meta=GMETA[key], q=f.intraday[0], FL=fanLevels(g, meta), hits=[];
  var z=+f.z; if(Math.abs(z)>=2) hits.push(['Z-score '+f.z, 'Settle is beyond 2σ from its 20-day mean']);
  if(q<f.r10[0]||q>f.r10[1]) hits.push(['Outside 10-day 95% band', 'Quote '+money2(q)+' vs band '+f.r10[0].toFixed(2)+'–'+f.r10[1].toFixed(2)]);
  [['call wall',f.call_wall[0]],['put wall',f.put_wall[0]]].forEach(function(w){ if(Math.abs(q/w[1]-1)<0.01) hits.push(['Near the '+w[0], 'Quote '+money2(q)+' within 1% of $'+fmt(w[1],2)]); });
  var chg=(q/f.anchor-1)*100; if(Math.abs(chg)>=1.5) hits.push(['Big move vs settle', sgn(chg,2,'%')+' since the '+fmtShortDate(f.settle_date)+' settle']);
  var cards=hits.map(function(h){ return '<div class="alert"><div class="a-t">'+esc(h[0])+'</div><div class="a-sub">'+esc(h[1])+'</div></div>'; }).join('');
  var body=(cards||'<div class="checkline">No alert: quote inside the 10-day band, not within 1% of a wall, |z| under 2.</div>')+
    '<div class="checkline"><b>Level check:</b> '+esc(FL.read)+'.</div>'+
    '<div class="stamp">Rules: |z| ≥ 2 · quote outside the 10-day 95% band · within 1% of an options wall · ≥1.5% from settle · re-checked on every data refresh</div>';
  return railCard('Alerts', hits.length?'<b>'+esc(hits[0][0])+'</b> · '+esc(hits[0][1]):'No alert · quote '+money2(q)+' '+esc(f.intraday[1]), body, hits.length>0);
}


/* ================= GRAIN KPI DASHBOARD ================= */
var BU_PER_MT={corn:39.3679,soybeans:36.7437,wheat:36.7437};
var DASH_STATE={};   /* per grain: {crop:'new'|'old', view:'map'|'table', basis:'week'|'my'} */
function dstate(k){ return DASH_STATE[k]||(DASH_STATE[k]={crop:'new',view:'map',basis:'week'}); }
function hmsText(ms){ if(ms<=0) return 'now'; var t=Math.floor(ms/1000), d=Math.floor(t/86400), h=Math.floor(t%86400/3600), m=Math.floor(t%3600/60), sc=t%60;
  return (d?d+'d ':'')+String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sc).padStart(2,'0'); }
function sdRow(w,crop,lab){ var r=(w&&w[crop]&&w[crop].rows||[]).filter(function(x){return x[0]===lab;})[0]; return r?{prior:r[1],cur:r[2]}:{}; }
function fmtSD(lab,v){ if(v==null) return '—'; if(/Price/.test(lab)) return fmt(v,2); if(/^(Area|Yield)/.test(lab)) return fmt(v,1); return fmt(v,0); }
function chgSD(lab,a,b){ if(a==null||b==null) return '<span class="neu">—</span>'; var d=b-a, dec=/Price/.test(lab)?2:(/^(Area|Yield)/.test(lab)?1:0);
  if(Math.abs(d)<Math.pow(10,-dec)/2) return '<span class="neu">0</span>'; return '<span class="'+(d>0?'up':'dn')+'">'+sgn(d,dec)+'</span>'; }

function grainHeroHTML(key){
  var now=Date.now(), ev=usdaEvents(key, now, 60).filter(function(e){ return e.t>now; });
  var big=ev.filter(function(e){ return e.kind==='wasde'||e.kind==='contract'; })[0]||ev[0];
  var next=ev.filter(function(e){ return e!==big; }).slice(0,4);
  if(!big) return '';
  return '<div class="dash-card hero"><div class="dk">Next market-moving event</div>'+
    '<div class="hero-ev">'+esc(big.label)+(big.kind==='wasde'?' <span class="chip miss">HIGH</span>':big.kind==='contract'?' <span class="chip demo">CONTRACT</span>':'')+'</div>'+
    '<div class="hero-cd countdown" data-t="'+big.t+'" data-fmt="hms">'+hmsText(big.t-now)+'</div>'+
    '<div class="dsub">'+etLabel(big.t,true)+' ET</div>'+
    '<div class="hero-next">'+next.map(function(e){ return '<div><span>'+esc(e.label)+'</span><span class="countdown" data-t="'+e.t+'">'+cdText(e.t-now)+'</span></div>'; }).join('')+'</div></div>';
}
function grainBalanceHTML(key){
  var w=DATA.wasde&&DATA.wasde[key]; if(!w) return '';
  var es=sdRow(w,'new','Ending Stocks'), tu=sdRow(w,'new','Total Use'), pr=sdRow(w,'new','Production'), yl=sdRow(w,'new','Yield per Acre');
  var su=(es.cur!=null&&tu.cur)?es.cur/tu.cur*100:null, suP=(es.prior!=null&&tu.prior)?es.prior/tu.prior*100:null;
  return '<div class="dash-card"><div class="dk">New-crop balance · '+esc(w.new.my)+'</div>'+
    '<div class="dv">'+fmtSD('Ending Stocks',es.cur)+'<small> mil bu ending stocks</small></div>'+
    '<div class="dsub">'+chgSD('Ending Stocks',es.prior,es.cur)+' vs '+esc(w.prior_report)+' · stocks/use <b>'+(su!=null?fmt(su,1)+'%':'—')+'</b>'+(suP!=null&&su!=null?' ('+sgn(su-suP,1,' pp')+')':'')+'</div>'+
    '<div class="mini-kv"><span>Production</span><b>'+fmtSD('Production',pr.cur)+'</b> '+chgSD('Production',pr.prior,pr.cur)+'</div>'+
    '<div class="mini-kv"><span>Yield</span><b>'+fmtSD('Yield per Acre',yl.cur)+'</b> '+chgSD('Yield per Acre',yl.prior,yl.cur)+'</div>'+
    '<div class="dsub">USDA WASDE '+esc(w.report)+'</div></div>';
}
function grainPaceHTML(key){
  var E=(DATA.exports&&DATA.exports[key])||EXPORT[key], ds=E.dest, w=DATA.wasde&&DATA.wasde[key];
  var exp=sdRow(w,'new','Exports').cur, forecastMT=exp?exp*1e6/BU_PER_MT[key]:null;
  var last=E.weeks[E.weeks.length-1], prev=E.weeks[E.weeks.length-2];
  var body='<div class="dash-card"><div class="dk">Export pace · w/e '+fmtShortDate(last[0])+'</div>';
  if(ds&&ds.total&&forecastMT){
    var pct=ds.total.commit/forecastMT*100;
    body+='<div class="dv">'+fmt(pct,1)+'%<small> of USDA forecast committed</small></div>'+
      '<div class="pace-bar"><span style="width:'+Math.min(100,pct).toFixed(1)+'%"></span></div>'+
      '<div class="dsub">'+fmt(Math.round(ds.total.commit/1e5)/10,1)+' MMT committed vs '+fmt(Math.round(forecastMT/1e5)/10,1)+' MMT USDA ('+fmt(exp)+' mil bu)</div>';
  } else {
    body+='<div class="dv">'+fmt(Math.round(last[2]/1000))+'<small>k MT net sales</small></div>';
  }
  body+='<div class="mini-kv"><span>This week</span><b>'+fmt(Math.round(last[2]/1000))+'k MT</b> <span class="'+cls(last[2]-prev[2])+'">'+sgn(Math.round((last[2]-prev[2])/1000),0)+'k</span></div>';
  if(ds&&ds.top_week&&ds.top_week[0]) body+='<div class="mini-kv"><span>Top buyer</span><b>'+esc(niceCountry(ds.top_week[0].country))+'</b> '+fmt(Math.round(ds.top_week[0].net/1000))+'k MT</div>';
  return body+'</div>';
}
function wasdeTableHTML(key){
  var w=DATA.wasde&&DATA.wasde[key]; if(!w) return '';
  var st=dstate(key), c=w[st.crop];
  var rows=c.rows.map(function(r){ var bold=/^(Production|Total Supply|Total Use|Ending Stocks)$/.test(r[0]);
    return '<tr'+(bold?' class="sd-key"':'')+'><td class="lbl" data-l="">'+esc(r[0])+'</td><td data-l="'+esc(w.prior_report)+'">'+fmtSD(r[0],r[1])+'</td><td data-l="'+esc(w.report)+'"><b>'+fmtSD(r[0],r[2])+'</b></td><td data-l="Change">'+chgSD(r[0],r[1],r[2])+'</td></tr>'; }).join('');
  return '<div class="tile wide" data-src="wasde"><div class="tile-head"><h2>'+flag('us',15)+' US '+GMETA[key].name+' supply &amp; demand <span class="h2note">— USDA WASDE '+esc(w.report)+' (vs '+esc(w.prior_report)+')</span></h2>'+
    '<span class="toggle" role="group"><button data-dash="'+key+'" data-k="crop" data-v="new" aria-pressed="'+(st.crop==='new')+'">NEW CROP '+esc(w.new.my)+'</button><button data-dash="'+key+'" data-k="crop" data-v="old" aria-pressed="'+(st.crop==='old')+'">OLD CROP '+esc(w.old.my)+'</button></span></div>'+
    '<div class="dk" style="margin:4px 0 2px">Change vs '+esc(w.prior_report)+' · mil bu</div>'+divBarsHTML(c.rows.filter(function(r){ return /^(Production|Total Supply|Exports|Total Use|Ending Stocks)$/.test(r[0]) && r[1]!=null && r[2]!=null; }).map(function(r){ return [r[0], r[2]-r[1]]; }),0)+
    '<table class="sd-tbl"><thead><tr><th>Line item</th><th>'+esc(w.prior_report)+'</th><th>'+esc(w.report)+'</th><th>Change</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<div class="stamp">'+esc(w.unit_note)+' · '+esc(w.source)+(/PSD/.test(w.source)?' \u00b7 USDA PSD has no planted-area or farm-price line: those show \u2014 for the new month':'')+'</div></div>';
}
var GEO={ /* lon, lat of the main grain port/centroid per destination */
 "mexico":[-102,23],"japan":[138,36],"china":[104,35],"colombia":[-74,4.6],"korea, south":[127.8,36],"south korea":[127.8,36],"united kingdom":[-2,54],"singapore":[103.8,1.35],"taiwan":[121,23.7],
 "philippines":[122,12],"vietnam":[106,16],"indonesia":[113,-1],"thailand":[101,15],"malaysia":[102,4],"bangladesh":[90,24],"pakistan":[69,30],
 "egypt":[30,27],"morocco":[-6,32],"algeria":[3,28],"tunisia":[9,34],"nigeria":[8,9.5],"saudi arabia":[45,24],"yemen":[48,15.5],"iraq":[44,33],
 "israel":[35,31.5],"turkey":[35,39],"spain":[-3.7,40.4],"portugal":[-8,39.5],"italy":[12.5,42.5],"netherlands":[5.3,52.1],"germany":[10.4,51],
 "united kingdom":[-2,54],"ireland":[-8,53.4],"belgium":[4.5,50.5],"france":[2,46.5],"european union":[6,50],"canada":[-96,56],"guatemala":[-90.3,15.7],
 "honduras":[-86.5,15],"el salvador":[-88.9,13.8],"nicaragua":[-85.2,12.9],"costa rica":[-84,10],"panama":[-80,8.5],"dominican republic":[-70.2,18.7],
 "jamaica":[-77.3,18.1],"haiti":[-72.3,19],"cuba":[-79.5,21.5],"peru":[-75,-9],"ecuador":[-78.5,-1.8],"chile":[-71,-33],"venezuela":[-66.6,7],
 "brazil":[-51,-10],"argentina":[-64,-34],"guyana":[-58.9,4.9],"trinidad":[-61.2,10.4],"trinidad and tobago":[-61.2,10.4],"south africa":[24,-29],
 "kenya":[38,0.5],"ethiopia":[40,9],"sudan":[30,15],"senegal":[-14.5,14.5],"ghana":[-1,7.9],"cameroon":[12,6],"angola":[17.9,-11.2],"mozambique":[35,-18],
 "jordan":[36.2,31],"lebanon":[35.9,33.9],"united arab emirates":[54,24],"oman":[57,21],"kuwait":[47.5,29.3],"iran":[53,32],"sri lanka":[80.7,7.9],
 "india":[78,21],"myanmar":[96,21],"singapore":[103.8,1.35],"hong kong":[114.2,22.3],"australia":[134,-25],"new zealand":[174,-41],"russia":[90,60]
};
var US_ORIGIN={corn:[-90.1,29.9],soybeans:[-90.1,29.9],wheat:[-123,46]};  /* Gulf for corn/soy, PNW for wheat */
function niceCountry(n){ var m={"china, peoples republic of":"China","korea, republic of":"South Korea","korea, south":"South Korea","unknown":"Unknown destinations",
  "eu-27":"European Union","viet nam":"Vietnam","russian federation":"Russia","egypt, arab republic of":"Egypt","iran, islamic republic of":"Iran"};
  var k=(n||'').toLowerCase().trim(); return m[k]||n||''; }
function geoFor(name){ name=niceCountry(name); var n=(name||'').toLowerCase().replace(/\(.*?\)/g,'').replace(/\s+/g,' ').trim(); if(GEO[n]) return GEO[n];
  for(var k in GEO){ if(n.indexOf(k)===0||k.indexOf(n)===0) return GEO[k]; } return null; }
function destRows(key){ var E=(DATA.exports&&DATA.exports[key])||EXPORT[key], ds=E.dest; if(!ds) return null;
  var st=dstate(key); return {ds:ds, rows:(st.basis==='week'?ds.top_week:ds.top_my)||[]}; }
function destTableHTML(key){
  var d=destRows(key); if(!d) return '<p class="note">Destinations load from USDA export sales on the next refresh.</p>';
  var st=dstate(key), tot=st.basis==='week'?d.ds.total.net:d.ds.total.commit;
  return '<table class="dest-tbl"><thead><tr><th>#</th><th>Destination</th><th>This week</th><th>Prior week</th><th>Δ w/w</th><th>MY commitments</th><th>Shipped</th><th>Share</th></tr></thead><tbody>'+
    d.rows.map(function(r,i){ var dlt=r.net-r.prev, sh=r.commit?r.shipped/r.commit*100:null, share=tot?(st.basis==='week'?r.net:r.commit)/tot*100:null;
      return '<tr><td data-l="#">'+(i+1)+'</td><td class="lbl" data-l="">'+esc(niceCountry(r.country))+'</td><td data-l="This week"><b>'+fmt(Math.round(r.net))+'</b></td><td data-l="Prior week">'+fmt(Math.round(r.prev))+'</td>'+
        '<td data-l="Δ w/w"><span class="'+cls(dlt)+'">'+sgn(Math.round(dlt),0)+'</span></td><td data-l="MY commitments">'+fmt(Math.round(r.commit))+'</td><td data-l="Shipped">'+(sh!=null?fmt(sh,0)+'%':'—')+'</td><td data-l="Share">'+(share!=null?fmt(share,1)+'%':'—')+'</td></tr>'; }).join('')+
    '</tbody></table>';
}
function destTileHTML(key){
  var st=dstate(key), d=destRows(key), E=(DATA.exports&&DATA.exports[key])||EXPORT[key];
  var wk=d?fmtDate(d.ds.week):fmtDate(E.weeks[E.weeks.length-1][0]);
  var tot=d?(st.basis==='week'?d.ds.total.net:d.ds.total.commit):null;
  return '<div class="tile wide" data-src="exports"><div class="tile-head"><h2>'+flag('us',15)+' Export destinations <span class="h2note">— USDA export sales, week ending '+wk+(tot!=null?' · '+(st.basis==='week'?'net sales ':'MY commitments ')+fmt(Math.round(tot/1000))+'k MT':'')+'</span></h2>'+
    '<span class="toggle" role="group"><button data-dash="'+key+'" data-k="basis" data-v="week" aria-pressed="'+(st.basis==='week')+'">THIS WEEK</button><button data-dash="'+key+'" data-k="basis" data-v="my" aria-pressed="'+(st.basis==='my')+'">MARKETING YEAR</button></span>'+
    '<span class="toggle" role="group"><button data-dash="'+key+'" data-k="view" data-v="map" aria-pressed="'+(st.view==='map')+'">MAP</button><button data-dash="'+key+'" data-k="view" data-v="table" aria-pressed="'+(st.view==='table')+'">TABLE</button></span></div>'+
    (st.view==='map'?'<div class="dest-map" id="destmap-'+key+'" data-grain="'+key+'"><div class="note">Loading map…</div></div>':destTableHTML(key))+
    '<div class="stamp">Metric tons · source USDA FAS Export Sales (ESR) by destination · "Unknown destinations" are sales not yet allocated to a country · arcs from the Gulf (corn, soybeans) / Pacific Northwest (wheat), width ∝ volume</div></div>';
}
/* ---- animated flow map (d3 + world atlas loaded on first use) ---- */
var MAPLIB=null;
function loadScript(src){ return new Promise(function(ok,bad){ var s=document.createElement('script'); s.src=src; s.onload=ok; s.onerror=bad; document.head.appendChild(s); }); }
function mapLibs(){ if(MAPLIB) return MAPLIB;
  MAPLIB=loadScript('https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js').then(function(){ return loadScript('https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js'); })
    .then(function(){ return fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json').then(function(r){ return r.json(); }); })
    .then(function(topo){ return topojson.feature(topo, topo.objects.countries); });
  MAPLIB.catch(function(){ MAPLIB=null; }); return MAPLIB; }
function placeLabel(placed,x,y,w,W){   /* simple collision avoidance: try below/above offsets, skip if crowded */
  var tries=[[0,0],[0,14],[0,-14],[0,28],[0,-28],[-w-14,0]];
  for(var i=0;i<tries.length;i++){ var bx=Math.min(Math.max(4,x+tries[i][0]),W-w-4), by=y+tries[i][1], hit=false;
    for(var j=0;j<placed.length;j++){ var q=placed[j]; if(bx<q[0]+q[2]+4 && bx+w+4>q[0] && by-11<q[1]+q[3] && by+4>q[1]){ hit=true; break; } }
    if(!hit){ placed.push([bx,by-11,w,15]); return [bx,by]; } }
  return null;
}
function drawDestMaps(){
  document.querySelectorAll('.dest-map[data-grain]').forEach(function(el){
    var key=el.getAttribute('data-grain'), d=destRows(key);
    if(!d){ el.innerHTML='<p class="note">Destinations load from USDA export sales on the next refresh.</p>'; return; }
    mapLibs().then(function(world){
      var W=760,H=380, st=dstate(key), val=function(r){ return st.basis==='week'?r.net:r.commit; };
      var proj=d3.geoNaturalEarth1().rotate([150,0]).fitExtent([[6,6],[W-6,H-6]],{type:'Sphere'}), path=d3.geoPath(proj);
      var rows=d.rows.filter(function(r){ return val(r)>0 && geoFor(r.country); }), mx=d3.max(rows,val)||1, org=US_ORIGIN[key];
      var o0=proj(org), placed=o0?[[o0[0]-62,o0[1]-22,58,16]]:[];   /* reserve the origin label spot */
      var svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Export flows by destination"><path d="'+path({type:'Sphere'})+'" fill="#0d141f"/>'+
        world.features.map(function(f){ return '<path d="'+path(f)+'" fill="#1a2433" stroke="#0a0f16" stroke-width=".5"/>'; }).join('');
      rows.forEach(function(r,i){ var g=geoFor(r.country), line={type:'LineString',coordinates:d3.range(0,1.0001,0.05).map(d3.geoInterpolate(org,g))};
        var wdt=1.2+5*Math.sqrt(val(r)/mx), col=key==='corn'?'#e8a33d':key==='wheat'?'#d97b4f':'#3fb97f';
        svg+='<path class="flow" d="'+path(line)+'" fill="none" stroke="'+col+'" stroke-width="'+wdt.toFixed(1)+'" stroke-linecap="round" style="animation-delay:'+(i*0.18).toFixed(2)+'s"/>';
        var p=proj(g); if(p){ svg+='<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="'+(2+wdt/2).toFixed(1)+'" fill="'+col+'" class="dest-dot" style="animation-delay:'+(i*0.18+1.1).toFixed(2)+'s"/>';
          if(i<8){ var txt=niceCountry(r.country)+' '+fmt(Math.round(val(r)/1000))+'k', tw=txt.length*6.6, box=placeLabel(placed,p[0]+7,p[1]-4,tw,W);
            if(box) svg+='<rect x="'+(box[0]-3).toFixed(1)+'" y="'+(box[1]-11).toFixed(1)+'" width="'+(tw+6).toFixed(1)+'" height="15" rx="3" fill="#0a0f16" opacity=".75" class="dest-lbl" style="animation-delay:'+(i*0.18+1.1).toFixed(2)+'s"/><text x="'+box[0].toFixed(1)+'" y="'+box[1].toFixed(1)+'" fill="#e8eef4" font-size="11" font-family="IBM Plex Mono" class="dest-lbl" style="animation-delay:'+(i*0.18+1.1).toFixed(2)+'s">'+esc(txt)+'</text>'; } } });
      var o=proj(org); if(o){ svg+='<circle cx="'+o[0].toFixed(1)+'" cy="'+o[1].toFixed(1)+'" r="5" fill="#fff"/>'; var ob=placeLabel(placed,o[0]-60,o[1]-10,54,W); if(ob) svg+='<text x="'+ob[0].toFixed(1)+'" y="'+ob[1].toFixed(1)+'" fill="#fff" font-size="11" font-weight="700" font-family="IBM Plex Mono">US '+(key==='wheat'?'PNW':'Gulf')+'</text>'; }
      svg+='</svg>';
      var side='<div class="map-side">'+d.rows.slice(0,8).map(function(r){ return '<div><span>'+esc(niceCountry(r.country))+'</span><b>'+fmt(Math.round(val(r)/1000))+'k</b></div>'; }).join('')+'</div>';
      el.innerHTML='<div class="map-wrap">'+svg+side+'</div>';
    }).catch(function(){ el.innerHTML='<p class="note">Map library could not load — showing the table.</p>'+destTableHTML(key); });
  });
}
/* ---- Ask Claude about this dashboard ---- */
function grainContext(key){
  var g=DATA.grains[key], f=g.fan, meta=GMETA[key], w=DATA.wasde&&DATA.wasde[key], E=(DATA.exports&&DATA.exports[key])||EXPORT[key], ds=E.dest, c=g.cftc[g.cftc.length-1];
  var L=['DASHBOARD SNAPSHOT — '+meta.name+' ('+meta.contract+'), '+new Date().toLocaleString('en-US',{timeZone:'America/Toronto'})+' ET',
    'Delayed quote '+f.intraday[0]+' ('+f.intraday[1]+'); settle '+f.anchor+' ('+f.settle_date+'); z '+f.z+'; MA20/50/100 '+f.ma20+'/'+f.ma50+'/'+(f.ma100||'n/a')+'; daily sigma '+(+f.sig).toFixed(4)+'; 10-day 95% band '+f.r10.join('-'),
    'Options '+meta.chainNear+': P/C '+f.pcr+', call wall '+f.call_wall[0]+' ('+f.call_wall[1]+'), put wall '+f.put_wall[0]+' ('+f.put_wall[1]+'), chain IV '+f.iv_chain_iv+'%',
    'CFTC managed money net '+c.net+' ('+c.date+')',
    'Curve: '+g.roll.map(function(r){ return r.contract+' '+r.settle; }).join(', ')];
  if(w){ ['new','old'].forEach(function(cr){ L.push('WASDE '+w.report+' vs '+w.prior_report+' '+w[cr].my+': '+w[cr].rows.map(function(r){ return r[0]+' '+(r[1]==null?'-':r[1])+'->'+(r[2]==null?'-':r[2]); }).join('; ')); }); }
  L.push('Export sales last 10 weeks (MT, week ending: net sales): '+E.weeks.map(function(x){ return x[0].slice(5)+':'+x[2]+(x[3]!=null?' [est '+x[3]+'-'+x[4]+']':''); }).join(', '));
  if(ds){ L.push('Top destinations w/e '+ds.week+' (net / prior wk / MY commitment): '+ds.top_week.slice(0,6).map(function(r){ return r.country+' '+r.net+'/'+r.prev+'/'+r.commit; }).join('; ')); L.push('Total MY commitments '+ds.total.commit+' MT'); }
  var CA=canadaContext(key); if(CA) L.push(CA);
  L.push('Upcoming: '+usdaEvents(key,Date.now(),21).filter(function(e){ return e.t>Date.now(); }).slice(0,6).map(function(e){ return e.label+' '+etLabel(e.t,true); }).join('; '));
  return L.join('\n');
}
function fxContext(){
  var fx=DATA.fx, R={}; fx.rates.forEach(function(r){ R[r.t]=r; });
  return ['DASHBOARD SNAPSHOT — USD/CAD, '+new Date().toLocaleString('en-US',{timeZone:'America/Toronto'})+' ET',
    'Spot '+fx.feed.mid+' (prior close '+fx.spot.ref+'); pivot '+fx.levels.pivot+'; 20D range '+fx.levels.s20+'-'+fx.levels.r20,
    'US-CA spreads (bps): '+fx.rates.map(function(r){ return r.t+' '+r.sp+' (d/d '+r.dod+', w/w '+r.wow+')'; }).join('; '),
    'CFTC CAD lev funds net '+fx.pos.net+' ('+fx.pos.pct_oi+'% OI, '+fx.pos.label+')',
    'Oil: '+fx.energy.map(function(e){ return e.name+' '+e.last+' ('+e.pct+'%)'; }).join('; ')+'; WTI-WCS '+fx.wcs_diff.value,
    'Policy: Fed '+fx.policy.fed_range+', BoC '+fx.policy.corra_now+'%; model bias '+fx.bias.label,
    'Macro: '+(DATA.macro||[]).map(function(m){ return m.group.toUpperCase()+' '+m.name+' '+m.value+m.unit+' ('+(m.chg>0?'+':'')+m.chg+')'; }).join('; '),
    'High-impact events: '+fx.events.filter(function(e){ return e.impact==='High'; }).map(function(e){ return e.ccy+' '+e.event+' '+etLabel(evEpoch(e),true); }).join('; ')].join('\n');
}
function askTileHTML(scope){
  var chips=scope==='fx'?['What is driving USD/CAD this week?','How do the BoC and Fed decisions on Oct 28 set up?','Where are support and resistance today?']
    :['Is the export pace on track for the USDA forecast?','What does the latest WASDE change mean for price?','Who are the key buyers and what changed this week?','Where are support and resistance from options and the fan?'];
  return '<div class="tile wide ask-tile"><h2>Ask Claude about this dashboard <span class="h2note">— your question plus the live numbers on this tab</span></h2>'+
    '<div class="ask-chips">'+chips.map(function(c){ return '<button type="button" class="ask-chip" data-ask="'+scope+'">'+esc(c)+'</button>'; }).join('')+'</div>'+
    '<div class="ask-row"><textarea id="ask-'+scope+'" rows="2" placeholder="e.g. Should a merchant hedge more of the Jan basis given this export pace?"></textarea>'+
    '<button type="button" class="ask-go" data-ask-go="'+scope+'">Ask Claude ↗</button></div>'+
    '<div class="note">Opens Claude in a new tab with the question and a snapshot of this tab’s data (copied to your clipboard too, in case it doesn’t prefill). Analysis, not trading advice.</div></div>';
}
function askClaude(scope){
  var q=(document.getElementById('ask-'+scope)||{}).value||'';
  if(!q.trim()) q=scope==='fx'?'Give me a trader’s read of USD/CAD from this snapshot.':'Give me a trader’s read of this market from this snapshot.';
  var ctx=scope==='fx'?fxContext():grainContext(scope);
  var prompt='You are helping a grain merchant / FX trader at an Ontario grain company read their desk dashboard. Use only the snapshot below plus general market knowledge; say what is uncertain.\n\nQUESTION: '+q.trim()+'\n\n'+ctx;
  if(prompt.length>7000) prompt=prompt.slice(0,7000)+'\n[snapshot truncated]';
  try{ if(navigator.clipboard) navigator.clipboard.writeText(prompt).catch(function(){}); }catch(e){}
  window.open('https://claude.ai/new?q='+encodeURIComponent(prompt),'_blank','noopener');
}
function grainDashboardHTML(key){
  return '<div class="tile wide dash-head" data-src="model"><h2>'+GMETA[key].name+' KPI dashboard <span class="h2note">— countdown, balance sheet, export pace</span></h2>'+
    '<div class="dash-grid">'+grainHeroHTML(key)+grainBalanceHTML(key)+grainPaceHTML(key)+'</div></div>'+
    '';
}

/* ================= CANADA · ONTARIO (Statistics Canada) ================= */
var SC_LINKS={annual:["32-10-0359-01","3210035901","Estimated areas, yield, production, average farm price and total farm value of principal field crops"],
  prices:["32-10-0077-01","3210007701","Monthly average farm prices for crops"],
  stocks:["32-10-0007-01","3210000701","Stocks of principal field crops at March 31, July 31 and December 31"]};
function scLink(k){ var L=SC_LINKS[k]; return '<span title="'+esc(L[2])+'">Table '+L[0]+'</span>'; }
function caState(key){ var s=dstate(key); if(!s.ca_geo){ s.ca_geo='Ontario'; s.ca_view='avg'; s.ca_unit='imp'; } return s; }
function caAvg(arr, from, to){ var v=arr.slice(Math.max(0,from), to).filter(function(x){ return x!=null; }); return v.length?v.reduce(function(a,b){return a+b;},0)/v.length:null; }
/* each measure: label, getter(annual,i) in display units for imperial/metric, decimals */
function caMeasures(key, unit){
  var bpm=BU_PER_MT[key], imp=unit==='imp';
  function col(a,f){ return a[f]||[]; }
  return [
    {l:'Seeded area', u:imp?'k acres':'k ha', d:0, v:function(a){ return col(a,imp?'seeded_ac':'seeded_ha').map(function(x){ return x==null?null:x/1000; }); }},
    {l:'Harvested area', u:imp?'k acres':'k ha', d:0, v:function(a){ return col(a,imp?'harv_ac':'harv_ha').map(function(x){ return x==null?null:x/1000; }); }},
    {l:'Yield', u:imp?'bu/ac':'t/ha', d:imp?1:2, key:true, v:function(a){ return imp?col(a,'yield_bu'):col(a,'yield_kg').map(function(x){ return x==null?null:x/1000; }); }},
    {l:'Production', u:imp?'mil bu':'MMT', d:imp?1:2, key:true, v:function(a){ return imp?col(a,'prod_bu').map(function(x){ return x==null?null:x/1000; }):col(a,'prod_t').map(function(x){ return x==null?null:x/1e6; }); }},
    {l:'Avg farm price', u:imp?'C$/bu':'C$/t', d:2, v:function(a){ return col(a,'price_t').map(function(x){ return x==null?null:(imp?x/bpm:x); }); }},
    {l:'Total farm value', u:'C$ mil', d:0, v:function(a){ return col(a,'value').map(function(x){ return x==null?null:x/1000; }); }}
  ];
}
function caPct(a,b){ return (a==null||b==null||!b)?null:(a/b-1)*100; }
function caPctHTML(p){ return p==null?'<span class="neu">—</span>':'<span class="'+cls(p)+'">'+sgn(p,1,'%')+'</span>'; }
function caFmt(v,d){ return v==null?'—':fmt(v,d); }
function caLatestIdx(arr){ for(var i=arr.length-1;i>=0;i--) if(arr[i]!=null) return i; return -1; }
function caPriceSeries(C, geo){ var p=C.prices&&(C.prices[geo]||C.prices.Canada); return p&&p.series&&p.series.length?p:null; }
function canadaCardsHTML(key){
  var C=DATA.canada&&DATA.canada[key], st=caState(key), A=C&&C.annual&&C.annual[st.ca_geo]; if(!A) return '';
  var M=caMeasures(key, st.ca_unit), yrs=A.years, prod=M[3].v(A), yl=M[2].v(A), area=M[0].v(A);
  var i=caLatestIdx(prod), y=yrs[i], est=(+y>=new Date().getFullYear());
  var p5=caAvg(prod,i-5,i), y5=caAvg(yl,i-5,i), a5=caAvg(area,i-5,i);
  var out='<div class="dash-card"><div class="dk">'+esc(st.ca_geo)+' production · '+esc(y)+(est?' est.':'')+'</div>'+
    '<div class="dv">'+caFmt(prod[i],M[3].d)+'<small> '+M[3].u+'</small></div>'+
    '<div class="dsub">'+caPctHTML(caPct(prod[i],prod[i-1]))+' vs '+esc(yrs[i-1])+' · '+caPctHTML(caPct(prod[i],p5))+' vs 5-yr avg</div>'+
    '<div class="mini-kv"><span>Yield</span><b>'+caFmt(yl[i],M[2].d)+' '+M[2].u+'</b> '+caPctHTML(caPct(yl[i],y5))+' vs 5-yr</div>'+
    '<div class="mini-kv"><span>Seeded</span><b>'+caFmt(area[i],0)+' '+M[0].u+'</b> '+caPctHTML(caPct(area[i],a5))+' vs 5-yr</div>'+
    sparkPath(prod.slice(Math.max(0,i-9),i+1).filter(function(x){return x!=null;}),160,26)+'</div>';
  /* monthly farm price + futures in CAD */
  var P=caPriceSeries(C, st.ca_geo), bpm=BU_PER_MT[key], imp=st.ca_unit==='imp', ufac=imp?1/bpm:1, uu=imp?'C$/bu':'C$/t';
  var g=DATA.grains[key], fut=g&&g.fan&&+g.fan.intraday[0], fx=DATA.fx&&DATA.fx.feed&&+DATA.fx.feed.mid;
  var futCad=(fut&&fx)?fut*bpm*fx:null;
  out+='<div class="dash-card"><div class="dk">Farm price'+(P?' · '+esc(P.series[P.series.length-1][0])+(P!==(C.prices||{})[st.ca_geo]?' (Canada)':''):'')+'</div>';
  if(P){ var s=P.series, L=s[s.length-1][1], prev=s.length>1?s[s.length-2][1]:null, yago=s.length>12?s[s.length-13][1]:null;
    out+='<div class="dv">'+fmt(L*ufac,2)+'<small> '+uu+'</small></div>'+
      '<div class="dsub">'+caPctHTML(caPct(L,prev))+' m/m · '+caPctHTML(caPct(L,yago))+' y/y</div>';
    if(futCad) out+='<div class="mini-kv"><span>CBOT in C$</span><b>'+fmt(futCad*ufac,2)+'</b> '+esc(GMETA[key].contract)+' @ '+fmt(fx,4)+'</div>'+
      '<div class="mini-kv"><span>Farm − futures</span><b class="'+cls(L-futCad)+'">'+sgn((L-futCad)*ufac,2)+'</b> indicative</div>';
    out+=sparkPath(s.slice(-24).map(function(x){return x[1];}),160,26);
  } else {
    out+='<div class="dv">—</div><div class="dsub">StatCan has not published a monthly '+esc(GMETA[key].name.toLowerCase())+' price for '+esc(st.ca_geo)+'</div>';
    if(futCad) out+='<div class="mini-kv"><span>CBOT in C$</span><b>'+fmt(futCad*ufac,2)+' '+uu+'</b> @ '+fmt(fx,4)+'</div>';
  }
  out+='</div>';
  /* stocks */
  var S=C.stocks&&C.stocks[st.ca_geo];
  out+='<div class="dash-card"><div class="dk">'+esc(st.ca_geo)+' stocks</div>';
  if(S&&S.length){ var last=S[S.length-1], tot=function(o){ return o['Farm and commercial, total']!=null?o['Farm and commercial, total']:o['Farm stocks']; };
    var conv=function(kt){ return imp?kt*1000*bpm/1e6:kt/1000; }, su=imp?'mil bu':'MMT';
    var same=S.filter(function(x){ return x[0].slice(5)===last[0].slice(5); }), ly=same.length>1?same[same.length-2]:null;
    out+='<div class="dv">'+fmt(conv(tot(last[1])),imp?1:2)+'<small> '+su+' · '+esc(last[0])+'</small></div>'+
      '<div class="dsub">'+(ly?caPctHTML(caPct(tot(last[1]),tot(ly[1])))+' vs '+esc(ly[0]):'')+(last[1]['Farm and commercial, total']!=null?' · farm + commercial':' · farm stocks only (commercial not split by province)')+'</div>';
    if(last[1]['Farm stocks']!=null&&last[1]['Commercial stocks']!=null) out+='<div class="mini-kv"><span>Farm</span><b>'+fmt(conv(last[1]['Farm stocks']),imp?1:2)+'</b> Commercial <b>'+fmt(conv(last[1]['Commercial stocks']),imp?1:2)+'</b></div>';
    var pv=S[S.length-2]; if(pv) out+='<div class="mini-kv"><span>Prior ('+esc(pv[0])+')</span><b>'+fmt(conv(tot(pv[1])),imp?1:2)+'</b> '+su+'</div>';
  } else out+='<div class="dv">—</div><div class="dsub">No stocks series</div>';
  return out+'</div>';
}
function canadaTableHTML(key){
  var C=DATA.canada&&DATA.canada[key], st=caState(key), A=C&&C.annual&&C.annual[st.ca_geo]; if(!A) return '';
  var M=caMeasures(key, st.ca_unit).map(function(m){ m.s=m.v(A); return m; }).filter(function(m){ return m.s.some(function(x){ return x!=null; }); });
  var yrs=A.years, i=caLatestIdx(M[0].s);
  M.forEach(function(m){ var j=caLatestIdx(m.s); if(j>i) i=j; });
  var html;
  if(st.ca_view==='avg'){
    html='<table class="sd-tbl"><thead><tr><th>Measure</th><th>'+esc(yrs[i])+'</th><th>'+esc(yrs[i-1])+'</th><th>5-yr avg<br><small>'+esc(yrs[Math.max(0,i-5)])+'–'+esc(yrs[i-1])+'</small></th><th>10-yr avg<br><small>'+esc(yrs[Math.max(0,i-10)])+'–'+esc(yrs[i-1])+'</small></th><th>vs 5-yr</th><th>vs 10-yr</th></tr></thead><tbody>'+
      M.map(function(m){ var a5=caAvg(m.s,i-5,i), a10=caAvg(m.s,i-10,i);
        return '<tr'+(m.key?' class="sd-key"':'')+'><td class="lbl" data-l="">'+esc(m.l)+' <small class="h2note">'+m.u+'</small></td><td data-l="'+esc(yrs[i])+'"><b>'+caFmt(m.s[i],m.d)+'</b></td><td data-l="'+esc(yrs[i-1])+'">'+caFmt(m.s[i-1],m.d)+'</td><td data-l="5-yr avg">'+caFmt(a5,m.d)+'</td><td data-l="10-yr avg">'+caFmt(a10,m.d)+'</td><td data-l="vs 5-yr">'+caPctHTML(caPct(m.s[i],a5))+'</td><td data-l="vs 10-yr">'+caPctHTML(caPct(m.s[i],a10))+'</td></tr>'; }).join('')+'</tbody></table>';
  } else {
    var rows=[]; for(var j=i;j>=Math.max(0,i-9);j--) rows.push(j);
    html='<div class="tbl-scroll"><table class="sd-tbl"><thead><tr><th>Year</th>'+M.map(function(m){ return '<th>'+esc(m.l)+'<br><small>'+m.u+'</small></th>'; }).join('')+'</tr></thead><tbody>'+
      rows.map(function(j){ return '<tr><td class="lbl" data-l="">'+esc(yrs[j])+'</td>'+M.map(function(m){ var a5=caAvg(m.s,j-5,j), p=caPct(m.s[j],a5);
        return '<td data-l="'+esc(m.l)+'">'+(m.key?'<b>':'')+caFmt(m.s[j],m.d)+(m.key?'</b>':'')+(m.key&&p!=null?' <small class="'+cls(Math.round(p))+'">'+(Math.round(p)?sgn(Math.round(p),0,'%'):'0%')+'</small>':'')+'</td>'; }).join('')+'</tr>'; }).join('')+'</tbody></table></div>';
  }
  return html;
}
function canadaTileHTML(key, embedded){
  var C=DATA.canada&&DATA.canada[key]; if(!C||!C.annual) return '';
  var st=caState(key), b=function(k,v,lab){ return '<button data-dash="'+key+'" data-k="'+k+'" data-v="'+v+'" aria-pressed="'+(st[k]===v)+'">'+lab+'</button>'; };
  var y=new Date().getFullYear(), A=C.annual[st.ca_geo], latest=A&&A.years[A.years.length-1];
  return '<div class="tile wide" data-src="canada"><div class="tile-head"><h2>'+flag('ca',15)+' '+(st.ca_geo==='Canada'?'Canada':'Canada · Ontario')+' '+GMETA[key].name.toLowerCase()+' <span class="h2note">— Statistics Canada official estimates'+(st.ca_view==='years'?' · last 10 crop years':'')+'</span></h2>'+
    (embedded?'':'<span class="toggle" role="group">'+b('ca_geo','Ontario','ONTARIO')+b('ca_geo','Canada','CANADA')+'</span>')+
    '<span class="toggle" role="group">'+b('ca_view','avg','HISTORICAL AVERAGES')+b('ca_view','years','YEAR BY YEAR')+'</span>'+
    '<span class="toggle" role="group">'+b('ca_unit','imp','BU · AC')+b('ca_unit','met','T · HA')+'</span></div>'+
    '<div class="dash-grid">'+canadaCardsHTML(key)+'</div>'+
    '<div style="margin-top:10px">'+canadaTableHTML(key)+'</div>'+
    '<div class="stamp">Sources: '+scLink('annual')+' (area, yield, production, farm price/value) · '+scLink('prices')+' (monthly farm price) · '+scLink('stocks')+' (stocks)'+
    (latest&&+latest>=y?' · '+esc(latest)+' figures are StatCan in-season estimates; the final Field Crop Survey lands in early December':'')+
    ' · averages are the 5/10 crop years before the latest · "Farm − futures" compares the latest monthly farm price with today’s CBOT quote converted at live USD/CAD — indicative only, not a cash bid · checked '+esc(asOf('canada',true))+'</div></div>';
}
function canadaContext(key){
  var C=DATA.canada&&DATA.canada[key]; if(!C||!C.annual) return '';
  var L=[];
  ['Ontario','Canada'].forEach(function(geo){ var A=C.annual[geo]; if(!A) return; var n=A.years.length, s=Math.max(0,n-11);
    L.push('StatCan '+geo+' '+key+' by year '+A.years.slice(s).join('/')+': yield bu/ac '+A.yield_bu.slice(s).join('/')+'; production thousand bu '+A.prod_bu.slice(s).join('/')+'; seeded acres '+A.seeded_ac.slice(s).join('/'));
    var P=C.prices&&C.prices[geo]; if(P) L.push('StatCan '+geo+' monthly farm price C$/t ('+P.product+'): '+P.series.slice(-13).map(function(x){ return x[0]+' '+x[1]; }).join(', '));
    var S=C.stocks&&C.stocks[geo]; if(S) L.push('StatCan '+geo+' stocks (thousand t): '+S.slice(-4).map(function(x){ return x[0]+' '+JSON.stringify(x[1]); }).join('; '));
  });
  return L.join('\n');
}

/* ================= SUB-TABS + COUNTDOWN STRIP ================= */
var SUB=(function(){ var d={corn:'overview',wheat:'overview',soybeans:'overview',fx:'overview',macro:'dash'}; try{ var s=JSON.parse(localStorage.getItem('desk.sub')||'{}'); Object.keys(d).forEach(function(k){ if(s[k]) d[k]=s[k]; }); }catch(e){} if(d.fx==='macro') d.fx='overview'; return d; })();   /* Macro moved to its own tab */
var MGEO='both';
function saveSub(){ try{ localStorage.setItem('desk.sub', JSON.stringify(SUB)); }catch(e){} }
function subWrap(panel, id, html){ return '<div class="sub'+(SUB[panel]===id?' on':'')+'" data-subpanel="'+id+'">'+html+'</div>'; }
function nextOf(list, test){ var now=Date.now(); return list.filter(function(e){ return e.t>now && (!test||test(e)); }).sort(function(a,b){ return a.t-b.t; })[0]||null; }
function subnavHTML(panel, tabs, liveHTML){
  var now=Date.now();
  return '<div class="tile wide subnav-tile"><div class="subnav-live">'+liveHTML+'</div><div class="subnav" role="tablist">'+tabs.map(function(t){
    var e=t.ev;
    return '<button class="subbtn" role="tab" style="--tc:'+((typeof SUBTHEME!=='undefined'&&SUBTHEME[t.id])||'#38b6c9')+'" data-sub="'+t.id+'" data-subp="'+panel+'" aria-selected="'+(SUB[panel]===t.id)+'">'+
      '<span class="sb-name">'+t.label+'</span>'+
      (e?'<span class="sb-ev">'+esc(e.label)+'</span><span class="sb-cd"><span class="countdown" data-t="'+e.t+'" data-fmt="hms">'+hmsText(e.t-now)+'</span><span class="sb-date"> · '+etLabel(e.t,true)+'</span></span>':'<span class="sb-ev">No scheduled event</span><span class="sb-cd">&nbsp;</span>')+
    '</button>'; }).join('')+'</div></div>';
}
function setSub(panel, id){
  SUB[panel]=id; saveSub();
  var P=document.getElementById('panel-'+panel); if(!P) return;
  P.querySelectorAll('[data-subpanel]').forEach(function(s){ s.classList.toggle('on', s.getAttribute('data-subpanel')===id); });
  P.querySelectorAll('[data-sub]').forEach(function(b){ b.setAttribute('aria-selected', b.getAttribute('data-sub')===id?'true':'false'); });
  if(panel!=='fx'&&panel!=='macro') drawDestMaps();
}
document.addEventListener('click', function(ev){
  var t=ev.target.closest?ev.target:null; if(!t) return;
  var b=t.closest('[data-sub]'); if(b){ setSub(b.getAttribute('data-subp'), b.getAttribute('data-sub')); return; }
  var g=t.closest('[data-mgeo]'); if(g){ MGEO=g.getAttribute('data-mgeo'); renderFX(); renderMacro(); }
});

/* ---------- Canada / Ontario agri calendar (AAFC + StatCan, from data.json) ---------- */
function caEvents(fromMs, days){
  var C=DATA.ca_calendar; if(!C||!C.events) return [];
  return C.events.map(function(e){ var p=e.date.split('-'), hm=(e.time||'12:00').split(':');
      return {t:zonedMs(+p[0],+p[1],+p[2],+hm[0],+hm[1],'America/Toronto'), label:e.label+(e.time?'':' (time TBA)'), kind:'ca', src:'ca', quote:e.quote, tables:e.tables}; })
    .filter(function(e){ return e.t>=fromMs-6*3600000 && e.t<=fromMs+days*86400000; }).sort(function(a,b){ return a.t-b.t; });
}
function caCalendarHTML(){
  var C=DATA.ca_calendar||{}, now=Date.now(), ev=caEvents(now-20*86400000, 150), m=DATA.meta||{};
  var rows=ev.map(function(e){ var past=e.t<now;
    return '<div class="kv'+(past?' ev-past':'')+'" title="'+esc(e.quote||'')+'"><span class="kk">'+etLabel(e.t,true)+' · '+esc(e.label)+' <span class="chip inline">'+(e.src==='ca'&&/StatCan/.test(e.label)?'STATCAN':'AAFC')+'</span>'+(past?' <span class="chip inline">'+(/AAFC/.test(e.label)&&C.report&&C.report<new Date(e.t).toISOString().slice(0,10)?'AWAITING POST':'OUT')+'</span>':'')+'</span>'+
      '<span class="vv">'+(past?'':'<span class="countdown" data-t="'+e.t+'">'+cdText(e.t-now)+'</span>')+'</span></div>'; }).join('')||'<div class="checkline">No dated Canadian releases announced yet.</div>';
  var nr=m.canada_new_release;
  return '<div class="tile wide" data-src="ca_calendar"><h2>'+flag('ca',15)+' Canada &amp; Ontario agri calendar <span class="h2note">— dates taken from AAFC’s latest Outlook ('+esc(C.report||'n/a')+') · StatCan tables watched for new releases</span></h2>'+rows+
    '<div class="mini-kv" style="margin-top:8px"><span>Release watch</span><b>'+(m.canada_watch?'checked '+esc(asOf('canada',true)):'starts on the next refresh')+'</b>'+(nr?' · last new StatCan data '+esc(new Date(nr.at).toLocaleString('en-US',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))+' ET ('+esc(nr.tables.join(', '))+')':'')+'</div>'+
    '<div class="stamp">The updater checks Statistics Canada’s table metadata on every 15-minute run (8:30 ET release days included) and re-pulls tables 32-10-0359 / 0077 / 0007 the moment their release time changes · AAFC dates parsed from the Outlook report; hover a row for the source sentence</div></div>';
}

/* ---------- generic charts ---------- */
function niceTicks(lo, hi, n){ var span=hi-lo||1, step=Math.pow(10,Math.floor(Math.log10(span/n))), err=span/n/step; step*=err>=7.5?10:err>=3.5?5:err>=1.5?2:1;
  var out=[]; for(var v=Math.ceil(lo/step)*step; v<=hi+1e-9; v+=step) out.push(+v.toFixed(10)); return out; }
function mLabel(iso){ var M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return M[+iso.slice(5,7)-1]+" '"+iso.slice(2,4); }
/* line chart: o={series:[{pts:[[iso,v]],color,label,width}], refs:[{v,label,color,dash}], yLabel, dec, W, H, aria} — direct labels at the right edge */
function lineChartSVG(o){
  var W=o.W||480, H=o.H||220, PL=44, PR=112, PT=(o.events&&o.events.length)?24:14, PB=30, pw=W-PL-PR, ph=H-PT-PB, dec=o.dec==null?1:o.dec;
  var xs=o.series[0].pts.map(function(p){ return p[0]; }), n=xs.length; if(n<2) return '<p class="note">Not enough history yet.</p>';
  var vals=[]; o.series.forEach(function(s){ s.pts.forEach(function(p){ if(p[1]!=null) vals.push(p[1]); }); }); (o.refs||[]).forEach(function(r){ if(r.v!=null) vals.push(r.v); });
  var lo=Math.min.apply(null,vals), hi=Math.max.apply(null,vals), pad=(hi-lo)*0.08||0.5; lo-=pad; hi+=pad; if(o.zero&&lo>0) lo=0;
  var idx={}; xs.forEach(function(x,i){ idx[x]=i; });
  function X(i){ return PL+pw*i/(n-1); } function Y(v){ return PT+ph*(1-(v-lo)/(hi-lo)); }
  var s='', labs=[];
  niceTicks(lo,hi,4).forEach(function(v){ s+='<line x1="'+PL+'" x2="'+(PL+pw)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'" stroke="#1e2a3a"/><text x="'+(PL-6)+'" y="'+(Y(v)+3.5).toFixed(1)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="end">'+fmt(v,Math.abs(hi-lo)<4?1:0)+'</text>'; });
  if(lo<0&&hi>0) s+='<line x1="'+PL+'" x2="'+(PL+pw)+'" y1="'+Y(0)+'" y2="'+Y(0)+'" stroke="#3a4a61"/>';
  var every=Math.max(1,Math.ceil(n/7)), daily=xs[0].length>=10&&(Date.parse(xs[n-1].slice(0,10))-Date.parse(xs[0].slice(0,10)))<150*86400000;
  function xLab(x){ return x.length>=10&&daily?fmtShortDate(x.slice(0,10)):x.length>=7?mLabel(x):esc(x); }
  xs.forEach(function(x,i){ if((n-1-i)%every===0) s+='<text x="'+X(i).toFixed(1)+'" y="'+(H-10)+'" fill="#8494ab" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">'+xLab(x)+'</text>'; });
  if(n<=400) xs.forEach(function(x,i){ var x0=i?(X(i-1)+X(i))/2:PL, x1=i<n-1?(X(i)+X(i+1))/2:PL+pw;     /* hover / tap label for every point (works in the zoom view too) */
    var tip=(x.length>=10?fmtDate(x.slice(0,10)):esc(x))+'|'+o.series.map(function(sr){ var pt=sr.pts.filter(function(p){ return p[0]===x; })[0]; return esc(sr.label)+': '+(pt&&pt[1]!=null?fmt(pt[1],dec):'—'); }).join('|');
    s+='<rect class="oi-hit" x="'+x0.toFixed(1)+'" y="'+PT+'" width="'+Math.max(1,x1-x0).toFixed(1)+'" height="'+ph+'" fill="transparent" data-tip="'+tip+'"/>'; });
  var placed=[];
  (o.events||[]).forEach(function(e){ var i=-1; for(var k=0;k<n;k++){ if(xs[k]>=e.date){ i=k; break; } } if(i<0) return;
    var exn=X(i), lvl=0; placed.forEach(function(p){ if(Math.abs(p[0]-exn)<15) lvl=Math.max(lvl,p[1]+1); }); placed.push([exn,lvl]);
    var ex=exn.toFixed(1), cy=PT+2+lvl*15;
    s+='<g class="evm" tabindex="0" data-evn="'+e.n+'" data-evsk="'+esc(e.sk||'')+'"><rect x="'+(exn-8).toFixed(1)+'" y="'+(cy-8)+'" width="16" height="'+(PT+ph-cy+8)+'" fill="transparent"/><line x1="'+ex+'" x2="'+ex+'" y1="'+cy+'" y2="'+(PT+ph)+'" stroke="#8494ab" stroke-width="1" stroke-dasharray="2 3"/><circle class="evc" cx="'+ex+'" cy="'+cy+'" r="7" fill="#1a2a42" stroke="#8494ab"/><text x="'+ex+'" y="'+(cy+3.5)+'" fill="#e8eef4" font-size="9" font-weight="700" font-family="IBM Plex Mono" text-anchor="middle" pointer-events="none">'+e.n+'</text></g>'; });
  (o.refs||[]).forEach(function(r){ if(r.v==null) return; s+='<line x1="'+PL+'" x2="'+(PL+pw)+'" y1="'+Y(r.v).toFixed(1)+'" y2="'+Y(r.v).toFixed(1)+'" stroke="'+r.color+'" stroke-width="1.3" stroke-dasharray="'+(r.dash||'5 4')+'"/>'; labs.push({y:Y(r.v), t:r.label+' '+fmt(r.v,dec), c:r.color}); });
  o.series.forEach(function(sr){ var d='', started=false;
    sr.pts.forEach(function(p){ if(p[1]==null){ started=false; return; } var i=idx[p[0]]; d+=(started?'L':'M')+X(i).toFixed(1)+' '+Y(p[1]).toFixed(1); started=true; });
    s+='<path d="'+d+'" fill="none" stroke="'+sr.color+'" stroke-width="'+(sr.width||2)+'" stroke-linejoin="round"/>';
    var lp=sr.pts.filter(function(p){ return p[1]!=null; }).pop(); if(lp){ s+='<circle cx="'+X(idx[lp[0]]).toFixed(1)+'" cy="'+Y(lp[1]).toFixed(1)+'" r="3.2" fill="'+sr.color+'"/>'; labs.push({y:Y(lp[1]), t:sr.label+' '+fmt(lp[1],dec), c:sr.color, b:1}); } });
  labs.sort(function(a,b){ return a.y-b.y; }); for(var i=1;i<labs.length;i++) if(labs[i].y-labs[i-1].y<12) labs[i].y=labs[i-1].y+12;
  var over=labs.length?labs[labs.length-1].y-(PT+ph):0; if(over>0) labs.forEach(function(l){ l.y-=over; });
  labs.forEach(function(l){ s+='<text x="'+(PL+pw+6)+'" y="'+(l.y+3.5).toFixed(1)+'" fill="'+l.c+'" font-size="10.5" font-weight="'+(l.b?700:500)+'" font-family="IBM Plex Mono">'+esc(l.t)+'</text>'; });
  if(o.yLabel) s+='<text x="10" y="'+(PT+ph/2)+'" transform="rotate(-90 10 '+(PT+ph/2)+')" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">'+esc(o.yLabel)+'</text>';
  return '<svg viewBox="0 0 '+W+' '+H+'" class="chart-svg" role="img" aria-label="'+esc(o.aria||o.yLabel||'chart')+'">'+s+'</svg>';
}
/* vertical bars: o={bars:[[label,v,hl]], line:[[label,v]] (optional dashed), lineLabel, yLabel, dec, W,H} */
var BTIPS={}, BTN=0;
function barChartSVG(o){
  var tid=o.tips?('b'+(++BTN)):null; if(tid) BTIPS[tid]=o.tips;
  var W=o.W||480, H=o.H||210, PL=44, PR=o.lineLabel?84:12, PT=18, PB=o.months?40:28, pw=W-PL-PR, dec=o.dec==null?1:o.dec, n=o.bars.length; if(!n) return '';
  /* category labels too wide for their bar ("Q3 '23") wrap onto two lines instead of running into each other */
  var two=!o.months&&o.bars.some(function(b){ return /\s/.test(String(b[0]))&&String(b[0]).length*6.4>pw/n*0.95; }); if(two) PB+=12; var ph=H-PT-PB;
  var vals=o.bars.map(function(b){ return b[1]; }).concat((o.line||[]).map(function(l){ return l[1]; })).filter(function(v){ return v!=null; });
  var lo=Math.min(0,Math.min.apply(null,vals)), hi=Math.max(0,Math.max.apply(null,vals)); if(o.floor!=null) lo=o.floor; var pad=(hi-lo)*0.12||1; hi+=pad; if(lo<0) lo-=pad*0.6;
  function Y(v){ return PT+ph*(1-(v-lo)/(hi-lo)); } var bw=pw/n, s='';
  niceTicks(lo,hi,4).forEach(function(v){ s+='<line x1="'+PL+'" x2="'+(PL+pw)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'" stroke="#1e2a3a"/><text x="'+(PL-6)+'" y="'+(Y(v)+3.5).toFixed(1)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="end">'+fmt(v,Math.abs(hi-lo)<6?1:0)+'</text>'; });
  var base=Y(Math.max(lo,0));
  var MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'], step=o.months?(n>18?3:n>12?2:1):1;
  o.bars.forEach(function(b,i){ if(b[1]==null) return; var x=PL+i*bw+bw*0.16, w=bw*0.68, y=Y(b[1]), top=Math.min(y,base), h=Math.max(1,Math.abs(base-y));
    var col=b[1]<0?'#e0655f':(b[2]?'#38b6c9':'#2c6f8a');
    if(tid) s+='<g class="btip" data-tid="'+tid+'" data-i="'+i+'" tabindex="0"><rect x="'+(PL+i*bw).toFixed(1)+'" y="'+PT+'" width="'+bw.toFixed(1)+'" height="'+ph+'" fill="transparent"/>';
    s+='<rect class="bbar" x="'+x.toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+w.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="2" fill="'+col+'"/>';
    if(tid) s+='</g>';
    if(n<=14) s+='<text x="'+(x+w/2).toFixed(1)+'" y="'+(b[1]<0?top+h+11:top-4).toFixed(1)+'" fill="#dbe4f0" font-size="11" font-weight="600" font-family="IBM Plex Mono" text-anchor="middle">'+fmt(b[1],dec)+'</text>';
    if(o.months){ var ym=o.months[i]||'', mo=+ym.slice(5,7);
      if((n-1-i)%step===0) s+='<text x="'+(x+w/2).toFixed(1)+'" y="'+(PT+ph+14)+'" fill="#8494ab" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">'+(MN[mo-1]||'')+'</text>';
      if(mo===1||i===0){ s+='<text x="'+(PL+i*bw+2).toFixed(1)+'" y="'+(PT+ph+30)+'" fill="#c9d6e6" font-size="10.5" font-weight="700" font-family="IBM Plex Mono">'+ym.slice(0,4)+'</text>'+(i>0?'<line x1="'+(PL+i*bw).toFixed(1)+'" x2="'+(PL+i*bw).toFixed(1)+'" y1="'+PT+'" y2="'+(PT+ph+32)+'" stroke="#2b3e5c" stroke-dasharray="2 3"/>':''); } }
    else if(n<=14||i%2===(n-1)%2){ var lb=String(b[0]), sp=two?lb.indexOf(' '):-1;
      s+=sp>0?'<text x="'+(x+w/2).toFixed(1)+'" y="'+(H-21)+'" fill="#8494ab" font-size="10.5" font-family="IBM Plex Mono" text-anchor="middle">'+esc(lb.slice(0,sp))+'<tspan x="'+(x+w/2).toFixed(1)+'" dy="12" fill="#8f9db3">'+esc(lb.slice(sp+1))+'</tspan></text>'
        :'<text x="'+(x+w/2).toFixed(1)+'" y="'+(H-9)+'" fill="#8494ab" font-size="10.5" font-family="IBM Plex Mono" text-anchor="middle">'+esc(lb)+'</text>'; } });
  if(lo<0) s+='<line x1="'+PL+'" x2="'+(PL+pw)+'" y1="'+Y(0)+'" y2="'+Y(0)+'" stroke="#3a4a61"/>';
  if(o.line&&o.line.length){ var d='', st=false; o.line.forEach(function(l,i){ if(l[1]==null){ st=false; return; } d+=(st?'L':'M')+(PL+i*bw+bw/2).toFixed(1)+' '+Y(l[1]).toFixed(1); st=true; });
    s+='<path d="'+d+'" fill="none" stroke="#e8a33d" stroke-width="1.6" stroke-dasharray="5 4"/>';
    var ll=o.line.filter(function(l){ return l[1]!=null; }).pop(); if(ll) s+='<text x="'+(PL+pw+6)+'" y="'+(Y(ll[1])+3.5).toFixed(1)+'" fill="#e8a33d" font-size="10.5" font-family="IBM Plex Mono">'+esc(o.lineLabel)+' '+fmt(ll[1],dec)+'</text>'; }
  if(o.yLabel) s+='<text x="10" y="'+(PT+ph/2)+'" transform="rotate(-90 10 '+(PT+ph/2)+')" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">'+esc(o.yLabel)+'</text>';
  return '<svg viewBox="0 0 '+W+' '+H+'" class="chart-svg" role="img" aria-label="'+esc(o.aria||o.yLabel||'bar chart')+'">'+s+'</svg>';
}
/* horizontal diverging change bars (HTML) */
function divBarsHTML(rows, dec, unit){
  var mx=Math.max.apply(null,rows.map(function(r){ return Math.abs(r[1]||0); }))||1;
  return '<div class="divbars">'+rows.map(function(r){ var v=r[1]; if(v==null) return '';
    var w=Math.abs(v)/mx*50; return '<div class="db-row"><span class="db-l">'+esc(r[0])+'</span><span class="db-track"><span class="db-bar '+(v>=0?'pos':'neg')+'" style="'+(v>=0?'left:50%':'right:50%')+';width:'+w.toFixed(1)+'%"></span></span><span class="db-v '+cls(v)+'">'+sgn(v,dec)+(unit||'')+'</span></div>'; }).join('')+'</div>';
}

/* ---------- MACRO dashboard (US vs Canada) ---------- */
function mget(k){ return macroAll().filter(function(m){ return m.key===k; })[0]; }
function trailAvg(pts, n){ if(!pts||pts.length<n) return null; var v=pts.slice(-n).map(function(p){ return p[1]; }); return v.reduce(function(a,b){ return a+b; },0)/v.length; }
function cpiDeepBtn(g){ return '<button class="cpi-dd-btn" data-cpigo="'+g+'" title="Every CPI category for the latest '+(g==='us'?'US':'Canada')+' release">\ud83d\udd0d CPI deep dive \u2014 every category \u2192</button>'; }
function macroLinePanel(m, opt){
  if(!m||!m.long) return '<div class="mpanel"><h3 class="mp-h">'+esc(opt.country+' '+opt.what)+'</h3><p class="note">Five-year history loads on the next macro refresh.</p></div>';
  var pts=m.long, last=pts[pts.length-1][1], refs=[];
  if(opt.target!=null) refs.push({v:opt.target,label:'Target',color:'#8494ab',dash:'2 3'});
  [[24,'2Y avg','#e8a33d'],[36,'3Y avg','#c084fc'],[60,'5Y avg','#5fd598']].forEach(function(a){ var v=trailAvg(pts,a[0]); if(v!=null) refs.push({v:+v.toFixed(2),label:a[1],color:a[2]}); });
  var head=opt.headline(last, m);
  return '<div class="mpanel has-flag">'+cflag(m.group)+'<h3 class="mp-h mk-click" data-mkey="'+m.key+'" title="Click for the full breakdown">'+head+' <span class="h2note">\u24d8</span></h3>'+
    lineChartSVG({series:[{pts:pts.slice(-60),color:opt.color,label:'Actual',width:2.2}], refs:refs, yLabel:opt.yLabel, dec:1, aria:head.replace(/<[^>]+>/g,'')})+
    nextReleaseHTML(m.key)+(opt.what==='CPI'&&cpiHas(m.group)?cpiDeepBtn(m.group):'')+'<div class="stamp">Latest '+esc(m.period)+' · dashed = trailing 2/3/5-yr averages'+(opt.target!=null?' · dotted = 2% target':'')+'</div></div>';
}
function macroKpiCard(title, us, ca, dec, unit){
  function row(flag, m){ if(!m) return ''; var ch=m.chg, flat=Math.abs(ch)<Math.pow(10,-dec)/2;
    return '<div class="mkc mk-click" data-mkey="'+m.key+'" title="Click for the full breakdown"><div class="mkc-h">'+flagCcy(m.group,12)+' <b>'+flag+'</b> <span>'+esc(m.period)+'</span></div>'+
      '<div class="mkc-v"><b>'+fmt(m.value,dec)+unit+'</b><span class="mkc-c '+(flat?'neu':cls(ch))+'">'+(flat?'unch.':sgn(ch,dec,unit==='%'?' pp':''))+'</span></div>'+nextReleaseHTML(m.key,true)+'</div>'; }
  return '<div class="dash-card"><div class="dk">'+title+'</div>'+(MGEO!=='ca'?row('US',us):'')+(MGEO!=='us'?row('CA',ca):'')+'</div>';
}
function macroCompareHTML(){
  var R=[['CPI inflation (y/y)','us_cpi','ca_cpi',1,'%',function(g){ return g>0?'US inflation hotter → Fed has less room to ease; USD-supportive':'Canada inflation hotter → BoC under more pressure; CAD-supportive'; }],
    ['Unemployment rate','us_ur','ca_ur',1,'%',function(g){ return g<0?'US labour market tighter → USD-supportive':'Canada labour market tighter → CAD-supportive'; }],
    ['Policy rate','us_policy','ca_policy',2,'%',function(g){ return g>0?'Rate gap favours USD carry ('+fmt(g*100,0)+' bps)':'Rate gap favours CAD carry'; }],
    ['Real GDP (q/q ann.)','us_gdp','ca_gdpq',1,'%',function(g){ return g>0?'US growth outpacing Canada → USD-supportive':'Canada growth outpacing → CAD-supportive'; }]];
  var rows=R.map(function(r){ var u=mget(r[1]), c=mget(r[2]); if(!u||!c) return '';
    var g=u.value-c.value; return '<tr><td class="lbl" data-l="">'+r[0]+'</td><td data-l="US latest"><b>'+fmt(u.value,r[3])+r[4]+'</b> <small class="h2note">'+esc(u.period)+'</small></td><td data-l="US prior">'+fmt(u.prior,r[3])+r[4]+'</td>'+
      '<td data-l="Canada latest"><b>'+fmt(c.value,r[3])+r[4]+'</b> <small class="h2note">'+esc(c.period)+'</small></td><td data-l="Canada prior">'+fmt(c.prior,r[3])+r[4]+'</td><td data-l="Gap US−CA"><b>'+sgn(g,r[3],' pp')+'</b></td></tr><tr class="cmp-read"><td colspan="6">→ '+r[5](g)+'</td></tr>'; }).join('');
  return '<div class="tbl-scroll"><table class="sd-tbl cmp-macro"><thead><tr><th>Indicator</th><th>US latest</th><th>US prior</th><th>Canada latest</th><th>Canada prior</th><th>Gap</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function macroDashHTML(){
  var b=function(v,l){ return '<button data-mgeo="'+v+'" aria-pressed="'+(MGEO===v)+'">'+l+'</button>'; };
  var uc=mget('us_cpi'), cc=mget('ca_cpi'), uu=mget('us_ur'), cu=mget('ca_ur'), up=mget('us_policy'), cp=mget('ca_policy'), ug=mget('us_gdp'), cg=mget('ca_gdpq')||mget('ca_gdp');
  function cpiHead(country){ return function(v){ return esc(country)+' CPI inflation: <b>'+fmt(v,1)+'%</b>, '+(v>2.05?'above':v<1.95?'below':'at')+' the 2% target'; }; }
  function urHead(country){ return function(v,m){ var a=trailAvg(m.long,36); return esc(country)+' unemployment: <b>'+fmt(v,1)+'%</b>'+(a!=null?', '+(v>a+0.05?'above':v<a-0.05?'below':'in line with')+' its 3-yr average':''); }; }
  var showUS=MGEO!=='ca', showCA=MGEO!=='us';
  var cpi=(showUS?macroLinePanel(uc,{country:'U.S.',what:'CPI',color:'#38b6c9',target:2,yLabel:'Inflation rate (%)',headline:cpiHead('U.S.')}):'')+(showCA?macroLinePanel(cc,{country:'Canada',what:'CPI',color:'#e0655f',target:2,yLabel:'Inflation rate (%)',headline:cpiHead('Canada')}):'');
  var ur=(showUS?macroLinePanel(uu,{country:'U.S.',what:'unemployment',color:'#38b6c9',yLabel:'Unemployment rate (%)',headline:urHead('U.S.')}):'')+(showCA?macroLinePanel(cu,{country:'Canada',what:'unemployment',color:'#e0655f',yLabel:'Unemployment rate (%)',headline:urHead('Canada')}):'');
  function pol(m,country,color){ if(!m||!m.long) return '<div class="mpanel"><h3 class="mp-h">'+country+' policy rate</h3><p class="note">Policy-rate history loads on the next macro refresh.</p></div>';
    /* 12-month change by date (not by row count), and a net-zero year that moved in between says so, so the words match the chart */
    var p=m.long, l=p[p.length-1][1], t0=Date.parse(p[p.length-1][0])-365*864e5, yr=p.filter(function(x){ return Date.parse(x[0])>=t0; }), b4=p.filter(function(x){ return Date.parse(x[0])<t0; }),
      y1=b4.length?b4[b4.length-1][1]:null, vs=yr.map(function(x){ return x[1]; }), hi=Math.max.apply(null,vs), lo=Math.min.apply(null,vs);
    var chg=y1==null?'':', '+(l<y1-1e-9?'down '+fmt((y1-l)*100,0)+' bps':l>y1+1e-9?'up '+fmt((l-y1)*100,0)+' bps':(hi-lo>1e-9?'back where it was':'unchanged'))+' in 12 months'+(hi-lo>1e-9&&Math.abs(l-y1)<1e-9?' (ranged '+fmt(lo,2)+'–'+fmt(hi,2)+'%)':'');
    return '<div class="mpanel has-flag">'+cflag(m.group)+'<h3 class="mp-h">'+country+' policy rate: <b>'+fmt(l,2)+'%</b>'+chg+'</h3>'+
      lineChartSVG({series:[{pts:p.slice(-60),color:color,label:'Rate'}],yLabel:'Policy rate (%)',dec:2,H:200})+'<div class="stamp">Month-end readings</div></div>'; }
  var polH=(showUS?pol(up,'Fed funds (upper)','#38b6c9'):'')+(showCA?pol(cp,'BoC overnight','#e0655f'):'');
  function gdp(m,country){ if(!m) return ''; var src=m.long||m.history.map(function(h){ return [h[0],h[1]]; });
    var bars=src.slice(-12).map(function(p,i,a){ var q=p[0].length>=7?('Q'+(Math.floor((+p[0].slice(5,7)-1)/3)+1)+" '"+p[0].slice(2,4)):p[0]; return [q,p[1],i===a.length-1]; });
    var l=bars[bars.length-1][1];
    return '<div class="mpanel has-flag">'+cflag(m.group)+'<h3 class="mp-h">'+country+' real GDP: <b>'+fmt(l,1)+'%</b> '+(m.key==='ca_gdp'?'m/m':'q/q annualized')+'</h3>'+barChartSVG({bars:bars,yLabel:'Growth (%)',dec:1,H:200})+'<div class="stamp">'+esc(m.period)+'</div></div>'; }
  var gdpH=(showUS?gdp(ug,'U.S.'):'')+(showCA?gdp(cg,'Canada'):'');
  return '<div class="tile wide" data-src="macro"><div class="tile-head"><h2>US vs Canada macro dashboard <span class="h2note">— latest prints, 5-year context, what it means for USD/CAD</span></h2>'+
    '<span class="toggle" role="group">'+b('both',flag('us',11)+' + '+flag('ca',11))+b('us',flag('us',11)+' US')+b('ca',flag('ca',11)+' CANADA')+'</span></div>'+
    '<div class="dash-grid four">'+macroKpiCard('CPI inflation (y/y)',uc,cc,1,'%')+macroKpiCard('Unemployment rate',uu,cu,1,'%')+macroKpiCard('Policy rate',up,cp,2,'%')+macroKpiCard('Real GDP',ug,cg,1,'%')+'</div>'+
    '<div class="mpanels'+(MGEO==='both'?'':' one')+'">'+cpi+ur+polH+gdpH+'</div>'+
    (MGEO==='both'?'<h3 class="m-h">Country comparison</h3>'+macroCompareHTML():'')+
    '<div class="stamp">Verified '+asOf('macro',true)+'</div></div>';
}

/* ---------- Canada charts (fundamentals sub-tab) ---------- */
function canadaChartsHTML(key){
  var C=DATA.canada&&DATA.canada[key], st=caState(key), A=C&&C.annual&&C.annual[st.ca_geo]; if(!A) return '';
  var M=caMeasures(key, st.ca_unit), prod=M[3].v(A), yrs=A.years, i=caLatestIdx(prod), s0=Math.max(0,i-9);
  var bars=[], line=[]; for(var j=s0;j<=i;j++){ bars.push(["'"+yrs[j].slice(2), prod[j], j===i]); line.push([yrs[j], caAvg(prod,j-5,j)]); }
  var html='<div class="tile" data-src="canada"><h2>'+flag('ca',15)+' '+esc(st.ca_geo)+' production by crop year <span class="h2note">— '+M[3].u+' · dashed = trailing 5-yr average</span></h2>'+
    barChartSVG({bars:bars,line:line,lineLabel:'5-yr',yLabel:'Production ('+M[3].u+')',dec:M[3].d,floor:0})+'<div class="stamp">'+scLink('annual')+(+yrs[i]>=new Date().getFullYear()?' · '+yrs[i]+' is an in-season estimate':'')+'</div></div>';
  var P=caPriceSeries(C, st.ca_geo), bpm=BU_PER_MT[key], imp=st.ca_unit==='imp', f=imp?1/bpm:1, uu=imp?'C$/bu':'C$/t';
  if(P){ var g=DATA.grains[key], fut=g&&g.fan&&+g.fan.intraday[0], fx=DATA.fx&&DATA.fx.feed&&+DATA.fx.feed.mid, refs=[];
    if(fut&&fx) refs.push({v:+(fut*bpm*fx*f).toFixed(2),label:'CBOT C$',color:'#38b6c9'});
    var ch=DATA.ca_calendar&&DATA.ca_calendar.chatham&&DATA.ca_calendar.chatham[key];
    if(ch&&st.ca_geo==='Ontario') refs.push({v:+(ch*f).toFixed(2),label:'AAFC Chatham fcst',color:'#e8a33d'});
    html+='<div class="tile" data-src="canada"><h2>'+flag('ca',15)+' '+esc(st.ca_geo==='Ontario'||P===(C.prices||{})[st.ca_geo]?st.ca_geo:'Canada')+' monthly farm price vs CBOT <span class="h2note">— '+uu+'</span></h2>'+
      lineChartSVG({series:[{pts:P.series.slice(-30).map(function(x){ return [x[0], +(x[1]*f).toFixed(2)]; }),color:'#5fd598',label:'Farm'}],refs:refs,yLabel:'Price ('+uu+')',dec:2})+
      '<div class="stamp">'+scLink('prices')+' ('+esc(P.product)+') · CBOT '+esc(GMETA[key].contract)+' converted at live USD/CAD'+(ch&&st.ca_geo==='Ontario'?' · AAFC 2026-27 Chatham average forecast from the '+esc(DATA.ca_calendar.chatham_report)+' Outlook':'')+'</div></div>';
  }
  return html;
}

/* ================= DERIVATIVES COCKPIT ================= */
var CARRY={storage:0.00165, days:{corn:90, wheat:90, soybeans:61}, fin_add:2.0};  /* $/bu/day (16.5/100 ¢), first-delivery-day gap, financing = US 3M bill + 200 bp */
var BU_CONTRACT=5000;
function tradingDaysTo(t){ var n=0, d=new Date(); d.setHours(12,0,0,0); var end=new Date(t); while(d<end){ d.setDate(d.getDate()+1); var w=d.getDay(); if(w!==0&&w!==6&&d<=end) n++; } return Math.max(n,1); }
function optUnderlying(key){
  var g=DATA.grains[key], f=g.fan, R=rollData(key), L=R.dailyN[R.dailyN.length-1];
  if(g.near.contract && g.near.contract!==R.front && g.near.contract===R.def) return {F:+f.intraday[0]-L[4]/100, c:R.def, how:'front quote − latest spread'};
  return {F:+f.intraday[0], c:R.front, how:'delayed front quote'};
}
function ivAt(skew, K){
  var s=skew.slice().sort(function(a,b){ return a[0]-b[0]; }); if(!s.length) return null;
  if(K<=s[0][0]) return {iv:s[0][1], clamp:true}; if(K>=s[s.length-1][0]) return {iv:s[s.length-1][1], clamp:true};
  for(var i=1;i<s.length;i++) if(K<=s[i][0]){ var a=s[i-1], b=s[i], w=(K-a[0])/(b[0]-a[0]); return {iv:a[1]+(b[1]-a[1])*w, clamp:false}; }
  return null;
}
function skewMetrics(key){
  var g=DATA.grains[key], U=optUnderlying(key), atm=(g.vol&&g.vol.near&&g.vol.near.iv)||g.near.iv;
  var T=Math.max(1,(new Date(g.near.expires+'T13:20:00')-Date.now())/86400000)/365, m=atm/100*Math.sqrt(T);
  var c=ivAt(g.skew, U.F*(1+m)), p=ivAt(g.skew, U.F*(1-m)); if(!c||!p) return null;
  return {rr:c.iv-p.iv, bf:(c.iv+p.iv)/2-atm, call:c.iv, put:p.iv, kc:U.F*(1+m), kp:U.F*(1-m), clamp:c.clamp||p.clamp, atm:atm};
}
function fullCarry(key){
  var R=rollData(key), L=R.dailyN[R.dailyN.length-1], F=L[5]!=null?L[5]:+DATA.grains[key].fan.anchor, r=(+DATA.fx.treasury['3M']||4)+CARRY.fin_add, days=CARRY.days[key];
  var fc=days*(r/100/360*F+CARRY.storage)*100;   /* cents/bu */
  return {fc:fc, sp:L[4], pct:-L[4]/fc*100, r:r, days:days, front:R.front, def:R.def};
}
function fundPnl(key){
  var g=DATA.grains[key], st=g.cftc_stats, b=st&&st.basis; if(!b) return null;
  var F=+g.fan.intraday[0], per=(F-b.avg_entry)*(b.net>0?1:-1)*BU_CONTRACT;
  return {entry:b.avg_entry, net:b.net, per:per, tot:per*Math.abs(b.net), weeks:b.weeks, F:F};
}
function cockpitHTML(key){
  var g=DATA.grains[key], f=g.fan, U=optUnderlying(key), V=g.vol||{}, iv=(V.near&&V.near.iv)||g.near.iv, hv=V.near&&V.near.hv;
  var now=Date.now(), wev=usdaEvents(key, now, 60).filter(function(e){ return e.t>now && e.kind==='wasde'; })[0];
  var cards=[], ivAt0=V.src?esc(String(V.src).replace(/^IBKR snapshot,\s*/,'').replace(/ (\d{4}) /,' ')):asofStamp('options');
  var oiAt=esc(oiLabel(g.near).replace(/^.*OI as of /,'').replace(' close (preliminary)',' close · prelim'));
  cards.push(kpi('ATM IV · '+esc(g.near.chain||g.near.contract), fmt(iv,1)+'<small>%</small>',
    (hv!=null?'HV30 '+fmt(hv,1)+'% · IV−HV <span class="'+cls(iv-hv)+'">'+sgn(iv-hv,1,' pts')+'</span>':'')+(V.pct?'<br>IV pctile 52w <b>'+fmt(V.pct['52w'],0)+'</b> · 13w '+fmt(V.pct['13w'],0):'')+kAsof('IV/HV pulled '+ivAt0)));
  if(wev){ var td=tradingDaysTo(wev.t), mv=U.F*iv/100*Math.sqrt(td/252), d1=U.F*iv/100/Math.sqrt(252);
    cards.push(kpi('Implied move to WASDE', '±'+fmt(mv*100,1)+'<small>¢</small>', '±'+fmt(mv/U.F*100,1)+'% over '+td+' sessions · '+fmt(U.F-mv,2)+'–'+fmt(U.F+mv,2)+'<br>1-day ±'+fmt(d1*100,1)+'¢ · <span class="countdown" data-t="'+wev.t+'">'+cdText(wev.t-now)+'</span>'+kAsof('IV '+ivAt0+' · price live'))); }
  var cw=g.near.call_wall, pw=g.near.put_wall, sd=U.F*iv/100/Math.sqrt(252)*Math.sqrt(10);
  cards.push(kpi('Put/call · walls', fmt(+g.near.pcr,2), 'Call wall <b>'+fmt(cw[0],2)+'</b> ('+sgn((cw[0]-U.F)*100,0,'¢')+', '+fmt(Math.abs(cw[0]-U.F)/sd,1)+'σ₁₀)<br>Put wall <b>'+fmt(pw[0],2)+'</b> ('+sgn((pw[0]-U.F)*100,0,'¢')+', '+fmt(Math.abs(pw[0]-U.F)/sd,1)+'σ₁₀)'+(g.near.wall_shift?'<br><span class="oi-mv">'+(g.near.wall_shift.put?'put wall shifted from '+fmt(g.near.wall_shift.put.from,2):'')+(g.near.wall_shift.put&&g.near.wall_shift.call?' · ':'')+(g.near.wall_shift.call?'call wall shifted from '+fmt(g.near.wall_shift.call.from,2):'')+' since the pull</span>':'')+kAsof('OI '+oiAt+' · pulled '+asofStamp('options'))));
  var R=rollData(key), L=R.dailyN[R.dailyN.length-1];
  cards.push(kpi('Roll '+R.front+'→'+R.def, fmt(L[3],1)+'<small>%</small>', esc(R.stats.state.replace(/^[A-Z \-]+\(/,'').replace(/\)$/,''))+' · pace '+esc(R.stats.pace.replace(' / last 5 sessions','/5d'))+kAsof('futures OI through '+esc(R.lastLabel||''))));
  var C=fullCarry(key);
  cards.push(kpi('Spread vs full carry', fmt(C.pct,0)+'<small>%</small>', fmt(C.sp,1)+'¢ vs full carry −'+fmt(C.fc,1)+'¢<br>'+(C.pct>=80?'near full carry — market pays to store':C.pct>=50?'moderate carry':'weak carry — nearby demand / tight stocks')+kAsof('settles '+esc(R.lastLabel?R.lastLabel.replace(' (prelim)',''):'')+' · bill rate '+asofStamp('yields'))));
  var st=g.cftc_stats, P=fundPnl(key), last=g.cftc[g.cftc.length-1];
  cards.push(kpi('Managed money', sgn(Math.round(last.net/1000),0)+'<small>k</small>',
    (st&&st.p3y!=null?'3-yr pctile <b>'+fmt(st.p3y,0)+'</b>':'')+(st&&st.pct_oi!=null?' · '+fmt(st.pct_oi,1)+'% OI':'')+
    (P?'<br>est. avg entry <b>$'+fmt(P.entry,4)+'</b> · <span class="'+cls(P.per)+'">'+(P.per>=0?'in profit':'underwater')+' '+sgn(P.tot/1e6,0,'M')+'</span>':'')+kAsof('CFTC positions as of '+esc(fmtShortDate(last.date))+' · weekly report, Fri 3:30 PM ET')));
  return '<div class="tile wide kpi-strip cockpit" data-src="options"><div class="cockpit-h">Derivatives cockpit · '+GMETA[key].name+' <span class="h2note">options on '+esc(U.c)+' @ '+fmt(U.F,4)+' ('+U.how+')</span></div>'+cards.join('')+
    '<div class="stamp" style="grid-column:1/-1">IV/HV/IV-percentile: '+esc(String(V.src||'chain data').replace(/^IBKR snapshot,\s*/,'options snapshot, '))+' · implied move = F × IV × √(sessions/252) · σ₁₀ = 10-session 1σ · full carry = days × (financing/360 × F + storage), storage 16.5/100¢/bu/day (CBOT corn rate; wheat VSR floor), financing = US 3M bill + 2% · fund entry = weekly net changes priced at that report week’s average settle</div></div>';
}
function volTermHTML(key){
  var g=DATA.grains[key], V=g.vol, H=g.vol_hist||[], S=skewMetrics(key);
  if(!V) return '';
  var bars=barChartSVG({bars:[[V.near.contract+' IV',V.near.iv,true],[V.far.contract+' IV',V.far.iv,false],[V.near.contract+' HV30',V.near.hv,false],[V.far.contract+' HV30',V.far.hv,false]],yLabel:'Volatility (%)',dec:1,W:380,H:200,floor:0});
  var hist=H.length>=5?lineChartSVG({series:[{pts:H.map(function(x){ return [x[0],x[1]]; }),color:'#38b6c9',label:'Near IV'},{pts:H.map(function(x){ return [x[0],x[2]]; }),color:'#c084fc',label:'Far IV'},{pts:H.map(function(x){ return [x[0],x[3]]; }),color:'#e8a33d',label:'HV30'}],yLabel:'Vol (%)',dec:1,W:400,H:210}):
    '<p class="note">Daily IV history starts '+esc(H.length?H[0][0]:'today')+' and builds with each 8:23 ET daily options run ('+H.length+' of 5 sessions needed for the line chart).</p>';
  var term=V.far.iv-V.near.iv, ivhv=V.near.iv-V.near.hv, rrz=S&&Math.abs(S.rr)<0.05;
  function row(k, v, c, read, tip){ return '<div class="vr-k"'+(tip?' title="'+esc(tip)+'"':'')+'>'+k+'</div><div class="vr-v '+(c||'')+'">'+v+'</div><div class="vr-r">'+read+'</div>'; }
  var R=row('Term structure', sgn(term,1,' pts'), cls(term), 'far ('+esc(V.far.contract)+') vs near ('+esc(V.near.contract)+') — '+(term<0?'<b>inverted</b>: near-term event risk is priced':'<b>normal</b>: longer-dated vol higher'), 'Far-month IV minus near-month IV')+
    row('IV − HV30', sgn(ivhv,1,' pts'), cls(ivhv), ivhv<0?'options <b>cheap</b> vs realized moves':'options <b>rich</b> vs realized moves', 'Near-month implied vol minus 30-day historical vol');
  if(S) R+=row('Risk reversal', rrz?'0.0 pts':sgn(S.rr,2,' pts'), rrz?'neu':cls(S.rr), rrz?'balanced — puts and calls priced alike':S.rr>0?'calls richer — <b>upside</b> priced':'puts richer — <b>downside</b> protection bid', '±1σ call IV minus put IV')+
    row('Butterfly', sgn(S.bf,2,' pts'), '', S.bf>1?'wings rich — big moves priced':'wings modest', 'Average of ±1σ wing IVs minus ATM IV')+
    row('±1σ strikes', fmt(S.atm,1)+'% ATM', '', 'put '+fmt(S.kp,2)+' @ '+fmt(S.put,1)+'% · call '+fmt(S.kc,2)+' @ '+fmt(S.call,1)+'%'+(S.clamp?' <span class="neu">(edge of pulled strikes)</span>':''), 'Strikes one standard deviation from futures, to option expiry');
  return '<div class="tile wide" data-src="options"><h2>Volatility — term structure, realized vs implied, skew <span class="h2note">— '+esc(String(V.src||'').replace(/^IBKR snapshot,\s*/,'snapshot '))+'</span></h2>'+
    '<div class="vol-grid"><div class="vol-c"><div class="vol-ct">Implied vs 30-day realized, by contract</div>'+bars+'</div><div class="vol-c"><div class="vol-ct">Daily history — hover a day for its values</div>'+hist+'</div></div>'+
    '<div class="vol-read">'+R+'</div>'+
    '<div class="stamp">IV from the options snapshot · HV30 = annualised standard deviation of the last 30 daily settle changes · pts = volatility points · double-click a chart to enlarge it</div></div>';
}


/* ---------- full-screen expand for wide comparison cards (crop-year comparison, export comparison) ----------
   The card itself becomes a full-screen layer over the page (its own selection menu travels with it and stays pinned
   at the top); Minimize / Esc puts it back exactly where it was. State survives re-renders while the page is open. */
var XPAND={};
function xpandBtn(id){ var on=!!XPAND[id]; return '<button class="xpand-btn" data-xpand="'+id+'" aria-pressed="'+on+'" title="'+(on?'Minimize back to the page (Esc)':'Expand to full screen')+'">'+(on?'↙ Minimize':'⤢ Expand')+'</button>'; }
function xpandSync(){
  var t=document.querySelector('.tile.xpanded'); document.body.classList.toggle('xpand-on', !!t);
  if(!t) return;                                          /* stack: title bar, then the selection menu, then the table header */
  var h=t.querySelector(':scope>.tile-head'), c=t.querySelector(':scope>.cmp-ctrl'), hh=h?h.offsetHeight:0, ch=c&&getComputedStyle(c).position==='sticky'?c.offsetHeight:0;
  t.style.setProperty('--xh1', (hh-14)+'px'); t.style.setProperty('--xh2', (hh-14+ch)+'px');
}
window.addEventListener('resize', xpandSync);
var OI_NARROW=window.innerWidth<640; window.addEventListener('resize', function(){ var nw=window.innerWidth<640; if(nw===OI_NARROW) return; OI_NARROW=nw; ['corn','wheat','soybeans'].forEach(function(k){ var el=document.getElementById('oi-'+k); if(el) el.innerHTML=oiTileHTML(k); }); });
document.addEventListener('click', function(ev){
  var b=ev.target.closest&&ev.target.closest('[data-xpand]'); if(!b) return;
  var id=b.getAttribute('data-xpand'), t=document.getElementById(id); if(!t) return;
  XPAND[id]=!XPAND[id]; t.classList.toggle('xpanded', XPAND[id]);
  b.setAttribute('aria-pressed', XPAND[id]); b.title=XPAND[id]?'Minimize back to the page (Esc)':'Expand to full screen'; b.textContent=XPAND[id]?'↙ Minimize':'⤢ Expand';
  if(!XPAND[id]){ t.style.removeProperty('--xh1'); t.style.removeProperty('--xh2'); } xpandSync(); if(!XPAND[id]) t.scrollIntoView({block:'nearest'});
});
document.addEventListener('keydown', function(ev){ if(ev.key!=='Escape') return; var t=document.querySelector('.tile.xpanded'); if(t){ var b=t.querySelector('[data-xpand]'); if(b) b.click(); } });
window.xpandBtn=xpandBtn; window.XPAND=XPAND;
/* ================= CROP-YEAR COMPARISON (USDA · Canada · Ontario) ================= */
var CMP=(function(){ var d={y2026:false,y2025:true,y2024:true,y2023:true,us:true,ca:true,on:true,br:true,chg:true,unit:'met',grp:'year',v:2};
  try{ var s=JSON.parse(localStorage.getItem('desk.cmp')||'{}'); if(s.v!==2){ delete s.unit; delete s.br; } Object.keys(d).forEach(function(k){ if(typeof s[k]===typeof d[k]) d[k]=s[k]; }); d.v=2; }catch(e){} return d; })();
function cmpSave(){ try{ localStorage.setItem('desk.cmp', JSON.stringify(CMP)); }catch(e){} }
function cmpYears(){ return ['2026','2025','2024','2023'].filter(function(y){ return CMP['y'+y]; }); }
/* one value getter per geography, all in the SAME units (imperial: mil ac · bu/ac · mil bu; metric: mil ha · t/ha · Mt) */
function cmpGeoData(key){
  var imp=CMP.unit==='imp', bpm=BU_PER_MT[key], G={};
  var H=DATA.sd_hist&&DATA.sd_hist[key];
  if(H){ var Y=H.years;
    function us(lab){ return function(y){ return Y[y]&&Y[y][lab]!=null?Y[y][lab]:null; }; }
    function q(lab){ return function(y){ var v=us(lab)(y); return v==null?null:(imp?v:v/bpm); }; }
    G.us={name:'United States', short:'US', cc:'us', src:'USDA', ylab:function(y){ return y+'/'+String(+y+1).slice(2); }, has:function(y){ return !!Y[y]; },
      area_h:function(y){ var v=us('Area Harvested')(y); return v==null?null:(imp?v:v*0.404686); },
      yield:function(y){ var v=us('Yield per Acre')(y); return v==null?null:(imp?v:v/bpm*2.47105); },
      prod:q('Production'), beg:q('Beginning Stocks'), imp_:q('Imports'), supply:q('Total Supply'), dom:q('Domestic Total'), crush:q('Crushings'),
      exp:q('Exports'), use:q('Total Use'), end:q('Ending Stocks'),
      stu:function(y){ var e=us('Ending Stocks')(y), t=us('Total Use')(y); return (e!=null&&t)?e/t*100:null; }}; }
  ['Canada','Ontario'].forEach(function(geo){
    var C=DATA.canada&&DATA.canada[key], A=C&&C.annual&&C.annual[geo]; if(!A) return;
    var idx={}; A.years.forEach(function(y,i){ idx[y]=i; });
    function f(field, div){ return function(y){ var v=idx[y]==null?null:(A[field]||[])[idx[y]]; return v==null?null:v/div; }; }
    var S=C.stocks&&C.stocks[geo], byd={}; (S||[]).forEach(function(x){ byd[x[0]]=x[1]; });
    function tot(o){ return o?(o['Farm and commercial, total']!=null?o['Farm and commercial, total']:o['Farm stocks']):null; }
    function kt(v){ return v==null?null:(imp?v*1000*bpm/1e6:v/1000); }
    var P=C.prices&&C.prices[geo];
    G[geo==='Canada'?'ca':'on']={name:geo, short:geo==='Canada'?'Canada':'Ontario', cc:'ca', src:'StatCan', ylab:function(y){ return y; }, has:function(y){ return idx[y]!=null; },
      farmOnly: S&&S.length&&S[S.length-1][1]['Farm and commercial, total']==null,
      area_s:imp?f('seeded_ac',1e6):f('seeded_ha',1e6), area_h:imp?f('harv_ac',1e6):f('harv_ha',1e6),
      yield:imp?f('yield_bu',1):f('yield_kg',1000), prod:imp?f('prod_bu',1000):f('prod_t',1e6),
      beg:function(y){ return kt(tot(byd[y+'-07'])); }, end:function(y){ return kt(tot(byd[(+y+1)+'-07'])); }, dec31:function(y){ return kt(tot(byd[y+'-12'])); },
      price:P?function(y){ var a=P.series.filter(function(x){ return x[0]>=y+'-08'&&x[0]<=(+y+1)+'-07'; }); if(!a.length) return null; var v=a.reduce(function(s,x){ return s+x[1]; },0)/a.length; return imp?v/bpm:v; }:null };
  });
  /* Brazil column + world shares: USDA PSD yearly rows from gg.json (loaded on demand) */
  var GD=window.GG&&GG._data&&GG._data(), P=GD&&GD.crops&&GD.crops[key]&&GD.crops[key].psd;
  function psdRow(a3){ var c=P&&P.countries.filter(function(x){ return x.a3===a3; })[0]; return c&&c.years; }
  var BR=psdRow('BRA'), USW=psdRow('USA');
  function pv(Yr,f,conv){ return function(y){ var r=Yr&&Yr[y]; var v=r&&r[f]; return v==null?null:(conv?conv(v):v); }; }
  var q=function(v){ return imp?v*bpm/1000:v/1000; };               /* 1,000 t -> mil bu or MMT */
  if(USW&&G.us){ G.us.wshare=pv(USW,'share_prod'); G.us.wexp=pv(USW,'share_exp'); }
  var CAW=psdRow('CAN'); if(CAW&&G.ca){ G.ca.wshare=pv(CAW,'share_prod'); G.ca.wexp=pv(CAW,'share_exp'); }
  if(BR){
    G.br={name:'Brazil', short:'Brazil', cc:'br', src:'USDA', ylab:function(y){ return y+'/'+String(+y+1).slice(2); }, has:function(y){ return !!BR[y]; },
      area_h:pv(BR,'area',function(v){ return imp?v*2.47105/1000:v/1000; }), yield:pv(BR,'yield',function(v){ return imp?v*bpm/2.47105:v; }),
      prod:pv(BR,'prod',q), beg:pv(BR,'beg',q), imp_:pv(BR,'imp',q), dom:pv(BR,'dom',q), crush:pv(BR,'crush',q), exp:pv(BR,'exp',q), end:pv(BR,'end',q),
      supply:function(y){ var r=BR[y]; return r&&r.prod!=null?q((r.beg||0)+r.prod+(r.imp||0)):null; },
      use:function(y){ var r=BR[y]; return r&&r.dom!=null?q(r.dom+(r.exp||0)):null; },
      stu:function(y){ var r=BR[y]; return r&&r.end!=null&&(r.dom||r.exp)?r.end/((r.dom||0)+(r.exp||0))*100:null; },
      wshare:pv(BR,'share_prod'), wexp:pv(BR,'share_exp') };
  }
  return G;
}
function cmpRows(key){
  var imp=CMP.unit==='imp', A=imp?'mil ac':'mil ha', Yd=imp?'bu/ac':'t/ha', Q=imp?'mil bu':'MMT';
  return [
    {sec:'Crop size'},
    {id:'area_s', l:'Planted / seeded area', u:A, d:2},
    {id:'area_h', l:'Harvested area', u:A, d:2},
    {id:'yield', l:'Yield', u:Yd, d:imp?1:2, key:true},
    {id:'prod', l:'Production', u:Q, d:imp?0:2, key:true},
    {id:'share', l:'Production vs US', u:'% of US', d:1, pp:true, calc:'share'},
    {id:'wshare', l:'Share of world production', u:'% of world (USDA)', d:1, pp:true},
    {id:'wexp', l:'Share of world exports', u:'% of world (USDA)', d:1, pp:true},
    {sec:'Balance sheet'},
    {id:'beg', l:'Beginning stocks', u:Q, d:imp?0:2, note:'Canada/Ontario: Jul 31 stocks entering the crop year'},
    {id:'imp_', l:'Imports', u:Q, d:imp?0:2},
    {id:'supply', l:'Total supply', u:Q, d:imp?0:2, key:true},
    {id:key==='soybeans'?'crush':'dom', l:key==='soybeans'?'Crush':'Domestic use', u:Q, d:imp?0:2},
    {id:'exp', l:'Exports', u:Q, d:imp?0:2},
    {id:'use', l:'Total use', u:Q, d:imp?0:2, key:true},
    {id:'end', l:'Ending stocks', u:Q, d:imp?0:2, key:true, note:'Canada/Ontario: Jul 31 stocks at crop-year end'},
    {id:'stu', l:'Stocks-to-use', u:'%', d:1, pp:true, key:true},
    {id:'dec31', l:'Stocks Dec 31 (mid-year)', u:Q, d:imp?0:2},
    {id:'price', l:'Avg farm price (crop year)', u:imp?'C$/bu':'C$/t', d:2}
  ];
}
function cmpVal(G, g, row, y){
  if(row.calc==='share'){ var a=G[g]&&G[g].prod&&G[g].prod(y), u=G.us&&G.us.prod&&G.us.prod(y); return (g!=='us'&&a!=null&&u)?a/u*100:null; }
  var fn=G[g]&&G[g][row.id]; return typeof fn==='function'?fn(y):null;
}
function cmpCell2(v, prev, row, y, g){
  var at=' data-y="'+y+'" data-g="'+g+'"';
  if(v==null) return '<td class="cmp-na"'+at+'>—</td>';
  var dec=row.d; if(!row.pp&&/mil bu|MMT/.test(row.u)&&Math.abs(v)<100) dec=Math.max(dec,1);
  var ch='';
  if(CMP.chg && prev!=null){ if(row.pp){ var dp=v-prev; ch='<small class="'+cls(dp)+'">'+sgn(dp,1,' pp')+'</small>'; } else if(prev!==0){ var p=(v/prev-1)*100; ch='<small class="'+(Math.abs(p)<0.05?'neu':cls(p))+'">'+(Math.abs(p)<0.05?'0.0%':sgn(p,1,'%'))+'</small>'; } }
  return '<td'+at+'><b>'+fmt(v,dec)+'</b>'+ch+'</td>';
}
function cropCompareHTML(key){
  if(CMP.br&&window.GG&&!(GG._data&&GG._data())) GG.ensure();
  var years=cmpYears(), G=cmpGeoData(key), geos=['us','ca','on','br'].filter(function(g){ return CMP[g]&&G[g]; });
  var cb=function(k,l){ return '<label class="cmp-cb"><input type="checkbox" data-cmp="'+k+'" data-cmpk="'+key+'"'+(CMP[k]?' checked':'')+'> '+l+'</label>'; };
  var tg=function(k,v,l){ return '<button data-cmpset="'+k+'" data-v="'+v+'" aria-pressed="'+(CMP[k]===v)+'">'+l+'</button>'; };
  var ctrl='<div class="cmp-ctrl"><span class="cmp-g"><b>Crop years</b>'+cb('y2026','2026 (current)')+cb('y2025','2025')+cb('y2024','2024')+cb('y2023','2023')+'</span>'+
    '<span class="cmp-g"><b>Show</b>'+cb('us',flag('us',11)+' USA')+cb('ca',flag('ca',11)+' Canada')+cb('on',flag('ca',11)+' Ontario')+cb('br',(window.WORLD&&WORLD.flag?WORLD.flag('br',11):'')+' Brazil')+cb('chg','y/y change')+'</span>'+
    '<span class="cmp-g"><b>Units</b><span class="toggle">'+tg('unit','imp','ACRES · BU')+tg('unit','met','HECTARES · MMT')+'</span></span>'+
    '<span class="cmp-g"><b>Group by</b><span class="toggle">'+tg('grp','year','CROP YEAR')+tg('grp','geo','COUNTRY')+'</span></span></div>';
  var body;
  if(!years.length||!geos.length) body='<p class="note">Tick at least one crop year and one country.</p>';
  else {
    var cols=[]; if(CMP.grp==='year') years.forEach(function(y){ geos.forEach(function(g){ cols.push([y,g]); }); }); else geos.forEach(function(g){ years.forEach(function(y){ cols.push([y,g]); }); });
    var outer=CMP.grp==='year'?years:geos, inner=CMP.grp==='year'?geos:years;
    var gh=function(g){ return (G[g].cc==='br'?(window.WORLD&&WORLD.flag?WORLD.flag('br',12):''):flag(G[g].cc,12))+' '+G[g].short; };
    var h1='<tr><th rowspan="2" class="cmp-p">Parameter</th>'+outer.map(function(o,i){ return '<th colspan="'+inner.length+'" class="cmp-grp'+(i?' cmp-sep':'')+'">'+(CMP.grp==='year'?o+' crop'+(o==='2026'?' <small>(current est.)</small>':''):gh(o))+'</th>'; }).join('')+'</tr>';
    var h2='<tr>'+cols.map(function(c,i){ var first=(i%inner.length===0)&&i>0; var lab=CMP.grp==='year'?gh(c[1])+'<br><small>'+G[c[1]].ylab(c[0])+'</small>':(G[c[1]].ylab(c[0])+(G[c[1]].has(c[0])?'':' <small>n/a</small>'));
      return '<th class="cmp-sub'+(first?' cmp-sep':'')+'" data-y="'+c[0]+'">'+lab+'</th>'; }).join('')+'</tr>';
    var rows=cmpRows(key).filter(function(r){ return r.sec || cols.some(function(c){ return cmpVal(G,c[1],r,c[0])!=null; }); });
    rows=rows.filter(function(r,i){ return !r.sec || (rows[i+1]&&!rows[i+1].sec); });
    var body2=rows.map(function(r){
      if(r.sec) return '<tr class="cmp-secrow"><td colspan="'+(cols.length+1)+'">'+r.sec+'</td></tr>';
      return '<tr'+(r.key?' class="sd-key"':'')+'><td class="lbl"'+(r.note?' title="'+esc(r.note)+'"':'')+'>'+esc(r.l)+' <small class="h2note">'+esc(r.u)+'</small></td>'+
        cols.map(function(c,i){ var v=cmpVal(G,c[1],r,c[0]), pv=cmpVal(G,c[1],r,String(+c[0]-1)); return cmpCell2(v,pv,r,c[0],c[1]).replace('<td','<td'+((i%inner.length===0)&&i>0?' class="cmp-sep"':'')).replace('<td class="cmp-sep" class="cmp-na"','<td class="cmp-sep cmp-na"'); }).join('')+'</tr>'; }).join('');
    body='<div class="tbl-scroll"><table class="sd-tbl cmp-tbl cmp-one"><thead>'+h1+h2+'</thead><tbody>'+body2+'</tbody></table></div>';
  }
  var notes=[];
  if(CMP.br&&!G.br) notes.push('Brazil column: '+(window.GG&&GG._error&&GG._error()?'Sorry, we can\u2019t be reached now \u2014 global grain data did not load':'loading USDA world data\u2026'));
  if(G.br) notes.push('Brazil = USDA PSD (USDA estimate; Brazil\u2019s local marketing years aligned by USDA) \u2014 CONAB\u2019s own survey is under Brazil \u00b7 CONAB; world shares = USDA PSD, all countries');
  if(G.us) notes.push('US = USDA PSD, marketing year '+(key==='wheat'?'Jun–May':'Sep–Aug')+', latest estimate per year; planted area and farm price are not in PSD');
  if(G.ca||G.on) notes.push('Canada / Ontario = '+scLink('annual')+' (area, yield, production) · '+scLink('stocks')+' (Jul 31 stocks = beginning / ending stocks of the Aug–Jul crop year'+(G.on&&G.on.farmOnly?'; Ontario stocks are on-farm only':'')+') · '+scLink('prices')+' (Ontario farm price)');
  notes.push('every number converted to the same units ('+(CMP.unit==='imp'?'million acres · bu/acre · million bushels':'million hectares · tonnes/hectare · million tonnes')+') · small figures = change vs the previous crop year · hover a value: the ruler highlights its row and crop year');
  return '<div class="tile wide'+(XPAND['cmp-'+key]?' xpanded':'')+'" id="cmp-'+key+'" data-src="sd_hist"><div class="tile-head"><h2>Crop-year comparison — '+GMETA[key].name+' <span class="h2note">USA, Canada, Ontario and Brazil side by side · same units (MMT = million metric tonnes)</span></h2>'+xpandBtn('cmp-'+key)+'</div>'+ctrl+body+
    '<div class="stamp">'+notes.join(' · ')+'</div></div>';
}
/* ruler: row (CSS hover) + every cell of the same crop year */
function cmpRuler(ev){
  var tile=ev.target.closest?ev.target.closest('[id^="cmp-"]'):null; if(!tile) return;
  tile.querySelectorAll('.ruler-col').forEach(function(c){ c.classList.remove('ruler-col'); });
  var td=ev.target.closest('td[data-y], th[data-y]'); if(!td) return;
  tile.querySelectorAll('[data-y="'+td.getAttribute('data-y')+'"]').forEach(function(c){ c.classList.add('ruler-col'); });
}
document.addEventListener('mouseover', cmpRuler); document.addEventListener('click', cmpRuler);
function cmpRefresh(){ ['corn','wheat','soybeans'].forEach(function(k){ var el=document.getElementById('cmp-'+k); if(el) el.outerHTML=cropCompareHTML(k); }); xpandSync(); }
document.addEventListener('change', function(ev){
  var t=ev.target; if(!t||!t.getAttribute||!t.hasAttribute('data-cmp')) return;
  CMP[t.getAttribute('data-cmp')]=t.checked; cmpSave(); cmpRefresh();
});
document.addEventListener('click', function(ev){ var b=ev.target.closest&&ev.target.closest('[data-cmpset]'); if(!b) return; CMP[b.getAttribute('data-cmpset')]=b.getAttribute('data-v'); cmpSave(); cmpRefresh(); });

/* ================= FARM INPUT COSTS ================= */
var INPUT_MAP={
  corn:[['urea','Nitrogen — urea (46-0-0); tracks anhydrous & UAN'],['ppi_n','Nitrogen fertilizer basket (anhydrous, urea, UAN)'],['natgas','Nitrogen feedstock + grain drying'],['propane','Grain drying'],['ulsd','Field machinery'],['ppi_chem','Herbicides (atrazine) & other ag chemicals'],['wti','Energy baseline']],
  soybeans:[['dap','Phosphorus — DAP (tracks MAP)'],['potash','Potash (0-0-60)'],['ppi_p','Phosphate fertilizer basket'],['ppi_chem','Herbicides (glyphosate) & other ag chemicals'],['ulsd','Field machinery'],['wti','Energy baseline']],
  wheat:[['urea','Nitrogen — urea'],['dap','Phosphorus — DAP'],['potash','Potash (0-0-60)'],['ppi_n','Nitrogen fertilizer basket'],['ppi_chem','Fungicides & other ag chemicals'],['ulsd','Multiple field passes'],['wti','Energy baseline']]
};
function inPts(s, yrs){ var cut=new Date(); cut.setFullYear(cut.getFullYear()-(yrs||2)); var c=cut.toISOString().slice(0,10); return s.pts.filter(function(p){ return p[0]>=c; }); }
function chgOver(s, days){ var P=s.pts, L=P[P.length-1], t=new Date(L[0]); t.setDate(t.getDate()-days); var c=t.toISOString().slice(0,10);
  var b=null; for(var i=P.length-1;i>=0;i--){ if(P[i][0]<=c){ b=P[i]; break; } } return b?(L[1]/b[1]-1)*100:null; }
function inFmt(s, v){ return s.unit==='index'?fmt(v,1):s.unit==='$/mt'?'$'+fmt(v,0):s.unit==='$/bbl'?'$'+fmt(v,2):'$'+fmt(v,3); }
function inputEvents(key){ var E=(DATA.inputs&&DATA.inputs.events)||[]; return E.map(function(e,i){ return Object.assign({n:i+1},e); }).filter(function(e){ return e.tags.indexOf('*')>=0||e.tags.indexOf(key)>=0; }); }
function inputsNextEvent(){
  var now=Date.now(), out=[];
  for(var i=0;i<10;i++){ var x=new Date(now+i*86400000), p={};
    new Intl.DateTimeFormat('en-US',{timeZone:'America/Toronto',year:'numeric',month:'numeric',day:'numeric',weekday:'short'}).formatToParts(x).forEach(function(q){ p[q.type]=q.value; });
    if(p.weekday==='Wed') out.push({t:zonedMs(+p.year,+p.month,+p.day,10,30,'America/Toronto'),label:'EIA weekly petroleum (diesel, propane)'});
    if(p.weekday==='Thu') out.push({t:zonedMs(+p.year,+p.month,+p.day,10,30,'America/Toronto'),label:'EIA natural gas storage'}); }
  fxEvList().forEach(function(e){ if(/PPI/.test(e.label)&&/USD/.test(e.label)) out.push({t:e.t,label:'US PPI (fertilizer & chemical indexes)'}); });
  return nextOf(out);
}
function inputsHTML(key){
  var I=DATA.inputs, S=I&&I.series;
  if(!S||!Object.keys(S).length) return '<div class="tile wide"><h2>Input costs</h2><p class="note">Fertilizer, chemical and energy prices load on the next data refresh.</p></div>';
  var g=DATA.grains[key], F=+g.fan.intraday[0], bpm=BU_PER_MT[key], list=INPUT_MAP[key].filter(function(x){ return S[x[0]]; });
  var rows=list.map(function(x){ var s=S[x[0]], L=s.pts[s.pts.length-1], c1=chgOver(s,31), c3=chgOver(s,92), c12=chgOver(s,365), c24=chgOver(s,730);
    function c(v){ return v==null?'<td class="cmp-na">—</td>':'<td class="'+cls(-v)+'">'+sgn(v,1,'%')+'</td>'; }
    return '<tr><td class="lbl" data-l=""><b>'+esc(s.label)+'</b><br><small class="h2note">'+esc(x[1])+'</small></td><td data-l="Latest"><b>'+inFmt(s,L[1])+'</b><br><small class="h2note">'+esc(s.unit)+' · '+esc(L[0])+'</small></td>'+c(c1)+c(c3)+c(c12)+c(c24)+'<td data-l="2-yr trend">'+sparkPath(inPts(s,2).map(function(p){ return p[1]; }),110,26)+'</td></tr>'; }).join('');
  var avg=list.map(function(x){ return chgOver(S[x[0]],365); }).filter(function(v){ return v!=null; });
  var pres=avg.length?avg.reduce(function(a,b){ return a+b; },0)/avg.length:null;
  var aff='';
  var fert=key==='soybeans'?(S.potash?['potash','potash']:S.dap?['dap','DAP']:null):(S.urea?['urea','urea']:null);
  if(fert){ var fp=S[fert[0]].pts[S[fert[0]].pts.length-1][1]; aff='<div class="dash-card"><div class="dk">Affordability</div><div class="dv">'+fmt(fp/F,0)+'<small> bu of '+GMETA[key].name.toLowerCase()+' buys 1 t of '+fert[1]+'</small></div><div class="dsub">'+fert[1]+' $'+fmt(fp,0)+'/t ('+esc(S[fert[0]].pts[S[fert[0]].pts.length-1][0].slice(0,7))+') ÷ '+esc(GMETA[key].contract)+' $'+fmt(F,4)+'/bu · higher = inputs dearer vs the crop</div></div>'; }
  var top='<div class="dash-grid">'+
    '<div class="dash-card"><div class="dk">Input pressure · 1-yr</div><div class="dv '+cls(-(pres||0))+'">'+(pres==null?'—':sgn(pres,1,'%'))+'</div><div class="dsub">simple average of the 1-yr change of the '+avg.length+' inputs below (not cost-weighted)</div></div>'+aff+
    '<div class="dash-card"><div class="dk">Latest event</div><div class="dsub">'+(function(){ var E=(DATA.inputs.events||[]), e=E[E.length-1]; return e?'<b>'+esc(e.date)+'</b> · '+esc(e.label):'—'; })()+'</div></div></div>';
  var html='<div class="tile wide" data-src="inputs"><div class="tile-head"><h2>'+GMETA[key].name+' input costs <span class="h2note">— fertilizer, chemicals, energy · 2-year view</span></h2></div>'+top+
    '<div class="tbl-scroll" style="margin-top:10px"><table class="sd-tbl cmp-tbl"><thead><tr><th>Input · role</th><th>Latest</th><th>1M</th><th>3M</th><th>1Y</th><th>2Y</th><th>2-yr trend</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<div class="stamp">Red = input dearer (bad for margins), green = cheaper · energy spot prices and producer price indexes · fertilizer (urea, DAP, potash, $/mt, monthly) · checked '+esc(asOf('inputs',true))+' · seed and retail chemical prices have no free daily feed — a pesticide price index stands in for glyphosate/atrazine</div></div>';
  /* charts: one per input, with numbered event markers */
  var charts=list.map(function(x){ var s=S[x[0]], pts=inPts(s,2), L=pts[pts.length-1], c24=chgOver(s,730);
    var ev=inputEvents(x[0]).filter(function(e){ return e.date>=pts[0][0]; }).map(function(e){ return Object.assign({sk:x[0]},e); });
    return '<div class="mpanel"><h3 class="mp-h">'+esc(s.label)+': <b>'+inFmt(s,L[1])+'</b>'+(c24!=null?', <span class="'+cls(-c24)+'">'+sgn(c24,1,'%')+'</span> in 2 yrs':'')+'</h3>'+
      lineChartSVG({series:[{pts:pts,color:s.kind==='energy'?'#e8a33d':s.kind==='chem'?'#c084fc':'#5fd598',label:'Last'}],yLabel:s.unit,dec:s.unit==='index'?1:s.unit==='$/mt'?0:2,H:200,events:ev,aria:s.label+' over two years'})+
      '<div class="stamp">'+esc(s.unit)+(ev.length?' · '+ev.length+' event marker'+(ev.length>1?'s':''):'')+'</div></div>'; }).join('');
  html+='<div class="tile wide" data-src="inputs"><h2>Two-year price paths with key events <span class="h2note">— hover or tap a numbered marker to see the event and its price impact · click to pin</span></h2><div class="mpanels">'+charts+'</div></div>';
  return html;
}

/* ================= NEXT RELEASE DATES (official calendars in DATA.release_cal) ================= */
function nextRelease(key){
  var C=DATA.release_cal&&DATA.release_cal[key]; if(!C) return null;
  var now=Date.now(), list=[];
  (C.dates||[]).forEach(function(s){ var p=s.split('T'), d=p[0].split('-'), h=p[1].split(':'); list.push(zonedMs(+d[0],+d[1],+d[2],+h[0],+h[1],'America/Toronto')); });
  if(C.rule==='thu0830'){ for(var i=0;i<14;i++){ var x=new Date(now+i*86400000), q={};
      new Intl.DateTimeFormat('en-US',{timeZone:'America/Toronto',year:'numeric',month:'numeric',day:'numeric',weekday:'short'}).formatToParts(x).forEach(function(z){ q[z.type]=z.value; });
      var thanks=(+q.month===11&&q.weekday==='Thu'&&+q.day>=22&&+q.day<=28), thanksWed=(+q.month===11&&q.weekday==='Wed'&&+q.day>=21&&+q.day<=27);
      if((q.weekday==='Thu'&&!thanks)||thanksWed) list.push(zonedMs(+q.year,+q.month,+q.day,8,30,'America/Toronto')); } }
  var t=list.filter(function(v){ return v>now; }).sort(function(a,b){ return a-b; })[0];
  return {t:t||null, note:C.note||'', src:C.src, rule:C.rule};
}
function nextReleaseHTML(key, compact){
  var n=nextRelease(key); if(!n) return '';
  if(!n.t) return '<div class="mnext">Next: <span class="neu">'+esc(n.note||'date not published')+'</span></div>';
  var now=Date.now(), est=/estimated/.test(n.note);
  return '<div class="mnext" title="'+esc(n.note||'')+'">Next'+(est?' (est.)':'')+': <b>'+etLabel(n.t,true)+'</b>'+(compact?'':' ET')+' · <span class="countdown" data-t="'+n.t+'">'+cdText(n.t-now)+'</span></div>';
}

/* ================= TRADE & FISCAL BALANCES ================= */
function money(ccy,v){ return (v<0?'\u2212':'')+ccy+fmt(Math.abs(v),1)+'B'; }
function extSeries(k){ var X=DATA.ext||{}; return X[k]||null; }
function extRow(label, key, unit, ccy, calKey, goodUp){
  var S=extSeries(key); if(!S||!S.pts||S.pts.length<2) return '<tr><td class="lbl">'+esc(label)+'</td><td colspan="6" class="cmp-na">loads on the next refresh</td></tr>';
  var P=S.pts, L=P[P.length-1], pv=P[P.length-2], y1=P.length>12?P[P.length-13]:null, ch=L[1]-pv[1];
  var good=goodUp?ch:-ch;
  return '<tr><td class="lbl" data-l=""><b>'+esc(label)+'</b></td>'+
    '<td data-l="Latest"><b>'+money(ccy,L[1])+'</b><br><small class="h2note">'+esc(mLabel(L[0]+'-01'))+'</small></td>'+
    '<td data-l="Prior">'+money(ccy,pv[1])+'</td><td data-l="Net change" class="'+cls(good)+'">'+sgn(ch,1,'B')+'</td>'+
    '<td data-l="1 yr ago">'+(y1?money(ccy,y1[1]):'—')+'</td>'+
    '<td data-l="2-yr trend">'+sparkPath(P.slice(-24).map(function(p){ return p[1]; }),110,26)+'</td>'+
    '<td data-l="Next release">'+nextReleaseHTML(calKey,true)+'</td></tr>';
}
function extAt(k, ym){ var S=extSeries(k); if(!S||!S.pts) return null; for(var i=0;i<S.pts.length;i++) if(S.pts[i][0]===ym) return S.pts[i][1]; return null; }
function mathLine(a,b,ccy){ var d=a-b, f=function(v){ return (v<0?'\u2212':'')+fmt(Math.abs(v),2); }; return '<div class="bt-math">'+f(a)+' \u2212 '+f(b)+' = <b>'+f(d)+'</b> '+ccy+'B</div>'; }
function tipRow(lab, v, ccy, strong, extra){ return v==null?'':'<div class="bt-row'+(strong?' bt-strong':'')+'"><span>'+lab+'</span><b class="'+(strong?cls(v):'')+'">'+money(ccy,v)+'</b>'+(extra?'<small>'+extra+'</small>':'')+'</div>'; }
function extTip(key, ym, prevYm, ccy){
  var MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
  var head='<div class="bt-h">'+MN[+ym.slice(5,7)-1]+' '+ym.slice(0,4)+'</div>', b='', pct=function(a,t){ return (a!=null&&t)?fmt(a/t*100,0)+'% of total':''; };
  if(key==='us_trade_bal'){ var ex=extAt('us_exports',ym), im=extAt('us_imports',ym);
    b=tipRow('Exports',ex,ccy)+tipRow('− Imports',im,ccy)+tipRow('= Trade balance',extAt('us_trade_bal',ym),ccy,true)+(ex!=null&&im!=null?mathLine(ex,im,ccy):'')+
      ((extAt('us_goods_bal',ym)!=null)?'<div class="bt-sub">made up of</div>'+tipRow('Goods balance',extAt('us_goods_bal',ym),ccy)+tipRow('Services balance',extAt('us_serv_bal',ym),ccy):''); }
  else if(key==='us_deficit'){ var rc=extAt('us_receipts',ym), ou=extAt('us_outlays',ym);
    b=tipRow('Receipts (taxes & other)',rc,ccy)+tipRow('− Outlays (spending)',ou,ccy)+tipRow('= Budget balance',extAt('us_deficit',ym),ccy,true)+(rc!=null&&ou!=null?mathLine(rc,ou,ccy):'');
    var fy=+ym.slice(5,7)>=10?+ym.slice(0,4):+ym.slice(0,4)-1, cum=0, ok=false;
    (extSeries('us_deficit').pts||[]).forEach(function(p){ var y=+p[0].slice(0,4), m=+p[0].slice(5,7); if(p[0]<=ym && ((y===fy&&m>=10)||(y===fy+1&&m<=9))){ cum+=p[1]; ok=true; } });
    if(ok) b+='<div class="bt-sub">fiscal year '+(fy+1)+' to date (from October)</div>'+tipRow('Cumulative balance',cum,ccy,true); }
  else if(key==='ca_trade_bal'){ var ce=extAt('ca_exports',ym), ci=extAt('ca_imports',ym), ceu=extAt('ca_exports_us',ym), ciu=extAt('ca_imports_us',ym);
    b=tipRow('Exports',ce,ccy)+tipRow('− Imports',ci,ccy)+tipRow('= Trade balance',extAt('ca_trade_bal',ym),ccy,true)+(ce!=null&&ci!=null?mathLine(ce,ci,ccy):'')+
      (ceu!=null?'<div class="bt-sub">with the United States</div>'+tipRow('Exports to US',ceu,ccy,false,pct(ceu,ce))+tipRow('Imports from US',ciu,ccy,false,pct(ciu,ci))+tipRow('Balance with US',(ceu!=null&&ciu!=null)?ceu-ciu:null,ccy,true):''); }
  else if(key==='ca_fiscal_series'){ var F=DATA.ext.ca_fiscal||{}, c=(F.components||{})[ym];
    b=c?tipRow('Revenues',c.rev,ccy)+tipRow('− Program expenses',c.prog,ccy)+tipRow('− Public debt charges',c.debt,ccy)+(c.act!=null?tipRow('− Net actuarial losses',c.act,ccy):''):'<div class="bt-sub">revenue / expense split not available for this month</div>';
    b+=tipRow('= Budgetary balance',extAt('ca_fiscal_series',ym),ccy,true);
    if(c&&c.rev!=null&&Math.abs(c.rev-(c.prog||0)-(c.debt||0)-(c.act||0)-c.bal)<0.05) b+='<div class="bt-math">'+fmt(c.rev,2)+' \u2212 '+fmt(c.prog||0,2)+' \u2212 '+fmt(c.debt||0,2)+(c.act?' \u2212 '+fmt(c.act,2):'')+' = <b>'+(c.bal<0?'\u2212':'')+fmt(Math.abs(c.bal),2)+'</b> C$B</div>';
    if(F.notes&&F.notes_ref===ym) b+='<div class="bt-note">'+F.notes.map(esc).join('<br>')+'</div>'; }
  var cur=extAt(key,ym), pv=prevYm?extAt(key,prevYm):null;
  if(cur!=null&&pv!=null) b+='<div class="bt-chg">vs prior month: <b class="'+cls(cur-pv)+'">'+sgn(cur-pv,1,'B')+'</b></div>';
  return head+b;
}
function extBars(key, title, ccy){
  var S=extSeries(key); if(!S||!S.pts||S.pts.length<3) return '';
  var P0=S.pts.slice(-24), L=P0[P0.length-1], by={}; P0.forEach(function(p){ by[p[0]]=p[1]; });
  var P=[], y=+P0[0][0].slice(0,4), m=+P0[0][0].slice(5,7);       /* continuous months: gaps (e.g. combined Fiscal Monitor issues) stay empty */
  while(true){ var ym=y+'-'+String(m).padStart(2,'0'); P.push([ym, by[ym]==null?null:by[ym]]); if(ym>=L[0]) break; m++; if(m>12){ m=1; y++; } }
  P=P.slice(-24);
  var bars=P.map(function(p,i){ return [p[0], p[1], i===P.length-1]; });
  var tips=P.map(function(p,i){ return extTip(key, p[0], i?P[i-1][0]:null, ccy); });
  return '<div class="mpanel has-flag">'+cflag(key.slice(0,2))+'<h3 class="mp-h">'+title+': <b>'+money(ccy,L[1])+'</b> ('+esc(mLabel(L[0]+'-01'))+')</h3>'+
    barChartSVG({bars:bars,yLabel:ccy+' billions',dec:1,H:220,months:P.map(function(p){ return p[0]; }),tips:tips})+
    '<div class="stamp">Last 24 months · hover or tap a bar for what makes up the number</div></div>';
}
/* exports vs imports (dots + OLS trendlines) over balance bars, one hover/click column per month */
function olsFit(vals){ var pts=vals.map(function(v,i){ return [i,v]; }).filter(function(p){ return p[1]!=null; }), n=pts.length; if(n<3) return null;
  var sx=0,sy=0,sxx=0,sxy=0; pts.forEach(function(p){ sx+=p[0]; sy+=p[1]; sxx+=p[0]*p[0]; sxy+=p[0]*p[1]; }); var b=(n*sxy-sx*sy)/(n*sxx-sx*sx), a=(sy-b*sx)/n; return {a:a,b:b}; }
function flowComboSVG(o){
  /* o: {months, inflow:{label,vals,color}, outflow:{label,vals,color}, bal, ccy, tips, inLab, outLab} */
  var tid='b'+(++BTN); BTIPS[tid]=o.tips;
  var M=o.months, n=M.length, W=760, PL=52, PR=118, pw=W-PL-PR, T1=26, H1=170, T2=T1+H1+22, H2=120, Y0=T2+H2, H=Y0+62;
  var bw=pw/n, s='', MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function X(i){ return PL+bw*i+bw/2; }
  var lv=o.inflow.vals.concat(o.outflow.vals).filter(function(v){ return v!=null; }), lo=Math.min.apply(null,lv), hi=Math.max.apply(null,lv), pd=(hi-lo)*0.12||1; lo-=pd; hi+=pd;
  function YL(v){ return T1+H1*(1-(v-lo)/(hi-lo)); }
  var bv=o.bal.filter(function(v){ return v!=null; }), blo=Math.min(0,Math.min.apply(null,bv)), bhi=Math.max(0,Math.max.apply(null,bv)), bp=(bhi-blo)*0.12||1; blo-=bp; bhi+=bp;
  function YB(v){ return T2+H2*(1-(v-blo)/(bhi-blo)); }
  /* hit/highlight columns first so they sit behind everything */
  M.forEach(function(m,i){ var a_=o.inflow.vals[i], b_=o.outflow.vals[i], c_=o.bal[i];
    s+='<g class="btip fcol" data-tid="'+tid+'" data-i="'+i+'" data-trk="'+X(i).toFixed(1)+','+(a_==null?'':YL(a_).toFixed(1))+','+(b_==null?'':YL(b_).toFixed(1))+','+(c_==null?'':YB(c_).toFixed(1))+'" tabindex="0"><rect class="colbg" x="'+(PL+bw*i).toFixed(1)+'" y="'+(T1-6)+'" width="'+bw.toFixed(1)+'" height="'+(H-T1-2)+'" rx="3" fill="transparent"/></g>'; });
  /* panel titles + grids */
  s+='<text x="'+PL+'" y="'+(T1-10)+'" fill="#c9d6e6" font-size="11" font-weight="700" font-family="IBM Plex Mono">'+esc(o.inLab||'EXPORTS vs IMPORTS')+' ('+o.ccy+' B)</text>';
  s+='<text x="'+PL+'" y="'+(T2-8)+'" fill="#c9d6e6" font-size="11" font-weight="700" font-family="IBM Plex Mono">'+esc(o.balLab||'BALANCE')+' ('+o.ccy+' B)</text>';
  niceTicks(lo,hi,4).forEach(function(v){ s+='<line x1="'+PL+'" x2="'+(PL+pw)+'" y1="'+YL(v).toFixed(1)+'" y2="'+YL(v).toFixed(1)+'" stroke="#1e2a3a" pointer-events="none"/><text x="'+(PL-6)+'" y="'+(YL(v)+3.5).toFixed(1)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="end" pointer-events="none">'+fmt(v,0)+'</text>'; });
  niceTicks(blo,bhi,3).forEach(function(v){ s+='<line x1="'+PL+'" x2="'+(PL+pw)+'" y1="'+YB(v).toFixed(1)+'" y2="'+YB(v).toFixed(1)+'" stroke="#1e2a3a" pointer-events="none"/><text x="'+(PL-6)+'" y="'+(YB(v)+3.5).toFixed(1)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="end" pointer-events="none">'+fmt(v,Math.abs(bhi-blo)<12?1:0)+'</text>'; });
  s+='<line x1="'+PL+'" x2="'+(PL+pw)+'" y1="'+YB(0)+'" y2="'+YB(0)+'" stroke="#3a4a61" pointer-events="none"/>';
  /* balance bars */
  o.bal.forEach(function(v,i){ if(v==null) return; var y=YB(v), b0=YB(0); s+='<rect class="bbar" data-bi="'+i+'" x="'+(PL+bw*i+bw*0.18).toFixed(1)+'" y="'+Math.min(y,b0).toFixed(1)+'" width="'+(bw*0.64).toFixed(1)+'" height="'+Math.max(1,Math.abs(b0-y)).toFixed(1)+'" rx="2" fill="'+(v<0?'#e0655f':(i===n-1?'#38b6c9':'#3fb97f'))+'" pointer-events="none"/>'; });
  /* lines + dots + OLS trendlines */
  var labs=[];
  [o.inflow,o.outflow].forEach(function(S){
    var d='', st=false; S.vals.forEach(function(v,i){ if(v==null){ st=false; return; } d+=(st?'L':'M')+X(i).toFixed(1)+' '+YL(v).toFixed(1); st=true; });
    s+='<path d="'+d+'" fill="none" stroke="'+S.color+'" stroke-width="1.6" opacity=".55" pointer-events="none"/>';
    S.vals.forEach(function(v,i){ if(v!=null) s+='<circle cx="'+X(i).toFixed(1)+'" cy="'+YL(v).toFixed(1)+'" r="3" fill="'+S.color+'" pointer-events="none"/>'; });
    var f=olsFit(S.vals); if(f){ s+='<line x1="'+X(0).toFixed(1)+'" x2="'+X(n-1).toFixed(1)+'" y1="'+YL(f.a).toFixed(1)+'" y2="'+YL(f.a+f.b*(n-1)).toFixed(1)+'" stroke="'+S.color+'" stroke-width="2" stroke-dasharray="6 4" pointer-events="none"/>'; }
    var last=S.vals[n-1]; if(last!=null) labs.push({y:YL(last), t:S.label+' '+fmt(last,1), c:S.color, tr:f?'trend '+(f.b>=0?'+':'−')+fmt(Math.abs(f.b),2)+'/mo':''});
  });
  labs.sort(function(a,b){ return a.y-b.y; }); if(labs.length===2&&labs[1].y-labs[0].y<26) labs[1].y=labs[0].y+26;
  labs.forEach(function(l){ s+='<text x="'+(PL+pw+8)+'" y="'+(l.y+2).toFixed(1)+'" fill="'+l.c+'" font-size="11" font-weight="700" font-family="IBM Plex Mono" pointer-events="none">'+esc(l.t)+'</text><text x="'+(PL+pw+8)+'" y="'+(l.y+14).toFixed(1)+'" fill="'+l.c+'" font-size="9.5" font-family="IBM Plex Mono" opacity=".85" pointer-events="none">'+l.tr+'</text>'; });
  var lb=o.bal[n-1]; if(lb!=null) s+='<text x="'+(PL+pw+8)+'" y="'+(YB(lb)+4).toFixed(1)+'" fill="'+(lb<0?'#ff9d97':'#5fd598')+'" font-size="11" font-weight="700" font-family="IBM Plex Mono" pointer-events="none">Bal '+money(o.ccy,lb)+'</text>';
  /* x axis: month, year, and the two values under every bar */
  var vy=Y0+14;
  s+='<text x="'+(PL-6)+'" y="'+(vy)+'" fill="'+o.inflow.color+'" font-size="9" font-weight="700" font-family="IBM Plex Mono" text-anchor="end" pointer-events="none">'+o.inflow.short+'</text><text x="'+(PL-6)+'" y="'+(vy+12)+'" fill="'+o.outflow.color+'" font-size="9" font-weight="700" font-family="IBM Plex Mono" text-anchor="end" pointer-events="none">'+o.outflow.short+'</text>';
  M.forEach(function(m,i){ var cx=X(i).toFixed(1), mo=+m.slice(5,7), a=o.inflow.vals[i], b=o.outflow.vals[i], big=Math.max(Math.abs(a||0),Math.abs(b||0))>=100;
    s+='<text x="'+cx+'" y="'+vy+'" fill="'+o.inflow.color+'" font-size="'+(big?7.5:8.5)+'" font-family="IBM Plex Mono" text-anchor="middle" pointer-events="none">'+(a==null?'':fmt(a,0))+'</text>';
    s+='<text x="'+cx+'" y="'+(vy+12)+'" fill="'+o.outflow.color+'" font-size="'+(big?7.5:8.5)+'" font-family="IBM Plex Mono" text-anchor="middle" pointer-events="none">'+(b==null?'':fmt(b,0))+'</text>';
    s+='<text x="'+cx+'" y="'+(vy+27)+'" fill="#8494ab" font-size="9.5" font-family="IBM Plex Mono" text-anchor="middle" pointer-events="none">'+MN[mo-1]+'</text>';
    if(mo===1||i===0) s+='<text x="'+(PL+bw*i+2).toFixed(1)+'" y="'+(vy+41)+'" fill="#c9d6e6" font-size="10.5" font-weight="700" font-family="IBM Plex Mono" pointer-events="none">'+m.slice(0,4)+'</text>'+(i>0?'<line x1="'+(PL+bw*i).toFixed(1)+'" x2="'+(PL+bw*i).toFixed(1)+'" y1="'+T1+'" y2="'+(vy+43)+'" stroke="#2b3e5c" stroke-dasharray="2 3" pointer-events="none"/>':'');
  });
  s+=trkSVG([o.inflow.color,o.outflow.color,'#e8eef4'], T1, Y0);
  return '<svg viewBox="0 0 '+W+' '+H+'" class="chart-svg flowchart" role="img" aria-label="'+esc(o.aria||'exports, imports and balance')+'">'+s+'</svg>';
}
function flowPanel(kind){
  var cfg={us_trade:{bal:'us_trade_bal',inK:'us_exports',outK:'us_imports',ccy:'$',title:'US trade: exports vs imports',inL:'Exports',outL:'Imports',inS:'EXP',outS:'IMP',top:'EXPORTS vs IMPORTS',bot:'TRADE BALANCE = EXPORTS − IMPORTS'},
           ca_trade:{bal:'ca_trade_bal',inK:'ca_exports',outK:'ca_imports',ccy:'C$',title:'Canada trade: exports vs imports',inL:'Exports',outL:'Imports',inS:'EXP',outS:'IMP',top:'EXPORTS vs IMPORTS',bot:'TRADE BALANCE = EXPORTS − IMPORTS'},
           ca_fiscal:{bal:'ca_fiscal_series',inK:'ca_rev_series',outK:'ca_exp_series',ccy:'C$',title:'Canada federal budget: revenues vs expenses',inL:'Revenues',outL:'Expenses',inS:'REV',outS:'EXP',top:'REVENUES vs TOTAL EXPENSES',bot:'BUDGETARY BALANCE = REVENUES \u2212 EXPENSES'},
           us_fiscal:{bal:'us_deficit',inK:'us_receipts',outK:'us_outlays',ccy:'$',title:'US federal budget: receipts vs outlays',inL:'Receipts',outL:'Outlays',inS:'REC',outS:'OUT',top:'RECEIPTS vs OUTLAYS',bot:'BUDGET BALANCE = RECEIPTS − OUTLAYS'}}[kind];
  var B=extSeries(cfg.bal), I=extSeries(cfg.inK), O=extSeries(cfg.outK); if(!B||!I||!O) return '';
  var first=B.pts[0][0], lastm=B.pts[B.pts.length-1][0], months=[], yy=+first.slice(0,4), mm=+first.slice(5,7);
  while(true){ var ym=yy+'-'+String(mm).padStart(2,'0'); months.push(ym); if(ym>=lastm) break; mm++; if(mm>12){ mm=1; yy++; } }
  months=months.slice(-24);
  var iv=months.map(function(m){ return extAt(cfg.inK,m); }), ov=months.map(function(m){ return extAt(cfg.outK,m); }), bv=months.map(function(m){ return extAt(cfg.bal,m); });
  var tips=months.map(function(m,i){ return extTip(cfg.bal, m, i?months[i-1]:null, cfg.ccy); });
  var L=months.length-1, fi=olsFit(iv), fo=olsFit(ov);
  var read=cfg.inL+' trend '+(fi?(fi.b>=0?'+':'−')+money(cfg.ccy,Math.abs(fi.b)).replace('B','B/month'):'n/a')+', '+cfg.outL.toLowerCase()+' trend '+(fo?(fo.b>=0?'+':'−')+money(cfg.ccy,Math.abs(fo.b)).replace('B','B/month'):'n/a')+
    ' → '+(fi&&fo?((fi.b-fo.b)>=0?'the balance is improving by about '+money(cfg.ccy,Math.abs(fi.b-fo.b))+' a month on trend':'the balance is worsening by about '+money(cfg.ccy,Math.abs(fi.b-fo.b))+' a month on trend'):'');
  return '<div class="mpanel has-flag flowpanel">'+cflag(kind.slice(0,2))+'<h3 class="mp-h">'+cfg.title+' — '+esc(mLabel(months[L]+'-01'))+': '+money(cfg.ccy,iv[L])+' − '+money(cfg.ccy,ov[L])+' = <b class="'+cls(bv[L])+'">'+money(cfg.ccy,bv[L])+'</b></h3>'+
    '<div class="flowwrap">'+flowComboSVG({months:months, inflow:{label:cfg.inL,short:cfg.inS,vals:iv,color:'#5fd598'}, outflow:{label:cfg.outL,short:cfg.outS,vals:ov,color:'#f0a35e'}, bal:bv, ccy:cfg.ccy, tips:tips, inLab:cfg.top, balLab:cfg.bot})+'</div>'+
    '<p class="mdc-read" style="margin:6px 2px 0">'+read+'.</p>'+
    '<div class="stamp">Dots = monthly values, dashed = straight-line trend over 24 months · hover a month for the exact maths · click to highlight a month</div></div>';
}

function tradeFiscalHTML(){
  var X=DATA.ext; if(!X) return '<div class="tile wide"><h2>Trade &amp; fiscal balances</h2><p class="note">US and Canada trade and deficit data load on the next refresh.</p></div>';
  var cf=X.ca_fiscal, showUS=MGEO!=='ca', showCA=MGEO!=='us';
  if(cf&&cf.monthly&&!X.ca_fiscal_series) X.ca_fiscal_series={src:'Finance Canada, Fiscal Monitor', pts:cf.monthly};
  if(cf&&cf.components&&Object.keys(cf.components).length>=3&&!X.ca_rev_series){ var ck=Object.keys(cf.components).sort();
    X.ca_rev_series={src:'Finance Canada, Fiscal Monitor', pts:ck.map(function(k){ return [k, cf.components[k].rev]; })};
    X.ca_exp_series={src:'Finance Canada, Fiscal Monitor', pts:ck.map(function(k){ var c=cf.components[k]; return [k, +((c.prog||0)+(c.debt||0)+(c.act||0)).toFixed(3)]; })}; }
  var usDef=X.us_deficit, us12=usDef&&usDef.pts.length>=12?usDef.pts.slice(-12).reduce(function(a,p){ return a+p[1]; },0):null;
  var head='<tr><th>Series</th><th>Latest</th><th>Prior</th><th>Net change</th><th>1 yr ago</th><th>2-yr trend</th><th>Next release</th></tr>';
  var us=showUS?'<h3 class="m-h">United States <span class="chip inline">USD</span> '+flag('us',15)+'</h3><div class="tbl-scroll"><table class="sd-tbl cmp-tbl ext-tbl">'+head+
      extRow('Trade balance (goods & services)','us_trade_bal','B','$','us_trade',true)+extRow('Exports','us_exports','B','$','us_trade',true)+extRow('Imports','us_imports','B','$','us_trade',false)+
      extRow('Federal budget balance (monthly)','us_deficit','B','$','us_deficit',true)+'</table></div>'+(us12!=null?'<div class="mini-kv"><span>Rolling 12-month federal balance</span><b class="'+cls(us12)+'">'+money('$',us12)+'</b></div>':''):'';
  var ca=showCA?'<h3 class="m-h">Canada <span class="chip inline">CAD</span> '+flag('ca',15)+'</h3><div class="tbl-scroll"><table class="sd-tbl cmp-tbl ext-tbl">'+head+
      extRow('Merchandise trade balance','ca_trade_bal','B','C$','ca_trade',true)+extRow('Exports','ca_exports','B','C$','ca_trade',true)+extRow('Imports','ca_imports','B','C$','ca_trade',false)+
      extRow('Federal budgetary balance (monthly)','ca_fiscal_series','B','C$','ca_fiscal',true)+'</table></div>'+
      (cf&&cf.ytd?'<div class="mini-kv"><span>Fiscal year to date</span><b class="'+cls(cf.ytd.value)+'">'+money('C$',cf.ytd.value)+'</b> '+esc(cf.ytd.period)+(cf.ytd.prior!=null?' vs '+money('C$',cf.ytd.prior)+' a year earlier':'')+'</div>':''):'';
  var charts=(showUS?(flowPanel('us_trade')||extBars('us_trade_bal','US trade balance','$'))+(flowPanel('us_fiscal')||extBars('us_deficit','US federal budget balance','$')):'')+
    (showCA?(flowPanel('ca_trade')||extBars('ca_trade_bal','Canada trade balance','C$'))+(flowPanel('ca_fiscal')||extBars('ca_fiscal_series','Canada federal budgetary balance','C$')):'');
  var errs=X.errors&&Object.keys(X.errors).length?' · waiting on: '+Object.keys(X.errors).join(', '):'';
  return '<div class="tile wide" data-src="ext"><div class="tile-head"><h2>Trade &amp; fiscal balances <span class="h2note">— exports, imports, deficits · 2-year trend · next release</span></h2></div>'+us+ca+
    '<div class="mpanels'+(MGEO==='both'?'':' one')+'">'+charts+'</div>'+
    '<div class="stamp">Negative = deficit · net change = latest minus prior month (green = balance improved / exports up, red = worse) · Verified '+esc(asOf('ext',true))+errs+'</div></div>';
}

/* ================= LIVE USD/CAD (macro view copy) ================= */
function liveFxHTML(){
  var fx=DATA.fx, p=+fx.feed.mid, chg=(p/fx.spot.ref-1)*100, up=chg>=0;
  return '<div class="tile wide live-fx" data-src="fx_spot"><div class="tile-head"><h2>USD/CAD live <span class="h2note">— moves with every tick · colour = vs prior close (green above, red below) · arrow on the price tag = direction of the last tick</span></h2></div>'+
    '<div class="live-fx-row"><div class="live-px"><span data-live="usdcad" data-tick="usd-live" data-roll>'+fmt(p,5)+'</span> <span class="live-chg '+(up?'up':'dn')+'" data-live-chg>'+(up?'▲ ':'▼ ')+sgn(chg,2,'%')+'</span><div class="dsub">vs prior close '+fmt(fx.spot.ref,4)+'</div></div>'+
    '<div class="live-chart" data-live-chart>'+fxIntradaySVG(fxIntradayPoints())+'</div></div></div>';
}

/* ================= MACRO INDICATOR DETAIL CARD (click any macro card) ================= */
var MACRO_INFO={
  us_cpi:['Headline consumer price inflation (BLS), year over year.','Hotter CPI keeps the Fed restrictive → supports USD → USD/CAD up.',['us_core_cpi','us_core_pce']],
  us_core_cpi:['CPI excluding food and energy — the Fed’s preferred read of underlying CPI.','Sticky core = fewer Fed cuts priced → USD-supportive.',['us_cpi','us_core_pce']],
  us_core_pce:['Core PCE price index (BEA) — the Fed’s target measure (2%).','Above-target core PCE limits Fed easing → USD-supportive.',['us_core_cpi','us_cpi']],
  us_nfp:['Monthly change in US nonfarm payrolls (BLS Establishment Survey).','Strong hiring = firmer economy and yields → USD up; weak prints raise cut odds → USD down.',['us_ur','us_ahe','us_claims']],
  us_ur:['US unemployment rate (BLS Household Survey).','A rising rate signals slack → Fed cuts more likely → USD-negative.',['us_nfp','us_claims','us_cclaims']],
  us_claims:['Initial jobless claims, weekly (Department of Labor).','The most timely labour signal: rising claims = cooling jobs market → USD-negative.',['us_cclaims','us_ur']],
  us_cclaims:['Continuing jobless claims — people still receiving benefits.','Rising = slower re-employment → softer labour market → USD-negative.',['us_claims','us_ur']],
  us_ahe:['Average hourly earnings, year over year (BLS).','Wage growth feeds services inflation → firmer = USD-supportive.',['us_nfp','us_core_cpi']],
  us_retail:['Advance retail and food services sales, month over month (Census).','Consumer spending is ~70% of US GDP: strong sales → USD-supportive.',['us_umich','us_gdp']],
  us_gdp:['Real GDP, quarter over quarter at an annualized rate (BEA).','Growth outpacing Canada widens the policy gap → USD/CAD up.',['ca_gdpq','us_retail']],
  us_umich:['University of Michigan consumer sentiment (final reading).','Leading read on spending; weak sentiment → USD-negative at the margin.',['us_retail']],
  ca_cpi:['Canada headline CPI, year over year (Statistics Canada).','Hotter CPI keeps the BoC from easing → CAD-supportive → USD/CAD down.',['ca_trim','ca_median']],
  ca_trim:['CPI-trim — the BoC’s preferred core measure (trims the extremes).','Firm core inflation = fewer BoC cuts → CAD-supportive.',['ca_median','ca_cpi']],
  ca_median:['CPI-median — the BoC’s other preferred core measure.','Firm core inflation = fewer BoC cuts → CAD-supportive.',['ca_trim','ca_cpi']],
  ca_emp:['Monthly change in Canadian employment (Labour Force Survey).','Strong job gains → CAD-supportive (USD/CAD down); losses add pressure on the BoC to cut.',['ca_ur']],
  ca_ur:['Canada unemployment rate (Labour Force Survey).','Rising unemployment → more BoC easing priced → CAD-negative.',['ca_emp']],
  ca_gdp:['Real GDP by industry, month over month (Statistics Canada).','Monthly growth momentum; weak prints raise BoC cut odds → CAD-negative.',['ca_gdpq','ca_retail']],
  ca_retail:['Total retail trade sales, seasonally adjusted, month over month (Statistics Canada).','Consumer demand: strong sales → CAD-supportive; weakness argues for BoC cuts.',['ca_retail_ex','ca_retail_core']],
  ca_retail_ex:['Retail sales excluding motor vehicle & parts dealers — strips out lumpy auto sales.','Cleaner read of underlying consumer demand.',['ca_retail','ca_retail_core']],
  ca_retail_core:['Retail sales excluding gasoline stations and auto dealers — the “core” read.','Removes price-driven gasoline swings: best gauge of spending momentum.',['ca_retail','ca_retail_ex']]
};
function macroAll(){ return (DATA.macro||[]).concat(DATA.macro_extra||[]); }
function mfind(k){ return macroAll().filter(function(m){ return m.key===k; })[0]; }
function mval(m,v){ var u=m.unit==='K'?'K':m.unit; return (m.measure==='m/m'&&v>0?'+':'')+fmt(v,m.dec)+u; }
function consensusFor(m){
  var R=(DATA.fx.releases||[]).filter(function(r){ return r.key===m.key; })[0]; if(!R) return null;
  var a=R.period.split(' '), lab=a[0]+" '"+(a[1]||'').slice(2);
  return lab===m.period?R:null;
}
function streakText(m){
  var h=(m.hist24||m.history).map(function(x){ return x[1]; }), n=h.length, L=h[n-1];
  var isChange=/m\/m|q\/q/.test(m.measure)||m.unit==='K'&&m.measure;
  var out=[];
  if(isChange){ var k=0; for(var i=n-1;i>=0&&((L>0&&h[i]>0)||(L<0&&h[i]<0));i--) k++; if(k>=2) out.push(ordn(k)+' straight '+(L>0?'gain':'decline'));
    var pos=h.filter(function(v){ return v>0; }).length; out.push(pos+' gains in last '+n); }
  else { var u=0,d=0; for(var j=n-1;j>0&&h[j]>h[j-1];j--) u++; for(var j2=n-1;j2>0&&h[j2]<h[j2-1];j2--) d++; if(u>=2) out.push('rising '+u+' readings in a row'); if(d>=2) out.push('falling '+d+' readings in a row'); }
  for(var b=n-2;b>=0;b--){ if((L>=0&&h[b]>=L)||(L<0&&h[b]<=L)){ if(n-2-b>=2) out.push((L>=h[n-2]?'highest':'lowest')+' since '+(m.hist24||m.history)[b][0]); break; } if(b===0) out.push((L>=h[n-2]?'highest':'lowest')+' in '+n+' readings'); }
  return out;
}
/* ---- full history inside the detail pop-up: Chart | Table, 1Y / 2Y / 5Y (from the stored long series, else the last readings) ---- */
var MDH={v:'chart',r:24}; try{ var _m=JSON.parse(localStorage.getItem('desk.mdh')||'{}'); if(_m.v) MDH.v=_m.v; if(_m.r) MDH.r=+_m.r; }catch(e){}
function mdHistPts(m){ var L=m.long&&m.long.length>13?m.long.map(function(x){ return [x[0],x[1]]; }):(m.hist24||m.history).map(function(x){ return [x[0],x[1]]; }); return L.slice(-MDH.r); }
function mdLabel(d){ return /^\d{4}-\d{2}/.test(d)?new Date(d+(d.length===10?'T12:00:00Z':'')).toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'}):d; }
function mdLineSVG(P,m){
  var W=640,H=230,PL=46,PR=14,PT=14,PB=30,pw=W-PL-PR,ph=H-PT-PB,v=P.map(function(x){return x[1];}),mn=Math.min.apply(null,v),mx=Math.max.apply(null,v),rg=(mx-mn)||Math.abs(mx)||1; mn-=rg*.08; mx+=rg*.08;
  var X=function(i){ return PL+(P.length<2?pw/2:i/(P.length-1)*pw); }, Y=function(y){ return PT+(mx-y)/(mx-mn)*ph; }, s='';
  for(var g=0;g<=4;g++){ var gv=mn+(mx-mn)*g/4; s+='<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+Y(gv).toFixed(1)+'" y2="'+Y(gv).toFixed(1)+'" stroke="var(--line)" stroke-width="1"/><text x="'+(PL-6)+'" y="'+(Y(gv)+4).toFixed(1)+'" text-anchor="end" font-size="10.5" fill="var(--faint)" font-family="IBM Plex Mono">'+fmt(gv,m.dec)+'</text>'; }
  if(mn<0&&mx>0) s+='<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+Y(0).toFixed(1)+'" y2="'+Y(0).toFixed(1)+'" stroke="var(--line2)" stroke-dasharray="3 3"/>';
  var step=Math.max(1,Math.ceil(P.length/6)); P.forEach(function(x,i){ if(i%step===0||i===P.length-1) s+='<text x="'+X(i).toFixed(1)+'" y="'+(H-10)+'" text-anchor="'+(i===0?'start':i===P.length-1?'end':'middle')+'" font-size="10.5" fill="var(--faint)" font-family="IBM Plex Mono">'+esc(mdLabel(x[0]))+'</text>'; });
  s+='<polyline fill="none" stroke="#38b6c9" stroke-width="2" stroke-linejoin="round" points="'+P.map(function(x,i){ return X(i).toFixed(1)+','+Y(x[1]).toFixed(1); }).join(' ')+'"/>';
  P.forEach(function(x,i){ s+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(x[1]).toFixed(1)+'" r="'+(i===P.length-1?4.5:7)+'" fill="'+(i===P.length-1?'#38b6c9':'transparent')+'"><title>'+esc(mdLabel(x[0]))+': '+mval(m,x[1])+'</title></circle>'; });
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="'+esc(m.name)+' history">'+s+'</svg>';
}
function mdHistHTML(m){
  var P=mdHistPts(m), btn=function(k,v,t){ return '<button class="mdh-b" data-mdh="'+k+':'+v+'" aria-pressed="'+(MDH[k]==v)+'">'+t+'</button>'; };
  var long=m.long&&m.long.length>13, tbl='<div class="mdh-tw"><table class="mdh-t"><thead><tr><th>Period</th><th>'+esc(m.measure||'Value')+'</th><th>Change</th></tr></thead><tbody>'+
    P.slice().reverse().map(function(x,i,a){ var p=a[i+1]; return '<tr><td>'+esc(mdLabel(x[0]))+'</td><td>'+mval(m,x[1])+'</td><td class="'+(p?(x[1]>p[1]?'up':x[1]<p[1]?'dn':''):'')+'">'+(p?sgn(+(x[1]-p[1]).toFixed(m.dec+1),m.dec):'')+'</td></tr>'; }).join('')+'</tbody></table></div>';
  return '<h4 class="mdc-h">History <span class="mdh-ctl"><span class="mdh-seg">'+btn('v','chart','Chart')+btn('v','table','Table')+'</span>'+(long?'<span class="mdh-seg">'+btn('r',12,'1Y')+btn('r',24,'2Y')+btn('r',60,'5Y')+'</span>':'')+'</span></h4>'+
    '<div class="mdh-body">'+(MDH.v==='table'?tbl:'<div class="mdc-chart">'+mdLineSVG(P,m)+'</div>')+'</div><p class="mdc-read" style="margin-top:4px">'+P.length+' readings · '+esc(mdLabel(P[0][0]))+' to '+esc(mdLabel(P[P.length-1][0]))+(m.src?' · source '+esc(m.src):'')+'</p>';
}
document.addEventListener('click', function(ev){ var b=ev.target.closest&&ev.target.closest('[data-mdh]'); if(!b) return; ev.stopPropagation();
  var kv=b.getAttribute('data-mdh').split(':'); MDH[kv[0]]=kv[0]==='r'?+kv[1]:kv[1]; try{ localStorage.setItem('desk.mdh',JSON.stringify(MDH)); }catch(e){}
  var o=document.getElementById('mdc-overlay'), k=o&&o.getAttribute('data-key'), H=o&&o.querySelector('.mdh-wrap'); if(k&&H) H.innerHTML=mdHistHTML(k.indexOf('cpi:')===0&&window.cpiAsMacro?cpiAsMacro(k.slice(4)):mfind(k)); }, true);
/* ---- chunk 6 (MAC-09 / CH-05): markets around a release — daily closes from 3 sessions before to 5 after, each market on its own
   scale (small multiples, never one shared axis), moves measured from the close before the release. Correlation, not causation. ---- */
var MW={i:0};
var MWK=[['corn','Corn','g','¢'],['wheat','Wheat','g','¢'],['soybeans','Soybeans','g','¢'],['usdcad','USD/CAD','o','pips'],['wti','WTI crude','o','$'],['us10y','US 10Y yield','o','bp'],['dxy','Dollar index','o','']];
function mwSeries(k,t){ var G=DATA.grain_long; if(!G) return null; if(t==='g') return G.series&&G.series[k]?G.series[k].map(function(r){ return [r[0],r[4]]; }):null; return G.other&&G.other[k]||null; }
function mwRelDates(key){ var C=DATA.release_cal&&DATA.release_cal[key], H=(DATA.release_hist&&DATA.release_hist[key])||[], now=Date.now(), seen={};
  var L=H.concat(C&&C.dates||[]).filter(function(x){ if(seen[x]) return false; seen[x]=1; return true; });
  return L.map(function(x){ var p=x.split('T'), d=p[0].split('-'), h=(p[1]||'08:30').split(':'); return {s:x, t:zonedMs(+d[0],+d[1],+d[2],+h[0],+h[1],'America/Toronto'), d:p[0]}; })
    .filter(function(x){ return x.t<=now; }).sort(function(a,b){ return b.t-a.t; }).slice(0,6); }
function mwMove(k,unit,a,b){ if(a==null||b==null) return null; var d=b-a;
  return unit==='bp'?d*100:unit==='pips'?d*1e4:unit==='¢'?d*100:unit==='$'?d:(b/a-1)*100; }
function mwFmt(v,unit){ if(v==null) return '—'; var s=v>0?'+':v<0?'\u2212':''; var a=Math.abs(v);
  return unit==='bp'?s+a.toFixed(1)+' bp':unit==='pips'?s+a.toFixed(0)+' pips':unit==='¢'?s+a.toFixed(1)+'¢':unit==='$'?s+'$'+a.toFixed(2):s+a.toFixed(2)+'%'; }
function mwinHTML(key){
  var R=mwRelDates(key); if(!R.length||!DATA.grain_long) return '';
  if(MW.i>=R.length) MW.i=0; var rel=R[MW.i], late=new Date(rel.t).toLocaleTimeString('en-US',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit'});
  var cards=MWK.map(function(K){ var S=mwSeries(K[0],K[2]); if(!S||S.length<10) return '';
    var r0=-1; for(var i=0;i<S.length;i++){ if(S[i][0]>=rel.d){ r0=i; break; } } if(r0<1) return '<div class="mw-c"><div class="mw-n">'+K[1]+'</div><div class="mw-na">no session after this release yet</div></div>';
    var a=Math.max(0,r0-3), b=Math.min(S.length-1,r0+5), base=S[r0-1][1], P=S.slice(a,b+1), lo=Math.min.apply(null,P.map(function(x){return x[1];})), hi=Math.max.apply(null,P.map(function(x){return x[1];})), rg=(hi-lo)||Math.abs(hi)*0.001||1;
    var W=170,H=58,X=function(i){ return 4+(i-a)/Math.max(1,b-a)*(W-8); }, Y=function(v){ return 6+(hi-v)/rg*(H-12); };
    var d0=mwMove(K[0],K[3],base,S[r0][1]), d5=b>r0?mwMove(K[0],K[3],base,S[b][1]):null;
    var svg='<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'" aria-hidden="true"><line x1="'+X(r0).toFixed(1)+'" x2="'+X(r0).toFixed(1)+'" y1="0" y2="'+H+'" stroke="#e8b93d" stroke-dasharray="3 3"/>'+
      '<line x1="4" x2="'+(W-4)+'" y1="'+Y(base).toFixed(1)+'" y2="'+Y(base).toFixed(1)+'" stroke="var(--line2)" stroke-dasharray="2 3"/>'+
      '<polyline fill="none" stroke="#38b6c9" stroke-width="1.8" points="'+P.map(function(x,j){ return X(a+j).toFixed(1)+','+Y(x[1]).toFixed(1); }).join(' ')+'"/>'+
      '<circle cx="'+X(r0).toFixed(1)+'" cy="'+Y(S[r0][1]).toFixed(1)+'" r="3" fill="#e8b93d"/></svg>';
    var cls=function(v){ return v>0?'up':v<0?'dn':''; };
    return '<div class="mw-c" title="'+esc(K[1])+': close '+S[r0-1][0]+' '+S[r0-1][1]+' → release day '+S[r0][0]+' '+S[r0][1]+(b>r0?' → '+S[b][0]+' '+S[b][1]:'')+'"><div class="mw-n">'+K[1]+'</div>'+svg+
      '<div class="mw-v"><span>'+(r0===S.length-1&&S[r0][0]===new Date().toLocaleDateString('en-CA',{timeZone:'America/Toronto'})?'Today so far':'Release day')+' <b class="'+cls(d0)+'">'+mwFmt(d0,K[3])+'</b></span><span>'+(b>r0?(b-r0)+'d later <b class="'+cls(d5)+'">'+mwFmt(d5,K[3])+'</b>':'after: pending')+'</span></div></div>'; }).join('');
  return '<h4 class="mdc-h">Markets around this release <span class="mdh-ctl"><span class="mdh-seg">'+R.map(function(x,i){ return '<button class="mdh-b" data-mw="'+i+'" aria-pressed="'+(i===MW.i)+'">'+esc(new Date(x.d+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}))+'</button>'; }).join('')+'</span></span></h4>'+
    '<div class="mw-g">'+cards+'</div>'+
    '<p class="mdc-read" style="margin-top:4px">Released '+esc(new Date(rel.t).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',timeZone:'America/Toronto'}))+', '+esc(late)+' ET. Daily closes, 3 sessions before to 5 after; each market on its own scale; moves measured from the close before the release (dashed line), yellow = release-day close. '+
    '<b>Correlation, not causation:</b> other news on the same day moves these markets too. Sources: Yahoo Finance daily closes (grains: continuous front month).</p>';
}
document.addEventListener('click', function(ev){ var b=ev.target.closest&&ev.target.closest('[data-mw]'); if(!b) return; ev.stopPropagation(); MW.i=+b.getAttribute('data-mw');
  var o=document.getElementById('mdc-overlay'), k=o&&o.getAttribute('data-key'), H=o&&o.querySelector('.mw-wrap'); if(k&&H) H.innerHTML=mwinHTML(k); }, true);
function macroDetailHTML(key){
  var m=mfind(key); if(!m) return '<div class="unreach">\u26a0 Sorry, we can\u2019t be reached now <small>\u2014 no data for this indicator yet</small></div>';
  var pend=(typeof awaitingList==='function'?awaitingList():[]).filter(function(x){ return x.sel==='.mcard[data-mkey="'+key+'"]'; })[0], pendHTML='';
  if(pend){ var PM=awaitMsg(pend); pendHTML='<div class="aw-errbox"><div class="aw-t">\u26a0 '+PM.title+'</div><div>'+PM.body+'</div>'+(AW.tries?'<div class="aw-retry">'+AW.tries+' checks so far \u00b7 last check '+(AW.last?hhmmss(AW.last):'\u2014')+'</div>':'')+'</div>'; }
  var info=MACRO_INFO[key]||['',''], H=m.hist24||m.history, vals=H.map(function(x){ return x[1]; }), n=vals.length;
  var avg=function(k){ var a=vals.slice(-k); return a.reduce(function(s,v){ return s+v; },0)/a.length; };
  var C=consensusFor(m), chip='';
  if(C&&C.consensus!=null){ var diff=+(m.value-C.consensus).toFixed(m.dec), inl=Math.abs(diff)<Math.pow(10,-m.dec)/2;
    var better=m.good==='down'?diff<0:diff>0; chip='<span class="mdc-chip '+(inl?'inl':better?'beat':'miss')+'">'+(inl?'INLINE':better?'BEAT':'MISS')+(inl?'':' '+sgn(diff,m.dec))+'</span>'; }
  var ctry=m.group==='us'?'United States':'Canada', ccy=m.group==='us'?'USD':'CAD';
  var rel=m.seen_at?'first seen '+new Date(m.seen_at).toLocaleString('en-US',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET':(C&&C.released?'released '+new Date(C.released).toLocaleString('en-US',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET':'latest period '+m.period);
  var st=streakText(m), a3=avg(Math.min(3,n)), a12=avg(Math.min(12,n)), hi=Math.max.apply(null,vals.slice(-12)), lo=Math.min.apply(null,vals.slice(-12));
  var headline=(m.chg>0?'Up':m.chg<0?'Down':'Unchanged')+' from '+mval(m,m.prior)+' · '+(m.value>a12?'above':'below')+' its 12-reading average ('+mval(m,+a12.toFixed(m.dec+1))+')'+(st.length?' · '+st[0]:'');
  var isChange=/m\/m|q\/q/.test(m.measure)||key==='us_gdp'||key==='ca_gdpq'||key==='us_nfp'||key==='ca_emp';
  var bars=H.slice(-12).map(function(x,i,a){ return [x[0].replace(" '","’").replace(/^(\w{3})’\d\d$/,'$1'), x[1], i===a.length-1]; });
  var bv=bars.map(function(b){ return b[1]; }), bmin=Math.min.apply(null,bv), bmax=Math.max.apply(null,bv);
  var chart1=barChartSVG({bars:bars,yLabel:(m.measure||'level')+(m.unit?' ('+m.unit+')':''),dec:m.dec,H:220,aria:m.name+' last 12 readings',floor:(!isChange&&bmin>0)?Math.max(0,bmin-(bmax-bmin)*0.6-Math.abs(bmin)*0.02):null});
  var chg=H.slice(-12).map(function(x,i,a){ var p=i?a[i-1][1]:(H.length>12?H[H.length-13][1]:null); return [x[0].replace(" '","’").replace(/^(\w{3})’\d\d$/,'$1'), p==null?null:+(x[1]-p).toFixed(m.dec+1), i===a.length-1]; });
  var chart2=!isChange?barChartSVG({bars:chg,yLabel:'change vs prior',dec:m.dec,H:180}):'';
  var rel3=(info[2]||[]).map(mfind).filter(Boolean).map(function(r){ return '<button class="mdc-rel" data-mkey="'+r.key+'"><span>'+esc(r.name)+(r.measure?' '+r.measure:'')+'</span><b>'+mval(r,r.value)+'</b><small class="'+cls(r.chg)+'">'+sgn(r.chg,r.dec)+'</small></button>'; }).join('');
  var extra=[];
  if(m.level_b!=null) extra.push('Level: C$'+fmt(m.level_b,1)+' billion'+(m.yoy!=null?' · '+sgn(m.yoy,1,'%')+' y/y':''));
  if(m.ecom_b!=null) extra.push('E-commerce C$'+fmt(m.ecom_b,1)+'B'+(m.ecom_share!=null?' ('+fmt(m.ecom_share,1)+'% of retail)':''));
  if(m.gap) extra.push('<b>'+esc(mdLabel(m.gap.period+'-01'))+' released'+(m.gap.mm!=null?': '+sgn(m.gap.mm,1)+'% m/m':'')+'</b> — '+esc(m.gap.why)+(m.group==='us'&&/cpi/.test(key)?' (BLS did not collect October 2025 during the government shutdown)':'')+'. The y/y shown is the latest that exists.');
  if(m.rev) extra.push('Revision: '+esc(m.rev.period)+' '+mval(m,m.rev.from)+' → '+mval(m,m.rev.to));
  if(/cpi|pce|trim|median/.test(key)) extra.push((m.value>2.05?'Above':m.value<1.95?'Below':'At')+' the 2% '+(m.group==='us'?'Fed':'BoC')+' target by '+fmt(Math.abs(m.value-2),1)+' pp');
  var nx=nextRelease(key);
  return pendHTML+'<div class="mdc">'+
    '<div class="mdc-top"><span class="mdc-flag">'+flag(m.group,30)+'</span><div class="mdc-ttl">'+esc(ctry.toUpperCase()+' '+m.name.toUpperCase())+'</div><div class="mdc-sub">'+esc(m.period)+(m.measure?' · '+m.measure:'')+' — '+rel+'</div><div class="mdc-hl">'+headline+'</div></div>'+
    '<div class="mdc-main"><div class="mdc-k">'+esc(m.name)+' — '+esc(m.period)+chip+'</div><div class="mdc-v">'+mval(m,m.value)+(m.measure?' <small>'+m.measure+'</small>':'')+'</div>'+
      '<div class="mdc-l">'+(C&&C.consensus!=null?'Consensus: '+mval(m,C.consensus)+' (desk survey) | ':'Consensus: not captured for this print | ')+'Prior ('+esc(H[n-2]?H[n-2][0]:'')+'): '+mval(m,m.prior)+(m.rev?', rev. from '+mval(m,m.rev.from):'')+'</div></div>'+
    '<div class="mdc-grid"><div class="mdc-box"><div class="mdc-k">3-reading average</div><div class="mdc-v2">'+mval(m,+a3.toFixed(m.dec+1))+'</div><div class="mdc-l">12-reading avg '+mval(m,+a12.toFixed(m.dec+1))+'</div></div>'+
      '<div class="mdc-box"><div class="mdc-k">12-reading range</div><div class="mdc-v2">'+mval(m,lo)+' → '+mval(m,hi)+'</div><div class="mdc-l">latest sits at '+fmt(hi>lo?(m.value-lo)/(hi-lo)*100:50,0)+'% of the range</div></div></div>'+
    (extra.concat(st.slice(1)).length?'<div class="mdc-band">'+extra.concat(st.slice(1)).map(function(t){ return '<div>'+t+'</div>'; }).join('')+'</div>':'')+
    '<h4 class="mdc-h">What it is &amp; why it matters for USD/CAD</h4><p class="mdc-p">'+esc(info[0])+' '+esc(info[1])+'</p>'+
    (/^(us|ca)_(core_)?cpi|^ca_(trim|median)$/.test(key)&&cpiHas(m.group)?cpiDeepBtn(m.group):'')+
    '<div class="mdh-wrap">'+mdHistHTML(m)+'</div>'+(function(){ MW.i=0; var h=mwinHTML(key); return h?'<div class="mw-wrap">'+h+'</div>':''; })()+
    '<h4 class="mdc-h">Trend — '+esc(m.name)+(m.measure?', '+m.measure:'')+', last '+Math.min(12,n)+' readings</h4><div class="mdc-chart">'+chart1+'</div>'+
    (chart2?'<h4 class="mdc-h">Change vs prior reading</h4><div class="mdc-chart">'+chart2+'</div>':'')+
    '<p class="mdc-read">Read: '+st.concat([m.value>a3?'latest above its 3-reading average':'latest below its 3-reading average']).join('; ')+'.</p>'+
    (rel3?'<h4 class="mdc-h">Related indicators <span class="h2note">(tap to open)</span></h4><div class="mdc-rels">'+rel3+'</div>':'')+
    '<div class="mdc-foot">'+(nx&&nx.t?'Next release: <b>'+etLabel(nx.t,true)+' ET</b> · <span class="countdown" data-t="'+nx.t+'">'+cdText(nx.t-Date.now())+'</span>':'Next release: '+esc(nx&&nx.note||'not scheduled'))+' · '+ccy+'</div>'+
    '<button class="mdc-ask" data-mask="'+key+'">Ask Claude about this print</button>'+
  '</div>';
}
function openMacroDetail(key){
  var o=document.getElementById('mdc-overlay');
  if(!o){ o=document.createElement('div'); o.id='mdc-overlay'; o.innerHTML='<div class="mdc-wrap" role="dialog" aria-modal="true"><button class="mdc-x" aria-label="Close">×</button><div class="mdc-body"></div></div>'; document.body.appendChild(o); }
  o.querySelector('.mdc-body').innerHTML=macroDetailHTML(key); o.classList.add('on'); o.setAttribute('data-key',key); o.querySelector('.mdc-wrap').scrollTop=0;
}
function closeMacroDetail(){ var o=document.getElementById('mdc-overlay'); if(o) o.classList.remove('on'); }
document.addEventListener('click', function(ev){
  var t=ev.target.closest?ev.target:null; if(!t) return;
  if(t.closest('.mdc-x')||t.id==='mdc-overlay'){ closeMacroDetail(); return; }
  var a=t.closest('[data-mask]'); if(a){ var m=mfind(a.getAttribute('data-mask'));
    var q='Analyze this '+(m.group==='us'?'US':'Canada')+' '+m.name+' print for a USD/CAD and grain trader. Latest '+m.period+': '+m.value+m.unit+' '+(m.measure||'')+'; prior '+m.prior+'; last readings '+(m.hist24||m.history).map(function(x){ return x[0]+' '+x[1]; }).join(', ')+'. What does it mean for the BoC/Fed path and USD/CAD?';
    window.open('https://claude.ai/new?q='+encodeURIComponent(q),'_blank','noopener'); return; }
  var k=t.closest('[data-mkey]'); if(k){ openMacroDetail(k.getAttribute('data-mkey')); }
});
document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeMacroDetail(); });

/* ---------- rolling ball tracker: dots glide to the hovered session's data points ---------- */
function trkSVG(colors, y0, y1){
  return '<g class="trk" pointer-events="none"><line class="trk-line" x1="0" x2="0" y1="'+y0+'" y2="'+y1+'" stroke="#e8b93d" stroke-width="1" stroke-dasharray="3 3"/>'+
    colors.map(function(c){ return '<g class="trk-ball"><circle r="9" fill="'+c+'" opacity=".22"/><circle r="5" fill="'+c+'" stroke="#0b1220" stroke-width="2"/></g>'; }).join('')+'</g>';
}
function trkMove(g){
  var svg=g.closest('svg'), t=svg&&svg.querySelector('.trk'), d=(g.getAttribute('data-trk')||'').split(','); if(!t||d.length<2) return;
  var x=+d[0], balls=t.querySelectorAll('.trk-ball');
  t.querySelector('.trk-line').style.transform='translate('+x+'px,0)';
  balls.forEach(function(bn,k){ var y=d[k+1]; if(y===''||y==null){ bn.style.opacity=0; return; } bn.style.opacity=1; bn.style.transform='translate('+x+'px,'+(+y)+'px)'; });
  t.classList.add('on');
}
function trkHide(){ document.querySelectorAll('.trk.on').forEach(function(t){ t.classList.remove('on'); }); }

/* ---------- bar breakdown tooltip ---------- */
var BTT=null, BTPIN=null;
function btShow(g, pin){
  var p=document.getElementById('btpop'); if(!p){ p=document.createElement('div'); p.id='btpop'; document.body.appendChild(p); }
  var tips=BTIPS[g.getAttribute('data-tid')]||[]; p.innerHTML=(pin?'<button class="pop-x" aria-label="Close">\u00d7</button>':'')+(tips[+g.getAttribute('data-i')]||''); p.classList.add('on'); p.classList.toggle('pinned',!!pin);
  var r=g.getBoundingClientRect(), w=Math.min(290, window.innerWidth-24); p.style.width=w+'px';
  var left=r.right+8+w<=window.innerWidth-8?r.right+8:(r.left-8-w>=8?r.left-8-w:Math.max(8,window.innerWidth-w-8));
  p.style.left=(left+window.scrollX)+'px'; p.style.top=(Math.max(8,r.top)+window.scrollY)+'px';
  document.querySelectorAll('.btip.act').forEach(function(x){ x.classList.remove('act'); }); g.classList.add('act');
  trkHide(); if(g.hasAttribute('data-trk')) trkMove(g);
  BTY=window.scrollY;
}
function btHideNow(){ if(BTPIN) return; trkHide(); var p=document.getElementById('btpop'); if(p) p.classList.remove('on'); document.querySelectorAll('.btip.act').forEach(function(x){ x.classList.remove('act'); }); }
document.addEventListener('mouseover', function(ev){ var t=ev.target.closest?ev.target:null; if(!t) return; if(t.closest('#btpop')){ clearTimeout(BTT); return; }
  var g=t.closest('.btip'); if(g&&!BTPIN){ clearTimeout(BTT); btShow(g,false); } });
document.addEventListener('mouseout', function(ev){ var t=ev.target.closest?ev.target:null; if(!t) return; var from=t.closest('.btip')||t.closest('#btpop'), to=ev.relatedTarget;
  if(from && !(to && (from.contains(to) || (to.closest&&(to.closest('#btpop')||to.closest('.btip')===from))))){ clearTimeout(BTT); BTT=setTimeout(btHideNow,300); } });
document.addEventListener('click', function(ev){ var g=ev.target.closest&&ev.target.closest('.btip');
  if(g){ BTPIN=(BTPIN===g)?null:g; if(BTPIN) btShow(g,true); else btHideNow(); return; }
  if(BTPIN && (!(ev.target.closest&&ev.target.closest('#btpop')) || ev.target.closest('.pop-x'))){ BTPIN=null; btHideNow(); } });
document.addEventListener('keydown', function(e){ if(e.key==='Escape'){ if(BTPIN){ BTPIN=null; btHideNow(); } if(typeof EVPIN!=='undefined'&&EVPIN){ EVPIN=null; evHideNow(); } } });
var BTY=0;
window.addEventListener('scroll', function(){ if(!BTPIN && Math.abs(window.scrollY-BTY)>40) btHideNow(); }, {passive:true});

/* ---------- event marker popover (input-cost charts) ---------- */
var EVPIN=null;
function evValueAt(S, date, after){ var P=S.pts; for(var i=0;i<P.length;i++){ if(P[i][0]>=date) return P[Math.min(P.length-1,i+(after||0))]; } return null; }
function evPopHTML(n, sk){
  var e=(DATA.inputs.events||[])[n-1], S=DATA.inputs.series[sk]; if(!e) return '';
  var lines='';
  if(S){ var at=evValueAt(S,e.date,0), idx=S.pts.indexOf(at), step=S.pts.length>60?4:1, later=at?S.pts[Math.min(S.pts.length-1, idx+step)]:null, L=S.pts[S.pts.length-1];
    function pc(a,b){ return (b/a-1)*100; }
    if(at){ lines='<div class="evp-row"><span>'+esc(S.label)+' at event</span><b>'+inFmt(S,at[1])+'</b><small>'+esc(at[0])+'</small></div>';
      if(later&&later!==at) lines+='<div class="evp-row"><span>'+(step>1?'~4 weeks':'1 month')+' later</span><b>'+inFmt(S,later[1])+'</b><small class="'+cls(-pc(at[1],later[1]))+'">'+sgn(pc(at[1],later[1]),1,'%')+'</small></div>';
      lines+='<div class="evp-row"><span>Now</span><b>'+inFmt(S,L[1])+'</b><small class="'+cls(-pc(at[1],L[1]))+'">'+sgn(pc(at[1],L[1]),1,'%')+' since event</small></div>'; } }
  var also=(DATA.inputs.events[n-1].tags.indexOf('*')>=0?'all inputs':DATA.inputs.events[n-1].tags.map(function(t){ return DATA.inputs.series[t]?DATA.inputs.series[t].label.replace(/ \(.*\)/,''):t; }).join(', '));
  return '<div class="evp-h"><span class="ev-n">'+n+'</span> '+esc(new Date(e.date+'T12:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}))+'</div><div class="evp-t">'+esc(e.label)+'</div>'+lines+
    '<div class="evp-f">Affected: '+esc(also)+'</div>';
}
function evShow(g, pin){
  var p=document.getElementById('evpop'); if(!p){ p=document.createElement('div'); p.id='evpop'; document.body.appendChild(p); }
  p.innerHTML=evPopHTML(+g.getAttribute('data-evn'), g.getAttribute('data-evsk')); p.classList.add('on'); p.classList.toggle('pinned',!!pin);
  var r=g.querySelector('.evc').getBoundingClientRect(), w=Math.min(300, window.innerWidth-24);
  p.style.width=w+'px';
  var right=r.right+10, left=(right+w<=window.innerWidth-8)?right:(r.left-10-w>=8?r.left-10-w:Math.max(8,Math.min(window.innerWidth-w-8,r.left+r.width/2-w/2)));
  var top=(left===right||left===r.left-10-w)?r.top-6:r.bottom+40;
  p.style.left=(left+window.scrollX)+'px'; p.style.top=(Math.max(8,top)+window.scrollY)+'px';
  document.querySelectorAll('.evm.act').forEach(function(x){ x.classList.remove('act'); }); g.classList.add('act');
}
var EVT=null;
function evHideNow(){ if(EVPIN) return; var p=document.getElementById('evpop'); if(p) p.classList.remove('on'); document.querySelectorAll('.evm.act').forEach(function(x){ x.classList.remove('act'); }); }
function evHide(){ clearTimeout(EVT); EVT=setTimeout(evHideNow, 350); }          /* grace period: lets the mouse travel into the box to click its link */
document.addEventListener('mouseover', function(ev){
  var t=ev.target.closest?ev.target:null; if(!t) return;
  if(t.closest('#evpop')){ clearTimeout(EVT); return; }
  var g=t.closest('.evm'); if(g&&!EVPIN){ clearTimeout(EVT); evShow(g,false); }
});
document.addEventListener('mouseout', function(ev){
  var t=ev.target.closest?ev.target:null; if(!t) return;
  var from=t.closest('.evm')||t.closest('#evpop'), to=ev.relatedTarget;
  if(from && !(to && (from.contains(to) || (to.closest&&(to.closest('#evpop')||to.closest('.evm')===from))))) evHide();
});
document.addEventListener('focusin', function(ev){ var g=ev.target.closest&&ev.target.closest('.evm'); if(g) evShow(g,false); });
document.addEventListener('click', function(ev){
  var g=ev.target.closest&&ev.target.closest('.evm');
  if(g){ var same=EVPIN===g; EVPIN=same?null:g; if(same){ evHide(); } else evShow(g,true); return; }
  if(EVPIN && !(ev.target.closest&&ev.target.closest('#evpop'))){ EVPIN=null; evHide(); }
});
window.addEventListener('scroll', function(){ if(!EVPIN) evHide(); }, {passive:true});

/* ================= COUNTRY FLAGS (inline SVG — renders the same on every OS) ================= */
var MAPLE='50,5 56,22 65,17 62,40 76,28 79,36 93,33 87,48 95,52 72,68 75,77 53,74 53,95 47,95 47,74 25,77 28,68 5,52 13,48 7,33 21,36 24,28 38,40 35,17 44,22';
function flag(cc, h){
  h=h||14;
  if(cc!=='us'&&cc!=='ca') return window.WORLD&&WORLD.flag?WORLD.flag(cc,h):'';   /* other countries use the World flag set; never a wrong country's flag */
  if(cc==='us'){ var w=Math.round(h*1.9), st=''; for(var i=0;i<13;i++) st+='<rect y="'+(i*10/13).toFixed(3)+'" width="19" height="'+(10/13+0.01).toFixed(3)+'" fill="'+(i%2?'#fff':'#B22234')+'"/>';
    var dots=''; for(var yy=0;yy<4;yy++) for(var xx=0;xx<5;xx++) dots+='<circle cx="'+(0.8+xx*1.5+(yy%2?0.75:0)).toFixed(2)+'" cy="'+(0.75+yy*1.35).toFixed(2)+'" r="0.32" fill="#fff"/>';
    return '<svg class="flag" width="'+w+'" height="'+h+'" style="width:'+w+'px;height:'+h+'px" viewBox="0 0 19 10" role="img" aria-label="United States"><title>United States</title>'+st+'<rect width="7.6" height="'+(70/13).toFixed(3)+'" fill="#3C3B6E"/>'+dots+'</svg>'; }
  var w2=h*2;
  return '<svg class="flag" width="'+w2+'" height="'+h+'" style="width:'+w2+'px;height:'+h+'px" viewBox="0 0 200 100" role="img" aria-label="Canada"><title>Canada</title><rect width="200" height="100" fill="#fff"/><rect width="50" height="100" fill="#D52B1E"/><rect x="150" width="50" height="100" fill="#D52B1E"/><g transform="translate(62,12) scale(0.76)"><polygon points="'+MAPLE+'" fill="#D52B1E"/></g></svg>';
}
function flagCcy(ccy, h){ return ccy==='USD'||ccy==='us'?flag('us',h):ccy==='CAD'||ccy==='ca'?flag('ca',h):''; }
function cflag(cc){ return '<span class="cflag">'+flag(cc,16)+'</span>'; }

/* ================= POSITIONING KPIs (z-score, COT index, flow, OI, commercial spread) ================= */
function posK(key){ return key==='fx'?(DATA.fx.pos&&DATA.fx.pos.kpi):(DATA.grains[key].cftc_stats&&DATA.grains[key].cftc_stats.kpi); }
function gaugeHTML(v, lo, hi, marks, fmtv){
  var pct=Math.max(0,Math.min(100,(v-lo)/(hi-lo)*100));
  return '<div class="gauge"><div class="g-track">'+marks.map(function(m){ return '<span class="g-mark" style="left:'+((m-lo)/(hi-lo)*100)+'%"></span>'; }).join('')+
    '<span class="g-dot '+(pct>=80||pct<=20?'hot':'')+'" style="left:'+pct+'%"></span></div><div class="g-lab"><span>'+fmtv(lo)+'</span><span>'+fmtv(hi)+'</span></div></div>';
}
function posState(K){
  var z=K.z52, c=K.cot3, f=[];
  var zs=z>=2?'extreme crowded long':z<=-2?'extreme crowded short':z>=1?'leaning long':z<=-1?'leaning short':'neutral';
  var cs=c>80?'extreme long (3-yr)':c<20?'extreme short (3-yr)':'mid-range';
  var dbl=(z>=2&&c>80)?'long':(z<=-2&&c<20)?'short':null;
  return {zs:zs, cs:cs, dbl:dbl};
}
function flowRead(K){
  if(K.doi_pct==null) return '';
  var up=K.doi_pct>0, nb=K.d1>0;
  return up&&nb?'fresh fund buying — new money entering long':up&&!nb?'fresh shorting — new money entering short':!up&&nb?'short covering — exhaustible, not new buying':'long liquidation — positions unwinding';
}
function positioningKpiHTML(key){
  var K=posK(key), isFx=key==='fx';
  var title=isFx?'Leveraged Funds — CAD futures (TFF report)':'Managed Money — '+GMETA[key].name+' (Disaggregated report)';
  if(!K) return '<div class="tile wide poskpi" data-src="'+(isFx?'cftc_fx':'cftc_grains')+'"><h2>'+(isFx?flag('ca',15):flag('us',15))+' Positioning KPIs <span class="h2note">— '+title+'</span></h2><p class="note">Positioning KPIs load on the next CFTC refresh.</p></div>';
  var S=posState(K), alerts=[];
  if(Math.abs(K.z52)>=2) alerts.push(['hot','52-wk z-score '+sgn(K.z52,2,'σ')+' — '+S.zs]);
  if(K.cot3>80||K.cot3<20) alerts.push(['hot','3-yr COT Index '+fmt(K.cot3,0)+' — '+S.cs]);
  if(S.dbl) alerts.push(['crit','DOUBLE EXTREME '+S.dbl.toUpperCase()+' — high '+(S.dbl==='short'?'short-squeeze':'long-liquidation')+' / mean-reversion risk']);
  if(K.vel_pct_oi!=null&&Math.abs(K.vel_pct_oi)>=2) alerts.push(['warn','Flow velocity '+sgn(K.vel_pct_oi,1,'%')+' of OI in one week']);
  if(Math.abs(K.streak)>=4) alerts.push(['warn',Math.abs(K.streak)+' straight weeks of net '+(K.streak>0?'buying':'selling')]);
  if(K.doi_pct!=null&&Math.abs(K.doi_pct)>=2) alerts.push(['warn','Open interest '+(K.doi_pct>0?'expanding':'contracting')+' '+sgn(K.doi_pct,1,'%')+' w/w']);
  if(K.spread_idx!=null&&(K.spread_idx>=90||K.spread_idx<=10)) alerts.push(['hot','Commercial vs spec spread at a 3-yr extreme ('+fmt(K.spread_idx,0)+')']);
  var sg=function(v){ return (v>0?'+':v<0?'−':'')+fmt(Math.abs(v)); };
  var commLab=isFx?'Dealers (sell-side)':'Producers / merchants';
  var cards=[
    '<div class="pk"><div class="pk-k">52-wk z-score</div><div class="pk-v '+(Math.abs(K.z52)>=2?'hot':'')+'">'+sgn(K.z52,2,'σ')+'</div>'+gaugeHTML(K.z52,-3,3,[-2,0,2],function(v){ return (v>0?'+':'')+v+'σ'; })+'<div class="pk-s">'+S.zs+'</div>'+(K.z_hist&&K.z_hist.length>3?sparkPath(K.z_hist.map(function(x){ return x[1]; }),140,22):'')+'</div>',
    '<div class="pk"><div class="pk-k">3-yr COT Index</div><div class="pk-v '+(K.cot3>80||K.cot3<20?'hot':'')+'">'+fmt(K.cot3,0)+'<small>/100</small></div>'+gaugeHTML(K.cot3,0,100,[20,50,80],function(v){ return v; })+'<div class="pk-s">'+S.cs+'</div>'+(K.cot_hist&&K.cot_hist.length>3?sparkPath(K.cot_hist.map(function(x){ return x[1]; }),140,22):'')+'</div>',
    '<div class="pk '+(S.dbl?'crit':'')+'"><div class="pk-k">Double-extreme flag</div><div class="pk-v">'+(S.dbl?'⚠ '+S.dbl.toUpperCase():'none')+'</div><div class="pk-s">'+(S.dbl?'z-score and COT Index both at extremes — mean reversion / '+(S.dbl==='short'?'short squeeze':'liquidation')+' odds rise':'needs |z| ≥ 2 and COT > 80 or < 20 together')+'</div></div>',
    '<div class="pk"><div class="pk-k">Flow velocity &amp; streak</div><div class="pk-v '+cls(K.d1)+'">'+sg(K.d1)+'<small> w/w</small></div><div class="pk-s">'+(K.vel_pct_oi!=null?sgn(K.vel_pct_oi,2,'%')+' of open interest':'')+'<br>'+(K.streak?Math.abs(K.streak)+' week'+(Math.abs(K.streak)>1?'s':'')+' of net '+(K.streak>0?'buying':'selling'):'flat')+'</div></div>',
    '<div class="pk"><div class="pk-k">Open interest Δ w/w</div><div class="pk-v '+cls(K.doi_pct||0)+'">'+(K.doi_pct!=null?sgn(K.doi_pct,2,'%'):'—')+'</div><div class="pk-s">'+fmt(K.oi)+' contracts<br><b>'+flowRead(K)+'</b></div>'+(K.oi_hist&&K.oi_hist.length>3?sparkPath(K.oi_hist.map(function(x){ return x[1]; }),140,22):'')+'</div>',
    (K.spread_idx!=null?'<div class="pk"><div class="pk-k">Commercial vs spec spread</div><div class="pk-v">'+fmt(K.spread_idx,0)+'<small>/100 (3-yr)</small></div>'+gaugeHTML(K.spread_idx,0,100,[10,50,90],function(v){ return v; })+'<div class="pk-s">Funds '+sg(K.net)+' vs '+commLab.toLowerCase()+' '+sg(K.comm_net)+' (Δ '+sg(K.comm_d1)+')<br>'+(K.spread_idx>=90||K.spread_idx<=10?'<b>extreme divergence — hedgers fully opposite the funds</b>':'within the normal range')+'</div></div>':
      '')
  ];
  var who=isFx?'leveraged funds (hedge funds & CTAs) in CAD futures':'managed money (hedge funds & CTAs) in '+GMETA[key].name.toLowerCase(), bias=isFx?'CAD':GMETA[key].name.toLowerCase();
  function tip(h, what, read, now, why){ return '<div class="bt-h">'+h+'</div><div>'+what+'</div><div class="pk-tip-k">How to read</div><div>'+read+'</div><div class="pk-tip-k">This week</div><div>'+now+'</div><div class="pk-tip-k">Why it matters</div><div>'+why+'</div>'; }
  var tid='b'+(++BTN); BTIPS[tid]=[
    tip('52-week z-score','How far the net position of '+who+' sits from its own 1-year average, in standard deviations. <span class="pk-f">z = (net \u2212 52-wk mean) \u00f7 52-wk st.dev</span>','0 = normal · ±1σ = leaning · beyond ±2σ = statistically extreme crowding (happens ~5% of weeks).','Net '+sg(K.net)+' contracts = '+sgn(K.z52,2,'σ')+' → '+S.zs+'.','Short-term radar for crowding. Extreme longs leave fewer buyers left; extreme shorts are fuel for a squeeze.'),
    tip('3-year COT Index','Where this week’s net position sits inside its 3-year (156-week) range, on a 0–100 scale. <span class="pk-f">100 × (net − 3-yr min) ÷ (3-yr max − min)</span>','0 = most short in 3 years · 100 = most long · above 80 = extreme long · below 20 = extreme short.','Index '+fmt(K.cot3,0)+' → '+S.cs+'.','Puts the weekly number in multi-year context so a big-looking position is judged against the cycle, not one year.'),
    tip('Double-extreme flag','Fires only when the z-score and the COT Index are both extreme on the same side.','Needs z ≥ +2 and COT > 80 (long) or z ≤ −2 and COT < 20 (short).',S.dbl?'<b>Active — '+S.dbl+'</b>.':'Not active — z '+sgn(K.z52,2,'σ')+', COT '+fmt(K.cot3,0)+'.','When short-term and multi-year gauges agree, the odds of mean reversion (or a short squeeze) rise sharply.'),
    tip('Flow velocity & streak','Week-over-week change in the net position, expressed as a % of total open interest, plus how many weeks in a row funds have bought or sold.','A move larger than ±2% of open interest in one week is fast money · 4+ weeks in the same direction = a persistent trend.','Net change '+sg(K.d1)+' ('+(K.vel_pct_oi!=null?sgn(K.vel_pct_oi,2,'%'):'—')+' of OI) · '+Math.abs(K.streak)+' week(s) of net '+(K.streak>0?'buying':'selling')+'.','Shows whether fund money is actively pushing the '+bias+' trend or the move is running out of sponsors.'),
    tip('Open interest change','Weekly % change in the total number of open contracts, read together with the direction of fund flow.','OI up + funds buying = fresh longs · OI up + funds selling = fresh shorts · OI down + funds buying = short covering · OI down + funds selling = long liquidation.','OI '+(K.doi_pct!=null?sgn(K.doi_pct,2,'%'):'—')+' → '+flowRead(K)+'.','Tells you if a move is backed by new money (sustainable) or only by positions closing (can exhaust quickly).'),
    tip('Commercial vs spec spread','The gap between funds’ net position and the '+(isFx?'dealers’ (sell-side banks)':'producers/merchants’ (physical hedgers)')+' net position, ranked in its 3-year range (0–100).','Near 100 = funds most long vs hedgers most short in 3 years · near 0 = the reverse · above 90 or below 10 = extreme.',K.spread_idx!=null?'Spread index '+fmt(K.spread_idx,0)+' · funds '+sg(K.net)+' vs '+(isFx?'dealers':'commercials')+' '+sg(K.comm_net)+'.':'Not loaded yet.','Hedgers trade the physical market. When they take the exact opposite side of the funds at an extreme, tension between fundamentals and momentum is high.')
  ];
  cards=cards.map(function(c,i){ return c?c.replace('<div class="pk','<div tabindex="0" data-tid="'+tid+'" data-i="'+i+'" class="btip pk'):''; });
  if(K.doi_pct==null) cards[4]=''; if(!S.dbl) cards[2]='';
  var CI=checklistItems(key), tid2='b'+(++BTN), nfl=CI.filter(function(c){ return !c.ok; }).length;
  BTIPS[tid2]=CI.map(function(c,i){ return '<div class="bt-h">'+(i+1)+' \u00b7 '+c.t+' <span style="color:'+(c.ok?'#5fd598':'#e8a33d')+';font-weight:700">'+(c.ok?'\u2713 pass':'! flag')+'</span></div><div>'+c.d+'</div><div class="pk-tip-k">What this step checks</div><div>'+c.why+'</div>'; });
  var ckRow='<div class="ck-row"><span class="ck-lab">Weekly review \u00b7 '+(nfl?nfl+' flagged':'all clear')+'</span>'+CI.map(function(c,i){ return '<span tabindex="0" class="btip ck-chip '+(c.ok?'ok':'fl')+'" data-tid="'+tid2+'" data-i="'+i+'"><b>'+(c.ok?'\u2713':'!')+'</b>'+(i+1)+' \u00b7 '+c.t+'</span>'; }).join('')+'</div>';
  return '<div class="tile wide poskpi has-flag" data-src="'+(isFx?'cftc_fx':'cftc_grains')+'">'+cflag(isFx?'ca':'us')+'<h2>Positioning KPIs <span class="h2note">— '+title+' · positions as of '+esc(fmtDate(K.date))+'</span></h2>'+
    (alerts.length?'<div class="pk-alerts">'+alerts.map(function(a){ return '<span class="pk-al '+a[0]+'">'+a[1]+'</span>'; }).join('')+'</div>':'<div class="pk-alerts"><span class="pk-al ok">No positioning alerts this week</span></div>')+
    ckRow+'<div class="pk-grid">'+cards.join('')+'</div>'+
    '<div class="stamp">Hover or tap any card or review chip for the formula, how to read it and why it matters \u00b7 CFTC positions as of Tuesday, released Friday 3:30 pm ET</div></div>';
}

/* ================= CROSS-ASSET CHECK + WEEKLY REVIEW CHECKLIST ================= */
function crossAsset(){
  var g=['corn','soybeans','wheat'].map(function(k){ return posK(k); }).filter(Boolean), c=posK('fx');
  if(!g.length||!c) return null;
  var bz=g.reduce(function(a,K){ return a+K.z52; },0)/g.length, cz=c.z52;
  var dis=(bz>=1&&cz<=-1)?'Funds lean long grains while short CAD — terms of trade improving for Canada but USD/CAD has not adjusted (CAD may be undervalued vs ag)':
          (bz<=-1&&cz>=1)?'Funds lean short grains while long CAD — CAD strength not backed by ag terms of trade':null;
  return {bz:bz, cz:cz, dis:dis};
}
function checklistItems(key){
  var K=posK(key); if(!K) return [];
  var isFx=key==='fx', S=posState(K), X=crossAsset(), items=[];
  function it(ok, t, d, why){ items.push({ok:ok,t:t,d:d,why:why}); }
  it(true,'Data format', isFx?'Leveraged Funds from the Traders in Financial Futures (TFF) report, CAD futures on CME.':'Managed Money from the Disaggregated report \u2014 excludes passive swap/index money.','Using the right trader group stops passive index or swap flows being read as directional fund bets.');
  var ext=Math.abs(K.z52)>=2||K.cot3>80||K.cot3<20;
  it(!ext,'Z-score & COT', 'z '+sgn(K.z52,2,'\u03c3')+' ('+S.zs+') \u00b7 COT '+fmt(K.cot3,0)+' ('+S.cs+')'+(S.dbl?' \u00b7 <b>double extreme</b>':'')+'.','Flags when |z| \u2265 2 or the COT Index is above 80 / below 20 \u2014 crowded positioning that can reverse.');
  if(K.doi_pct!=null){ var flowAlert=Math.abs(K.doi_pct)>=2||(K.vel_pct_oi!=null&&Math.abs(K.vel_pct_oi)>=2)||Math.abs(K.streak)>=4;
    it(!flowAlert,'OI & flow', 'OI '+sgn(K.doi_pct,1,'%')+' w/w \u00b7 net '+(K.d1>0?'+':'\u2212')+fmt(Math.abs(K.d1))+(K.vel_pct_oi!=null?' ('+sgn(K.vel_pct_oi,1,'%')+' of OI)':'')+' \u00b7 '+Math.abs(K.streak)+'-week '+(K.streak>0?'buying':'selling')+' streak \u00b7 '+flowRead(K)+'.','Flags OI moves beyond \u00b12%, flow beyond \u00b12% of OI, or a 4+ week streak \u2014 shows whether new money is driving the move.'); }
  if(X) it(!X.dis,'Cross-asset', 'Grain basket z '+sgn(X.bz,2,'\u03c3')+' vs CAD funds z '+sgn(X.cz,2,'\u03c3')+(X.dis?' \u2014 <b>'+X.dis+'</b>':' \u2014 no disconnect')+'.','Canada is a big grain exporter: strong grain positioning with weak CAD positioning (or the reverse) can signal a terms-of-trade mispricing.');
  var tech, agree;
  if(isFx){ var fx=DATA.fx, sp=+fx.feed.mid, L=fx.levels; tech='USD/CAD '+fmt(sp,4)+' vs 20-day range '+fmt(L.s20,4)+'\u2013'+fmt(L.r20,4)+', pivot '+fmt(L.pivot,4);
    agree=(K.net<0&&sp>L.pivot)||(K.net>0&&sp<L.pivot); }
  else { var f=DATA.grains[key].fan, px=+f.intraday[0], m20=+f.ma20, m50=+f.ma50; tech='Price '+fmt(px,4)+' vs MA20 '+fmt(m20,2)+' / MA50 '+fmt(m50,2);
    agree=(K.net>0&&px>m50)||(K.net<0&&px<m50); }
  it(agree,'Technicals', tech+' \u2014 '+(agree?'price trend agrees with fund positioning.':'price trend is <b>against</b> fund positioning; wait for a technical trigger.'),'CFTC data is 3 days old on release. Positioning shows structural risk; price levels give the timing.');
  return items;
}
/* ================= AWAITING-RELEASE SKELETON (event cards only) ================= */
/* CFTC moves the COT release off Friday in federal-holiday weeks (cftc.gov/MarketReports/CommitmentsofTraders/ReleaseSchedule):
   skipped Friday -> {rel: delayed release day, asof: positions date}. Update from that page each year. */
var COT_DELAY={"2026-11-13":{rel:"2026-11-16",asof:"2026-11-10"},"2026-11-27":{rel:"2026-11-30",asof:"2026-11-24"},"2026-12-25":{rel:"2026-12-28",asof:"2026-12-22"}};
var COT_REL={}; Object.keys(COT_DELAY).forEach(function(f){ COT_REL[COT_DELAY[f].rel]=COT_DELAY[f].asof; });
/* the refresh job reads the CFTC schedule page into DATA.cot_schedule (scripts/cot_schedule.py); for every year it covers,
   the published dates win: a Friday with no release is skipped, its report goes out on the next listed day (positions as
   of that week's Tuesday), or not at all if nothing is listed within 4 days. Years not yet published fall back to Fridays. */
var _cotSeen=null;
function cotSync(){
  var S=window.DATA&&DATA.cot_schedule; if(!S||!S.years||S.checked===_cotSeen) return; _cotSeen=S.checked;
  Object.keys(S.years).forEach(function(y){
    var rel={}; (S.years[y]||[]).forEach(function(d){ rel[d]=1; });
    Object.keys(COT_DELAY).forEach(function(f){ if(f.slice(0,4)===y){ if(COT_DELAY[f].rel) delete COT_REL[COT_DELAY[f].rel]; delete COT_DELAY[f]; } });
    for(var d=new Date(Date.UTC(+y,0,1));d.getUTCFullYear()===+y;d=new Date(d.getTime()+86400000)){
      if(d.getUTCDay()!==5) continue; var f=d.toISOString().slice(0,10); if(rel[f]) continue;
      var asof=new Date(d.getTime()-3*86400000).toISOString().slice(0,10), r=null;
      for(var k=1;k<=4&&!r;k++){ var c=new Date(d.getTime()+k*86400000).toISOString().slice(0,10); if(rel[c]) r=c; }
      COT_DELAY[f]={rel:r, asof:asof}; if(r) COT_REL[r]=asof;
    }
  });
}
/* the most recent COT release that has happened: {t, asof} */
function lastCotRelease(){
  cotSync(); var now=Date.now();
  for(var i=0;i<=10;i++){ var x=new Date(now-i*86400000), p={};
    new Intl.DateTimeFormat('en-US',{timeZone:'America/Toronto',year:'numeric',month:'numeric',day:'numeric',weekday:'short'}).formatToParts(x).forEach(function(q){ p[q.type]=q.value; });
    var iso=p.year+'-'+String(p.month).padStart(2,'0')+'-'+String(p.day).padStart(2,'0'), t=zonedMs(+p.year,+p.month,+p.day,15,30,'America/Toronto');
    if(t>now) continue;
    if(COT_REL[iso]) return {t:t, asof:COT_REL[iso]};
    if(p.weekday==='Fri'&&!COT_DELAY[iso]) return {t:t, asof:isoAdd(+p.year,+p.month,+p.day,-3)};
  }
  return null;
}
function lastWeekday(wd, h, m, maxBackDays){
  var now=Date.now();
  for(var i=0;i<=(maxBackDays||8);i++){ var x=new Date(now-i*86400000), p={};
    new Intl.DateTimeFormat('en-US',{timeZone:'America/Toronto',year:'numeric',month:'numeric',day:'numeric',weekday:'short'}).formatToParts(x).forEach(function(q){ p[q.type]=q.value; });
    if(p.weekday===wd){ var t=zonedMs(+p.year,+p.month,+p.day,h,m,'America/Toronto'); if(t<=now) return {t:t, y:+p.year, m:+p.month, d:+p.day}; } }
  return null;
}
function isoAdd(y,m,d,days){ var x=new Date(Date.UTC(y,m-1,d)+days*86400000); return x.toISOString().slice(0,10); }
function awaitingList(){
  var now=Date.now(), out=[], DAY=86400000;
  var cf=lastCotRelease();
  if(cf&&now-cf.t<DAY){ var exp=cf.asof, last=(DATA.grains.corn.cftc||[]).slice(-1)[0];
    if(last&&last.date<exp) out.push({key:'cftc', sel:'[data-src="cftc_grains"],[data-src="cftc_fx"],.poskpi', label:'Awaiting CFTC Commitments of Traders \u2014 positions as of '+exp,
      info:{what:'CFTC Commitments of Traders (positions as of Tue '+fmtDate(exp)+')', short:'CFTC Commitments of Traders', who:'the CFTC', t:cf.t, lag:'The CFTC posts the report at 3:30 PM ET; the desk reads the CFTC data API directly from your browser every 30 s \u2014 it usually catches up within 5\u201330 minutes, occasionally longer after a holiday.',
        prev:'positions as of '+fmtDate(last.date), url:'https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm', urlLab:'CFTC COT reports'}}); }
  var es=lastWeekday('Thu',8,30,7);
  if(es&&now-es.t<DAY){ var exp2=isoAdd(es.y,es.m,es.d,-7), E=(DATA.exports&&DATA.exports.corn)||{}, lw=(E.weeks||[]).slice(-1)[0];
    if(lw&&lw[1]<exp2) out.push({key:'exports', sel:'[data-src="exports"]', label:'Awaiting USDA weekly export sales',
      info:{what:'USDA weekly export sales (week ending '+fmtDate(exp2)+')', short:'USDA weekly export sales', who:'USDA FAS', t:es.t, lag:'USDA posts at 8:30 AM ET Thursdays (Friday in holiday weeks); the FAS data API needs the desk\u2019s private key, so it is fetched by the server fast lane (every minute) and often lags the PDF by 30\u201390 minutes.',
        prev:'week ending '+fmtDate(lw[1]), url:'https://apps.fas.usda.gov/export-sales/esrd1.html', urlLab:'USDA export sales highlights'}}); }
  (typeof USDA_WASDE!=='undefined'?USDA_WASDE:[]).forEach(function(dt){ var p=dt.split('-'), t=zonedMs(+p[0],+p[1],+p[2],12,0,'America/Toronto');
    var lab=new Date(Date.UTC(+p[0],+p[1]-1,15)).toLocaleString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});
    if(now>=t&&now-t<DAY&&DATA.wasde&&DATA.wasde.corn&&DATA.wasde.corn.report!==lab) out.push({key:'wasde', sel:'[data-src="wasde"]', label:'Awaiting USDA WASDE '+lab,
      info:{what:'USDA WASDE \u2014 '+lab+' report', short:'USDA WASDE '+lab, who:'USDA', t:t, lag:'WASDE is released at 12:00 PM ET; the FAS PSD database (private key, so fetched by the server fast lane) typically updates within 1\u20133 hours.',
        prev:'the '+DATA.wasde.corn.report+' report', url:'https://www.usda.gov/oce/commodity/wasde', urlLab:'USDA WASDE'}}); });
  macroAll().forEach(function(m){ var C=DATA.release_cal&&DATA.release_cal[m.key]; if(!C) return;
    var ds=(C.dates||[]).slice(); if(C.rule==='thu0830'){ var th=lastWeekday('Thu',8,30,7); if(th) ds.push(th.y+'-'+('0'+th.m).slice(-2)+'-'+('0'+th.d).slice(-2)+'T08:30'); }
    ds.forEach(function(s){ var a=s.split('T'), d=a[0].split('-'), h=a[1].split(':'), t=zonedMs(+d[0],+d[1],+d[2],+h[0],+h[1],'America/Toronto');
      if(now>=t&&now-t<DAY&&(!m.seen_at||new Date(m.seen_at).getTime()<t)){ var A=macroAgency(m), ctry=m.group==='us'?'US':'Canada';
        out.push({key:m.key, sel:'.mcard[data-mkey="'+m.key+'"]', label:'Awaiting '+ctry+' '+m.name+' release', small:true,
          info:{what:ctry+' '+m.name+(m.measure?' ('+m.measure+')':''), short:ctry+' '+m.name, who:A.who, t:t, lag:A.lag, flag:m.group,
            prev:mval(m,m.value)+' for '+m.period, url:A.url||C.src, urlLab:A.who}}); } }); });
  /* trade & fiscal (DATA.ext): the release carries month M-2 (trade) or M-1 (Treasury statement) */
  [['us_trade','us_trade_bal',2,'US international trade','the US Census Bureau / BEA','https://www.census.gov/foreign-trade/','Census and BEA publish at 8:30 AM ET. This series reaches the desk through FRED via the server (the Census API needs a key, so it cannot be read from the browser).'],
   ['ca_trade','ca_trade_bal',2,'Canada merchandise trade','Statistics Canada','https://www150.statcan.gc.ca/n1/dai-quo/index-eng.htm','StatCan publishes at 8:30 AM ET; the desk also reads it directly from StatCan in your browser.'],
   ['us_deficit','us_deficit',1,'US federal budget (Monthly Treasury Statement)','the US Treasury','https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/','Treasury publishes the MTS at 2:00 PM ET; the desk also reads it directly from Treasury FiscalData in your browser.']].forEach(function(x){
    var C=DATA.release_cal&&DATA.release_cal[x[0]], S=DATA.ext&&DATA.ext[x[1]]; if(!C||!S||!S.pts||!S.pts.length) return;
    (C.dates||[]).forEach(function(s){ var a=s.split('T'), d=a[0].split('-'), h=a[1].split(':'), t=zonedMs(+d[0],+d[1],+d[2],+h[0],+h[1],'America/Toronto');
      if(!(now>=t&&now-t<DAY)) return;
      var e=new Date(Date.UTC(+d[0],+d[1]-1-x[2],1)), exp=e.toISOString().slice(0,7), have=S.pts[S.pts.length-1][0];
      if(have<exp) out.push({key:x[0], sel:'[data-src="ext"]', label:'Awaiting '+x[3],
        info:{what:x[3]+' ('+MON3L[e.getUTCMonth()]+' '+e.getUTCFullYear()+')', short:x[3], who:x[4], t:t, lag:x[6], flag:x[0].slice(0,2),
          prev:MON3L[+have.slice(5,7)-1]+' '+have.slice(0,4)+' data', url:x[5], urlLab:x[4].replace(/^the /,'')}}); }); });
  return out;
}
var MON3L=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/* Release watch: while a released number has not reached the page, re-check every 30 s;
   after 5 misses wait 1 min and try once more; still missing -> show an error under the card
   (previous data stays visible) and keep retrying every 5 min until it lands. */
function macroAgency(m){
  var k=m.key, F=' It reaches this desk through FRED via the server, which usually posts within 5\u201360 minutes of the official release (this source cannot be read from the browser).',
      B=' The desk reads the BLS API directly from your browser (no key: about 24 checks a day per browser, so it checks once a minute) and FRED via the server.';
  if(/^us_(cpi|core_cpi|nfp|ur|ahe)$/.test(k)) return {who:'the BLS (Bureau of Labor Statistics)', url:'https://www.bls.gov/bls/newsrels.htm', lag:'BLS publishes at 8:30 AM ET.'+B};
  if(/^us_(cpi|core_cpi|nfp|ur|ahe)$/.test(k)) return {who:'the BLS (Bureau of Labor Statistics)', url:'https://www.bls.gov/bls/newsrels.htm', lag:'BLS publishes at 8:30 AM ET.'+F};
  if(/^us_c?claims$/.test(k)) return {who:'the US Department of Labor', url:'https://www.dol.gov/ui/data.pdf', lag:'Weekly claims are published Thursdays at 8:30 AM ET.'+F};
  if(/^us_(gdp|core_pce)$/.test(k)) return {who:'the BEA (Bureau of Economic Analysis)', url:'https://www.bea.gov/news/schedule', lag:'BEA publishes at 8:30 AM ET.'+F};
  if(/^us_(retail|trade)$/.test(k)) return {who:'the US Census Bureau', url:'https://www.census.gov/economic-indicators/', lag:'Census publishes at 8:30 AM ET.'+F};
  if(k==='us_umich') return {who:'the University of Michigan', url:'https://www.sca.isr.umich.edu/', lag:'Sentiment is published at 10:00 AM ET.'+F};
  if(k==='us_policy') return {who:'the Federal Reserve', url:'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', lag:'The FOMC statement is at 2:00 PM ET. The new target range reaches FRED (server) the same afternoon and the NY Fed rates API (read directly in your browser) the next morning.'};
  if(k==='us_deficit') return {who:'the US Treasury (Monthly Treasury Statement)', url:'https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/', lag:'The MTS is published at 2:00 PM ET.'+F};
  if(k==='ca_policy') return {who:'the Bank of Canada', url:'https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/', lag:'The rate decision is at 9:45 AM ET; the desk reads the Bank\u2019s Valet API directly from your browser, which usually updates within minutes.'};
  if(/^ca_(trim|median)$/.test(k)) return {who:'the Bank of Canada (from Statistics Canada CPI)', url:'https://www.bankofcanada.ca/rates/price-indexes/cpi/', lag:'CPI is out at 8:30 AM ET; the Bank posts its core measures on Valet (read directly in your browser) shortly after, sometimes up to an hour later.'};
  return {who:'Statistics Canada', url:'https://www150.statcan.gc.ca/n1/dai-quo/index-eng.htm', lag:'The Daily publishes at 8:30 AM ET; the desk reads StatCan\u2019s data API (WDS) directly from your browser every 30 s \u2014 it normally updates at 8:30 but can lag by up to an hour.'};
}
function awaitMsg(a){
  var I=a.info||{}, when=I.t?etLabel(I.t,true):'today';
  var why=AW.netErr?'This desk could not reach its data server on the last check (network or GitHub error) \u2014 check your connection; it will keep retrying.':
    I.who?I.who.charAt(0).toUpperCase()+I.who.slice(1)+' released it at '+when+' ET, but the new numbers have not reached the desk yet. '+(I.lag||''):'The source has not published the new numbers yet.';
  return {title:'Sorry, we can\u2019t be reached now<span class="aw-sub">'+(I.flag?flag(I.flag,12)+' ':'')+esc(I.what||a.label.replace(/^Awaiting /,''))+' \u2014 new data cannot be displayed yet</span>',
    body:why+(I.prev?' <b>Showing the previous reading: '+I.prev+'.</b>':' Showing the previous data.'),
    short:(I.short||I.what||'')+': not updated yet \u2014 showing '+(I.prev||'previous data')};
}
var AW={tries:0, next:0, last:0, err:false, busy:false, prev:{}, netErr:false};

function hhmmss(t){ return new Date(t).toLocaleTimeString('en-US',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit',second:'2-digit'}); }
function paintAwaiting(list){
  list=list||awaitingList();
  document.querySelectorAll('.awaiting,.await-err').forEach(function(el){ el.classList.remove('awaiting','aw-sm','await-err'); el.removeAttribute('data-await'); });
  document.querySelectorAll('.aw-errbox').forEach(function(e){ e.remove(); });
  var now=Date.now(), wait=Math.max(0,Math.ceil((AW.next-now)/1000));
  var stage=AW.busy?'checking now…':AW.tries<5?'check '+(AW.tries+1)+' of 5 in '+wait+' s':'final check in '+wait+' s';
  list.forEach(function(a){ document.querySelectorAll(a.sel).forEach(function(el){
    if(AW.err){ el.classList.add('await-err');
      var b=document.createElement('div'), M=awaitMsg(a), retry='<div class="aw-retry">'+AW.tries+' checks so far \u00b7 retrying every 5 min \u00b7 last check '+(AW.last?hhmmss(AW.last):'\u2014')+' \u00b7 next in '+Math.floor(wait/60)+':'+('0'+wait%60).slice(-2)+'</div>';
      if(a.small){ var I2=a.info||{}; b.className='aw-errbox sm'; b.title=M.short+' \u2014 click the card for details';
        b.innerHTML='<b>\u26a0 Sorry, we can\u2019t be reached now</b><div>'+esc(I2.short||'')+' not updated</div><div>'+esc((I2.who||'').replace(/^the /,'').replace(/ \(.*\)/,''))+' released '+(I2.t?etLabel(I2.t,true).replace(/^.*?, /,''):'')+' \u00b7 showing '+esc(I2.prev||'previous')+'</div>'; }
      else { b.className='aw-errbox'; b.innerHTML='<div class="aw-t">\u26a0 '+M.title+'</div><div>'+M.body+'</div>'+retry; }
      el.insertBefore(b, el.firstChild);
    } else { var I=a.info||{}; el.classList.add('awaiting'); if(a.small) el.classList.add('aw-sm');
      el.setAttribute('data-await', a.small?(I.short||a.label)+' released \u00b7 fetching \u00b7 '+stage:(I.what||a.label)+(I.who?' \u2014 released by '+I.who+' at '+etLabel(I.t,true)+' ET':'')+' \u00b7 fetching \u00b7 '+stage+(AW.last?' \u00b7 last check '+hhmmss(AW.last):'')); }
  }); });
}
function awaitCheck(){
  var L=window.DESK_LIVE; if(!L||AW.busy) return;
  AW.busy=true; AW.last=Date.now(); paintAwaiting();
  var dk=awaitingList().map(function(x){ return x.key; }).filter(Boolean);
  var pr=[L.pollLive?L.pollLive(true):null, L.pollData?L.pollData(true):null, (window.DIRECT&&dk.length)?DIRECT.check(dk):null].filter(Boolean);
  Promise.all(pr).catch(function(){ return ['err']; }).then(function(res){
    AW.busy=false; AW.netErr=(res||[]).length>0 && (res||[]).every(function(x){ return x==='err'; });
    if(!awaitingList().length) return;
    AW.tries++;
    if(AW.tries<5) AW.next=Date.now()+30000;
    else if(AW.tries===5) AW.next=Date.now()+60000;
    else { AW.err=true; AW.next=Date.now()+300000; }
    paintAwaiting();
  });
}
function awaitTick(){
  if(window.DESK_LOCKED) return;
  var list=awaitingList(), cur={};
  list.forEach(function(a){ cur[a.label]=1; });
  Object.keys(AW.prev).forEach(function(l){ var dm=macroAll().filter(function(m){ return m.direct&&l.indexOf(m.name+' release')>-1&&l.indexOf(m.group==='us'?'US':'Canada')>-1; })[0];
    if(!cur[l]&&!dm&&!(window.DIRECT_LAST&&Date.now()-DIRECT_LAST<20000)&&window.DESK_LIVE&&DESK_LIVE.toast) DESK_LIVE.toast('<b>✓ Updated</b> — '+esc(l.replace(/^Awaiting /,''))+' is now on the desk'); });
  var fresh=list.some(function(a){ return !AW.prev[a.label]; });
  AW.prev=cur;
  if(!list.length){ if(AW.tries||AW.err){ AW.tries=0; AW.err=false; AW.next=0; } paintAwaiting(list); return; }
  if(fresh&&!AW.tries){ AW.next=Date.now(); }           /* a release just hit: check straight away */
  if(Date.now()>=AW.next&&!AW.busy) awaitCheck(); else paintAwaiting(list);
}
setInterval(awaitTick, 1000);

/* ================= USD/CAD LIVE FEED MONITOR ================= */
var MON_TAB='next';
function agriEvents(fromMs, days){
  var seen={}, out=[];
  ['corn','wheat','soybeans'].forEach(function(k){ usdaEvents(k, fromMs, days).forEach(function(e){
    var lab=e.kind==='contract'?GMETA[k].name+': '+e.label:e.label, id=lab+'|'+e.t;
    if(!seen[id]){ seen[id]=1; out.push({t:e.t,label:lab,kind:e.kind,src:'agri'}); } }); });
  caEvents(fromMs, days).forEach(function(e){ out.push({t:e.t,label:'Canada: '+e.label,kind:'ca',src:'agri'}); });
  return out.sort(function(a,b){ return a.t-b.t; });
}
function macroHighEvents(){ return DATA.fx.events.filter(function(e){ return e.impact==='High'; }).map(function(e){ return {t:evEpoch(e),label:e.ccy+' '+e.event,ccy:e.ccy,kind:'macro',src:'macro',prev:e.prev,fc:e.fc}; }).sort(function(a,b){ return a.t-b.t; }); }
function monRows(list, now){
  if(!list.length) return '<div class="checkline">Nothing scheduled in this window.</div>';
  return list.map(function(e){ var past=e.t<now, tag=e.src==='macro'?'<span class="chip miss">MACRO</span>':e.kind==='ca'?'<span class="chip demo">CANADA</span>':e.kind==='wasde'?'<span class="chip miss">WASDE</span>':e.kind==='contract'?'<span class="chip demo">CONTRACT</span>':'<span class="chip inline">USDA</span>';
    var fl=e.src==='macro'?flagCcy(e.ccy,12):e.kind==='ca'?flag('ca',12):flag('us',12);
    return '<div class="kv'+(past?' ev-past':'')+'"><span class="kk">'+fl+' '+etLabel(e.t,true)+' · '+esc(e.label)+' '+tag+(e.prev?' <span class="neu">prev '+esc(e.prev)+'</span>':'')+'</span><span class="vv">'+(past?'<span class="chip inline">OUT</span>':'<span class="countdown" data-t="'+e.t+'">'+cdText(e.t-now)+'</span>')+'</span></div>'; }).join('');
}
function monitorNews(){ return '<div id="newsb-fx">'+newsBodyHTML('fx')+'</div>'; }
function liveMonitorHTML(){
  var now=Date.now(), agri=agriEvents(now,21), macro=macroHighEvents(), all=agri.concat(macro).sort(function(a,b){ return a.t-b.t; });
  var horizon=now+36*3600000, next=all.filter(function(e){ return e.t>now-2*3600000 && e.t<=horizon; });
  var up=all.filter(function(e){ return e.t>now; })[0];
  var tabs=[['next','Next 36h'],['agri','Agri'],['macro','Macro High'],['news','News']];
  var body={next:monRows(next,now), agri:monRows(agri.filter(function(e){ return e.t>now-6*3600000; }).slice(0,24),now), macro:monRows(macro,now), news:monitorNews()}[MON_TAB];
  return '<div class="rail-card mon-card"><div class="mon-head"><div class="rail-title"><span>Live feed monitor</span></div>'+
    (up?'<div class="mon-next">Next: <b>'+esc(up.label)+'</b><div class="hero-cd countdown" data-t="'+up.t+'" data-fmt="hms">'+hmsText(up.t-now)+'</div><div class="dsub">'+etLabel(up.t,true)+' ET</div></div>':'')+
    '<div class="mon-tabs" role="tablist">'+tabs.map(function(t){ return '<button role="tab" data-mon="'+t[0]+'" aria-selected="'+(MON_TAB===t[0])+'">'+t[1]+'</button>'; }).join('')+'</div></div>'+
    '<div class="rail-body mon-body">'+body+'<div class="stamp">Toronto time · agri = USDA weekly reports, WASDE, CBOT contract dates and Canada (AAFC/StatCan) releases · macro = high-impact only · news = all four desks</div></div></div>';
}
document.addEventListener('click', function(ev){
  var t=ev.target.closest?ev.target:null; if(!t) return;
  var m=t.closest('[data-mon]'); if(m){ MON_TAB=m.getAttribute('data-mon'); var c=document.querySelector('.mon-card'); if(c){ c.outerHTML=liveMonitorHTML(); } return; }
  var d=t.closest('[data-dash]'); if(d){ var k=d.getAttribute('data-dash'); dstate(k)[d.getAttribute('data-k')]=d.getAttribute('data-v'); renderGrain(k); drawDestMaps(); return; }
  var ch=t.closest('.ask-chip'); if(ch){ var ta=document.getElementById('ask-'+ch.getAttribute('data-ask')); if(ta){ ta.value=ch.textContent; ta.focus(); } return; }
  var go=t.closest('[data-ask-go]'); if(go){ askClaude(go.getAttribute('data-ask-go')); }
});

/* near / far OPTION-MONTH quotes for the grain quote strip (shown on every sub-tab). Each leg says exactly where its price came
   from and when: delayed quote (Yahoo, per contract) -> last delayed quote if the latest refresh failed -> futures price recorded
   with the options chain pull -> prior settle. Never blank, never an unlabelled number. */
function optLegQuote(g, leg){
  var o=g[leg]||{}, c=o.contract, q=(g.quotes||{})[c], r=(g.roll||[]).filter(function(x){ return x.contract===c; })[0]||null;
  var settle=q&&q.settle!=null?+q.settle:r?+r.settle:null, sdate=(q&&q.settle_date)||(r&&r.settle_date)||null;
  var chainAt=DATA.meta&&DATA.meta.asof&&DATA.meta.asof.options;
  if(q&&q.px!=null) return {c:c, px:+q.px, settle:settle, sdate:sdate, tier:q.stale?'last':'delayed', when:q.label||'', ts:q.ts, why:q.stale?(q.err||'latest refresh failed'):''};
  if(o.underlying!=null) return {c:c, px:+o.underlying, settle:settle, sdate:sdate, tier:'chain', when:chainAt?omTime(Date.parse(chainAt)):'', ts:chainAt};
  if(settle!=null) return {c:c, px:settle, settle:settle, sdate:sdate, tier:'settle', when:sdate?fmtShortDate(sdate):''};
  return null;
}
function omTime(ms){ var o={timeZone:'America/Toronto'}, today=new Date(ms).toLocaleDateString('en-CA',o)===new Date().toLocaleDateString('en-CA',o);
  return (today?'':new Date(ms).toLocaleDateString('en-US',{timeZone:'America/Toronto',month:'short',day:'numeric'})+' ')+new Date(ms).toLocaleTimeString('en-US',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit'}).replace(' ','').toLowerCase()+' ET'; }
/* ---------- quote tiles (rate-board style): big figure + large last two digits; motion.js flips changed digits and
   flashes the box green / red on every real change, and keeps the last-tick arrow ---------- */
function qtPx(v, dec, pre){ var t=(pre||'')+fmt(v,dec), f=dec>=4?1:0, n=dec>=2?2:1, i=t.length-f-n; return '<span class="qt-bf">'+t.slice(0,i)+'</span><span class="qt-pp">'+t.slice(i,t.length-f)+'</span>'+(f?'<span class="qt-fr">'+t.slice(t.length-f)+'</span>':''); }
/* market sessions (ET): FX Sun 5pm–Fri 5pm · CBOT grains day 9:30–2:20 + overnight 8pm–8:45am · CME Globex energy/dollar index Sun 6pm–Fri 5pm with a 5–6pm break · CBOE Treasury yield indices weekdays 8am–5pm */
window.MKT=(function(){
  function et(t){ var p={}; new Intl.DateTimeFormat('en-US',{timeZone:'America/Toronto',weekday:'short',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(new Date(t||Date.now())).forEach(function(x){ p[x.type]=x.value; }); return {wd:p.weekday, m:(+p.hour)*60+(+p.minute)}; }
  var WK=['Mon','Tue','Wed','Thu','Fri'];
  return { fx:function(t){ var p=et(t); return !(p.wd==='Sat'||(p.wd==='Fri'&&p.m>=1020)||(p.wd==='Sun'&&p.m<1020)); },
    grain:function(t){ var p=et(t); return (WK.indexOf(p.wd)>=0&&p.m>=570&&p.m<860)||(['Sun','Mon','Tue','Wed','Thu'].indexOf(p.wd)>=0&&p.m>=1200)||(WK.indexOf(p.wd)>=0&&p.m<525); },
    fut:function(t){ var p=et(t); if(p.wd==='Sat'||(p.wd==='Sun'&&p.m<1080)||(p.wd==='Fri'&&p.m>=1020)) return false; return !(p.m>=1020&&p.m<1080); },
    bond:function(t){ var p=et(t); return WK.indexOf(p.wd)>=0&&p.m>=480&&p.m<1020; } };
})();
/* Dealing ticket (owner design, Nov 7): two-sided only when the feed carries a real bid and ask; otherwise one mid ticket.
   Big figure small, pips large, fractional pip raised; colour = vs prior close; stats from the stored session. */
function fxTicketHTML(mid, bid, ask){
  var fx=DATA.fx, ref=+fx.spot.ref, p=fxIntradayPoints(), y=p.map(function(x){return x[1];}), d=mid-ref, pc=(mid/ref-1)*100, dir=d>0?'up':d<0?'dn':'';
  var side=function(lab,v,k,c){ return '<div class="tk-side tk-'+c+'"><div class="tk-lab">'+lab+'</div><div class="qt-box tk-px" data-qt="'+k+'" data-v="'+v+'" data-dec="5"'+(k==='fxmid'?' data-qt-live="usdcad"':'')+'><span class="qt-v">'+qtPx(v,5)+'</span></div></div>'; };
  var two=bid!=null&&ask!=null&&isFinite(bid)&&isFinite(ask);
  var row=function(k,v){ return '<div class="tk-r"><span>'+k+'</span><b>'+v+'</b></div>'; };
  return '<div class="tk" id="fx-ticket"><div class="tk-top">'+(two?side('Sell',bid,'fxbid','dn')+side('Buy',ask,'fxask','up')+'<span class="tk-badge">'+fmt((ask-bid)*10000,1)+'</span>'
      : side('Mid · delayed, no dealable bid/ask',mid,'fxmid',dir||'nt')+'<span class="tk-badge">MID</span>')+'</div>'+
    '<div class="tk-grid">'+row('+/-:','<span data-tk="chg">'+(d>=0?'+':'−')+fmt(Math.abs(d),5)+'</span>')+row('%+/-:','<span data-tk="pct">'+(pc>=0?'+':'−')+fmt(Math.abs(pc),2)+'</span>')+
      (y.length>1?row('Low:',fmt(Math.min.apply(null,y),5))+row('High:',fmt(Math.max.apply(null,y),5))+row('Open:',fmt(y[0],5)):'')+row('Prev. Close:',fmt(ref,5))+'</div></div>';
}
function qtTile(o){
  /* one rule on every tab: a quote from a closed market says CLOSED, whatever feed it came from */
  if(o.mkt&&window.MKT&&MKT[o.mkt]&&!MKT[o.mkt]()&&o.tag&&/LIVE|DELAYED|LAST|EST/.test(o.tag)){ o.tag='CLOSED'; o.tagc='cz'; o.title=({fx:'FX market closed (Fri 5pm – Sun 5pm ET)',grain:'CBOT grains closed',fut:'Futures market closed',bond:'Treasury yield indices update weekdays 8am–5pm ET'}[o.mkt])+' — last quote shown'+(o.title?' · '+o.title:''); o.max=1e9; }
  if(!window.__ageQ){ window.__ageQ=1; setTimeout(function(){ window.__ageQ=0; if(typeof ageTick==='function') ageTick(); },0); }   /* ages painted as soon as the tiles are in the page */
  return '<div class="qt" data-qtk="'+o.k+'"'+(o.title?' title="'+esc(o.title)+'"':'')+'><div class="qt-h"><b>'+o.name+'</b><span class="qt-sub">'+(o.sub||'')+'</span></div>'+
    '<div class="qt-box'+(/class="[^"]*\bup\b/.test(o.chg||'')?' tk-up-s':/class="[^"]*\b(dn|down)\b/.test(o.chg||'')?' tk-dn-s':'')+'" data-qt="'+o.k+'" data-v="'+o.v+'" data-dec="'+o.dec+'" data-pre="'+(o.pre||'')+'"'+(o.live?' data-qt-live="'+o.live+'"':'')+'><span class="qt-ar" aria-hidden="true"></span><span class="qt-v">'+qtPx(o.v,o.dec,o.pre)+'</span></div>'+
    '<div class="qt-c">'+(o.chg||'')+'</div><div class="qt-f">'+(o.foot||'')+(o.ts?'<span class="qt-age" data-age="'+esc(o.ts)+'" data-age-max="'+(o.max||1500)+'"></span>':'')+(o.tag?' <span class="om-t '+o.tagc+'">'+o.tag+'</span>':'')+'</div></div>';
}
/* one line under each grain price: where it comes from and how late it is */
function qtSrc(tier){ return '<span class="qt-src">'+({delayed:'Yahoo · CBOT · ~10 min delayed', last:'Yahoo · last good quote (refresh failed)', chain:'IBKR options-chain pull (morning)', settle:'prior close · Yahoo daily bar'}[tier]||'')+'</span>'; }
var QT_TIER={delayed:['DELAYED','ok'], last:['LAST QUOTE','warn'], chain:['CHAIN PULL','warn'], settle:['SETTLE','cz']};
function grainTilesHTML(key){
  var g=DATA.grains[key], f=g.fan, meta=GMETA[key], fx=+DATA.fx.feed.mid, out=[], front=(g.roll&&g.roll[0]&&g.roll[0].contract)||meta.contract;
  var legs={near:g.near||{}, far:g.far||{}};
  function optIV(o){ var v=g.vol&&g.vol[o===legs.near?'near':'far'], iv=v&&v.contract===o.contract?v.iv:o.iv; return iv!=null?' <span class="sl-k">IV '+fmt(+iv,1)+'%</span>':''; }
  function optSub(o){ var exp=o.expires?Date.parse(o.expires+'T13:15:00-05:00'):null, d=exp?Math.max(0,Math.ceil((exp-Date.now())/86400000)):null; return esc(o.chain||'')+(d!=null?' · '+d+'d':''); }
  function chg(px, st){ if(st==null) return '<span class="neu">no settle on file</span>'; var c=px-st; return '<span class="'+cls(c)+'" title="vs settle '+fmt(st,4)+'">'+sgn(c*100,2,'¢')+' · '+sgn(c/st*100,2,'%')+'</span>'; }
  /* front futures: the strip's own delayed quote (same price as the fan and KPIs) */
  var L=+f.intraday[0], A=+f.anchor, nearSame=legs.near.contract===front;
  out.push(qtTile({k:'fut-'+key, name:esc(front), sub:nearSame?optSub(legs.near):'front', v:L, dec:4, pre:'$', chg:chg(L,A),
    foot:'<span class="qt-t">'+(MKT.grain()?'':'last trade ')+esc(f.intraday[1]||'')+'</span>'+qtSrc('delayed'), ts:f.intraday_ts, mkt:'grain', tag:isAuto('grains_quote')?'DELAYED':'SNAPSHOT', tagc:isAuto('grains_quote')?'ok':'cz',
    title:'Yahoo Finance delayed quote (CBOT, about 10 minutes behind). Change vs '+front+' prior close '+fmt(A,4)+(f.settle_date?' ('+fmtShortDate(f.settle_date)+')':'')+'. Not an executable price; the official CME settlement can differ.'}));
  ['near','far'].forEach(function(leg){
    var o=legs[leg]; if(!o.contract||(leg==='near'&&nearSame)) return;
    var Q=optLegQuote(g, leg); if(!Q) return; var T=QT_TIER[Q.tier];
    out.push(qtTile({k:leg+'-'+key, name:esc(o.contract), sub:optSub(o), v:Q.px, dec:4, pre:'$', chg:(Q.tier==='settle'?'<span class="neu">settle</span>':chg(Q.px,Q.settle)),
      foot:'<span class="qt-t">'+esc(Q.when)+'</span>'+qtSrc(Q.tier), mkt:'grain', tag:T[0]==='LAST QUOTE'?'LAST':T[0], tagc:T[1], title:(Q.why?'Latest refresh failed — ':'')+'Futures under the '+o.chain+' options'}));
  });
  out.push(qtTile({k:'cad-'+key, name:'C$/t', sub:'cash equiv.', title:'Front futures × '+fmt(BU_PER_MT[key],3)+' bu/t × USD/CAD — no basis', v:L*BU_PER_MT[key]*fx, dec:2, chg:'', foot:'<span class="qt-t">'+esc(f.intraday[1]||'')+'</span>', ts:f.intraday_ts}));
  out.push(qtTile({k:'usdcad', name:'USD/CAD', sub:'spot', v:fx, dec:5, live:'usdcad', mkt:'fx', chg:fxChgHTML(), foot:spotStamp(), tag:isAuto('fx_spot')?'LIVE':'SNAPSHOT', tagc:isAuto('fx_spot')?'ok':'cz'}));
  return '<div class="qt-grid">'+out.join('')+'</div>'+'<div class="qt-chk" title="The desk re-checks every source about once a minute; each tile shows its own quote time and how old it is">Feed checked <b data-clock-src="live_at"></b> · <span data-age-src="live_at"></span> · prices refresh on their own cycle</div>';
}
function ylLiveHTML(){
  var fx=DATA.fx, YL=fx.yields_live||{}, T=fx.treasury||{}, cd=(DATA.meta.asof.yields||'').slice(0,10);
  var MT={index:['DELAYED','ok'],futures:['EST · FUT','warn'],interp:['INTERP','warn']};
  var rows=[['3M','13-week bill · discount basis','^IRX'],['1Y','1-year',''],['2Y','2-year note','ZT=F futures'],['5Y','5-year note','^FVX'],['10Y','10-year note','^TNX'],['20Y','20-year bond',''],['30Y','30-year bond','^TYX']].map(function(r){
    var y=YL[r[0]], c=T[r[0]];
    if(y&&y.y!=null) return '<tr><td class="lbl"><b>US '+r[0]+'</b><small class="yl-d">'+r[1]+'</small></td><td data-l="Live"><b data-tick="yl-'+r[0]+'" data-roll>'+fmt(+y.y,3)+'%</b></td><td data-l="Change" class="'+cls(y.chg_bp)+'">'+(y.chg_bp!=null?sgn(y.chg_bp,1,' bp'):'—')+'</td><td data-l="Close"'+(y.basis&&y.basis!=='official close'?' title="'+esc(y.basis)+'"':'')+'>'+(y.close!=null?fmt(+y.close,3)+'%'+(y.basis&&y.basis!=='official close'?'<small class="yl-d">prior ^IRX</small>':''):c!=null?fmt(+c,3)+'%':'—')+'</td><td data-l="Quote time">'+esc(y.label||'')+'</td><td data-l="Source"><span class="om-t '+(y.stale?'warn':(MT[y.method]||MT.index)[1])+'" title="'+esc(y.method==='futures'?'estimated from 2-year note futures':y.method==='interp'?'interpolated from live neighbours':'delayed intraday yield')+'">'+(y.stale?'LAST QUOTE':(MT[y.method]||MT.index)[0])+'</span>'+(y.method==='interp'?' <small class="sl-k">'+(r[0]==='1Y'?'3M ↔ 2Y':'10Y ↔ 30Y')+'</small>':'')+'</td></tr>';
    return '<tr><td class="lbl"><b>US '+r[0]+'</b><small class="yl-d">'+r[1]+'</small></td><td data-l="Live">—</td><td data-l="Change">—</td><td data-l="Official close">'+(c!=null?fmt(+c,3)+'%':'—')+'</td><td data-l="Quote time">'+(cd?fmtShortDate(cd)+' close':'')+'</td><td data-l="Source"><span class="om-t cz">CLOSE ONLY</span> <small class="sl-k">live estimate unavailable</small></td></tr>';
  }).join('');
  var y10=YL['10Y'], R10=(fx.rates||[]).filter(function(r){ return r.t==='10Y'; })[0];
  return '<div class="tile wide" data-src="yields_live"><h2>US Treasury yields — live <span class="h2note">— delayed ~10–15 min, refreshed every 60 s · change in bp vs the official close'+(cd?' of '+fmtShortDate(cd):'')+' (3M vs its own prior close — discount basis)</span></h2>'+
    '<div style="overflow-x:auto"><table class="yl-tbl"><thead><tr><th>Tenor</th><th>Live</th><th>Change</th><th>Close</th><th>Quote</th><th>Source</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    (y10&&y10.sp_ca!=null&&R10?'<p class="read" style="margin-top:10px">US–Canada 10Y now: <b>'+fmt(y10.sp_ca,1)+' bp</b> ('+sgn(y10.sp_ca-R10.sp,1,' bp')+' vs the '+fmt(R10.sp,1)+' bp official-close spread) — Canada leg '+(y10.ca_leg==='est'&&fx.yields_live_ca&&fx.yields_live_ca['10Y']?'estimated live at '+fmt(+fx.yields_live_ca['10Y'].y,3)+'% from the ZFM.TO federal-bond ETF (no free intraday Canada yield exists)':'is the Bank of Canada close '+fmt(+y10.ca_close,3)+'%')+'. Full curve on the spreads card below.</p>':'')+
    '<div class="stamp">Live = delayed intraday yields (~10–15 min) · official = US Treasury daily par yield curve (posted ~6 pm ET), still the reference for spread history and forwards</div></div>';
}
function fxChgHTML(){ var fx=DATA.fx, c=(fx.feed.mid/fx.spot.ref-1)*100, d=fx.feed.mid-fx.spot.ref; return '<span class="'+cls(c)+'" data-live-chg2>'+sgn(d*10000,1,' pips')+' · '+sgn(c,2,'%')+'</span>'; }
function tHM(iso){ if(!iso) return ''; var t=Date.parse(iso); return isFinite(t)?new Date(t).toLocaleTimeString('en-US',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit'}).replace(' ','').toLowerCase()+' ET':''; }
/* live age on every stamped quote: the clock ticks every second even when the price itself only refreshes on its own cycle */
function ageTxt(ms){ var s=Math.max(0,Math.round(ms/1000)); return s<60?s+'s ago':s<3600?Math.floor(s/60)+'m '+(s%60<10?'0':'')+(s%60)+'s ago':Math.floor(s/3600)+'h '+Math.floor(s%3600/60)+'m ago'; }
function ageTick(){
  var now=Date.now(), la=window.DATA&&DATA.meta&&DATA.meta.live_at;
  document.querySelectorAll('[data-age]').forEach(function(el){ var t=Date.parse(el.getAttribute('data-age')); if(!isFinite(t)) return;
    var a=now-t, mx=(+el.getAttribute('data-age-max')||1500)*1000; el.textContent='· '+ageTxt(a).replace(' ago',''); el.classList.toggle('old',a>mx); });
  document.querySelectorAll('[data-clock-src="live_at"]').forEach(function(el){ el.textContent=la?new Date(Date.parse(la)).toLocaleTimeString('en-US',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit',second:'2-digit'})+' ET':'—'; });
  document.querySelectorAll('[data-age-src="live_at"]').forEach(function(el){ var t=la?Date.parse(la):NaN; el.textContent=isFinite(t)?ageTxt(now-t):'waiting for the first check'; el.classList.toggle('old',isFinite(t)&&now-t>180000); });
}
setInterval(ageTick,1000);
function fxTilesHTML(){
  var fx=DATA.fx, w=fx.energy[0], b=fx.energy[1], R={}; fx.rates.forEach(function(r){ R[r.t]=r; });
  var t=[qtTile({k:'usdcad', name:'USD/CAD', sub:'spot', v:+fx.feed.mid, dec:5, live:'usdcad', mkt:'fx', chg:fxChgHTML(), foot:spotStamp(), tag:isAuto('fx_spot')?'LIVE':'SNAPSHOT', tagc:isAuto('fx_spot')?'ok':'cz'})];
  if(w&&w.last!=null) t.push(qtTile({k:'wti', name:'WTI', sub:'front', v:+w.last, dec:2, pre:'$', chg:'<span class="'+cls(w.pct)+'">'+sgn(w.chg||0,2)+' · '+sgn(w.pct||0,2,'%')+'</span>', foot:'<span class="qt-t">'+tHM(DATA.meta.asof.energy)+'</span>', ts:DATA.meta.asof.energy, mkt:'fut', tag:isAuto('energy')?'DELAYED':'SNAPSHOT', tagc:isAuto('energy')?'ok':'cz'}));
  t.push(qtTile({k:'dxy', name:'DXY', sub:'', v:+fx.fxcross.dxy, dec:2, chg:'<span class="'+cls(fx.fxcross.dxy_chg)+'">'+sgn(+fx.fxcross.dxy_chg||0,2,'%')+'</span>', foot:'<span class="qt-t">'+tHM(DATA.meta.asof.crosses)+'</span>', ts:DATA.meta.asof.crosses, mkt:'fut', tag:isAuto('crosses')?'DELAYED':'SNAPSHOT', tagc:isAuto('crosses')?'ok':'cz'}));
  var YL=fx.yields_live||{}, y10=YL['10Y'];
  ['10Y','5Y','30Y'].forEach(function(tn){ var y=YL[tn], close=fx.treasury&&fx.treasury[tn];
    if(y&&y.y!=null) t.push(qtTile({k:'ust'+tn, name:'US '+tn, sub:'yield', v:+y.y, dec:3, chg:y.chg_bp!=null?'<span class="'+cls(y.chg_bp)+'">'+sgn(y.chg_bp,1,' bp')+'</span>':'', foot:'<span class="qt-t">'+esc(y.label||'')+'</span>', ts:y.ts, mkt:'bond', tag:y.stale?'LAST':'DELAYED', tagc:y.stale?'warn':'ok', title:'change vs the official close '+fmt(+y.close,3)+'%'}));
    else if(close!=null) t.push(qtTile({k:'ust'+tn, name:'US '+tn, sub:'yield', v:+close, dec:3, chg:'', foot:'<span class="qt-t">'+esc(DATA.meta.asof.yields?fmtShortDate(DATA.meta.asof.yields.slice(0,10)):'')+'</span>', tag:'CLOSE', tagc:'cz'})); });
  if(y10&&y10.sp_ca!=null) t.push(qtTile({k:'sp10', name:'US–CA 10Y', sub:'bp', v:+y10.sp_ca, dec:1, chg:R['10Y']?'<span class="'+cls(y10.sp_ca-R['10Y'].sp)+'">'+sgn(y10.sp_ca-R['10Y'].sp,1,' bp')+'</span>':'', foot:'<span class="qt-t">'+esc(y10.label||'')+'</span>', ts:y10.ts, mkt:'bond', tag:y10.ca_leg==='est'?'EST':'DELAYED', tagc:y10.ca_leg==='est'?'warn':'ok', title:'Live US 10Y (^TNX) minus Canada 10Y '+(y10.ca_leg==='est'?'estimated from the ZFM.TO federal-bond ETF':'official close')}));
  else if(R['10Y']) t.push(qtTile({k:'sp10', name:'US–CA 10Y', sub:'bp', v:+R['10Y'].sp, dec:1, chg:'', foot:'<span class="qt-t">'+esc(DATA.meta.asof.yields?fmtShortDate(DATA.meta.asof.yields.slice(0,10)):'')+'</span>', tag:'CLOSE', tagc:'cz'}));
  return '<div class="qt-grid">'+t.join('')+'</div>'+'<div class="qt-chk" title="The desk re-checks every source about once a minute; each tile shows its own quote time and how old it is">Feed checked <b data-clock-src="live_at"></b> · <span data-age-src="live_at"></span> · prices refresh on their own cycle</div>';
}
function spotStamp(){
  var f=DATA.fx&&DATA.fx.feed||{}, t=f.ts?Date.parse(f.ts):null;
  return '<span class="sl-k" data-live-ts="usdcad">'+(t?new Date(t).toLocaleTimeString('en-US',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit'})+' ET':'')+'</span>'+(t?'<span class="qt-age" data-age-k="usdcad" data-age="'+new Date(t).toISOString()+'" data-age-max="120"></span>':'');
}
function grainSubnavHTML(key){
  var now=Date.now(), us=usdaEvents(key, now, 120), ca=caEvents(now, 180), all=us.concat(ca).sort(function(a,b){ return a.t-b.t; });
  var geo=dstate(key).fgeo||'us', g=DATA.grains[key], f=g.fan, meta=GMETA[key], L=+f.intraday[0], A=+f.anchor, ch=L-A, fx=+DATA.fx.feed.mid;
  var live=grainTilesHTML(key);
  return subnavHTML(key, [
    {id:'overview', label:'Overview', ev:nextOf(all, function(e){ return e.kind==='wasde'||e.kind==='contract'||e.kind==='ca'; })||nextOf(all)},
    {id:'deriv', label:'Derivatives', ev:nextOf(us, function(e){ return e.kind==='contract'||e.kind==='cftc'; })},
    {id:'inputs', label:'Input Costs', ev:inputsNextEvent()},
    {id:'fund', label:'Fundamentals '+({us:'USDA',on:'Ontario',ca:'Canada',br:'Brazil',world:'World'}[geo]||'USDA'), ev:(geo==='ca'||geo==='on')?nextOf(ca):nextOf(us, function(e){ return e.kind==='usda'||e.kind==='wasde'; })},
    {id:'prices', label:'Prices', ev:nextOf(us, function(e){ return e.kind==='contract'; })}
  ], live);
}
function renderGrain(key){ try{ oiSanitize(DATA); }catch(e){} 
  var g=DATA.grains[key], meta=GMETA[key], f=g.fan, last=g.cftc[g.cftc.length-1], prev=g.cftc[g.cftc.length-2];
  var MA50=f.ma50||{corn:"5.10", soybeans:"12.75", wheat:"7.05"}[key];
  var wow = last.net - prev.net;
  var html='<div class="layout"><div class="grid">'+grainSubnavHTML(key), OV=grainKpiHTML(key)+grainDashboardHTML(key), DV='', FU='';
  /* fan tile */
  var FL=fanLevels(g, meta);
  OV+='<div class="tile wide" data-src="grains_quote" data-src2="options" data-grain="'+key+'"><h2>'+meta.name+' '+meta.contract+' — 10-day σ fan <span class="h2note">double-click the chart to zoom · settle fan anchored '+fmtDate(f.settle_date)+' · live fan re-anchored on the latest delayed quote</span></h2>'+
    '<div class="stat-row" style="margin:6px 0 10px">'+
    stat("Daily σ", "$"+fmt(f.sig,4)) +
    stat("Chain IV", fmt(f.iv_chain_iv,2)+"%") +
    stat("MA20 / 50 / 100", "$"+f.ma20+" / $"+MA50+(f.ma100?" / $"+f.ma100:"")) +
    stat("Settle 10-day 95% range", f.r10[0].toFixed(2)+" – "+f.r10[1].toFixed(2)) +
    stat("Settle 10-day 99% range", f.r10_99[0].toFixed(2)+" – "+f.r10_99[1].toFixed(2)) +
    '</div>'+ fanChipsHTML(key)+ '%%FANZOOM%%'+ fanSVG2(g, meta, FL)+ fanRulerHTML(g, FL)+
    '<p class="posread">'+esc(FL.read)+'</p>'+
    '<div class="legend"><span><span class="sw" style="background:#dbe4f0"></span>Verified settlements ('+g.history.length+')</span><span><span class="sw" style="background:'+meta.accent+'"></span>Settle-anchored fan (LATEST VERIFIED)</span><span><span class="sw" style="background:#38b6c9"></span>Live-anchored fan (delayed quote '+esc(f.intraday[1]||'')+')</span><span><span class="sw" style="background:#f0c169"></span>MA20</span><span><span class="sw" style="background:#b18cff"></span>MA50 / options walls</span><span><span class="sw" style="background:#ff6b6b"></span>Market (delayed)</span><span>Right-edge labels: every live-fan level at day 10, spaced apart with leader lines to each level\u2019s true price — no label overlaps another · exp MA20 / exp MA50 are flat zero-drift extensions of the last trailing values, labeled \u201cexp\u201d — never predictions · IV band uses chain IV '+fmt(f.iv_chain_iv,2)+'% × √(10/252)</span></div>'+
    '<div class="stamp">Settle fan from '+g.history.length+' daily settles through '+fmtDate(f.settle_date)+' (σ = st.dev of the last 30 daily changes) · live fan re-anchored on the delayed quote '+esc(f.intraday[1])+'</div></div>';
  OV=OV.replace('%%FANZOOM%%', fanZoomHTML(key));
  /* export sales — 10-week trend */
  FU+=wasdeTableHTML(key)+exportTileHTML(key)+destTileHTML(key);
  /* insight + curve (both computed from the data) */
  OV+='<div class="tile wide" data-src="model"><h2>Insight</h2><p class="read">'+grainInsight(key)+'</p><div class="stamp">Generated from the current settles, options and CFTC data</div></div>';
  DV+=positioningKpiHTML(key)+cockpitHTML(key)+volTermHTML(key)+grainSpreadsHTML(key).replace('class="tile"','class="tile wide"');
  /* positioning (toggle target) */
  DV+='<div class="tile wide" data-src="options" id="pos-'+key+'">'+positioningHTML(key)+'</div>';
  /* OI chart (toggle target) */
  DV+='<div class="tile wide" data-src="options" id="oi-'+key+'">'+oiTileHTML(key)+'</div>';
  /* rollover — full card replication */
  DV+=flowTileHTML(key)+rollTileHTML(key);
  /* skew */
  DV+='<div class="tile wide" data-src="options"><h2>IV skew <span class="h2note">— liquid side · ±2σ window</span></h2>'+ skewSVG(g, meta)+
    '<div class="legend"><span><span class="sw" style="background:var(--put)"></span>Puts below futures</span><span><span class="sw" style="background:var(--call)"></span>Calls at/above futures</span></div>'+
    '<div class="stamp">'+(f.iv_note?esc(f.iv_note):'Per-strike theoretical IV'+(f.iv_as_of?', as of '+esc(fmtDate(f.iv_as_of)):''))+' · window = futures ± 2× the 10-day σ · market-implied, not a prediction</div></div>';
  /* CFTC */
  DV+='<div class="tile wide" data-src="cftc_grains"><h2>CFTC managed money <span class="h2note">— weekly, latest verified · every bar labeled, trend line across the weekly nets</span></h2>'+
    '<div class="big" style="color:'+(last.net>=0?'var(--green)':'var(--red)')+'">'+(last.net>=0?'+':'−')+fmt(Math.abs(last.net))+' <span style="font-size:14px;color:var(--muted)">net contracts</span></div>'+
    '<div class="stat-row">'+stat("Long", fmt(last.long)) + stat("Short", fmt(last.short)) +
    stat("Week over week", '<span class="'+cls(wow)+'">'+sgn(wow,0)+'</span>')+
    stat("Report date", fmtDate(last.date))+'</div>'+
    cftcSVG(g.cftc, {basis:g.cftc_stats&&g.cftc_stats.basis, series0:g.cftc})+
    '<p class="read">'+cftcRead(g.cftc, {basis:g.cftc_stats&&g.cftc_stats.basis, F:+f.intraday[0]})+'</p>'+
    '<div class="legend"><span><span class="sw" style="background:#3fb97f"></span>Net long week</span><span><span class="sw" style="background:#e0655f"></span>Net short week</span><span><span class="sw" style="background:#e8eef4"></span>Trend line (weekly nets)</span><span>Value label on every bar, on a dark backing plate so the trend line never overprints it</span></div>'+
    '<div class="stamp">Managed-money net, trailing '+g.cftc.length+' weekly reports \u00b7 CFTC disaggregated futures-only \u00b7 '+(DATA.meta.cftc_direct?esc(DATA.meta.cftc_direct):'auto-refreshed')+'</div></div>';
  OV+=askTileHTML(key);
  var st=dstate(key), geo=st.fgeo||'us';
  if(geo==='ca'||geo==='on'){ caState(key).ca_geo=(geo==='on'?'Ontario':'Canada'); }
  var gb=function(v,l){ return '<button data-dash="'+key+'" data-k="fgeo" data-v="'+v+'" aria-pressed="'+(geo===v)+'">'+l+'</button>'; };
  var FH='<div class="tile wide geo-head"><div class="tile-head"><h2>'+meta.name+' fundamentals <span class="h2note">— pick a geography</span></h2><span class="toggle" role="group">'+gb('us',flag('us',11)+' US · USDA / WASDE')+gb('ca',flag('ca',11)+' CANADA · STATCAN')+gb('on',flag('ca',11)+' ONTARIO')+gb('br',(window.WORLD&&WORLD.flag?WORLD.flag('br',11):'')+' BRAZIL \u00b7 CONAB')+gb('world',(window.WORLD&&WORLD.flag?WORLD.flag('xx',11):'')+' WORLD \u00b7 USDA')+'</span></div></div>';
  FU=(geo==='br'||geo==='world')?FH+cropCompareHTML(key)+(window.GG?GG.exportsHTML(key)+GG.html(key,geo):'<div class="tile wide"><p class="note">Loading global grain data\u2026</p></div>'):FH+cropCompareHTML(key)+(window.GG&&window.SUB&&SUB[key]==='fund'?GG.exportsHTML(key):'<div class="tile wide"><h2>Export comparison <span class="h2note">\u2014 US \u00b7 Canada \u00b7 Brazil</span></h2><p class="note">Loads when Fundamentals is open\u2026</p></div>')+(geo==='us'?FU:canadaTileHTML(key,true)+canadaChartsHTML(key)+caCalendarHTML());
  html+=subWrap(key,'overview',OV)+subWrap(key,'deriv',DV)+subWrap(key,'fund',FU)+subWrap(key,'inputs',inputsHTML(key))+subWrap(key,'prices',(window.GPRICES?GPRICES.html(key):'<div class="tile wide"><p class="note">Loading forward months…</p></div>'));
  html+='</div><aside class="rail">'+grainAlertsLiveHTML(key)+grainCalendarHTML(key)+newsRailHTML(NEWS[key], key)+'</aside></div>';
  document.getElementById('panel-'+key).innerHTML=html;
}

/* ---------------- FX tab render ---------------- */
function fxClosesSVG(fx){
  var rows=fx.closes, W=760,H=300,PL=52,PR=76,PT=22,PB=46, pw=W-PL-PR, ph=H-PT-PB;
  var vals=rows.map(function(r){return r[1];});
  var rawLo=Math.min.apply(null,vals), rawHi=Math.max.apply(null,vals);
  var hiI=vals.indexOf(rawHi), loI=vals.indexOf(rawLo);
  var lo=rawLo, hi=rawHi, pad=(hi-lo)*0.16; lo-=pad; hi+=pad;
  function X(i){ return PL+pw*i/(rows.length-1); } function Y(v){ return PT+ph*(1-(v-lo)/(hi-lo)); }
  var s='';
  for(var i=0;i<=4;i++){ var gy=PT+ph*i/4, gv=hi-(hi-lo)*i/4;
    s+='<line x1="'+PL+'" y1="'+gy+'" x2="'+(PL+pw)+'" y2="'+gy+'" stroke="#1e2a3a"/>';
    s+='<text x="'+(PL-6)+'" y="'+(gy+4)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">'+gv.toFixed(4)+'</text>'; }
  var area='M'+X(0)+' '+Y(rows[0][1]); var line=area;
  rows.forEach(function(r,i){ if(i>0){ area+='L'+X(i).toFixed(1)+' '+Y(r[1]).toFixed(1); line+='L'+X(i).toFixed(1)+' '+Y(r[1]).toFixed(1); } });
  s+='<path d="'+area+'L'+X(rows.length-1)+' '+(PT+ph)+'L'+X(0)+' '+(PT+ph)+'Z" fill="#38b6c9" opacity="0.10"/>';
  s+='<path d="'+line+'" fill="none" stroke="#38b6c9" stroke-width="2"/>';
  /* period high marker — value + date, on a backing plate above the point */
  var hx=X(hiI), hy=Y(rawHi), hTxt='HIGH '+rawHi.toFixed(5)+' \u00b7 '+fmtShortDate(rows[hiI][0]);
  var hw=hTxt.length*6.4+10;
  s+='<circle cx="'+hx+'" cy="'+hy+'" r="3.4" fill="#5fd598"/>';
  s+='<rect x="'+(hx-hw/2).toFixed(1)+'" y="'+(hy-26).toFixed(1)+'" width="'+hw.toFixed(1)+'" height="16" rx="3" fill="#0d141f" opacity="0.9"/>';
  s+='<text x="'+hx+'" y="'+(hy-14).toFixed(1)+'" fill="#5fd598" font-size="10.5" font-weight="600" font-family="IBM Plex Mono" text-anchor="middle">'+hTxt+'</text>';
  /* period low marker — value + date (the low is also the last bar) */
  var lx=X(loI), ly=Y(rawLo), lTxt='LOW '+rawLo.toFixed(5)+' \u00b7 '+fmtShortDate(rows[loI][0]);
  var lw=lTxt.length*6.4+10;
  s+='<circle cx="'+lx+'" cy="'+ly+'" r="3.4" fill="#ff9d97"/>';
  s+='<rect x="'+(lx-lw+8).toFixed(1)+'" y="'+(ly+8).toFixed(1)+'" width="'+lw.toFixed(1)+'" height="16" rx="3" fill="#0d141f" opacity="0.9"/>';
  s+='<text x="'+(lx+2).toFixed(1)+'" y="'+(ly+20).toFixed(1)+'" fill="#ff9d97" font-size="10.5" font-weight="600" font-family="IBM Plex Mono" text-anchor="end">'+lTxt+'</text>';
  /* last value */
  var li=rows.length-1;
  s+='<circle cx="'+X(li)+'" cy="'+Y(rows[li][1])+'" r="3.6" fill="#fff"/>';
  s+='<text x="'+(X(li)+8)+'" y="'+(Y(rows[li][1])-8)+'" fill="#fff" font-size="11.5" font-weight="600" font-family="IBM Plex Mono">LAST '+rows[li][1].toFixed(5)+'</text>';
  /* full date axis — every bar dated, rotated so none overlap */
  rows.forEach(function(r,i){
    var cx=X(i), ay=PT+ph+10;
    s+='<text x="'+cx.toFixed(1)+'" y="'+ay+'" transform="rotate(-38 '+cx.toFixed(1)+' '+ay+')" fill="#8f9db3" font-size="9.5" font-family="IBM Plex Mono" text-anchor="end">'+fmtShortDate(r[0])+'</text>';
  });
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="USD/CAD daily closes, end of day, full date axis, period high and low marked with values and dates, last value labeled">'+s+'</svg>';
}


/* ---------------- USD/CAD dashboard pieces ---------------- */
function sparkPath(vals, W, H){
  if(!vals || vals.length<2) return '';
  var mn=Math.min.apply(null,vals), mx=Math.max.apply(null,vals), r=(mx-mn)||1;
  var d=vals.map(function(v,i){ return (i?'L':'M')+(i/(vals.length-1)*W).toFixed(1)+' '+(H-2-(v-mn)/r*(H-4)).toFixed(1); }).join('');
  var up=vals[vals.length-1]>=vals[0];
  return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" class="kpi-spark" aria-hidden="true"><path d="'+d+'" fill="none" stroke="'+(up?'#3fb97f':'#e0655f')+'" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>';
}
function kpi(label, valHTML, subHTML, spark, id){
  return '<div class="kpi"'+(id?' id="'+id+'"':'')+'><div class="kpi-k">'+label+'</div><div class="kpi-v">'+valHTML+'</div><div class="kpi-s">'+(subHTML||'')+'</div>'+(spark||'')+'</div>';
}
/* ---------------- Macro monitor ---------------- */
function macroSpark(h, colr){
  var v=h.map(function(x){ return x[1]; });
  if(v.length<2) return '';
  var W=160, H=34, mn=Math.min.apply(null,v), mx=Math.max.apply(null,v), r=(mx-mn)||1;
  var pts=v.map(function(y,i){ return [(i/(v.length-1)*(W-6)+3), (H-4-(y-mn)/r*(H-8))]; });
  var d=pts.map(function(p,i){ return (i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1); }).join('');
  var z=(mn<0&&mx>0)?'<line x1="0" x2="'+W+'" y1="'+(H-4-(0-mn)/r*(H-8)).toFixed(1)+'" y2="'+(H-4-(0-mn)/r*(H-8)).toFixed(1)+'" stroke="#28374e" stroke-dasharray="2 3"/>':'';
  var L=pts[pts.length-1];
  return '<svg viewBox="0 0 '+W+' '+H+'" class="m-spark" aria-hidden="true">'+z+'<path d="'+d+'" fill="none" stroke="'+colr+'" stroke-width="1.6" stroke-linejoin="round"/>'+
    '<circle cx="'+L[0].toFixed(1)+'" cy="'+L[1].toFixed(1)+'" r="2.8" fill="'+colr+'"/></svg>';
}
function macroCard(m){
  var u=m.unit==='K'?'K':m.unit, ch=m.chg, flat=Math.abs(ch)<Math.pow(10,-m.dec)/2;
  var tone=flat?'neu':m.good==='heat'?(ch>0?'heat':'cool'):((m.good==='up')===(ch>0)?'up':'dn');
  var col={up:'#3fb97f',dn:'#e0655f',heat:'#e8a33d',cool:'#38b6c9',neu:'#8494ab'}[tone];
  var arrow=flat?'▸':ch>0?'▲':'▼';
  var chU=(m.unit==='%'||m.measure==='y/y')?' pp':m.unit==='K'?'K':'';
  var mv=Math.abs(m.value)<Math.pow(10,-m.dec)/2?0:m.value;   /* no "-0.0" */
  var val=(m.measure==='m/m'&&mv>0?'+':'')+fmt(mv,m.dec)+u;
  var hist=m.history.map(function(h){ return h[0]+': '+fmt(h[1],m.dec)+u; }).join(' · ');
  return '<div class="mcard has-flag" role="button" tabindex="0" data-mkey="'+m.key+'" title="'+esc('Click for the full breakdown · '+m.name+' — last '+m.history.length+' readings: '+hist)+'">'+
    cflag(m.group)+'<div class="mk">'+esc(m.name)+(m.measure?' <span>'+m.measure+'</span>':'')+'</div>'+
    '<div class="mv">'+val+'</div>'+
    '<div class="mc '+tone+'">'+arrow+' '+(flat?'unch.':sgn(ch,m.dec,chU))+' <span>vs '+esc(m.history.length>1?m.history[m.history.length-2][0]:'prior')+'</span></div>'+
    macroSpark(m.history,col)+
    '<div class="mp">'+esc(m.period)+' · '+({D:'daily',W:'weekly',M:'monthly',Q:'quarterly'}[m.freq]||'')+'</div>'+nextReleaseHTML(m.key,true)+'</div>';
}
function macroDiffs(){
  var M={}; (DATA.macro||[]).forEach(function(m){ M[m.key]=m; });
  var fx=DATA.fx, out=[];
  function card(name, val, sub, tip){ return '<div class="mcard mdiff" title="'+esc(tip)+'"><div class="mk">'+name+'</div><div class="mv">'+val+'</div><div class="mc neu">'+sub+'</div><div class="mp">US minus Canada</div></div>'; }
  if(M.us_cpi&&M.ca_cpi){ var g=M.us_cpi.value-M.ca_cpi.value; out.push(card('CPI gap', sgn(g,1,' pp'), 'US '+fmt(M.us_cpi.value,1)+'% vs CA '+fmt(M.ca_cpi.value,1)+'%', 'Inflation differential: '+M.us_cpi.period+' vs '+M.ca_cpi.period)); }
  if(M.us_ur&&M.ca_ur){ var u=M.us_ur.value-M.ca_ur.value; out.push(card('Unemployment gap', sgn(u,1,' pp'), 'US '+fmt(M.us_ur.value,1)+'% vs CA '+fmt(M.ca_ur.value,1)+'%', 'Labour-market slack differential')); }
  var fr=/(\d{3})-(\d{3})/.exec(fx.policy.fed_range||'');
  if(fr){ var fed=(+fr[1]+ +fr[2])/200, pg=fed-fx.policy.corra_now; out.push(card('Policy rate gap', sgn(pg,2,' pp'), 'Fed mid '+fmt(fed,3)+'% vs BoC '+fmt(fx.policy.corra_now,2)+'%', 'Fed funds range midpoint minus BoC overnight target')); }
  return out.join('');
}
function fxMacroHTML(){
  var all=macroAll();
  if(!all.length) return '<div class="tile wide" data-src="macro"><h2>Macro monitor</h2><p class="note">US and Canada indicators load on the next data refresh.</p></div>';
  all=all.filter(function(m){ return !m.chart_only; });
  function grp(g){ return all.filter(function(m){ return m.group===g; }).map(macroCard).join(''); }
  var errs=DATA.meta.macro_errors?Object.keys(DATA.meta.macro_errors).length:0;
  return '<div class="tile wide" data-src="macro"><h2>All macro indicators <span class="h2note">— click any card for the full breakdown · latest print, change vs prior, last 12 readings</span></h2>'+
    '<div class="m-legend"><span class="up">▲ stronger</span><span class="dn">▼ weaker</span><span class="heat">▲ inflation hotter</span><span class="cool">▼ inflation cooler</span></div>'+
    (MGEO!=='ca'?'<h3 class="m-h">United States <span class="chip inline">USD</span> '+flag('us',15)+'</h3><div class="m-grid">'+grp('us')+'</div>':'')+
    (MGEO!=='us'?'<h3 class="m-h">Canada <span class="chip inline">CAD</span> '+flag('ca',15)+'</h3><div class="m-grid">'+grp('ca')+'</div>':'')+
    (MGEO==='both'?'<h3 class="m-h">US − Canada differentials <span class="h2note">— what moves USD/CAD</span></h3><div class="m-grid">'+macroDiffs()+'</div>':'')+
    '<div class="stamp">Verified '+asOf('macro',true)+' · refreshed every 2h'+(errs?' · '+errs+' series kept at their last good reading':'')+'</div></div>';
}
function fxKpiHTML(){
  var fx=DATA.fx, R={}; fx.rates.forEach(function(r){ R[r.t]=r; });
  var chg=(fx.feed.mid/fx.spot.ref-1)*100, p=fx.pos, wti=fx.energy[0], ten=R["10Y"];
  var closes=fx.closes.map(function(c){ return c[1]; }), nets=(p.series||[]).map(function(r){ return r.net; });
  return '<div class="tile wide kpi-strip">'+
    kpi('USD/CAD', '<span id="kpi-spot" data-tick="kpi-usdcad" data-roll>'+fmt(fx.feed.mid,5)+'</span>', '<span id="kpi-spot-chg" class="'+cls(chg)+'">'+sgn(chg,2,'%')+'</span> vs '+fmt(fx.spot.ref,4), sparkPath(closes,120,26), 'kpi-spot-card')+
    kpi('10Y US–CA', fmt(ten.sp,1)+'<small> bps</small>', '<span class="'+cls(ten.dod)+'">'+sgn(ten.dod,1)+'</span> d/d · <span class="'+cls(ten.wow)+'">'+sgn(ten.wow,1)+'</span> w/w')+
    kpi('CFTC CAD net', sgn(Math.round(p.net/1000),0)+'<small>k</small>', fmt(p.pct_oi,1)+'% of OI · <span class="'+cls(p.wow)+'">'+sgn(Math.round(p.wow/100)/10,1)+'k</span> w/w', sparkPath(nets,120,26))+
    kpi('1-day bias', esc(fx.bias.label.replace(' USD/CAD','').replace('Conditional ','')), 'bear '+fmt(fx.scen.bearish_usdcad.probability_pct,0)+'% · bull '+fmt(fx.scen.bullish_usdcad.probability_pct,0)+'%')+
    kpi('WTI', '$'+fmt(wti.last,2), '<span class="'+cls(wti.pct)+'">'+sgn(wti.pct,2,'%')+'</span> · WCS diff $'+fmt(fx.wcs_diff.value,2))+
    '</div>';
}

/* OLS slope per step, used for every trend read */
function olsSlope(v){
  var n=v.length, mx=(n-1)/2, my=v.reduce(function(a,b){return a+b;},0)/n, num=0, den=0;
  v.forEach(function(y,i){ num+=(i-mx)*(y-my); den+=(i-mx)*(i-mx); });
  return den?num/den:0;
}
function releaseSVG(rel){
  var H=rel.history, vals=H.map(function(h){ return h[1]; }), n=vals.length;
  var W=520, Ht=200, PL=12, PR=12, PT=26, PB=34, pw=W-PL-PR, ph=Ht-PT-PB;
  var ext=vals.concat(rel.consensus!=null?[rel.consensus]:[]).concat(rel.target!=null?[rel.target]:[]);
  var bars=rel.unit==='K';
  var mn=Math.min.apply(null,ext.concat(bars?[0]:[])), mx=Math.max.apply(null,ext.concat(bars?[0]:[])), rg=(mx-mn)||1;
  mn-=rg*0.18; mx+=rg*0.22;
  function Y(v){ return PT+ph*(1-(v-mn)/(mx-mn)); }
  var slot=pw/n; function X(i){ return PL+slot*i+slot/2; }
  var s='', d=rel.dec;
  if(rel.target!=null){ s+='<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+Y(rel.target).toFixed(1)+'" y2="'+Y(rel.target).toFixed(1)+'" stroke="#38b6c9" stroke-dasharray="2 4"/>'+
    '<text x="'+(W-PR)+'" y="'+(Y(rel.target)-4).toFixed(1)+'" fill="#38b6c9" font-size="10" font-family="IBM Plex Mono" text-anchor="end">'+esc(rel.target_label)+'</text>'; }
  if(bars) s+='<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+Y(0).toFixed(1)+'" y2="'+Y(0).toFixed(1)+'" stroke="#3d5a80"/>';
  var path='';
  H.forEach(function(h,i){
    var v=h[1], last=i===n-1, col=bars?(v>=0?'#3fb97f':'#e0655f'):'#dbe4f0';
    if(bars){ var bw=slot*0.56, top=Math.min(Y(v),Y(0)); s+='<rect x="'+(X(i)-bw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(1,Math.abs(Y(v)-Y(0))).toFixed(1)+'" fill="'+col+'" opacity="'+(last?1:0.65)+'"/>'; }
    else { path+=(path?'L':'M')+X(i).toFixed(1)+' '+Y(v).toFixed(1); }
  });
  if(!bars){ s+='<path d="'+path+'" fill="none" stroke="#dbe4f0" stroke-width="2"/>';
    H.forEach(function(h,i){ s+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(h[1]).toFixed(1)+'" r="'+(i===n-1?4.5:3)+'" fill="'+(i===n-1?'#e8a33d':'#dbe4f0')+'"/>'; }); }
  /* OLS trend line across the readings */
  if(n>=3){ var b=olsSlope(vals), a=vals.reduce(function(x,y){return x+y;},0)/n-b*(n-1)/2;
    s+='<line x1="'+X(0).toFixed(1)+'" y1="'+Y(a).toFixed(1)+'" x2="'+X(n-1).toFixed(1)+'" y2="'+Y(a+b*(n-1)).toFixed(1)+'" stroke="#b18cff" stroke-width="1.6" stroke-dasharray="6 4"/>'; }
  /* consensus tick on the latest reading */
  if(rel.consensus!=null && H[n-1][0]===rel.period){
    s+='<line x1="'+(X(n-1)-slot*0.38).toFixed(1)+'" x2="'+(X(n-1)+slot*0.38).toFixed(1)+'" y1="'+Y(rel.consensus).toFixed(1)+'" y2="'+Y(rel.consensus).toFixed(1)+'" stroke="#e8a33d" stroke-width="2"/>'; }
  H.forEach(function(h,i){
    var v=h[1], ly=bars&&v<0?Y(v)+14:Y(v)-9;
    s+='<text x="'+X(i).toFixed(1)+'" y="'+ly.toFixed(1)+'" fill="'+(i===n-1?'#e8a33d':'#b9c7da')+'" font-size="11" font-weight="600" font-family="IBM Plex Mono" text-anchor="middle">'+(bars&&v>0?'+':'')+fmt(v,d)+'</text>'+
      '<text x="'+X(i).toFixed(1)+'" y="'+(Ht-PB+18)+'" fill="#8494ab" font-size="10.5" font-family="IBM Plex Mono" text-anchor="middle">'+h[0].slice(0,3)+(i===0||h[0].slice(0,3)==='Jan'?" '"+h[0].slice(-2):'')+'</text>';
  });
  return '<svg viewBox="0 0 '+W+' '+Ht+'" role="img" aria-label="'+esc(rel.name)+' — last '+n+' readings with trend line">'+s+'</svg>';
}
function releaseRead(rel){
  var v=rel.history.map(function(h){ return h[1]; }), n=v.length, u=rel.unit==='K'?'K':rel.unit==='%'?'pp':'', d=rel.dec;
  if(n<2) return 'History fills in on the next data refresh.';
  var b=olsSlope(v), avg=v.reduce(function(a,c){return a+c;},0)/n, last=v[n-1], prev=v[n-2];
  var dir=Math.abs(b)<(rel.unit==='K'?5:0.03)?'flat':b>0?'rising':'falling';
  var ups=0; for(var i=1;i<n;i++) if(v[i]>v[i-1]) ups++;
  var a3=v.slice(-3).reduce(function(a,c){return a+c;},0)/Math.min(3,n);
  return 'Trend over '+n+' readings: <b>'+dir+'</b> ('+sgn(b,rel.unit==='K'?0:2,' '+u+'/mo')+') · up in '+ups+' of '+(n-1)+' months · '+
    'latest '+(last>=prev?'<b>above</b>':'<b>below</b>')+' prior ('+sgn(last-prev,d,rel.unit==='K'?'K':' pp')+') · 3-mo avg '+fmt(a3,d+(rel.unit==='K'?0:1))+(rel.unit==='K'?'K':'%')+' vs '+n+'-mo avg '+fmt(avg,d+(rel.unit==='K'?0:1))+(rel.unit==='K'?'K':'%')+'.';
}
/* Latest releases — built from DATA.macro (the same numbers as the Macro dashboard), so a new print shows here the moment the desk has it.
   Release time = latest official calendar date that has passed; a print still awaited is marked. Click a card for its full history (chart / table). */
var RELN=12;
function cpiHas(g){ var C=g==='ca'?DATA.cpi_detail_ca:DATA.cpi_detail; return !!(C&&C.items&&C.items.length); }
document.addEventListener('click', function(ev){ var b=ev.target.closest&&ev.target.closest('[data-cpigo]'); if(!b) return; ev.stopPropagation();
  if(window.CPI_SHOW) CPI_SHOW(b.getAttribute('data-cpigo')); if(typeof closeMacroDetail==='function') closeMacroDetail();
  var t=document.getElementById('tabbtn-macro'); if(t) t.click(); setSub('macro','cpi'); renderMacro();
  setTimeout(function(){ var c=document.getElementById('cpi-internals'); if(c){ var th=(document.querySelector('.tabs')||{}).offsetHeight||0, sh=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--strip-h'))||0; window.scrollTo({top:c.getBoundingClientRect().top+window.scrollY-th-sh-12,behavior:'smooth'}); c.classList.add('flash-find'); setTimeout(function(){ c.classList.remove('flash-find'); },2400); } },120); }, true);
function lastRelMs(key){ var C=DATA.release_cal&&DATA.release_cal[key]; if(!C) return null; var now=Date.now(), best=null;
  (C.dates||[]).forEach(function(x){ var p=x.split('T'), d=p[0].split('-'), h=(p[1]||'08:30').split(':'), t=zonedMs(+d[0],+d[1],+d[2],+h[0],+h[1],'America/Toronto'); if(t<=now&&(best==null||t>best)) best=t; });
  return best; }
function fxReleasesHTML(){
  var now=Date.now(), M=(DATA.macro||[]).filter(function(m){ return !m.chart_only&&(MGEO==='both'||m.group===MGEO); });
  var L=M.map(function(m){ var rt=lastRelMs(m.key), seen=m.seen_at?Date.parse(m.seen_at):null, t=rt||seen; return {m:m, t:t, waiting:!!(rt&&(!seen||seen<rt-5*60000))}; })
    .filter(function(x){ return x.t; }).sort(function(a,b){ return b.t-a.t; });
  var body=L.slice(0,RELN).map(function(x){ var m=x.m, t=new Date(x.t), days=Math.floor((now-x.t)/864e5), H=(m.hist24||m.history).slice(-8);
    var C=typeof consensusFor==='function'?consensusFor(m):null, cons=C&&C.consensus!=null?C.consensus:null;
    var r={unit:m.unit==='K'?'K':'%', dec:m.dec, consensus:x.waiting?null:cons, target:/cpi|pce|trim|median/.test(m.key)?2:null, target_label:m.group==='ca'?'BoC 2% target':'Fed 2% target', history:H};
    var diff=cons!=null&&!x.waiting?m.value-cons:null, better=diff!=null&&(m.good==='down'?diff<0:diff>0), inl=diff!=null&&Math.abs(diff)<Math.pow(10,-m.dec)/2;
    return '<div class="rel mk-click" data-mkey="'+m.key+'" role="button" tabindex="0" title="Click for the full history — chart or table">'+
      '<div class="rel-when"><span class="rel-date">'+t.toLocaleString('en-US',{timeZone:'America/Toronto',weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' ET</span><span class="rel-ago">'+(days<=0?'today':days===1?'yesterday':days+' days ago')+'</span><span class="chip inline">'+(m.group==='us'?'USD':'CAD')+'</span> '+flagCcy(m.group==='us'?'USD':'CAD',14)+'</div>'+
      '<div class="med">'+esc((m.group==='us'?'US ':'Canada ')+m.name)+' ('+esc(m.period)+') — '+mval(m,m.value)+(m.measure?' '+esc(m.measure):'')+
        (x.waiting?' <span class="chip miss">NEW PRINT AWAITED</span>':diff!=null?' <span class="chip '+(inl?'inline':better?'beat':'miss')+'">'+(inl?'IN LINE':diff>0?'ABOVE':'BELOW')+' CONSENSUS</span>':'')+'</div>'+
      (m.gap?'<div class="read" style="margin-top:4px"><b>'+esc(mdLabel(m.gap.period+'-01'))+' released'+(m.gap.mm!=null?': '+sgn(m.gap.mm,1)+'% m/m':'')+'</b> — no 12-month change published (year-earlier index not collected)</div>':'')+
      '<div class="read" style="margin-top:4px">'+(x.waiting?'Released by the agency; the desk still shows the previous print until the source posts it · ':'')+(cons!=null&&!x.waiting?'Consensus '+mval(m,cons)+' · ':'')+'prior '+mval(m,m.prior)+'</div>'+
      (H.length>1?releaseSVG(r)+'<p class="read" style="font-size:13px">'+releaseRead(r)+'</p>':'')+
      (/^(us|ca)_(core_)?cpi$/.test(m.key)&&cpiHas(m.group)?cpiDeepBtn(m.group):'')+'</div>'; }).join('');
  var gb=function(v,l){ return '<button data-mgeo="'+v+'" aria-pressed="'+(MGEO===v)+'">'+l+'</button>'; };
  return '<div class="tile wide" data-src="macro"><div class="tile-head"><h2>Latest releases <span class="h2note">— newest first by official release time · same data as the Macro dashboard · click any card for its full history</span></h2>'+
    '<span class="toggle" role="group" aria-label="Country">'+gb('both',flag('us',11)+' + '+flag('ca',11))+gb('us',flag('us',11)+' US')+gb('ca',flag('ca',11)+' CANADA')+'</span></div>'+
    '<div class="rel-grid">'+body+'</div>'+(L.length>RELN?'<button class="ue-btn rel-more" data-relmore>Show '+Math.min(12,L.length-RELN)+' more</button>':'')+
    '<div class="stamp">'+L.length+' indicators · '+(MGEO==='both'?'US + Canada':MGEO==='us'?'US':'Canada')+' (follows the Dashboard switch) · release times from the official calendars, Toronto time</div></div>';
}
document.addEventListener('click', function(ev){ if(ev.target.closest&&ev.target.closest('[data-relmore]')){ RELN+=12; renderMacro(); } });
function fxCftcHTML(){
  var fx=DATA.fx, p=fx.pos, S=p.series||[];
  var chart = S.length>=5 ? cftcSVG(S, Object.assign({},FXPX,{basis:p.basis, series0:S})).replace('MANAGED MONEY','LEVERAGED FUNDS').replace(/Managed money/,'Leveraged funds')+'<p class="read">'+cftcRead(S, Object.assign({},FXPX,{basis:p.basis,F:+fx.feed.mid}))+'</p>'
                          : '<p class="note">Weekly history fills in on the next data refresh (CFTC Traders in Financial Futures).</p>';
  return '<div class="tile wide" data-src="cftc_fx"><h2>CFTC CAD — leveraged funds <span class="h2note">— weekly, every bar labeled, trend line across the weekly nets</span></h2>'+
    '<div class="big" style="color:'+(p.net>=0?'var(--green)':'var(--red)')+'">'+(p.net>=0?'+':'−')+fmt(Math.abs(p.net))+' <span style="font-size:14px;color:var(--muted)">net contracts</span></div>'+
    '<div class="stat-row">'+stat("Long", fmt(p.long))+stat("Short", fmt(p.short))+stat("Week over week", '<span class="'+cls(p.wow)+'">'+sgn(p.wow,0)+'</span>')+
    stat("% of OI", fmt(p.pct_oi,1)+'%')+stat("1Y / 3Y percentile", (p.p1y==null?'n/a':ordn(p.p1y))+' / '+(p.p3y==null?'n/a':ordn(p.p3y)))+stat("Report date", asOf('cftc_fx'))+'</div>'+
    '<div class="posread">'+esc(p.label)+'</div>'+chart+
    '<div class="stamp">CFTC Traders in Financial Futures · CAD · leveraged funds long minus short · positions as of Tuesday, published Friday 3:30pm ET</div></div>';
}

function fxIntradaySVG(pts){
  var fx=DATA.fx;
  if(!pts||pts.length<2) return '<div class="note" style="margin:6px 0">Intraday chart builds as quotes arrive.</div>';
  var W=560,H=190,PL=54,PR=78,PT=14,PB=24, pw=W-PL-PR, ph=H-PT-PB;
  var t0=pts[0][0], t1=pts[pts.length-1][0], ys=pts.map(function(p){return p[1];}), ref=fx.spot.ref;
  var lo=Math.min.apply(null,ys.concat([ref])), hi=Math.max.apply(null,ys.concat([ref])), L=fx.levels;
  [L.pivot,L.pivot_h,L.pivot_l].forEach(function(v){ if(v&&v>lo-0.0025&&v<hi+0.0025){ lo=Math.min(lo,v); hi=Math.max(hi,v);} });
  var pad=(hi-lo)*0.12||0.0005; lo-=pad; hi+=pad;
  function X(t){ return PL+pw*(t-t0)/Math.max(1,t1-t0); } function Y(v){ return PT+ph*(1-(v-lo)/(hi-lo)); }
  var s='';
  for(var i=0;i<=3;i++){ var gv=lo+(hi-lo)*i/3; s+='<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+Y(gv).toFixed(1)+'" y2="'+Y(gv).toFixed(1)+'" stroke="#1e2a3a"/><text x="'+(PL-6)+'" y="'+(Y(gv)+4).toFixed(1)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="end">'+gv.toFixed(4)+'</text>'; }
  function hline(v,label,col,dash){ if(v<lo||v>hi) return; s+='<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+Y(v).toFixed(1)+'" y2="'+Y(v).toFixed(1)+'" stroke="'+col+'" stroke-dasharray="'+dash+'"/><text x="'+(W-PR+4)+'" y="'+(Y(v)+3).toFixed(1)+'" fill="'+col+'" font-size="9.5" font-family="IBM Plex Mono">'+label+'</text>'; }
  hline(ref,'PRIOR '+ref.toFixed(4),'#8494ab','4 4'); hline(L.pivot,'PIVOT','#b18cff','2 4'); hline(L.pivot_h,'PIV H','#5fd598','2 4'); hline(L.pivot_l,'PIV L','#ff9d97','2 4');
  var d=pts.map(function(p,i){ return (i?'L':'M')+X(p[0]).toFixed(1)+' '+Y(p[1]).toFixed(1); }).join('');
  var up=ys[ys.length-1]>=ref, col=up?'#3fb97f':'#e0655f';
  s+='<path d="'+d+'L'+X(t1).toFixed(1)+' '+(PT+ph)+'L'+X(t0).toFixed(1)+' '+(PT+ph)+'Z" fill="'+(up?'rgba(63,185,127,.10)':'rgba(224,101,95,.10)')+'"/>';
  s+='<path d="'+d+'" fill="none" stroke="'+col+'" stroke-width="1.8" stroke-linejoin="round"/>';
  var lp=pts[pts.length-1], pp=pts[pts.length-2], tick=lp[1]>pp[1]?'\u25b2':lp[1]<pp[1]?'\u25bc':'\u25b8', tcol=lp[1]>=ref?'#1f8a57':'#b8443f';
  s+='<circle class="mv-last" cx="'+X(lp[0]).toFixed(1)+'" cy="'+Y(lp[1]).toFixed(1)+'" r="4" fill="'+col+'" stroke="#fff" stroke-width="1"/>';
  var ty=Math.max(PT+8,Math.min(PT+ph-8,Y(lp[1])));
  s+='<rect x="'+(W-PR+2)+'" y="'+(ty-9).toFixed(1)+'" width="'+(PR-4)+'" height="18" rx="3" fill="'+tcol+'"/><text x="'+(W-PR/2)+'" y="'+(ty+4).toFixed(1)+'" fill="#fff" font-size="10.5" font-weight="700" font-family="IBM Plex Mono" text-anchor="middle">'+tick+' '+lp[1].toFixed(4)+'</text>';
  var hiP=pts.reduce(function(a,b){return b[1]>a[1]?b:a;}), loP=pts.reduce(function(a,b){return b[1]<a[1]?b:a;});
  s+='<text x="'+X(hiP[0]).toFixed(1)+'" y="'+(Y(hiP[1])-5).toFixed(1)+'" fill="#5fd598" font-size="9.5" font-family="IBM Plex Mono" text-anchor="middle">H '+hiP[1].toFixed(5)+'</text>';
  s+='<text x="'+X(loP[0]).toFixed(1)+'" y="'+(Y(loP[1])+12).toFixed(1)+'" fill="#ff9d97" font-size="9.5" font-family="IBM Plex Mono" text-anchor="middle">L '+loP[1].toFixed(5)+'</text>';
  var span=t1-t0, step=span>8*3600e3?3*3600e3:span>3*3600e3?3600e3:span>3600e3?1800e3:600e3, first=Math.ceil(t0/step)*step;
  for(var tt=first; tt<=t1; tt+=step){ s+='<text x="'+X(tt).toFixed(1)+'" y="'+(H-6)+'" fill="#8f9db3" font-size="10" font-family="IBM Plex Mono" text-anchor="middle">'+new Date(tt).toLocaleTimeString("en-US",{timeZone:"America/Toronto",hour:"numeric",minute:"2-digit"})+'</text>'; }
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="USD/CAD intraday, Toronto time, with prior close and pivot levels">'+s+'</svg>';
}
function fxIntradayPoints(extra){
  var base=(DATA.fx.intraday||[]).map(function(p){ return [new Date(p[0]).getTime(), p[1]]; });
  var all=base.concat(extra||[]).filter(function(p){ return p[1]>0; }).sort(function(a,b){ return a[0]-b[0]; });
  var cut=Date.now()-20*3600e3; return all.filter(function(p){ return p[0]>=cut; });
}
function fxValueDate(tenor){
  /* USD/CAD spot settles T+1; tenor added to the spot date, weekends rolled to Monday (holidays not adjusted) */
  var p={}; new Intl.DateTimeFormat('en-US',{timeZone:'America/Toronto',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(new Date()).forEach(function(q){ p[q.type]=q.value; });
  var d=new Date(Date.UTC(+p.year,+p.month-1,+p.day));
  function roll(x){ while(x.getUTCDay()===0||x.getUTCDay()===6) x.setUTCDate(x.getUTCDate()+1); return x; }
  d.setUTCDate(d.getUTCDate()+1); roll(d);
  var m=/^(\d+)([WMY])$/.exec(tenor), n=+m[1];
  if(m[2]==='W') d.setUTCDate(d.getUTCDate()+7*n); else if(m[2]==='M') d.setUTCMonth(d.getUTCMonth()+n); else d.setUTCFullYear(d.getUTCFullYear()+n);
  return roll(d);
}
function vdLab(d, short){ var M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
  return short?M+' \u2019'+String(d.getUTCFullYear()).slice(2):M+' '+d.getUTCDate()+', '+d.getUTCFullYear(); }
function fxForwardLegs(spot){
  var fx=DATA.fx, us3=fx.treasury["3M"], ca0=fx.policy.corra_now, R={};
  fx.rates.forEach(function(r){ R[r.t]=r; });
  var legs=[["1W",7],["2W",14],["1M",30],["2M",61],["3M",91],["6M",182],["9M",273]].map(function(l){ return [l[0],l[1],us3,ca0]; });
  [["1Y",365],["2Y",730],["5Y",1825]].forEach(function(l){ if(R[l[0]]) legs.push([l[0],l[1],R[l[0]].us,R[l[0]].ca]); });
  return legs.map(function(c){
    var T=c[1]/365, F=spot*(1+c[3]/100*T)/(1+c[2]/100*T);
    var vd=fxValueDate(c[0]);
    return {t:c[0], days:c[1], F:F, pts:(F-spot)*10000, ann:(F/spot-1)/T*100, vd:vd};
  });
}
function fxForwardSVG(spot, L){
  var W=760, H=290, PL=58, PR=20, PT=24, PB=50, pw=W-PL-PR, ph=H-PT-PB;
  var xs=L.map(function(l){ return Math.sqrt(l.days); }), x0=0, x1=Math.max.apply(null,xs);
  var ys=L.map(function(l){ return l.F; }).concat([spot]), mn=Math.min.apply(null,ys), mx=Math.max.apply(null,ys), rg=(mx-mn)||0.001;
  mn-=rg*0.08; mx+=rg*0.12;
  function X(d){ return PL+pw*(Math.sqrt(d)-x0)/(x1-x0); }
  function Y(v){ return PT+ph*(1-(v-mn)/(mx-mn)); }
  var s='';
  for(var g=0; g<=4; g++){ var gv=mn+(mx-mn)*g/4, gy=Y(gv);
    s+='<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+gy.toFixed(1)+'" y2="'+gy.toFixed(1)+'" stroke="#1e2a3a"/>'+
       '<text x="'+(PL-6)+'" y="'+(gy+4).toFixed(1)+'" fill="#8f9db3" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">'+gv.toFixed(4)+'</text>'; }
  /* spot reference */
  s+='<line x1="'+PL+'" x2="'+(W-PR)+'" y1="'+Y(spot).toFixed(1)+'" y2="'+Y(spot).toFixed(1)+'" stroke="#38b6c9" stroke-dasharray="4 4"/>'+
     '<text x="'+(W-PR)+'" y="'+(Y(spot)-5).toFixed(1)+'" fill="#38b6c9" font-size="10.5" font-family="IBM Plex Mono" text-anchor="end">SPOT '+fmt(spot,5)+'</text>';
  /* area + curve from spot (day 0) through each tenor */
  var line='M'+X(0).toFixed(1)+' '+Y(spot).toFixed(1);
  L.forEach(function(l){ line+='L'+X(l.days).toFixed(1)+' '+Y(l.F).toFixed(1); });
  s+='<path d="'+line+'L'+X(L[L.length-1].days).toFixed(1)+' '+Y(spot).toFixed(1)+'Z" fill="rgba(224,101,95,.12)"/>';
  s+='<path d="'+line+'" fill="none" stroke="#e8a33d" stroke-width="2.2"/>';
  var show={"1M":1,"3M":1,"6M":1,"1Y":1,"2Y":1,"5Y":1}, tid='b'+(++BTN);
  BTIPS[tid]=L.map(function(l){ return '<div class="bt-h">'+vdLab(l.vd)+' <span style="color:#8494ab;font-weight:400">\u00b7 '+l.t+' forward</span></div>'+
    '<div class="bt-row"><span>Outright USD/CAD</span><b>'+fmt(l.F,5)+'</b></div><div class="bt-row"><span>Spot</span><b>'+fmt(spot,5)+'</b></div>'+
    '<div class="bt-row"><span>Forward points</span><b>'+sgn(l.pts,1)+'</b></div><div class="bt-row"><span>Annualised</span><b>'+sgn(l.ann,2,'%')+'</b></div>'+
    '<div class="bt-math">'+fmt(spot,5)+' '+(l.pts<0?'\u2212':'+')+' '+fmt(Math.abs(l.pts),1)+' pts = '+fmt(l.F,5)+'</div>'; });
  L.forEach(function(l,i){
    var x=X(l.days), y=Y(l.F), anc=l.t==="5Y"?"end":"middle";
    if(show[l.t]){
      s+='<text x="'+x.toFixed(1)+'" y="'+(y-9).toFixed(1)+'" fill="#e8eef4" font-size="10.5" font-weight="700" font-family="IBM Plex Mono" text-anchor="'+anc+'" paint-order="stroke" stroke="#0f1825" stroke-width="3">'+fmt(l.F,4)+'</text>';
      s+='<text x="'+x.toFixed(1)+'" y="'+(y+17).toFixed(1)+'" fill="#ff9d97" font-size="9.5" font-weight="600" font-family="IBM Plex Mono" text-anchor="'+anc+'" paint-order="stroke" stroke="#0f1825" stroke-width="3">'+sgn(l.pts,0)+'</text>';
      s+='<text x="'+x.toFixed(1)+'" y="'+(H-PB+15)+'" fill="#8494ab" font-size="10" font-family="IBM Plex Mono" text-anchor="'+anc+'">'+vdLab(l.vd,true)+'</text>';
      s+='<text x="'+x.toFixed(1)+'" y="'+(H-PB+27)+'" fill="#8f9db3" font-size="9" font-family="IBM Plex Mono" text-anchor="'+anc+'">'+l.t+'</text>';
    }
    s+='<g class="btip" data-tid="'+tid+'" data-i="'+i+'"><circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="11" fill="transparent"/><circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="'+(show[l.t]?3.8:2.6)+'" fill="#e8a33d" stroke="#0f1825" stroke-width="1"/></g>';
  });
  s+='<text x="'+PL+'" y="'+(H-4)+'" fill="#8f9db3" font-size="9.5" font-family="IBM Plex Mono">VALUE DATE (\u221adays scale) \u00b7 WHITE = OUTRIGHT \u00b7 RED = FWD POINTS \u00b7 HOVER ANY DOT</text>';
  return '<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="CIP forward curve: outright forward by tenor against spot">'+s+'</svg>';
}
function fxForwardsHTML(spot){
  var L=fxForwardLegs(spot);
  var rows='<table class="fwd-t"><thead><tr><th>Value date</th><th>Tenor</th><th>Outright</th><th>Fwd pts</th><th>Annualised</th></tr></thead><tbody>'+L.map(function(l){
    return '<tr><td>'+vdLab(l.vd)+' <small class="ft-in">'+l.t+'</small></td><td class="ft">'+l.t+'</td><td><b>'+fmt(l.F,5)+'</b></td><td class="neg">'+sgn(l.pts,1)+'</td><td>'+sgn(l.ann,2,'%')+'</td></tr>';
  }).join("")+'</tbody></table>';
  var y1=L.filter(function(l){ return l.t==="1Y"; })[0];
  var read=y1?'<p class="read" style="font-size:13px">USD/CAD trades at a <b>forward discount</b> all the way out: the 1Y outright sits '+fmt(Math.abs(y1.pts),0)+' pts below spot ('+sgn(y1.ann,2,'%')+' annualised) because US rates run above Canadian rates. The curve flattens past 1Y as the yield gap narrows ('+sgn(L[L.length-1].ann,2,'%')+' at 5Y).</p>':'';
  return '<div class="fwd-grid"><div>'+fxForwardSVG(spot,L)+'</div><div class="fwd-rows">'+rows+'</div>'+read+'</div>';
}
function fxLevelCheck(spot){
  var L=DATA.fx.levels, where=[];
  where.push(spot>=L.s20?'above the 20D support '+fmt(L.s20,4):'<b>below</b> the 20D support '+fmt(L.s20,4));
  where.push(spot>=L.pivot?'above the prior-session pivot '+fmt(L.pivot,5):'below the prior-session pivot '+fmt(L.pivot,5));
  where.push(spot<=L.r20?'under the 20D resistance '+fmt(L.r20,4):'<b>above</b> the 20D resistance '+fmt(L.r20,4));
  var near=[["20D support",L.s20],["pivot",L.pivot],["pivot high",L.pivot_h],["pivot low",L.pivot_l],["20D resistance",L.r20]]
    .map(function(x){ return [x[0],x[1],Math.abs(spot-x[1])*10000]; }).sort(function(a,b){ return a[2]-b[2]; })[0];
  return '<b>Price level check:</b> USD/CAD '+fmt(spot,5)+' sits '+where.join(', ')+' \u00b7 nearest level: '+near[0]+' '+fmt(near[1],5)+' ('+fmt(near[2],1)+' pips away).';
}
function fxEvList(){ return (DATA.fx.events||[]).map(function(e){ return {t:evEpoch(e), label:e.ccy+' '+e.event, impact:e.impact, ccy:e.ccy}; }); }
function fxSubnavHTML(){
  var ev=fxEvList(), cb=/Overnight Rate|Federal Funds Rate/;
  var cftc=usdaEvents('corn', Date.now(), 10).filter(function(e){ return e.kind==='cftc'; }).map(function(e){ return {t:e.t,label:'CFTC COT · CAD positioning'}; });
  var fx=DATA.fx, chg=(fx.feed.mid/fx.spot.ref-1)*100, w=fx.energy[0], R={}; fx.rates.forEach(function(r){ R[r.t]=r; });
  var live=fxTilesHTML();
  return subnavHTML('fx', [
    {id:'overview', label:'Overview', ev:nextOf(ev, function(e){ return e.impact==='High'; })},
    {id:'deriv', label:'Derivatives', ev:nextOf(ev.filter(function(e){ return cb.test(e.label); }).concat(cftc))},
    {id:'rates', label:'Rates, Policy & Energy', ev:nextOf(ev, function(e){ return cb.test(e.label)||/Crude|Oil|Treasury|Bond|Auction/i.test(e.label); })},
    {id:'fwd', label:'Forward Rates', ev:nextOf(ev, function(e){ return cb.test(e.label); })}
  ], live);
}
function renderFX(){
  var fx=DATA.fx, T={}, html='<div class="layout"><div class="grid">';
  /* spot — feed value from data.json; live.js streams over it */
  var fd=fx.feed, avMid=fd.mid, avBid=fd.bid, avAsk=fd.ask;
  var refChg=(avMid/fx.spot.ref-1)*100;
  T.spot='<div class="tile wide" id="fx-spot-tile" data-src="fx_spot"><h2>USD/CAD spot &amp; key levels <span class="chip frozen" id="fx-spot-chip">FEED VALUE</span></h2>'+fxTicketHTML(+avMid,avBid,avAsk)+
    '<div class="sl-grid"><div>'+
    '<div id="fx-spark" class="intraday">'+fxIntradaySVG(fxIntradayPoints())+'</div>'+
    '<div class="stat-row">'+(avBid!=null&&avAsk!=null?stat("Bid", fmt(avBid,5)) + stat("Ask", fmt(avAsk,5)) + stat("Spread", fmt((avAsk-avBid)*10000,1)+" pips"):'') +
    stat("Vs prior close "+fmt(fx.spot.ref,4), '<span id="fx-spot-chg" class="'+cls(refChg)+'">'+sgn(refChg,3,'%')+'</span>')+
    stat("Session hi / lo", '<span id="fx-spot-hl">'+(function(){ var p=fxIntradayPoints(); if(p.length<2) return '\u2014'; var y=p.map(function(x){return x[1];}); return fmt(Math.max.apply(null,y),5)+' / '+fmt(Math.min.apply(null,y),5); })()+'</span>')+'</div>'+
    '<div class="stamp" id="fx-spot-stamp">Feed value '+asOf('fx_spot',true)+' · '+esc(String(fd.source||'').replace(/^[^(]*\(/,'').replace(/\)\s*$/,'')||'delayed mid')+'</div>'+
    '</div><div>'+
    '<div class="kv"><span class="kk">Prior-session pivot (H+L+C)/3</span><span class="vv">'+fmt(fx.levels.pivot,5)+'</span></div>'+
    '<div class="kv"><span class="kk">Pivot high / low</span><span class="vv">'+fmt(fx.levels.pivot_h,5)+' / '+fmt(fx.levels.pivot_l,5)+'</span></div>'+
    '<div class="kv"><span class="kk">20D range (closes)</span><span class="vv">'+fmt(fx.levels.s20,4)+' – '+fmt(fx.levels.r20,4)+'</span></div>'+
    '<div class="kv"><span class="kk">50D range (closes)</span><span class="vv">'+fmt(fx.levels.s50,4)+' – '+fmt(fx.levels.r50,4)+'</span></div>'+
    '<div class="kv"><span class="kk">Template · '+esc(fx.trade.dir.replace(/ \(.*\)$/,''))+'</span><span class="vv">'+fmt(fx.trade.entry[0],4)+'–'+fmt(fx.trade.entry[1],4)+' · stop '+fmt(fx.trade.stop,4)+' · tgt '+fmt(fx.trade.targets[0],4)+'</span></div>'+
    '<div class="stamp">Ranges from daily closes through '+fmtDate(fx.closes[fx.closes.length-1][0])+' · template levels are the desk’s Oct 16 build (R:R '+fmt(fx.trade.rr,2)+') · educational only</div>'+
    '</div></div></div>';
  /* macro results */
  T.releases=fxReleasesHTML();
  /* closes chart */
  T.closes='<div class="tile wide" data-src="fx_closes"><h2>USD/CAD — daily closes <span class="h2note">· END-OF-DAY CADENCE · '+fmtShortDate(fx.closes[0][0])+' – '+fmtShortDate(fx.closes[fx.closes.length-1][0])+'</span></h2>'+
    fxClosesSVG(fx)+
    '<div class="stamp">END-OF-DAY CADENCE · '+esc((DATA.meta.sources&&DATA.meta.sources.fx_closes)||'stored daily bars')+' · last bar '+fmtDate(fx.closes[fx.closes.length-1][0])+' ('+fmt(fx.closes[fx.closes.length-1][1],5)+') · every bar is dated on the axis; period high and low are marked on the chart with values and dates · MA20 is not drawn: only 18 daily bars are stored in this window and a 20-day average needs 20 closes — no line is fabricated from a short window; the desk\u2019s full-series 20D close range ('+fmt(fx.levels.s20,4)+' \u2013 '+fmt(fx.levels.r20,4)+') is carried in the Key levels tile below</div></div>';
  /* rates table */
  var rAsOf=fx.rates.map(function(r){ return r.asof; }).filter(Boolean).sort().pop();
  var rrows=fx.rates.map(function(r){
    var stored=rAsOf && r.asof!==rAsOf ? ' <span class="neu" title="No matching Canada benchmark series in the auto-refresh — stored value">· stored</span>' : '';
    return '<tr><td class="lbl" data-l="">'+r.t+(r.t===fx.widest?' · widest':'')+stored+'</td>'+
    '<td data-l="US yield">'+fmt(r.us,2)+'%</td><td data-l="CA yield">'+fmt(r.ca,2)+'%</td>'+
    '<td data-l="Spread"><b>'+fmt(r.sp,1)+'</b></td>'+
    '<td data-l="Δ 1D"><span class="'+cls(r.dod)+'">'+sgn(r.dod,1)+'</span></td>'+
    '<td data-l="Δ WoW"><span class="'+cls(r.wow)+'">'+sgn(r.wow,1)+'</span></td>'+
    '<td data-l="20D %ile">'+(r.pct==null?'n/a':ordn(r.pct))+'</td></tr>';
  }).join("");
  /* US–Canada spreads: each leg live where a delayed source exists, otherwise its official close — and says which */
  var YLU=fx.yields_live||{}, YLC=fx.yields_live_ca||{};
  var LEG={index:['DELAYED','ok','delayed intraday yield'], futures:['EST · FUT','warn','estimated from 2-year note futures × fitted sensitivity'], etf:['EST · ETF','warn','estimated from a federal-bond ETF × fitted sensitivity'], interp:['INTERP','warn','interpolated from the live neighbouring tenors'], close:['CLOSE','cz','official daily close'], stored:['STORED','cz','no official benchmark — desk stored value']};
  function leg(L, close, stored){ if(L&&L.y!=null&&!L.stale) return {v:+L.y, m:L.method||'index', t:L.label||'', tip:(L.fit?'fit R² '+fmt(L.fit.r2,2):'')};
    if(L&&L.y!=null&&L.stale) return {v:+L.y, m:L.method||'index', t:L.label||'', tip:'last quote — latest refresh failed', stale:1};
    return {v:close, m:stored?'stored':'close', t:'', tip:''}; }
  function closeOf(L, c){ return L&&L.close!=null&&(L.basis||'official close')==='official close'?+L.close:c; }
  function tag(g){ var k=LEG[g.m]||LEG.close; return '<span class="om-t '+(g.stale?'warn':k[1])+'" title="'+esc(k[2]+(g.tip?' · '+g.tip:'')+(g.t?' · '+g.t:''))+'">'+(g.stale?'LAST':k[0])+'</span>'; }
  var SP=fx.rates.map(function(r){ var stored=rAsOf&&r.asof!==rAsOf, u=leg(YLU[r.t], r.us, false), c=leg(YLC[r.t], r.ca, stored&&r.t==='20Y');
    var live=(u.v-c.v)*100, isLive=(u.m!=='close'&&u.m!=='stored')||(c.m!=='close'&&c.m!=='stored');
    var cs=(closeOf(YLU[r.t], r.us)-closeOf(YLC[r.t], r.ca))*100;          /* close spread on the SAME legs (US 20Y uses today's official close, not the stored row) */
    return {r:r, u:u, c:c, sp:live, cs:cs, d:live-cs, live:isLive}; });
  var nLive=SP.filter(function(x){ return x.live; }).length, wideL=SP.slice().sort(function(a,b){ return b.sp-a.sp; })[0];
  var srows=SP.map(function(x){ var r=x.r;
    return '<tr><td class="lbl" data-l="">'+r.t+(x===wideL?' <small class="sl-k">widest</small>':'')+'</td>'+
      '<td data-l="US yield"><b>'+fmt(x.u.v,3)+'%</b><div class="sp-tag">'+tag(x.u)+'</div></td>'+
      '<td data-l="CA yield"><b>'+fmt(x.c.v,3)+'%</b><div class="sp-tag">'+tag(x.c)+'</div></td>'+
      '<td data-l="Spread"><b data-tick="sp-'+r.t+'" data-roll>'+fmt(x.sp,1)+'</b></td>'+
      '<td data-l="Δ vs close" class="'+(x.live?cls(x.d):'neu')+'">'+(x.live?sgn(x.d,1):'—')+'</td>'+
      '<td data-l="Close spread">'+fmt(x.cs,1)+'</td>'+
      '<td data-l="Δ 1D (close)" class="'+cls(r.dod)+'">'+(r.dod==null?'—':sgn(r.dod,1))+'</td>'+
      '<td data-l="Δ week (close)" class="'+cls(r.wow)+'">'+(r.wow==null?'—':sgn(r.wow,1))+'</td>'+
      '<td data-l="20D %ile">'+(r.pct==null?'n/a':ordn(r.pct))+'</td></tr>'; }).join('');
  T.yields='<div class="tile wide" data-src="yields_live"><h2>US–Canada yield spreads <span class="h2note">— '+(nLive?'live (delayed) on '+nLive+' of '+SP.length+' tenors, official close otherwise':'official closes, '+asOf('yields'))+' · spreads in bps</span></h2>'+
    barChartSVG({bars:SP.map(function(x){ return [x.r.t, x.sp, x===wideL]; }), line:SP.map(function(x){ return [x.r.t, x.cs]; }), lineLabel:'close', yLabel:'US−CA spread (bps)', dec:0, H:190, aria:'US minus Canada yield spread by tenor, live vs official close'})+
    '<div style="overflow-x:auto"><table class="sp-tbl"><thead><tr><th>Tenor</th><th>US</th><th>Canada</th><th>Spread</th><th>Δ today</th><th>Close</th><th>Δ 1D</th><th>Δ wk</th><th>%ile</th></tr></thead><tbody>'+srows+'</tbody></table></div>'+
    '<div class="read">Spreads run '+fmt(Math.min.apply(null,SP.map(function(x){return x.sp;})),0)+'–'+fmt(Math.max.apply(null,SP.map(function(x){return x.sp;})),0)+' bps across tenors, widest at the '+wideL.r.t+(nLive?'; versus the '+fmtShortDate((DATA.meta.asof.yields||'').slice(0,10))+' official closes the curve is '+(function(){ var w=SP.filter(function(x){return x.live&&x.d>0.5;}).length, nn=SP.filter(function(x){return x.live&&x.d<-0.5;}).length; return w>nn?'<b>wider</b> today ('+w+' tenors wider, '+nn+' narrower)':nn>w?'<b>narrower</b> today ('+nn+' tenors narrower, '+w+' wider)':'little changed today'; })():'')+'.</div>'+
    '<div class="stamp">Bars = spread now, dashed line = official-close spread · DELAYED = delayed intraday yield (US 3M/5Y/10Y/30Y) · EST · FUT = US 2Y from 2-year note futures · EST · ETF = Canada from federal-bond funds (short / mid / long) · each estimate = official close + live proxy move × its sensitivity fitted on a year of daily official yield changes'+(fx.yl_model&&fx.yl_model.fit?' ('+Object.keys(fx.yl_model.fit).map(function(k){ var f=fx.yl_model.fit[k]; return k.replace(/^(US|CA)/,'$1 ')+' R² '+fmt(f.r2,2); }).join(', ')+')':'')+' · INTERP = US 1Y / 20Y between live neighbours · CLOSE = official close (Canada 1Y T-bill, any tenor whose live source failed) · Δ 1D / week / percentile on official closes · Canada 20Y has no official benchmark (stored)</div></div>';
  /* bias + scenarios */
  var sc=fx.scen;
  var drv=fx.bias.drivers.map(function(d){
    return '<div class="kv"><span class="kk">'+esc(d.name)+'</span><span class="vv" style="font-family:inherit;font-weight:500;font-size:12.5px">'+esc(d.detail)+'</span></div>';
  }).join("");
  T.model='<div class="tile wide" data-src="model"><h2>Model view — 1-day bias &amp; OLS forecast <span class="h2note">· '+(fx.fc.asof?'recomputed daily · origin close '+fmtDate(fx.scen.asof.origin_date):'stored model run, origin '+fmtDate(fx.scen.asof.origin_date))+'</span></h2>'+
    '<div class="sl-grid"><div>'+
    '<div class="med">'+esc(fx.bias.label)+' <span class="neu" style="font-size:13px">score '+fx.bias.score+'</span></div>'+
    '<div class="stat-row">'+stat("Bearish", fmt(sc.bearish_usdcad.probability_pct,1)+"%", sc.bearish_usdcad.range[0].toFixed(4)+"–"+sc.bearish_usdcad.range[1].toFixed(4))+
    stat("Neutral", fmt(sc.neutral.probability_pct,1)+"%")+stat("Bullish", fmt(sc.bullish_usdcad.probability_pct,1)+"%", sc.bullish_usdcad.range[0].toFixed(4)+"–"+sc.bullish_usdcad.range[1].toFixed(4))+'</div>'+
    '</div><div>'+
    '<div class="stat-row" style="margin-top:0">'+stat("1D P50", '<span class="'+cls(fx.fc.p50_pct)+'">'+sgn(fx.fc.p50_pct,3,'%')+'</span>', fmt(fx.fc.spot50,4))+
    stat("P10 – P90", fmt(fx.scen.asof.base_spot_close*(1+fx.fc.p10/100),4)+" – "+fmt(fx.scen.asof.base_spot_close*(1+fx.fc.p90/100),4))+
    stat("Backtest MAE", fmt(fx.fc.mae,1)+" bps", "vs "+fmt(fx.fc.zero_mae,1)+" zero-return")+stat("Hit rate", fmt(fx.fc.hit*100,1)+"%")+'</div>'+
    '<p class="read" style="font-size:13px">Only the 1D horizon clears the walk-forward gate; 5D and 20D are shown as neutral cones (they lose to a zero-return forecast in backtest).</p>'+
    '</div></div>'+
    '<div class="stamp">Base close '+fmt(fx.scen.asof.base_spot_close,4)+' ('+esc(fx.scen.asof.base_source||'')+') \u00b7 '+(fx.fc.features?'OLS on '+fx.fc.train_pairs+' day-pairs: next-day return vs '+fx.fc.features.join(', ')+' \u00b7 residual \u03c3 '+fmt(fx.fc.sigma_pct,3)+'%':'stored model run')+
      (fx.fc.mae!=null&&fx.fc.zero_mae!=null?(fx.fc.mae<fx.fc.zero_mae?' \u00b7 beats a zero-return forecast in backtest':' \u00b7 <b>does not beat a zero-return forecast in backtest \u2014 treat as context, not signal</b>'):'')+
      ' \u00b7 bias = sign-weighted drivers (2Y/10Y spread moves, DXY, WTI, CFTC crowding'+(fx.bias.drivers&&fx.bias.drivers.some(function(d){ return /risk reversal/.test(d.name); })?', risk reversal':'; risk reversal left out while the FX-options read is stale')+') \u00b7 educational, not a trade recommendation</div></div>';
  /* policy expectations */
  function decRow(d, who){ if(!d) return ''; var dd=d.date?fmtShortDate(d.date):'';
    var rate=who==='Fed'&&d.lo!=null?fmt(+d.lo,2)+'\u2013'+fmt(+d.rate,2)+'%':fmt(+d.rate,2)+'%';
    return '<div class="kv pol-dec"><span class="kk">'+who+' \u00b7 '+dd+' <span class="om-t ok">DECIDED</span></span><span class="vv"><b class="'+(d.change_bp>0?'dn':d.change_bp<0?'up':'neu')+'">'+esc(d.decision||'')+(d.change_bp?' '+sgn(d.change_bp,0,' bp'):'')+'</b> \u2192 '+rate+(d.tone?' <span class="sl-k">\u00b7 '+esc(d.tone.toLowerCase())+'</span>':'')+'</span></div>'; }
  var today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Toronto'}), recent=function(d){ return d&&d.date&&(Date.parse(today)-Date.parse(d.date))<=14*86400000; };
  var decRows=(recent(fx.policy.fed_decided)?decRow(fx.policy.fed_decided,'Fed'):'')+(recent(fx.policy.boc_decided)?decRow(fx.policy.boc_decided,'BoC'):'');
  var fedRows=fx.policy.fed.filter(function(mt){ return !fx.policy.fed_decided||mt.meeting>fx.policy.fed_decided.date; }).map(function(mt){
    return '<div class="kv"><span class="kk">Fed · '+mt.meeting+'</span><span class="vv">Hold '+fmt(mt.no_change_pct,1)+'% · Hike '+fmt(mt.hike_pct,1)+'% · Ease '+fmt(mt.ease_pct,1)+'%</span></div>';
  }).join("");
  var corRows=fx.policy.corra.map(function(c){
    return '<div class="kv"><span class="kk">CORRA · '+c.month+'</span><span class="vv">Implied '+fmt(c.implied_rate_pct,2)+'%</span></div>';
  }).join("");
  var upol=mget('us_policy'), cpol=mget('ca_policy'), polChart='';
  if(upol&&upol.long&&cpol&&cpol.long){ var cmap={}; cpol.long.forEach(function(x){ cmap[x[0].slice(0,7)]=x[1]; });
    var up24=upol.long.slice(-24); polChart=lineChartSVG({series:[{pts:up24,color:'#38b6c9',label:'Fed'},{pts:up24.map(function(x){ var v=cmap[x[0].slice(0,7)]; return [x[0], v==null?null:v]; }),color:'#e0655f',label:'BoC'}],yLabel:'Policy rate (%)',dec:2,H:190,aria:'Fed and BoC policy rates, last 24 months'}); }
  T.policy='<div class="tile" data-src="policy"><h2>Policy expectations <span class="h2note">— futures-implied</span></h2>'+polChart+decRows+fedRows+
    '<div class="kv"><span class="kk">Fed funds target</span><span class="vv">'+(function(){ var f=/(\d{3})-(\d{3})/.exec(fx.policy.fed_range||''); return f?fmt(f[1]/100,2)+'\u2013'+fmt(f[2]/100,2)+'%':esc(fx.policy.fed_range); })()+'</span></div>'+corRows+
    '<div class="kv"><span class="kk">BoC overnight (current)</span><span class="vv">'+fmt(fx.policy.corra_now,2)+'%'+(fx.policy.boc_decided&&fx.policy.corra_date===fx.policy.boc_decided.date?' <span class="sl-k">\u00b7 from the '+fmtShortDate(fx.policy.corra_date)+' statement</span>':'')+'</span></div>'+
    '<div class="stamp">Fed probabilities '+(fx.policy.fed_range&&/NY Fed/.test(fx.policy.fed_range)?'computed '+asOf('policy',true)+' from CBOT fed funds futures + NY Fed effective rate (FedWatch-style)':'pulled '+asOf('policy',true))+
      ' \u00b7 CORRA futures (3-month, Montreal Exchange) '+(fx.policy.corra_asof?'as of '+esc(fmtDate(String(fx.policy.corra_asof).slice(0,10)))+(fx.policy.corra_asof.length>10?' '+tHM(fx.policy.corra_asof):''):'date unknown')+(fx.policy.corra_asof?'<span class="qt-age" data-age="'+esc(fx.policy.corra_asof)+'" data-age-max="30000"></span>':'')+' \u00b7 delayed quote, refreshed once each weekday (8:23 ET) \u00b7 implied rate = 100 \u2212 price \u00b7 futures-implied, not forecasts</div></div>';
  /* positioning & sentiment */
  T.cftc=fxCftcHTML();
  T.sentiment='<div class="tile" data-src="sentiment" data-src2="fxopt"><h2>Retail sentiment &amp; FX options</h2>'+
    '<div class="kv"><span class="kk">Retail traders ('+asOf('sentiment')+' pull)</span><span class="vv">'+fx.sent.traders.long_pct+'% long / '+fx.sent.traders.short_pct+'% short</span></div>'+
    '<div class="kv"><span class="kk">Retail lots</span><span class="vv">'+fx.sent.lots.long_pct+'% long / '+fx.sent.lots.short_pct+'% short</span></div>'+
    '<div class="kv"><span class="kk">Avg entry · long / short</span><span class="vv">'+fmt(fx.sent.avg_entries.long,4)+' / '+fmt(fx.sent.avg_entries.short,4)+'</span></div>'+
    '<div class="kv"><span class="kk">25\u0394 risk reversal</span><span class="vv">'+sgn(fx.fxopt.rr,2,' pp')+' \u00b7 neutral band</span></div>'+
    '<div class="kv"><span class="kk">1M implied vol · call / put</span><span class="vv">'+fmt(fx.fxopt.civ,2)+'% / '+fmt(fx.fxopt.piv,2)+'%</span></div>'+
    '<div class="kv"><span class="kk">Realized vol (20D)</span><span class="vv">'+fmt(fx.fxopt.rvol,2)+'%</span></div>'+
    '<div class="stamp">Retail sentiment read '+asOf('sentiment',true)+' \u00b7 FX options read '+(fx.fxopt.asof?esc(fmtDate(fx.fxopt.asof)):'date unknown')+' \u00b7 neither has a free live feed, so both are manual reads \u2014 check the age before relying on them</div></div>';
  /* energy */
  var enRows=fx.energy.map(function(e){
    return '<div class="kv"><span class="kk">'+e.name+' <span style="color:var(--faint)">('+esc(String(e.delay||'').replace(/^Yahoo,?\s*/,''))+')</span></span><span class="vv">$'+fmt(e.last,2)+' <span class="'+cls(e.pct)+'">'+sgn(e.pct,2,'%')+'</span></span></div>';
  }).join("");
  T.energy='<div class="tile wide" data-src="energy"><h2>Energy <span class="h2note">— delayed reads · '+asOf('energy',true)+'</span></h2>'+
    divBarsHTML(fx.energy.map(function(e){ return [e.name.replace(/Western Canadian Select/,'WCS').replace(/ Crude| \(.*\)/g,''), e.pct]; }).concat([['DXY', fx.fxcross.dxy_chg]]),2,'%')+enRows+
    '<div class="kv"><span class="kk">WTI – WCS differential</span><span class="vv">$'+fmt(fx.wcs_diff.value,2)+'/bbl</span></div>'+
    '<div class="kv"><span class="kk">DXY ('+asOf('crosses')+')</span><span class="vv">'+fmt(fx.fxcross.dxy,3)+' <span class="'+cls(fx.fxcross.dxy_chg)+'">'+sgn(fx.fxcross.dxy_chg,2,'%')+'</span></span></div>'+
    '<div class="kv"><span class="kk">EUR/USD \u00b7 USD/JPY</span><span class="vv">'+fmt(fx.fxcross.eurusd,4)+' \u00b7 '+fmt(fx.fxcross.usdjpy,2)+'</span></div>'+
    '<div class="stamp">Delayed quotes \u00b7 WCS leg is the last stored read</div></div>';
  /* forwards — CIP-theoretical, recomputed by live.js on every spot tick */
  T.forwards='<div class="tile wide fwd-legacy" data-src="fx_spot"><h2>Forward rates <span class="h2note">\u2014 chart, levels and table reprice with every live spot tick · theoretical (covered interest parity), not traded quotes</span></h2>'+
    '<div id="fx-fwd">'+fxForwardsHTML(fx.feed.mid)+'</div>'+
    '<div class="stamp">USD/CAD = CAD per USD \u00b7 F = S \u00d7 DF<sub>USD</sub> \u00f7 DF<sub>CAD</sub> \u00b7 under 1Y: money-market simple interest, DF = 1/(1 + r\u00b7T) \u00b7 1Y and beyond: semi-annual bond yields, DF = (1 + r/2)<sup>\u22122T</sup> \u00b7 T = actual days spot\u2192value date \u00f7 365 (both inputs are government yields on a 365-day basis) \u00b7 spot date T+1, months end-of-month + modified following (weekends only; bank holidays not adjusted) \u00b7 each currency\u2019s rate interpolated linearly between its curve nodes \u00b7 traded forward points also reflect cross-currency basis, credit and dealer spreads, so executable forwards differ</div></div>';
  html+=fxSubnavHTML()+
    subWrap('fx','overview', fxKpiHTML()+liveFxHTML()+T.spot+T.closes+T.model+askTileHTML('fx'))+
    subWrap('fx','deriv', positioningKpiHTML('fx')+T.cftc+T.sentiment.replace('class="tile"','class="tile wide"'))+
    /* macro sections now live on the Macro tab (renderMacro) */
    subWrap('fx','rates', ylLiveHTML()+T.yields+T.energy.replace('class="tile wide"','class="tile"')+T.policy)+
    subWrap('fx','fwd', '<div class="tile wide fxmx-tile" data-src="fx_spot"><div class="fxmx-head"><h2>Forward Rates Matrix<span class="h2note" style="display:none"> — 1M to 24M</span></h2><div class="fxmx-meta"><span class="fxmx-tg" id="fxmx-view"></span><span class="fxmx-tg" id="fxmx-inv"></span><span><b class="fxmx-g" id="fxmx-pair">USD / CAD forward curve</b> · covered-interest-parity outrights · theoretical</span><span class="fxmx-pill">SPOT REF <b id="fxmx-spot">—</b></span><span class="fxmx-pill">24M FORWARD <b id="fxmx-12">—</b></span></div></div><div id="fx-fwdmx" class="fxmx"></div><div class="stamp">Outright = spot × DF<sub>USD</sub> ÷ DF<sub>CAD</sub> from US Treasury and Government of Canada yields · points in pips (1 pip = 0.0001 CAD) · reprices on every live spot tick · not a dealer quote</div></div>'+T.forwards);
  html+='</div><aside class="rail">'+liveMonitorHTML()+fxAlertsHTML()+'</aside></div>';
  document.getElementById('panel-fx').innerHTML=html;
  if(window.FWD) FWD.mount();   /* rebuild the live forward-curve component inside the fresh tile */
  FXT=T;
}
/* ================= MACRO TAB — US & Canada data, its own top-level menu (moved out of USD/CAD) ================= */
var FXT={};
function macroSubnavHTML(){
  var ev=fxEvList(), cb=/Overnight Rate|Federal Funds Rate/, geo=function(e){ return MGEO==='both'||e.ccy===(MGEO==='us'?'USD':'CAD'); }, hi=function(e){ return e.impact==='High'&&(e.ccy==='USD'||e.ccy==='CAD'); };
  return subnavHTML('macro', [
    {id:'dash', label:'Dashboard · '+(MGEO==='both'?'US + Canada':MGEO==='us'?'US':'Canada'), ev:nextOf(ev, function(e){ return hi(e)&&!cb.test(e.label)&&geo(e); })},
    {id:'cpi', label:'CPI Deep Dive · US + Canada', ev:nextOf(ev, function(e){ return /\bCPI\b/.test(e.label)&&(e.ccy==='USD'||e.ccy==='CAD'); })},
    {id:'cycle', label:'Cycle & Fed Policy', ev:nextOf(ev, function(e){ return e.ccy==='USD'&&(cb.test(e.label)||/CPI|PCE|Payrolls|Employment/i.test(e.label)); })},
    {id:'trade', label:'Trade & Fiscal', ev:nextOf(ev, function(e){ return (e.ccy==='USD'||e.ccy==='CAD')&&/Trade|Balance|Budget|Current Account/i.test(e.label); })},
    {id:'rel', label:'Releases & Consensus', ev:nextOf(ev, function(e){ return hi(e); })}
  ], '');
}
function macroRailHTML(){
  var now=Date.now(), L=fxEvList().filter(function(e){ return e.t>now-6e4&&(e.ccy==='USD'||e.ccy==='CAD')&&e.impact==='High'; }).sort(function(a,b){ return a.t-b.t; }).slice(0,8);
  return '<div class="rail-card"><div class="rail-title"><span>Next high-impact US &amp; Canada releases</span></div>'+(L.length?L.map(function(e){ return '<div class="kv"><span class="kk">'+esc(e.label)+'</span><span class="vv">'+etLabel(e.t,true)+' · <span class="countdown" data-t="'+e.t+'" data-fmt="hms">'+hmsText(e.t-now)+'</span></span></div>'; }).join(''):'<p class="note">No high-impact US or Canada release in the stored calendar.</p>')+'</div>';
}
/* CPI deep dive never renders blank: if the breakdown script or its data has not loaded, say so with a reload */
function cpiCardSafe(){
  var h=''; try{ h=window.cpiInternalsHTML?cpiInternalsHTML():''; }catch(e){ h=''; }
  if(h) return h;
  var why=!window.cpiInternalsHTML?'the CPI breakdown script did not load (an older copy of the page may be cached)':!(DATA.cpi_detail||DATA.cpi_detail_ca)?'the CPI category data has not loaded yet':'the breakdown could not be drawn';
  return '<div class="tile wide" id="cpi-internals"><h2>CPI deep dive</h2><div class="cpi-gap" style="margin:6px 0 10px;padding:10px 12px;border:1px solid rgba(232,185,61,.5);background:rgba(232,185,61,.08);border-radius:8px">Not shown: '+why+'.</div><button class="cpi-dd-btn" onclick="location.reload()">Reload the desk</button></div>';
}
function renderMacro(){
  var P=document.getElementById('panel-macro'); if(!P||!window.DATA||!DATA.fx) return;
  if(!FXT.releases) renderFX();
  var html='<div class="layout"><div class="grid">'+macroSubnavHTML()+
    subWrap('macro','dash', macroDashHTML()+fxMacroHTML())+
    subWrap('macro','cpi', cpiCardSafe())+
    subWrap('macro','cycle', (window.cycleHTML?cycleHTML():'')+(window.fedIntelHTML?fedIntelHTML():''))+
    subWrap('macro','trade', tradeFiscalHTML())+
    subWrap('macro','rel', FXT.releases||'')+
    '</div><aside class="rail">'+macroRailHTML()+'</aside></div>';
  P.innerHTML=html;
}

/* ---------------- wiring ---------------- */
document.querySelectorAll('.tab-btn[data-tab]').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('.tab-btn').forEach(function(b){ b.setAttribute('aria-selected', b===btn ? 'true':'false'); });
    document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.toggle('active', p.id==='panel-'+btn.getAttribute('data-tab')); });
  });
});
document.querySelector('main').addEventListener('click', function(ev){
  var o = ev.target.closest ? ev.target.closest('[data-oiv]') : null;
  if(o){ var k=o.getAttribute('data-k'); OIV[k]=OIV[k]||{cp:'both',mon:'cur'}; OIV[k][o.getAttribute('data-oiv')]=o.getAttribute('data-v');
    try{ localStorage.setItem('desk.oiv',JSON.stringify(OIV)); }catch(e){} document.getElementById('oi-'+k).innerHTML=oiTileHTML(k); return; }
  var b = ev.target.closest ? ev.target.closest('.toggle button') : null;
  if(!b || !b.hasAttribute('data-side')) return;   /* dashboard toggles have their own handler */
  var key=b.getAttribute('data-grain'); grainState[key]=b.getAttribute('data-side');
  document.getElementById('pos-'+key).innerHTML=positioningHTML(key);
  document.getElementById('oi-'+key).innerHTML=oiTileHTML(key);
});


/* ================= LEFT SECTION NAVIGATOR (groups the cards of each sub-tab) ================= */
var SECG={
  grain:{
    overview:[['snap','Snapshot & KPIs',/kpi-strip|dash-head/],['cone','Volatility cone',/vcone-tile/],['fan','Price & σ fan',/σ fan/],['season','Seasonality',/ssn-tile/],['insight','Insight',/\bInsight\b/],['ask','Ask Claude',/ask-tile/]],
    deriv:[['cockpit','Derivatives cockpit',/kpi-strip/],['pos','Positioning KPIs',/poskpi|ckwrap/],['cftc','CFTC managed money',/cftc_grains/],['opt','Options data',/Options positioning|Open-interest change/],['vol','Volatility & skew',/Volatility|IV skew/],['optflow','Options flow & expirations',/of-tile|Options flow &amp; expirations|Options flow & expirations/],['flow','Position flow signal',/fl-tile|Position flow/],['carry','Carry & roll',/tr-tile|Curve & calendar|Futures roll/],['oi','Open interest by strike',/\boi-(corn|wheat|soybeans)\b/]],
    fund:[['cmp','Crop-year comparison',/Crop-year comparison/],['xcmp','Export comparison',/Export comparison/],['wmap','World map',/production map/i],['wdet','Country detail',/ detail /],['wprod','Top producers',/Top producers/],['wexp','Top exporters',/Top exporters/],['brsurvey','CONAB survey',/CONAB crop survey/],['brsd','Brazil supply & demand',/Brazil (soybean )?supply/i],['brvs','CONAB vs USDA',/CONAB vs USDA/],['brexp','Brazil exports',/exports \u2014 actual|exports — actual/],['brl','USD/BRL',/USD\/BRL/],['sd','Supply & demand (WASDE)',/supply & demand/i],['dest','Export destinations',/Export destinations/i],['exp','Export sales',/Export Sales/i],['cal','Agri calendar',/agri calendar/i],['caprod','Production & farm prices',/production by crop year|farm price/i],['ca','Canada / Ontario stats',/Canada|Ontario/]],
    inputs:[['cost','Input cost summary',/input costs/i],['paths','Price paths & events',/price paths/i]]
  },
  macro:{
    dash:[['dash','Macro dashboard',/macro dashboard/i],['allind','All indicators',/All macro indicators/]],
    cycle:[['cycle','Cycle composites',/Cycle composites/],['fed','Fed policy',/Fed policy intelligence/]],
    trade:[['tf','Trade & fiscal',/Trade & fiscal/i]],
    cpi:[['cpi','CPI by category',/CPI internals/]],
    rel:[['rel','Latest releases',/Latest releases|releases/i]]
  },
  fx:{
    overview:[['snap','Snapshot',/kpi-strip/],['cone','Volatility cone',/vcone-tile/],['live','Live USD/CAD',/live-fx/],['spot','Spot & key levels',/spot & key levels/i],['daily','Daily chart',/daily closes/i],['model','Model view',/Model view/],['ask','Ask Claude',/ask-tile/]],
    deriv:[['pos','Positioning KPIs',/poskpi|ckwrap/],['fwd','Forward rates',/Forward rates|Forward curve/],['cftc','CFTC CAD funds',/cftc_fx|CFTC CAD/],['sent','Sentiment & FX options',/Retail sentiment/]],
    macro:[['live','Live USD/CAD',/live-fx/],['dash','Macro dashboard',/macro dashboard/i],['tf','Trade & fiscal',/Trade & fiscal/i],['cycle','Cycle composites',/Cycle composites/],['fed','Fed policy',/Fed policy intelligence/],['allind','All indicators',/All macro indicators/],['rel','Latest releases',/Latest releases/]],
    rates:[['ys','Yield spreads',/yield spreads/i],['en','Energy',/Energy/],['pol','Policy expectations',/Policy expectations/]]
  }
};
var SUBTHEME={overview:'#38b6c9',deriv:'#a78bfa',macro:'#e8b93d',fund:'#e8b93d',rates:'#3fb97f',inputs:'#f08a5d',dash:'#e8b93d',cycle:'#a78bfa',trade:'#38b6c9',rel:'#3fb97f',cpi:'#e8a33d',prices:'#e8b93d'};
var GTITLE={corn:'Corn · ZCZ26',wheat:'Wheat · ZWZ26',soybeans:'Soybeans · ZSF27',fx:'USD/CAD desk',macro:'Macro · US & Canada'};

/* ---------- left-panel collapse, knowledge bank, per-menu guide ---------- */
var NAVSHUT={}, NAVMIN=false, KBON=false;
try{ NAVSHUT=JSON.parse(localStorage.getItem('desk.navshut')||'{}')||{}; NAVMIN=localStorage.getItem('desk.navmin')!=='0'; KBON=localStorage.getItem('desk.kb')==='1'; }catch(e){}
document.body.classList.toggle('nav-min', NAVMIN); document.body.classList.toggle('kb-on', KBON);
function kbSwitchHTML(){ return '<button class="kb-sw" data-kbsw role="switch" aria-checked="'+KBON+'" title="Show a plain-language explanation on every card"><i></i><span>Knowledge bank</span><b>'+(KBON?'ON':'OFF')+'</b></button>'; }
function kbBox(e){
  if(!e) return '';
  return '<div class="kbox"><div class="kb-t">ⓘ '+esc(e.t)+'</div>'+
    (e.what?'<div><b>What it shows</b> '+esc(e.what)+'</div>':'')+(e.read?'<div><b>How to read it</b> '+esc(e.read)+'</div>':'')+
    (e.use?'<div><b>Why it matters</b> '+esc(e.use)+'</div>':'')+(e.src?'<div class="kb-src"><b>Source</b> '+esc(e.src)+'</div>':'')+'</div>';
}
window.kbBox=kbBox;
function kbDecorate(panel, sub, sid, list, cur){
  var K=window.KB; if(!K) return;
  var set=panel==='fx'||panel==='macro'?'fx':'grain', done={};
  [].forEach.call(sub.children, function(t){
    var id=t.getAttribute('data-sec'); if(!id||id==='*'||done[id]) return; done[id]=1;
    var e=K[set][id]; if(!e||t.querySelector(':scope>.kbox')) return;
    var w=document.createElement('div'); w.innerHTML=kbBox(e); var box=w.firstChild;
    var h=t.querySelector(':scope>.tile-head, :scope>h2'); if(h) h.after(box); else t.insertBefore(box, t.firstChild);
  });
  if(cur!=='guide') return;
  var M=(K.menus[panel==='macro'?'macro':set]||{})[sid]||{}, g=document.createElement('div'); g.className='tile wide kb-guide'; g.setAttribute('data-sec','guide');
  g.innerHTML='<h2>Guide — '+esc(M.t||sid)+' <span class="h2note">— what this menu is for and where to find each answer</span></h2>'+
    '<p class="kbg-d">'+esc(M.d||'')+'</p>'+(M.q?'<div class="kbg-q"><b>Questions this menu answers</b><ul>'+M.q.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('')+'</ul></div>':'')+
    '<div class="kbg-list">'+list.map(function(gr){ var e=K[set][gr.id]||{};
      return '<div class="kbg-i"><div><b>'+esc(gr.lab)+'</b><p>'+esc(e.what||'Supporting detail for this menu.')+'</p>'+(e.read?'<small>'+esc(e.read)+'</small>':'')+'</div>'+
        '<button class="kbg-go" data-secp="'+panel+'" data-sec-v="'+gr.id+'">Open →</button></div>'; }).join('')+'</div>'+
    '<div class="stamp">Tip: turn on the Knowledge bank switch (top bar) to see the same explanation inside every card · the left panel can be collapsed with «, and the open menu folds when you click its name again</div>';
  var first=[].filter.call(sub.children, function(t){ return t.getAttribute('data-sec')!=='*'; })[0];
  sub.insertBefore(g, first||null);
}
function navReflow(){ ['corn','wheat','soybeans','fx','macro'].forEach(function(p){ if(typeof buildSecNav==='function') buildSecNav(p); }); if(window.WORLD) WORLD.render(); }
document.addEventListener('click', function(ev){
  var t=ev.target.closest?ev.target:null; if(!t) return;
  if(t.closest('[data-navmin]')){ ev.stopPropagation(); NAVMIN=!NAVMIN; document.body.classList.toggle('nav-min', NAVMIN); try{ localStorage.setItem('desk.navmin', NAVMIN?'1':'0'); }catch(e){} return; }
  if(t.closest('[data-kbsw]')){ ev.stopPropagation(); KBON=!KBON; document.body.classList.toggle('kb-on', KBON); try{ localStorage.setItem('desk.kb', KBON?'1':'0'); }catch(e){}
    document.querySelectorAll('[data-kbsw]').forEach(function(b){ b.setAttribute('aria-checked', KBON); b.querySelector('b').textContent=KBON?'ON':'OFF'; }); return; }
  /* clicking the name of the menu that is already open folds / unfolds its section list */
  var h=t.closest('.tn-h[aria-selected="true"]');
  if(h && !document.body.classList.contains('nav-min')){
    var pn=(h.closest('.tab-panel')||{}).id||''; pn=pn.replace('panel-',''); ev.stopPropagation(); ev.preventDefault();
    NAVSHUT[pn]=!NAVSHUT[pn]; try{ localStorage.setItem('desk.navshut', JSON.stringify(NAVSHUT)); }catch(e){}
    var tn=h.closest('.tn'); tn.classList.toggle('shut', !!NAVSHUT[pn]); h.setAttribute('aria-expanded', !NAVSHUT[pn]); return;
  }
  if(t.closest('.tn-h')){ var pn2=((t.closest('.tab-panel')||{}).id||'').replace('panel-',''); if(NAVSHUT[pn2]){ NAVSHUT[pn2]=false; try{ localStorage.setItem('desk.navshut', JSON.stringify(NAVSHUT)); }catch(e){} } }
}, true);
window.addEventListener('load', function(){ var k=document.createElement('script'); k.src='kb.js?v='+Date.now(); k.onload=navReflow; document.body.appendChild(k); });
var SEC={}; try{ SEC=JSON.parse(localStorage.getItem('desk.sec')||'{}')||{}; }catch(e){}
function secKey(panel){ return panel+'.'+SUB[panel]; }
/* ---------- top section-filter chips (no left tree) ----------
   buildSecNav keeps the SECG grouping, SEC state, --sa theme, data-subt,
   .subctx breadcrumb and kbDecorate exactly as before, but renders the
   section filter as a <div class="sec-chips"> row directly beneath the
   panel's .subnav pill row inside the subnav-tile. No .secnav element is
   created and .layout.has-secnav is never added, so the .subnav pills stay
   visible as the top tabs. Chips carry data-secp + data-sec-v exactly as
   the old tree buttons did, so the existing [data-sec-v] handlers keep
   working (inline handler below + rows-ui.js). */
function buildSecNav(panel){
  var P=document.getElementById('panel-'+panel); if(!P) return;
  var L=P.querySelector('.layout'); if(!L) return;
  var sub=P.querySelector('[data-subpanel].on');
  /* strip any stale left tree from an earlier build; never re-add it */
  var old=L.querySelector('.secnav'); if(old) old.remove();
  L.classList.remove('has-secnav');
  var st=P.querySelector('.subnav-tile'), oc=st&&st.querySelector('.sec-chips');
  if(oc) oc.remove();
  if(!sub) return;
  var rules=(SECG[panel==='fx'||panel==='macro'?panel:'grain']||{})[sub.getAttribute('data-subpanel')]||[], groups={}, order=[];
  var og=sub.querySelector(':scope>.kb-guide'); if(og) og.remove();
  [].forEach.call(sub.children, function(t){
    if(/geo-head|prow-h|prow-top/.test(t.className)){ t.setAttribute('data-sec','*'); return; }
    var h=t.querySelector('h2,h3'), hc=h&&h.cloneNode(true); if(hc) [].forEach.call(hc.querySelectorAll('.age-pill,button'),function(x){x.remove();}); var txt=t.className+' '+(t.getAttribute('data-src')||'')+' '+(t.id||'')+' '+(hc?hc.textContent:'');
    var hit=null; for(var i=0;i<rules.length;i++){ if(rules[i][2].test(txt)){ hit=rules[i]; break; } }
    var id=hit?hit[0]:'more', lab=hit?hit[1]:(h?h.textContent.split('—')[0].trim():'More');
    if(!hit){ id='more-'+order.length; }
    t.setAttribute('data-sec', id); t.setAttribute('data-sec-lab', lab);
    if(!groups[id]){ groups[id]={id:id,lab:lab,n:0,idx:hit?rules.indexOf(hit):99+order.length}; order.push(id); }
    groups[id].n++;
  });
  var list=order.map(function(k){ return groups[k]; }).sort(function(a,b){ return a.idx-b.idx; });
  var cur=SEC[secKey(panel)]||'all'; if(cur!=='all'&&cur!=='guide'&&!groups[cur]) cur='all';
  var GRN=/^(corn|wheat|soybeans|fx)$/.test(panel); if(GRN) cur='all';   /* commodity pages: no section-filter row — every section shows; open a line item to review it */
  var subLab=(P.querySelector('[data-sub="'+sub.getAttribute('data-subpanel')+'"] .sb-name')||{}).textContent||'';
  var sid=sub.getAttribute('data-subpanel'), acc=SUBTHEME[sid]||'#38b6c9', L2=P.querySelector('.layout');
  P.style.setProperty('--sa', acc); if(L2) L2.setAttribute('data-subt', sid);
  var secLab=cur==='all'?'All sections':cur==='guide'?'Guide':(groups[cur]||{}).lab||'';
  var sn=st&&st.querySelector('.subnav');
  if(st&&sn&&!GRN){ var w=document.createElement('div');
    w.innerHTML='<div class="sec-chips" role="group" aria-label="Sections">'+
      '<button class="sec-chip" data-secp="'+panel+'" data-sec-v="all" aria-pressed="'+(cur==='all')+'"><span>All sections</span><small>'+list.length+'</small></button>'+
      list.map(function(g){ return '<button class="sec-chip" data-secp="'+panel+'" data-sec-v="'+g.id+'" aria-pressed="'+(cur===g.id)+'"><span>'+esc(g.lab)+'</span>'+(g.n>1?'<small>'+g.n+'</small>':'')+'</button>'; }).join('')+
      '<button class="sec-chip sec-guide" data-secp="'+panel+'" data-sec-v="guide" aria-pressed="'+(cur==='guide')+'"><span>ⓘ Guide — what’s in here</span></button></div>';
    st.insertBefore(w.firstChild, sn.nextSibling); }
    var cx=st&&st.querySelector('.subctx');
    if(st&&!cx){ cx=document.createElement('div'); cx.className='subctx'; st.insertBefore(cx, st.firstChild); }
    if(cx){ var hb=P.querySelector('.subnav [data-sub="'+sid+'"]'), ev=hb&&hb.querySelector('.sb-ev'), cdd=hb&&hb.querySelector('.sb-cd');
      cx.innerHTML='<span class="sc-pill"><i></i>'+esc(subLab)+'</span><span class="sc-sec">› '+esc(secLab)+'</span>'+
        (ev&&!/No scheduled/.test(ev.textContent)?'<span class="sc-ev">Next: <b>'+esc(ev.textContent)+'</b> '+(cdd?cdd.innerHTML:'')+'</span>':'')+kbSwitchHTML(); }
  [].forEach.call(sub.children, function(t){ var s=t.getAttribute('data-sec'); t.classList.toggle('sec-off', cur!=='all' && s!=='*' && s!==cur); });
  kbDecorate(panel, sub, sid, list, cur);
  if(panel!=='fx'&&typeof drawDestMaps==='function'&&cur==='dest') setTimeout(drawDestMaps,30);
}
document.addEventListener('click', function(ev){
  var b=ev.target.closest&&ev.target.closest('[data-sec-v]'); if(!b) return;
  var panel=b.getAttribute('data-secp'); SEC[secKey(panel)]=b.getAttribute('data-sec-v');
  try{ localStorage.setItem('desk.sec', JSON.stringify(SEC)); }catch(e){}
  buildSecNav(panel);
  var L=document.querySelector('#panel-'+panel+' .layout>.grid'); if(L){ var y=L.getBoundingClientRect().top+window.scrollY-120; if(window.scrollY>y) window.scrollTo({top:y,behavior:'smooth'}); }
});
(function(){
  var _rg=renderGrain, _rf=renderFX, _ss=setSub;
  renderGrain=function(k){ applyWalls(k); _rg(k); buildSecNav(k); };
  renderFX=function(){ _rf(); buildSecNav('fx'); };
  var _rm=renderMacro; renderMacro=function(){ _rm(); buildSecNav('macro'); };
  setSub=function(p,id){ _ss(p,id); buildSecNav(p); };
})();

/* desk roll rule: the front is whatever the data's curve starts with (the server drops a contract the day after its hard exit,
   FND − 1 business day) — names on tabs, titles, tiles and charts follow it */
function syncFronts(){ ['corn','wheat','soybeans'].forEach(function(k){ var g=DATA.grains&&DATA.grains[k], R=g&&g.roll, c=R&&R[0]&&R[0].contract; if(!c||!GMETA[k]) return;
  GTITLE[k]=GMETA[k].name+' · '+c; var b=document.querySelector('#tabbtn-'+k+' .sym'); if(b&&b.textContent!==c) b.textContent=c; }); }
/* ---- OI integrity (chunk 2: OI-03/04/05): every total is re-derived from the strike rows the desk received.
   Duplicate strikes (first kept), non-numeric or negative open interest are rejected and counted; P/C with zero calls is N/A;
   the previous pull is used for 'change' only if it is the same contract and mostly the same strikes. ---- */
function oiSanitize(D){
  ['corn','wheat','soybeans'].forEach(function(k){ var g=D.grains&&D.grains[k]; if(!g) return;
    ['near','far'].forEach(function(leg){ var ds=g[leg]; if(!ds||!ds.rows||ds._chk) return;
      var seen={}, keep=[], dup=0, bad=0;
      ds.rows.forEach(function(r){ var k2=+r[0], c=r[1], p=r[2];
        if(!isFinite(k2)||k2<=0||!(c==null||isFinite(c))||!(p==null||isFinite(p))||(c||0)<0||(p||0)<0){ bad++; return; }
        if(seen[k2]){ dup++; return; } seen[k2]=1; keep.push(r); });
      var C=0, P=0; keep.forEach(function(r){ C+=r[1]||0; P+=r[2]||0; });
      var mis=(ds.calls!=null&&ds.calls!==C)||(ds.puts!=null&&ds.puts!==P);
      ds._chk={strikes:keep.length, dup:dup, bad:bad, mismatch:mis?{c:ds.calls,p:ds.puts}:null};
      ds.rows=keep; ds.calls=C; ds.puts=P; ds.pcr=C>0?Math.round(P/C*100)/100:null;   /* zero calls: no ratio, never Infinity */
      var pv=ds.rows_prev;
      if(pv&&pv.rows){
        var why=null;
        if(pv.contract&&ds.contract&&pv.contract!==ds.contract) why='previous pull was '+pv.contract+', a different contract';
        else if(pv.chain&&ds.chain&&pv.chain!==ds.chain) why='previous pull was the '+pv.chain+' chain';
        else { var ks={}; keep.forEach(function(r){ ks[+r[0]]=1; }); var ov=pv.rows.filter(function(r){ return ks[+r[0]]; }).length; if(ov<0.5*Math.min(pv.rows.length,keep.length)) why='previous pull shares too few strikes to be the same chain'; }
        if(why){ ds._prev_bad=why; delete ds.rows_prev; }
        else if(pv.date){   /* sessions between the two snapshots' trade dates (each pull holds the prior session's close) */
          var bd=function(d){ do { d.setUTCDate(d.getUTCDate()-1); } while(d.getUTCDay()===0||d.getUTCDay()===6); return d; };
          var pt=bd(new Date(pv.date+'T12:00:00Z')), ct=oiTradeDate(), n=0;
          if(ct){ var cs=new Date(Date.UTC(ct.getFullYear(),ct.getMonth(),ct.getDate(),12)); for(var t=new Date(pt); t<cs;){ t.setUTCDate(t.getUTCDate()+1); if(t.getUTCDay()%6) n++; } }
          ds._prev_sessions=n; }
      }
    });
  });
}
function oiChkHTML(ds){ var c=ds&&ds._chk; if(!c) return '';
  return '<span class="oi-chk'+(c.dup||c.bad||c.mismatch?' warn':'')+'">'+(c.dup||c.bad||c.mismatch?'⚠ ':'✓ ')+c.strikes+' strikes checked'+(c.dup?' · '+c.dup+' duplicate strike'+(c.dup>1?'s':'')+' dropped':'')+(c.bad?' · '+c.bad+' invalid row'+(c.bad>1?'s':'')+' rejected':'')+
    (c.mismatch?' · stored totals ('+fmt(c.mismatch.c)+' C / '+fmt(c.mismatch.p)+' P) differed from the strikes — showing the strike totals':' · totals reconcile')+'</span>'; }
function oiPrevText(ds){ if(ds._prev_bad) return 'no change shown: '+ds._prev_bad; var p=ds.rows_prev; if(!p||!p.date) return '';
  var n=ds._prev_sessions; return 'change vs the '+fmtShortDate(p.date)+' pull'+(n!=null?(n<=1?' (previous session)':' — <b>'+n+' sessions back</b>, not one day'):''); }
/* ---- arriving from the feed (chunk 4, NAV-04): a banner on the destination says which alert, when, which contract;
   it stays until closed or 30 minutes pass; the fan chart marks the alert's session ---- */
function evCtxShow(o){ window.FAN_EVENT=o.key?{key:o.key,t:o.t,at:Date.now()}:null; window.EV_CTX=Object.assign({at:Date.now()},o);
  if(o.key&&typeof renderGrain==='function') try{ renderGrain(o.key); }catch(e){}
  setTimeout(evCtxPaint,340); }
function evCtxPaint(){ var C=window.EV_CTX; document.querySelectorAll('.ev-ctx').forEach(function(x){ x.remove(); });
  if(!C||Date.now()-C.at>30*60000) return; var P=document.getElementById('panel-'+C.tab); if(!P||!P.classList.contains('active')) return;
  var b=document.createElement('div'); b.className='ev-ctx'; b.setAttribute('role','status');
  b.innerHTML='<span class="ev-ctx-k">FROM THE FEED</span> <b>'+esc(C.src||'Alert')+'</b> · '+esc(new Date(C.t).toLocaleString('en-US',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}))+' ET · '+esc(C.txt||'')+
    (C.contract?' · contract <b>'+esc(C.contract)+'</b>'+(C.shown&&C.shown!==C.contract?' <span class="ev-ctx-w">(this page shows '+esc(C.shown)+')</span>':''):'')+
    '<button class="ev-ctx-x" aria-label="Close" onclick="window.EV_CTX=null;window.FAN_EVENT=null;this.parentNode.remove()">×</button>';
  var anchor=P.querySelector('.grid')||P; anchor.insertBefore(b, anchor.firstChild); }
document.addEventListener('click', function(ev){ if(ev.target.closest&&ev.target.closest('.tab-btn')&&!ev.target.closest('[data-evgo]')) setTimeout(evCtxPaint,60); });
setInterval(function(){ var C=window.EV_CTX; if(!C) return; var P=document.getElementById('panel-'+C.tab); if(P&&P.classList.contains('active')&&!P.querySelector('.ev-ctx')) evCtxPaint(); }, 1500);   /* survives a re-render */
function renderAll(){ try{ oiSanitize(DATA); }catch(e){} syncFronts(); renderGrain('corn'); renderGrain('wheat'); renderGrain('soybeans'); renderFX(); renderMacro(); drawDestMaps(); if(typeof paintAwaiting==='function') paintAwaiting(); }
renderAll();
/* speed: after the first full paint, a data refresh repaints only the tab on screen (~0.1 s instead of ~0.5 s);
   hidden desks are marked stale and repaint the moment they are opened */
(function(){
  var full=renderAll, DIRTY={}, R={corn:function(){renderGrain('corn');},wheat:function(){renderGrain('wheat');},soybeans:function(){renderGrain('soybeans');},fx:function(){renderFX();},macro:function(){renderFX();renderMacro();}};
  function activeTab(){ var a=document.querySelector('.tab-panel.active'); return a?a.id.replace('panel-',''):''; }
  window.renderAllFull=full;
  window.renderAll=renderAll=function(){
    syncFronts();   /* a data refresh can carry a roll: tab names, titles and charts follow the new front */
    var on=activeTab();
    Object.keys(R).forEach(function(k){ if(k===on){ R[k](); delete DIRTY[k]; } else DIRTY[k]=1; });
    if(on&&on!=='fx'&&on!=='macro'&&typeof drawDestMaps==='function') drawDestMaps();
    if(typeof paintAwaiting==='function') paintAwaiting();
  };
  document.querySelectorAll('.tab-btn[data-tab]').forEach(function(b){ b.addEventListener('click', function(){
    var k=b.getAttribute('data-tab'); if(DIRTY[k]&&R[k]){ R[k](); delete DIRTY[k]; if(k!=='fx'&&k!=='macro'&&typeof drawDestMaps==='function') drawDestMaps(); if(typeof paintAwaiting==='function') paintAwaiting(); if(window.MOTION) MOTION.scan(); }
  }); });
})();
