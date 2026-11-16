// Copyright (c) 2026, Hodan Hospital
frappe.query_reports["QC Records"] = {
	filters: [
		{ fieldname: "record_type", label: __("Type"), fieldtype: "Select", options: "\nNon-Clinical Complaint\nClinical Complaint\nManagement Meeting\nRound Audit" },
		{ fieldname: "state", label: __("In tracker"), fieldtype: "Select", options: "Live and archived\nLive\nArchived\nDeleted\nAll", default: "Live and archived" },
		{ fieldname: "from_date", label: __("From"), fieldtype: "Date" },
		{ fieldname: "to_date", label: __("To"), fieldtype: "Date" },
		{ fieldname: "search", label: __("Search (number, PID, text)"), fieldtype: "Data" },
	],
};
