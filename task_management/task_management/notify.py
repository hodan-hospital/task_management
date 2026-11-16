# Copyright (c) 2026, Hodan Hospital
"""Live notifications of the Task Management module.

`push` sends the realtime event `tm_notify` to a user. The desk-wide script
public/js/tm_notify.js (loaded on every desk page through app_include_js) shows it as a pop-up
with a sound, wherever in the system the user is working at that moment.
"""
import frappe
from frappe import _
from frappe.utils import cstr, escape_html, get_fullname, strip_html


def push(users, title, body=None, route=None, kind="task"):
	"""Pop-up + sound for each of `users` (never for the person who caused it)."""
	me = frappe.session.user
	message = {
		"kind": kind,
		"title": strip_html(cstr(title))[:200],
		"body": strip_html(cstr(body or ""))[:240],
		"route": route,
		"by": me,
		"by_name": get_fullname(me),
	}
	for user in {u for u in (users or []) if u and u not in (me, "Guest")}:
		frappe.publish_realtime("tm_notify", message, user=user, after_commit=True)


def route_for(doctype, name):
	if doctype == "Task":
		return "task-hub/task/{0}".format(name)
	if doctype == "Task Handover":
		return "task-hub/my/handovers"
	if doctype == "Clinical Round":
		return "task-hub/my/rounds"
	return "task-hub"


def team_users(team):
	"""Logins of a team: its members that have a user account, and its lead."""
	if not team:
		return set()
	users = set(frappe.get_all("Task Team Member", filters={"parent": team, "parenttype": "Task Team", "user": ("is", "set")}, pluck="user"))
	lead = frappe.db.get_value("Task Team", team, "team_lead")
	if lead:
		users.add(lead)
	return users


def task_people(doc):
	"""Everyone a task concerns: who created it, who it is assigned to, and the logins of its team."""
	users = {doc.owner} | set(frappe.parse_json(doc.get("_assign") or "[]")) | team_users(doc.get("tm_team"))
	return users


def bell(values):
	"""Entry in the navbar notification button (a Notification Log) for one user.

	The e-mail copy that Frappe sends with it must never break the action itself, e.g. on a site
	without a working outgoing e-mail account: the entry is kept, the failure goes to the Error Log.
	"""
	values = dict(values, doctype="Notification Log")
	if not values.get("for_user") or values["for_user"] == values.get("from_user"):
		return
	try:
		frappe.get_doc(values).insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(title="Task Management: notification e-mail failed")


def chat_bell(user, subject, document_type, document_name):
	"""One unread entry per conversation: more messages do not pile up in the bell."""
	me = frappe.session.user
	unread = {"for_user": user, "from_user": me, "document_type": document_type, "read": 0}
	if document_type == "Task Team":
		unread["document_name"] = document_name
	if frappe.db.exists("Notification Log", unread):
		return
	bell(
		{
			"for_user": user,
			"from_user": me,
			"type": "Alert",
			"document_type": document_type,
			"document_name": document_name,
			"subject": subject,
		}
	)


def route_of_log(log):
	"""Where a notification of this module opens inside the page task-hub (None = not ours)."""
	if log.document_type == "Task Chat Message":
		sender = frappe.db.get_value("Task Chat Message", log.document_name, "sender") or log.from_user
		return "task-hub/chat/User/{0}".format(sender)
	if log.document_type == "Task Team":
		return "task-hub/chat/Task Team/{0}".format(log.document_name)
	if log.document_type in ("Task", "Task Handover", "Clinical Round"):
		return route_for(log.document_type, log.document_name)
	return None


def on_todo_insert(doc, method=None):
	"""A task was assigned to a person (from the task page or from the standard form)."""
	if doc.reference_type != "Task" or not doc.reference_name or doc.status != "Open":
		return
	subject = frappe.db.get_value("Task", doc.reference_name, "subject") or doc.reference_name
	push(
		[doc.allocated_to],
		_("{0} assigned a task to you").format(get_fullname(frappe.session.user)),
		escape_html(subject),
		route_for("Task", doc.reference_name),
		"assign",
	)
	if doc.allocated_to != frappe.session.user:
		frappe.enqueue(
			"task_management.task_management.notify.ensure_assignment_bell",
			queue="short",
			enqueue_after_commit=True,
			user=doc.allocated_to,
			task=doc.reference_name,
			by=frappe.session.user,
			since=cstr(frappe.utils.now_datetime()),
		)


def ensure_assignment_bell(user, task, by, since):
	"""Frappe adds the bell entry for an assignment in a background job, and that job dies when the
	notification e-mail cannot be sent. Give it a moment, then add the entry if it is not there."""
	import time

	time.sleep(4)
	frappe.db.commit()  # see what the other job wrote
	if frappe.db.exists(
		"Notification Log",
		{"for_user": user, "type": "Assignment", "document_type": "Task", "document_name": task, "creation": (">=", since)},
	):
		return
	subject = frappe.db.get_value("Task", task, "subject")
	if not subject:
		return
	bell(
		{
			"for_user": user,
			"from_user": by,
			"type": "Assignment",
			"document_type": "Task",
			"document_name": task,
			"subject": _("{0} assigned a new task {1} to you").format(
				"<strong>" + escape_html(get_fullname(by)) + "</strong>", '<b class="subject-title">' + escape_html(subject) + "</b>"
			),
		}
	)
	frappe.db.commit()
