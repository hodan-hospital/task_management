# Copyright (c) 2026, Hodan Hospital
"""Server for the Quality Control Tracker page.

The tracker page keeps its original data layer: every item (a non-clinical complaint, a clinical
complaint, a meeting, an audit, a photo ...) is one JSON document identified by collection + id,
with a change number ``t`` so open pages can fetch only what changed.

The page talks to one endpoint, ``qc``, with these requests:

	init      who am I + every live item (replaces the old boot / login)
	pull      items changed since a change number
	put       save or delete one item
	photo     one photo / attachment as a data URL
	patients  ERPNext patient search (PID, name or mobile) for clinical complaints

Sign-in is the ERPNext session. Role "QC User" can log and update; "QC Manager" can also verify &
close, delete anyone's records and change QC Settings.
"""

import base64
import hashlib
import json
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import frappe
from frappe.utils import add_days, cint, get_fullname, get_system_timezone, getdate, now_datetime

QC_USER = "QC User"
QC_MANAGER = "QC Manager"
SYNC_COLS = ("issues", "photos", "audits", "reports", "complaints", "meetings")
ID_RE = re.compile(r"^[A-Za-z0-9_\-.:@+]{1,200}$")
COL_RE = re.compile(r"^[a-z]+$")
DATA_URL_RE = re.compile(r"^data:([^;,]*)(?:;[^,]*)?;base64,(.*)$", re.S)
MAX_DOC_CHARS = 1_800_000
MAX_FILE_BYTES = 10 * 1024 * 1024 + 256 * 1024
FILE_EXT = {
	"jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp",
	"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "rtf", "txt", "csv",
}
FILE_FOLDER = "Home/QC Tracker"
CFG_CACHE_KEY = "qc_tracker_config"


class QCError(Exception):
	def __init__(self, code, message=None):
		super().__init__(message or code)
		self.code = code


# ---------------------------------------------------------------- who is calling
def get_me():
	user = frappe.session.user
	if not user or user == "Guest":
		raise QCError("auth", "Please sign in to ERPNext.")
	roles = set(frappe.get_roles(user))
	admin = QC_MANAGER in roles or user == "Administrator"
	if not (admin or QC_USER in roles):
		raise QCError("forbidden", "You need the QC User or QC Manager role to use the Quality Control Tracker.")
	return frappe._dict(id=user, uid="m:" + user, name=get_fullname(user) or user, role="admin" if admin else "member", admin=admin)


def is_qc_manager(user=None):
	user = user or frappe.session.user
	return user == "Administrator" or QC_MANAGER in frappe.get_roles(user)


# ---------------------------------------------------------------- entry points
@frappe.whitelist(methods=["POST"])
def qc(op=None, **kw):
	"""Single entry point used by the tracker page. Always answers {ok: true, ...} or {ok: false, error, message}."""
	try:
		me = get_me()
		if op == "init":
			return _init(me)
		if op == "pull":
			return _pull(cint(kw.get("since")), kw.get("cfg"), me)
		if op == "put":
			return _put(me, kw.get("col"), kw.get("id"), kw.get("data"), bool(kw.get("del")))
		if op == "photo":
			return _photo(kw.get("id"))
		if op == "patients":
			return {"ok": True, "list": search_patients(kw.get("q"))}
		if op == "tabs":
			return {"ok": True}
		if op == "checklist":
			return _save_checklist(me, kw.get("dept"), kw.get("items"))
		raise QCError("bad_request", "Unknown request")
	except QCError as e:
		frappe.db.rollback()
		return {"ok": False, "error": e.code, "message": str(e)}
	except Exception:
		frappe.db.rollback()
		frappe.log_error(title="Quality Control Tracker", message=frappe.get_traceback())
		return {"ok": False, "error": "server", "message": "ERPNext could not complete this request. The error has been logged for IT."}


@frappe.whitelist()
def tracker_html():
	"""The tracker page itself, served only to signed-in QC users (it is shown inside the ERPNext page qc-tracker)."""
	try:
		get_me()
	except QCError as e:
		frappe.throw(str(e), frappe.PermissionError)
	path = frappe.get_app_path("task_management", "quality_control", "tracker_app", "index.html")
	with open(path, encoding="utf-8") as f:
		return f.read()


