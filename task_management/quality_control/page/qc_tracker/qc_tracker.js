// Copyright (c) 2026, Hodan Hospital
// Quality Control Tracker inside ERPNext. The tracker keeps its own look and runs in a frame on this page,
// using the signed-in ERPNext user (roles QC User / QC Manager).
frappe.pages["qc-tracker"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Quality Control Tracker"), single_column: true });
	const $w = $(wrapper);
	$w.find(".page-head").hide();
	$w.find(".page-body").removeClass("container").css({ "max-width": "none", padding: 0 });
	$w.find(".layout-main-section-wrapper, .layout-main-section").css({ padding: 0, margin: 0, border: 0, "box-shadow": "none" });
	const $body = $(page.body).css({ padding: 0, margin: 0 });
	$body.html(`<div class="text-muted" style="padding:24px">${__("Loading Quality Control Tracker…")}</div>`);

	const frame = document.createElement("iframe");
	frame.title = "Quality Control Tracker";
	frame.setAttribute("allow", "clipboard-write; camera");
	frame.style.cssText = "display:block;width:100%;border:0;background:#fff";
	const fit = () => {
		const top = frame.getBoundingClientRect().top + window.scrollY;
		frame.style.height = Math.max(480, window.innerHeight - top) + "px";
	};
	window.addEventListener("resize", fit);
	wrapper.qc_fit = fit;

	frappe
		.call({ method: "task_management.quality_control.api.tracker_html" })
		.then((r) => {
			$body.empty().append(frame);
			frame.srcdoc = r.message;
			setTimeout(fit, 0);
		});
};

frappe.pages["qc-tracker"].on_page_show = function (wrapper) {
	if (wrapper.qc_fit) setTimeout(wrapper.qc_fit, 50);
};
