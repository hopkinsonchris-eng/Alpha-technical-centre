// ============================================================================
//  ALPHA ELA — Phase 1 Scenario Studio  ·  app logic
// ============================================================================
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const fmt = (n,d=0) => n==null||isNaN(n) ? "n/m" : Number(n).toLocaleString("en-US",{maximumFractionDigits:d,minimumFractionDigits:d});
const C = { navy:"#0B1F3A", gold:"#C9A84C", red:"#C0392B", steel:"#6B7A8D", panel:"#F4F6F8", line:"#DCE1E7", ok:"#1f7a4d" };

let STATE = ELAEngine.defaultState();
let RESULT = ELAEngine.solve(STATE);
let CUR_NAME = "Base · $70 · 95% PUD";
let TAB = "dash";
const LSK = "ela_scenarios_v1";

// ---------------------------------------------------------------- persistence
function getScenarios(){ try{ return JSON.parse(localStorage.getItem(LSK)||"{}"); }catch(e){ return {}; } }
function setScenarios(o){ try{ localStorage.setItem(LSK, JSON.stringify(o)); }catch(e){ alert("Storage unavailable — host the app to enable saved scenarios."); } }

function recompute(){ RESULT = ELAEngine.solve(STATE); render(); }

// ---------------------------------------------------------------- sidebar
function buildSidebar(){
  const e = STATE.econ;
  const slider = (id,label,val,min,max,step,unit,scale=1) => `
    <div class="ctl">
      <div class="row"><label>${label}</label><span class="val" id="v_${id}">${unit==="$"?"$":""}${fmt(val*scale, step<1&&scale===1?2:0)}${unit&&unit!=="$"?unit:""}</span></div>
      <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">
    </div>`;
  $("#side").innerHTML = `
    <h3>Development phase</h3>
    ${phaseControl(STATE.phaseCap||"3")}
    <h3>Economics</h3>
    ${slider("brent","Brent oil price",e.brent,30,120,1,"/bbl")}
    ${slider("discount","Discount rate (NPV)",e.discount,0.08,0.20,0.005,"%",100)}
    ${slider("capexMult","CAPEX multiplier",e.capexMult,0.7,1.5,0.05,"×")}
    ${slider("opexMult","OPEX multiplier",e.opexMult,0.8,1.3,0.05,"×")}
    <h3>Execution</h3>
    ${slider("crews","Parallel crews (spreads)",STATE.crews,2,12,1,"")}
    <div class="ctl">
      <div class="row"><label>Phase 1 Pₛ (PUD chance of success)</label><span class="val" id="v_ps">${fmt(STATE.classes[0].ps*100,0)}%</span></div>
      <input type="range" id="ps" min="0.5" max="1" step="0.01" value="${STATE.classes[0].ps}">
    </div>
    <h3>Fiscal terms <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">· new law (fixed)</span></h3>
    <div class="ctl"><div class="row"><label>Royalty</label><span class="val">${fmt(e.royalty*100)}%</span></div></div>
    <div class="ctl"><div class="row"><label>Income tax</label><span class="val">0%</span></div></div>
    <div class="ctl"><div class="row"><label>Govt decline</label><span class="val">${fmt(e.govtDecline*100)}%/yr</span></div></div>
    <h3>Well counts (N) per class</h3>
    <div id="ncounts"></div>
  `;
  // N counts
  $("#ncounts").innerHTML = STATE.classes.map((c,i)=>`
    <div class="ctl">
      <div class="row"><label style="font-size:11.5px">${c.name}</label><span class="val" id="vn_${i}">${fmt(c.N)}</span></div>
      <input type="range" id="n_${i}" min="0" max="2000" step="1" value="${c.N}">
    </div>`).join("");

  // wire economics sliders
  const bind = (id, fn, fmtFn) => { const el=$("#"+id); el.addEventListener("input", ()=>{ fn(parseFloat(el.value)); const v=$("#v_"+id); if(v&&fmtFn) v.textContent=fmtFn(parseFloat(el.value)); recomputeLight(); }); };
  bind("brent", v=>STATE.econ.brent=v, v=>fmt(v)+"/bbl");
  bind("discount", v=>STATE.econ.discount=v, v=>fmt(v*100)+"%");
  bind("capexMult", v=>STATE.econ.capexMult=v, v=>fmt(v,2)+"×");
  bind("opexMult", v=>STATE.econ.opexMult=v, v=>fmt(v,2)+"×");
  bind("crews", v=>STATE.crews=v, v=>fmt(v));
  bind("ps", v=>{ STATE.classes.forEach(c=>c.ps=v); }, v=>fmt(v*100)+"%");
  STATE.classes.forEach((c,i)=> bind("n_"+i, v=>STATE.classes[i].N=v, v=>fmt(v)) );
  // also update the small value labels for n
  STATE.classes.forEach((c,i)=>{ const el=$("#n_"+i); el.addEventListener("input",()=>{ $("#vn_"+i).textContent=fmt(parseFloat(el.value)); }); });
  // phase selector (full recompute — updates KPIs, economics and active state)
  $$("#phaseSeg button").forEach(b=>b.addEventListener("click",()=>{ STATE.phaseCap=b.dataset.ph; recompute(); }));
}
// segmented Phase 1a/1b/2/3 development-cap control (mirrors model block ⑦ + toggles)
const PHASES=[
  {k:"1a",t:"1a",s:"Restart · 83.5k · $123M"},
  {k:"1b",t:"1b",s:"Phase 1 · 120k BOPD"},
  {k:"2", t:"2", s:"Phase 2 plateau"},
  {k:"3", t:"3", s:"Full dev · base case"},
];
function phaseControl(cur){
  const meta=(window.ELAEcon&&ELAEcon.PHASE_META)||{targetBopd:{}};
  const cap=PHASES.find(p=>p.k===cur)||PHASES[3];
  return `<div class="seg" id="phaseSeg">
    ${PHASES.map(p=>`<button data-ph="${p.k}" class="${p.k===cur?'on':''}" title="${p.s}">${p.t}</button>`).join("")}
  </div>
  <div class="seg-cap">${cap.s}</div>`;
}
// recompute but don't rebuild sidebar (keeps slider focus)
let rcTimer=null;
function recomputeLight(){ clearTimeout(rcTimer); rcTimer=setTimeout(()=>{ RESULT=ELAEngine.solve(STATE); renderView(); }, 40); }