# ---------------------------------------------------------------- read
def _loads(s):
	if not s:
		return None
	try:
		return json.loads(s)
	except Exception:
		return None


def _public_data(col, data):
	if col == "photos" and isinstance(data, dict):
		return {"issueId": data.get("issueId"), "kind": data.get("kind"), "at": data.get("at"), "by": data.get("by")}
	return data


def current_t():
	v = frappe.db.sql("select value from `tabQC Counter` where name='t'")
	return cint(v[0][0]) if v else 0


def _init(me):
	t = current_t()
	rows = frappe.db.sql(
		"""select col, doc_id, t, data from `tabQC Document`
		where deleted=0 and archived=0 and col in %(cols)s""",
		{"cols": SYNC_COLS},
		as_dict=True,
	)
	docs = []
	for r in rows:
		data = _loads(r.data)
		if data is None:
			continue
		docs.append({"col": r.col, "id": r.doc_id, "t": cint(r.t), "del": False, "data": _public_data(r.col, data)})
		t = max(t, cint(r.t))
	cfg, h = config_docs(me)
	return {
		"ok": True,
		"me": {"id": me.id, "name": me.name, "role": me.role, "verify": me.admin},
		"docs": cfg + docs,
		"t": t,
		"cfg": h,
	}


def _pull(since, cfg_hash, me):
	rows = frappe.db.sql(
		"""select col, doc_id, t, deleted, archived, data from `tabQC Document`
		where t > %(since)s and col in %(cols)s order by t""",
		{"since": since, "cols": SYNC_COLS},
		as_dict=True,
	)
	docs, t = [], max(since, current_t())
	for r in rows:
		gone = bool(r.deleted or r.archived)
		data = None if gone else _loads(r.data)
		docs.append({"col": r.col, "id": r.doc_id, "t": cint(r.t), "del": gone or data is None, "data": _public_data(r.col, data)})
		t = max(t, cint(r.t))
	cfg, h = config_docs(me)
	if h != cfg_hash:
		docs = cfg + docs
	return {"ok": True, "docs": docs, "t": t, "cfg": h}


def _photo(doc_id):
	doc_id = str(doc_id or "")
	row = frappe.db.get_value("QC Document", {"doc_key": "photos/" + doc_id}, ["data", "deleted"], as_dict=True)
	if not row or row.deleted:
		return {"ok": True, "exists": False}
	d = _loads(row.data) or {}
	out = _public_data("photos", d)
	if d.get("file") and frappe.db.exists("File", d["file"]):
		try:
			f = frappe.get_doc("File", d["file"])
			content = f.get_content()
			if isinstance(content, str):
				content = content.encode("utf-8")
			mime = d.get("mime") or "application/octet-stream"
			out["data"] = "data:%s;base64,%s" % (mime, base64.b64encode(content).decode("ascii"))
		except Exception:
			frappe.log_error(title="Quality Control Tracker photo", message=frappe.get_traceback())
	return {"ok": True, "exists": True, "data": out}


# ---------------------------------------------------------------- settings, departments, people (built from ERPNext)
def _dept_label(name):
	return (frappe.db.get_value("Department", name, "department_name") or name or "").strip()


