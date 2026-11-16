// Copyright (c) 2026, Hodan Hospital
frappe.ui.form.on("QC Settings", {
	refresh(frm) {
		frm.add_custom_button(__("Open Quality Control Tracker"), () => frappe.set_route("qc-tracker"));
		frm.add_custom_button(__("Archive old records"), () => qc_archive_dialog(false), __("Archive"));
		frm.add_custom_button(__("Restore archived records"), () => qc_archive_dialog(true), __("Archive"));
		frm.add_custom_button(__("QC Records report"), () => frappe.set_route("query-report", "QC Records"), __("Archive"));
	},
});

function qc_archive_dialog(restore) {
	const d = new frappe.ui.Dialog({
		title: restore ? __("Restore archived records") : __("Archive old records"),
		fields: [
			{ fieldtype: "HTML", options: restore
				? `<p class="text-muted">Archived records dated before this date come back into the tracker.</p>`
				: `<p class="text-muted">Records dated before this date are hidden from the tracker so it stays fast. Nothing is deleted: every record keeps its number and can be found in the <b>QC Records</b> report and restored here.</p>` },
			{ fieldname: "before_date", fieldtype: "Date", label: __("Before date"), reqd: 1, default: frappe.datetime.add_months(frappe.datetime.get_today(), -6) },
			...(restore ? [] : [{ fieldname: "only_closed", fieldtype: "Check", label: __("Only closed / completed items"), default: 1 }]),
			{ fieldname: "include_clinical", fieldtype: "Check", label: __("Include clinical complaints"), default: restore ? 1 : 0 },
			{ fieldname: "include_meetings", fieldtype: "Check", label: __("Include management meetings"), default: restore ? 1 : 0 },
		],
		primary_action_label: __("Check how many"),
		primary_action(v) {
			const method = restore ? "task_management.quality_control.api.restore_records" : "task_management.quality_control.api.archive_records";
			frappe.call({ method, args: Object.assign({}, v, { dry_run: 1 }) }).then((r) => {
				const n = (r.message || {}).count || 0;
				if (!n) { frappe.msgprint(__("No records match.")); return; }
				frappe.confirm(restore ? __("Restore {0} records?", [n]) : __("Archive {0} records? They stay searchable and can be restored.", [n]), () => {
					frappe.call({ method, args: Object.assign({}, v, { dry_run: 0 }), freeze: true }).then((r2) => {
						d.hide();
						frappe.show_alert({ message: (restore ? __("Restored {0} records") : __("Archived {0} records")).replace("{0}", (r2.message || {}).count || 0), indicator: "green" });
					});
				});
			});
		},
	});
	d.show();
}
