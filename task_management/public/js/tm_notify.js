// Task Management: live pop-up + sound on every desk page.
// The server sends the realtime event "tm_notify" (task_management/task_management/notify.py).
(function () {
	if (window.tm_notify) return;
	const KEY = "tm_notify_sound"; // "0" = sound off (set in Task Management > Settings)
	const ICONS = {
		task: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
		assign: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
		chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
	};
	const esc = (s) => $("<div>").text(s == null ? "" : String(s)).html();
	let ctx = null;

	const api = (window.tm_notify = {
		soundOn() {
			return localStorage.getItem(KEY) !== "0" && !(frappe.boot && frappe.boot.user && frappe.boot.user.mute_sounds);
		},
		setSound(on) {
			localStorage.setItem(KEY, on ? "1" : "0");
		},
		// two-note chime, generated in the browser (no sound file needed)
		play(force) {
			if (!force && !api.soundOn()) return;
			try {
				const AC = window.AudioContext || window.webkitAudioContext;
				ctx = ctx || new AC();
				if (ctx.state === "suspended") ctx.resume();
				const t0 = ctx.currentTime + 0.02;
				[[880, 0], [1174.66, 0.16]].forEach(([freq, at]) => {
					const osc = ctx.createOscillator(), gain = ctx.createGain();
					osc.type = "sine";
					osc.frequency.value = freq;
					gain.gain.setValueAtTime(0.0001, t0 + at);
					gain.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.02);
					gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.45);
					osc.connect(gain).connect(ctx.destination);
					osc.start(t0 + at);
					osc.stop(t0 + at + 0.5);
				});
			} catch (e) {
				frappe.utils.play_sound && frappe.utils.play_sound("alert");
			}
		},
		show(m) {
			if (!m || !m.title || m.by === frappe.session.user) return;
			const route = frappe.get_route ? frappe.get_route() : [];
			const inChat = route[0] === "task-hub" && route[1] === "chat";
			api.play();
			$(document).trigger("tm-notify", [m]);
			if (m.kind === "chat" && inChat && !document.hidden) return; // the open chat already shows it
			const $n = $(`<div class="tm-toast" role="status">
				<span class="tm-toast-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[m.kind] || ICONS.task}</svg></span>
				<div class="tm-toast-body"><b>${esc(m.title)}</b>${m.body ? `<p>${esc(m.body)}</p>` : ""}<small>${esc(__("Task Management"))} · ${esc(__("click to open"))}</small></div>
				<button class="tm-toast-x" aria-label="${esc(__("Close"))}">&times;</button></div>`);
			const close = () => $n.addClass("is-out") && setTimeout(() => $n.remove(), 250);
			$n.on("click", (e) => {
				if (!$(e.target).closest(".tm-toast-x").length && m.route) frappe.set_route(...m.route.split("/"));
				close();
			});
			let $box = $("#tm-toasts");
			if (!$box.length) $box = $('<div id="tm-toasts"></div>').appendTo(document.body);
			$box.append($n);
			$box.children().slice(0, -4).remove(); // keep the last four
			setTimeout(close, 12000);
			if (document.hidden && window.Notification && Notification.permission === "granted") {
				try {
					const n = new Notification(m.title, { body: m.body || "", tag: "tm-" + (m.route || "") });
					n.onclick = () => {
						window.focus();
						if (m.route) frappe.set_route(...m.route.split("/"));
						n.close();
					};
				} catch (e) {
					/* desktop notifications are optional */
				}
			}
		},
	});

	const style = document.createElement("style");
	style.textContent = `
#tm-toasts { position: fixed; right: 18px; bottom: 18px; z-index: 2000; display: flex; flex-direction: column; gap: 10px; width: 340px; max-width: calc(100vw - 36px); pointer-events: none; }
.tm-toast { pointer-events: auto; display: flex; gap: 11px; align-items: flex-start; background: #fff; color: #1f2733; border: 1px solid #e6e9ee; border-left: 4px solid #f19f21; border-radius: 10px; box-shadow: 0 12px 32px rgba(31, 39, 51, .22); padding: 11px 12px; cursor: pointer; font-size: 13px; line-height: 1.35; animation: tm-toast-in .25s ease-out; transition: opacity .25s, transform .25s; }
.tm-toast.is-out { opacity: 0; transform: translateX(24px); }
.tm-toast-ic { flex: none; width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; background: #fef3df; color: #f19f21; }
.tm-toast-ic svg { width: 16px; height: 16px; }
.tm-toast-body { flex: 1; min-width: 0; }
.tm-toast-body b { display: block; font-weight: 600; overflow-wrap: anywhere; }
.tm-toast-body p { margin: 2px 0 0; color: #4b5563; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tm-toast-body small { display: block; margin-top: 3px; color: #8a94a3; font-size: 11px; }
.tm-toast-x { flex: none; border: 0; background: none; color: #8a94a3; font-size: 18px; line-height: 1; padding: 0 2px; cursor: pointer; }
@keyframes tm-toast-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }`;
	document.head.appendChild(style);

	// Navbar notification button: entries of this module open inside Task Management
	// (the task in the task page, a chat message in the chat) instead of a plain form.
	const OURS = /\/app\/(task|task-handover|clinical-round|task-team|task-chat-message)\/[^/]+$/;
	$(document).on("click", ".notification-item", function (e) {
		const href = this.getAttribute("href") || "", name = this.getAttribute("data-name");
		if (!name || !OURS.test(href.split("?")[0]) || $(e.target).closest(".mark-as-read").length) return;
		e.preventDefault();
		e.stopPropagation();
		$(this).removeClass("unread").closest(".dropdown-menu").removeClass("show");
		frappe.call({ method: "frappe.desk.doctype.notification_log.notification_log.mark_as_read", args: { docname: name } });
		frappe.call({ method: "task_management.task_management.api.notification_route", args: { name } }).then((r) => {
			if (r && r.message) frappe.set_route(...r.message.split("/"));
			else frappe.set_route(href.replace(/^\/app\//, "").split("/").map(decodeURIComponent));
		});
	});

	let bound = false;
	const bind = () => {
		if (bound || !(frappe.realtime && frappe.socketio && frappe.socketio.socket)) return bound;
		frappe.realtime.on("tm_notify", (m) => api.show(m));
		return (bound = true);
	};
	$(document).on("app_ready", bind);
	$(() => {
		if (!bind()) {
			const timer = setInterval(() => bind() && clearInterval(timer), 1000);
			setTimeout(() => clearInterval(timer), 30000);
		}
	});
	// browsers only allow sound after the first click or key press on the page
	$(document).one("click keydown", () => {
		try {
			const AC = window.AudioContext || window.webkitAudioContext;
			ctx = ctx || new AC();
			if (ctx.state === "suspended") ctx.resume();
		} catch (e) {
			/* no audio */
		}
	});
})();
