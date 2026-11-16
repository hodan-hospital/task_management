#!/usr/bin/env python3
"""Build the ERPNext version of the Quality Control Tracker page.

Input : the original Index.html (v60) from the Google Sheets migration package.
Output: index.html next to this script, served by task_management.quality_control.api.tracker_html.

Every change is an exact, checked replacement, so re-running this on the same source always gives
the same page, and a changed source fails loudly instead of producing a half-edited page.

	python3 build_tracker.py /home/hodan/qc-source/Index.html

What changes (the look and feel stays the same):
  * sign-in: the ERPNext session replaces the PIN gate; QC Manager = Admin (verify & close)
  * data: a connector to ERPNext replaces the Google Sheets connector (same db interface)
  * tabs: Dashboard, Non-Clinical Complaints, Clinical Complaints, Round Report, Issues & CAPA,
    Management Meeting, Round Audits, Department Rankings, Trends. Settings removed (now QC Settings
    and user roles in ERPNext)
  * wording: "finding" -> "non-clinical complaint", "medical complaint" -> "clinical complaint"
  * departments, deadlines and the meeting committee come from ERPNext, not from the page code
  * Round audits: checklists come from QC Settings; QC Managers can edit a department's checklist
    on the Round Audits tab (Edit checklist)
  * Clinical complaints: PID search in ERPNext Patients (PID, name or mobile) fills name, age, sex
  * PDF library served from this server instead of the internet
  * the "Designed and developed by" credit removed (page footer and PDF footers)
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def sub_once(s, old, new, count=1):
	n = s.count(old)
	if n != count:
		raise SystemExit("Expected %d x %r, found %d" % (count, old[:90], n))
	return s.replace(old, new)


def sub_between(s, start, end, new, keep_end=False):
	a = s.find(start)
	if a < 0 or s.find(start, a + 1) >= 0:
		raise SystemExit("Start marker not found once: %r" % start[:90])
	b = s.find(end, a)
	if b < 0:
		raise SystemExit("End marker not found: %r" % end[:90])
	return s[:a] + new + (s[b:] if keep_end else s[b + len(end):])


CONNECTOR = r"""<script>
/* Quality Control Tracker – ERPNext connection (task_management app).
   Gives the tracker the same db / user / downloads interface it always used, backed by ERPNext.
   The person using it is the signed-in ERPNext user; roles QC User and QC Manager decide what they can do. */