def _build_config():
	s = frappe.get_single("QC Settings")
	# departments: every active department of the company, with head / WhatsApp from QC Settings
	contacts, listed = {}, []
	for r in s.departments or []:
		n = _dept_label(r.department)
		if n and n.lower() not in contacts:
			contacts[n.lower()] = {"name": n, "head": (r.head or "").strip(), "phone": (r.whatsapp or "").strip()}
			listed.append(n)
	if cint(s.only_listed_departments) and listed:
		names = listed
	else:
		company = s.company or frappe.db.get_single_value("Global Defaults", "default_company")
		rows = frappe.db.sql(
			"""select department_name from `tabDepartment`
			where ifnull(disabled,0)=0 and name!='All Departments' and (%(c)s is null or company=%(c)s)
			order by department_name""",
			{"c": company},
		)
		names = sorted({(n or "").strip() for (n,) in rows if (n or "").strip()}, key=str.lower) + listed
	depts, seen = [], set()
	for n in names:
		if n and n.lower() not in seen:
			seen.add(n.lower())
			depts.append(contacts.get(n.lower()) or {"name": n, "head": "", "phone": ""})
	# people with a QC role
	people = {}
	for user, full_name, role in frappe.db.sql(
		"""select u.name, u.full_name, hr.role from `tabUser` u
		join `tabHas Role` hr on hr.parent=u.name and hr.parenttype='User'
		where hr.role in (%s, %s) and u.enabled=1""",
		(QC_USER, QC_MANAGER),
	):
		p = people.setdefault(user, {"id": user, "name": full_name or user, "role": "member", "active": True})
		if role == QC_MANAGER:
			p["role"] = "admin"
	members = sorted(people.values(), key=lambda p: p["name"].lower())
	for p in members:
		p["verify"] = p["role"] == "admin"
	# people from the Google Sheets tracker, kept only so old records show their names
	legacy = _loads(frappe.db.get_value("QC Document", {"doc_key": "legacy/members"}, "data")) or {}
	for m in legacy.get("list") or []:
		if m.get("id") and m.get("name"):
			members.append({"id": m["id"], "name": m["name"], "role": "member", "active": False, "verify": False})
	settings = {
		"sla": {"critical": cint(s.sla_critical) or 2, "urgent": cint(s.sla_urgent) or 24, "routine": cint(s.sla_routine) or 168},
		"headsGroup": (s.heads_group or "").strip(),
		"l2": "Medical Director", "l3": "CEO", "l2p": "", "l3p": "",
	}
	# round audit checklists: per department (by its name in the tracker), in row order
	by_dept = {}
	for r in s.audit_checklists or []:
		n, item = _dept_label(r.department), (r.item or "").strip()
		if n and item:
			by_dept.setdefault(n, []).append(item)
	general = [x.strip() for x in (s.general_checklist or "").splitlines() if x.strip()]
	mrm = [" | ".join([(r.member_name or "").strip(), (r.role or "").strip(), (r.position or "").strip()]) for r in (s.committee or []) if (r.member_name or "").strip()]
	return {"members": members, "departments": depts, "settings": settings, "mrm": mrm, "checklists": {"general": general, "byDept": by_dept}}


def config_docs(me):
	cfg = frappe.cache().get_value(CFG_CACHE_KEY)
	if not cfg:
		cfg = _build_config()
		frappe.cache().set_value(CFG_CACHE_KEY, cfg, expires_in_sec=30)
	members = list(cfg["members"])
	if me and not any(m["id"] == me.id for m in members):  # e.g. Administrator
		members.insert(0, {"id": me.id, "name": me.name, "role": me.role, "active": True, "verify": me.admin})
	docs = [
		{"col": "config", "id": "members", "t": 0, "del": False, "data": {"list": members}},
		{"col": "config", "id": "departments", "t": 0, "del": False, "data": {"list": cfg["departments"]}},
		{"col": "config", "id": "settings", "t": 0, "del": False, "data": cfg["settings"]},
		{"col": "config", "id": "mrm", "t": 0, "del": False, "data": {"list": cfg["mrm"]}},
		{"col": "config", "id": "checklists", "t": 0, "del": False, "data": cfg["checklists"]},
	]
	h = hashlib.md5(json.dumps(docs, sort_keys=True).encode()).hexdigest()
	return docs, h


def clear_config_cache(*args, **kwargs):
	frappe.cache().delete_value(CFG_CACHE_KEY)


# ---------------------------------------------------------------- write
def bump_counter(key, floor=0):
	"""Next value of a never-reused running number. The row stays locked until the request commits."""
	frappe.db.sql(
		"""insert into `tabQC Counter` (name, counter_key, value, creation, modified, owner, modified_by, docstatus, idx)
		values (%s, %s, 0, now(), now(), 'Administrator', 'Administrator', 0, 0)
		on duplicate key update name=name""",
		(key, key),
	)
	cur = cint(frappe.db.sql("select value from `tabQC Counter` where name=%s for update", key)[0][0])
	nv = max(cur, cint(floor)) + 1
	frappe.db.sql("update `tabQC Counter` set value=%s, modified=now() where name=%s", (nv, key))
	return nv


