# Copyright (c) 2026, Hodan Hospital
"""Idempotent setup for the Task Management module (page `task-hub`).

Run by after_install / after_migrate, or by hand:
    bench --site <site> execute task_management.task_management.setup.ensure_setup
"""
import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

MODULE = "Task Management"

# Clinical task types offered in the "Task Type" filter. Only missing ones are created.
TASK_TYPES = [
	"Ward Round",
	"Treatment Review",
	"Lab Review",
	"Medication Review",
	"Consultation",
	"Surgery",
	"Pre-Operative",
	"Discharge",
	"Bed Management",
	"Follow-up",
]

CUSTOM_FIELDS = {
	"Task": [
		{
			"fieldname": "tm_section",
			"fieldtype": "Section Break",
			"label": "Clinical Task Details",
			"insert_after": "description",
			"collapsible": 1,
		},
		{"fieldname": "tm_team", "fieldtype": "Link", "label": "Team", "options": "Task Team", "insert_after": "tm_section"},
		{"fieldname": "tm_patient", "fieldtype": "Link", "label": "Patient", "options": "Patient", "insert_after": "tm_team"},
		{
			"fieldname": "tm_patient_name",
			"fieldtype": "Data",
			"label": "Patient Name",
			"fetch_from": "tm_patient.patient_name",
			"read_only": 1,
			"insert_after": "tm_patient",
		},
		{"fieldname": "tm_column_break", "fieldtype": "Column Break", "insert_after": "tm_patient_name"},
		{"fieldname": "tm_blocked", "fieldtype": "Check", "label": "Blocked", "insert_after": "tm_column_break"},
		{
			"fieldname": "tm_blocked_reason",
			"fieldtype": "Small Text",
			"label": "Blocked Reason",
			"depends_on": "eval:doc.tm_blocked",
			"insert_after": "tm_blocked",
		},
		{
			"fieldname": "tm_delay_reason",
			"fieldtype": "Small Text",
			"label": "Reason for Delay",
			"description": "Why the task is late or overdue, e.g. waiting for approval or for something from outside.",
			"insert_after": "tm_blocked_reason",
		},
		{
			"fieldname": "tm_checklist_section",
			"fieldtype": "Section Break",
			"label": "Checklist",
			"insert_after": "tm_delay_reason",
			"collapsible": 1,
		},
		{
			"fieldname": "tm_checklist",
			"fieldtype": "Table",
			"label": "Checklist",
			"options": "Task Checklist Item",
			"insert_after": "tm_checklist_section",
		},
	],
}


def ensure_module_def():
	"""The Module Def was first created from the UI and pointed at the wrong app."""
	if frappe.db.exists("Module Def", MODULE):
		if frappe.db.get_value("Module Def", MODULE, "app_name") != "task_management":
			frappe.db.set_value("Module Def", MODULE, "app_name", "task_management", update_modified=False)
	else:
		frappe.get_doc({"doctype": "Module Def", "module_name": MODULE, "app_name": "task_management"}).insert(
			ignore_permissions=True
		)


def ensure_task_types():
	for name in TASK_TYPES:
		if not frappe.db.exists("Task Type", name):
			doc = frappe.new_doc("Task Type")
			doc.name = name
			doc.insert(ignore_permissions=True, set_name=name)


def ensure_indexes():
	frappe.db.add_index("Clinical Round", ["round_date", "status"], "tm_round_date_status")
	frappe.db.add_index("Task Handover", ["to_user", "status"], "tm_handover_to_status")


ROLES = ("Task User", "Task Manager")


