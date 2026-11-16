# Copyright (c) 2026, Hodan Hospital
"""Round audit checklists as they were in the Google Sheets tracker page.

Copied ONCE into QC Settings (install / patch seed_audit_checklists). After that QC Managers keep them
up to date in QC Settings or with "Edit checklist" on the Round Audits tab; the page has no checklists of its own.
"""

GENERAL = [
	"Area clean and tidy; no waste or clutter",
	"Staff present per roster and in correct uniform",
	"Hand hygiene supplies available and used",
	"Required records and logbooks up to date and signed",
	"Equipment working; faults reported",
	"Fire exits clear; safety signage visible",
	"Policies and SOPs available to staff",
	"Waste segregated correctly"
]

BY_DEPARTMENT = {
	"Emergency": ["Triage done and time recorded for every patient", "Crash trolley complete, checked and signed", "Oxygen, suction and defibrillator ready", "Urgent cases seen by doctor within 30 minutes", "Patient files complete (history, plan, signature)", "Hand hygiene supplies and PPE available", "Area clean; sharps and waste segregated"],
	"Anesthesia": ["Anesthesia consent signed for every case today", "Pre-anesthesia assessment documented", "Anesthesia machine checked before first case", "Oxygen, suction and backup cylinder working", "Emergency drugs tray complete and in date", "Difficult airway trolley complete", "Monitors working", "Anesthesia record chart filled for each case", "Controlled drugs register matches stock", "Recovery observations and discharge criteria documented"],
	"Operating Theatre": ["Surgery register updated; matches today's list", "WHO Surgical Safety Checklist done for every case", "Surgical consent signed for every case", "Swab, needle and instrument counts documented", "Sterile packs labelled and in date", "Cleaning between cases and terminal clean logged", "Temperature and humidity recorded", "Staff in correct theatre attire", "Specimens labelled and logged", "Clinical waste and sharps separated"],
	"CSSD": ["Autoclave cycle log complete", "Chemical indicator on every pack", "Dirty and clean areas separate", "Sterile store clean, dry, packs in date"],
	"Nursing": ["Nursing rounds and vital signs signed each shift", "Shift handover done", "Medication chart signed with time, no gaps", "ID band on every admitted patient", "Allergies written on file and chart", "Fall and pressure-sore risk assessed", "IV lines and catheters labelled with date", "Hand hygiene observed in 3 to 5 staff", "Ward clean, linen clean, bins not overflowing", "Crash trolley checked and signed", "Staffing matches roster", "Patients asked about concerns"],
	"Laboratory": ["Internal QC run before patient samples", "All samples labelled correctly", "Sample rejection log kept", "Urgent results within 1 hour", "Critical results phoned and logged", "Fridge and freezer temperatures recorded", "Blood bank stock, expiry and cross-match records", "PPE worn; no food in lab", "Biohazard waste disposed correctly", "Tests done match bills raised"],
	"Pharmacy": ["Prescriptions complete and signed", "Dispensing labels clear", "Fridge 2–8 °C recorded twice daily", "Room below 25 °C", "Controlled drugs register correct", "Look-alike drugs separated and labelled", "Stock-outs of essential medicines reported", "Unfilled prescriptions logged with reason"],
	"OPD": ["Patients registered with correct details", "Clinics started on time", "E-prescriptions sent to in-house pharmacy", "Waiting area clean and seated", "Feedback box available"],
	"Radiology": ["Request forms complete; patient identified", "Reports signed", "Radiation signs and lead aprons in place", "Equipment working"],
	"IPC Unit": ["Hand hygiene supplies in every area", "Isolation signs on infectious patients", "PPE available", "Sharps boxes not over 3/4 full", "Linen and pillow covers to standard"],
	"Facility": ["Generator fuel and run log; backup power working", "Water supply; toilets and sinks working", "Oxygen supply checked", "AC units clean and working", "Fire exits clear and unlocked", "Broken items entered in maintenance log", "Pest control up to date"],
	"Biomedical Engineering": ["Equipment inventory tagged and up to date", "Planned preventive maintenance done on schedule", "Faulty equipment labelled out of service", "Calibration stickers valid", "Breakdown requests answered within target", "Defibrillators, suction and monitors tested", "Service contracts and manuals available"],
	"Finance": ["Bills match services delivered", "Cashier reconciled daily", "Receipts issued for every payment", "Price list displayed for patients", "Billing complaints logged and answered", "Insurance and credit claims submitted on time"],
	"Cleaning Unit": ["Cleaning schedule signed for each area", "Toilets cleaned at least 3 times a day", "Colour-coded mops and cloths used", "Chemicals labelled and stored safely", "Bins emptied, not overflowing", "Toilet shoes and slippers clean"],
	"Medical Administration": ["Doctor duty roster posted; on-call reachable", "Doctors' ward rounds documented", "Admission, discharge and death notes complete", "Incident reports reviewed within 24 hours", "QC red items acknowledged"],
	"IT": ["Hospital system and billing running", "Daily backup completed", "Network working in key areas", "Support tickets followed up", "Computers locked when unattended"],
	"Kitchen": ["Food handlers in hair covers and aprons", "Food stored at correct temperature", "Patient diets delivered on time", "Kitchen clean; pest-free", "Food handlers' medical certificates valid"],
	"Laundry": ["Dirty and clean linen kept separate", "Soiled linen handled with gloves", "Linen stock enough for all wards", "Washing machines working"],
	"Security": ["Guards at gates per roster", "Visitor control in wards", "CCTV working", "Incident log up to date"],
	"Human Resources": ["Staff files complete", "Licences and certificates valid", "Attendance records up to date", "New staff oriented"],
	"Procurement & Stores": ["Stock records match physical count", "No expired items in store", "Requests supplied on time", "Store clean, dry and secure"],
	"Patient Relations": ["Complaints logged with date and response", "Complaints answered within 72 hours", "Patient satisfaction survey done", "Help desk staffed"],
}

# old checklist name -> ERPNext department name(s) (department_name) it belongs to.
# Names not listed here are looked up as they are.
ERPNEXT_NAMES = {
	"Emergency": ["Emergency Room", "NSD - Emergency Room"],
	"Anesthesia": ["Anesthesiology"],
	"Operating Theatre": ["NSD - Operating Room"],
	"CSSD": ["NSD - CSSD"],
	"Nursing": ["Nursing Service Department"],
	"OPD": ["NSD - OPD"],
	"IPC Unit": ["Infection control"],
	"Biomedical Engineering": ["Head of BME"],
	"Cleaning Unit": ["Housekeeping"],
	"IT": ["Information Technology (IT)"],
	"Human Resources": ["HRD"],
	"Procurement & Stores": ["Purchasing & Store"],
	"Patient Relations": ["Patient Relation"],
}
