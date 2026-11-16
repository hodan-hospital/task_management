# Copyright (c) 2026, Hodan Hospital
"""Every tracker record, live, archived or deleted, searchable by number, date, type and text."""
import json

import frappe
from frappe.utils import add_days, getdate

from task_management.quality_control.report.qc_common import name_of, people_names

TYPES = {
	"Non-Clinical Complaint": "issues",
	"Clinical Complaint": "complaints",
	"Management Meeting": "meetings",
	"Round Audit": "audits",
}
LABEL = {v: k for k, v in TYPES.items()}
STATUS = {
	"issues": {"open": "Open", "progress": "In progress", "resolved": "Fixed, awaiting verification", "closed": "Closed and verified"},
	"complaints": {"open": "Pending", "investigating": "Under investigation", "closed": "Completed"},
}


def execute(filters=None):
	f = frappe._dict(filters or {})
	cols = [TYPES[f.record_type]] if f.get("record_type") in TYPES else list(TYPES.values())
	cond, args = ["col in %(cols)s"], {"cols": tuple(cols)}
	state = f.get("state") or "Live and archived"
	if state == "Live":
		cond.append("deleted=0 and archived=0")
	elif state == "Archived":
		cond.append("deleted=0 and archived=1")
	elif state == "Deleted":
		cond.append("deleted=1")
	elif state == "Live and archived":
		cond.append("deleted=0")
	if f.get("from_date"):
		cond.append("doc_date >= %(fd)s")
		args["fd"] = getdate(f.from_date)
	if f.get("to_date"):
		cond.append("doc_date < %(td)s")
		args["td"] = add_days(getdate(f.to_date), 1)
	if f.get("search"):
		cond.append("(ref like %(q)s or summary like %(q)s or pid like %(q)s or area like %(q)s or department like %(q)s)")
		args["q"] = "%" + f.search.strip() + "%"
	rows = frappe.db.sql(
		"""select name, col, doc_id, ref, doc_date, status, pid, area, department, summary, deleted, archived, data
		from `tabQC Document` where %s order by doc_date desc limit 5000""" % " and ".join(cond),
		args,
		as_dict=True,
	)
	names = people_names()
	data = []
	for r in rows:
		d = {}
		if r.data:
			try:
				d = json.loads(r.data)
			except Exception:
				d = {}
		data.append({
			"ref": r.ref or r.doc_id,
			"doc_date": r.doc_date,
			"record_type": LABEL.get(r.col, r.col),
			"area": r.area,
			"department": r.department,
			"pid": r.pid if (r.pid or "").startswith("PID-") else None,
			"pid_text": r.pid,
			"summary": r.summary,
			"status": STATUS.get(r.col, {}).get(r.status, r.status),
			"state": "Deleted" if r.deleted else "Archived" if r.archived else "Live",
			"recorded_by": name_of(names, d.get("reportedBy") or d.get("by")),
			"qc_document": r.name,
		})
	return columns(), data


def columns():
	return [
		{"fieldname": "ref", "label": "Ref", "fieldtype": "Data", "width": 170},
		{"fieldname": "doc_date", "label": "Date", "fieldtype": "Datetime", "width": 150},
		{"fieldname": "record_type", "label": "Type", "fieldtype": "Data", "width": 170},
		{"fieldname": "area", "label": "Area", "fieldtype": "Data", "width": 120},
		{"fieldname": "department", "label": "Department(s) / Owner", "fieldtype": "Data", "width": 170},
		{"fieldname": "pid", "label": "Patient", "fieldtype": "Link", "options": "Patient", "width": 110},
		{"fieldname": "pid_text", "label": "PID (as recorded)", "fieldtype": "Data", "width": 110},
		{"fieldname": "summary", "label": "Summary", "fieldtype": "Data", "width": 320},
		{"fieldname": "status", "label": "Status", "fieldtype": "Data", "width": 160},
		{"fieldname": "state", "label": "In tracker", "fieldtype": "Data", "width": 90},
		{"fieldname": "recorded_by", "label": "Recorded by", "fieldtype": "Data", "width": 160},
		{"fieldname": "qc_document", "label": "QC Document", "fieldtype": "Link", "options": "QC Document", "width": 110},
	]
