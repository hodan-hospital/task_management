# Copyright (c) 2026, Hodan Hospital
"""Demonstration tasks for the page `task-hub`: realistic hospital work for every main department team.

    bench --site <site> execute task_management.task_management.demo.create_demo_tasks
    bench --site <site> execute task_management.task_management.demo.remove_demo_tasks

Every task created here carries the tag "Hospital Demo", which is how remove_demo_tasks finds them.
Running create again skips the subjects that already exist. No patient records are linked.
"""
import frappe
from frappe.utils import add_days, nowdate

TAG = "Hospital Demo"

# (main team, sub-team or None, subject, task type, priority, column, start offset, due offset, extras)
# column: todo / progress / review / done / blocked.  Offsets are days from today.
# extras: checklist=[...], done=<number of checklist items ticked>, note="comment", why="blocked reason"
T = [
	# ------------------------------------------------------------------ Medical Administration
	("Medical Administration", None, "Morning consultant ward round - Medical Ward A", "Ward Round", "High", "progress", 0, 0,
		dict(checklist=["Review overnight admissions", "Update treatment plans", "Order pending investigations", "Brief the nurse in charge"], done=2)),
	("Medical Administration", None, "Monthly mortality and morbidity meeting - October cases", None, "Medium", "todo", 2, 5,
		dict(checklist=["Collect case files from Medical Records", "Prepare case summaries", "Circulate agenda to consultants"])),
	("Medical Administration", None, "Update the on-call rota for December", None, "Medium", "review", -3, 1, dict(note="Draft rota shared with the heads of unit for comments.")),
	("Medical Administration", "General Practitioner", "OPD triage: clear the morning queue before 11:00", "Consultation", "High", "progress", 0, 0, {}),
	("Medical Administration", "General Practitioner", "Review abnormal lab results for yesterday's OPD patients", "Lab Review", "High", "todo", 0, 0,
		dict(checklist=["Print the abnormal results list", "Call patients who need to return", "Document the calls in the patient file"])),
	("Medical Administration", "General Practitioner", "Complete discharge summaries - Medical Ward B", "Discharge", "Medium", "done", -2, -1, dict(note="All six summaries signed and handed to Admission & Discharge.")),
	("Medical Administration", "General Practitioner", "Diabetes clinic follow-up calls for missed appointments", "Follow-up", "Low", "todo", 1, 4, {}),
	("Medical Administration", "Clinical-Consultant", "Pre-operative assessment for tomorrow's elective surgery list", "Pre-Operative", "Urgent", "progress", 0, 0,
		dict(checklist=["Anaesthesia review", "Consent forms signed", "Blood cross-matched", "Fasting instructions given"], done=1)),
	("Medical Administration", "Clinical-Consultant", "Second opinion requested - complicated pneumonia, ICU bed 3", "Consultation", "Urgent", "todo", 0, 0, {}),
	("Medical Administration", "Clinical-Consultant", "Review antibiotic prescribing against the hospital guideline", "Medication Review", "Medium", "review", -5, 2, dict(note="Audit of 40 files finished; report is with the Medical Director.")),
	("Medical Administration", "Clinical-Consultant", "Elective caesarean section - theatre 2", "Surgery", "High", "done", -1, -1, {}),
	("Medical Administration", "Registrar", "Prepare case presentation for the Thursday grand round", None, "Low", "todo", 3, 6, {}),
	("Medical Administration", "Registrar", "ICU evening round and handover notes", "Ward Round", "High", "todo", 0, 0, {}),
	("Medical Administration", "Laboratory Technician", "Run daily quality control on the chemistry analyser", "Lab Review", "High", "done", 0, 0,
		dict(checklist=["Level 1 control", "Level 2 control", "Record results in the QC log"], done=3)),
	("Medical Administration", "Laboratory Technician", "Clear the backlog of culture and sensitivity reports", "Lab Review", "High", "progress", -2, 0, dict(note="14 of 23 reports released.")),
	("Medical Administration", "Laboratory Technician", "Reagent stock count and reorder list", None, "Medium", "blocked", -4, -1, dict(why="Waiting for the supplier's price list for haematology reagents.")),
	("Medical Administration", "Laboratory Technician", "Blood bank: check expiry dates of stored units", None, "High", "todo", 0, 1, {}),
	("Medical Administration", "Pharmacy Clerk", "Ward stock top-up: Maternity, Paediatrics and ICU", None, "High", "progress", 0, 0,
		dict(checklist=["Maternity", "Paediatrics", "ICU"], done=1)),
	("Medical Administration", "Pharmacy Clerk", "Remove expired and near-expiry medicines from the shelves", "Medication Review", "Medium", "todo", 1, 3, {}),
	("Medical Administration", "Pharmacy Clerk", "Controlled drugs register: weekly reconciliation", "Medication Review", "High", "review", -1, 0, {}),
	("Medical Administration", "Radiology Technician", "Report the pending CT scans from the weekend", None, "High", "progress", -1, 0, dict(assign=1)),
	("Medical Administration", "Radiology Technician", "Monthly radiation dose badge collection", None, "Low", "todo", 4, 9, {}),
	("Medical Administration", "Radiology Technician", "Portable X-ray requests - ICU and NICU", None, "High", "done", 0, 0, dict(assign=1)),
	("Medical Administration", "Infection Control", "Hand hygiene compliance audit - surgical ward", None, "Medium", "progress", -1, 2,
		dict(checklist=["Observe 30 opportunities", "Record on the audit form", "Give feedback to the ward"], done=1)),
	("Medical Administration", "Infection Control", "Investigate two surgical site infections reported this week", None, "Urgent", "todo", 0, 1, {}),
	("Medical Administration", "Medical Records Clerk", "File loose lab results into patient folders", None, "Low", "todo", 0, 3, {}),
	("Medical Administration", "Medical Records Clerk", "Retrieve files for tomorrow's cardiology clinic", None, "Medium", "done", -1, -1, {}),
	# ------------------------------------------------------------------ Nursing
	("Nursing Service Department", None, "Prepare the nursing duty roster for next month", None, "High", "progress", -3, 4, dict(note="Night shift cover for Maternity still open.")),
	("Nursing Service Department", None, "Mandatory BLS refresher: schedule the remaining nurses", None, "Medium", "todo", 2, 12, {}),
	("Nursing Service Department", "Staff Nurse", "Vital signs and medication round - 14:00, Medical Ward A", "Medication Review", "High", "todo", 0, 0, {}),
	("Nursing Service Department", "Staff Nurse", "Pressure ulcer risk assessment for all bedridden patients", "Treatment Review", "High", "progress", 0, 1,
		dict(checklist=["Medical Ward A", "Medical Ward B", "Surgical Ward", "ICU"], done=2)),
	("Nursing Service Department", "Staff Nurse", "Shift handover: complete the SBAR forms for the night team", None, "Medium", "todo", 0, 0, {}),
	("Nursing Service Department", "Staff Nurse", "Check and restock the emergency crash carts", None, "Urgent", "done", -1, -1,
		dict(checklist=["Defibrillator test", "Emergency drugs complete and in date", "Oxygen cylinder full", "Sign the checklist"], done=4)),
	("Nursing Service Department", "Staff Nurse", "Discharge teaching for post-operative patients - Surgical Ward", "Discharge", "Medium", "review", 0, 0, {}),
	("Nursing Service Department", "Staff Nurse", "Fall risk bracelets missing on four patients - Ward B", "Follow-up", "High", "todo", -2, -1, {}),
	("Nursing Service Department", "Staff Midwife", "Antenatal clinic: high-risk mothers follow-up list", "Follow-up", "High", "progress", 0, 1, {}),
	("Nursing Service Department", "Staff Midwife", "Check the neonatal resuscitation corner in the labour room", None, "Urgent", "done", 0, 0, {}),
	("Nursing Service Department", "Staff Midwife", "Partograph audit for last week's deliveries", None, "Medium", "todo", 1, 5, {}),
	("Nursing Service Department", "Scrub Nurse", "Prepare theatre 1 for tomorrow's orthopaedic list", "Pre-Operative", "High", "todo", 0, 0,
		dict(checklist=["Instrument sets from CSSD", "Implants confirmed with the surgeon", "Swab and instrument count sheets ready"])),
	("Nursing Service Department", "Scrub Nurse", "WHO surgical safety checklist compliance - weekly review", None, "Medium", "review", -4, 0, {}),
	("Nursing Service Department", "CSSD Technician", "Autoclave biological indicator test", None, "High", "done", 0, 0, {}),
	("Nursing Service Department", "CSSD Technician", "Sterilise and pack the delivery sets for the labour room", None, "High", "progress", 0, 0, {}),
	("Nursing Service Department", "Nurse Supervisor", "Night supervision round and incident report review", "Ward Round", "Medium", "todo", 0, 1, {}),
	("Nursing Service Department", "Nurse Supervisor", "Bed occupancy report to the Medical Director", "Bed Management", "Medium", "done", -1, -1, {}),
	# ------------------------------------------------------------------ Facility
	("Facility Department", None, "Generator B: 500-hour service", None, "High", "blocked", -6, -2, dict(why="Oil filters are out of stock; purchase request sent to Finance.")),
	("Facility Department", None, "Water tank cleaning and chlorination", None, "Medium", "todo", 3, 4, {}),
	("Facility Department", "Housekeeping Staff", "Terminal cleaning of isolation room 2 after discharge", None, "Urgent", "progress", 0, 0,
		dict(checklist=["Remove linen and waste", "Clean all surfaces with chlorine solution", "Mop the floor", "Infection Control sign-off"], done=2)),
	("Facility Department", "Housekeeping Staff", "Deep clean of the operating theatres - weekly", None, "High", "todo", 1, 1, {}),
	("Facility Department", "Housekeeping Staff", "Refill hand sanitiser dispensers on all floors", None, "Medium", "done", 0, 0, {}),
	("Facility Department", "Housekeeping Staff", "Medical waste collection from wards to the incinerator", None, "High", "progress", 0, 0, {}),
	("Facility Department", "Security Guard", "Visitor control during visiting hours - main gate and wards", None, "Medium", "progress", 0, 0, {}),
	("Facility Department", "Security Guard", "Night patrol log: check the perimeter lights", None, "Low", "todo", 0, 1, {}),
	("Facility Department", "Security Guard", "Fire extinguisher monthly inspection", None, "High", "todo", -3, -1,
		dict(checklist=["Ground floor", "First floor", "Second floor", "Kitchen and generator room"])),
	("Facility Department", "General facilities", "Repair the leaking pipe in the Paediatric ward bathroom", None, "High", "progress", -1, 0, {}),
	("Facility Department", "General facilities", "Replace broken bed side rails - Medical Ward B", None, "Medium", "todo", 0, 3, {}),
	("Facility Department", "Driver", "Ambulance 2: service and refuel", None, "High", "done", -1, -1, {}),
	("Facility Department", "Driver", "Ambulance daily checklist", None, "High", "todo", 0, 0,
		dict(checklist=["Oxygen cylinder", "Stretcher and straps", "First aid kit", "Fuel and tyres"])),
	("Facility Department", "CCTV Operator", "Camera 14 (pharmacy corridor) is offline", None, "High", "todo", -1, 0, {}),
	("Facility Department", "laundry", "Collect and wash theatre linen - twice daily", None, "Medium", "progress", 0, 0, {}),
	("Facility Department", "Electrician", "Check the UPS batteries for the ICU and theatre circuits", None, "Urgent", "review", -2, 0, {}),
	("Facility Department", "Electrician", "Replace faulty lights in the OPD waiting area", None, "Low", "done", -3, -2, {}),
	# ------------------------------------------------------------------ Finance
	("Finance", None, "Month-end closing: October accounts", None, "High", "review", -8, 0, dict(note="Trial balance agreed; waiting for the CFO's sign-off.")),
	("Finance", None, "Prepare the 2027 departmental budget templates", None, "Medium", "todo", 3, 14, {}),
	("Finance", "Cashier", "Daily cash count and bank deposit", None, "High", "done", 0, 0, dict(checklist=["Count the tills", "Match with the system report", "Prepare the deposit slip"], done=3)),
	("Finance", "Cashier", "Investigate the shortage in the night shift cash report", None, "Urgent", "progress", -1, 0, {}),
	("Finance", "Cashier", "Refund requests waiting for approval", None, "Medium", "todo", 0, 2, {}),
	("Finance", "Admission & Discharge Officer", "Clear the pending discharge bills - Surgical Ward", "Discharge", "High", "progress", 0, 0, {}),
	("Finance", "Admission & Discharge Officer", "Verify insurance approvals for today's admissions", None, "High", "todo", 0, 0, {}),
	("Finance", "Credit Offficer", "Follow up overdue credit accounts over 60 days", "Follow-up", "High", "todo", -5, -1, {}),
	("Finance", "Purchasing", "Quotation comparison for surgical gloves and syringes", None, "Medium", "review", -3, 1, {}),
	("Finance", "Purchasing", "Purchase order: oil filters for generator B", None, "High", "progress", -2, 0, {}),
	("Finance", "Storekeeper", "Quarterly stock count - main medical store", None, "High", "todo", 2, 6,
		dict(checklist=["Freeze issues during the count", "Count consumables", "Count medicines", "Reconcile differences with the system"])),
	("Finance", "Storekeeper", "Receive and shelve the IV fluids delivery", None, "Medium", "done", -1, -1, {}),
	# ------------------------------------------------------------------ Management
	("Management", None, "Weekly heads of department meeting: prepare the agenda", None, "Medium", "todo", 1, 2, {}),
	("Management", None, "Review the patient complaints summary for October", None, "High", "progress", -2, 1, dict(assign=1)),
	("Management", None, "Approve the leave plan for the end-of-year period", None, "Medium", "review", -4, 2, {}),
	("Management", None, "Ministry of Health licence renewal documents", None, "Urgent", "todo", 0, 7,
		dict(checklist=["Facility inspection report", "Staff licence copies", "Fee payment receipt", "Submit the application"])),
	("Management", "IT Manager", "Plan the downtime for the hospital system upgrade", None, "High", "todo", 2, 9, {}),
	# ------------------------------------------------------------------ Patient Relation
	("Patient Relation", None, "Call back patients who left a complaint this week", "Follow-up", "High", "progress", -1, 1, dict(note="9 of 15 patients reached.")),
	("Patient Relation", None, "Patient satisfaction survey - OPD, 50 forms", None, "Medium", "todo", 0, 5, {}),
	("Patient Relation", None, "Guide relatives during ICU visiting hours", None, "Low", "done", 0, 0, {}),
	("Patient Relation", None, "Update the waiting area information boards", None, "Low", "todo", 2, 6, {}),
	# ------------------------------------------------------------------ Laboratory is part of Medical Administration; next the support departments
	("Marketing", None, "World Diabetes Day free screening campaign", None, "High", "progress", -5, 1,
		dict(checklist=["Banner and posters printed", "Radio announcement booked", "Screening desk and staff arranged", "Social media posts scheduled"], done=3)),
	("Marketing", "Digital Marketing", "Publish the new cardiology clinic schedule on social media", None, "Medium", "todo", 0, 1, {}),
	("Marketing", "Digital Marketing", "Reply to patient enquiries on Facebook and WhatsApp", None, "Medium", "progress", 0, 0, {}),
	("Marketing", "Sales Representative", "Visit corporate clients about staff health check packages", None, "Medium", "todo", 1, 8, {}),
	("Marketing", "Sales Representative", "Renew referral agreements with partner clinics", "Follow-up", "High", "review", -6, 0, {}),
	("Board Members", None, "Quarterly board meeting: circulate the board pack", None, "High", "todo", 4, 10, {}),
	("Board Members", "Board Member", "Review the proposal for the new dialysis unit", None, "High", "progress", -7, 7, {}),
	("Board Members", "Board Member", "Approve the audited financial statements", None, "Medium", "done", -10, -4, {}),
	("Total Quality Management", None, "Internal audit: medication storage in all wards", None, "High", "progress", -2, 3,
		dict(checklist=["Maternity", "Paediatrics", "Medical wards", "Surgical ward", "ICU"], done=2)),
	("Total Quality Management", None, "Update the incident reporting policy", None, "Medium", "review", -9, 0, {}),
	("Total Quality Management", "Quality Control Officer", "Root cause analysis: patient fall in Medical Ward B", None, "Urgent", "todo", 0, 2, {}),
	("Total Quality Management", "Quality Control Officer", "Monthly quality indicators report", None, "Medium", "todo", 2, 7, {}),
	("Total Quality Management", "Nutritionist", "Diet plans for newly admitted diabetic patients", "Treatment Review", "High", "progress", 0, 0, {}),
	("Total Quality Management", "Nutritionist", "Kitchen hygiene inspection", None, "Medium", "done", -2, -2, {}),
	("Information Technology (IT)", None, "Daily backup check of the hospital system", None, "High", "done", 0, 0, {}),
	("Information Technology (IT)", "IT Technician", "Label printer in the laboratory is not printing barcodes", None, "High", "progress", 0, 0, {}),
	("Information Technology (IT)", "IT Technician", "Set up user accounts for the new nurses", None, "Medium", "todo", 0, 2, {}),
	("Information Technology (IT)", "IT Technician", "Replace the network switch on the second floor", None, "Medium", "blocked", -5, -1, dict(why="New switch has not arrived from the supplier.")),
	("Head of BME", None, "Preventive maintenance plan for Q1 2027", None, "Medium", "todo", 3, 15, {}),
	("Head of BME", None, "Ventilator 3 in the ICU: alarm fault", None, "Urgent", "progress", 0, 0, dict(note="Flow sensor replaced; running a 2-hour test before returning it to the ICU.")),
	("Head of BME", "PME", "Calibrate the infusion pumps - Paediatric ward", None, "High", "todo", 0, 2, dict(checklist=["Pump 1", "Pump 2", "Pump 3", "Update the calibration stickers"])),
	("Head of BME", "PME", "Patient monitors: monthly preventive maintenance", None, "Medium", "done", -3, -1, {}),
	("Nabadoon", None, "Prepare the weekly Nabadoon clinic patient list", None, "Medium", "todo", 0, 1, {}),
	("Nabadoon", None, "Follow up referred patients from the outreach visit", "Follow-up", "Medium", "progress", -2, 2, {}),
	("Operations", None, "Daily bed status report at 08:00", "Bed Management", "High", "done", 0, 0, {}),
	("Operations", None, "Coordinate oxygen cylinder delivery with the supplier", None, "Urgent", "progress", 0, 0, {}),
	("Operations", None, "Review the OPD patient flow and waiting times", None, "Medium", "todo", 1, 6, {}),
	("HRD", None, "Onboarding of the new nurses starting on Monday", None, "High", "progress", -1, 3,
		dict(checklist=["Contracts signed", "Staff ID cards", "Orientation schedule", "System accounts requested from IT"], done=2)),
	("HRD", None, "Collect expired professional licences for renewal", "Follow-up", "Medium", "todo", -4, -1, {}),
	("HRD", None, "November payroll: attendance sheet verification", None, "High", "todo", 2, 8, {}),
]


