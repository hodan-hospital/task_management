# Copyright (c) 2026, Hodan Hospital
"""Import the Google Sheets export (qc-export.json from ExportForMigration.gs) into ERPNext.

Run on the TEST site first, from the bench folder:

	# 1. which old department names need matching to ERPNext departments
	bench --site erp.hodanhospital execute task_management.quality_control.importer.department_template \
		--kwargs "{'export_path': '/path/qc-export.json', 'out_csv': '/path/dept-map.csv'}"

	# 2. check (nothing is written), then import
	bench --site erp.hodanhospital execute task_management.quality_control.importer.import_export \
		--kwargs "{'export_path': '/path/qc-export.json', 'photos_dir': '/path/QC Rounds Tracker Photos', 'dept_map_csv': '/path/dept-map.csv', 'dry_run': 1}"
	... same with 'dry_run': 0

What is imported: non-clinical complaints (findings), clinical complaints, meetings, audits, round report
records, photos and attachments, the audit log, deadlines, the heads group link and the meeting committee.
What is NOT imported: PINs, PIN hashes, the team password, and items deleted in Google Sheets.
Team members are not created as users: their names are kept so old records still show who did what.

The import can be run again (for example after the 1-2 week check, for the final switch-over): each item
is matched by its id and replaced with the newer copy from the export. Numbers are kept.
"""
import csv
import json
import mimetypes
import os

import frappe
from frappe.utils import cint

from task_management.quality_control.api import (
	SYNC_COLS,
	bump_counter,
	clear_config_cache,
	local_day,
	write_doc,
)

BY = "migration"


def _load(export_path):
	with open(export_path, encoding="utf-8") as f:
		ex = json.load(f)
	if ex.get("format") != "qc-tracker-export" or not isinstance(ex.get("docs"), list):
		frappe.throw("This is not a Quality Control Tracker export file (qc-export.json).")
	return ex


def _dept_names(ex):
	names = set()
	for d in ex["docs"]:
		if d.get("del") or not isinstance(d.get("data"), dict):
			continue
		if d["col"] == "issues":
			names.update(d["data"].get("depts") or [])
		elif d["col"] == "audits" and d["data"].get("dept"):
			names.add(d["data"]["dept"])
		elif d["col"] == "config" and d["id"] == "departments":
			names.update(x.get("name") for x in d["data"].get("list") or [] if x.get("name"))
	return sorted(n for n in names if n)


def department_template(export_path, out_csv):
	"""Write a CSV: old department name -> suggested ERPNext Department. Check the second column, then import with it."""
	ex = _load(export_path)
	erp = frappe.db.sql("select name, department_name from `tabDepartment` where ifnull(disabled,0)=0")
	by_label = {}
	for name, label in erp:
		by_label.setdefault((label or "").strip().lower(), name)
	with open(out_csv, "w", newline="", encoding="utf-8") as f:
		w = csv.writer(f)
		w.writerow(["old_department", "erpnext_department"])
		for n in _dept_names(ex):
			guess = by_label.get(n.lower(), "")
			if not guess:
				hits = [name for name, label in erp if n.lower() in (label or "").lower() or (label or "").lower() in n.lower()]
				guess = hits[0] if len(hits) == 1 else ""
			w.writerow([n, guess])
	print("Wrote %s. Fill in or correct the erpnext_department column (leave empty to keep the old name)." % out_csv)


def _read_map(dept_map_csv):
	m = {}
	if not dept_map_csv:
		return m
	with open(dept_map_csv, encoding="utf-8") as f:
		for row in csv.DictReader(f):
			old, new = (row.get("old_department") or "").strip(), (row.get("erpnext_department") or "").strip()
			if old and new:
				if not frappe.db.exists("Department", new):
					frappe.throw("Department %r in %s does not exist in ERPNext." % (new, dept_map_csv))
				m[old] = (frappe.db.get_value("Department", new, "department_name") or new).strip()
	return m


def _photo_file(photos_dir, photo_id, index):
	if not photos_dir:
		return None
	if photo_id + ".jpg" in index:
		return index[photo_id + ".jpg"]
	for name, path in index.items():
		if name.startswith(photo_id + "-") or name.startswith(photo_id + "."):
			return path
	return None


