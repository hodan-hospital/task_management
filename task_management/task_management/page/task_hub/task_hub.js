// Copyright (c) 2026, Hodan Hospital
// Task Management hub — one desk page (/app/task-hub) with its own rail, sidebar and views.
// Server side: task_management/task_management/api.py
frappe.provide("task_management");

frappe.pages["task-hub"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({ parent: wrapper, title: __("Task Management"), single_column: true });
	wrapper.task_hub = new task_management.TaskHub(wrapper);
};

frappe.pages["task-hub"].on_page_show = function (wrapper) {
	wrapper.task_hub && wrapper.task_hub.on_show();
};

(function () {
	const API = "task_management.task_management.api.";
	const COLS = {
		todo: { label: __("To Do"), color: "#94a3b8" },
		progress: { label: __("In Progress"), color: "#f19f21" },
		review: { label: __("In Review"), color: "#f2b705" },
		blocked: { label: __("Blocked"), color: "#e5484d" },
		done: { label: __("Completed"), color: "#22a55b" },
	};
	const COL_ORDER = ["todo", "progress", "review", "blocked", "done"];
	const LEGEND_ORDER = ["done", "progress", "review", "todo", "blocked"];
	const PRIORITIES = ["Urgent", "High", "Medium", "Low"];
	const TABS = [
		["tasks", __("Tasks")],
		["overview", __("Overview")],
		["files", __("Files")],
	]; // Calendar and Reports are not tabs here: they have their own pages in the sidebar
	const MY_KINDS = {
		tasks: { label: __("My Tasks"), icon: "tasks" },
		followups: { label: __("Follow-ups"), icon: "refresh" },
		overdue: { label: __("Overdue"), icon: "alert" },
	};
	// rounds and handovers are parked for now: their items are kept out of every list on this page
	const taskOnly = (a) => !["Clinical Round", "Task Handover"].includes(a.reference_doctype);
	const HIS_HANDOVER_FORMS = ["Nursing Handover", "Doctor Handover Form", "PATIENT HANDOVER", "DAILY HANDOVER SHEET"];
	const PALETTE = ["#f19f21", "#3b82f6", "#22a55b", "#8b5cf6", "#e5484d", "#0ea5a4", "#64748b", "#db2777", "#4f46e5", "#65a30d"];

	// ------------------------------------------------------------------ small helpers
	const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
	const hash = (s) => {
		let h = 0;
		for (const c of String(s || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
		return h;
	};
	const colorOf = (s) => PALETTE[hash(s) % PALETTE.length];
	const fmtDay = (d) => (d ? moment(d).format("MMM D") : "");
	const fmtDate = (d) => (d ? moment(d).format("MMM D, YYYY") : "—");
	const ago = (d) => (d ? frappe.datetime.prettyDate(d) : "");
	const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
	const fileSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round((n || 0) / 1024)) + " KB");

	// chat text is escaped first; then web addresses become links
	const linkify = (s) => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
	const EMOJI = ["😀", "😂", "😊", "😍", "🙂", "😉", "😎", "🤔", "😢", "😡", "😴", "🤒", "👍", "👎", "👏", "🙏", "💪", "🤝", "👋", "✌️", "❤️", "🔥", "⭐", "🎉", "✅", "❌", "⚠️", "❗", "❓", "⏰", "📌", "📎", "📞", "💊", "🩺", "🏥", "🚑", "🧪", "💉", "📋"];
	const PREF_DEFAULTS = { theme: "light", density: "comfortable", start: "dashboard", enter: true };

	function call(method, args) {
		return new Promise((resolve, reject) => {
			frappe.call({
				method: API + method,
				args: args || {},
				callback: (r) => resolve(r.message),
				error: (e) => reject(e || new Error(method)),
			});
		});
	}

	const ICONS = {
		home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
		bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
		chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
		users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5a5 5 0 0 1 4.5 5"/>',
		user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
		tasks: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="m9 13 2 2 4-4"/>',
		calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
		chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
		settings:
			'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
		search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
		sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
		smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
		x: '<path d="M6 6l12 12M18 6 6 18"/>',
		blank: " ", // keeps menu labels aligned when only one row carries a tick
		check: '<path d="m5 12 5 5 9-10"/>',
		checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
		circle: '<circle cx="12" cy="12" r="9"/>',
		alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
		clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
		arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
		arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
		equals: '<path d="M5 9h14M5 15h14"/>',
		filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
		list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
		board: '<rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="13" rx="1"/>',
		timeline: '<path d="M4 6h10M8 12h12M4 18h8"/>',
		star: '<path d="m12 3 2.7 5.6 6.3.9-4.5 4.3 1 6.2-5.5-3-5.5 3 1-6.2L3 9.5l6.3-.9z"/>',
		dots: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
		chevDown: '<path d="m6 9 6 6 6-6"/>',
		chevRight: '<path d="m9 6 6 6-6 6"/>',
		chevLeft: '<path d="m15 6-6 6 6 6"/>',
		file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
		clip: '<path d="M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7"/>',
		send: '<path d="M21 3 3 10.5l7 2.5 2.5 7z"/><path d="m10 13 5-5"/>',
		bed: '<path d="M3 18V6M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="10.5" r="1.5"/>',
		pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
		swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
		refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
		external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
		userPlus: '<circle cx="10" cy="8" r="4"/><path d="M2 21a8 8 0 0 1 13-6.2"/><path d="M19 14v6M16 17h6"/>',
		help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
		wrench: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L3 18l3 3 6.2-6.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-2.5z"/>',
		edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
		trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
		download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
		upload: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
		folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
		trend: '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
		flag: '<path d="M5 21V4M5 4h12l-2 4 2 4H5"/>',
		grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
	};
	const icon = (name, cls) =>
		`<svg class="tm-i ${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.circle}</svg>`;

	const PRIORITY_ICON = { Urgent: "alert", High: "arrowUp", Medium: "equals", Low: "arrowDown" };
	const priorityPill = (p) =>
		p ? `<span class="tm-prio tm-prio-${esc(p.toLowerCase())}">${icon(PRIORITY_ICON[p] || "equals")}${esc(__(p))}</span>` : "";
	const typeTag = (t) => (t ? `<span class="tm-tag" style="--tag:${colorOf(t)}">${esc(t)}</span>` : "");
	const statusPill = (col) => `<span class="tm-status tm-status-${col}">${esc(COLS[col].label)}</span>`;
	const genericPill = (text, tone) => `<span class="tm-pill tm-pill-${tone || "grey"}">${esc(__(text))}</span>`;
	const TONES = {
		Scheduled: "blue", "In Progress": "orange", Completed: "green", Cancelled: "grey",
		Pending: "orange", Acknowledged: "blue", Open: "orange",
	};
	const empty = (title, sub, action) =>
		`<div class="tm-empty">${icon("folder")}<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}${action || ""}</div>`;

	// ------------------------------------------------------------------ charts (inline SVG, no dependency)
	function donut(segments, centre, label) {
		const total = segments.reduce((s, x) => s + x.value, 0);
		const r = 42, c = 2 * Math.PI * r;
		let offset = 0;
		const arcs = total
			? segments
					.filter((s) => s.value)
					.map((s) => {
						const len = (s.value / total) * c;
						const el = `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${s.color}" stroke-width="13" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}"/>`;
						offset += len;
						return el;
					})
					.join("")
			: `<circle cx="60" cy="60" r="${r}" fill="none" stroke="#e8ebf0" stroke-width="13"/>`;
		return `<svg class="tm-donut" viewBox="0 0 120 120"><g transform="rotate(-90 60 60)">${arcs}</g>
			<text x="60" y="60" text-anchor="middle" class="tm-donut-n">${esc(centre)}</text>
			<text x="60" y="76" text-anchor="middle" class="tm-donut-l">${esc(label)}</text></svg>`;
	}

	// points: [{date, <key>: count}], series: [{key, label, color}] - one line per series, counts per day
	function trendChart(points, series) {
		if (!points || !points.length || !series.length) return empty(__("Nothing to show"));
		const W = 640, H = 230, L = 34, R = 12, T = 12, B = 26, n = points.length;
		const max = Math.max(4, ...points.map((p) => Math.max(...series.map((s) => p[s.key]))));
		const step = Math.max(1, Math.ceil(max / 4));
		const top = step * 4;
		const x = (i) => (n === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (n - 1));
		const y = (v) => T + (H - T - B) * (1 - v / top);
		const line = (key) => points.map((p, i) => `${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");
		let grid = "";
		for (let i = 0; i <= 4; i++) {
			const v = step * i;
			grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#eef0f3"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" class="tm-axis">${v}</text>`;
		}
		const every = Math.ceil(n / 8);
		const labels = points.map((p, i) => (i % every === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="tm-axis">${esc(fmtDay(p.date))}</text>` : "")).join("");
		// dots only where something happened, so a quiet month stays readable
		const draw = (s) => `${n > 1 ? `<polygon points="${x(0)},${y(0)} ${line(s.key)} ${x(n - 1)},${y(0)}" fill="${s.color}" fill-opacity=".07"/><polyline points="${line(s.key)}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>` : ""}
			${points.map((p, i) => (p[s.key] || n === 1 ? `<circle cx="${x(i).toFixed(1)}" cy="${y(p[s.key]).toFixed(1)}" r="${n === 1 ? 5 : 3}" fill="#fff" stroke="${s.color}" stroke-width="2"><title>${esc(fmtDay(p.date))} · ${esc(s.label)}: ${p[s.key]}</title></circle>` : "")).join("")}`;
		return `<svg class="tm-trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${series.map(draw).join("")}${labels}</svg>`;
	}

	function bars(rows, opts) {
		opts = opts || {};
		if (!rows.length) return `<div class="tm-muted tm-pad">${__("Nothing to show yet.")}</div>`;
		const max = Math.max(1, ...rows.map((r) => r.value));
		const legend = rows[0].parts ? `<div class="tm-legend-row tm-bar-legend">${rows[0].parts.map((p) => `<span><i style="background:${p.color}"></i>${esc(p.label)}</span>`).join("")}</div>` : "";
		const split = (r) => `<div class="tm-bar-row tm-bar-row-parts${r.parts.some((p) => p.sub) ? " tm-bar-row-notes" : ""}"><span class="tm-bar-ic" style="background:${r.color || colorOf(r.label)}">${icon(opts.icon || "users")}</span>
				<span class="tm-bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
				<span class="tm-bar-track"><span class="tm-bar-stack" style="width:${r.value ? Math.max(3, (100 * r.value) / max) : 0}%">${r.parts.map((p) => `<i style="flex:${p.value};background:${p.color}"></i>`).join("")}</span></span>
				<span class="tm-bar-parts">${r.parts.map((p) => `<span style="color:${p.color}"><b>${p.value}</b> ${esc(p.label)}</span>${p.sub ? `<span class="tm-bar-sub">(${p.sub.map((s) => `<span style="color:${s.color}"><b>${s.value}</b> ${esc(s.label)}</span>`).join(" · ")})</span>` : ""}`).join("")}</span>
				<b title="${__("Total")}">${r.value}</b></div>`;
		return `${legend}<div class="tm-bars">${rows
			.map(
				(r) => r.parts ? split(r) : `<div class="tm-bar-row"><span class="tm-bar-ic" style="background:${r.color || colorOf(r.label)}">${icon(opts.icon || "users")}</span>
				<span class="tm-bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
				<span class="tm-bar-track"><i style="width:${Math.max(3, (100 * r.value) / max)}%;background:${r.color || "#f19f21"}"></i></span>
				<b>${r.value}</b></div>`
			)
			.join("")}</div>`;
	}

	// <pdf-builder> printable report: plain tables and inline colours, because the PDF engine has no flex / grid
	function reportPdfHtml(r) {
		const e = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
		const INK = "#3b4449", ORANGE = "#f19f21";
		const kpis = r.kpis
			.map((k) => `<td class="kpi"><div class="kpi-in" style="border-top-color:${k.color}"><div class="kpi-v" style="color:${k.color}">${e(k.value)}</div><div class="kpi-l">${e(k.label)}</div></div></td>`)
			.join("");
		const section = (sec) => {
			const max = Math.max(1, ...sec.rows.map((x) => x.value));
			const split = (x) => `<tr><td class="b-l ${x.parts.some((p) => p.sub) ? "b-lm" : "b-ls"}">${e(x.label)}</td>
					<td class="b-t"><div class="track"><div class="stack" style="width:${x.value ? Math.max(2, Math.round((100 * x.value) / max)) : 0}%">${x.parts.map((p) => (p.value ? `<div class="seg" style="width:${(100 * p.value) / x.value}%;background:${p.color}"></div>` : "")).join("")}</div></div></td>
					<td class="b-p${x.parts.some((p) => p.sub) ? " b-pw" : ""}">${x.parts.map((p) => `<span style="color:${p.color}"><b>${e(p.value)}</b> ${e(p.label)}</span>${p.sub ? ` (${p.sub.map((s) => `<span style="color:${s.color}"><b>${e(s.value)}</b> ${e(s.label)}</span>`).join(" · ")})` : ""}`).join(" &nbsp; ")}</td>
					<td class="b-v">${e(x.value)}</td></tr>`;
			const legend = sec.rows[0] && sec.rows[0].parts ? `<span class="lg">${sec.rows[0].parts.map((p) => `<i style="background:${p.color}"></i>${e(p.label)}`).join(" &nbsp; ")}</span>` : "";
			const rows = sec.rows
				.map(
					(x) => x.parts ? split(x) : `<tr><td class="b-l">${e(x.label)}</td>
					<td class="b-t"><div class="track"><div class="fill" style="width:${x.value ? Math.max(2, Math.round((100 * x.value) / max)) : 0}%;background:${x.color}"></div></div></td>
					<td class="b-v">${e(x.value)}</td></tr>`
				)
				.join("");
			return `<div class="card"><div class="card-h">${e(sec.title)}${legend}</div><table class="bars">${rows || `<tr><td class="muted">${e(r.labels.nothing)}</td></tr>`}</table></div>`;
		};
		// r.rows: the cards of each line (two on the first line, then one full-width card per line)
		const grid = r.rows
			.map((line) => {
				const w = (100 - 2 * (line.length - 1)) / line.length;
				return `<table class="two"><tr>${line.map((sec) => `<td class="half" style="width:${w}%">${section(sec)}</td>`).join(`<td class="gap"></td>`)}</tr></table>`;
			})
			.join("");
		const overdue = r.overdue
			.map(
				(t, i) => `<tr class="${i % 2 ? "alt" : ""}"><td>${e(t.subject)}<div class="sub">${e(t.name)}</div></td><td>${t.department ? `<div class="dept">${e(t.department)}</div>` : ""}${t.assignees ? `<div>${e(t.assignees)}</div>` : t.department ? "" : `<div class="none">${e(r.labels.unassigned)}</div>`}</td><td class="${t.reason ? "why" : "why none"}">${t.reason ? e(t.reason) : e(r.labels.no_reason)}</td><td>${e(t.created_by)}</td><td class="nw">${e(t.end)}</td><td class="late nw">${e(t.late)}</td></tr>`
			)
			.join("");
		return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
			* { box-sizing: border-box; }
			body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5px; color: ${INK}; margin: 0; }
			table { border-collapse: collapse; width: 100%; }
			.head td { vertical-align: middle; padding: 0 0 10px; }
			.head img { height: 62px; }
			.head .ttl { text-align: right; }
			.head h1 { margin: 0; font-size: 21px; color: ${INK}; letter-spacing: .2px; }
			.head .tag { font-size: 11px; font-weight: bold; color: ${ORANGE}; letter-spacing: 1.2px; text-transform: uppercase; margin-top: 3px; }
			.rule { height: 4px; background: ${INK}; border-right: 150px solid ${ORANGE}; }
			.meta { margin: 9px 0 14px; }
			.meta td { font-size: 10.5px; padding: 0; color: #5b6770; }
			.meta b { color: ${INK}; }
			.meta .r { text-align: right; padding-right: 4px; }
			.kpi { width: 16.66%; padding: 0 4px; }
			.kpis { margin: 0 -4px 14px; width: 100%; }
			.kpi { vertical-align: top; }
			.kpi-in { border: 1px solid #e3e6ea; border-top: 3px solid ${INK}; border-radius: 6px; padding: 9px 9px 0; height: 62px; background: #fbfbfc; }
			.kpi-v { font-size: 20px; font-weight: bold; line-height: 1.1; }
			.kpi-l { font-size: 8px; color: #5b6770; margin-top: 4px; text-transform: uppercase; letter-spacing: .2px; white-space: nowrap; }
			.two { margin-bottom: 12px; page-break-inside: avoid; }
			.two .half { vertical-align: top; padding: 0; }
			.two .gap { width: 2%; }
			.card { border: 1px solid #e3e6ea; border-radius: 6px; padding: 10px 12px 8px; page-break-inside: avoid; }
			.card-h { font-size: 12px; font-weight: bold; color: ${INK}; padding-bottom: 6px; margin-bottom: 6px; border-bottom: 2px solid ${ORANGE}; }
			.bars td { padding: 4px 0; vertical-align: middle; }
			.b-l { width: 44%; padding-right: 8px !important; }
			.b-v { width: 30px; text-align: right; font-weight: bold; }
			.track { height: 8px; background: #eceef1; border-radius: 4px; }
			.fill { height: 8px; border-radius: 4px; }
			.stack { height: 8px; border-radius: 4px; overflow: hidden; }
			.seg { height: 8px; float: left; }
			.b-ls { width: 18%; }
			.b-lm { width: 26%; }
			.b-pw { width: 250px; }
			.b-p { width: 132px; text-align: right; white-space: nowrap; font-size: 9.5px; padding-left: 8px !important; }
			.lg { float: right; font-size: 9px; font-weight: normal; color: #5b6770; }
			.lg i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 4px; }
			.muted { color: #8a949c; }
			h2 { font-size: 13px; margin: 6px 0 7px; color: ${INK}; }
			h2 span { color: #d92d20; }
			.list th { background: ${INK}; color: #fff; text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: .4px; padding: 6px 7px; white-space: nowrap; }
			.list td { padding: 5px 7px; border-bottom: 1px solid #e9ebee; vertical-align: top; }
			.list tr { page-break-inside: avoid; }
			.list tr.alt td { background: #f7f8f9; }
			.list .sub { color: #8a949c; font-size: 9px; }
			.late { color: #d92d20; font-weight: bold; }
			.list td.why { color: ${INK}; }
			.list td.why.none, .list .none { color: #8a949c; font-style: italic; }
			.list .dept { font-weight: bold; color: ${INK}; }
			.nw { white-space: nowrap; }
			.foot { margin-top: 16px; padding-top: 7px; border-top: 1px solid #dfe3e7; font-size: 9px; color: #8a949c; text-align: center; }
		</style></head><body>
			<table class="head"><tr><td>${r.logo ? `<img src="${r.logo}">` : `<h1>HODAN HOSPITAL</h1>`}</td>
				<td class="ttl"><h1>${e(r.title)}</h1><div class="tag">${e(r.tag)}</div></td></tr></table>
			<div class="rule"></div>
			<table class="meta"><tr><td><b>${e(r.labels.period)}:</b> ${e(r.period)}${r.scope ? ` &nbsp;·&nbsp; <b>${e(r.labels.scope)}:</b> ${e(r.scope)}` : ""}</td>
				<td class="r"><b>${e(r.labels.generated)}:</b> ${e(r.generated)} &nbsp;·&nbsp; ${e(r.by)}</td></tr></table>
			<table class="kpis"><tr>${kpis}</tr></table>
			${grid}
			<h2>${e(r.labels.overdue)} <span>(${r.overdue.length})</span></h2>
			${r.overdue.length ? `<table class="list"><thead><tr><th>${e(r.labels.task)}</th><th style="width:21%">${e(r.labels.assigned)}</th><th style="width:23%">${e(r.labels.reason)}</th><th>${e(r.labels.created_by)}</th><th>${e(r.labels.end)}</th><th>${e(r.labels.late)}</th></tr></thead><tbody>${overdue}</tbody></table>` : `<div class="muted">${e(r.labels.none_overdue)}</div>`}
			<div class="foot">${e(r.footer)}</div>
		</body></html>`;
	}
	// </pdf-builder>

	// workload rows: one line per team / person, the open tasks in orange with their overdue part in red
	function loadBars(rows) {
		const max = Math.max(1, ...rows.map((r) => r.open));
		return `<div class="tm-bars">${rows
			.map(
				(r) => `<div class="tm-bar-row tm-load-row">${r.lead}
				<span class="tm-bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
				<span class="tm-bar-track tm-load-track" style="--w:${Math.max(3, (100 * r.open) / max)}%"><span><i class="is-over" style="flex:${r.overdue}"></i><i class="is-open" style="flex:${r.open - r.overdue}"></i></span></span>
				<span class="tm-load-nums"><b class="is-open">${__("{0} Open", [r.open])}</b><b class="is-over">${__("{0} Overdue", [r.overdue])}</b></span></div>`
			)
			.join("")}</div>`;
	}

	// ================================================================== the app
	task_management.TaskHub = class TaskHub {
		constructor(wrapper) {
			this.wrapper = wrapper;
			this.cache = {};
			this.filters = { department: "", type: "", priority: "", q: "", mine: false };
			this.colf = { status: "", assignee: "", due: "", progress: "" }; // filters set from the arrows in the task table header
			this.taskScope = null; // {label, names}: the exact tasks behind a dashboard tile
			this.taskView = "list";
			this.route = { view: "dashboard" };
			this.panel = null; // {kind: 'task'|'round', name, tab, data}
			this.cal = { month: moment().startOf("month") };
			this.chat = { channel: null, messages: [] };
			this.token = 0;
			this.$root = $('<div class="tm-app"><div class="tm-loading">' + __("Loading Task Management…") + "</div></div>").appendTo(
				$(wrapper).find(".layout-main-section").length ? $(wrapper).find(".layout-main-section") : wrapper
			);
			this.prefs = this.loadPrefs();
			this.applyPrefs();
			this.ready = this.boot();
			this.bind();
		}

		// -------------------------------------------------------------- preferences (kept in this browser)
		loadPrefs() {
			let saved = {};
			try {
				saved = JSON.parse(localStorage.getItem("tm_prefs") || "{}") || {};
			} catch (e) {
				/* defaults */
			}
			return Object.assign({}, PREF_DEFAULTS, saved);
		}

		savePrefs() {
			try {
				localStorage.setItem("tm_prefs", JSON.stringify(this.prefs));
			} catch (e) {
				/* private window: the choice lasts until the page is closed */
			}
			this.applyPrefs();
		}

		applyPrefs() {
			const dark = this.prefs.theme === "dark";
			this.$root.toggleClass("tm-dark", dark).toggleClass("tm-compact", this.prefs.density === "compact");
			this.$root.find(".tm-theme-btn").html(icon(dark ? "sun" : "moon")).attr("title", dark ? __("Light mode") : __("Dark mode"));
		}

		async boot() {
			this.b = await call("bootstrap");
			this.users = {};
			this.b.users.forEach((u) => (this.users[u.name] = u));
			await this.dir().catch(() => (this.directory = { departments: [], staff: [], kids: {}, byId: {}, userDept: {} }));
			this.renderShell();
			frappe.realtime.on("tm_chat", (m) => this.onChatEvent(m));
			$(document).on("tm-notify", () => this.visible() && this.poll()); // refresh the bell and counters at once
			this.timer = setInterval(() => this.poll(), 60000);
		}

		async on_show() {
			await this.ready;
			this.parseRoute();
			this.renderRail();
			this.renderSide();
			this.renderContent();
			if (this.pendingTask) {
				const name = this.pendingTask;
				this.pendingTask = null;
				this.openTask(name);
			}
		}

		visible() {
			return frappe.get_route()[0] === "task-hub" && !document.hidden;
		}

		async poll() {
			if (!this.visible()) return;
			try {
				const [counts, badges] = await Promise.all([call("workspace_counts"), call("badges")]);
				Object.assign(this.b, { counts, badges });
				this.renderRail();
				this.renderSide();
				this.renderBell();
			} catch (e) {
				/* next tick */
			}
		}

		// -------------------------------------------------------------- routing
		parseRoute() {
			const r = frappe.get_route().slice(1);
			let view = r[0];
			if (!view) {
				// no address after task-hub: the start page chosen in Settings
				const start = this.prefs.start;
				view = start === "tasks" ? "work" : ["chat", "calendar"].includes(start) ? start : "dashboard";
			}
			if (view === "work") {
				this.route = { view, tab: TABS.some((t) => t[0] === r[1]) ? r[1] : "tasks" };
			} else if (view === "my") {
				this.route = { view, kind: MY_KINDS[r[1]] ? r[1] : "tasks" };
			} else if (view === "team") {
				this.route = { view, team: r[1] };
			} else if (view === "task") {
				// task-hub/task/<name>: the address used by notifications
				this.route = { view: "work", tab: "tasks" };
				this.pendingTask = r[1];
			} else if (view === "chat") {
				if (r[1] && r[2]) this.chat.channel = { doctype: r[1], name: r.slice(2).join("/") };
				this.route = { view };
			} else {
				const known = ["dashboard", "activity", "chat", "teams", "calendar", "reports", "settings"];
				this.route = { view: known.includes(view) ? view : "dashboard" };
			}
		}

		go(...parts) {
			frappe.set_route("task-hub", ...parts);
		}

		async load() {
			if (!this.cache.board) this.cache.board = await call("board_data");
			return this.cache.board;
		}

		/** Departments and staff (Employee + Non-Employee) for the dashboard filter and the top search. */
		async dir() {
			if (!this.directory) {
				const raw = await call("staff_directory");
				const kids = {};
				raw.departments.forEach((d) => d.parent_department && (kids[d.parent_department] = kids[d.parent_department] || []).push(d.name));
				this.directory = { departments: raw.departments, staff: raw.staff, kids, byId: {}, userDept: {} };
				raw.staff.forEach((p) => {
					this.directory.byId[p.id] = p;
					if (p.user && p.department) this.directory.userDept[p.user] = p.department;
				});
			}
			return this.directory;
		}

		/** Staff list plus logins that have tasks but no Employee / Non-Employee record yet. */
		staffList(tasks) {
			const dir = this.directory, linked = new Set(dir.staff.map((p) => p.user).filter(Boolean)), extra = {};
			(tasks || []).forEach((t) =>
				t.assignees.forEach((u) => {
					if (!linked.has(u) && !extra[u]) extra[u] = { id: "User:" + u, source: "User", full_name: this.userName(u), user: u, department: null, designation: null };
				})
			);
			Object.values(extra).forEach((p) => (dir.byId[p.id] = p));
			return dir.staff.concat(Object.values(extra).sort((a, b) => a.full_name.localeCompare(b.full_name)));
		}

		staffSub(p) {
			const parts = [p.designation, p.department].filter(Boolean);
			if (p.source === "User") parts.push(__("login only, no staff record"));
			else if (!p.user) parts.push(__("no login linked"));
			return parts.join(" · ");
		}

		/** A department with every department under it. */
		deptSet(name) {
			const out = new Set(), walk = (n) => {
				if (out.has(n)) return;
				out.add(n);
				(this.directory.kids[n] || []).forEach(walk);
			};
			walk(name);
			return out;
		}

		/** Tasks of the chosen department (own field, or the department of its team) and / or staff member. */
		scopeTasks(tasks, f) {
			if (f.department) {
				const set = this.deptSet(f.department), teams = {};
				this.b.teams.forEach((t) => (teams[t.name] = t));
				const teamDept = (n) => {
					const t = teams[n];
					return t ? t.department || (teams[t.parent_team] || {}).department : null;
				};
				tasks = tasks.filter((t) => set.has(t.department) || (t.tm_team && set.has(teamDept(t.tm_team))));
			}
			if (f.staff) {
				const p = this.directory.byId[f.staff];
				tasks = p && p.user ? tasks.filter((t) => t.assignees.includes(p.user)) : [];
			}
			return tasks;
		}

		// same shape as the server's trend: running totals of created / completed tasks per day
		trendOf(tasks, days) {
			const day = (v) => String(v || "").slice(0, 10), out = [];
			let created = 0, completed = 0;
			for (let i = days - 1; i >= 0; i--) {
				const d = moment(this.b.today).subtract(i, "days").format("YYYY-MM-DD");
				tasks.forEach((t) => {
					if (day(t.creation) === d) created++;
					if (t.column === "done" && day(t.completed_on || t.modified) === d) completed++;
				});
				out.push({ date: d, created, completed });
			}
			return out;
		}

		/** After any write: drop caches, refresh counters, redraw what is on screen. */
		async reload(opts) {
			opts = opts || {};
			this.cache = {};
			const meta = await call("refresh_meta");
			Object.assign(this.b, meta);
			this.renderRail();
			this.renderSide();
			this.renderBell();
			if (!opts.keepContent) await this.renderContent(true);
			if (this.panel && !opts.keepPanel) await this.loadPanel();
		}

		// -------------------------------------------------------------- avatars
		userName(u) {
			return (this.users[u] && this.users[u].full_name) || u || "";
		}

		/** A person by their first two names: short enough for a table cell. */
		shortName(u) {
			return String(this.userName(u) || "").trim().split(/\s+/).slice(0, 2).join(" ");
		}

		avatar(u, size) {
			const info = this.users[u] || {};
			const name = info.full_name || u || "?";
			const cls = "tm-av" + (size ? " tm-av-" + size : "");
			const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
			if (info.user_image) return `<img class="${cls}" src="${esc(info.user_image)}" title="${esc(name)}" alt="" data-initials="${esc(initials)}" data-color="${colorOf(u)}">`;
			return `<span class="${cls}" style="background:${colorOf(u)}" title="${esc(name)}">${esc(initials)}</span>`;
		}

		avatars(list, max) {
			list = list || [];
			max = max || 2;
			const more = list.length > max ? `<span class="tm-av tm-av-more">+${list.length - max}</span>` : "";
			return `<span class="tm-avs">${list.slice(0, max).map((u) => this.avatar(u)).join("")}${more}</span>`;
		}

		// -------------------------------------------------------------- shell
		renderShell() {
			const b = this.b;
			this.$root.html(`
				<a class="tm-brand" href="/app" title="${__("Back to ERP desk")}">
					<img src="/assets/task_management/images/hodan-emblem.png" alt="">
					<div><b>HODAN HOSPITAL</b><span>TASK MANAGEMENT</span></div>
				</a>
				<aside class="tm-rail"></aside>
				<aside class="tm-side"></aside>
				<header class="tm-top">
						<div class="tm-search">
							${icon("search")}
							<input type="text" data-input="search" placeholder="${__("Search tasks, departments, staff…")}" autocomplete="off">
							<kbd>Ctrl + K</kbd>
							<div class="tm-search-results" hidden></div>
						</div>
						<div class="tm-top-actions">
							${b.perms.task_create ? `<button class="tm-btn tm-btn-primary" data-act="newTask">${icon("plus")}${__("New Task")}</button>` : ""}
							<button class="tm-icon-btn tm-bell" data-act="bell" title="${__("Notifications")}">${icon("bell")}<em hidden></em></button>
							<button class="tm-icon-btn tm-theme-btn" data-act="themeToggle"></button>
							<button class="tm-icon-btn" data-act="help" title="${__("Help")}">${icon("help")}</button>
							<button class="tm-icon-btn" data-act="nav" data-to="settings" title="${__("Settings")}">${icon("settings")}</button>
							<button class="tm-me" data-act="me" title="${esc(this.userName(b.user))}">${this.avatar(b.user, "lg")}<i></i></button>
						</div>
				</header>
				<section class="tm-main">
					<div class="tm-body">
						<div class="tm-content"></div>
						<aside class="tm-panel" hidden></aside>
					</div>
				</section>`);
			this.$rail = this.$root.find(".tm-rail");
			this.$side = this.$root.find(".tm-side");
			this.$content = this.$root.find(".tm-content");
			this.$panel = this.$root.find(".tm-panel");
			this.applyPrefs();
			this.renderBell();
		}

		renderBell() {
			const n = this.b.badges.notifications;
			this.$root.find(".tm-bell em").text(n > 99 ? "99+" : n).prop("hidden", !n);
		}

		renderRail() {
			const v = this.route.view;
			const active = v === "work" || v === "my" ? "tasks" : v === "team" ? "teams" : v;
			const items = [
				["dashboard", "home", __("Dashboard")],
				["tasks", "tasks", __("Tasks")],
				["teams", "users", __("Teams")],
				["chat", "chat", __("Chat"), this.b.badges.chat],
				["activity", "bell", __("Activity"), this.b.badges.activity],
				["calendar", "calendar", __("Calendar")],
				["reports", "chart", __("Reports")],
			];
			const btn = ([key, ic, label, badge]) =>
				`<button class="tm-rail-btn ${active === key ? "is-active" : ""}" data-act="nav" data-to="${key}">
					${icon(ic)}${badge ? `<em>${badge > 99 ? "99+" : badge}</em>` : ""}<span>${label}</span></button>`;
			this.$rail.html(`
				<nav>${items.map(btn).join("")}</nav>
				${btn(["settings", "settings", __("Settings")])}`);
		}

		renderSide() {
			const b = this.b, r = this.route;
			const show = r.view === "teams" || r.view === "team"; // the side panel belongs to Teams
			this.$root.toggleClass("tm-no-side", !show);
			if (!show) return this.$side.empty();
			this.openTeams = this.openTeams || {};
			const routeTeam = r.view === "team" ? b.teams.find((t) => t.name === r.team) : null;
			const routeKey = routeTeam ? routeTeam.name : "";
			if (routeKey && routeKey !== this.openedForTeam) this.openTeams[routeTeam.parent_team || routeTeam.name] = true; // open it once, on arrival
			this.openedForTeam = routeKey;
			const teamItem = (t, sub) => {
				const kids = sub ? [] : this.subTeams(t.name);
				return `<div class="tm-side-team ${sub ? "is-sub" : ""}"><button class="tm-side-item ${r.view === "team" && r.team === t.name ? "is-active" : ""}" data-act="go" data-path="team/${esc(encodeURIComponent(t.name))}" title="${esc(t.team_name)}">
					${sub ? "" : `<span class="tm-sq" style="background:${t.color || colorOf(t.name)}">${icon("users")}</span>`}<span>${esc(t.team_name)}</span></button>
					${kids.length ? `<button class="tm-side-chev ${this.openTeams[t.name] ? "is-open" : ""}" data-act="toggleTeam" data-name="${esc(t.name)}" title="${__("{0} sub-team(s)", [kids.length])}">${icon("chevDown")}</button>` : ""}</div>
					${this.openTeams[t.name] ? kids.map((k) => teamItem(k, true)).join("") : ""}`;
			};
			const teams = b.teams.length ? this.mainTeams().map((t) => teamItem(t)).join("") : `<div class="tm-side-empty">${__("No teams yet.")}</div>`;
			this.$side.html(`
				<div class="tm-side-scroll">
					<h4>${__("Teams")}${b.perms.team_create ? `<button data-act="newTeam" title="${__("New team")}">${icon("plus")}</button>` : ""}</h4>${teams}
				</div>`);
		}

		// -------------------------------------------------------------- content dispatcher
		async renderContent(quiet) {
			const token = ++this.token;
			const r = this.route;
			if (!quiet) this.$content.html(`<div class="tm-loading">${__("Loading…")}</div>`);
			let html;
			try {
				if (r.view === "work") html = await this.viewWork();
				else if (r.view === "dashboard") html = await this.viewDashboard();
				else if (r.view === "my") html = await this.viewMy();
				else if (r.view === "activity") html = await this.viewActivity();
				else if (r.view === "chat") html = await this.viewChat();
				else if (r.view === "teams") html = this.viewTeams();
				else if (r.view === "team") html = await this.viewTeam();
				else if (r.view === "calendar") html = await this.viewCalendarPage();
				else if (r.view === "reports") html = await this.viewReportsPage();
				else if (r.view === "settings") html = this.viewSettings();
			} catch (e) {
				console.error(e);
				html = empty(__("Could not load this view"), __("Check your permissions or try again."), `<button class="tm-btn" data-act="refresh">${__("Retry")}</button>`);
			}
			if (token !== this.token) return;
			const scroll = this.$content.scrollTop();
			this.$content.toggleClass("tm-anim", !quiet).html(html);
			if (quiet) this.$content.scrollTop(scroll);
			this.afterRender();
		}

		afterRender() {
			const r = this.route;
			if (r.view === "chat") this.scrollChat();
		}

		head(title, sub, actions) {
			return `<div class="tm-head"><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div><div class="tm-head-actions">${actions || ""}</div></div>`;
		}

		// -------------------------------------------------------------- task collections
		visibleTasks(tasks) {
			const names = new Set(tasks.map((t) => t.name));
			return tasks.filter((t) => !(t.parent_task && names.has(t.parent_task)));
		}

		progOf(t) {
			return t.column === "done" ? 100 : t.check_total ? pct(t.check_done, t.check_total) : Math.round(t.progress || 0);
		}

		/** The tasks the Tasks tab starts from: everything, or the tasks behind the dashboard tile that was clicked. */
		taskBase(tasks) {
			return this.taskScope ? tasks.filter((t) => this.taskScope.names.has(t.name)) : this.visibleTasks(tasks);
		}

		colMatch(t) {
			const c = this.colf, today = this.b.today, end = t.exp_end_date;
			if (c.status && (c.status === "open" ? t.column === "done" : t.column !== c.status)) return false;
			if (c.assignee && (c.assignee === "__none" ? t.assignees.length : c.assignee === "__me" ? !this.isMine(t) : !t.assignees.includes(c.assignee))) return false;
			if (c.due) {
				const m = moment(today);
				const ok =
					c.due === "overdue" ? t.overdue
					: c.due === "none" ? !end
					: c.due === "today" ? end === today
					: c.due === "week" ? !!end && end >= m.clone().startOf("week").format("YYYY-MM-DD") && end <= m.clone().endOf("week").format("YYYY-MM-DD")
					: !!end && end.slice(0, 7) === today.slice(0, 7);
				if (!ok) return false;
			}
			if (c.progress) {
				const p = this.progOf(t);
				if (!(c.progress === "0" ? p === 0 : c.progress === "low" ? p > 0 && p < 50 : c.progress === "high" ? p >= 50 && p < 100 : p === 100)) return false;
			}
			return true;
		}

		applyFilters(tasks) {
			const f = this.filters, q = f.q.trim().toLowerCase(), me = this.b.user;
			return tasks.filter(
				(t) =>
					this.colMatch(t) &&
					(!f.department || t.department === f.department) &&
					(!f.type || t.type === f.type) &&
					(!f.priority || t.priority === f.priority) &&
					(!f.mine || this.isMine(t)) &&
					this.inTaskPeriod(t) &&
					(!q || [t.subject, t.name, t.tm_patient, t.tm_patient_name, t.type].some((v) => v && String(v).toLowerCase().includes(q)))
			);
		}

		/** Date filter of the Tasks tab: the task was created, starts, is due or was completed inside the period. */
		inTaskPeriod(t) {
			const f = this.filters;
			if (!f.from && !f.to) return true;
			const inRange = (v) => !!v && (!f.from || String(v).slice(0, 10) >= f.from) && (!f.to || String(v).slice(0, 10) <= f.to);
			return [t.creation, t.exp_start_date, t.exp_end_date, t.completed_on].some(inRange);
		}

		stats(tasks) {
			const s = { total: tasks.length, overdue: 0 };
			COL_ORDER.forEach((c) => (s[c] = 0));
			tasks.forEach((t) => {
				s[t.column]++;
				if (t.overdue) s.overdue++;
			});
			return s;
		}

		findTask(name) {
			for (const key of Object.keys(this.cache)) {
				const t = (this.cache[key].tasks || []).find((x) => x.name === name);
				if (t) return t;
			}
			return (this.extraTasks || []).find((x) => x.name === name);
		}
	};

	// ================================================================== task workspace (tabs)
	Object.assign(task_management.TaskHub.prototype, {
		async viewWork() {
			const tab = TABS.some((t) => t[0] === this.route.tab) ? this.route.tab : "tasks";
			const d = await this.load();
			this.data = d;
			const all = this.visibleTasks(d.tasks);
			const st = this.stats(all);
			const progress = pct(st.done, st.total);
			const dueToday = all.filter((t) => t.column !== "done" && t.exp_end_date === this.b.today).length;
			const tabs = TABS.map(([k, label]) => `<button class="${tab === k ? "is-active" : ""}" data-act="tab" data-tab="${k}">${label}</button>`).join("");
			const meta = (ic, label, value, cls) => `<div><span>${icon(ic)}${label}</span><b class="${cls || ""}">${value}</b></div>`;
			const header = `
				<div class="tm-phead">
					<div class="tm-phead-main">
						<span class="tm-phead-ic">${icon("bed")}</span>
						<div>
							<div class="tm-phead-title"><h1>${__("Task Board")}</h1>${genericPill(__("{0} open", [st.total - st.done]), "orange")}</div>
							<p>${__("Coordinate inpatient care, procedures and safe discharge.")}</p>
						</div>
					</div>
					<div class="tm-phead-meta">
						<div class="tm-meta-progress"><span>${__("Progress")}<b>${progress}%</b></span><div class="tm-progress"><i style="width:${progress}%"></i></div></div>
						${meta("tasks", __("Total Tasks"), st.total)}${meta("clock", __("Due Today"), dueToday)}${meta("alert", __("Overdue"), st.overdue, st.overdue ? "tm-late" : "")}
					</div>
				</div>
				<div class="tm-tabs">${tabs}</div>`;
			let body;
			if (tab === "tasks") body = this.tabTasks(d);
			else if (tab === "overview") body = this.tabOverview(d);
			else if (tab === "calendar") body = await this.calendarHtml();
			else if (tab === "files") body = await this.tabFiles();
			else body = this.reportsHtml(all);
			return header + `<div class="tm-tab-body">${body}</div>`;
		},

		// -------------------------------------------------------------- tasks tab
		tabTasks(d) {
			const all = this.visibleTasks(d.tasks);
			const f = this.filters;
			const opt = (list, cur, label) =>
				`<option value="">${label}: ${__("All")}</option>` + list.map((v) => `<option value="${esc(v)}" ${cur === v ? "selected" : ""}>${esc(v)}</option>`).join("");
			const depts = [...new Set(all.map((t) => t.department).filter(Boolean))].sort();
			const types = [...new Set([...this.b.task_types, ...all.map((t) => t.type).filter(Boolean)])].sort();
			const views = [["list", __("List")], ["board", __("Board")]];
			return `
				<div class="tm-task-dates-row">
					<div class="tm-datefilter tm-task-dates" title="${__("Tasks created, starting, due or completed in the period")}">${icon("calendar")}
						<select data-change="taskPreset">${[["all", __("All dates")], ["today", __("Today")], ["week", __("This week")], ["month", __("This month")], ["last30", __("Last 30 days")], ["custom", __("Custom")]].map(([k, l]) => `<option value="${k}" ${(f.datePreset || "all") === k ? "selected" : ""}>${l}</option>`).join("")}</select>
						<input type="date" data-change="taskFrom" value="${esc(f.from || "")}" title="${__("From date")}"><span>${__("to")}</span><input type="date" data-change="taskTo" value="${esc(f.to || "")}" title="${__("To date")}"></div>
				</div>
				<div class="tm-toolbar tm-toolbar-wrap">
					<div class="tm-seg">${views.map(([k, l]) => `<button class="${this.taskView === k ? "is-active" : ""}" data-act="setTaskView" data-view="${k}">${icon(k)}${l}</button>`).join("")}</div>
					<button class="tm-icon-btn tm-filter-btn ${f.mine ? "is-on" : ""}" data-act="toggleMine" title="${__("Only tasks assigned to me or my team")}">${icon("filter")}</button>
					<select data-change="filter" data-key="department">${opt(depts, f.department, __("Department"))}</select>
					<select data-change="filter" data-key="type">${opt(types, f.type, __("Task Type"))}</select>
					<select data-change="filter" data-key="priority">${opt(PRIORITIES, f.priority, __("Priority"))}</select>
					<select data-change="statusFilter" title="${__("Status")}">${this.colOptions("status").map(([v, l]) => `<option value="${esc(v)}" ${this.colf.status === v ? "selected" : ""}>${v ? esc(l) : __("Status: All")}</option>`).join("")}</select>
					<div class="tm-mini-search">${icon("search")}<input type="text" data-input="taskq" value="${esc(f.q)}" placeholder="${__("Search tasks, departments, staff…")}"></div>
					<span class="tm-grow"></span>
					${this.b.perms.task_create ? `<button class="tm-btn tm-btn-primary" data-act="newTask">${icon("plus")}${__("New Task")}</button>` : ""}
					<button class="tm-icon-btn tm-icon-btn-box" data-act="tasksMenu" title="${__("More")}">${icon("dots")}</button>
				</div>
				<div class="tm-tasks-area">${this.tasksArea(this.applyFilters(this.taskBase(d.tasks)))}</div>`;
		},

		tasksArea(tasks) {
			this.lastTaskList = tasks;
			const note = this.filterNote(tasks.length);
			// list: newest task first (by the date it was created)
			if (this.taskView === "list") return `${note}<div class="tm-box tm-box-flush">${this.taskTable(tasks.slice().sort((a, b) => (String(a.creation) < String(b.creation) ? 1 : -1)), { filters: true })}</div>`;
			if (this.taskView === "calendar") {
				const events = tasks.filter((t) => t.exp_end_date).map((t) => ({ kind: "task", name: t.name, title: t.subject, date: t.exp_end_date, column: t.column, priority: t.priority, overdue: t.overdue }));
				return note + this.calGrid(events);
			}
			return note + this.board(tasks);
		},

		// the choices behind each header arrow: [value, label]
		colOptions(col) {
			if (col === "status") return [["", __("All")], ["open", __("Open (not completed)")]].concat(COL_ORDER.map((c) => [c, COLS[c].label]));
			if (col === "priority") return [["", __("All")]].concat(PRIORITIES.map((p) => [p, __(p)]));
			if (col === "due") return [["", __("All")], ["overdue", __("Overdue")], ["today", __("Today")], ["week", __("This week")], ["month", __("This month")], ["none", __("No end date")]];
			if (col === "progress") return [["", __("All")], ["0", __("Not started (0%)")], ["low", __("Under half (1–49%)")], ["high", __("Over half (50–99%)")], ["100", __("Finished (100%)")]];
			const users = [...new Set(((this.data && this.data.tasks) || []).reduce((a, t) => a.concat(t.assignees), []))].sort((a, b) => this.userName(a).localeCompare(this.userName(b)));
			return [["", __("All")], ["__me", __("Me and my teams")], ["__none", __("Unassigned")]].concat(users.map((u) => [u, this.userName(u)]));
		},

		colValue(col) {
			return col === "priority" ? this.filters.priority : this.colf[col];
		},

		filterNote(count) {
			const names = { status: __("Status"), priority: __("Priority"), assignee: __("Assigned to"), due: __("Due"), progress: __("Progress") };
			const parts = Object.keys(names)
				.filter((c) => this.colValue(c))
				.map((c) => `${names[c]}: ${(this.colOptions(c).find((o) => o[0] === this.colValue(c)) || ["", this.colValue(c)])[1]}`);
			if (this.taskScope) parts.unshift(this.taskScope.label);
			const f = this.filters, dm = (v) => moment(v).format("DD MMM YYYY");
			if (f.from || f.to) parts.push(f.from && f.from === f.to ? `${__("Date")}: ${dm(f.from)}` : `${__("Period")}: ${f.from ? dm(f.from) : __("the start")} – ${f.to ? dm(f.to) : __("today")}`);
			if (!parts.length) return "";
			return `<div class="tm-datefilter-note tm-filter-note"><span>${esc(__("Showing {0}: {1} task(s).", [parts.join(" · "), count]))}</span><a data-act="clearFilters">${__("Clear filters")}</a></div>`;
		},

		board(tasks) {
			this.expanded = this.expanded || {};
			const cols = COL_ORDER.map((col) => {
				const list = tasks.filter((t) => t.column === col);
				const cap = this.expanded[col] ? list.length : 12;
				const more = list.length > cap ? `<button class="tm-col-more" data-act="expandCol" data-col="${col}">${__("Show all {0}", [list.length])}</button>` : "";
				return `<section class="tm-col tm-col-${col}" data-col="${col}">
					<header><b>${COLS[col].label} <span>(${list.length})</span></b>
						${this.b.perms.task_create ? `<button data-act="newTask" data-col="${col}" title="${__("Add task")}">${icon("plus")}</button>` : ""}
						<button data-act="colMenu" data-col="${col}" title="${__("More")}">${icon("dots")}</button></header>
					<div class="tm-col-body">${list.slice(0, cap).map((t) => this.card(t)).join("") || `<div class="tm-col-empty">${__("Drop a task here")}</div>`}${more}</div>
				</section>`;
			});
			return `<div class="tm-board">${cols.join("")}</div>`;
		},

		card(t) {
			const open = this.panel && this.panel.kind === "task" && this.panel.name === t.name;
			const done = t.column === "done";
			return `<article class="tm-task ${open ? "is-open" : ""} ${done ? "is-done" : ""}" draggable="true" data-task="${esc(t.name)}" data-act="openTask" data-name="${esc(t.name)}">
				<div class="tm-task-top">
					<button class="tm-check ${done ? "is-done" : ""}" data-act="toggleDone" data-name="${esc(t.name)}" title="${done ? __("Reopen") : __("Mark completed")}">${icon(done ? "check" : "circle")}</button>
					<b>${esc(t.subject)}${t.tm_patient ? ` <small>(${esc(t.tm_patient_name || t.tm_patient)})</small>` : ""}</b>
				</div>
				<div class="tm-task-tags">${typeTag(t.type)}</div>
				<div class="tm-task-row">${priorityPill(t.priority)}${t.column === "blocked" ? `<span class="tm-flag-red" title="${__("Blocked")}">!</span>` : ""}</div>
				<div class="tm-task-foot">
					${t.check_total ? `<span class="${t.check_done === t.check_total ? "is-ok" : ""}">${icon(t.check_done === t.check_total ? "check" : "tasks")}${t.check_done}/${t.check_total}</span>` : t.sub_total ? `<span>${icon("list")}${t.sub_done}/${t.sub_total}</span>` : ""}
					${t.exp_end_date ? `<span class="${t.overdue ? "is-late" : ""}">${icon("calendar")}${fmtDay(t.exp_end_date)}</span>` : ""}
					<span class="tm-grow"></span>${t.tm_team ? `<span class="tm-av tm-av-team" title="${esc(__("Team: {0}", [t.tm_team]))}">${icon("users")}</span>` : ""}${this.avatars(t.assignees)}
					${this.canEdit(t) ? `<button class="tm-card-btn" data-act="assign" data-name="${esc(t.name)}" title="${__("Assign to a user or a team")}">${icon("userPlus")}</button>` : ""}
				</div>
			</article>`;
		},

		taskTable(tasks, opts) {
			opts = opts || {};
			if (!tasks.length && !opts.filters) return empty(__("No tasks here"), opts.emptyHint || __("Try clearing the filters, or create a task."));
			// with filters: a small arrow on the column opens its choices
			const th = (col, label) =>
				opts.filters ? `<button class="tm-th-f ${this.colValue(col) ? "is-on" : ""}" data-act="colMenu" data-col="${col}" title="${__("Filter")}">${label}${icon("chevDown")}</button>` : label;
			return `<table class="tm-table"><thead><tr><th class="tm-th-no">${__("No.")}</th><th>${__("Task")}</th><th>${th("assignee", __("Assigned to"))}</th><th>${th("status", __("Status"))}</th><th>${th("priority", __("Priority"))}</th><th>${__("Type")}</th><th>${__("Start")}</th><th>${th("due", __("Due"))}</th><th style="width:110px">${th("progress", __("Progress"))}</th><th></th></tr></thead><tbody>
				${tasks.length ? "" : `<tr class="tm-tr-empty"><td colspan="10">${empty(__("No tasks match"), __("Change or clear the filters to see tasks."))}</td></tr>`}
				${tasks
					.map((t, i) => {
						const prog = this.progOf(t);
						const who = this.whoCell(t);
						const lateDays = t.overdue ? Math.max(1, moment(this.b.today).diff(moment(t.exp_end_date), "days")) : 0;
						return `<tr data-act="openTask" data-name="${esc(t.name)}" class="${this.panel && this.panel.name === t.name ? "is-open" : ""} ${t.overdue ? "is-late" : ""}">
							<td class="tm-td-no">${i + 1}</td>
							<td><b>${esc(t.subject)}</b><small>${esc(t.name)}${t.tm_patient ? " · " + esc(t.tm_patient_name || t.tm_patient) : ""}</small>${
								t.overdue ? (t.tm_delay_reason ? `<small class="tm-reason" title="${esc(t.tm_delay_reason)}">${icon("alert")}<span>${__("Reason")}: ${esc(t.tm_delay_reason)}</span></small>` : `<small class="tm-reason is-missing">${icon("alert")}<span>${__("Overdue — no reason given yet")}</span></small>`) : ""
							}</td>
							<td>${who}</td><td>${statusPill(t.column)}</td><td>${priorityPill(t.priority)}</td><td>${typeTag(t.type) || "—"}</td>
							<td class="tm-nowrap">${t.exp_start_date ? fmtDay(t.exp_start_date) : "—"}</td>
							<td class="tm-nowrap ${t.overdue ? "tm-late" : ""}">${t.exp_end_date ? fmtDay(t.exp_end_date) : "—"}${t.overdue ? `<small class="tm-late-days">${lateDays === 1 ? __("1 day late") : __("{0} days late", [lateDays])}</small>` : ""}</td>
							<td><div class="tm-progress tm-progress-sm"><i style="width:${prog}%"></i></div></td>
							<td class="tm-td-actions">${t.owner ? `<div class="tm-by" title="${esc(__("Created by {0} on {1}", [this.userName(t.owner), fmtDate(t.creation)]))}">${__("Created by")} <b>${esc(this.shortName(t.owner))}</b></div>` : ""}${this.canEdit(t) ? `<button class="tm-btn tm-btn-sm" data-act="assign" data-name="${esc(t.name)}" title="${__("Assign to a user or a team")}">${icon("userPlus")}${__("Assign")}</button>` : `<button class="tm-btn tm-btn-sm" data-act="updateTask" data-name="${esc(t.name)}" title="${__("Change the status, give a reason or add a comment")}">${icon("check")}${__("Update")}</button>`}</td></tr>`;
					})
					.join("")}</tbody></table>`;
		},

		timeline(tasks) {
			const DAY = 30, days = 42;
			const start = moment().startOf("day").subtract(10, "days");
			const end = start.clone().add(days - 1, "days");
			const rows = tasks
				.map((t) => {
					const e = t.exp_end_date ? moment(t.exp_end_date) : null;
					const s = t.exp_start_date ? moment(t.exp_start_date) : e ? e.clone() : null;
					return s ? { t, s, e: e || s.clone() } : null;
				})
				.filter((r) => r && !r.e.isBefore(start) && !r.s.isAfter(end))
				.sort((a, b) => a.s - b.s);
			const undated = tasks.filter((t) => !t.exp_end_date && !t.exp_start_date).length;
			if (!rows.length) return empty(__("Nothing scheduled in this window"), __("Tasks appear here once they have a start or due date ({0} without dates).", [undated]));
			let head = "";
			for (let i = 0; i < days; i++) {
				const d = start.clone().add(i, "days");
				const today = d.isSame(moment(), "day");
				head += `<span class="${today ? "is-today" : ""} ${d.day() === 5 ? "is-off" : ""}" style="width:${DAY}px"><small>${d.date() === 1 || i === 0 ? d.format("MMM") : ""}</small>${d.date()}</span>`;
			}
			const todayX = moment().startOf("day").diff(start, "days") * DAY + DAY / 2;
			const body = rows
				.map(({ t, s, e }) => {
					const a = Math.max(0, s.diff(start, "days")), b = Math.min(days - 1, e.diff(start, "days"));
					return `<div class="tm-tl-row" data-act="openTask" data-name="${esc(t.name)}">
						<div class="tm-tl-label"><span class="tm-dot" style="background:${COLS[t.column].color}"></span><span title="${esc(t.subject)}">${esc(t.subject)}</span></div>
						<div class="tm-tl-track" style="width:${days * DAY}px"><i class="tm-tl-bar ${t.overdue ? "is-late" : ""}" style="left:${a * DAY + 3}px;width:${(b - a + 1) * DAY - 6}px;background:${COLS[t.column].color}" title="${esc(t.subject)} · ${fmtDay(s)} – ${fmtDay(e)}"></i></div>
					</div>`;
				})
				.join("");
			return `<div class="tm-box tm-box-flush tm-tl"><div class="tm-tl-scroll">
				<div class="tm-tl-row tm-tl-head"><div class="tm-tl-label">${__("Task")}</div><div class="tm-tl-track tm-tl-days" style="width:${days * DAY}px">${head}</div></div>
				<div class="tm-tl-rows" style="--today:${todayX + 220}px">${body}</div></div>
				${undated ? `<div class="tm-tl-note">${__("{0} task(s) without dates are not shown.", [undated])}</div>` : ""}</div>`;
		},

		// -------------------------------------------------------------- widgets under the board
		widgets(tasks, d, opts) {
			opts = opts || {};
			return `<div class="tm-grid tm-grid-3">${this.wProgress(tasks, d)}${this.wWorkload(tasks)}${this.wPeople(tasks)}</div>
				<div class="tm-grid tm-grid-2">${this.wActivity(d.activity, opts.activityTitle)}${this.wTrend(tasks)}</div>`;
		},

		wProgress(tasks, d) {
			const st = this.stats(tasks);
			const overall = pct(st.done, st.total);
			const legend = LEGEND_ORDER.map(
				(c) => `<div><i style="background:${COLS[c].color}"></i><span>${COLS[c].label}</span><b>${st[c]}</b><em>(${pct(st[c], st.total)}%)</em></div>`
			).join("");
			return `<div class="tm-box"><h3>${icon("clock")}${__("Overall Progress")}</h3><div class="tm-donut-wrap">
				${donut(LEGEND_ORDER.map((c) => ({ value: st[c], color: COLS[c].color })), overall + "%", __("Overall"))}<div class="tm-donut-legend">${legend}</div></div></div>`;
		},

		// all tasks per department, drawn like "Tasks By Department" in the report
		wWorkload(tasks) {
			const rows = this.ownerRows(tasks, (t) => { const d = this.taskDepts(t); return d.length ? d : [__("No department")]; }, "#0ea5a4");
			return `<div class="tm-box"><h3>${__("Department Workload")} <small>(${__("all tasks per department")})</small></h3>
				${rows.length ? bars(rows, { icon: "users" }) : `<div class="tm-muted tm-pad">${__("No tasks yet.")}</div>`}</div>`;
		},

		/** A task's department(s): its own, else its team's, else those of the staff it is assigned to. */
		taskDepts(t) {
			const teams = {};
			this.b.teams.forEach((x) => (teams[x.name] = x));
			const team = teams[t.tm_team];
			const own = t.department || (team && (team.department || (teams[team.parent_team] || {}).department));
			return own ? [own] : [...new Set(t.assignees.map((u) => this.directory.userDept[u]).filter(Boolean))];
		},

		/** Who a task counts under in the per-person charts: each assignee, else "Department Assigned", else "Unassigned". */
		assigneeKeys(t) {
			return t.assignees.length ? t.assignees.map((u) => this.userName(u)) : [this.taskDepts(t).length ? __("Department Assigned") : __("Unassigned")];
		},

		/** Chart rows of all tasks per person / department: Open + Completed = total; Urgent and Overdue are counted
		 *  among the open ones only. */
		ownerRows(tasks, keys, color) {
			const m = {};
			tasks.forEach((t) =>
				keys(t).forEach((k) => {
					const r = (m[k] = m[k] || { total: 0, done: 0, urgent: 0, overdue: 0 });
					r.total++;
					if (t.column === "done") return void r.done++;
					if (t.priority === "Urgent") r.urgent++;
					if (t.overdue) r.overdue++;
				})
			);
			return Object.keys(m)
				.map((k) => ({ label: k, value: m[k].total, color,
					parts: [
						{ label: __("Open"), value: m[k].total - m[k].done, color: "#1d4ed8",
							sub: [{ label: __("Urgent"), value: m[k].urgent, color: "#b42318" }, { label: __("Overdue"), value: m[k].overdue, color: "#e5731a" }] },
						{ label: __("Completed"), value: m[k].done, color: "#15803d" },
					] }))
				.sort((a, b) => b.value - a.value)
				.slice(0, 8);
		},

		// all tasks per assigned person, drawn like "Tasks By Assignee" in the report
		wPeople(tasks) {
			const rows = this.ownerRows(tasks, (t) => this.assigneeKeys(t), "#3b82f6");
			return `<div class="tm-box"><h3>${__("Individual Workload")} <small>(${__("all tasks per person")})</small></h3>
				${rows.length ? bars(rows, { icon: "user" }) : `<div class="tm-muted tm-pad">${__("No tasks yet.")}</div>`}</div>`;
		},

		trendRange() {
			const day = (m) => m.format("YYYY-MM-DD");
			return (this.trendF = this.trendF || { preset: "last30", from: day(moment(this.b.today).subtract(29, "days")), to: day(moment(this.b.today)), hide: {} });
		},

		// what happened per day in the chosen period (one day or several): created, completed, due and overdue tasks
		wTrend(tasks) {
			const f = this.trendRange(), day = (v) => String(v || "").slice(0, 10);
			const SERIES = [
				{ key: "created", label: __("Created"), color: "#1d4ed8", tip: __("Tasks created on the day") },
				{ key: "completed", label: __("Completed"), color: "#15803d", tip: __("Tasks completed on the day") },
				{ key: "due", label: __("Due"), color: "#7c3aed", tip: __("Tasks whose end date is the day") },
				{ key: "overdue", label: __("Overdue"), color: "#e5731a", tip: __("Tasks due on the day that are still not completed") },
			];
			const from = moment(f.from), to = moment(f.to);
			const span = Math.min(Math.max(to.diff(from, "days"), 0), 91); // at most three months of points
			const idx = {}, points = [];
			for (let i = 0; i <= span; i++) {
				const d = from.clone().add(i, "days").format("YYYY-MM-DD");
				idx[d] = points.length;
				points.push({ date: d, created: 0, completed: 0, due: 0, overdue: 0 });
			}
			const add = (d, key) => d in idx && points[idx[d]][key]++;
			tasks.forEach((t) => {
				add(day(t.creation), "created");
				if (t.column === "done") add(day(t.completed_on || t.modified), "completed");
				if (t.exp_end_date) {
					add(day(t.exp_end_date), "due");
					if (t.overdue) add(day(t.exp_end_date), "overdue");
				}
			});
			const total = (key) => points.reduce((n, p) => n + p[key], 0);
			const presets = [["last30", __("Last 30 days")], ["last7", __("Last 7 days")], ["today", __("Today")], ["month", __("This month")], ["custom", __("Custom")]];
			const filter = `<div class="tm-datefilter tm-trend-filter">${icon("calendar")}
				<select data-change="trendPreset">${presets.map(([k, l]) => `<option value="${k}" ${f.preset === k ? "selected" : ""}>${l}</option>`).join("")}</select>
				<input type="date" data-change="trendFrom" value="${esc(f.from)}" title="${__("From date")}"><span>${__("to")}</span><input type="date" data-change="trendTo" value="${esc(f.to)}" title="${__("To date")}"></div>`;
			// the totals double as the legend: click one to hide or show its line
			const keys = SERIES.map((s) => `<button class="tm-cal-chip ${f.hide[s.key] ? "is-off" : ""}" style="--ev:${s.color}" data-act="trendKey" data-key="${s.key}" title="${esc(s.tip)}"><i></i>${esc(s.label)}<b>${total(s.key)}</b></button>`).join("");
			const period = span ? `${from.format("DD MMM")} – ${from.clone().add(span, "days").format("DD MMM YYYY")}` : from.format("DD MMM YYYY");
			return `<div class="tm-box tm-trend-box"><h3>${icon("trend")}${__("Task Trend")}<span class="tm-chip">${period}</span></h3>
				${filter}<div class="tm-cal-keys tm-trend-keys">${keys}</div>
				${trendChart(points, SERIES.filter((s) => !f.hide[s.key]))}</div>`;
		},

		wUpcoming(d) {
			const rows = (d.upcoming || [])
				.map(
					(r) => `<div class="tm-line" data-act="openRound" data-name="${esc(r.name)}"><span class="tm-line-ic">${icon("calendar")}</span>
					<b>${esc(r.title)}</b><span class="tm-muted">${fmtDate(r.round_date)}</span>
					<span class="tm-chip tm-chip-warm">${r.patients_total ? __("{0} patients", [r.patients_total]) : esc(String(r.round_time || "").slice(0, 5) || __(r.round_type))}</span></div>`
				)
				.join("");
			return `<div class="tm-box"><h3>${icon("calendar")}${__("Upcoming Clinical Workflows")}${this.b.perms.round_create ? `<button class="tm-h-btn" data-act="newRound" title="${__("Schedule a round")}">${icon("plus")}</button>` : ""}</h3>
				${rows || `<div class="tm-muted tm-pad">${__("No rounds are scheduled. Use + to schedule a ward round, surgical list or meeting.")}</div>`}</div>`;
		},

		wActivity(items, title) {
			return `<div class="tm-box"><h3>${icon("clock")}${title || __("Recent Activity")}<a class="tm-h-link" data-act="nav" data-to="activity">${__("View All")}</a></h3>
				${(items || []).filter(taskOnly).map((a) => this.activityItem(a)).join("") || `<div class="tm-muted tm-pad">${__("No activity yet.")}</div>`}</div>`;
		},

		// one row of the Activity table
		activityRow(a) {
			const type = a.comment_type;
			const kind = type === "Comment" ? ["chat", __("Comment")] : type === "Attachment" ? ["clip", __("File added")] : type === "Attachment Removed" ? ["clip", __("File removed")]
				: type === "Assigned" ? ["user", __("Assigned")] : type === "Assignment Completed" ? ["checkCircle", __("Assignment done")]
				: /Completed|checked/.test(a.text) ? ["checkCircle", __("Update")] : ["edit", __("Update")];
			const who = this.userName(a.user) || a.comment_by || __("Someone");
			const what = { Task: __("Task"), "Clinical Round": __("Round"), "Task Handover": __("Handover") }[a.reference_doctype] || a.reference_doctype;
			return `<tr>
				<td class="tm-nowrap">${esc(moment(a.creation).format("DD MMM YYYY"))}</td>
				<td class="tm-nowrap tm-muted" title="${esc(ago(a.creation))}">${esc(moment(a.creation).format("HH:mm"))}</td>
				<td><span class="tm-cell-user">${this.avatar(a.user || who)}<span>${esc(who)}</span></span></td>
				<td class="tm-nowrap"><span class="tm-act-kind"><span class="tm-act-ic tm-act-${kind[0]}">${icon(kind[0])}</span>${kind[1]}</span></td>
				<td><a data-act="openRef" data-doctype="${esc(a.reference_doctype)}" data-name="${esc(a.reference_name)}"><b>${esc(a.title)}</b></a><small>${esc(what)} · ${esc(a.reference_name)}</small></td>
				<td class="tm-act-text">${esc(a.text)}</td></tr>`;
		},

		activityItem(a) {
			const ic = a.comment_type === "Comment" ? "chat" : a.comment_type.startsWith("Attachment") ? "clip" : a.comment_type.startsWith("Assign") ? "user" : /Completed|checked/.test(a.text) ? "checkCircle" : "edit";
			const who = `<b>${esc(this.userName(a.user) || a.comment_by || __("Someone"))}</b>`;
			const ref = `<a data-act="openRef" data-doctype="${esc(a.reference_doctype)}" data-name="${esc(a.reference_name)}">${esc(a.title)}</a>`;
			let text;
			if (a.comment_type === "Comment") text = `${who} ${__("commented on")} ${ref}: <q>${esc(a.text)}</q>`;
			else if (a.is_log) text = `${who} ${esc(a.text)} — ${ref}`;
			else text = `${esc(a.text)} — ${ref}`;
			return `<div class="tm-act"><span class="tm-act-ic tm-act-${ic}">${icon(ic)}</span><div>${text}</div><time title="${esc(a.creation)}">${esc(ago(a.creation))}</time></div>`;
		},

		// -------------------------------------------------------------- overview tab
		tabOverview(d) {
			const all = this.visibleTasks(d.tasks);
			const st = this.stats(all);
			const tile = (label, value, ic, tone) => `<div class="tm-kpi tm-kpi-${tone || "grey"}"><span>${icon(ic)}</span><div><b>${value}</b><small>${label}</small></div></div>`;
			const people = [...new Set(all.flatMap((t) => t.assignees).filter(Boolean))];
			const milestones = all.filter((t) => cint(t.is_milestone));
			const next = all.filter((t) => t.column !== "done" && t.exp_end_date).sort((a, b) => (a.exp_end_date > b.exp_end_date ? 1 : -1)).slice(0, 6);
			return `
				<div class="tm-kpis">${tile(__("Total tasks"), st.total, "tasks")}${tile(__("In progress"), st.progress + st.review, "clock", "orange")}${tile(__("Completed"), st.done, "checkCircle", "green")}${tile(__("Blocked"), st.blocked, "alert", "red")}${tile(__("Overdue"), st.overdue, "flag", "red")}${tile(__("Upcoming rounds"), (d.upcoming || []).length, "pulse", "blue")}</div>
				<div class="tm-grid tm-grid-3">${this.wProgress(all, d)}${this.wWorkload(all)}${this.wPeople(all)}</div>
				<div class="tm-grid tm-grid-2">${this.wActivity(d.activity)}${this.wTrend(all)}</div>
				<div class="tm-grid tm-grid-2">
					<div class="tm-box"><h3>${icon("flag")}${__("Next Due")}</h3>${next.map((t) => `<div class="tm-line" data-act="openTask" data-name="${esc(t.name)}"><span class="tm-dot" style="background:${COLS[t.column].color}"></span><b>${esc(t.subject)}</b><span class="${t.overdue ? "tm-late" : "tm-muted"}">${fmtDay(t.exp_end_date)}</span></div>`).join("") || `<div class="tm-muted tm-pad">${__("No dated open tasks.")}</div>`}
						${milestones.length ? `<h3 class="tm-h-sub">${icon("star")}${__("Milestones")}</h3>` + milestones.map((t) => `<div class="tm-line" data-act="openTask" data-name="${esc(t.name)}">${statusPill(t.column)}<b>${esc(t.subject)}</b></div>`).join("") : ""}</div>
					<div class="tm-box"><h3>${icon("users")}${__("People")} <small>(${people.length})</small></h3><div class="tm-people">${people.map((u) => `<div>${this.avatar(u, "lg")}<span><b>${esc(this.userName(u))}</b><small>${__("{0} open task(s)", [all.filter((t) => t.column !== "done" && t.assignees.includes(u)).length])}</small></span></div>`).join("") || `<div class="tm-muted tm-pad">${__("Nobody is assigned yet.")}</div>`}</div></div>
				</div>`;
		},

		// -------------------------------------------------------------- rounds
		async tabRounds() {
			const rounds = await call("list_rounds");
			this.rounds = rounds;
			return `<div class="tm-toolbar"><h3 class="tm-tb-title">${__("Clinical Rounds")} <small>(${rounds.length})</small></h3><span class="tm-grow"></span>
				${this.b.perms.round_create ? `<button class="tm-btn tm-btn-primary" data-act="newRound">${icon("plus")}${__("New Round")}</button>` : ""}</div>
				<div class="tm-box tm-box-flush">${this.roundsTable(rounds)}</div>`;
		},

		roundsTable(rounds) {
			if (!rounds.length) return empty(__("No clinical rounds yet"), __("Schedule ward rounds, surgical lists, discharge planning and meetings, then tick patients off as they are seen."));
			return `<table class="tm-table"><thead><tr><th>${__("Round")}</th><th>${__("Type")}</th><th>${__("Date")}</th><th>${__("Ward / Unit")}</th><th>${__("Lead")}</th><th>${__("Patients seen")}</th><th>${__("Status")}</th></tr></thead><tbody>
				${rounds
					.map(
						(r) => `<tr data-act="openRound" data-name="${esc(r.name)}" class="${this.panel && this.panel.name === r.name ? "is-open" : ""}">
						<td><b>${esc(r.title)}</b><small>${esc(r.name)}</small></td><td>${typeTag(r.round_type)}</td>
						<td>${fmtDay(r.round_date)} <span class="tm-muted">${esc(String(r.round_time || "").slice(0, 5))}</span></td>
						<td>${esc(r.service_unit || r.department || "—")}</td>
						<td>${r.lead ? this.avatar(r.lead) + " " + esc(this.userName(r.lead)) : "—"}</td>
						<td><div class="tm-progress tm-progress-sm"><i style="width:${pct(r.patients_seen, r.patients_total)}%"></i></div><small>${r.patients_seen}/${r.patients_total}</small></td>
						<td>${genericPill(r.status, TONES[r.status])}</td></tr>`
					)
					.join("")}</tbody></table>`;
		},

		// -------------------------------------------------------------- handover
		async tabHandover() {
			const list = await call("list_handovers");
			this.handovers = list;
			const forms = HIS_HANDOVER_FORMS.filter((dt) => frappe.model.can_read(dt));
			return `<div class="tm-toolbar"><h3 class="tm-tb-title">${__("Handover Items")} <small>(${list.length})</small></h3><span class="tm-grow"></span>
				${forms.map((dt) => `<button class="tm-btn" data-act="openList" data-doctype="${esc(dt)}" title="${__("Existing hospital form")}">${icon("file")}${esc(frappe.utils.to_title_case(dt.toLowerCase()))}</button>`).join("")}
				${this.b.perms.handover_create ? `<button class="tm-btn tm-btn-primary" data-act="newHandover">${icon("plus")}${__("New Handover")}</button>` : ""}</div>
				<div class="tm-box tm-box-flush">${this.handoverTable(list)}</div>`;
		},

		handoverTable(list) {
			if (!list.length) return empty(__("No handover items"), __("Hand work over to the next shift; the receiver acknowledges it here."));
			const me = this.b.user;
			return `<table class="tm-table"><thead><tr><th>${__("Handover")}</th><th>${__("Date / Shift")}</th><th>${__("From")}</th><th>${__("To")}</th><th>${__("Patient")}</th><th>${__("Priority")}</th><th>${__("Status")}</th><th></th></tr></thead><tbody>
				${list
					.map((h) => {
						let action = "";
						if (h.status === "Pending" && (h.to_user === me || !h.to_user)) action = `<button class="tm-btn tm-btn-sm" data-act="handoverStatus" data-name="${esc(h.name)}" data-status="Acknowledged">${icon("check")}${__("Acknowledge")}</button>`;
						else if (h.status === "Acknowledged") action = `<button class="tm-btn tm-btn-sm" data-act="handoverStatus" data-name="${esc(h.name)}" data-status="Completed">${icon("checkCircle")}${__("Complete")}</button>`;
						return `<tr data-act="editHandover" data-name="${esc(h.name)}"><td><b>${esc(h.subject)}</b><small>${esc(h.details || h.name).slice(0, 90)}</small></td>
						<td>${fmtDay(h.handover_date)} <span class="tm-muted">${esc(h.shift || "")}</span></td>
						<td>${h.from_user ? this.avatar(h.from_user) + " " + esc(this.userName(h.from_user)) : "—"}</td>
						<td>${h.to_user ? this.avatar(h.to_user) + " " + esc(this.userName(h.to_user)) : `<span class="tm-muted">${__("Anyone")}</span>`}</td>
						<td>${h.patient ? esc(h.patient_name || h.patient) : "—"}</td><td>${priorityPill(h.priority)}</td>
						<td>${genericPill(h.status, TONES[h.status])}</td><td class="tm-td-actions">${action}</td></tr>`;
					})
					.join("")}</tbody></table>`;
		},

		// -------------------------------------------------------------- files
		async tabFiles() {
			const files = await call("files");
			return `<div class="tm-toolbar"><h3 class="tm-tb-title">${__("Files")} <small>(${files.length})</small></h3><span class="tm-grow"></span>
				<span class="tm-muted">${__("Attach files from a task's Files tab.")}</span></div>
				<div class="tm-box tm-box-flush">${this.filesTable(files, true)}</div>`;
		},

		filesTable(files, showRef) {
			if (!files.length) return empty(__("No files yet"), __("Files attached to tasks are listed here."));
			return `<table class="tm-table"><thead><tr><th>${__("File")}</th>${showRef ? `<th>${__("Attached to")}</th>` : ""}<th>${__("Size")}</th><th>${__("Added by")}</th><th>${__("Added")}</th></tr></thead><tbody>
				${files
					.map(
						(f) => `<tr><td><a class="tm-file" href="${esc(f.file_url)}" target="_blank" rel="noopener">${icon("file")}<b>${esc(f.file_name || f.file_url)}</b></a></td>
						${showRef ? `<td><a data-act="openRef" data-doctype="${esc(f.attached_to_doctype)}" data-name="${esc(f.attached_to_name)}">${esc(f.title)}</a> <span class="tm-muted">${esc(__(f.attached_to_doctype))}</span></td>` : ""}
						<td>${fileSize(f.file_size)}</td><td>${this.avatar(f.owner)} ${esc(this.userName(f.owner))}</td><td>${esc(ago(f.creation))}</td></tr>`
					)
					.join("")}</tbody></table>`;
		},

		// -------------------------------------------------------------- reports
		repRange() {
			return (this.rep = this.rep || { preset: "all", from: "", to: "" });
		},

		reportsHtml(tasks) {
			const f = this.repRange(), on = !!(f.from || f.to);
			const inRange = (v) => !!v && (!f.from || String(v).slice(0, 10) >= f.from) && (!f.to || String(v).slice(0, 10) <= f.to);
			// with a period: tasks created, scheduled, due or completed inside it (same rule as the dashboard)
			if (on) tasks = tasks.filter((t) => [t.creation, t.exp_start_date, t.exp_end_date, t.completed_on].some(inRange));
			this.lastTaskList = tasks;
			const st = this.stats(tasks);
			const done = tasks.filter((t) => t.column === "done");
			const dated = done.filter((t) => t.completed_on && t.exp_end_date);
			const onTime = dated.length ? pct(dated.filter((t) => t.completed_on <= t.exp_end_date).length, dated.length) + "%" : "—";
			const tile = (label, value, tone) => `<div class="tm-kpi tm-kpi-${tone || "grey"}"><div><b>${value}</b><small>${label}</small></div></div>`;
			const overdue = tasks.filter((t) => t.overdue).sort((a, b) => (a.exp_end_date > b.exp_end_date ? 1 : -1));
			const kpis = [
				[__("Total tasks"), st.total, "", "#3b4449"], [__("Completed"), st.done, "green", "#15803d"], [__("Completion rate"), pct(st.done, st.total) + "%", "green", "#15803d"],
				[__("Overdue"), st.overdue, "red", "#d92d20"], [__("Open tasks"), st.total - st.done, "blue", "#1d4ed8"], [__("Completed on time"), onTime, "orange", "#f19f21"],
			];
			const sections = [
				{ title: __("By Status"), icon: "tasks", rows: COL_ORDER.map((c) => ({ label: COLS[c].label, value: st[c], color: COLS[c].color })) },
				{ title: __("By Priority"), icon: "flag", rows: PRIORITIES.map((p) => {
					// one line per priority: open and completed side by side, each in its own colour
					const mine = tasks.filter((t) => t.priority === p), done = mine.filter((t) => t.column === "done").length;
					return { label: __(p), value: mine.length, color: { Urgent: "#b42318", High: "#e5484d", Medium: "#f19f21", Low: "#3b82f6" }[p],
						parts: [{ label: __("Open"), value: mine.length - done, color: "#1d4ed8" }, { label: __("Completed"), value: done, color: "#15803d" }] };
				}) },
				{ title: __("Tasks By Assignee"), icon: "user", rows: this.ownerRows(tasks, (t) => this.assigneeKeys(t), "#3b82f6") },
				{ title: __("Tasks By Department"), icon: "users", rows: this.ownerRows(tasks, (t) => { const d = this.taskDepts(t); return d.length ? d : [__("No department")]; }, "#0ea5a4") },
			];
			const periodText = on ? `${f.from ? moment(f.from).format("DD MMM YYYY") : __("the start")} – ${f.to ? moment(f.to).format("DD MMM YYYY") : __("today")}` : __("All time");
			this.lastReport = { kpis, sections, overdue, periodText, total: tasks.length };
			const presets = [["all", __("All time")], ["today", __("Today")], ["week", __("This week")], ["month", __("This month")], ["last30", __("Last 30 days")], ["custom", __("Custom")]];
			const filter = `<div class="tm-datefilter">${icon("calendar")}
				<select data-change="repPreset">${presets.map(([k, l]) => `<option value="${k}" ${f.preset === k ? "selected" : ""}>${l}</option>`).join("")}</select>
				<input type="date" data-change="repFrom" value="${esc(f.from)}" title="${__("From date")}"><span>${__("to")}</span><input type="date" data-change="repTo" value="${esc(f.to)}" title="${__("To date")}">
				${on ? `<button class="tm-btn tm-btn-sm" data-act="repClear">${__("Clear")}</button>` : ""}</div>`;
			const box = (sec) => `<div class="tm-box"><h3>${sec.title}</h3>${bars(sec.rows, { icon: sec.icon })}</div>`;
			return `<div class="tm-toolbar tm-toolbar-wrap"><h3 class="tm-tb-title">${__("Reports")}</h3><span class="tm-grow"></span>${filter}
					<button class="tm-btn" data-act="exportCsv">${icon("download")}${__("Export CSV")}</button><button class="tm-btn tm-btn-primary" data-act="exportPdf">${icon("download")}${__("Download PDF")}</button></div>
				${on ? `<div class="tm-datefilter-note">${__("Showing tasks created, scheduled, due or completed from {0} to {1}: {2} task(s).", [f.from ? moment(f.from).format("DD MMM YYYY") : __("the start"), f.to ? moment(f.to).format("DD MMM YYYY") : __("today"), tasks.length])}</div>` : ""}
				<div class="tm-kpis">${kpis.map((k) => tile(k[0], k[1], k[2])).join("")}</div>
				<div class="tm-grid tm-grid-2">${sections.slice(0, 2).map(box).join("")}</div>
				${sections.slice(2).map((sec) => `<div class="tm-grid tm-grid-1">${box(sec)}</div>`).join("")}
				<div class="tm-box tm-box-flush"><h3 class="tm-pad-h">${icon("alert")}${__("Overdue Tasks")} <small>(${overdue.length})</small></h3>${overdue.length ? this.taskTable(overdue) : `<div class="tm-muted tm-pad">${__("Nothing is overdue.")}</div>`}</div>`;
		},

		/** The hospital logo as a data URL, so the PDF engine does not have to fetch it. */
		logoData() {
			return (this.logoPromise =
				this.logoPromise ||
				fetch("/assets/task_management/images/hodan-logo.png")
					.then((res) => (res.ok ? res.blob() : Promise.reject()))
					.then((blob) => new Promise((resolve) => {
						const fr = new FileReader();
						fr.onload = () => resolve(fr.result);
						fr.onerror = () => resolve("");
						fr.readAsDataURL(blob);
					}))
					.catch(() => ""));
		},

		async exportPdf() {
			const rp = this.lastReport;
			if (!rp || !rp.total) return frappe.show_alert({ message: __("Nothing to export"), indicator: "orange" });
			frappe.show_alert({ message: __("Preparing the PDF…"), indicator: "blue" });
			const today = moment(this.b.today);
			const html = reportPdfHtml({
				logo: await this.logoData(),
				title: __("Task Management Report"),
				tag: "Hodan Hospital",
				period: rp.periodText,
				scope: "",
				generated: moment().format("DD MMM YYYY, HH:mm"),
				by: this.userName(this.b.user),
				kpis: rp.kpis.map((k) => ({ label: k[0], value: k[1], color: k[3] })),
				rows: [rp.sections.slice(0, 2), [rp.sections[2]], [rp.sections[3]]],
				overdue: rp.overdue.map((t) => ({
					name: t.name,
					subject: t.subject,
					reason: t.tm_delay_reason || "",
					created_by: this.shortName(t.owner),
					// staff by their first two names; the department is the team, the task's own, or the first assignee's
					assignees: t.assignees.map((u) => String(this.userName(u) || "").trim().split(/\s+/).slice(0, 2).join(" ")).join(", "),
					department: t.tm_team || t.department || (t.assignees[0] && this.directory.userDept[t.assignees[0]]) || "",
					priority: __(t.priority || ""),
					end: moment(t.exp_end_date).format("DD MMM YYYY"),
					late: ((n) => (n === 1 ? __("1 day") : __("{0} days", [n])))(Math.max(1, today.diff(moment(t.exp_end_date), "days"))),
				})),
				labels: {
					period: __("Period"), scope: __("Filter"), generated: __("Generated"), overdue: __("Overdue Tasks"), task: __("Task"), assigned: __("Assigned to"),
					department: __("Department"), priority: __("Priority"), end: __("End Date"), late: __("Late by"), nothing: __("Nothing to show."), none_overdue: __("Nothing is overdue."), reason: __("Reason"), created_by: __("Created by"), no_reason: __("No reason given"), unassigned: __("Unassigned"),
				},
				footer: __("Hodan Hospital · Task Management · {0} task(s) in this report", [rp.total]),
			});
			frappe.render_pdf(html, { orientation: "Portrait", report_name: `Task Report ${moment().format("YYYY-MM-DD")}.pdf` });
		},

		// -------------------------------------------------------------- calendar (month grid)
		async calendarHtml() {
			const { start, end } = this.calRange();
			const events = await call("calendar", { start: start.format("YYYY-MM-DD"), end: end.format("YYYY-MM-DD") });
			return this.calGrid(events);
		},

		calRange() {
			const start = this.cal.month.clone().startOf("month").startOf("week");
			return { start, end: start.clone().add(41, "days") };
		},

		// Month grid of tasks on their end date. Every task is in exactly one group, so the four counts add up:
		// Completed; otherwise Overdue (end date passed); otherwise Urgent (priority); otherwise To Do.
		calGrid(events) {
			const CATS = [
				["overdue", __("Overdue"), "#e5731a"],
				["urgent", __("Urgent"), "#b42318"],
				["todo", __("To Do"), "#1d4ed8"],
				["done", __("Completed"), "#15803d"],
			];
			const order = {}, color = {};
			CATS.forEach((c, i) => ((order[c[0]] = i), (color[c[0]] = c[2])));
			const catOf = (e) => (e.column === "done" ? "done" : e.overdue ? "overdue" : e.priority === "Urgent" ? "urgent" : "todo");
			const hide = (this.cal.hide = this.cal.hide || {});
			const { start } = this.calRange();
			const month = this.cal.month.format("YYYY-MM");
			const by = {}, totals = { overdue: 0, urgent: 0, todo: 0, done: 0 };
			events
				.filter((e) => e.kind === "task")
				.forEach((e) => {
					e.cat = catOf(e);
					if (String(e.date).slice(0, 7) === month) totals[e.cat]++;
					(by[e.date] = by[e.date] || []).push(e);
				});
			const MAX = 4;
			let cells = "";
			for (let i = 0; i < 42; i++) {
				const d = start.clone().add(i, "days"), key = d.format("YYYY-MM-DD");
				const all = by[key] || [];
				const n = { overdue: 0, urgent: 0, todo: 0, done: 0 };
				all.forEach((e) => n[e.cat]++);
				// most pressing first: overdue, urgent, to do, completed
				const list = all.filter((e) => !hide[e.cat]).sort((x, y) => order[x.cat] - order[y.cat]);
				const open = this.cal.open === key;
				const chips = (open ? list : list.slice(0, MAX))
					.map(
						(e) => `<button class="tm-cal-ev tm-cal-ev-${e.cat}" style="--ev:${color[e.cat]}" data-act="openTask" data-name="${esc(e.name)}" title="${esc(CATS[order[e.cat]][1])}${e.cat === "overdue" && e.priority === "Urgent" ? " · " + esc(__("Urgent")) : ""}: ${esc(e.title)}">${e.cat === "done" ? `<em class="tm-cal-tick">✓</em>` : ""}${e.cat === "overdue" && e.priority === "Urgent" ? `<em class="tm-cal-bang">!</em>` : ""}${esc(e.title)}</button>`
					)
					.join("");
				const sum = CATS.filter((c) => n[c[0]] && !hide[c[0]]).map((c) => `<b style="color:${c[2]}" title="${esc(c[1])}"><i style="background:${c[2]}"></i>${n[c[0]]}</b>`).join("");
				const more = open
					? `<button class="tm-cal-more" data-act="calOpen" data-day="">${__("Show less")}</button>`
					: list.length > MAX ? `<button class="tm-cal-more" data-act="calOpen" data-day="${key}">${__("+{0} more", [list.length - MAX])}</button>` : "";
				cells += `<div class="tm-cal-cell ${d.month() !== this.cal.month.month() ? "is-out" : ""} ${d.isSame(moment(), "day") ? "is-today" : ""} ${open ? "is-open" : ""}"><div class="tm-cal-day"><span class="tm-cal-num">${d.date()}</span><span class="tm-cal-sum">${sum}</span></div>${chips}${more}</div>`;
			}
			const dow = Array.from({ length: 7 }, (_, i) => `<b>${start.clone().add(i, "days").format("ddd")}</b>`).join("");
			// the legend doubles as a filter: click a group to hide or show it; the numbers are this month's tasks
			const keys = CATS.map((c) => `<button class="tm-cal-chip ${hide[c[0]] ? "is-off" : ""}" style="--ev:${c[2]}" data-act="calKey" data-cat="${c[0]}" title="${__("Click to show or hide")}"><i></i>${esc(c[1])}<b>${totals[c[0]]}</b></button>`).join("");
			return `<div class="tm-box tm-box-flush tm-cal">
				<div class="tm-cal-head"><button class="tm-icon-btn tm-icon-btn-box" data-act="calMove" data-step="-1">${icon("chevLeft")}</button><h3>${this.cal.month.format("MMMM YYYY")}</h3><button class="tm-icon-btn tm-icon-btn-box" data-act="calMove" data-step="1">${icon("chevRight")}</button>
					<button class="tm-btn tm-btn-sm" data-act="calMove" data-step="0">${__("Today")}</button><span class="tm-grow"></span>
					<span class="tm-cal-keys">${keys}</span></div>
				<div class="tm-cal-dow">${dow}</div><div class="tm-cal-grid">${cells}</div></div>`;
		},

	});

	// ================================================================== global views
	Object.assign(task_management.TaskHub.prototype, {
		async cached(key, fn) {
			if (!(key in this.cache)) this.cache[key] = await fn();
			return this.cache[key];
		},

		myTeams() {
			const me = this.b.user;
			return new Set(this.b.teams.filter((t) => t.team_lead === me || t.members.some((m) => m.user === me)).map((t) => t.name));
		},

		isMine(t) {
			return t.assignees.includes(this.b.user) || !!(t.tm_team && this.myTeams().has(t.tm_team));
		},

		mainTeams() {
			const names = new Set(this.b.teams.map((t) => t.name));
			return this.b.teams.filter((t) => !t.parent_team || !names.has(t.parent_team));
		},

		// sub-teams of a main team: `kind` "designation" or "department" narrows it; the ones with staff come first
		subTeams(name, kind) {
			return this.b.teams
				.filter((t) => t.parent_team === name && (!kind || (kind === "designation") === !!t.designation))
				.sort((a, b) => b.members.length - a.members.length || a.team_name.localeCompare(b.team_name));
		},

		// [[designation, members]] of a team, biggest group first, staff without a designation last
		byDesignation(members) {
			const groups = {};
			members.forEach((m) => (groups[m.designation || ""] = groups[m.designation || ""] || []).push(m));
			return Object.entries(groups).sort((a, b) => !a[0] - !b[0] || b[1].length - a[1].length || a[0].localeCompare(b[0]));
		},

		teamTotals(t) {
			const all = [t, ...this.subTeams(t.name)];
			const sum = (k) => all.reduce((n, x) => n + (x[k] || 0), 0);
			return { open: sum("open"), done: sum("done"), overdue: sum("overdue"), people: new Set(all.flatMap((x) => x.members.map((m) => m.user || m.employee))).size };
		},

		/** "Assigned to" in the task table: the department (team, the task's department, or the first assignee's own
		 *  department), then the first assignee by name; further assignees stay as icons that show the name on hover. */
		whoCell(t) {
			const first = t.assignees[0], rest = t.assignees.slice(1);
			const dept = t.tm_team ? this.teamChip(t.tm_team) : this.deptChip(t.department || (first && this.directory.userDept[first]));
			const people = first
				? `<span class="tm-who-name" title="${esc(this.userName(first))}">${esc(this.userName(first))}</span>${rest.length ? this.avatars(rest, 3) : ""}`
				: `<span class="tm-muted">${__("Unassigned")}</span>`;
			return `<div class="tm-who"><div>${dept || `<span class="tm-muted">${__("No department")}</span>`}</div><div class="tm-who-people">${people}</div></div>`;
		},

		deptChip(dept) {
			return dept ? `<span class="tm-team-chip" title="${esc(__("Department: {0}", [dept]))}">${icon("grid")}${esc(dept)}</span>` : "";
		},

		teamChip(team) {
			return team ? `<span class="tm-team-chip" title="${esc(__("Team: {0}", [team]))}">${icon("users")}${esc(team)}</span>` : "";
		},

		findTask(name) {
			for (const key of Object.keys(this.cache)) {
				const v = this.cache[key];
				const list = Array.isArray(v) ? v : (v && v.tasks) || [];
				const t = list.find((x) => x.name === name && x.column);
				if (t) return t;
			}
			return null;
		},

		async viewDashboard() {
			const d = await this.load();
			this.data = d;
			const b = this.b, f = this.dashRange(), on = !!(f.from || f.to), scoped = !!(f.department || f.staff);
			const dir = await this.dir();
			this.staffList(d.tasks);
			const person = f.staff ? dir.byId[f.staff] : null;
			const inRange = (v) => !!v && (!f.from || String(v).slice(0, 10) >= f.from) && (!f.to || String(v).slice(0, 10) <= f.to);
			const scopedTasks = scoped ? this.scopeTasks(d.tasks, f) : d.tasks;
			// with a period: tasks created, scheduled, due or completed inside it
			const all = this.visibleTasks(scopedTasks).filter((t) => !on || [t.creation, t.exp_start_date, t.exp_end_date, t.completed_on].some(inRange));
			const st = this.stats(all);
			const dueToday = all.filter((t) => t.column !== "done" && t.exp_end_date === b.today).length;
			const dueIn = all.filter((t) => t.column !== "done" && inRange(t.exp_end_date)).length;
			let dd = on || scoped ? Object.assign({}, d, { workload: this.workloadOf(all) }) : d;
			if (scoped) {
				// the widgets follow the chosen department / staff member too
				const names = new Set(scopedTasks.map((t) => t.name));
				const act = await this.cached("dashActivity", () => call("activity", { limit: 100 }));
				dd = Object.assign({}, dd, {
					trend: this.trendOf(scopedTasks, (d.trend || []).length || 14),
					activity: act.items.filter((a) => a.reference_doctype === "Task" && names.has(a.reference_name)).slice(0, 8),
				});
			}
			const pick = (kind, label, value) => `<div class="tm-pick ${value ? "is-set" : ""}">${icon(kind === "department" ? "grid" : "user")}
				<input type="text" data-input="dashPick" data-change="dashPickChange" data-kind="${kind}" value="${esc(value)}" placeholder="${label}" autocomplete="off">
				<div class="tm-pick-results" hidden></div></div>`;
			const presets = [["all", __("All time")], ["today", __("Today")], ["week", __("This week")], ["month", __("This month")], ["last30", __("Last 30 days")], ["custom", __("Custom")]];
			const filter = `<div class="tm-datefilter">${pick("department", __("Department"), f.department || "")}${pick("staff", __("Staff"), person ? person.full_name : "")}${icon("calendar")}
				<select data-change="dashPreset">${presets.map(([k, l]) => `<option value="${k}" ${f.preset === k ? "selected" : ""}>${l}</option>`).join("")}</select>
				<input type="date" data-change="dashFrom" value="${esc(f.from)}" title="${__("From date")}"><span>${__("to")}</span><input type="date" data-change="dashTo" value="${esc(f.to)}" title="${__("To date")}">
				${on || scoped ? `<button class="tm-btn tm-btn-sm" data-act="dashClear">${__("Clear")}</button>` : ""}</div>`;
			const noteParts = [];
			if (f.department) noteParts.push(__("Department: {0}", [f.department]));
			if (person) noteParts.push(__("Staff: {0}", [person.full_name]));
			if (on) noteParts.push(__("tasks created, scheduled, due or completed from {0} to {1}", [f.from ? moment(f.from).format("DD MMM YYYY") : __("the start"), f.to ? moment(f.to).format("DD MMM YYYY") : __("today")]));
			const noLogin = person && !person.user ? " " + __("{0} has no login linked yet, so no task can be assigned to them.", [person.full_name]) : "";
			const hour = new Date().getHours();
			const hello = hour < 12 ? __("Good morning") : hour < 17 ? __("Good afternoon") : __("Good evening");
			const tile = (label, value, ic, tone, kpi) =>
				`<button class="tm-kpi tm-kpi-${tone}" data-act="kpi" data-kpi="${kpi}" title="${__("Show these tasks")}"><span>${icon(ic)}</span><div><b>${value}</b><small>${label}</small></div></button>`;
			// what a click on a tile opens: the same tasks the tiles are counting
			const nameSet = (list) => new Set(list.map((t) => t.name));
			this.dashSets = {
				scope: on || scoped ? { names: nameSet(all), label: __("From the dashboard — {0}", [noteParts.join(" · ")]) } : null,
				dueIn: { names: nameSet(all.filter((t) => t.column !== "done" && inRange(t.exp_end_date))), label: __("From the dashboard — open tasks due in the period") + (noteParts.length ? " · " + noteParts.join(" · ") : "") },
			};
			return `${this.head(hello + ", " + (this.userName(b.user).split(" ")[0] || ""), moment().format("dddd, MMMM D, YYYY") + " · " + (b.company || ""), filter)}
				${noteParts.length ? `<div class="tm-datefilter-note">${esc(__("Showing {0}: {1} task(s).", [noteParts.join(" · "), all.length]) + noLogin)}</div>` : ""}
				<div class="tm-kpis">
					${tile(on ? __("All tasks in period") : __("All tasks"), st.total, "tasks", "orange", "all")}${tile(__("Open tasks"), st.total - st.done, "folder", "blue", "open")}${on ? tile(__("Due in period"), dueIn, "clock", "blue", "dueIn") : tile(__("Due today"), dueToday, "clock", "blue", "dueToday")}
					${tile(__("Overdue"), st.overdue, "alert", "red", "overdue")}${tile(__("To Do"), st.todo, "circle", "orange", "todo")}${tile(__("Completed"), st.done, "checkCircle", "green", "done")}
				</div>
				<div class="tm-section-title"><h3>${__("Board at a glance")}</h3><button class="tm-btn tm-btn-sm" data-act="nav" data-to="tasks">${icon("board")}${__("Open Task Board")}</button></div>
				${this.widgets(all, dd)}`;
		},

		dashRange() {
			return (this.dash = this.dash || { preset: "all", from: "", to: "", department: "", staff: "" });
		},

		// same shape as the server's workload: open / done tasks per team (or department)
		workloadOf(tasks) {
			const groups = {};
			tasks.forEach((t) => {
				const key = t.tm_team || t.department;
				if (!key) return;
				const g = (groups[key] = groups[key] || { label: key, kind: t.tm_team ? "team" : "department", open: 0, done: 0, overdue: 0 });
				g[t.column === "done" ? "done" : "open"]++;
				if (t.column !== "done" && t.overdue) g.overdue++;
			});
			return Object.values(groups).sort((a, b) => b.open - a.open || b.done - a.done).slice(0, 6);
		},

		async viewMy() {
			const kind = this.route.kind, meta = MY_KINDS[kind];
			const res = await this.cached("my:" + kind, () => call("my_work", { kind }));
			let body, actions = "";
			if (res.tasks) {
				this.lastTaskList = res.tasks;
				body = this.taskTable(res.tasks, { emptyHint: __("Nothing is waiting for you here.") });
				if (this.b.perms.task_create) actions = `<button class="tm-btn tm-btn-primary" data-act="newTask" data-mine="1" ${kind === "followups" ? 'data-type="Follow-up"' : ""}>${icon("plus")}${__("New Task")}</button>`;
			} else if (res.rounds) {
				body = this.roundsTable(res.rounds);
				if (this.b.perms.round_create) actions = `<button class="tm-btn tm-btn-primary" data-act="newRound" data-mine="1">${icon("plus")}${__("New Round")}</button>`;
			} else {
				body = this.handoverTable(res.handovers);
				if (this.b.perms.handover_create) actions = `<button class="tm-btn tm-btn-primary" data-act="newHandover">${icon("plus")}${__("New Handover")}</button>`;
			}
			const sub = {
				tasks: __("Open tasks assigned to you."),
				followups: __("Your open tasks of type Follow-up."),
				overdue: __("Your open tasks that are past their due date."),
			}[kind];
			return `${this.head(meta.label, sub, actions)}<div class="tm-box tm-box-flush">${body}</div>`;
		},

		async viewActivity() {
			this.actLimit = this.actLimit || 30;
			const res = await call("activity", { limit: this.actLimit, mark_seen: 1 });
			if (this.b.badges.activity) {
				this.b.badges.activity = 0;
				this.renderRail();
			}
			const rows = res.items.filter(taskOnly).map((a) => this.activityRow(a)).join("");
			const table = `<div class="tm-table-wrap"><table class="tm-table tm-table-act"><thead><tr><th>${__("Date")}</th><th>${__("Time")}</th><th>${__("User")}</th><th>${__("Action")}</th><th>${__("Item")}</th><th>${__("Details")}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
			return `${this.head(__("Activity"), __("Updates, comments, assignments and files on tasks."))}
				<div class="tm-box tm-box-flush">${rows ? table : empty(__("No activity yet"))}${res.more ? `<button class="tm-btn tm-load-more" data-act="activityMore">${__("Load more")}</button>` : ""}</div>`;
		},

		async loadChat() {
			const channels = await call("chat_channels");
			const c = this.chat;
			const same = (x) => c.channel && x.doctype === c.channel.doctype && x.name === c.channel.name;
			if (c.channel && c.channel.doctype === "User" && !channels.some(same)) {
				channels.push({ doctype: "User", name: c.channel.name, title: this.userName(c.channel.name), unread: 0, last_text: null }); // new conversation
			}
			const cur = channels.find(same) || channels[0];
			c.channel = cur ? { doctype: cur.doctype, name: cur.name } : null;
			c.msgs = cur ? await call("chat_messages", c.channel) : [];
			if (cur) cur.unread = 0;
			this.b.badges.chat = channels.reduce((s, x) => s + x.unread, 0);
			this.renderRail();
			c.channels = channels;
			c.cur = cur;
		},

		async viewChat() {
			await this.loadChat();
			const c = this.chat, cur = c.cur;
			const enter = this.prefs.enter !== false;
			return `${this.head(__("Chat"), __("Message a colleague directly, or use the General and team channels."), `<button class="tm-btn tm-btn-primary" data-act="chatNew">${icon("plus")}${__("New Message")}</button>`)}
				<div class="tm-chat">
					<div class="tm-chat-list">
						<label class="tm-chat-search">${icon("search")}<input type="search" data-input="chatSearch" value="${esc(c.q || "")}" placeholder="${__("Search channels and people")}"></label>
						<div class="tm-chat-items">${this.chatListHtml()}</div>
					</div>
					<div class="tm-chat-main">${cur ? `${this.chatHeadHtml()}
						<div class="tm-chat-find" ${c.findOn ? "" : "hidden"}>${icon("search")}<input type="search" data-input="chatFind" value="${esc(c.find || "")}" placeholder="${__("Search in this conversation")}"><button class="tm-icon-btn tm-icon-btn-sm" data-act="chatFindToggle" title="${__("Close search")}">${icon("x")}</button></div>
						<div class="tm-chat-thread">${this.chatThreadHtml()}</div>
						<footer><button class="tm-icon-btn tm-icon-btn-box tm-emoji-btn" data-act="chatEmojiOpen" title="${__("Emoji")}">${icon("smile")}</button><textarea class="tm-chat-input" rows="1" data-input="chatDraft" ${enter ? 'data-enter="chatSend"' : 'data-ctrl-enter="chatSend"'} placeholder="${enter ? __("Write a message… (Enter to send, Shift + Enter for a new line)") : __("Write a message… (Ctrl + Enter to send)")}">${esc(c.draft || "")}</textarea><button class="tm-send" data-act="chatSend" title="${__("Send")}">${icon("send")}</button></footer>` : empty(__("Select a channel"))}</div>
				</div>`;
		},

		chatHeadHtml() {
			const cur = this.chat.cur;
			let sub = this.chatKind(cur), extra = "";
			if (cur.doctype === "Task Team") {
				const t = this.b.teams.find((x) => x.name === cur.name);
				if (t) sub += " · " + __("{0} member(s)", [t.members.length]);
				extra = `<button class="tm-btn tm-btn-sm" data-act="go" data-path="team/${esc(encodeURIComponent(cur.name))}">${icon("users")}${__("Open team")}</button>`;
			} else if (cur.doctype === "User") {
				const p = ((this.directory && this.directory.staff) || []).find((x) => x.user === cur.name);
				sub = (p && [p.designation, p.department].filter(Boolean).join(" · ")) || sub;
			}
			const lead = cur.doctype === "User" ? this.avatar(cur.name, "lg") : `<span class="tm-sq tm-sq-md" style="background:${colorOf(cur.name)}">${icon(cur.doctype === "Page" ? "chat" : "users")}</span>`;
			return `<header>${lead}<div class="tm-chat-title"><b>${esc(cur.title)}</b><small>${esc(sub)}</small></div><span class="tm-grow"></span>${extra}
				<button class="tm-icon-btn tm-icon-btn-sm" data-act="chatFindToggle" title="${__("Search in this conversation")}">${icon("search")}</button></header>`;
		},

		// the messages of the open conversation: grouped per day and per sender, optionally narrowed by the search box
		chatThreadHtml() {
			const c = this.chat, me = this.b.user, q = (c.find || "").trim().toLowerCase();
			const all = c.msgs || [];
			if (!all.length) return `<div class="tm-chat-empty">${icon("chat")}<b>${__("No messages yet")}</b><span>${__("Say hello to start the conversation.")}</span></div>`;
			const msgs = q ? all.filter((m) => String(m.text || "").toLowerCase().includes(q)) : all;
			if (!msgs.length) return `<div class="tm-chat-empty">${icon("search")}<b>${__("No message matches “{0}”", [esc(c.find.trim())])}</b></div>`;
			const dm = c.cur && c.cur.doctype === "User";
			const today = moment().format("YYYY-MM-DD"), yesterday = moment().subtract(1, "days").format("YYYY-MM-DD");
			let lastDay = "", lastUser = "";
			const rows = msgs.map((m) => {
				const day = String(m.creation).slice(0, 10);
				let sep = "";
				if (day !== lastDay) {
					sep = `<div class="tm-chat-day">${day === today ? __("Today") : day === yesterday ? __("Yesterday") : moment(day).format("ddd, MMM D")}</div>`;
					lastUser = "";
				}
				lastDay = day;
				const mine = m.user === me, cont = m.user === lastUser;
				lastUser = m.user;
				const tick = mine && dm ? `<i class="tm-msg-tick ${m.is_read ? "is-read" : ""}" title="${m.is_read ? __("Seen") : __("Sent")}">${m.is_read ? "✓✓" : "✓"}</i>` : "";
				const lead = mine
					? `<button class="tm-msg-del" data-act="chatDelete" data-id="${esc(m.name)}" title="${__("Delete message")}">${icon("trash")}</button>`
					: cont ? `<span class="tm-msg-gap"></span>` : this.avatar(m.user, "lg");
				return `${sep}<div class="tm-msg ${mine ? "is-mine" : ""} ${cont ? "is-cont" : ""}">${lead}<div><small>${mine || cont ? "" : `<b>${esc(this.userName(m.user))}</b> · `}${moment(m.creation).format("HH:mm")}${tick}</small><p>${linkify(esc(m.text))}</p></div></div>`;
			});
			return (q ? `<div class="tm-chat-day">${__("{0} of {1} messages", [msgs.length, all.length])}</div>` : "") + rows.join("");
		},

		/** New data for the open conversation without redrawing the page, so the message box keeps its text and focus. */
		async refreshChat() {
			const el = this.$content.find(".tm-chat-thread")[0], before = this.chat.cur;
			if (!el || !before) return this.renderContent(true);
			const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
			await this.loadChat();
			const cur = this.chat.cur;
			if (this.route.view !== "chat") return;
			if (!cur || cur.doctype !== before.doctype || cur.name !== before.name) return this.renderContent(true);
			this.$content.find(".tm-chat-items").html(this.chatListHtml());
			this.$content.find(".tm-chat-thread").html(this.chatThreadHtml());
			if (atEnd) this.scrollChat();
		},

		chatKind(x) {
			return x.doctype === "User" ? __("Direct message") : x.doctype === "Page" ? __("Everyone") : __("Team channel");
		},

		// the channel list; with a search text it looks through every channel and every colleague
		chatListHtml() {
			const c = this.chat, channels = c.channels || [], cur = c.cur, q = (c.q || "").trim().toLowerCase();
			const item = (x) => `<button class="tm-ch ${cur === x ? "is-active" : ""}" data-act="chatOpen" data-doctype="${esc(x.doctype)}" data-name="${esc(x.name)}">
				${x.doctype === "User" ? this.avatar(x.name, "lg") : `<span class="tm-sq tm-sq-md" style="background:${colorOf(x.name)}">${icon(x.doctype === "Page" ? "chat" : "users")}</span>`}
				<span><b>${esc(x.title)}</b><small>${esc(x.last_text || x.hint || this.chatKind(x))}</small></span>${x.unread ? `<em>${x.unread}</em>` : ""}</button>`;
			const people = channels.filter((x) => x.doctype === "User");
			const groups = channels.filter((x) => x.doctype !== "User");
			if (q) {
				const hit = (x) => String(x.title || "").toLowerCase().includes(q);
				const known = new Set(people.map((x) => x.name));
				const others = this.b.users
					.filter((u) => u.name !== this.b.user && !known.has(u.name) && ((u.full_name || "").toLowerCase().includes(q) || u.name.toLowerCase().includes(q)))
					.slice(0, 15)
					.map((u) => ({ doctype: "User", name: u.name, title: u.full_name || u.name, hint: __("Start a conversation") }));
				const dm = people.filter(hit).concat(others), ch = groups.filter(hit);
				if (!dm.length && !ch.length) return `<div class="tm-muted tm-chat-hint">${__("Nothing matches “{0}”.", [esc(c.q.trim())])}</div>`;
				return `${dm.length ? `<h5>${__("People")}</h5>${dm.map(item).join("")}` : ""}${ch.length ? `<h5>${__("Channels")}</h5>${ch.map(item).join("")}` : ""}`;
			}
			const shown = c.allChannels ? groups : groups.filter((x) => x.doctype === "Page" || x.last_text || cur === x || this.myTeams().has(x.name));
			return `<h5>${__("Direct Messages")}<button data-act="chatNew" title="${__("Message a person")}">${icon("plus")}</button></h5>
				${people.map(item).join("") || `<div class="tm-muted tm-chat-hint">${__("No conversations yet. Use + to message a colleague.")}</div>`}
				<h5>${__("Channels")}</h5>${shown.map(item).join("")}
				${groups.length > shown.length || c.allChannels ? `<button class="tm-side-more" data-act="chatAllChannels">${c.allChannels ? __("Show fewer channels") : __("Show all {0} team channels", [groups.length - 1])}</button>` : ""}`;
		},

		scrollChat() {
			const el = this.$content.find(".tm-chat-thread")[0];
			if (el) el.scrollTop = el.scrollHeight;
		},

		onChatEvent(m) {
			if (!this.visible() || !m || m.by === this.b.user) return;
			if (this.route.view === "chat") this.refreshChat();
			else this.poll();
		},

		viewTeams() {
			const cards = this.mainTeams()
				.map((t) => {
					const kids = this.subTeams(t.name), tot = this.teamTotals(t), total = tot.open + tot.done;
					return `<div class="tm-tcard" data-act="go" data-path="team/${esc(encodeURIComponent(t.name))}">
						<div class="tm-pcard-top"><span class="tm-sq tm-sq-lg" style="background:${t.color || colorOf(t.name)}">${icon("users")}</span><div><b>${esc(t.team_name)}</b><small>${esc(t.department || __("No department"))}</small></div>
							${this.b.perms.team_create ? `<button class="tm-icon-btn tm-icon-btn-sm" data-act="editTeam" data-name="${esc(t.name)}" title="${__("Edit team")}">${icon("edit")}</button>` : ""}</div>
						<div class="tm-subteams">${kids.slice(0, 5).map((k) => `<a class="tm-chip ${k.designation ? "tm-chip-des" : ""}" data-act="go" data-path="team/${esc(encodeURIComponent(k.name))}" >${esc(k.team_name)}${k.members.length ? ` <i>${k.members.length}</i>` : ""}</a>`).join("")}${kids.length > 5 ? `<span class="tm-chip tm-chip-warm">${__("+{0} more", [kids.length - 5])}</span>` : ""}${kids.length ? "" : `<span class="tm-muted">${esc(t.description || __("No sub-teams"))}</span>`}</div>
						<div class="tm-tcard-people">${this.avatars(t.members.map((m) => m.user || m.full_name), 6)}<span class="tm-muted">${__("{0} member(s)", [tot.people])}${kids.length ? " · " + __("{0} sub-team(s)", [kids.length]) : ""}</span></div>
						<div class="tm-pcard-prog"><span>${__("Completed")}</span><b>${pct(tot.done, total)}%</b></div><div class="tm-progress"><i style="width:${pct(tot.done, total)}%"></i></div>
						<div class="tm-pcard-foot"><span>${icon("tasks")}${__("{0} open", [tot.open])}</span>${tot.overdue ? `<span class="tm-late">${icon("alert")}${__("{0} overdue", [tot.overdue])}</span>` : ""}<span class="tm-grow"></span>${t.team_lead ? `<span>${__("Lead")}: ${esc(this.userName(t.team_lead))}</span>` : ""}</div>
					</div>`;
				})
				.join("");
			const add = this.b.perms.team_create ? `<button class="tm-btn tm-btn-primary" data-act="newTeam">${icon("plus")}${__("New Team")}</button>` : "";
			return `${this.head(__("Teams"), __("Main department teams, their sub-teams by designation, members and current workload."), add)}
				<div class="tm-pcards">${cards || empty(__("No teams yet"), __("Create teams such as Medical, Surgery, ICU or Nursing and add their members."), add)}</div>`;
		},

		async viewTeam() {
			const t = this.b.teams.find((x) => x.name === this.route.team);
			if (!t) return empty(__("Team not found"), "", `<button class="tm-btn" data-act="nav" data-to="teams">${__("All teams")}</button>`);
			const tasks = await this.cached("team:" + t.name, () => call("team_tasks", { team: t.name }));
			this.lastTaskList = tasks;
			const st = this.stats(tasks), me = this.b.user;
			const subBox = (title, ic, list) =>
				list.length ? `<div class="tm-box tm-box-subteams"><h3>${icon(ic)}${title} <small>(${list.length})</small></h3><div class="tm-subteams">${list.map((k) => `<a class="tm-chip ${k.designation ? "tm-chip-des" : ""}" data-act="go" data-path="team/${esc(encodeURIComponent(k.name))}">${esc(k.team_name)}${k.members.length ? ` <i>${k.members.length}</i>` : ""}${k.open ? ` <b>${k.open}</b>` : ""}</a>`).join("")}</div></div>` : "";
			const actions = `${this.b.perms.task_create ? `<button class="tm-btn tm-btn-primary" data-act="newTask" data-team="${esc(t.name)}">${icon("plus")}${__("New Task for this Team")}</button>` : ""}
				<button class="tm-btn" data-act="chatOpen" data-doctype="Task Team" data-name="${esc(t.name)}">${icon("chat")}${__("Team Chat")}</button>
				${this.b.perms.team_create && !t.parent_team ? `<button class="tm-btn" data-act="newTeam" data-parent="${esc(t.name)}">${icon("plus")}${__("Sub-team")}</button>` : ""}
				${this.b.perms.team_create ? `<button class="tm-btn" data-act="editTeam" data-name="${esc(t.name)}">${icon("edit")}${__("Edit Team")}</button>` : ""}`;
			const member = (m) => {
				const name = m.full_name || this.userName(m.user);
				const role = m.role || (m.user && t.team_lead === m.user ? __("Team Lead") : m.designation || __("Member"));
				const extra = m.user ? __("{0} open", [tasks.filter((x) => x.column !== "done" && x.assignees.includes(m.user)).length]) : "";
				return `<div>${this.avatar(m.user || name, "lg")}<span><b>${esc(name)}</b><small>${esc(role)}${extra ? " · " + extra : ""}</small></span>
					${m.user && m.user !== me ? `<button class="tm-icon-btn tm-icon-btn-sm" data-act="chatOpen" data-doctype="User" data-name="${esc(m.user)}" title="${__("Send a message")}">${icon("chat")}</button>` : ""}</div>`;
			};
			const groups = this.byDesignation(t.members);
			const people = groups.length > 1
				? groups.map(([d, list]) => `<div class="tm-people-group"><b>${esc(d || __("No designation"))}</b><small>${list.length}</small></div><div class="tm-people">${list.map(member).join("")}</div>`).join("")
				: `<div class="tm-people">${t.members.map(member).join("")}</div>`;
			return `<div class="tm-crumbs"><a data-act="nav" data-to="teams">${__("Teams")}</a>${t.parent_team ? `${icon("chevRight")}<a data-act="go" data-path="team/${esc(encodeURIComponent(t.parent_team))}">${esc(t.parent_team)}</a>` : ""}${icon("chevRight")}<span>${esc(t.team_name)}</span></div>
				${this.head(t.team_name, [t.department, t.designation && t.designation !== t.team_name ? t.designation : "", t.description].filter(Boolean).join(" · "), actions)}
				${subBox(__("Sub-teams by designation"), "users", this.subTeams(t.name))}
				<div class="tm-grid tm-grid-team">
					<div class="tm-box"><h3>${icon("users")}${__("Members")} <small>(${t.members.length})</small></h3><div class="tm-people-scroll">${t.members.length ? people : `<div class="tm-muted tm-pad">${__("No members yet. Use Edit Team to add them.")}</div>`}</div></div>
					<div class="tm-box"><h3>${icon("clock")}${__("Team Progress")}</h3><div class="tm-donut-wrap">${donut(LEGEND_ORDER.map((c) => ({ value: st[c], color: COLS[c].color })), pct(st.done, st.total) + "%", __("Done"))}
						<div class="tm-donut-legend">${LEGEND_ORDER.map((c) => `<div><i style="background:${COLS[c].color}"></i><span>${COLS[c].label}</span><b>${st[c]}</b></div>`).join("")}</div></div></div>
				</div>
				<div class="tm-box tm-box-flush"><h3 class="tm-pad-h">${icon("tasks")}${__("Team Tasks")} <small>(${tasks.length})</small></h3>${this.taskTable(tasks, { emptyHint: __("Assign a task to this team to list it here.") })}</div>`;
		},

		async viewCalendarPage() {
			return `${this.head(__("Calendar"), __("Tasks shown on their end date."))}${await this.calendarHtml()}`;
		},

		async viewReportsPage() {
			const d = await this.load();
			return `${this.head(__("Reports"), __("Every task you have access to."))}${this.reportsHtml(this.visibleTasks(d.tasks))}`;
		},

		viewSettings() {
			const b = this.b, p = this.prefs, me = b.user;
			const masters = [
				["Task", __("Tasks"), "tasks"], ["Task Type", __("Task Types"), "flag"], ["Task Team", __("Teams"), "users"],
				["Department", __("Departments"), "grid"],
			].filter((m) => frappe.model.can_read(m[0]));
			const staff = ((this.directory && this.directory.staff) || []).find((x) => x.user === me) || {};
			const roles = ["System Manager", "Task Manager", "Task User", "Projects Manager", "Projects User"].filter((r) => (frappe.user_roles || []).includes(r));
			const teams = [...this.myTeams()];
			const seg = (key, opts) => `<div class="tm-seg">${opts.map(([v, l, ic]) => `<button class="${p[key] === v ? "is-active" : ""}" data-act="prefSet" data-key="${key}" data-value="${v}">${ic ? icon(ic) : ""}${l}</button>`).join("")}</div>`;
			const select = (key, value, opts, change) => `<select data-change="${change || "prefSelect"}" data-key="${key}">${opts.map(([v, l]) => `<option value="${v}" ${value === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
			const sw = (attrs, on) => `<label class="tm-switch"><input type="checkbox" ${attrs} ${on ? "checked" : ""}><i></i></label>`;
			const row = (title, sub, control) => `<div class="tm-set-row"><div><b>${title}</b>${sub ? `<small>${sub}</small>` : ""}</div>${control}</div>`;
			const key = (k, text) => `<div class="tm-set-row"><div><b>${text}</b></div><kbd>${k}</kbd></div>`;
			return `${this.head(__("Settings"), __("Your profile, how this page looks and behaves, and the master data behind it."))}
				<div class="tm-box tm-set-profile">
					${this.avatar(me, "xl")}
					<div class="tm-set-who"><h3>${esc(this.userName(me))}</h3><p>${esc([me, staff.designation, staff.department].filter(Boolean).join(" · "))}</p>
						<div class="tm-set-chips">${roles.map((r) => `<span class="tm-chip tm-chip-warm">${esc(__(r))}</span>`).join("")}${teams.slice(0, 4).map((t) => `<a class="tm-team-chip" data-act="go" data-path="team/${esc(encodeURIComponent(t))}">${icon("users")}${esc(t)}</a>`).join("")}${teams.length > 4 ? `<span class="tm-chip">${__("+{0} more", [teams.length - 4])}</span>` : ""}</div></div>
					<div class="tm-set-stats"><div><b>${b.counts.tasks}</b><small>${__("My open tasks")}</small></div><div class="${b.counts.overdue ? "is-red" : ""}"><b>${b.counts.overdue}</b><small>${__("Overdue")}</small></div><div><b>${teams.length}</b><small>${__("My teams")}</small></div></div>
					<div class="tm-set-links"><button class="tm-btn tm-btn-sm" data-act="href" data-url="/app/user-profile">${icon("user")}${__("My profile")}</button><button class="tm-btn tm-btn-sm" data-act="href" data-url="/app">${icon("home")}${__("Back to ERP desk")}</button></div>
				</div>
				<div class="tm-set-grid">
					<div class="tm-box"><h3>${icon("sun")}${__("Appearance")}</h3>
						${row(__("Theme"), __("Light, or dark for night shifts."), seg("theme", [["light", __("Light"), "sun"], ["dark", __("Dark"), "moon"]]))}
						${row(__("Density"), __("Compact shows more rows on one screen."), seg("density", [["comfortable", __("Comfortable")], ["compact", __("Compact")]]))}
					</div>
					<div class="tm-box"><h3>${icon("tasks")}${__("Tasks")}</h3>
						${row(__("Start page"), __("What opens first when you come to Task Management."), select("start", p.start, [["dashboard", __("Dashboard")], ["tasks", __("Tasks")], ["chat", __("Chat")], ["calendar", __("Calendar")]]))}
						${row(__("Default task view"), __("How the Tasks page lists your tasks."), select("view", this.taskView, [["list", __("List")], ["board", __("Board")]], "prefView"))}
					</div>
					<div class="tm-box"><h3>${icon("bell")}${__("Notifications")}</h3>
						${row(__("Sound"), __("Play a sound when a notification arrives."), sw('data-change="prefSound"', window.tm_notify && tm_notify.soundOn()))}
						${row(__("Try it"), __("Shows how a notification looks."), `<button class="tm-btn tm-btn-sm" data-act="testNotify">${icon("bell")}${__("Test notification")}</button>`)}
						<p class="tm-muted tm-pad-t">${__("You are notified on every page of the system when a task is assigned to you or your team, when its status changes, when someone comments on it, and when you get a chat message.")}</p>
					</div>
					<div class="tm-box"><h3>${icon("chat")}${__("Chat")}</h3>
						${row(__("Enter sends the message"), __("Off: Enter starts a new line and Ctrl + Enter sends."), sw('data-change="prefToggle" data-key="enter"', p.enter !== false))}
						<p class="tm-muted tm-pad-t">${__("In a conversation you can add emoji, search the messages, and delete a message you sent. In a direct message ✓✓ means it was seen.")}</p>
					</div>
					${masters.length ? `<div class="tm-box"><h3>${icon("wrench")}${__("Master Data")}</h3><div class="tm-masters">${masters.map((m) => `<button class="tm-btn" data-act="openList" data-doctype="${esc(m[0])}">${icon(m[2])}${m[1]}${icon("external")}</button>`).join("")}</div>
						<p class="tm-muted tm-pad-t">${__("Board columns map to the Task status: To Do = Open, In Progress = Working, In Review = Pending Review, Completed = Completed. Blocked is a tick box on the task, so a blocked task keeps its status.")}</p></div>` : ""}
					<div class="tm-box"><h3>${icon("help")}${__("Shortcuts")}</h3>
						${key("Ctrl + K", __("Search tasks, departments and staff"))}${key("Esc", __("Close the task panel or a menu"))}${key("Enter", __("Send a chat message or a comment"))}
						<div class="tm-form-actions"><button class="tm-btn tm-btn-sm" data-act="help">${icon("help")}${__("Quick guide")}</button><button class="tm-btn tm-btn-sm tm-btn-danger" data-act="prefReset">${icon("refresh")}${__("Reset my preferences")}</button></div>
					</div>
				</div>`;
		},
	});

	// ================================================================== detail panel
	Object.assign(task_management.TaskHub.prototype, {
		async openTask(name, tab) {
			this.panel = { kind: "task", name, tab: tab || "details" };
			await this.loadPanel();
			this.markOpen();
		},

		async openRound(name) {
			this.panel = { kind: "round", name };
			await this.loadPanel();
			this.markOpen();
		},

		markOpen() {
			const name = this.panel && this.panel.name;
			this.$content.find(".is-open").removeClass("is-open");
			if (name) this.$content.find(`[data-name="${name}"][data-act="openTask"], [data-name="${name}"][data-act="openRound"]`).addClass("is-open");
		},

		async loadPanel() {
			const p = this.panel;
			if (!p) return this.renderPanel();
			try {
				const data = await call(p.kind === "task" ? "get_task" : "get_round", { name: p.name });
				if (this.panel !== p) return;
				p.data = data;
			} catch (e) {
				this.panel = null;
			}
			this.renderPanel();
		},

		closePanel() {
			this.panel = null;
			this.renderPanel();
			this.markOpen();
		},

		renderPanel() {
			const p = this.panel;
			this.$root.toggleClass("has-panel", !!(p && p.data));
			if (!p || !p.data) return this.$panel.prop("hidden", true).empty();
			const keep = {};
			let focus = null;
			this.$panel.find("[data-keep]").each((_, el) => {
				keep[el.dataset.keep] = el.value;
				if (document.activeElement === el) focus = el.dataset.keep;
			});
			const scroll = this.$panel.find(".tm-panel-body").scrollTop();
			this.$panel.prop("hidden", false).html(p.kind === "task" ? this.panelTask(p) : this.panelRound(p));
			this.$panel.find("[data-keep]").each((_, el) => {
				if (keep[el.dataset.keep]) el.value = keep[el.dataset.keep];
				if (focus === el.dataset.keep) el.focus();
			});
			this.$panel.find(".tm-panel-body").scrollTop(scroll || 0);
		},

		panelTask(p) {
			const d = p.data, tab = p.tab || "details";
			const ro = d.can_write ? "" : "disabled";
			const ed = !!d.can_edit; // creator or Task Manager: may change the task itself
			const done = d.column === "done";
			const checkDone = d.checklist.filter((c) => c.completed).length;
			const prog = done ? 100 : d.checklist.length ? pct(checkDone, d.checklist.length) : Math.round(d.progress || 0);
			const tabs = [["details", __("Details")], ["subtasks", __("Subtasks") + ` (${d.subtasks.length})`], ["files", __("Files") + ` (${d.files.length})`], ["activity", __("Activity")]];
			const row = (label, value) => `<div class="tm-row"><span>${label}</span><div>${value}</div></div>`;
			let body;
			if (tab === "subtasks") {
				body = `${d.subtasks.map((s) => `<div class="tm-sub"><button class="tm-check ${s.column === "done" ? "is-done" : ""}" data-act="toggleDone" data-name="${esc(s.name)}" ${ro}>${icon(s.column === "done" ? "check" : "circle")}</button>
					<a data-act="openTask" data-name="${esc(s.name)}">${esc(s.subject)}</a>${this.avatars(s.assignees, 1)}</div>`).join("") || `<div class="tm-muted tm-pad">${__("No sub-tasks yet.")}</div>`}
					${ed ? `<div class="tm-inline-add">${icon("plus")}<input type="text" data-keep="sub" data-enter="subAdd" placeholder="${__("Add a sub-task and press Enter")}"></div>` : ""}`;
			} else if (tab === "files") {
				body = `${d.files.map((f) => `<a class="tm-file tm-file-row" href="${esc(f.file_url)}" target="_blank" rel="noopener">${icon("file")}<span><b>${esc(f.file_name || f.file_url)}</b><small>${fileSize(f.file_size)} · ${esc(this.userName(f.owner))} · ${esc(ago(f.creation))}</small></span></a>`).join("") || `<div class="tm-muted tm-pad">${__("No files attached.")}</div>`}
					${d.can_write ? `<button class="tm-btn tm-btn-block" data-act="uploadFile" data-doctype="Task" data-name="${esc(d.name)}">${icon("upload")}${__("Attach a file")}</button>` : ""}`;
			} else if (tab === "activity") {
				body = d.activity.map((a) => this.activityItem(a)).join("") || `<div class="tm-muted tm-pad">${__("No activity yet.")}</div>`;
			} else {
				const who = d.assignees.length
					? `${this.avatar(d.assignees[0])} <b>${esc(this.userName(d.assignees[0]))}</b>${d.assignees.length > 1 ? ` <span class="tm-more" title="${esc(d.assignees.slice(1).map((u) => this.userName(u)).join(", "))}">+${d.assignees.length - 1}</span>` : ""}`
					: `<span class="tm-muted">${__("Unassigned")}</span>`;
				body = `
					${row(__("Status"), `<select class="tm-status-select tm-status-${d.column}" data-change="panelStatus" ${ro}>${COL_ORDER.map((c) => `<option value="${c}" ${d.column === c ? "selected" : ""}>${COLS[c].label}</option>`).join("")}</select>`)}
					${row(__("Priority"), `<select class="tm-prio-select tm-prio-${esc((d.priority || "low").toLowerCase())}" data-change="panelPriority" ${ed ? "" : "disabled"}>${PRIORITIES.map((x) => `<option ${d.priority === x ? "selected" : ""}>${x}</option>`).join("")}</select>`)}
					${row(__("Task Type"), typeTag(d.type) || `<span class="tm-muted">—</span>`)}
					${row(__("Assignee"), who)}
					${row(__("Department"), esc(d.department || "—"))}
					${row(__("Team"), d.tm_team ? `<a data-act="go" data-path="team/${esc(encodeURIComponent(d.tm_team))}">${icon("users")}${esc(d.tm_team)}</a>` : `<span class="tm-muted">—</span>`)}
					${row(__("Related Ref."), d.tm_patient ? `<a class="tm-ref" data-act="openForm" data-doctype="Patient" data-name="${esc(d.tm_patient)}">${icon("user")}${esc(d.tm_patient)}${d.tm_patient_name ? " – " + esc(d.tm_patient_name) : ""}${icon("external")}</a>` : `<span class="tm-muted">—</span>`)}
					${d.parent_task ? row(__("Parent Task"), `<a data-act="openTask" data-name="${esc(d.parent_task)}">${esc(d.parent_subject || d.parent_task)}</a>`) : ""}
					${row(__("End Date"), `<span class="${d.overdue ? "tm-late" : ""}">${icon("calendar")} ${fmtDate(d.exp_end_date)}</span>`)}
					${row(__("Progress"), `<div class="tm-progress"><i style="width:${prog}%"></i></div><b class="tm-prog-n">${prog}%</b>`)}
					${d.column === "blocked" && d.tm_blocked_reason ? `<div class="tm-blocked-note">${icon("alert")}${esc(d.tm_blocked_reason)}</div>` : ""}
					${d.overdue || d.tm_delay_reason ? `<div class="tm-delay-note ${d.overdue ? "is-late" : ""}">${icon("alert")}<div><b>${d.overdue ? __("Overdue — reason for the delay") : __("Reason for the delay")}</b>
						<p>${d.tm_delay_reason ? esc(d.tm_delay_reason) : __("No reason given yet.")}</p>
						${d.can_write ? `<a data-act="updateTask">${d.tm_delay_reason ? __("Change the reason") : __("Write the reason")}</a>` : ""}</div></div>` : ""}
					<h4>${__("Description")}</h4><p class="tm-desc">${esc(d.description) || `<span class="tm-muted">${__("No description.")}</span>`}</p>
					<h4>${icon("tasks")}${__("Checklist")} (${checkDone}/${d.checklist.length})</h4>
					${d.checklist.map((c) => `<div class="tm-chk ${c.completed ? "is-on" : ""}"><button class="tm-tick" data-act="checkToggle" data-row="${esc(c.name)}" data-done="${c.completed ? 0 : 1}" ${ro}>${c.completed ? icon("check") : ""}</button><span>${esc(c.title)}</span>${ed ? `<button class="tm-x" data-act="checkDel" data-row="${esc(c.name)}" title="${__("Remove")}">${icon("x")}</button>` : ""}</div>`).join("")}
					${ed ? `<div class="tm-inline-add">${icon("plus")}<input type="text" data-keep="chk" data-enter="checkAdd" placeholder="${__("Add checklist item")}"></div>` : ""}
					${d.links.length ? `<h4>${__("Related Links")}</h4><div class="tm-links">${d.links.map((l) => `<a class="tm-chip tm-chip-warm" data-act="openForm" data-doctype="${esc(l.doctype)}" data-name="${esc(l.name)}">${icon("file")}${esc(l.label)}</a>`).join("")}</div>` : ""}
					<h4>${__("Comments")} ${d.comments.length ? `(${d.comments.length})` : ""}</h4>
					${d.comments.map((c) => `<div class="tm-comment">${this.avatar(c.comment_email, "lg")}<div><b>${esc(this.userName(c.comment_email) || c.comment_by)}</b><time>${esc(ago(c.creation))}</time><p>${esc(c.content)}</p></div></div>`).join("")}`;
			}
			return `<header class="tm-panel-head"><span class="tm-phead-ic tm-phead-ic-sm">${icon("file")}</span><b title="${esc(d.subject)}">${esc(d.subject)}</b>
					<button class="tm-icon-btn tm-icon-btn-sm" data-act="openForm" data-doctype="Task" data-name="${esc(d.name)}" title="${__("Open full form")}">${icon("external")}</button>
					<button class="tm-icon-btn tm-icon-btn-sm" data-act="closePanel" title="${__("Close")}">${icon("x")}</button></header>
				<div class="tm-panel-tabs">${tabs.map(([k, l]) => `<button class="${tab === k ? "is-active" : ""}" data-act="panelTab" data-tab="${k}">${l}</button>`).join("")}</div>
				<div class="tm-panel-body">${body}</div>
				<footer class="tm-panel-foot">
					${tab === "details" ? `<div class="tm-comment-box"><input type="text" data-keep="comment" data-enter="commentSend" placeholder="${__("Add a comment…")}"><button class="tm-send" data-act="commentSend">${icon("send")}</button></div>` : ""}
					${d.owner ? `<div class="tm-created-by">${this.avatar(d.owner)}<span>${__("Created by")} <b>${esc(this.userName(d.owner))}</b> · ${fmtDate(d.creation)}</span></div>` : ""}
					<div class="tm-panel-actions">${d.can_write ? `<button class="tm-btn tm-btn-sm tm-btn-primary" data-act="updateTask" data-name="${esc(d.name)}">${icon("check")}${__("Update Status")}</button>${ed ? `<button class="tm-btn tm-btn-sm" data-act="assign" data-name="${esc(d.name)}">${icon("userPlus")}${__("Assign")}</button><button class="tm-btn tm-btn-sm" data-act="editTask" title="${__("Edit task")}">${icon("edit")}</button>` : ""}` : ""}<span class="tm-grow"></span>${d.can_delete ? `<button class="tm-btn tm-btn-sm tm-btn-danger" data-act="deleteTask">${icon("trash")}</button>` : ""}</div>
				</footer>`;
		},

		panelRound(p) {
			const d = p.data;
			const row = (label, value) => `<div class="tm-row"><span>${label}</span><div>${value}</div></div>`;
			const seen = d.patients.filter((x) => x.seen).length;
			const next = { Scheduled: ["In Progress", __("Start round")], "In Progress": ["Completed", __("Complete round")], Completed: ["In Progress", __("Reopen")], Cancelled: ["Scheduled", __("Reschedule")] }[d.status];
			return `<header class="tm-panel-head"><span class="tm-phead-ic tm-phead-ic-sm" style="background:#3b82f6">${icon("pulse")}</span><b title="${esc(d.title)}">${esc(d.title)}</b>
					<button class="tm-icon-btn tm-icon-btn-sm" data-act="openForm" data-doctype="Clinical Round" data-name="${esc(d.name)}" title="${__("Open full form")}">${icon("external")}</button>
					<button class="tm-icon-btn tm-icon-btn-sm" data-act="closePanel">${icon("x")}</button></header>
				<div class="tm-panel-body">
					${row(__("Status"), genericPill(d.status, TONES[d.status]))}
					${row(__("Type"), typeTag(d.round_type))}
					${row(__("When"), `${icon("calendar")} ${fmtDate(d.round_date)} ${esc(String(d.round_time || "").slice(0, 5))}`)}
					${row(__("Ward / Unit"), esc(d.service_unit || d.department || "—"))}
					${row(__("Lead"), d.lead ? `${this.avatar(d.lead)} <b>${esc(this.userName(d.lead))}</b>` : "—")}
					${d.task ? row(__("Task"), `<a data-act="openTask" data-name="${esc(d.task)}">${esc(d.task)}</a>`) : ""}
					${row(__("Progress"), `<div class="tm-progress"><i style="width:${pct(seen, d.patients.length)}%"></i></div><b class="tm-prog-n">${seen}/${d.patients.length}</b>`)}
					<h4>${icon("bed")}${__("Patients")} (${d.patients.length})</h4>
					${d.patients.map((x) => `<div class="tm-chk ${x.seen ? "is-on" : ""}"><button class="tm-tick" data-act="roundSeen" data-row="${esc(x.name)}" data-seen="${x.seen ? 0 : 1}" ${d.can_write ? "" : "disabled"}>${x.seen ? icon("check") : ""}</button>
						<span><b>${esc(x.patient_name || x.patient)}</b><small>${esc([x.patient, x.bed, x.notes].filter(Boolean).join(" · "))}</small></span>
						<button class="tm-x" data-act="openForm" data-doctype="Patient" data-name="${esc(x.patient)}" title="${__("Open patient")}">${icon("external")}</button></div>`).join("") || `<div class="tm-muted tm-pad">${__("No patients on this round. Use Edit to add them.")}</div>`}
					${d.notes ? `<h4>${__("Notes")}</h4><p class="tm-desc">${esc(d.notes)}</p>` : ""}
				</div>
				<footer class="tm-panel-foot"><div class="tm-panel-actions">
					${d.can_write && next ? `<button class="tm-btn tm-btn-sm tm-btn-primary" data-act="roundStatus" data-status="${next[0]}">${next[1]}</button>` : ""}
					${d.can_write ? `<button class="tm-btn tm-btn-sm" data-act="editRound">${icon("edit")}${__("Edit")}</button>` : ""}<span class="tm-grow"></span><span class="tm-muted">${esc(d.name)}</span></div></footer>`;
		},
	});

	// ================================================================== dialogs
	Object.assign(task_management.TaskHub.prototype, {
		userPills(fieldname, label) {
			const users = this.b.users;
			return {
				fieldname, label, fieldtype: "MultiSelectPills",
				get_data: (txt) =>
					users
						.filter((u) => !txt || (u.full_name + " " + u.name).toLowerCase().includes(String(txt).toLowerCase()))
						.slice(0, 25)
						.map((u) => ({ value: u.name, description: u.full_name || "" })),
			};
		},

		/** frappe.ui.Dialog wrapper: every field is sent (so cleared fields are really cleared). */
		dialog(title, fields, values, submit, primary) {
			const d = new frappe.ui.Dialog({
				title, fields,
				primary_action_label: primary || __("Save"),
				primary_action: async () => {
					const v = d.get_values();
					if (!v) return;
					const data = {};
					fields.forEach((f) => f.fieldname && (data[f.fieldname] = v[f.fieldname] == null ? "" : v[f.fieldname]));
					d.get_primary_btn().prop("disabled", true);
					try {
						await submit(data, d);
						d.hide();
					} catch (e) {
						d.get_primary_btn().prop("disabled", false);
					}
				},
			});
			d.set_values(values || {});
			d.show();
			return d;
		},

		taskDialog(values, existing) {
			values = values || {};
			const fields = [
				{ fieldname: "subject", label: __("Task"), fieldtype: "Data", reqd: 1 },
				{ fieldtype: "Section Break" },
				{ fieldname: "type", label: __("Task Type"), fieldtype: "Link", options: "Task Type" },
				{ fieldname: "column", label: __("Status"), fieldtype: "Select", options: COL_ORDER.map((c) => ({ value: c, label: COLS[c].label })), default: "todo" },
				{ fieldname: "priority", label: __("Priority"), fieldtype: "Select", options: ["Low", "Medium", "High", "Urgent"], default: "Medium" },
				{ fieldname: "exp_start_date", label: __("Start Date"), fieldtype: "Date" },
				{ fieldname: "exp_end_date", label: __("End Date"), fieldtype: "Date" },
				{ fieldname: "tm_blocked_reason", label: __("Blocked reason"), fieldtype: "Data", depends_on: "eval:doc.column=='blocked'" },
				{ fieldtype: "Column Break" },
				this.userPills("assignees", __("Assignees")),
				{ fieldname: "department", label: __("Department"), fieldtype: "Link", options: "Department" },
				{ fieldname: "tm_team", label: __("Team"), fieldtype: "Link", options: "Task Team" },
				{ fieldname: "tm_patient", label: __("Patient (Related Ref.)"), fieldtype: "Link", options: "Patient" },
				{ fieldtype: "Section Break" },
				{ fieldname: "description", label: __("Description"), fieldtype: "Small Text" },
			];
			if (!existing) fields.push({ fieldname: "checklist", label: __("Checklist (one item per line)"), fieldtype: "Small Text" });
			fields.push({ fieldname: "tm_delay_reason", label: __("Reason"), fieldtype: "Small Text", description: __("If the task is delayed or overdue: why?") });
			const defaults = Object.assign({ column: "todo", priority: "Medium", assignees: [] }, values);
			this.dialog(existing ? __("Edit Task") : __("New Task"), fields, defaults, async (data) => {
				if (existing) {
					data.name = existing.name;
					if ((data.description || "") === (existing.description || "")) delete data.description; // keep rich text untouched
				} else {
					data.checklist = String(data.checklist || "").split("\n").map((s) => s.trim()).filter(Boolean);
					if (values.parent_task) data.parent_task = values.parent_task;
				}
				data.assignees = data.assignees || [];
				// a task must belong to someone (the server checks this too)
				if (!data.assignees.length && !data.department && !data.tm_team && !values.parent_task) {
					frappe.msgprint({ title: __("Nobody owns this task"), message: __("Assign the task to at least one staff member, a department or a team."), indicator: "orange" });
					throw new Error("no owner");
				}
				const name = await call("save_task", { data });
				frappe.show_alert({ message: existing ? __("Task updated") : __("Task created"), indicator: "green" });
				if (!existing) this.panel = { kind: "task", name, tab: "details" };
				await this.reload();
			}, existing ? __("Save") : __("Create Task"));
		},

		roundDialog(values, existing) {
			const rows = ((existing && existing.patients) || []).map((p) => ({ patient: p.patient, bed: p.bed, notes: p.notes, seen: p.seen, inpatient_record: p.inpatient_record }));
			const fields = [
				{ fieldname: "title", label: __("Title"), fieldtype: "Data", reqd: 1 },
				{ fieldtype: "Section Break" },
				{ fieldname: "round_type", label: __("Round Type"), fieldtype: "Select", reqd: 1, options: ["Ward Round", "Consultant Round", "Post-Operative Round", "Nursing Round", "ICU Round", "Discharge Planning", "Multidisciplinary Meeting", "Surgical List"] },
				{ fieldname: "round_date", label: __("Date"), fieldtype: "Date", reqd: 1 },
				{ fieldname: "round_time", label: __("Time"), fieldtype: "Time" },
				{ fieldname: "lead", label: __("Round Lead"), fieldtype: "Link", options: "User" },
				{ fieldtype: "Column Break" },
				{ fieldname: "service_unit", label: __("Ward / Unit"), fieldtype: "Link", options: "Healthcare Service Unit" },
				{ fieldname: "department", label: __("Department"), fieldtype: "Link", options: "Department" },
				{ fieldname: "team", label: __("Team"), fieldtype: "Link", options: "Task Team" },
				{ fieldtype: "Section Break", label: __("Patients") },
				{
					fieldname: "patients", fieldtype: "Table", label: __("Patients"), in_place_edit: true, data: rows, get_data: () => rows,
					fields: [
						{ fieldname: "patient", label: __("Patient"), fieldtype: "Link", options: "Patient", in_list_view: 1, reqd: 1 },
						{ fieldname: "bed", label: __("Bed / Room"), fieldtype: "Data", in_list_view: 1 },
						{ fieldname: "notes", label: __("Notes"), fieldtype: "Data", in_list_view: 1 },
					],
				},
				{ fieldtype: "Section Break" },
				{ fieldname: "notes", label: __("Notes"), fieldtype: "Small Text" },
			];
			const defaults = Object.assign({ round_type: "Ward Round", round_date: this.b.today, round_time: "08:00:00" }, values);
			this.dialog(existing ? __("Edit Round") : __("Schedule Clinical Round"), fields, defaults, async (data) => {
				if (existing) data.name = existing.name;
				data.patients = (data.patients || rows).filter((p) => p.patient).map((p) => ({ patient: p.patient, bed: p.bed, notes: p.notes, seen: p.seen, inpatient_record: p.inpatient_record }));
				const name = await call("save_round", { data });
				frappe.show_alert({ message: __("Round saved"), indicator: "green" });
				this.panel = { kind: "round", name };
				await this.reload();
			});
		},

		handoverDialog(values, existing) {
			const fields = [
				{ fieldname: "subject", label: __("Subject"), fieldtype: "Data", reqd: 1 },
				{ fieldtype: "Section Break" },
				{ fieldname: "to_user", label: __("Hand over to"), fieldtype: "Link", options: "User" },
				{ fieldname: "handover_date", label: __("Date"), fieldtype: "Date", reqd: 1 },
				{ fieldname: "shift", label: __("Shift"), fieldtype: "Select", options: ["", "Morning", "Evening", "Night"] },
				{ fieldname: "priority", label: __("Priority"), fieldtype: "Select", options: ["Low", "Medium", "High", "Urgent"] },
				{ fieldtype: "Column Break" },
				{ fieldname: "patient", label: __("Patient"), fieldtype: "Link", options: "Patient" },
				{ fieldname: "service_unit", label: __("Ward / Unit"), fieldtype: "Link", options: "Healthcare Service Unit" },
				{ fieldname: "task", label: __("Related Task"), fieldtype: "Link", options: "Task" },
				{ fieldtype: "Section Break" },
				{ fieldname: "details", label: __("What needs to be done / watched"), fieldtype: "Small Text" },
			];
			const defaults = Object.assign({ handover_date: this.b.today, priority: "Medium" }, values);
			const d = this.dialog(existing ? __("Handover {0}", [existing.name]) : __("New Handover"), fields, defaults, async (data) => {
				if (existing) data.name = existing.name;
				await call("save_handover", { data });
				frappe.show_alert({ message: __("Handover saved"), indicator: "green" });
				await this.reload();
			});
			if (existing) {
				d.set_secondary_action_label(__("Open full form"));
				d.set_secondary_action(() => frappe.set_route("Form", "Task Handover", existing.name));
			}
		},

		teamDialog(existing, defaults) {
			const fields = [
				{ fieldname: "team_name", label: __("Team Name"), fieldtype: "Data", reqd: 1, read_only: existing ? 1 : 0 },
				{ fieldname: "parent_team", label: __("Part of (main team)"), fieldtype: "Link", options: "Task Team", description: __("Leave empty for a main department team."), get_query: () => ({ filters: { parent_team: ["in", ["", null]] } }) },
				{ fieldname: "department", label: __("Department"), fieldtype: "Link", options: "Department" },
				{ fieldname: "designation", label: __("Designation"), fieldtype: "Link", options: "Designation", depends_on: "eval:doc.parent_team", description: __("For a sub-team that groups the staff of a main team by designation.") },
				{ fieldname: "team_lead", label: __("Team Lead"), fieldtype: "Link", options: "User" },
				{ fieldname: "color", label: __("Colour"), fieldtype: "Color" },
				Object.assign(this.userPills("members", __("Members with a login")), { description: __("Staff without a login stay in the team; they are managed in the full Task Team form.") }),
				{ fieldname: "description", label: __("Description"), fieldtype: "Small Text" },
			];
			const values = existing ? Object.assign({}, existing, { members: existing.members.filter((m) => m.user).map((m) => m.user) }) : Object.assign({ members: [] }, defaults);
			this.dialog(existing ? __("Edit Team") : __("New Team"), fields, values, async (data) => {
				if (existing) data.name = existing.name;
				const roles = {};
				((existing && existing.members) || []).forEach((m) => (roles[m.user] = m.role));
				data.members = (data.members || []).map((u) => ({ user: u, role: roles[u] || "" }));
				const name = await call("save_team", { data });
				frappe.show_alert({ message: __("Team saved"), indicator: "green" });
				await this.reload({ keepContent: true });
				if (existing) this.renderContent(true);
				else this.go("team", name);
			});
		},

		// -------------------------------------------------------------- menus / popovers
		closeMenus(target) {
			if (target && $(target).closest(".tm-menu, .tm-pop").length) return;
			this.$root.find(".tm-menu, .tm-pop").remove();
			if (!target || !$(target).closest(".tm-search").length) this.$root.find(".tm-search-results").prop("hidden", true);
		},

		popover(anchor, html, cls) {
			this.$root.find(".tm-menu, .tm-pop").remove();
			const r = anchor.getBoundingClientRect();
			const $m = $(`<div class="${cls || "tm-menu"}"></div>`).html(html).appendTo(this.$root);
			const w = $m.outerWidth() || 220;
			$m.css({ left: Math.max(8, Math.min(r.left, window.innerWidth - w - 12)), top: r.bottom + 6 });
			return $m;
		},

		menu(anchor, items) {
			const html = items
				.map((it) => {
					if (it === "-") return "<hr>";
					const data = Object.keys(it.data || {}).map((k) => `data-${k}="${esc(it.data[k])}"`).join(" ");
					return `<button data-act="${it.act}" ${data} class="${it.danger ? "is-danger" : ""}">${it.icon ? icon(it.icon) : ""}${esc(it.label)}</button>`;
				})
				.join("");
			return this.popover(anchor, html, "tm-menu");
		},

		redrawTasks() {
			if (this.route.view === "work" && this.route.tab === "tasks" && this.data) {
				this.$content.find(".tm-tasks-area").html(this.tasksArea(this.applyFilters(this.taskBase(this.data.tasks))));
			} else this.renderContent(true);
		},

		async moveTask(name, column) {
			const t = this.findTask(name);
			const prev = t && t.column;
			if (prev === column) return;
			if (t) {
				t.column = column; // optimistic: the card moves now, the save follows
				if (column === "done") t.overdue = false;
				this.redrawTasks();
			}
			try {
				await call("move_task", { name, column });
				await this.reload();
			} catch (e) {
				if (t) t.column = prev;
				this.redrawTasks();
			}
		},

		exportCsv() {
			const tasks = this.lastTaskList || [];
			if (!tasks.length) return frappe.show_alert({ message: __("Nothing to export"), indicator: "orange" });
			const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
			const rows = [["ID", "Task", "Type", "Status", "Priority", "Assignees", "Department", "Team", "Patient", "Start", "Due", "Completed On", "Checklist", "Reason for Delay", "Created By", "Created On"]].concat(
				tasks.map((t) => [t.name, t.subject, t.type, COLS[t.column].label, t.priority, t.assignees.map((u) => this.userName(u)).join("; "), t.department, t.tm_team, t.tm_patient_name || t.tm_patient, t.exp_start_date, t.exp_end_date, t.completed_on, t.check_total ? t.check_done + "/" + t.check_total : "", t.tm_delay_reason, this.userName(t.owner), String(t.creation || "").slice(0, 10)])
			);
			const blob = new Blob(["﻿" + rows.map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
			const a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = "tasks-" + this.b.today + ".csv";
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(a.href), 2000);
		},

	});

	// ================================================================== events & actions
	Object.assign(task_management.TaskHub.prototype, {
		bind() {
			const $r = this.$root;
			$r.on("click", "[data-act]", (e) => this.dispatch(e));
			// broken profile pictures become initials ("error" does not bubble, so listen in the capture phase)
			$r[0].addEventListener("error", (e) => {
				const el = e.target;
				if (!el.matches || !el.matches("img.tm-av")) return;
				$(el).replaceWith($("<span>").addClass(el.className).attr("title", el.title).css("background", el.dataset.color).text(el.dataset.initials || "?"));
			}, true);
			$r.on("click", (e) => this.closeMenus(e.target));
			$r.on("change", "[data-change]", (e) => {
				const el = e.currentTarget, fn = this["chg_" + el.dataset.change];
				fn && fn.call(this, el.value, el.dataset, el);
			});
			$r.on("input", "[data-input]", (e) => {
				const el = e.currentTarget, fn = this["inp_" + el.dataset.input];
				fn && fn.call(this, el.value, el);
			});
			$r.on("keydown", "[data-enter]", (e) => {
				if (e.key !== "Enter" || e.shiftKey) return;
				e.preventDefault();
				const el = e.currentTarget, fn = this["act_" + el.dataset.enter];
				fn && fn.call(this, el.dataset, el, e);
			});
			$r.on("keydown", "[data-ctrl-enter]", (e) => {
				if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
				e.preventDefault();
				const el = e.currentTarget, fn = this["act_" + el.dataset.ctrlEnter];
				fn && fn.call(this, el.dataset, el, e);
			});
			$r.on("focusin", '[data-input="dashPick"]', (e) => {
				e.currentTarget.select();
				this.inp_dashPick("", e.currentTarget);
			});
			$(document).on("click.task_hub_pick", (e) => {
				if (!$(e.target).closest(".tm-pick").length) this.$root.find(".tm-pick-results").prop("hidden", true);
			});
			$r.on("click", "select, input, textarea", (e) => e.stopPropagation());
			// drag & drop between board columns
			$r.on("dragstart", ".tm-task", (e) => {
				this.dragging = e.currentTarget.dataset.task;
				const dt = e.originalEvent.dataTransfer;
				if (dt) {
					dt.effectAllowed = "move";
					dt.setData("text/plain", this.dragging);
				}
				$(e.currentTarget).addClass("is-dragging");
			});
			$r.on("dragend", ".tm-task", () => {
				this.dragging = null;
				$r.find(".is-dragging, .is-over").removeClass("is-dragging is-over");
			});
			$r.on("dragover", ".tm-col", (e) => {
				if (!this.dragging) return;
				e.preventDefault();
				$(e.currentTarget).addClass("is-over");
			});
			$r.on("dragleave", ".tm-col", (e) => {
				if (!e.currentTarget.contains(e.relatedTarget)) $(e.currentTarget).removeClass("is-over");
			});
			$r.on("drop", ".tm-col", (e) => {
				e.preventDefault();
				const name = this.dragging;
				this.dragging = null;
				$r.find(".is-over").removeClass("is-over");
				if (name) this.moveTask(name, e.currentTarget.dataset.col);
			});
			$(document).on("keydown.task_hub", (e) => {
				if (frappe.get_route()[0] !== "task-hub" || $(".modal.show").length) return;
				if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
					e.preventDefault();
					this.$root.find('[data-input="search"]').trigger("focus").trigger("select");
				} else if (e.key === "Escape") {
					if (this.$root.find(".tm-menu, .tm-pop").length) this.closeMenus();
					else if (this.panel) this.closePanel();
				}
			});
			this.taskView = localStorage.getItem("tm_task_view") || "list";
			if (!["list", "board"].includes(this.taskView)) this.taskView = "list";
		},

		dispatch(e) {
			const el = e.currentTarget;
			if (el.disabled) return;
			e.stopPropagation();
			if (el.tagName === "A" && !el.getAttribute("href")) e.preventDefault();
			const inMenu = $(el).closest(".tm-menu, .tm-pop").length;
			if (!inMenu) this.closeMenus();
			const fn = this["act_" + el.dataset.act];
			try {
				fn && fn.call(this, el.dataset, el, e);
			} finally {
				if (inMenu) this.$root.find(".tm-menu, .tm-pop").remove();
			}
		},

		// navigation ------------------------------------------------------
		act_nav(ds) {
			if (ds.to === "tasks") this.go("work", "tasks");
			else this.go(ds.to);
		},
		act_go(ds) {
			this.go(...ds.path.split("/").map(decodeURIComponent));
		},
		act_tab(ds) {
			this.go("work", ds.tab);
		},
		act_refresh() {
			this.reload();
		},
		act_openForm(ds) {
			window.open(frappe.utils.get_form_link(ds.doctype, ds.name), "_blank");
		},
		act_openList(ds) {
			window.open("/app/" + frappe.router.slug(ds.doctype), "_blank");
		},
		act_openRef(ds) {
			if (ds.doctype === "Task") this.openTask(ds.name);
			else if (ds.doctype === "Clinical Round") this.openRound(ds.name);
			else if (ds.doctype === "Task Handover") this.act_editHandover(ds);
			else if (ds.doctype === "Task Team") this.act_chatOpen({ doctype: "Task Team", name: ds.name });
			else if (ds.doctype === "Task Chat Message") call("notification_route", { name: ds.id }).then((route) => route && frappe.set_route(...route.split("/")));
			else this.act_openForm(ds);
		},

		// tasks ----------------------------------------------------------
		act_setTaskView(ds) {
			this.taskView = ds.view;
			localStorage.setItem("tm_task_view", ds.view);
			this.renderContent(true);
		},
		act_toggleMine() {
			this.filters.mine = !this.filters.mine;
			this.renderContent(true);
		},
		chg_dashPreset(value) {
			const f = this.dashRange(), day = (m) => m.format("YYYY-MM-DD"), now = () => moment(this.b.today);
			f.preset = value;
			if (value === "all") f.from = f.to = "";
			else if (value === "today") f.from = f.to = day(now());
			else if (value === "week") (f.from = day(now().startOf("week"))), (f.to = day(now().endOf("week")));
			else if (value === "month") (f.from = day(now().startOf("month"))), (f.to = day(now().endOf("month")));
			else if (value === "last30") (f.from = day(now().subtract(29, "days"))), (f.to = day(now()));
			this.renderContent(true);
		},
		chg_dashFrom(value) {
			const f = this.dashRange();
			f.from = value;
			if (f.to && value && f.to < value) f.to = value;
			f.preset = f.from || f.to ? "custom" : "all";
			this.renderContent(true);
		},
		chg_dashTo(value) {
			const f = this.dashRange();
			f.to = value;
			if (f.from && value && f.from > value) f.from = value;
			f.preset = f.from || f.to ? "custom" : "all";
			this.renderContent(true);
		},
		act_dashClear() {
			this.dash = { preset: "all", from: "", to: "", department: "", staff: "" };
			this.renderContent(true);
		},
		// department / staff pickers on the dashboard
		pickMatches(kind, q, max, dept) {
			q = (q || "").trim().toLowerCase();
			const inDept = dept ? this.deptSet(dept) : null; // staff list limited to the chosen department
			if (kind === "department") {
				return this.directory.departments
					.filter((d) => d.name !== "All Departments" && (!q || d.name.toLowerCase().includes(q)))
					.slice(0, max)
					.map((d) => ({ id: d.name, title: d.name, sub: "" }));
			}
			return this.staffList(this.cache.board && this.cache.board.tasks)
				.filter((p) => (!inDept || inDept.has(p.department)) && (!q || p.full_name.toLowerCase().includes(q) || (p.user || "").toLowerCase().includes(q)))
				.slice(0, max)
				.map((p) => ({ id: p.id, title: p.full_name, sub: this.staffSub(p) }));
		},
		async inp_dashPick(value, el) {
			await this.dir();
			const kind = el.dataset.kind, dept = kind === "staff" ? this.dashRange().department : "";
			const rows = this.pickMatches(kind, value, dept ? 500 : 40, dept);
			this.$root.find(".tm-pick-results").prop("hidden", true);
			$(el)
				.siblings(".tm-pick-results")
				.html(rows.map((r) => `<button data-act="dashPickSet" data-kind="${kind}" data-id="${esc(r.id)}"><span><b>${esc(r.title)}</b>${r.sub ? `<small>${esc(r.sub)}</small>` : ""}</span></button>`).join("") || `<div class="tm-muted tm-pad">${dept ? __("No staff found in {0}.", [dept]) : __("Nothing found.")}</div>`)
				.prop("hidden", false);
		},
		chg_dashPickChange(value, ds) {
			// emptying the box removes that filter
			const f = this.dashRange();
			if (value.trim() || !f[ds.kind]) return;
			f[ds.kind] = "";
			this.renderContent(true);
		},
		act_dashPickSet(ds) {
			const f = this.dashRange();
			f[ds.kind] = ds.id;
			// a newly chosen department drops a staff member who is not in it
			const p = f.staff && this.directory.byId[f.staff];
			if (ds.kind === "department" && p && !this.deptSet(ds.id).has(p.department)) f.staff = "";
			this.renderContent(true);
		},
		// date filter of the Tasks tab
		chg_taskPreset(value) {
			const f = this.filters, day = (m) => m.format("YYYY-MM-DD"), now = () => moment(this.b.today);
			f.datePreset = value;
			if (value === "all") f.from = f.to = "";
			else if (value === "today") f.from = f.to = day(now());
			else if (value === "week") (f.from = day(now().startOf("week"))), (f.to = day(now().endOf("week")));
			else if (value === "month") (f.from = day(now().startOf("month"))), (f.to = day(now().endOf("month")));
			else if (value === "last30") (f.from = day(now().subtract(29, "days"))), (f.to = day(now()));
			this.renderContent(true);
		},
		chg_taskFrom(value) {
			const f = this.filters;
			f.from = value;
			if (f.to && value && f.to < value) f.to = value;
			f.datePreset = f.from || f.to ? "custom" : "all";
			this.renderContent(true);
		},
		chg_taskTo(value) {
			const f = this.filters;
			f.to = value;
			if (f.from && value && f.from > value) f.from = value;
			f.datePreset = f.from || f.to ? "custom" : "all";
			this.renderContent(true);
		},
		// Status box in the toolbar: the same filter as the arrow on the Status column
		chg_statusFilter(value) {
			this.colf.status = value;
			this.renderContent(true);
		},
		chg_filter(value, ds) {
			this.filters[ds.key] = value;
			this.redrawTasks();
		},
		inp_taskq(value) {
			this.filters.q = value;
			this.redrawTasks();
		},
		act_expandCol(ds) {
			this.expanded[ds.col] = true;
			this.redrawTasks();
		},
		act_colMenu(ds, el) {
			const items = [{ label: __("Add task here"), icon: "plus", act: "newTask", data: { col: ds.col } }];
			if (this.expanded && this.expanded[ds.col]) items.push({ label: __("Show fewer"), icon: "chevDown", act: "collapseCol", data: { col: ds.col } });
			items.push({ label: __("Export this view (CSV)"), icon: "download", act: "exportCsv" });
			this.menu(el, items);
		},
		act_collapseCol(ds) {
			this.expanded[ds.col] = false;
			this.redrawTasks();
		},
		act_tasksMenu(ds, el) {
			this.menu(el, [
				{ label: __("Refresh"), icon: "refresh", act: "refresh" },
				{ label: __("Export CSV"), icon: "download", act: "exportCsv" },
				{ label: __("Clear filters"), icon: "x", act: "clearFilters" },
				"-",
				{ label: __("Open Task list in ERPNext"), icon: "external", act: "openList", data: { doctype: "Task" } },
			]);
		},
		act_clearFilters() {
			this.filters = { department: "", type: "", priority: "", q: "", mine: false };
			this.colf = { status: "", assignee: "", due: "", progress: "" };
			this.taskScope = null;
			this.renderContent(true);
		},
		act_colMenu(ds, el) {
			const cur = this.colValue(ds.col);
			this.menu(el, this.colOptions(ds.col).map(([value, label]) => ({ label, icon: value === cur ? "check" : "blank", act: "colSet", data: { col: ds.col, value } }))).addClass("tm-menu-scroll");
		},
		act_colSet(ds) {
			if (ds.col === "priority") {
				this.filters.priority = ds.value; // the same filter as the Priority box in the toolbar
				return this.renderContent(true);
			}
			this.colf[ds.col] = ds.value;
			this.redrawTasks();
		},
		// a dashboard tile: open the Tasks list on exactly the tasks it counts
		act_kpi(ds) {
			const sets = this.dashSets || {}, pre = { all: {}, open: { status: "open" }, dueToday: { status: "open", due: "today" }, dueIn: {}, overdue: { due: "overdue" }, todo: { status: "todo" }, done: { status: "done" } }[ds.kpi] || {};
			this.filters = { department: "", type: "", priority: "", q: "", mine: false };
			this.colf = Object.assign({ status: "", assignee: "", due: "", progress: "" }, pre);
			this.taskScope = ds.kpi === "dueIn" ? sets.dueIn : sets.scope || null;
			this.taskView = "list";
			this.go("work", "tasks");
		},
		act_exportCsv() {
			this.exportCsv();
		},
		act_exportPdf() {
			this.exportPdf();
		},
		// reports period filter
		// Task Trend card: period and which lines are shown
		chg_trendPreset(value) {
			const f = this.trendRange(), day = (m) => m.format("YYYY-MM-DD"), now = () => moment(this.b.today);
			f.preset = value;
			if (value === "today") f.from = f.to = day(now());
			else if (value === "last7") (f.from = day(now().subtract(6, "days"))), (f.to = day(now()));
			else if (value === "last30") (f.from = day(now().subtract(29, "days"))), (f.to = day(now()));
			else if (value === "month") (f.from = day(now().startOf("month"))), (f.to = day(now().endOf("month")));
			this.renderContent(true);
		},
		chg_trendFrom(value) {
			const f = this.trendRange();
			if (!value) return this.renderContent(true);
			f.from = value;
			if (f.to < value) f.to = value;
			f.preset = "custom";
			this.renderContent(true);
		},
		chg_trendTo(value) {
			const f = this.trendRange();
			if (!value) return this.renderContent(true);
			f.to = value;
			if (f.from > value) f.from = value;
			f.preset = "custom";
			this.renderContent(true);
		},
		act_trendKey(ds) {
			const f = this.trendRange();
			f.hide[ds.key] = !f.hide[ds.key];
			this.renderContent(true);
		},
		chg_repPreset(value) {
			const f = this.repRange(), day = (m) => m.format("YYYY-MM-DD"), now = () => moment(this.b.today);
			f.preset = value;
			if (value === "all") f.from = f.to = "";
			else if (value === "today") f.from = f.to = day(now());
			else if (value === "week") (f.from = day(now().startOf("week"))), (f.to = day(now().endOf("week")));
			else if (value === "month") (f.from = day(now().startOf("month"))), (f.to = day(now().endOf("month")));
			else if (value === "last30") (f.from = day(now().subtract(29, "days"))), (f.to = day(now()));
			this.renderContent(true);
		},
		chg_repFrom(value) {
			const f = this.repRange();
			f.from = value;
			if (f.to && value && f.to < value) f.to = value;
			f.preset = f.from || f.to ? "custom" : "all";
			this.renderContent(true);
		},
		chg_repTo(value) {
			const f = this.repRange();
			f.to = value;
			if (f.from && value && f.from > value) f.from = value;
			f.preset = f.from || f.to ? "custom" : "all";
			this.renderContent(true);
		},
		act_repClear() {
			this.rep = { preset: "all", from: "", to: "" };
			this.renderContent(true);
		},
		act_newTask(ds) {
			const r = this.route, v = {};
			if (ds.col) v.column = ds.col;
			if (ds.team) v.tm_team = ds.team;
			if (ds.type) v.type = ds.type;
			if (ds.mine) v.assignees = [this.b.user];
			this.taskDialog(v);
		},
		act_openTask(ds) {
			this.openTask(ds.name);
		},
		act_closePanel() {
			this.closePanel();
		},
		act_panelTab(ds) {
			this.panel.tab = ds.tab;
			this.renderPanel();
		},
		act_toggleDone(ds) {
			const t = this.findTask(ds.name);
			const col = t ? t.column : this.panel && this.panel.data && (this.panel.data.subtasks.find((s) => s.name === ds.name) || {}).column;
			this.moveTask(ds.name, col === "done" ? "todo" : "done");
		},
		chg_panelStatus(value) {
			this.moveTask(this.panel.name, value);
		},
		async chg_panelPriority(value) {
			await call("save_task", { data: { name: this.panel.name, priority: value } });
			this.reload();
		},
		canEdit(t) {
			// the creator of a task and full-access users (Task Manager …) change the task itself; an assignee only updates it
			return !!(this.b.perms.full || (t && t.owner === this.b.user));
		},
		act_editTask() {
			const d = this.panel.data;
			this.taskDialog(
				{
					subject: d.subject, type: d.type, column: d.column, priority: d.priority, assignees: d.assignees,
					exp_start_date: d.exp_start_date, exp_end_date: d.exp_end_date, department: d.department, tm_team: d.tm_team,
					tm_patient: d.tm_patient, tm_blocked_reason: d.tm_blocked_reason, tm_delay_reason: d.tm_delay_reason, description: d.description,
				},
				d
			);
		},
		act_deleteTask() {
			const d = this.panel.data;
			frappe.confirm(__("Delete task {0}? This cannot be undone.", [frappe.utils.escape_html(d.subject).bold()]), async () => {
				await call("delete_task", { name: d.name });
				this.panel = null;
				this.renderPanel();
				frappe.show_alert({ message: __("Task deleted"), indicator: "orange" });
				this.reload();
			});
		},
		taskInfo(name) {
			const p = this.panel;
			if (p && p.kind === "task" && p.name === name && p.data) return p.data;
			return this.findTask(name) || { name, subject: name, assignees: [], column: "todo" };
		},
		act_assign(ds) {
			const name = ds.name || (this.panel && this.panel.name);
			const t = this.taskInfo(name);
			const fields = [
				this.userPills("assignees", __("Assign to users")),
				{ fieldname: "tm_team", label: __("Assign to team"), fieldtype: "Link", options: "Task Team", description: __("Every member of the team is notified and sees the task under My Tasks.") },
			];
			this.dialog(__("Assign: {0}", [t.subject]), fields, { assignees: t.column === "done" ? [] : t.assignees, tm_team: t.tm_team }, async (data) => {
				await call("save_task", { data: { name, assignees: data.assignees || [], tm_team: data.tm_team || "" } });
				frappe.show_alert({ message: __("Assignment saved"), indicator: "green" });
				await this.reload();
			}, __("Assign"));
		},
		act_updateTask(ds) {
			const name = ds.name || (this.panel && this.panel.name);
			const t = this.taskInfo(name);
			const fields = [
				{ fieldname: "column", label: __("Status"), fieldtype: "Select", reqd: 1, options: COL_ORDER.map((c) => ({ value: c, label: COLS[c].label })) },
				{ fieldname: "comment", label: __("Comment"), fieldtype: "Small Text", description: __("Optional: what was done, or what is blocking the task.") },
				{
					fieldname: "reason", label: __("Reason"), fieldtype: "Small Text",
					description: t.overdue ? __("This task is overdue. State why, for example: waiting for approval, or waiting for something from outside.") : __("If the task is delayed, state why, for example: waiting for approval, or waiting for something from outside."),
					mandatory_depends_on: t.overdue ? "eval:doc.column!='done'" : "",
				},
			];
			this.dialog(__("Update: {0}", [t.subject]), fields, { column: t.column, reason: t.tm_delay_reason || "" }, async (data) => {
				await call("update_task", { name, column: data.column, comment: data.comment || "", reason: data.reason || "" });
				frappe.show_alert({ message: __("Task updated"), indicator: "green" });
				await this.reload();
			}, __("Update"));
		},
		async act_checkToggle(ds) {
			const row = this.panel.data.checklist.find((c) => c.name === ds.row);
			if (row) row.completed = cint(ds.done);
			this.renderPanel();
			await call("checklist_toggle", { row: ds.row, completed: ds.done });
			this.reload();
		},
		async act_checkAdd(ds, el) {
			const input = this.$panel.find('[data-keep="chk"]')[0];
			const title = (input.value || "").trim();
			if (!title) return;
			input.value = "";
			await call("checklist_add", { task: this.panel.name, title });
			await this.reload();
			this.$panel.find('[data-keep="chk"]').trigger("focus");
		},
		async act_checkDel(ds) {
			await call("checklist_delete", { row: ds.row });
			this.reload();
		},
		async act_subAdd() {
			const input = this.$panel.find('[data-keep="sub"]')[0];
			const subject = (input.value || "").trim();
			if (!subject) return;
			input.value = "";
			input.disabled = true;
			const d = this.panel.data;
			try {
				await call("save_task", { data: { subject, parent_task: d.name, priority: d.priority || "Medium" } });
			} finally {
				await this.reload();
			}
		},
		async act_commentSend() {
			const input = this.$panel.find('[data-keep="comment"]')[0];
			const text = (input.value || "").trim();
			if (!text) return;
			input.value = "";
			await call("add_comment", { task: this.panel.name, text });
			await this.loadPanel();
			const body = this.$panel.find(".tm-panel-body")[0];
			if (body) body.scrollTop = body.scrollHeight;
		},
		act_uploadFile(ds) {
			new frappe.ui.FileUploader({
				doctype: ds.doctype,
				docname: ds.name,
				on_success: () => {
					frappe.show_alert({ message: __("File attached"), indicator: "green" });
					this.reload();
				},
			});
		},

		// preferences -----------------------------------------------------
		chg_prefView(value) {
			this.taskView = value;
			localStorage.setItem("tm_task_view", value);
			frappe.show_alert({ message: __("Preference saved"), indicator: "green" });
		},
		act_prefSet(ds) {
			this.prefs[ds.key] = ds.value;
			this.savePrefs();
			if (this.route.view === "settings") this.renderContent(true);
		},
		chg_prefSelect(value, ds) {
			this.prefs[ds.key] = value;
			this.savePrefs();
			frappe.show_alert({ message: __("Preference saved"), indicator: "green" });
		},
		chg_prefToggle(value, ds, el) {
			this.prefs[ds.key] = el.checked;
			this.savePrefs();
			frappe.show_alert({ message: __("Preference saved"), indicator: "green" });
		},
		act_themeToggle() {
			this.act_prefSet({ key: "theme", value: this.prefs.theme === "dark" ? "light" : "dark" });
		},
		act_prefReset() {
			this.prefs = Object.assign({}, PREF_DEFAULTS);
			this.taskView = "list";
			try {
				localStorage.removeItem("tm_prefs");
				localStorage.removeItem("tm_task_view");
			} catch (e) {
				/* nothing stored */
			}
			this.applyPrefs();
			this.renderContent(true);
			frappe.show_alert({ message: __("Preferences are back to the defaults"), indicator: "green" });
		},

		chg_prefSound(value, ds, el) {
			if (!window.tm_notify) return;
			tm_notify.setSound(el.checked);
			if (el.checked) tm_notify.play();
			if (el.checked && window.Notification && Notification.permission === "default") Notification.requestPermission();
		},
		act_testNotify() {
			if (!window.tm_notify) return frappe.show_alert({ message: __("Reload the page once to switch notifications on."), indicator: "orange" });
			tm_notify.show({ kind: "task", title: __("This is how a notification looks"), body: __("It appears on any page of the system."), route: "task-hub", by: "" });
		},

		// rounds / handover / teams --------------------------------------------
		act_newRound(ds) {
			const r = this.route, v = {};
			if (ds.mine) v.lead = this.b.user;
			this.roundDialog(v);
		},
		act_openRound(ds) {
			this.openRound(ds.name);
		},
		act_editRound() {
			const d = this.panel.data;
			this.roundDialog(
				{ title: d.title, round_type: d.round_type, round_date: d.round_date, round_time: d.round_time, lead: d.lead, service_unit: d.service_unit, department: d.department, team: d.team, notes: d.notes },
				d
			);
		},
		async act_roundStatus(ds) {
			await call("set_round_status", { name: this.panel.name, status: ds.status });
			this.reload();
		},
		async act_roundSeen(ds) {
			const row = this.panel.data.patients.find((x) => x.name === ds.row);
			if (row) row.seen = cint(ds.seen);
			this.renderPanel();
			await call("round_patient_seen", { row: ds.row, seen: ds.seen });
			this.reload();
		},
		act_newHandover() {
			const r = this.route, v = {};
			this.handoverDialog(v);
		},
		async act_editHandover(ds) {
			const h = await frappe.db.get_doc("Task Handover", ds.name);
			this.handoverDialog(
				{ subject: h.subject, to_user: h.to_user, handover_date: h.handover_date, shift: h.shift, priority: h.priority, patient: h.patient, service_unit: h.service_unit, task: h.task, details: h.details },
				h
			);
		},
		async act_handoverStatus(ds) {
			await call("set_handover_status", { name: ds.name, status: ds.status });
			frappe.show_alert({ message: __("Handover {0}", [__(ds.status).toLowerCase()]), indicator: "green" });
			this.reload();
		},
		act_newTeam(ds) {
			this.teamDialog(null, ds.parent ? { parent_team: ds.parent } : null);
		},
		act_toggleTeam(ds) {
			this.openTeams[ds.name] = !this.openTeams[ds.name];
			this.renderSide();
		},
		act_editTeam(ds) {
			this.teamDialog(this.b.teams.find((t) => t.name === ds.name));
		},

		// calendar / activity / chat --------------------------------------------
		act_calMove(ds) {
			const step = cint(ds.step);
			this.cal.month = step ? this.cal.month.clone().add(step, "month") : moment().startOf("month");
			this.cal.open = null;
			this.renderContent(true);
		},
		// legend chip: hide / show one group of tasks
		act_calKey(ds) {
			this.cal.hide = this.cal.hide || {};
			this.cal.hide[ds.cat] = !this.cal.hide[ds.cat];
			this.renderContent(true);
		},
		// "+N more" / "Show less": list every task of that day
		act_calOpen(ds) {
			this.cal.open = ds.day || null;
			this.renderContent(true);
		},
		act_activityMore() {
			this.actLimit += 30;
			this.renderContent(true);
		},
		inp_chatSearch(value) {
			this.chat.q = value;
			this.$content.find(".tm-chat-items").html(this.chatListHtml()); // only the list, so the box keeps the focus
		},
		act_chatOpen(ds) {
			this.chat.channel = { doctype: ds.doctype, name: ds.name };
			this.chat.q = "";
			this.chat.draft = "";
			this.chat.find = "";
			this.chat.findOn = false;
			if (this.route.view === "chat") this.renderContent(true);
			else this.go("chat");
		},
		act_chatNew() {
			const me = this.b.user;
			const to = this.userPills("users", __("To"));
			const all = to.get_data;
			to.get_data = (txt) => all(txt).filter((u) => u.value !== me);
			to.reqd = 1;
			to.description = __("Type a name. The conversation is private between the two of you.");
			this.dialog(__("New Message"), [to], { users: [] }, async (data) => {
				const user = (data.users || [])[0];
				if (!user) throw new Error("no user");
				this.act_chatOpen({ doctype: "User", name: user });
			}, __("Start Chat"));
		},
		act_chatAllChannels() {
			this.chat.allChannels = !this.chat.allChannels;
			this.renderContent(true);
		},
		inp_chatDraft(value, el) {
			this.chat.draft = value;
			if (el && el.scrollHeight) {
				// the box grows with the text, up to a few lines
				el.style.height = "auto";
				el.style.height = Math.min(el.scrollHeight + 2, 120) + "px";
			}
		},
		async act_chatSend() {
			const text = (this.chat.draft || "").trim();
			if (!text || !this.chat.channel) return;
			this.chat.draft = "";
			const $in = this.$content.find(".tm-chat-input").val("").css("height", "");
			try {
				await call("chat_send", Object.assign({ text }, this.chat.channel));
			} catch (e) {
				this.chat.draft = text; // not sent: give the text back
				$in.val(text);
				return;
			}
			await this.refreshChat();
			this.scrollChat();
			this.$content.find(".tm-chat-input").trigger("focus");
		},
		act_chatDelete(ds) {
			const channel = this.chat.channel;
			if (!channel) return;
			frappe.confirm(__("Delete this message? It is removed for everyone in the conversation."), async () => {
				await call("chat_delete", Object.assign({ message: ds.id }, channel));
				this.refreshChat();
			});
		},
		act_chatFindToggle() {
			const c = this.chat;
			c.findOn = !c.findOn;
			if (!c.findOn) c.find = "";
			const $f = this.$content.find(".tm-chat-find").prop("hidden", !c.findOn);
			$f.find("input").val(c.find || "");
			this.$content.find(".tm-chat-thread").html(this.chatThreadHtml());
			if (c.findOn) $f.find("input").trigger("focus");
			else this.scrollChat();
		},
		inp_chatFind(value) {
			this.chat.find = value;
			this.$content.find(".tm-chat-thread").html(this.chatThreadHtml());
		},
		act_chatEmojiOpen(ds, el) {
			const $m = this.popover(el, EMOJI.map((e) => `<button data-act="chatEmoji" data-e="${e}">${e}</button>`).join(""), "tm-pop tm-pop-emoji");
			const r = el.getBoundingClientRect();
			$m.css({ top: Math.max(8, r.top - ($m.outerHeight() || 230) - 8) }); // above the button: it sits at the bottom of the screen
		},
		act_chatEmoji(ds) {
			const el = this.$content.find(".tm-chat-input")[0];
			if (!el) return;
			const start = el.selectionStart == null ? el.value.length : el.selectionStart;
			const end = el.selectionEnd == null ? start : el.selectionEnd;
			el.value = el.value.slice(0, start) + ds.e + el.value.slice(end);
			this.chat.draft = el.value;
			el.focus();
			el.selectionStart = el.selectionEnd = start + ds.e.length;
		},

		// top bar ---------------------------------------------------------
		inp_search(value, el) {
			clearTimeout(this.searchTimer);
			const $res = this.$root.find(".tm-search-results");
			if (value.trim().length < 2) return $res.prop("hidden", true);
			this.searchTimer = setTimeout(async () => {
				const [found] = await Promise.all([call("search", { q: value }), this.dir()]);
				if (el.value !== value) return;
				const rows = this.pickMatches("department", value, 4)
					.map((r) => ({ kind: "department", name: r.id, title: r.title, sub: __("Show this department on the dashboard") }))
					.concat(this.pickMatches("staff", value, 6).map((r) => ({ kind: "staff", name: r.id, title: r.title, sub: r.sub || __("Show this person on the dashboard") })))
					.concat(found.filter((r) => r.kind === "task"));
				const ic = { task: "tasks", department: "grid", staff: "user" };
				$res
					.html(rows.map((r) => `<button data-act="searchPick" data-kind="${r.kind}" data-name="${esc(r.name)}">${icon(ic[r.kind])}<span><b>${esc(r.title)}</b><small>${esc(r.sub)}</small></span><em>${esc(__(frappe.utils.to_title_case(r.kind)))}</em></button>`).join("") || `<div class="tm-muted tm-pad">${__("Nothing found.")}</div>`)
					.prop("hidden", false);
			}, 250);
		},
		act_searchPick(ds) {
			this.$root.find(".tm-search-results").prop("hidden", true);
			if (ds.kind === "department" || ds.kind === "staff") {
				// one department or one person at a time from the search
				Object.assign(this.dashRange(), { department: "", staff: "" }, { [ds.kind]: ds.name });
				this.$root.find('[data-input="search"]').val("");
				if (this.route.view === "dashboard") this.renderContent(true);
				else this.go("dashboard");
			} else if (ds.kind === "task") this.openTask(ds.name);
			else if (ds.kind === "round") this.openRound(ds.name);
			else if (ds.kind === "handover") this.act_editHandover(ds);
		},
		async act_bell(ds, el) {
			const rows = await call("notifications");
			const html = `<header><b>${__("Notifications")}</b>${rows.some((r) => !r.read) ? `<a data-act="notifReadAll">${__("Mark all as read")}</a>` : ""}</header>
				${rows.map((n) => `<button class="${n.read ? "" : "is-unread"}" data-act="notifOpen" data-id="${esc(n.name)}" data-doctype="${esc(n.document_type || "")}" data-name="${esc(n.document_name || "")}">
					${n.from_user ? this.avatar(n.from_user) : `<span class="tm-av">${icon("bell")}</span>`}<span><b>${esc(n.subject)}</b><small>${esc(ago(n.creation))}</small></span></button>`).join("") || `<div class="tm-muted tm-pad">${__("You have no notifications.")}</div>`}`;
			this.popover(el, html, "tm-pop tm-pop-bell");
		},
		async act_notifOpen(ds) {
			call("notifications_read", { name: ds.id }).then(() => this.poll());
			if (ds.doctype && ds.name) this.act_openRef(ds);
		},
		async act_notifReadAll() {
			await call("notifications_read");
			this.poll();
		},
		act_help() {
			frappe.msgprint({
				title: __("Task Management — quick guide"),
				message: `<ul>
					<li>${__("<b>Board</b>: drag a card to another column, or tick the circle to complete it. Click a card to open its details on the right.")}</li>
					<li>${__("<b>Checklist</b>: a task's progress follows its checklist (2 of 4 ticked = 50%).")}</li>
					<li>${__("<b>Assign / Update</b>: use Assign to give a task to users or a whole team, and Update to change its status with a comment.")}</li>
					<li>${__("<b>Chat</b>: message a person directly, or use the General and team channels.")}</li>
					<li>${__("<b>Shortcuts</b>: Ctrl + K search, Esc closes the side panel.")}</li>
				</ul>`,
			});
		},
		act_me(ds, el) {
			this.menu(el, [
				{ label: __("My profile"), icon: "user", act: "href", data: { url: "/app/user-profile" } },
				{ label: __("Preferences"), icon: "settings", act: "nav", data: { to: "settings" } },
				"-",
				{ label: __("Back to ERP desk"), icon: "home", act: "href", data: { url: "/app" } },
			]);
		},
		act_href(ds) {
			window.location.href = ds.url;
		},
	});
})();