def create_demo_tasks():
	from frappe.desk.doctype.tag.tag import add_tag
	from task_management.task_management import api

	frappe.flags.mute_emails = True
	today = nowdate()
	made = skipped = 0
	for main, sub, subject, ttype, priority, column, start, due, extra in T:
		if frappe.db.exists("Task", {"subject": subject}):
			skipped += 1
			continue
		team = sub if sub and frappe.db.exists("Task Team", {"name": sub, "disabled": 0}) else main
		if not frappe.db.exists("Task Team", team):
			team = None
		data = {
			"subject": subject,
			"type": ttype if ttype and frappe.db.exists("Task Type", ttype) else None,
			"priority": priority,
			"tm_team": team,
			"department": frappe.db.get_value("Task Team", team, "department") if team else None,
			"exp_start_date": add_days(today, start),
			"exp_end_date": add_days(today, due),
			"checklist": extra.get("checklist") or [],
		}
		if extra.get("why"):
			data["tm_blocked_reason"] = extra["why"]
		if extra.get("assign") and team:
			users = frappe.get_all("Task Team Member", filters={"parent": team, "user": ("is", "set")}, pluck="user", limit=1)
			if users:
				data["assignees"] = users
		name = api.save_task(frappe.as_json(data))
		for row in frappe.get_all("Task Checklist Item", filters={"parent": name}, pluck="name", order_by="idx")[: extra.get("done") or 0]:
			api.checklist_toggle(row, 1)
		if column != "todo":
			api.move_task(name, column)
		if column == "done":
			frappe.db.set_value("Task", name, "completed_on", add_days(today, min(due, 0)), update_modified=False)
		if extra.get("note"):
			api.add_comment(name, extra["note"])
		add_tag(TAG, "Task", name)
		made += 1
	frappe.db.commit()
	print("{0} demo task(s) created, {1} already there".format(made, skipped))
	return {"created": made, "skipped": skipped}


def remove_demo_tasks():
	names = frappe.get_all("Task", filters={"_user_tags": ("like", "%" + TAG + "%")}, pluck="name")
	for name in names:
		frappe.delete_doc("Task", name, force=1, ignore_permissions=True)
	frappe.db.commit()
	print("{0} demo task(s) removed".format(len(names)))
	return len(names)