def _tz():
	try:
		return ZoneInfo(get_system_timezone() or "Africa/Mogadishu")
	except Exception:
		return ZoneInfo("Africa/Mogadishu")


def parse_iso(s):
	if not s:
		return None
	try:
		d = datetime.fromisoformat(str(s).strip().replace("Z", "+00:00"))
	except Exception:
		return None
	if d.tzinfo is None:
		d = d.replace(tzinfo=timezone.utc)
	return d


def local_dt(s):
	d = parse_iso(s)
	return d.astimezone(_tz()).replace(tzinfo=None) if d else None


def local_day(s):
	d = local_dt(s) or now_datetime()
	return d.strftime("%Y%m%d")


def _cut(v, n=140):
	v = "" if v is None else str(v)
	return v if len(v) <= n else v[: n - 1] + "…"


def derive_fields(col, d):
	"""Readable columns kept next to the JSON so ERPNext reports and the archive can search them."""
	if not isinstance(d, dict):
		return {}
	if col == "issues":
		return {"ref": _cut(d.get("ref")), "doc_date": local_dt(d.get("createdAt")), "status": _cut(d.get("status")), "area": _cut(d.get("area")),
			"department": ", ".join(d.get("depts") or []), "summary": _cut(d.get("description"), 500)}
	if col == "complaints":
		return {"ref": _cut(d.get("ref")), "doc_date": local_dt(d.get("createdAt")), "status": _cut(d.get("status")), "area": _cut(d.get("area")),
			"pid": _cut(d.get("pid")), "department": _cut(d.get("owner"), 500),
			"summary": _cut(" · ".join(x for x in [d.get("patient"), d.get("type")] if x) + (": " + str(d.get("details")) if d.get("details") else ""), 500)}
	if col == "meetings":
		acts = d.get("actions") or []
		return {"ref": _cut(d.get("ref")), "doc_date": local_dt(d.get("at")), "status": "%d actions, %d completed" % (len(acts), len([a for a in acts if a.get("status") == "completed"])),
			"area": _cut(d.get("location")), "summary": _cut(d.get("title") or "Management Meeting", 500)}
	if col == "audits":
		return {"doc_date": local_dt(d.get("at")), "area": _cut(d.get("area")), "department": _cut(d.get("dept"), 500), "status": "Score %s%%" % d.get("score")}
	if col == "photos":
		return {"ref": _cut(d.get("issueId")), "doc_date": local_dt(d.get("at")), "status": _cut(d.get("kind")), "summary": _cut(d.get("name"), 500)}
	if col == "audit":
		return {"ref": _cut(d.get("ref")), "doc_date": local_dt(d.get("at")), "status": _cut(d.get("action")), "department": _cut(d.get("kind"), 500),
			"summary": _cut(" · ".join(x for x in [d.get("detail"), ("Reason: " + d["reason"]) if d.get("reason") else ""] if x), 500)}
	return {}


def write_doc(col, doc_id, data, deleted, by, t, existing_name=None, archived=None):
	key = "%s/%s" % (col, doc_id)
	js = None if deleted else json.dumps(data, ensure_ascii=False, separators=(",", ":"))
	values = {"t": t, "deleted": 1 if deleted else 0, "by_user": by, "data": js}
	if archived is not None:
		values["archived"] = 1 if archived else 0
	if not deleted:
		values.update(derive_fields(col, data))  # a deleted item keeps its number and summary for the records
	if existing_name is None:
		existing_name = frappe.db.get_value("QC Document", {"doc_key": key}, "name")
	if existing_name:
		frappe.db.set_value("QC Document", existing_name, values, update_modified=True)
		return existing_name
	doc = frappe.get_doc(dict(doctype="QC Document", col=col, doc_id=doc_id, doc_key=key, **values))
	doc.flags.ignore_permissions = True
	doc.insert()
	return doc.name


def _entry_key(e):
	return json.dumps({k: v for k, v in e.items() if k != "by"}, sort_keys=True, ensure_ascii=False)


