# Copyright (c) 2026, Hodan Hospital
"""Every deletion, archive and restore: what it was, who recorded it, who did it and when."""
import json

import frappe
from frappe.utils import add_days, getdate

from task_management.quality_control.report.qc_common import name_of, people_names


# names used by the Google Sheets tracker
OLD_KIND = {"Finding": "Non-clinical complaint", "Medical complaint": "Clinical complaint"}


def execute(filters=None):
	f = frappe._dict(filters or {})
	cond, args = ["col='audit'"], {}
	if f.get("from_date"):
		cond.append("doc_date >= %(fd)s")
		args["fd"] = getdate(f.from_date)
	if f.get("to_date"):
		cond.append("doc_date < %(td)s")
		args["td"] = add_days(getdate(f.to_date), 1)
	if f.get("search"):
		cond.append("(ref like %(q)s or summary like %(q)s)")
		args["q"] = "%" + f.search.strip() + "%"
	names = people_names()
	data = []
	for r in frappe.db.sql("select doc_date, data from `tabQC Document` where %s order by doc_date desc limit 5000" % " and ".join(cond), args, as_dict=True):
		try:
			a = json.loads(r.data or "{}")
		except Exception:
			a = {}
		data.append({
			"when": r.doc_date, "action": a.get("action"), "kind": OLD_KIND.get(a.get("kind"), a.get("kind")), "ref": a.get("ref"), "detail": a.get("detail"),
			"reason": a.get("reason"), "created_by": name_of(names, a.get("createdBy")), "done_by": a.get("byName") or name_of(names, a.get("by")),
		})
	cols = [
		{"fieldname": "when", "label": "When", "fieldtype": "Datetime", "width": 150},
		{"fieldname": "action", "label": "Action", "fieldtype": "Data", "width": 90},
		{"fieldname": "kind", "label": "Item", "fieldtype": "Data", "width": 160},
		{"fieldname": "ref", "label": "Ref", "fieldtype": "Data", "width": 170},
		{"fieldname": "detail", "label": "Details", "fieldtype": "Data", "width": 320},
		{"fieldname": "reason", "label": "Reason", "fieldtype": "Data", "width": 200},
		{"fieldname": "created_by", "label": "Recorded by", "fieldtype": "Data", "width": 160},
		{"fieldname": "done_by", "label": "Done by", "fieldtype": "Data", "width": 160},
	]
	return cols, data