// ---------------------------------------------------------------- charts (inline SVG)
function lineChart(series, opts={}){
  const W=opts.w||560, H=opts.h||240, pad={l:46,r:16,t:14,b:30};
  const allX = series.flatMap(s=>s.pts.map(p=>p.x));
  const allY = series.flatMap(s=>s.pts.map(p=>p.y));
  const xmin=Math.min(...allX), xmax=Math.max(...allX);
  const ymax=opts.ymax||Math.max(...allY)*1.1, ymin=0;
  const sx=x=>pad.l+(x-xmin)/(xmax-xmin||1)*(W-pad.l-pad.r);
  const sy=y=>H-pad.b-(y-ymin)/(ymax-ymin||1)*(H-pad.t-pad.b);
  let g="";
  // y gridlines
  for(let k=0;k<=4;k++){ const yv=ymin+(ymax-ymin)*k/4, y=sy(yv);
    g+=`<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="${C.line}" stroke-width="1"/>`;
    g+=`<text x="${pad.l-6}" y="${y+3}" text-anchor="end" font-size="10" fill="${C.steel}">${fmt(yv)}</text>`; }
  // x labels
  (opts.xticks||[]).forEach(t=>{ g+=`<text x="${sx(t.x)}" y="${H-pad.b+15}" text-anchor="middle" font-size="10" fill="${C.steel}">${t.label}</text>`; });
  series.forEach(s=>{
    const d=s.pts.map((p,i)=>(i?"L":"M")+sx(p.x).toFixed(1)+" "+sy(p.y).toFixed(1)).join(" ");
    if(s.fill){ const dd=d+` L ${sx(s.pts[s.pts.length-1].x)} ${sy(0)} L ${sx(s.pts[0].x)} ${sy(0)} Z`;
      g+=`<path d="${dd}" fill="${s.color}" opacity="0.10"/>`; }
    g+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w||2.5}" stroke-linejoin="round"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
}
function barChart(items, opts={}){
  const W=opts.w||560, H=opts.h||260, pad={l:46,r:14,t:14,b:54};
  const ymax=opts.ymax||Math.max(...items.map(i=>i.v))*1.12;
  const bw=(W-pad.l-pad.r)/items.length*0.62, gap=(W-pad.l-pad.r)/items.length;
  const sy=v=>H-pad.b-(v/ymax)*(H-pad.t-pad.b);
  let g="";
  for(let k=0;k<=4;k++){ const yv=ymax*k/4, y=sy(yv);
    g+=`<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="${C.line}"/>`;
    g+=`<text x="${pad.l-6}" y="${y+3}" text-anchor="end" font-size="10" fill="${C.steel}">${fmt(yv)}</text>`; }
  items.forEach((it,i)=>{ const x=pad.l+gap*i+(gap-bw)/2, y=sy(it.v), h=H-pad.b-y;
    g+=`<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(0,h)}" fill="${it.color||C.gold}" rx="2"/>`;
    g+=`<text x="${x+bw/2}" y="${y-5}" text-anchor="middle" font-size="11" font-weight="700" fill="${C.navy}">${fmt(it.v)}</text>`;
    const lbl=(it.label||"").split(" ");
    g+=`<text x="${x+bw/2}" y="${H-pad.b+15}" text-anchor="middle" font-size="9.5" fill="${C.steel}">${lbl.slice(0,2).join(" ")}</text>`;
    if(lbl.length>2) g+=`<text x="${x+bw/2}" y="${H-pad.b+27}" text-anchor="middle" font-size="9.5" fill="${C.steel}">${lbl.slice(2).join(" ")}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
}
function cfChart(proj){
  if(!proj||!proj.length) return '<p class="muted">No projection.</p>';
  const W=560,H=240,pad={l:50,r:14,t:14,b:34};
  const vals=proj.map(p=>p.cf); // already $MM
  const vmax=Math.max(...vals,0), vmin=Math.min(...vals,0), span=(vmax-vmin)||1;
  const bw=(W-pad.l-pad.r)/proj.length*0.66, gap=(W-pad.l-pad.r)/proj.length;
  const sy=v=>pad.t+(vmax-v)/span*(H-pad.t-pad.b);
  const zero=sy(0); let g="";
  g+=`<line x1="${pad.l}" y1="${zero}" x2="${W-pad.r}" y2="${zero}" stroke="${C.steel}" stroke-width="1"/>`;
  [vmax,vmin].forEach(v=>{ g+=`<text x="${pad.l-6}" y="${sy(v)+3}" text-anchor="end" font-size="10" fill="${C.steel}">${fmt(v)}</text>`; });
  proj.forEach((p,i)=>{ const v=p.cf, x=pad.l+gap*i+(gap-bw)/2; const y=v>=0?sy(v):zero, h=Math.abs(sy(v)-zero);
    g+=`<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(0.5,h)}" fill="${v>=0?C.gold:C.red}" rx="1"/>`;
    if(i%4===0) g+=`<text x="${x+bw/2}" y="${H-pad.b+15}" text-anchor="middle" font-size="9" fill="${C.steel}">${p.year}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
}
function kpiRow(){
  const r=RESULT;
  return `<div class="kpis">
    <div class="kpi"><div class="label">Risked Phase-1 Plateau</div><div class="num">${fmt(r.riskedPlateau)}</div><div class="sub">BOPD · ${fmt(STATE.classes.reduce((s,c)=>s+c.N,0))} wells</div></div>
    <div class="kpi alt"><div class="label">Portfolio NPV</div><div class="num" style="color:#fff">$${fmt(r.npv/1000)}</div><div class="sub">$MM · ${fmt(STATE.econ.discount*100)}% disc · 20-yr</div></div>
    <div class="kpi alt"><div class="label">Portfolio IRR</div><div class="num" style="color:#fff">${r.irr==null?"n/m":fmt(r.irr*100,1)+"%"}</div><div class="sub">full-field economics</div></div>
    <div class="kpi"><div class="label">Risk Haircut</div><div class="num">${fmt(r.haircut*100,1)}%</div><div class="sub">unrisked → risked</div></div>
  </div>`;
}
function phaseName(k){ return {"1a":"Phase 1a · Restart","1b":"Phase 1b · Phase-1 development","2":"Phase 2","3":"Phase 3 · Full development (base case)"}[k]||"Phase 3"; }
function phaseBanner(r){
  const k=r.phaseCap||"3";
  const meta=r.phaseMeta||{targetBopd:{},ph1aCapexMM:123};
  if(k==="3") return `<div class="flagbar" style="background:#eaf3ee;border-color:#bfe0cc;border-left-color:#1f7a4d;color:#225c3c"><b>Phase 3 — full development (base case).</b> Full-field 20-year economics reconciled number-for-number to the source model (portfolio NPV, IRR and CAPEX match to the dollar; per-field NPV within 0.1%). Use the <b>Development phase</b> selector to view the Phase 1a / 1b / 2 caps. NPV/IRR move with every input.</div>`;
  if(k==="2") return `<div class="flagbar"><b>Phase 2 plateau.</b> Each field capped at its Phase-2 plateau (block ⑦ of the model). Economics recompute on the capped ramp; CAPEX schedule unchanged — same treatment as the model's phase toggles.</div>`;
  const tgt=meta.targetBopd[k]; const cx=(k==="1a")?meta.ph1aCapexMM:null;
  return `<div class="flagbar"><b>${phaseName(k)} — Phase-1 program target ${fmt(tgt)} BOPD${cx?` for $${fmt(cx,0)}M`:""}.</b> ${k==="1a"
    ? "Restart-only cap (83,500 BOPD across the four active fields). Barrels above this roll into Phase 1b."
    : "Full Phase-1 cap (120,000 BOPD across the four active fields) on the remaining Phase-1 budget. Barrels above 120,000 roll into Phase 2."} Each field capped at its ${k==="1a"?"Ph1a":"Ph1b"} plateau; economics recompute on the capped ramp. Matches the source model's block ⑦ + phase toggles.</div>`;
}
function viewDash(){
  const r=RESULT;
  const ramp=r.months.map(m=>({x:m.month,y:m.bopd}));
  const xt=[0,6,12,18,24,30,36].map(m=>({x:m,label:"M"+m}));
  const phTgt=r.phaseTargetBopd;
  const trajItems=[
    {label:"Current baseline",v:STATE.fields.reduce((s,f)=>s+f.baseline,0),color:C.steel},
    {label:(phTgt?phaseName(r.phaseCap).split(" · ")[0]+" target":"Phase 1 plateau"),v:Math.round(phTgt||r.riskedPlateau),color:C.gold},
    {label:"Peak (incl base)",v:Math.round(r.peak),color:C.navy},
  ];
  return kpiRow()+phaseBanner(r)+`
  <div class="grid2">
    <div class="panel"><h2>Phase-1 production ramp</h2><div class="cap">Cumulative risked BOPD · best-first execution · ${STATE.crews} crews</div>
      ${lineChart([{pts:ramp,color:C.gold,fill:true}],{ymax:r.riskedPlateau*1.15,xticks:xt})}</div>
    <div class="panel"><h2>Portfolio trajectory</h2><div class="cap">'000 BOPD milestones</div>
      ${barChart(trajItems.map(i=>({...i,v:Math.round(i.v/1000)})),{})}</div>
  </div>
  <div class="grid2">
    <div class="panel"><h2>Portfolio cash flow</h2><div class="cap">Net investor cash flow by year ($MM) · 2025–2044</div>
      ${cfChart(r.proj)}</div>
    <div class="panel"><h2>Activity-class contribution</h2><div class="cap">Risked incremental BOPD by class (best-first order)</div>
      ${barChart(r.ranked.filter(x=>x.N>0).map(x=>({label:x.name.split(" ").slice(0,2).join(" "),v:Math.round(x.risked),color:x.fitted?C.gold:C.steel})),{h:240})}</div>
  </div>`;
}
function viewCurves(){
  const r=RESULT;
  // distribution curves: show P10/P50/P90 band per fitted class as bars
  const rows=r.rows.map(x=>`<tr>
    <td>${x.name}</td>
    <td><span class="tag ${x.fitted?'fit':'ass'}">${x.fitted?'fitted':'assumed'}</span></td>
    <td>${fmt(x.p10)}</td><td>${fmt(x.p50)}</td><td>${fmt(x.p90)}</td>
    <td>${fmt(x.mean)}</td><td>${fmt(x.cov,2)}</td><td>${fmt(x.ps*100)}%</td></tr>`).join("");
  // sparkline-ish lognormal pdf for the selected class
  return `<div class="panel"><h2>Lognormal type curves</h2>
    <div class="cap">Per-class well-rate distributions. Fitted classes derive σ/μ from the real P10/P90 band (AICO production data); assumed classes from μ &amp; CoV.</div>
    <table><thead><tr><th>Intervention class</th><th>Source</th><th>P10</th><th>P50</th><th>P90</th><th>Eff. mean</th><th>CoV</th><th>Pₛ</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
  <div class="panel"><h2>Distribution shape</h2><div class="cap">Lognormal PDF, fitted classes (BOPD per well)</div>
    ${pdfChart(r.rows.filter(x=>x.fitted))}</div>`;
}
function pdfChart(rows){
  const W=600,H=260,pad={l:40,r:14,t:14,b:30};
  const xmax=Math.max(...rows.map(r=>r.p90))*1.2, ymaxArr=[];
  const colors=[C.gold,C.navy,C.red,C.steel,"#7a8b5a","#9c6b3f"];
  const pdf=(x,mu,sig)=> x<=0?0: (1/(x*sig*Math.sqrt(2*Math.PI)))*Math.exp(-Math.pow(Math.log(x)-mu,2)/(2*sig*sig));
  const series=rows.map((r,i)=>{ const pts=[]; for(let k=1;k<=80;k++){ const x=xmax*k/80; pts.push({x,y:pdf(x,r.muln,r.sigma)}); } ymaxArr.push(Math.max(...pts.map(p=>p.y))); return {pts,color:colors[i%colors.length],name:r.name}; });
  const ymax=Math.max(...ymaxArr)*1.1;
  const sx=x=>pad.l+x/xmax*(W-pad.l-pad.r), sy=y=>H-pad.b-y/ymax*(H-pad.t-pad.b);
  let g="";
  for(let k=0;k<=4;k++){ const xv=xmax*k/4; g+=`<text x="${sx(xv)}" y="${H-pad.b+15}" text-anchor="middle" font-size="10" fill="${C.steel}">${fmt(xv)}</text>`; }
  series.forEach(s=>{ const d=s.pts.map((p,i)=>(i?"L":"M")+sx(p.x).toFixed(1)+" "+sy(p.y).toFixed(1)).join(" "); g+=`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2"/>`; });
  // legend
  series.forEach((s,i)=>{ const ly=pad.t+i*15; g+=`<rect x="${W-180}" y="${ly}" width="10" height="10" fill="${s.color}"/><text x="${W-165}" y="${ly+9}" font-size="10" fill="${C.navy}">${s.name.split(" ").slice(0,3).join(" ")}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
}
function viewRanking(){
  const r=RESULT;
  const rows=r.ranked.map((x,i)=>`<tr>
    <td style="text-align:center;color:${C.steel}">${i+1}</td>
    <td>${x.name}</td>
    <td>${fmt(x.N)}</td><td>${fmt(x.dur,1)}</td>
    <td>${fmt(x.evDay,1)}</td><td>${fmt(x.risked)}</td><td>${fmt(x.crewDays)}</td></tr>`).join("");
  return `<div class="panel"><h2>Best-first execution sequence</h2>
    <div class="cap">Classes ranked by expected value per crew-day (EV/day) and executed highest-first across ${STATE.crews} crews. This ordering drives the production ramp.</div>
    <table><thead><tr><th style="text-align:center">#</th><th>Class</th><th>Wells</th><th>Days/well</th><th>EV/day</th><th>Risked BOPD</th><th>Crew-days</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
let CMP_CACHE=[]; // [{name, state}]
async function loadCompareCache(){
  CMP_CACHE=[];
  try{ const metas=await ELAStore.list();
    for(const m of metas){ const st=await ELAStore.open(m.id); if(st) CMP_CACHE.push({name:m.name,state:st}); }
  }catch(e){}
}
function viewCompare(){
  const cur={name:CUR_NAME+" (current)", r:RESULT, s:STATE};
  const cols=[cur, ...CMP_CACHE.map(c=>({name:c.name, r:ELAEngine.solve(c.state), s:c.state}))];
  if(cols.length===1) return `<div class="panel"><h2>Compare scenarios</h2><div class="cap">Save scenarios to compare them side by side.</div><p class="muted">No saved scenarios yet. Set up a case, then <b>Save</b> it from the top bar.</p></div>`;
  const metric=(label,fn,d=0,unit="")=>`<tr><td>${label}</td>${cols.map(c=>`<td>${fn(c)==null?"n/m":fmt(fn(c),d)+unit}</td>`).join("")}</tr>`;
  return `<div class="panel"><h2>Scenario comparison</h2><div class="cap">Current case vs saved scenarios</div>
    <table><thead><tr><th>Metric</th>${cols.map(c=>`<th>${c.name}</th>`).join("")}</tr></thead><tbody>
    <tr><td>Development phase</td>${cols.map(c=>`<td>${phaseName(c.s.phaseCap||"3").split(" · ")[0]}</td>`).join("")}</tr>
    ${metric("Brent ($/bbl)",c=>c.s.econ.brent)}
    ${metric("Pₛ (PUD)",c=>c.s.classes[0].ps*100,0,"%")}
    ${metric("Crews",c=>c.s.crews)}
    ${metric("Total wells",c=>c.s.classes.reduce((s,x)=>s+x.N,0))}
    ${metric("Risked plateau (BOPD)",c=>c.r.riskedPlateau)}
    ${metric("Risk haircut",c=>c.r.haircut*100,1,"%")}
    ${metric("Total CAPEX ($MM)",c=>c.r.totalCapex/1000)}
    ${metric("NPV ($MM)",c=>c.r.npv/1000)}
    ${metric("IRR",c=>c.r.irr==null?null:c.r.irr*100,1,"%")}
    ${metric("Peak BOPD",c=>c.r.peak)}
    </tbody></table></div>`;
}
function renderView(){
  $("#view").innerHTML = TAB==="dash"?viewDash():TAB==="curves"?viewCurves():TAB==="ranking"?viewRanking():viewCompare();
}
function render(){ buildSidebar(); renderView(); $("#curScen").textContent=CUR_NAME; }

// ---------------------------------------------------------------- scenarios
function openModal(id){ $("#"+id).classList.add("show"); }
function closeModal(id){ $("#"+id).classList.remove("show"); }
async function refreshScenList(){
  let metas=[];
  try{ metas=await ELAStore.list(); }catch(e){ metas=[]; }
  $("#scenList").innerHTML = metas.length? metas.map(m=>`
    <div class="scen-item" data-id="${m.id}">
      <span class="nm">${m.name}${m.shared?' <span class="tag fit" style="font-size:9px">shared</span>':''}</span>
      <span class="meta">${m.ownerEmail||(m.local?'this browser':'')}</span>
      <span class="x" data-del="${m.id}">✕</span>
    </div>`).join("") : `<p class="muted">No saved scenarios yet.</p>`;
  $$("#scenList .scen-item").forEach(el=>el.addEventListener("click",async ev=>{
    if(ev.target.dataset.del!==undefined) return;
    const id=el.dataset.id; const st=await ELAStore.open(id);
    if(st){ STATE=structuredClone(st); CUR_NAME=el.querySelector(".nm").textContent.replace(/\s*shared\s*$/,'').trim(); recompute(); closeModal("scenModal"); }
  }));
  $$("#scenList .x").forEach(el=>el.addEventListener("click",async ev=>{
    ev.stopPropagation(); await ELAStore.remove(el.dataset.del); refreshScenList();
  }));
}

// ---------------------------------------------------------------- import
function handleImport(file){
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:"binary"});
      // Heuristic: look for a sheet with class names + N, or a Real Data & Fit style sheet.
      let applied=0;
      wb.SheetNames.forEach(sn=>{
        const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1});
        rows.forEach(row=>{
          if(!row||!row.length) return;
          const name=String(row[0]||"").trim();
          const cls=STATE.classes.find(c=>c.name.toLowerCase()===name.toLowerCase());
          if(cls){
            // try to read N from any numeric cell labelled-ish; take first integer >0 in row
            const nums=row.slice(1).filter(v=>typeof v==="number");
            if(nums.length){ cls.N=Math.round(nums[0]); applied++; }
          }
        });
      });
      if(applied){ recompute(); alert(`Imported data for ${applied} activity class${applied>1?"es":""}. Review well counts in the sidebar.`); }
      else alert("No matching activity-class rows found. Expected a column of class names with well counts. You can still set values via the sidebar.");
    }catch(err){ alert("Could not read that file: "+err.message); }
  };
  reader.readAsBinaryString(file);
}

