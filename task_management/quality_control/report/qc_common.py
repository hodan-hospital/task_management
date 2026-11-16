# Copyright (c) 2026, Hodan Hospital
import json

import frappe


def people_names():
	"""uid ("m:<user>" or "m:<old Google member id>") -> name."""
	names = {"m:" + u: (fn or u) for u, fn in frappe.db.sql("select name, full_name from `tabUser`")}
	legacy = frappe.db.get_value("QC Document", {"doc_key": "legacy/members"}, "data")
	try:
		for m in (json.loads(legacy) or {}).get("list") or []:
			if m.get("id") and m.get("name"):
				names.setdefault("m:" + m["id"], m["name"])
	except Exception:
		pass
	names.update({"migration": "QC Office", "setup": "QC Office", "editor": "QC Office"})
	return names


def name_of(names, uid):
	if not uid:
		return ""
	return names.get(uid) or ("Former team member" if str(uid).startswith("m:") else str(uid))
