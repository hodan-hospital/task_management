# Copyright (c) 2026, Hodan Hospital
import frappe

ROLES = ("QC User", "QC Manager")

# The Management Meeting committee as it was in the Google Sheets tracker. It is copied ONCE into
# QC Settings (where QC Managers keep it up to date); it is no longer part of the page code.
INITIAL_COMMITTEE = [
	("Asra Mohamed Ali", "Secretary", "CEO Office"),
	("Dr. Abdulkadir Sh. Omar", "HOD", "Medical Administration"),
	("Dr. Sharmake Ahmed Dine", "Deputy HOD", "Medical Administration"),
	("Dr. Mohamed Dahir Salad (Haidar)", "HOD", "TQM"),
	("Eng. Saleh Hassan Saleh", "HOD", "BME"),
	("Eng. Mohamed Abdulkadir", "HOD", "HIS"),
	("Eng. Abdiaziz Abuukar", "HOD", "ICT"),
	("Mahad Said", "HOD", "Facility"),
	("Abdalla Dahir", "HOD", "Finance"),
	("Abdulkadir Mohamed Baryare", "HOD", "Human Resource"),
	("Dr. Abdulfatah Jelia", "HOD", "Laboratory"),
	("Omar Baashe", "HOD", "Nursing"),
	("Dr. Mohamed Amin (Obama)", "Manager", "OPD"),
	("Abdirisak Salad Herow", "HOD", "Pharmacy"),
	("Jabril Hussein Amalow", "HOD", "Logistics & Procurement"),
	("Yusuf Abdullahi Mohamed", "Supervisor", "Finance"),
	("Mohamed Garaad", "Deputy HOD", "Finance"),
	("Abdinajib Mohamed Ali", "HOD", "Patient Relations"),
]


def ensure_roles():
	for role in ROLES:
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(ignore_permissions=True)


def ensure_folder():
	if not frappe.db.exists("File", "Home/QC Tracker"):
		frappe.get_doc({"doctype": "File", "file_name": "QC Tracker", "is_folder": 1, "folder": "Home"}).insert(ignore_permissions=True)


def ensure_indexes():
	frappe.db.add_index("QC Document", ["col", "deleted", "archived"], "qc_col_state")


def before_install():
	ensure_roles()


def after_install():
	ensure_roles()
	ensure_folder()
	ensure_indexes()
	s = frappe.get_single("QC Settings")
	s.sla_critical = s.sla_critical or 2
	s.sla_urgent = s.sla_urgent or 24
	s.sla_routine = s.sla_routine or 168
	s.tombstone_days = s.tombstone_days or 30
	if not s.company:
		s.company = frappe.db.get_single_value("Global Defaults", "default_company")
	if not s.committee:
		for name, role, position in INITIAL_COMMITTEE:
			s.append("committee", {"member_name": name, "role": role, "position": position})
	s.flags.ignore_permissions = True
	s.save()
	seed_checklists()
	ensure_task_management()
	frappe.db.commit()


def seed_checklists():
	"""Copy the round audit checklists of the Google Sheets page into QC Settings, once (only while QC Settings has none)."""
	from task_management.quality_control.checklist_defaults import BY_DEPARTMENT, ERPNEXT_NAMES, GENERAL

	s = frappe.get_single("QC Settings")
	if s.audit_checklists or (s.general_checklist or "").strip():
		return
	company = s.company or frappe.db.get_single_value("Global Defaults", "default_company")
	not_found = []
	for old, items in BY_DEPARTMENT.items():
		found = False
		for label in ERPNEXT_NAMES.get(old, [old]):
			dept = frappe.db.sql(
				"""select name from `tabDepartment` where trim(department_name)=%s and ifnull(disabled,0)=0
				and (%s is null or company=%s) order by name limit 1""",
				(label, company, company),
			)
			if dept:
				found = True
				for item in items:
					s.append("audit_checklists", {"department": dept[0][0], "item": item})
		if not found:
			not_found.append(old)
	s.general_checklist = "\n".join(GENERAL)
	s.flags.ignore_permissions = True
	s.save()
	if not_found:
		print("Round audit checklists with no matching ERPNext department (not copied): " + ", ".join(not_found))


def after_migrate():
	ensure_roles()
	ensure_folder()
	ensure_indexes()
	ensure_task_management()


def ensure_task_management():
	"""Custom fields, task types and indexes of the Task Management module (page task-hub)."""
	from task_management.task_management.setup import ensure_setup

	ensure_setup()