// ---------------------------------------------------------------- Excel export
function exportExcel(){
  const r=RESULT, wb=XLSX.utils.book_new();
  // Summary sheet
  const sum=[
    ["ALPHA ENERGY LATIN AMERICA — PHASE 1 SCENARIO EXPORT"],
    ["Scenario", CUR_NAME],
    ["Generated", new Date().toISOString().slice(0,10)],
    [],
    ["HEADLINE METRICS"],
    ["Risked Phase-1 plateau (BOPD)", Math.round(r.riskedPlateau)],
    ["Unrisked uplift (BOPD)", Math.round(r.unrisked)],
    ["Risk haircut (%)", +(r.haircut*100).toFixed(1)],
    ["Total wells", STATE.classes.reduce((s,c)=>s+c.N,0)],
    ["Total CAPEX ($MM)", +(r.totalCapex/1000).toFixed(1)],
    ["Portfolio NPV ($MM)", Math.round(r.npv/1000)],
    ["Portfolio IRR (%)", r.irr==null?"n/m":+(r.irr*100).toFixed(1)],
    ["Peak production (BOPD)", Math.round(r.peak)],
    [],
    ["ECONOMIC ASSUMPTIONS"],
    ["Development phase", phaseName(STATE.phaseCap||"3")],
    ["Phase-1 program target (BOPD)", r.phaseTargetBopd || "n/a (full dev)"],
    ["Brent ($/bbl)", STATE.econ.brent],
    ["Discount rate (%)", +(STATE.econ.discount*100).toFixed(1)],
    ["CAPEX multiplier", STATE.econ.capexMult],
    ["OPEX multiplier", STATE.econ.opexMult],
    ["Phase 1 Pₛ (%)", +(STATE.classes[0].ps*100).toFixed(0)],
    ["Parallel crews", STATE.crews],
    ["Royalty (%)", STATE.econ.royalty*100],
    ["Income tax (%)", STATE.econ.tax*100],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), "Summary");
  // Activity classes
  const cls=[["Intervention class","Source","Wells (N)","Eff. mean (BOPD)","CoV","P10","P50","P90","Pₛ","Cost ($k/well)","Days/well","Risked BOPD","CAPEX ($k)"]];
  r.rows.forEach(x=>cls.push([x.name, x.fitted?"FITTED":"assumed", x.N, +x.mean.toFixed(1), +x.cov.toFixed(2), +x.p10.toFixed(0), +x.p50.toFixed(0), +x.p90.toFixed(0), +(x.ps*100).toFixed(0), x.cost, x.dur, Math.round(x.risked), Math.round(x.capex)]));
  cls.push(["TOTAL","","","","","","","","","","",Math.round(r.riskedPlateau),Math.round(r.totalCapex)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cls), "Activity Classes");
  // Best-first ranking
  const rk=[["Rank","Class","Wells","Days/well","EV/day","Risked BOPD","Crew-days"]];
  r.ranked.forEach((x,i)=>rk.push([i+1,x.name,x.N,x.dur,+x.evDay.toFixed(1),Math.round(x.risked),Math.round(x.crewDays)]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rk), "Best-First Ranking");
  // Production ramp
  const rp=[["Month","Cumulative risked BOPD"]];
  r.months.forEach(m=>rp.push([m.month, Math.round(m.bopd)]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rp), "Production Ramp");
  // Annual projection (20-year, full waterfall)
  const eo = r.econOut;
  if (eo) {
    const pj=[["Year","Total prod (BOPD)","Portfolio net CF ($MM)","Cumulative CF ($MM)"]];
    let cum=0;
    eo.years.forEach((y,i)=>{ cum+=eo.cfTot[i]; pj.push([y, Math.round(eo.prodTot[i]), +(eo.cfTot[i]).toFixed(1), +cum.toFixed(1)]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pj), "Annual Projection");
    // per-field economics summary
    const fe=[["Field","NPV ($MM)","IRR (%)","20-yr net rev ($MM)","Total CAPEX ($MM)","Payback (mo)"]];
    Object.keys(eo.byField).forEach(fn=>{ const b=eo.byField[fn];
      fe.push([fn, Math.round(b.npv), b.irr==null?"n/m":+(b.irr*100).toFixed(0), Math.round(b.cumRev), Math.round(b.totalCapex), b.payback==null?"n/m":b.payback]); });
    fe.push(["PORTFOLIO TOTAL", Math.round(eo.npv), eo.irr==null?"n/m":+(eo.irr*100).toFixed(0), "", Math.round(eo.totalCapex), eo.payback==null?"n/m":eo.payback]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fe), "Field Economics");
  }

  XLSX.writeFile(wb, "Alpha_ELA_"+CUR_NAME.replace(/[^a-z0-9]+/gi,"_")+".xlsx");
}