def import_export(export_path, photos_dir=None, dept_map_csv=None, dry_run=1, import_settings=1):
	frappe.only_for(("System Manager", "Administrator"))
	ex = _load(export_path)
	dmap = _read_map(dept_map_csv)
	unmapped = [n for n in _dept_names(ex) if n not in dmap]
	index = {}
	if photos_dir:
		for root, _dirs, files in os.walk(photos_dir):
			for n in files:
				index[n] = os.path.join(root, n)

	live = [d for d in ex["docs"] if not d.get("del") and isinstance(d.get("data"), dict)]
	live.sort(key=lambda d: cint(d.get("t")))
	stats = {"imported": {}, "skipped": {}, "photos_missing": [], "meetings_numbered": 0}

	def count(k, col):
		stats[k][col] = stats[k].get(col, 0) + 1

	# meetings that never got a running number get the next ones, in meeting-date order (existing numbers never change)
	meetings = [d for d in live if d["col"] == "meetings"]
	max_seq = max([cint(d["data"].get("seq")) for d in meetings] + [0])
	for d in sorted([m for m in meetings if not cint(m["data"].get("seq"))], key=lambda m: str(m["data"].get("at"))):
		max_seq += 1
		m = d["data"]
		if m.get("ref") and not m.get("oldRef"):
			m["oldRef"] = m["ref"]
		m["seq"] = max_seq
		m["ref"] = "MM-%s-%02d" % (local_day(m.get("at")), max_seq)
		stats["meetings_numbered"] += 1
	for d in meetings:
		if str(d["data"].get("ref") or "").startswith("MRM-"):
			d["data"]["ref"] = "MM-" + d["data"]["ref"][4:]

	settings = {}
	for d in live:
		col, data = d["col"], d["data"]
		if col == "config":
			settings[d["id"]] = data
			continue
		if col == "pins":
			count("skipped", "pins")
			continue
		if col not in SYNC_COLS and col != "audit":
			count("skipped", col)
			continue
		if dmap and col == "issues":
			data["depts"] = list(dict.fromkeys(dmap.get(x, x) for x in data.get("depts") or []))
		if dmap and col == "audits" and data.get("dept"):
			data["dept"] = dmap.get(data["dept"], data["dept"])
		if col == "photos":
			path = _photo_file(photos_dir, d["id"], index)
			if path and not cint(dry_run):
				with open(path, "rb") as f:
					raw = f.read()
				fdoc = frappe.get_doc({"doctype": "File", "file_name": os.path.basename(path), "is_private": 1, "content": raw, "folder": "Home/QC Tracker"})
				fdoc.flags.ignore_permissions = True
				fdoc.save()
				data["driveFile"] = data.get("file")
				data["file"] = fdoc.name
				data["mime"] = data.get("mime") or mimetypes.guess_type(path)[0] or "application/octet-stream"
			elif not path:
				stats["photos_missing"].append(d["id"])
				data["driveFile"] = data.pop("file", None)
		if not cint(dry_run):
			write_doc(col, d["id"], data, False, d.get("by") or BY, bump_counter("t"))
		count("imported", col)

	# running numbers continue after the highest imported number, so none is ever used twice
	mc = {}
	for d in live:
		if d["col"] == "complaints":
			ref = str(d["data"].get("ref") or "")
			if ref.startswith("MC-") and ref.count("-") == 2:
				day, n = ref.split("-")[1], cint(ref.split("-")[2])
				mc[day] = max(mc.get(day, 0), n)

	if not cint(dry_run):
		for day, n in mc.items():
			_set_counter_floor("MC-" + day, n)
		_set_counter_floor("MM", max_seq)
		members = (settings.get("members") or {}).get("list") or []
		legacy = [{"id": m.get("id"), "name": m.get("name"), "role": m.get("role"), "active": False} for m in members if m.get("id") and m.get("name")]
		write_doc("legacy", "members", {"list": legacy}, False, BY, bump_counter("t"))
		if cint(import_settings):
			_import_settings(settings, dmap)
		clear_config_cache()
		frappe.db.commit()

	stats["photos_missing_count"] = len(stats.pop("photos_missing"))
	stats["dry_run"] = bool(cint(dry_run))
	stats["departments_mapped"] = len(dmap)
	stats["unmapped_departments"] = unmapped
	print(json.dumps(stats, indent=1))
	return stats


def _set_counter_floor(key, floor):
	"""Make sure the next number given for this counter is above floor."""
	if floor <= 0:
		return
	frappe.db.sql(
		"""insert into `tabQC Counter` (name, counter_key, value, creation, modified, owner, modified_by, docstatus, idx)
		values (%(k)s, %(k)s, %(v)s, now(), now(), 'Administrator', 'Administrator', 0, 0)
		on duplicate key update value=greatest(value, %(v)s), modified=now()""",
		{"k": key, "v": cint(floor)},
	)


def _import_settings(settings, dmap):
	s = frappe.get_single("QC Settings")
	st = settings.get("settings") or {}
	sla = st.get("sla") or {}
	for key, field in (("critical", "sla_critical"), ("urgent", "sla_urgent"), ("routine", "sla_routine")):
		if cint(sla.get(key)) > 0:
			s.set(field, cint(sla[key]))
	if st.get("headsGroup"):
		s.heads_group = st["headsGroup"]
	mrm = (settings.get("mrm") or {}).get("list") or []
	if mrm:
		s.set("committee", [])
		for line in mrm:
			parts = [p.strip() for p in str(line).split("|")] + ["", ""]
			if parts[0]:
				s.append("committee", {"member_name": parts[0], "role": parts[1], "position": parts[2]})
	# heads and WhatsApp numbers: for departments matched to ERPNext, only if QC Settings has none yet
	depts = (settings.get("departments") or {}).get("list") or []
	if dmap and not s.departments:
		by_label = {}
		for name, label in frappe.db.sql("select name, department_name from `tabDepartment`"):
			by_label.setdefault((label or "").strip(), name)
		for d in depts:
			label = dmap.get(d.get("name"))
			if label and by_label.get(label) and (d.get("head") or d.get("phone")):
				s.append("departments", {"department": by_label[label], "head": d.get("head") or "", "whatsapp": d.get("phone") or ""})
	s.flags.ignore_permissions = True
	s.save()