(function(){
  var P = null; try{ if(window.parent && window.parent !== window && window.parent.frappe) P = window.parent; }catch(e){ P = null; }
  var API = "/api/method/task_management.quality_control.api.qc";
  var clone = function(x){ return x == null ? x : JSON.parse(JSON.stringify(x)); };
  var rid = function(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); };
  var mem = new Map(), listeners = new Set(), lastT = 0, cfgHash = "", failed = false, me = null;
  try{ window.__QC_URL = (P ? P.location.origin : location.origin) + "/app/qc-tracker"; }catch(e){}
  function csrf(){ try{ return (P && P.frappe && P.frappe.csrf_token) || ""; }catch(e){ return ""; } }
  var authAt = 0;
  function authLost(){ var n = Date.now(); if(n - authAt < 60000) return; authAt = n; try{ (P || window).location.reload(); }catch(e){} }
  function call(op, p){
    var body = JSON.stringify(Object.assign({op:op}, p || {}));
    return fetch(API, {method:"POST", credentials:"same-origin", body:body,
        headers:{"Content-Type":"application/json", "Accept":"application/json", "X-Frappe-CSRF-Token":csrf(), "X-Requested-With":"XMLHttpRequest"}})
      .then(function(x){ return x.text().then(function(s){ var j = null; try{ j = JSON.parse(s); }catch(e){}
          var r = j && j.message;
          if(r && r.ok) return r;
          if(r && r.error){ if(r.error === "auth") authLost(); throw {code:r.error, message:r.message}; }
          if(x.status === 401 || x.status === 403){ authLost(); throw {code:"auth", message:"Your ERPNext session has ended. Please sign in again."}; }
          throw {code:"server", message:"ERPNext sent an unexpected answer (" + x.status + ")."}; }); },
        function(e){ throw {code:"network", message: navigator.onLine === false ? "No internet connection" : String(e && e.message || e)}; });
  }
  function apply(docs){ (docs || []).forEach(function(d){ var k = d.col + "/" + d.id; if(d.del) mem.delete(k); else mem.set(k, {col:d.col, id:String(d.id), data:d.data, t:d.t}); if(d.t > lastT) lastT = d.t; }); }
  var ready = (async function(){
    try{ var r = await call("init", {}); me = r.me; cfgHash = r.cfg || ""; mem = new Map(); lastT = 0; apply(r.docs); lastT = Math.max(lastT, r.t || 0); }
    catch(e){ failed = true; if(window.__qcShowErr) window.__qcShowErr("Could not load the tracker from ERPNext: " + ((e && (e.message || e.code)) || e)); }
  })();
  var slow = setTimeout(function(){ if(window.__qcShowErr) window.__qcShowErr("ERPNext has not answered after 25 seconds. Check the connection and reload the page."); }, 25000);
  ready.then(function(){ clearTimeout(slow); });

  /* ---- snapshots ---- */
  function snapDoc(rec, id){ var ok = !!rec; return { id:id, exists:ok, data:function(){ return ok ? clone(rec.data) : undefined; }, metadata:{fromCache:false, hasPendingWrites:false} }; }
  function colSnap(col){ var docs = []; mem.forEach(function(r){ if(r.col === col) docs.push(snapDoc(r, r.id)); });
    return { docs:docs, size:docs.length, empty:!docs.length, docChanges:function(){ return []; }, metadata:{fromCache:false, hasPendingWrites:false} }; }
  function fire(l){ try{ l.fn(l.type === "doc" ? snapDoc(mem.get(l.col + "/" + l.id), l.id) : colSnap(l.col)); }catch(e){ setTimeout(function(){ throw e; }); } }
  function notify(){ listeners.forEach(fire); }

  /* ---- writes: shown at once, undone if ERPNext refuses ---- */
  async function write(col, id, data, del){
    await ready;
    if(failed || !me) throw {code:"auth", message:"Not connected to ERPNext. Reload the page."};
    var k = col + "/" + id, prev = mem.get(k), keep = col === "photos" && data ? {issueId:data.issueId, kind:data.kind, at:data.at, by:data.by} : data;
    if(del) mem.delete(k); else mem.set(k, {col:col, id:id, data:clone(keep), t:prev ? prev.t : 0});
    notify();
    try{ var r = await call("put", {col:col, id:id, data:del ? null : data, del:!!del}); setTimeout(sync, 1500); return r; }
    catch(e){ if(prev) mem.set(k, prev); else mem.delete(k); notify(); throw e; }
  }
  var busy = false;
  async function sync(){ if(failed || !me || busy) return; busy = true;
    try{ var r = await call("pull", {since:lastT, cfg:cfgHash}); if(r.cfg) cfgHash = r.cfg; if(r.docs && r.docs.length){ apply(r.docs); notify(); } lastT = Math.max(lastT, r.t || 0); }catch(e){}
    busy = false; }
  setInterval(function(){ if(!document.hidden) sync(); }, 12000);
  document.addEventListener("visibilitychange", function(){ if(!document.hidden) sync(); });

  function docRef(col, id){ var k = col + "/" + id; return {
    id:id,
    get: async function(){ await ready;
      if(col === "photos" && !failed){ try{ var r = await call("photo", {id:id}); return { id:id, exists:!!r.exists, data:function(){ return r.exists ? clone(r.data) : undefined; } }; }catch(e){ return snapDoc(null, id); } }
      return snapDoc(mem.get(k), id); },
    set: function(d){ return write(col, id, d); },
    update: async function(d){ await ready; var r = mem.get(k); if(!r) throw {code:"invalid_argument", message:"Document does not exist"};
      var nd = clone(r.data) || {}; var p = clone(d); Object.keys(p).forEach(function(x){ nd[x] = p[x]; }); return write(col, id, nd); },
    delete: function(){ return write(col, id, null, true); },
    onSnapshot: function(fn){ var l = {type:"doc", col:col, id:id, fn:fn}; listeners.add(l); ready.then(function(){ if(listeners.has(l)) fire(l); }); return function(){ listeners.delete(l); }; }
  }; }
  function colRef(col){ return {
    doc: function(id){ return docRef(col, id || rid()); },
    add: async function(d){ var r = docRef(col, rid()); await r.set(d); return r; },
    get: async function(){ await ready; return colSnap(col); },
    onSnapshot: function(fn){ var l = {type:"col", col:col, fn:fn}; listeners.add(l); ready.then(function(){ if(listeners.has(l)) fire(l); }); return function(){ listeners.delete(l); }; },
    where: function(){ return this; }, orderBy: function(){ return this; }, limit: function(){ return this; }
  }; }
  var db = { collection:function(p){ return colRef(p); }, doc:function(path){ var p = path.split("/"); return docRef(p.slice(0,-1).join("/"), p[p.length-1]); } };
  var user = { isOwner: async function(){ return false; }, canEdit: async function(){ return !!(me && me.role === "admin"); }, can: async function(){ return !!me; },
    id: async function(){ return me ? "m:" + me.id : null; }, me: async function(){ return me ? {id:"m:" + me.id, name:me.name, avatarUrl:"", color:"#5A6D78", email:me.id} : null; },
    profiles: async function(){ return {}; }, search: async function(){ return []; } };
  var downloads = { save: async function(req){
    var blob = req.data instanceof Blob ? req.data : new Blob([req.data], {type: /\.csv$/i.test(req.filename) ? "text/csv" : /\.json$/i.test(req.filename) ? "application/json" : "application/octet-stream"});
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = req.filename; a.rel = "noopener"; a.style.display = "none"; document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 4000);
    return {status:"saved"};
  } };
  window.qcBackend = { use: async function(name){ await ready; if(failed) return name === "downloads" ? downloads : null;
    return name === "db" ? db : name === "user" ? user : name === "downloads" ? downloads : null; } };
  window.__qcFrappe = { ready: ready, me: function(){ return me; }, patients: function(q){ return call("patients", {q:q}).then(function(r){ return r.list || []; }); },
    checklist: function(dept, items){ return call("checklist", {dept:dept, items:items}).then(function(r){ setTimeout(sync, 300); return r; }); } };
})();
</script>
"""

SIGNIN = r"""/* ===== sign-in: the signed-in ERPNext user. QC Manager = Admin (verify & close, delete any record). ===== */
function applyMember(m){ me=m||null; uid=me?"m:"+me.id:null; canAdmin=!!(me&&me.role==="admin"); canVerify=canAdmin; canWrite=!!me;
  const ob=$("#outBtn"); if(ob) ob.hidden=true;
  const c=$("#meChip"); if(c){ c.hidden=!me; if(me){ c.replaceChildren(document.createTextNode(me.name+" "),el("small",{text:canAdmin?"· QC Manager":"· QC User"})); c.title="Signed in with your ERPNext account"; } } }