def _stamp(me, col, data, old):
	"""The server records who did what: names can no longer be set by the browser."""
	old = old or {}
	uid = me.uid
	if col in ("issues", "complaints", "meetings"):
		data["reportedBy"] = old.get("reportedBy", data.get("reportedBy")) if old else uid
	if col == "audits":
		data["by"] = old.get("by", data.get("by")) if old else uid
	if "updatedBy" in data and (not old or data.get("updatedAt") != old.get("updatedAt")):
		data["updatedBy"] = uid
	for f in ("startedBy", "resolvedBy", "closedBy", "verifiedBy"):
		if data.get(f) and data.get(f) != old.get(f):
			data[f] = uid
	for list_field in ("log", "notes"):
		items = data.get(list_field)
		if not isinstance(items, list):
			continue
		known = {_entry_key(e) for e in (old.get(list_field) or []) if isinstance(e, dict)}
		for e in items:
			if isinstance(e, dict) and "by" in e and _entry_key(e) not in known:
				e["by"] = uid
	if col in ("issues", "complaints"):
		was, now_ = old.get("status"), data.get("status")
		if not me.admin and now_ != was and (now_ == "closed" or was == "closed"):
			raise QCError("forbidden", "Only a QC Manager can verify and close, or reopen, a closed item.")
	return data


def _complaint_ref(data, old):
	if old and old.get("ref"):
		return old["ref"]  # an existing complaint keeps its number
	day = local_day(data.get("createdAt"))
	prefix = "MC-%s-" % day
	floor = 0
	for (ref,) in frappe.db.sql("select ref from `tabQC Document` where col='complaints' and ref like %s", prefix + "%"):
		floor = max(floor, cint(str(ref)[len(prefix):]))
	return "%s%04d" % (prefix, bump_counter("MC-" + day, floor))


def _meeting_ref(data, old):
	if old and cint(old.get("seq")) > 0:
		return cint(old["seq"]), (old.get("ref") or "").replace("MRM-", "MM-", 1)
	seq = bump_counter("MM")
	return seq, "MM-%s-%02d" % (local_day(data.get("at")), seq)


def _ensure_folder():
	if not frappe.db.exists("File", FILE_FOLDER):
		frappe.get_doc({"doctype": "File", "file_name": "QC Tracker", "is_folder": 1, "folder": "Home"}).insert(ignore_permissions=True)
	return FILE_FOLDER


def _store_photo(me, doc_id, data, old):
	meta = {"issueId": data.get("issueId"), "kind": data.get("kind"), "at": data.get("at"), "by": me.uid}
	name = _cut(data.get("name"), 150) if data.get("name") else ""
	if name:
		meta["name"] = name
	m = DATA_URL_RE.match(str(data.get("data") or ""))
	if not m:
		if old and old.get("file"):
			meta["file"], meta["mime"] = old.get("file"), old.get("mime")
		return meta
	mime = m.group(1) or "application/octet-stream"
	try:
		raw = base64.b64decode(m.group(2))
	except Exception:
		raise QCError("bad_request", "The file could not be read.")
	if len(raw) > MAX_FILE_BYTES:
		raise QCError("too_large", "This file is larger than 10 MB.")
	if data.get("kind") == "file" and name:
		fname = "%s-%s" % (doc_id, re.sub(r'[\\/:*?"<>|]+', "_", name))
	else:
		fname = doc_id + ".jpg"
	ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
	if ext not in FILE_EXT and not mime.startswith("image/"):
		raise QCError("bad_request", "This type of file cannot be attached. Use PDF, Word, Excel, PowerPoint, text or image files.")
	f = frappe.get_doc({"doctype": "File", "file_name": fname, "is_private": 1, "content": raw, "folder": _ensure_folder()})
	f.flags.ignore_permissions = True
	f.save()
	meta["file"], meta["mime"] = f.name, mime
	return meta


DELETE_DENIED = {
	"issues": "Only the person who logged this non-clinical complaint or a QC Manager can delete it.",
	"complaints": "Only the person who recorded this clinical complaint or a QC Manager can delete it.",
	"meetings": "Only the person who recorded this meeting or a QC Manager can delete it.",
}