// ---------------------------------------------------------------- report (print)
function openReport(){
  const r=RESULT;
  const win=window.open("","_blank");
  const classRows=r.rows.map(x=>`<tr><td>${x.name}</td><td>${x.fitted?'Fitted':'Assumed'}</td><td>${fmt(x.N)}</td><td>${fmt(x.mean)}</td><td>${fmt(x.ps*100)}%</td><td>${fmt(x.risked)}</td></tr>`).join("");
  const rankRows=r.ranked.filter(x=>x.N>0).map((x,i)=>`<tr><td>${i+1}</td><td>${x.name}</td><td>${fmt(x.evDay,1)}</td><td>${fmt(x.risked)}</td></tr>`).join("");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Alpha ELA — ${CUR_NAME}</title>
  <style>
    @page{margin:18mm}
    body{font-family:Georgia,serif;color:#1A2332;max-width:780px;margin:0 auto;padding:20px}
    .hd{border-bottom:3px solid #C9A84C;padding-bottom:12px;margin-bottom:18px}
    .hd .k{font-family:Arial;text-transform:uppercase;letter-spacing:.12em;font-size:11px;color:#C9A84C;font-weight:700}
    h1{font-size:26px;color:#0B1F3A;margin:4px 0}
    .sub{color:#6B7A8D;font-size:13px}
    .kpis{display:flex;gap:14px;margin:18px 0}
    .kpi{flex:1;background:#0B1F3A;color:#fff;padding:12px;border-radius:7px}
    .kpi .l{font-family:Arial;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#9fb0c4}
    .kpi .n{font-size:22px;color:#C9A84C;font-weight:bold;margin-top:4px}
    h2{font-size:15px;color:#0B1F3A;border-bottom:1px solid #DCE1E7;padding-bottom:5px;margin-top:24px}
    table{width:100%;border-collapse:collapse;font-family:Arial;font-size:11px;margin-top:8px}
    th{background:#0B1F3A;color:#fff;padding:6px;text-align:right;font-size:10px} th:first-child{text-align:left}
    td{padding:5px 6px;text-align:right;border-bottom:1px solid #DCE1E7} td:first-child{text-align:left;font-weight:bold;color:#0B1F3A}
    .note{font-size:11px;color:#6B7A8D;font-style:italic;margin-top:10px}
    .foot{margin-top:30px;border-top:1px solid #DCE1E7;padding-top:10px;font-family:Arial;font-size:9px;color:#6B7A8D}
    @media print{.noprint{display:none}}
  </style></head><body>
  <div class="hd"><div class="k">Alpha Energy Latin America · Phase 1 Scenario Report</div>
  <h1>${CUR_NAME}</h1><div class="sub">Generated ${new Date().toLocaleDateString()} · Private &amp; Confidential</div></div>
  <div class="kpis">
    <div class="kpi"><div class="l">Risked Plateau</div><div class="n">${fmt(r.riskedPlateau)}</div><div style="font-size:9px;color:#8fa2b8">BOPD</div></div>
    <div class="kpi"><div class="l">NPV ($MM)</div><div class="n">$${fmt(r.npv/1000)}</div><div style="font-size:9px;color:#8fa2b8">full-field</div></div>
    <div class="kpi"><div class="l">IRR</div><div class="n">${r.irr==null?"n/m":fmt(r.irr*100,1)+"%"}</div><div style="font-size:9px;color:#8fa2b8">full-field</div></div>
    <div class="kpi"><div class="l">Haircut</div><div class="n">${fmt(r.haircut*100,1)}%</div><div style="font-size:9px;color:#8fa2b8">risk</div></div>
  </div>
  <h2>Scenario assumptions</h2>
  <table><tr><td>Development phase</td><td>${phaseName(STATE.phaseCap||"3")}${r.phaseTargetBopd?` · target ${fmt(r.phaseTargetBopd)} BOPD`:""}</td><td>Brent oil price</td><td>$${STATE.econ.brent}/bbl</td></tr>
  <tr><td>Phase 1 Pₛ (PUD)</td><td>${fmt(STATE.classes[0].ps*100)}%</td><td>Discount rate</td><td>${fmt(STATE.econ.discount*100)}%</td></tr>
  <tr><td>Parallel crews</td><td>${STATE.crews}</td><td>Total wells</td><td>${fmt(STATE.classes.reduce((s,c)=>s+c.N,0))}</td></tr>
  <tr><td>CAPEX / OPEX mult.</td><td>${fmt(STATE.econ.capexMult,2)}× / ${fmt(STATE.econ.opexMult,2)}×</td><td>Total CAPEX ($MM)</td><td>${fmt(r.totalCapex/1000)}</td></tr></table>
  <h2>Activity classes</h2>
  <table><thead><tr><th>Class</th><th>Source</th><th>Wells</th><th>Eff. mean</th><th>Pₛ</th><th>Risked BOPD</th></tr></thead><tbody>${classRows}</tbody></table>
  <h2>Best-first execution priority</h2>
  <table><thead><tr><th>#</th><th>Class</th><th>EV/day</th><th>Risked BOPD</th></tr></thead><tbody>${rankRows}</tbody></table>
  <div class="note">Production, best-first ranking, risking and the full 20-year per-field economics are reconciled number-for-number to the source model.</div>
  <div class="foot">ALPHA ENERGY LATIN AMERICA · SUMMA CONSORTIUM · PRIVATE &amp; CONFIDENTIAL</div>
  <button class="noprint" onclick="window.print()" style="margin-top:20px;background:#C9A84C;border:0;padding:10px 18px;border-radius:5px;font-weight:bold;cursor:pointer">Print / Save as PDF</button>
  </body></html>`);
  win.document.close();
}

// ---------------------------------------------------------------- wiring
function init(){
  render();
  $$(".tabbar button").forEach(b=>b.addEventListener("click",async ()=>{ $$(".tabbar button").forEach(x=>x.classList.remove("active")); b.classList.add("active"); TAB=b.dataset.tab; if(TAB==="compare"){ await loadCompareCache(); } renderView(); }));
  $("#btnScenarios").addEventListener("click",()=>{ refreshScenList(); openModal("scenModal"); });
  $("#btnSave").addEventListener("click",()=>{ $("#saveName").value=CUR_NAME==="Base · $70 · 95% PUD"?"":CUR_NAME; openModal("saveModal"); });
  $("#saveConfirm").addEventListener("click",async ()=>{ const n=$("#saveName").value.trim()||("Scenario "+new Date().toLocaleTimeString()); const shared = ELAStore.mode()==="server" && (ELAStore.user()?.role!=="partner"); await ELAStore.saveScenario(n,structuredClone(STATE),shared); CUR_NAME=n; $("#curScen").textContent=n; closeModal("saveModal"); });
  $("#btnExcel").addEventListener("click",exportExcel);
  $("#btnReport").addEventListener("click",openReport);
  $("#btnImport").addEventListener("click",()=>$("#fileInput").click());
  $("#fileInput").addEventListener("change",e=>{ if(e.target.files[0]) handleImport(e.target.files[0]); e.target.value=""; });
  $$(".modal-bg").forEach(m=>m.addEventListener("click",e=>{ if(e.target===m) m.classList.remove("show"); }));
  // login
  $("#loginConfirm").addEventListener("click",async ()=>{
    try{ await ELAStore.login($("#loginEmail").value.trim(),$("#loginPw").value); closeModal("loginModal"); $("#loginErr").textContent=""; }
    catch(e){ $("#loginErr").textContent="Sign-in failed. Check your credentials."; }
  });
}
async function boot(){
  await ELAStore.detect();
  if(ELAStore.needsLogin()) openModal("loginModal");
  init();
}
window.closeModal=closeModal;
boot();