"""

BOOT = r"""(async()=>{
  const use=n=>(window.qcBackend&&window.qcBackend.use)?window.qcBackend.use(n).catch(()=>null):Promise.resolve(null);
  [db,user,dl]=await Promise.all([use("db"),use("user"),use("downloads")]);
  if(dl) $("#exportBtn").hidden=false;
  if(!db){ setLive("off"); canWrite=false; banner("Cannot reach ERPNext. Check the connection, then reload the page."); showTab(ui.tab); return; }
  const meInfo=window.__qcFrappe&&window.__qcFrappe.me();
  applyMember(meInfo);
  db.doc("config/members").onSnapshot(s=>{ const d=s.exists&&s.data(); members=Array.isArray(d&&d.list)?d.list.filter(m=>m&&m.id&&m.name):[]; applyMember(meInfo); render(); }, ()=>{});
  db.collection("issues").onSnapshot(s=>{ issues=s.docs.map(d=>({id:d.id,...d.data()})).filter(i=>i.createdAt); setLive("on"); render(); }, ()=>{ setLive("off"); banner("The connection stopped. Reload the page to reconnect."); });
  db.collection("meetings").onSnapshot(s=>{ meetings=s.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.at); render(); }, ()=>{});
  db.collection("complaints").onSnapshot(s=>{ complaints=s.docs.map(d=>({id:d.id,...d.data()})).filter(c=>c.createdAt); render(); }, ()=>{});
  db.collection("reports").onSnapshot(s=>{ reports={}; s.docs.forEach(d=>reports[d.id]=d.data()); if(ui.tab==="report") render(); }, ()=>{});
  db.collection("audits").onSnapshot(s=>{ audits=s.docs.map(d=>({id:d.id,...d.data()})).filter(a=>a.at&&isFinite(a.score)); render(); }, ()=>{});
  db.doc("config/departments").onSnapshot(s=>{ const L=s.exists&&s.data()&&s.data().list; if(Array.isArray(L)) depts=L.map(x=>({name:String(x.name),head:String(x.head||""),phone:String(x.phone||"")})); render(); }, ()=>{});
  db.doc("config/checklists").onSnapshot(s=>{ const d=s.exists&&s.data(); const before=JSON.stringify(checklistOf(ui.audit.dept));
    GENERIC=d&&Array.isArray(d.general)?d.general:[]; CHECKLISTS=d&&d.byDept&&typeof d.byDept==="object"?d.byDept:{};
    if(JSON.stringify(checklistOf(ui.audit.dept))!==before) ui.audit={dept:ui.audit.dept,r:{},n:{}}; render(); }, ()=>{});
  db.doc("config/mrm").onSnapshot(s=>{ const d=s.exists&&s.data(); mrmLines=d&&Array.isArray(d.list)&&d.list.length?d.list:null; }, ()=>{});
  db.doc("config/settings").onSnapshot(s=>{ const d=s.exists&&s.data(); if(d){ settings={sla:{...settings.sla,...(d.sla||{})},l2:d.l2||settings.l2,l3:d.l3||settings.l3,l2p:d.l2p||"",l3p:d.l3p||"",headsGroup:d.headsGroup||""}; } render(); }, ()=>{});
  showTab(ui.tab);
})();
})();
</script>"""

AUDIT_EDIT = r"""/* Round audit checklist editor (QC Manager). Saved in ERPNext: QC Settings → Round audit checklists */
function renderChkEdit(){
  const box=$("#aChk"), ed=ui.chkEdit, gen=ed.target==="__general__";
  $("#aItems").hidden=true; box.hidden=false;
  if(box.dataset.for===ed.target) return;
  box.dataset.for=ed.target;
  const own=!gen&&!!(CHECKLISTS[ed.target]&&CHECKLISTS[ed.target].length);
  const ta=el("textarea",{id:"aChkTxt",rows:"12"}); ta.value=(gen?GENERIC:checklistOf(ed.target)).join("\n");
  const close=()=>{ ui.chkEdit=null; box.dataset.for=""; renderAudit(); };
  box.replaceChildren(
    el("label",{class:"lbl",for:"aChkTxt",text:gen?"General checklist (for departments without their own)":`Checklist for ${ed.target}`}),
    el("p",{class:"small dim",style:"margin:2px 0 8px",text:(gen||own?"":`${ed.target} uses the general checklist now. Saving gives it its own checklist. `)+"One item per line, in the order they are scored. Audits already saved keep the items they were scored on."}),
    ta, el("div",{class:"err",id:"aChkErr"}),
    el("div",{class:"row",style:"flex-wrap:wrap;gap:8px;margin-top:8px"},
      el("button",{class:"btn primary sm",type:"button",onclick:e=>saveChk(ed.target,ta.value.split("\n"),e.target)},"Save checklist"),
      el("button",{class:"btn ghost sm",type:"button",onclick:close},"Cancel"),
      own? el("button",{class:"btn ghost sm",type:"button",onclick:e=>{ if(confirm(`Remove the ${ed.target} checklist? ${ed.target} will be audited with the general checklist.`)) saveChk(ed.target,[],e.target); }},"Use the general checklist"):null,
      gen? null: el("button",{class:"btn ghost sm",type:"button",onclick:()=>{ ui.chkEdit={target:"__general__"}; renderAudit(); }},"Edit the general checklist"),
      el("a",{class:"btn ghost sm",href:"/app/qc-settings",target:"_blank",rel:"noopener"},"All checklists in QC Settings")));
  ta.focus();
}
async function saveChk(target,lines,btn){ const items=lines.map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean), err=$("#aChkErr");
  if(target==="__general__"&&!items.length){ err.textContent="Enter at least one item."; return; }
  if(items.length>60){ err.textContent="A checklist can have at most 60 items."; return; }
  if(btn) btn.disabled=true; err.textContent="";
  try{ const r=await window.__qcFrappe.checklist(target,items); const saved=(r&&r.items)||items;
    if(target==="__general__") GENERIC=saved; else CHECKLISTS={...CHECKLISTS,[target]:saved};
    ui.chkEdit=null; $("#aChk").dataset.for=""; ui.audit={dept:ui.audit.dept,r:{},n:{}};
    toast(target==="__general__"?"General checklist saved.":saved.length?`Checklist saved for ${target}: ${saved.length} items.`:`${target} now uses the general checklist.`); renderAudit(); }
  catch(e){ err.textContent=(e&&e.message)||"Could not save the checklist."; if(btn) btn.disabled=false; }
}
"""

AUDIT_SRC = r"""  const items=checklistOf(ui.audit.dept), ownList=!!(CHECKLISTS[ui.audit.dept]&&CHECKLISTS[ui.audit.dept].length);
  $("#aSrc").textContent=!ui.audit.dept?"":ownList?`${ui.audit.dept} checklist · ${items.length} item${items.length===1?"":"s"}`:items.length?`General checklist · ${ui.audit.dept} has no checklist of its own yet`:"";
  $("#aEdit").hidden=!canAdmin||!db||!ui.audit.dept||!!ui.chkEdit;
  if(ui.chkEdit) renderChkEdit(); else { $("#aChk").hidden=true; $("#aItems").hidden=false; }