def _put(me, col, doc_id, data, delete):
	col, doc_id = str(col or ""), str(doc_id or "")
	if not ID_RE.match(doc_id) or not COL_RE.match(col):
		raise QCError("bad_request", "Bad item name")
	if col not in SYNC_COLS:
		if col in ("config", "pins"):
			raise QCError("forbidden", "Departments, deadlines and the meeting committee are managed in ERPNext: QC Settings. Team members are ERPNext users with the QC User or QC Manager role.")
		raise QCError("forbidden", "You cannot change this.")
	key = "%s/%s" % (col, doc_id)
	row = frappe.db.sql("select name, data, deleted, archived from `tabQC Document` where doc_key=%s for update", key, as_dict=True)
	row = row[0] if row else None
	if row and row.archived:
		raise QCError("forbidden", "This record is archived. A QC Manager can restore it from QC Settings.")
	old = _loads(row.data) if row and not row.deleted else None
	res = {"ok": True}

	if delete:
		if old is None:
			res["t"] = current_t()
			return res
		if col in DELETE_DENIED and not me.admin and old.get("reportedBy") != me.uid:
			raise QCError("forbidden", DELETE_DENIED[col])
		t = bump_counter("t")
		write_doc(col, doc_id, None, True, me.uid, t, existing_name=row.name)
		if col in ("issues", "complaints", "meetings", "photos"):
			log_audit(me, "Deleted", col, doc_id, old, t, reason=old.get("deleteReason"))
		res["t"] = t
		return res

	if not isinstance(data, dict):
		raise QCError("bad_request", "Nothing to save.")
	if col == "photos":
		data = _store_photo(me, doc_id, data, old)
	else:
		data = _stamp(me, col, data, old)
		if col == "complaints":
			data["ref"] = res["ref"] = _complaint_ref(data, old)
		elif col == "meetings":
			data["seq"], data["ref"] = _meeting_ref(data, old)
			res["ref"] = data["ref"]
	if len(json.dumps(data, ensure_ascii=False)) > MAX_DOC_CHARS:
		raise QCError("too_large", "This item is too large to save.")
	t = bump_counter("t")
	write_doc(col, doc_id, data, False, me.uid, t, existing_name=row.name if row else None)
	res["t"] = t
	return res


KIND = {"archive": "Archive", "issues": "Non-clinical complaint", "complaints": "Clinical complaint", "meetings": "Management meeting", "photos": "Photo or attachment", "audits": "Round audit", "reports": "Round report record", "checklists": "Round audit checklist"}


def log_audit(me, action, col, doc_id, d, t, reason=None, detail=None):
	"""Audit log entry (shown in the QC Audit Log report)."""
	d = d or {}

	def txt(v, n):
		v = str(v or "")
		return v if len(v) <= n else v[:n] + "…"

	if detail is None:
		if col == "meetings":
			detail = " · ".join([txt(d.get("title"), 80), str(d.get("at") or "")[:10], "%d attendees" % len(d.get("attendees") or []), "%d actions" % len(d.get("actions") or [])])
		elif col == "complaints":
			detail = " · ".join(x for x in ["PID " + (d.get("pid") or "—"), d.get("type"), d.get("area")] if x)
		elif col == "photos":
			detail = " · ".join(x for x in [d.get("kind"), d.get("name"), "of " + str(d.get("issueId") or "")] if x)
		else:
			detail = " · ".join(x for x in [d.get("area"), ", ".join(d.get("depts") or []), txt(d.get("description"), 140)] if x)
	entry = {
		"at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
		"action": action,
		"kind": KIND.get(col, col),
		"ref": str(d.get("ref") or doc_id).replace("MRM-", "MM-", 1),
		"detail": detail,
		"reason": txt(reason, 300),
		"createdBy": d.get("reportedBy") or d.get("by") or "",
		"by": me.uid,
		"byName": me.name,
	}
	audit_id = ("%s-%s-%s-%s" % (action.lower().replace(" ", "-")[:10], col, doc_id, t))[:200]
	write_doc("audit", audit_id, entry, False, me.uid, t)


# ---------------------------------------------------------------- round audit checklists
GENERAL_CHECKLIST = "__general__"


