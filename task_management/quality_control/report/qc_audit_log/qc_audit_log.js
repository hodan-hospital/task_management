// Copyright (c) 2026, Hodan Hospital
frappe.query_reports["QC Audit Log"] = {
	filters: [
		{ fieldname: "from_date", label: __("From"), fieldtype: "Date" },
		{ fieldname: "to_date", label: __("To"), fieldtype: "Date" },
		{ fieldname: "search", label: __("Search (number or text)"), fieldtype: "Data" },
	],
};