"""

PID_SEARCH = r"""/* Clinical complaints: find the patient in ERPNext by PID, name or mobile; picking one fills PID, name, age and sex (all still editable) */
(function(){ const inp=$("#cpPid"); if(!inp) return; const box=inp.parentElement; box.style.position="relative";
  inp.placeholder="Search PID, patient name or mobile"; inp.setAttribute("autocomplete","off"); inp.setAttribute("data-lpignore","true");
  const list=el("div",{class:"mt-pick-list",role:"listbox",hidden:true}); box.append(list);
  let timer=null, seq=0, hits=[], cur=-1;
  const close=()=>{ list.hidden=true; cur=-1; };
  const set=(sel,v)=>{ const e=$(sel); if(e&&v){ e.value=v; e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true})); } };
  const pick=p=>{ inp.value=p.pid; inp.dispatchEvent(new Event("change",{bubbles:true})); set("#cpName",p.name); set("#cpAge",p.age); set("#cpSex",p.sex); close(); };
  const paint=()=>{ list.replaceChildren(...(hits.length? hits.map((p,k)=>{ const o=el("div",{class:"mt-pick-opt",role:"option","aria-selected":String(k===cur)}, el("b",{text:`${p.pid} · ${p.name}`}), el("span",{text:[p.age,p.sex,p.mobile].filter(Boolean).join(" · ")||" "}));
      o.addEventListener("mousedown",e=>{ e.preventDefault(); pick(p); }); return o; })
    : [el("div",{class:"mt-pick-none",text:"No patient found in ERPNext. You can still type the details by hand."})]));
    const c=list.children[cur]; if(c&&c.scrollIntoView) c.scrollIntoView({block:"nearest"}); };
  const search=()=>{ const q=inp.value.trim(); clearTimeout(timer); if(q.length<2||!window.__qcFrappe){ close(); return; }
    timer=setTimeout(async()=>{ const my=++seq; let r=[]; try{ r=await window.__qcFrappe.patients(q); }catch(e){ r=[]; } if(my!==seq||document.activeElement!==inp) return; hits=r; cur=hits.length?0:-1; list.hidden=false; paint(); },250); };
  inp.addEventListener("input",search);
  inp.addEventListener("keydown",e=>{ if(list.hidden) return; if(e.key==="ArrowDown"||e.key==="ArrowUp"){ e.preventDefault(); if(!hits.length) return; cur=(cur+(e.key==="ArrowDown"?1:-1)+hits.length)%hits.length; paint(); }
    else if(e.key==="Enter"&&hits[cur]){ e.preventDefault(); pick(hits[cur]); } else if(e.key==="Escape"||e.key==="Tab") close(); });
  inp.addEventListener("blur",()=>setTimeout(close,150));
})();
"""


def build(src_path, out_path):
	s = open(src_path, encoding="utf-8").read()

	# links open in a new tab, not over ERPNext
	s = sub_once(s, '<base target="_top">', '<base target="_blank">')

	# tabs: new names and order, Settings removed
	s = sub_between(s, '      <button class="tab" role="tab" data-tab="exec"', '<button class="tab" role="tab" data-tab="settings" aria-selected="false">Settings</button>\n', (
		'      <button class="tab" role="tab" data-tab="exec" aria-selected="true">Dashboard</button>\n'
		'      <button class="tab" role="tab" data-tab="log" aria-selected="false">Non-Clinical Complaints</button>\n'
		'      <button class="tab" role="tab" data-tab="complaints" aria-selected="false">Clinical Complaints <span class="cnt" id="cpCnt">0</span></button>\n'
		'      <button class="tab" role="tab" data-tab="report" aria-selected="false">Round Report</button>\n'
		'      <button class="tab" role="tab" data-tab="issues" aria-selected="false">Issues &amp; CAPA <span class="cnt" id="openCnt">0</span></button>\n'
		'      <button class="tab" role="tab" data-tab="meetings" aria-selected="false">Management Meeting <span class="cnt" id="mtCnt">0</span></button>\n'
		'      <button class="tab" role="tab" data-tab="audit" aria-selected="false">Round Audits</button>\n'
		'      <button class="tab" role="tab" data-tab="depts" aria-selected="false">Department Rankings</button>\n'
		'      <button class="tab" role="tab" data-tab="trends" aria-selected="false">Trends</button>\n'))
	s = sub_once(s, "<h2>Log A Finding</h2>", "<h2>Log a Non-Clinical Complaint</h2>")
	s = sub_once(s, '<button class="fab" id="fab" hidden>+ Log Finding</button>', '<button class="fab" id="fab" hidden>+ Non-Clinical Complaint</button>')

	# PIN / team-password gate removed
	s = sub_between(s, '<div id="gate" class="gate" hidden>', '</form></div>\n', "")
	# Settings tab removed (QC Settings and user roles in ERPNext)
	s = sub_between(s, "  <!-- SETTINGS -->", "</main>", "</main>")

	# credit line removed (footer and PDF footers); logo and page name stay
	s = sub_once(s, "<span>·</span><span>Designed and developed by <b>Mustaf Abdiaziz</b></span>", "")
	s = sub_once(s, " · Designed and developed by Mustaf Abdiaziz\"", "\"", count=2)

	# ERPNext connector replaces the Google Sheets connector; PDF library from this server
	s = sub_between(s, "<script>\n/* Quality Control Tracker – Google Sheets connection.", '<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1', CONNECTOR, keep_end=True)
	s = sub_once(s, '<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"></script>', '<script src="/assets/task_management/js/vendor/jspdf.umd.min.js"></script>')
	s = sub_once(s, '<script src="https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js"></script>', '<script src="/assets/task_management/js/vendor/jspdf.plugin.autotable.min.js"></script>')

	# no hardcoded departments or committee: both come from ERPNext
	s, n = re.subn(r'const DEFAULT_DEPTS = \[[^\]]*\];', 'const DEFAULT_DEPTS = [];  /* departments come from ERPNext (QC Settings) */', s)
	assert n == 1, "DEFAULT_DEPTS"
	s = sub_between(s, "const MRM_DEFAULT=[", '"Abdinajib Mohamed Ali | HOD | Patient Relations"];', "const MRM_DEFAULT=[];  /* the committee comes from ERPNext (QC Settings) */")
	s = sub_once(s, "Admins can change it in Settings. */", "QC Managers keep it in QC Settings (ERPNext). */")
	s = sub_once(s, "let settings={sla:{critical:4, urgent:24, routine:168},", "let settings={sla:{critical:2, urgent:24, routine:168},")

	# tab list and render without Settings
	s = sub_once(s, 'const TABS=["exec","log","report","issues","complaints","meetings","audit","depts","trends","settings"];',
		'const TABS=["exec","log","complaints","report","issues","meetings","audit","depts","trends"];')
	s = sub_once(s, 'else if(ui.tab==="trends") renderTrends(); else if(ui.tab==="settings") renderSettings();', 'else if(ui.tab==="trends") renderTrends();')
	s = sub_between(s, "function renderSettings(){", 'finally{ $("#saveSet").disabled=!canAdmin; } });\n', "")

	# PIN gate code -> ERPNext user
	s = sub_between(s, "/* ===== team password gate (online) ===== */", 'if(GATE_ON){ document.body.classList.add("gated"); renderGate(); }\n', SIGNIN)
	s = sub_between(s, "(async()=>{\n  const use=n=>(window.claude", "  showTab(ui.tab);\n})();\n})();\n</script>", BOOT)

	# only the person who logged a non-clinical complaint, or a QC Manager, can delete it (checked by the server too)
	s = sub_once(s, 'canWrite&&db&&!ui.dDel? el("button",{class:"btn danger"', 'canWrite&&db&&(canAdmin||(uid&&i.reportedBy===uid))&&!ui.dDel? el("button",{class:"btn danger"')

	# PID search in ERPNext patients
	s = sub_once(s, "function cpOpenForm(c){", PID_SEARCH + "function cpOpenForm(c){")
	s = sub_once(s, '<label class="lbl" for="cpPid">PID *</label>', '<label class="lbl" for="cpPid">PID * <span class="small dim">(search PID, name or mobile)</span></label>')

	# texts that pointed to the removed Settings tab or to Google
	s = sub_once(s, '"Add it in Settings → Departments and heads so the head’s chat opens directly."', '"Add it in QC Settings (ERPNext) so the head’s chat opens directly."')
	s = sub_once(s, '"The QC Office can add it in Settings."', '"A QC Manager can add it in QC Settings."')
	s = sub_once(s, "Add WhatsApp numbers for department heads in Settings to message them from here.", "Add WhatsApp numbers for department heads in QC Settings (ERPNext) to message them from here.")
	s = sub_once(s, "Tip: add the heads group invite link in Settings so this opens the group directly.", "Tip: add the heads group invite link in QC Settings (ERPNext) so this opens the group directly.")
	s = sub_once(s, "Tip: the QC Office can add the heads group link in Settings.", "Tip: a QC Manager can add the heads group link in QC Settings.")
	s = s.replace("Cannot reach the Google Sheet. Check the internet connection and reload the page.", "Cannot reach ERPNext. Check the connection and reload the page.")
	s = s.replace("The Google Sheet checks the number is free when saving.", "ERPNext gives the final number when saving.")
	s = s.replace("the Google Sheet gives the final one", "ERPNext gives the final one")

	# wording: findings are now Non-Clinical Complaints, medical complaints are Clinical Complaints
	for pat, rep in [
		(r"\bFINDINGS\b", "NON-CLINICAL COMPLAINTS"), (r"\bFINDING\b", "NON-CLINICAL COMPLAINT"),
		(r"\bFindings\b", "Non-Clinical Complaints"), (r"\bFinding\b", "Non-Clinical Complaint"),
		(r"\bfindings\b", "non-clinical complaints"), (r"\bfinding\b", "non-clinical complaint"),
		(r"\bMEDICAL COMPLAINT", "CLINICAL COMPLAINT"), (r"\bMedical Complaint", "Clinical Complaint"),
		(r"\bMedical complaint", "Clinical complaint"), (r"\bmedical complaint", "clinical complaint"),
	]:
		s = re.sub(pat, rep, s)

	s = sub_once(s, "filename:`QC-non-clinical complaints-", "filename:`QC-non-clinical-complaints-")

	# round audit checklists come from QC Settings; QC Managers can edit a department's checklist here
	s = sub_between(s, "const GENERIC = [", '"Help desk staffed"]\n};\n',
		"let GENERIC = [], CHECKLISTS = {};  /* round audit checklists come from ERPNext (QC Settings) */\n")
	s = sub_once(s, "const checklistOf=d=>CHECKLISTS[d]||GENERIC;", "const checklistOf=d=>(CHECKLISTS[d]&&CHECKLISTS[d].length)?CHECKLISTS[d]:GENERIC;")
	s = sub_once(s, '        <div class="aitems" id="aItems"></div>',
		'        <div class="row spread"><span class="small dim" id="aSrc"></span><button class="btn sm" id="aEdit" type="button" hidden>Edit checklist</button></div>\n'
		'        <div id="aChk" hidden></div>\n'
		'        <div class="aitems" id="aItems"></div>')
	s = sub_once(s, "function renderAudit(){", AUDIT_EDIT + "function renderAudit(){")
	s = sub_once(s, '  const items=checklistOf(ui.audit.dept);\n  $("#aItems")', AUDIT_SRC + '  $("#aItems")')
	s = sub_once(s, '$("#aSave").disabled=!canWrite||!db;', '$("#aSave").disabled=!canWrite||!db||!!ui.chkEdit;\n'
		'  if(!items.length) $("#aItems").replaceChildren(el("div",{class:"empty",text:canAdmin?"No checklist for this department yet. Use Edit checklist to add one.":"No checklist for this department yet. Ask a QC Manager to add one."}));')
	s = sub_once(s, '$("#aDept").addEventListener("change",e=>{ ui.audit={dept:e.target.value,r:{},n:{}}; renderAudit(); });',
		'$("#aDept").addEventListener("change",e=>{ ui.audit={dept:e.target.value,r:{},n:{}}; ui.chkEdit=null; renderAudit(); });\n'
		'$("#aEdit").addEventListener("click",()=>{ ui.chkEdit={target:ui.audit.dept}; renderAudit(); });')

	for bad in ("Mustaf", "google.script", "__qcSheets", "window.claude", "cdn.jsdelivr"):
		if bad in s:
			raise SystemExit("Left over after build: " + bad)
	with open(out_path, "w", encoding="utf-8") as f:
		f.write(s)
	return s


if __name__ == "__main__":
	src = sys.argv[1] if len(sys.argv) > 1 else "/home/hodan/qc-source/Index.html"
	out = os.path.join(HERE, "index.html")
	s = build(src, out)
	print("Wrote %s (%d characters)" % (out, len(s)))