def _save_checklist(me, dept, items):
	"""QC Manager: replace one department's checklist (or the general one) in QC Settings."""
	if not me.admin:
		raise QCError("forbidden", "Only a QC Manager can change audit checklists.")
	dept = str(dept or "").strip()
	if not dept or not isinstance(items, list):
		raise QCError("bad_request", "Choose a department and enter the checklist items.")
	clean = []
	for x in items:
		x = re.sub(r"\s+", " ", str(x or "")).strip()
		if x and x not in clean:
			clean.append(x[:140])
	if len(clean) > 60:
		raise QCError("bad_request", "A checklist can have at most 60 items.")
	s = frappe.get_single("QC Settings")
	if dept == GENERAL_CHECKLIST:
		if not clean:
			raise QCError("bad_request", "The general checklist needs at least one item.")
		s.general_checklist = "\n".join(clean)
		label = "General checklist"
	else:
		rows = list(s.audit_checklists or [])
		mine = [r for r in rows if _dept_label(r.department).lower() == dept.lower()]
		if mine:
			docname = mine[0].department
		else:
			company = s.company or frappe.db.get_single_value("Global Defaults", "default_company")
			found = frappe.db.sql(
				"""select name from `tabDepartment` where trim(department_name)=%s and ifnull(disabled,0)=0
				and (%s is null or company=%s) order by name limit 1""",
				(dept, company, company),
			)
			if not found:
				raise QCError("bad_request", "Department %s was not found in ERPNext." % dept)
			docname = found[0][0]
		at = rows.index(mine[0]) if mine else len(rows)
		keep = [r for r in rows if r not in mine]
		new = [{"department": docname, "item": x} for x in clean]
		s.set("audit_checklists", [])
		for r in keep[:at]:
			s.append("audit_checklists", {"department": r.department, "item": r.item})
		for r in new:
			s.append("audit_checklists", r)
		for r in keep[at:]:
			s.append("audit_checklists", {"department": r.department, "item": r.item})
		label = dept
	s.flags.ignore_permissions = True
	s.save()
	clear_config_cache()
	detail = "%s: %d item%s" % (label, len(clean), "" if len(clean) == 1 else "s") if clean else "%s: uses the general checklist" % label
	log_audit(me, "Changed", "checklists", label, {"ref": label}, bump_counter("t"), detail=detail)
	return {"ok": True, "items": clean}


# ---------------------------------------------------------------- patients
def _age(dob):
	if not dob:
		return ""
	dob, today = getdate(dob), getdate()
	if dob > today:
		return ""
	years = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
	if years >= 1:
		return "%d year%s" % (years, "" if years == 1 else "s")
	months = (today.year - dob.year) * 12 + today.month - dob.month - (1 if today.day < dob.day else 0)
	if months >= 1:
		return "%d month%s" % (months, "" if months == 1 else "s")
	days = (today - dob).days
	return "%d day%s" % (days, "" if days == 1 else "s")


def search_patients(q):
	"""Find ERPNext patients by PID, name or mobile number (for clinical complaints)."""
	q = re.sub(r"\s+", " ", str(q or "")).strip()
	if len(q) < 2:
		return []
	digits = re.sub(r"\D", "", q)
	conds, params = [], {"limit": 15}
	if re.fullmatch(r"(?i)(pid-?)?\d+", q):
		params["pid"] = "PID-" + digits
		params["pidp"] = "PID-" + digits + "%"
		conds += ["name = %(pid)s", "name like %(pidp)s"]
		if len(digits) >= 5:
			params["mob"] = "%" + digits + "%"
			conds.append("mobile like %(mob)s")
	else:
		params["n1"] = q + "%"
		params["n2"] = "% " + q + "%"
		conds += ["patient_name like %(n1)s", "patient_name like %(n2)s"]
		if digits and len(digits) >= 5:
			params["mob"] = "%" + digits + "%"
			conds.append("mobile like %(mob)s")
	rows = frappe.db.sql(
		"""select name, patient_name, sex, dob, mobile from `tabPatient`
		where (%s) order by (name=%%(pid)s) desc, modified desc limit %%(limit)s""" % " or ".join(conds),
		dict(params, pid=params.get("pid", "")),
		as_dict=True,
	)
	return [
		{"pid": r.name, "name": r.patient_name or "", "sex": r.sex if r.sex in ("Male", "Female") else "", "age": _age(r.dob), "mobile": r.mobile or ""}
		for r in rows
	]