def ensure_access():
	"""The page task-hub is for two roles of this app.

	Task User     reads / writes / creates Task (ERPNext's doctype, so Custom DocPerm). Which tasks such a user
	              reaches, and what they may change on them, is narrowed in permissions.py.
	Task Manager  sees and changes everything and, with System Manager, is the only one who deletes tasks.

	Both may read (not change) the lists the New Task dialog offers: Task Type and Department.
	Role "All" no longer has access (it had in the first version). The page roles and the permissions of this
	app's own doctypes come from their JSON files.
	"""
	from frappe.permissions import add_permission, update_permission_property

	for role in ROLES:
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)

	def grant(doctype, role, ptypes):
		if not frappe.db.exists("Custom DocPerm", {"parent": doctype, "role": role, "permlevel": 0}):
			add_permission(doctype, role, 0)  # read only; copies the standard permissions first if needed
		for ptype in ptypes:
			if not frappe.db.get_value("Custom DocPerm", {"parent": doctype, "role": role, "permlevel": 0}, ptype):
				update_permission_property(doctype, role, 0, ptype, 1)

	grant("Task", "Task User", ("write", "create"))
	for role in ("Task Manager", "System Manager"):
		grant("Task", role, ("write", "create", "delete", "report", "export", "print", "email", "share"))
	for doctype in ("Task Type", "Department"):
		for role in ROLES:
			grant(doctype, role, ())
	if frappe.db.exists("Custom DocPerm", {"parent": "Task", "role": "All"}):
		frappe.db.delete("Custom DocPerm", {"parent": "Task", "role": "All"})
		frappe.clear_cache(doctype="Task")
	if not frappe.db.exists("Has Role", {"parent": "task-hub", "parenttype": "Page", "role": "Task User"}):
		# not migrated yet: load the page and the doctypes whose JSON names the two roles
		from frappe.modules.import_file import import_file_by_path

		base = frappe.get_app_path("task_management", "task_management")
		for kind, name in (("doctype", "task_team_member"), ("doctype", "task_team"), ("doctype", "clinical_round"), ("doctype", "task_handover"), ("page", "task_hub")):
			import_file_by_path("{0}/{1}/{2}/{2}.json".format(base, kind, name), force=True)


def ensure_setup():
	ensure_module_def()
	if frappe.db.exists("Custom Field", "Project-tm_project_lead"):  # from the first, project-based version
		frappe.delete_doc("Custom Field", "Project-tm_project_lead", force=1)
	create_custom_fields(CUSTOM_FIELDS, update=True)
	ensure_task_types()
	ensure_indexes()
	ensure_access()
	frappe.db.commit()