# ---------------------------------------------------------------- archive (QC Manager)
def _archive_targets(before_date, only_closed, include_clinical, include_meetings, restore=False):
	before = getdate(before_date)
	cols = ["issues", "audits", "reports"]
	if cint(include_clinical):
		cols.append("complaints")
	if cint(include_meetings):
		cols.append("meetings")
	rows = frappe.db.sql(
		"""select name, col, doc_id, data, doc_date from `tabQC Document`
		where deleted=0 and archived=%(a)s and col in %(cols)s""",
		{"a": 1 if restore else 0, "cols": cols},
		as_dict=True,
	)
	picked = []
	for r in rows:
		when = r.doc_date
		if r.col == "reports" and not when:
			try:
				when = getdate(r.doc_id[:10])
			except Exception:
				when = None
		if not when or getdate(when) >= before:
			continue
		if cint(only_closed) and not restore:
			d = _loads(r.data) or {}
			if r.col in ("issues", "complaints") and d.get("status") != "closed":
				continue
			if r.col == "meetings" and any((a.get("status") or "open") != "completed" for a in d.get("actions") or []):
				continue
		picked.append(r)
	parents = {r.doc_id for r in picked if r.col in ("issues", "complaints")}
	if parents:
		for r in frappe.db.sql(
			"select name, col, doc_id, data, doc_date from `tabQC Document` where deleted=0 and archived=%(a)s and col='photos' and ref in %(p)s",
			{"a": 1 if restore else 0, "p": tuple(parents)},
			as_dict=True,
		):
			picked.append(r)
	return picked


@frappe.whitelist(methods=["POST"])
def archive_records(before_date, only_closed=1, include_clinical=0, include_meetings=0, dry_run=0):
	"""Hide old records from the tracker (they stay searchable in the QC Records report)."""
	if not is_qc_manager():
		frappe.throw("Only a QC Manager can archive records.", frappe.PermissionError)
	picked = _archive_targets(before_date, only_closed, include_clinical, include_meetings)
	counts = {}
	for r in picked:
		counts[r.col] = counts.get(r.col, 0) + 1
	if cint(dry_run) or not picked:
		return {"count": len(picked), "by_type": counts}
	me = get_me()
	for r in picked:
		frappe.db.set_value("QC Document", r.name, {"archived": 1, "t": bump_counter("t")}, update_modified=False)
	log_audit(me, "Archived", "archive", "batch", {}, bump_counter("t"),
		detail="%d records before %s: %s" % (len(picked), before_date, ", ".join("%s %d" % (KIND.get(k, k), v) for k, v in counts.items())))
	return {"count": len(picked), "by_type": counts}


@frappe.whitelist(methods=["POST"])
def restore_records(before_date, include_clinical=1, include_meetings=1, dry_run=0):
	"""Bring archived records back into the tracker."""
	if not is_qc_manager():
		frappe.throw("Only a QC Manager can restore records.", frappe.PermissionError)
	picked = _archive_targets(before_date, 0, include_clinical, include_meetings, restore=True)
	if cint(dry_run) or not picked:
		return {"count": len(picked)}
	me = get_me()
	for r in picked:
		frappe.db.set_value("QC Document", r.name, {"archived": 0, "t": bump_counter("t")}, update_modified=False)
	log_audit(me, "Restored", "archive", "batch", {}, bump_counter("t"), detail="%d archived records before %s restored" % (len(picked), before_date))
	return {"count": len(picked)}


# ---------------------------------------------------------------- housekeeping
def purge_old_tombstones():
	"""Daily: remove the small markers of deleted items once every open page has seen them. The audit log keeps the history."""
	days = cint(frappe.db.get_single_value("QC Settings", "tombstone_days")) or 30
	frappe.db.sql(
		"delete from `tabQC Document` where deleted=1 and col in %(cols)s and modified < %(cut)s",
		{"cols": SYNC_COLS, "cut": add_days(now_datetime(), -days)},
	)