def create_department_teams(company=None, dry_run=0):
	"""Create a main Task Team per main department, with a sub-team per designation.

	    bench --site <site> execute task_management.task_management.setup.create_department_teams
	    (add --kwargs "{'dry_run': 1}" to only print what would be created)

	Main department = a department directly under the organisation root (or under a pure container such
	as "CEO") with at least two active employees (its sub-departments included). Members are the active employees
	of the department and of its sub-departments. Staff with an enabled user account are linked to it
	(they can be assigned tasks and chat); the others are listed by name only.

	Sub-teams are by designation only, e.g. Nursing Service Department > Staff Nurse: a designation gets a
	sub-team when at least two people of the main team hold it and it is not simply everybody in the team.
	Sub-departments do not get a team; the ones an earlier version created are removed (see
	remove_department_subteams).

	Safe to run again: existing teams are reused, members are only added.
	"""
	from frappe.utils import cint

	company = company or frappe.db.get_single_value("Global Defaults", "default_company")
	depts = {
		d.name: d
		for d in frappe.get_all(
			"Department",
			filters={"company": company, "disabled": 0},
			fields=["name", "department_name", "parent_department", "is_group"],
		)
	}
	kids = {}
	for d in depts.values():
		kids.setdefault(d.parent_department or "", []).append(d.name)
	staff, people = {}, {}
	for e in frappe.db.sql(
		"""select e.name, e.employee_name, e.designation, e.department, u.name enabled_user from `tabEmployee` e
		left join `tabUser` u on u.name = e.user_id and u.enabled = 1
		where e.status = 'Active' and ifnull(e.department, '') != '' order by e.employee_name""",
		as_dict=True,
	):
		staff[e.department] = staff.get(e.department, 0) + 1
		people.setdefault(e.department, []).append(e)

	def descendants(name):
		out = []
		for k in kids.get(name, []):
			out.append(k)
			out.extend(descendants(k))
		return out

	def is_container(name):
		d = depts.get(name)
		if not d or not d.parent_department:
			return True  # organisation root ("All Departments")
		return bool(cint(d.is_group) and not staff.get(name) and any(kids.get(k) for k in kids.get(name, [])))

	mains = []
	for name, d in depts.items():
		if is_container(name) or not is_container(d.parent_department):
			continue
		if staff.get(name, 0) + sum(staff.get(k, 0) for k in descendants(name)) >= 2:
			mains.append(name)
	mains.sort(key=lambda n: -(staff.get(n, 0) + sum(staff.get(k, 0) for k in descendants(n))))

	def sync(doc, wanted):
		by_emp = {m.employee: m for m in doc.members if m.employee}
		by_user = {m.user: m for m in doc.members if m.user}
		added = 0
		for e in wanted:
			row = by_emp.get(e.name) or (by_user.get(e.enabled_user) if e.enabled_user else None)
			if not row:
				row = doc.append("members", {})
				added += 1
				by_emp[e.name] = row
			row.employee = e.name
			row.full_name = e.employee_name
			row.designation = e.designation
			row.user = e.enabled_user or row.user
		if not cint(dry_run):
			doc.save(ignore_permissions=True)
		return added

	def new_team(label, parent, **values):
		if frappe.db.exists("Task Team", label):
			label = "{0} ({1})".format(label, parent or company)
		doc = frappe.new_doc("Task Team")
		doc.team_name = label
		doc.update(values)
		return doc

	def all_staff(dept):
		out = list(people.get(dept, []))
		for k in descendants(dept):
			out += people.get(k, [])
		return out

	def team_for(dept, parent=None):
		existing = frappe.db.get_value("Task Team", {"department": dept, "designation": ("is", "not set")}, "name")
		created = not existing
		if existing:
			doc = frappe.get_doc("Task Team", existing)
		else:
			doc = new_team((depts[dept].department_name or dept).strip(), parent, department=dept)
		if parent and not doc.parent_team and doc.name != parent:
			doc.parent_team = parent
		added = sync(doc, people.get(dept, []) if parent else all_staff(dept))
		return doc.team_name if created and cint(dry_run) else doc.name, created, added

	def designation_teams(main, main_team):
		"""Sub-teams of a main team, one per designation held by two or more of its staff."""
		everyone = all_staff(main)
		groups = {}
		for e in everyone:
			if e.designation:
				groups.setdefault(e.designation, []).append(e)
		out = []
		for designation in sorted(groups, key=lambda d: (-len(groups[d]), d)):
			wanted = groups[designation]
			if len(wanted) < 2 or len(wanted) == len(everyone):
				continue
			existing = frappe.db.get_value("Task Team", {"parent_team": main_team, "designation": designation}, "name")
			created = not existing
			if existing:
				doc = frappe.get_doc("Task Team", existing)
			else:
				doc = new_team(designation.strip(), main_team, parent_team=main_team, department=main, designation=designation)
			added = sync(doc, wanted)
			out.append((doc.team_name if created and cint(dry_run) else doc.name, created, added))
		return out

	report = []
	for main in mains:
		main_team, created, added = team_for(main)
		subs = remove_department_subteams(main_team, main, dry_run)
		by_designation = designation_teams(main, main_team)
		report.append((main_team, created, added, subs, by_designation))
		print(
			"{0}{1}: {2} member(s) added, {3} sub-department team(s) removed, {4} designation sub-team(s){5}".format(
				main_team,
				" (new)" if created else "",
				added,
				len(subs),
				len(by_designation),
				": " + ", ".join("{0} [+{1}]".format(s[0], s[2]) for s in by_designation) if by_designation else "",
			)
		)
	if not cint(dry_run):
		frappe.db.commit()
	return {
		"main": len(report),
		"sub_departments_removed": sum(len(r[3]) for r in report),
		"designation": sum(len(r[4]) for r in report),
	}


def remove_department_subteams(main_team, main_department, dry_run=0):
	"""Remove the sub-teams that stood for a sub-department (teams are grouped by designation only).

	A sub-team of `main_team` without a designation whose department differs from the main team's.
	Its tasks and rounds move to the main team. A team that has chat messages is disabled instead of
	deleted, so nothing that people wrote is lost. Sub-teams that were made by hand are left alone.
	"""
	from frappe.utils import cint

	removed = []
	for name in frappe.get_all(
		"Task Team",
		filters={"parent_team": main_team, "disabled": 0, "designation": ("is", "not set"), "department": ("not in", ("", main_department))},
		pluck="name",
	):
		removed.append(name)
		if cint(dry_run):
			continue
		frappe.db.sql("update `tabTask` set tm_team=%s where tm_team=%s", (main_team, name))
		frappe.db.sql("update `tabClinical Round` set team=%s where team=%s", (main_team, name))
		if frappe.db.exists("Comment", {"reference_doctype": "Task Team", "reference_name": name}):
			frappe.db.set_value("Task Team", name, "disabled", 1)
		else:
			frappe.delete_doc("Task Team", name, force=1, ignore_permissions=True)
	return removed
