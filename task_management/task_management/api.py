# Copyright (c) 2026, Hodan Hospital
"""Server side of the Task Management page (`/app/task-hub`).

Data model (existing doctypes first):
  Task               -> board cards; sub-tasks via parent_task; checklist via custom table tm_checklist
  Task Type          -> "Task Type" filter / tag
  ToDo (_assign)     -> assignees
  Comment            -> task comments, activity log (comment_type Info) and chat (one general channel + one per team)
  File               -> attachments
  Notification Log   -> bell
  Task Team (main department teams with sub-teams), Clinical Round, Task Handover,
  Task Chat Message (person-to-person chat) (new, this module)

All reads go through frappe.get_list (role + user permissions apply); all writes through doc.save()/insert().
"""
import json
import re
from html import unescape

import frappe
from frappe import _
from frappe.utils import add_days, cint, cstr, escape_html, flt, getdate, now_datetime, nowdate, strip_html

COLUMNS = [
	("todo", "To Do"),
	("progress", "In Progress"),
	("review", "In Review"),
	("blocked", "Blocked"),
	("done", "Completed"),
]
COLUMN_LABEL = dict(COLUMNS)
STATUS_FOR_COLUMN = {"todo": "Open", "progress": "Working", "review": "Pending Review", "done": "Completed"}
FOLLOW_UP_TYPE = "Follow-up"

TASK_FIELDS = [
	"name", "subject", "status", "priority", "type", "department", "exp_start_date", "exp_end_date",
	"progress", "parent_task", "is_group", "is_milestone", "tm_team", "tm_patient", "tm_patient_name", "tm_blocked",
	"completed_on", "completed_by", "_assign", "creation", "modified", "owner", "tm_delay_reason",
]
TASK_WRITABLE = [
	"subject", "type", "priority", "department", "exp_start_date", "exp_end_date", "description",
	"tm_team", "tm_patient", "parent_task", "is_milestone", "tm_blocked_reason", "tm_delay_reason",
]
ACTIVITY_TYPES = ("Comment", "Info", "Assigned", "Assignment Completed", "Attachment", "Attachment Removed")
PAGE = "task-hub"
CHAT_DOCTYPES = ("Page", "Task Team")
DM = "User"  # chat channel type for person-to-person messages (stored in Task Chat Message)
LOG_MARK = '<span data-tm-log="1">'
_BREAKS = re.compile(r"<br\s*/?>|</p>|</div>|</li>", re.I)
_BLANKS = re.compile(r"\n{3,}")


# --------------------------------------------------------------------------------------------- helpers
def _column_of(t):
	if t.get("status") == "Completed":
		return "done"
	if cint(t.get("tm_blocked")):
		return "blocked"
	if t.get("status") == "Working":
		return "progress"
	if t.get("status") == "Pending Review":
		return "review"
	return "todo"


def _assignees(raw):
	try:
		return json.loads(raw or "[]") or []
	except Exception:
		return []


def _log(doc, text):
	"""Activity entry, stored as an Info comment so it also shows in the form timeline."""
	doc.add_comment("Info", LOG_MARK + text + "</span>")


def _plain(html, limit=280):
	"""HTML (comment / text editor content) -> plain text; the page escapes it again when rendering."""
	text = _BREAKS.sub("\n", cstr(html))
	text = unescape(strip_html(text))
	text = "\n".join(" ".join(line.split()) for line in text.splitlines())
	text = _BLANKS.sub("\n\n", text).strip()
	return text if len(text) <= limit else text[: limit - 1] + "…"


def _get_tasks(filters=None, limit=3000):
	flt_ = [["status", "not in", ["Cancelled", "Template"]]]
	flt_ += filters or []
	tasks = frappe.get_list("Task", filters=flt_, fields=TASK_FIELDS, order_by="modified desc", limit_page_length=limit)
	if not tasks:
		return []
	names = [t.name for t in tasks]
	checks = {
		r.parent: r
		for r in frappe.db.sql(
			"""select parent, count(*) total, sum(completed) done from `tabTask Checklist Item`
			where parenttype='Task' and parent in %(n)s group by parent""",
			{"n": names},
			as_dict=True,
		)
	}
	subs = {}
	for t in tasks:
		if t.parent_task:
			s = subs.setdefault(t.parent_task, [0, 0])
			s[0] += 1
			s[1] += 1 if t.status == "Completed" else 0
	today = getdate()
	for t in tasks:
		t.column = _column_of(t)
		t.assignees = _assignees(t.pop("_assign", None))
		if not t.assignees and t.column == "done" and t.completed_by:
			t.assignees = [t.completed_by]  # ERPNext closes the assignment when a task is completed
		c = checks.get(t.name)
		t.check_total = cint(c.total) if c else 0
		t.check_done = cint(c.done) if c else 0
		t.sub_total, t.sub_done = subs.get(t.name, [0, 0])
		t.overdue = bool(t.exp_end_date and t.column != "done" and getdate(t.exp_end_date) < today)
		t.tm_blocked = cint(t.tm_blocked)
	return tasks


def _my_teams(user=None):
	"""Teams the user belongs to (as member or lead)."""
	from task_management.task_management.permissions import my_teams

	return my_teams(user)


def _mine(tasks, user=None):
	"""Tasks assigned to the user directly, or to a team the user belongs to."""
	user = user or frappe.session.user
	teams = _my_teams(user)
	return [t for t in tasks if user in t.assignees or (t.tm_team and t.tm_team in teams)]


def _task_doc(name, ptype="read"):
	doc = frappe.get_doc("Task", name)
	doc.check_permission(ptype)
	return doc


def _can_edit(doc):
	from task_management.task_management.permissions import can_edit_task

	return can_edit_task(doc)


def _require_edit(doc):
	"""Only the creator of a task (or a Task Manager) changes the task itself; an assignee updates its status."""
	if not _can_edit(doc):
		frappe.throw(
			_("Only the creator of this task or a Task Manager can change it. You can update the status, give a reason or add a comment."),
			frappe.PermissionError,
			title=_("Not your task to edit"),
		)


def _notify(values):
	"""Bell notification for one user. The e-mail copy that Frappe sends with it must never break the
	action itself (e.g. a site without a working outgoing e-mail account)."""
	from task_management.task_management import notify

	notify.push(
		[values.get("for_user")],
		values.get("subject"),
		values.get("email_content"),
		notify.route_for(values.get("document_type"), values.get("document_name")),
		"assign" if values.get("type") == "Assignment" else "task",
	)
	notify.bell(values)


def _notify_task(doc, subject, detail=None):
	"""Bell entry + live pop-up for everyone the task concerns, except the person acting."""
	from task_management.task_management import notify

	me = frappe.session.user
	for user in notify.task_people(doc):
		if user != me and frappe.db.get_value("User", user, "enabled"):
			_notify(
				{
					"doctype": "Notification Log",
					"for_user": user,
					"from_user": me,
					"type": "Alert",
					"document_type": "Task",
					"document_name": doc.name,
					"subject": subject,
					"email_content": detail,
				}
			)


def _user_default(key, value=None):
	if value is None:
		return frappe.defaults.get_user_default(key)
	frappe.defaults.set_user_default(key, value)


def _can_delete():
	from task_management.task_management.permissions import can_delete_task

	return can_delete_task()


def _full_access():
	from task_management.task_management.permissions import has_full_access

	return has_full_access()


def _is_manager():
	roles = frappe.get_roles()
	return "Task Manager" in roles or "Projects Manager" in roles or "System Manager" in roles


# --------------------------------------------------------------------------------------------- bootstrap
@frappe.whitelist()
def bootstrap():
	user = frappe.session.user
	users = frappe.get_all(
		"User",
		filters={"enabled": 1, "user_type": "System User", "name": ["not in", ["Guest"]]},
		fields=["name", "full_name", "user_image"],
		order_by="full_name asc",
		limit_page_length=0,
	)
	return {
		"user": user,
		"users": users,
		"teams": list_teams(),
		"task_types": frappe.get_all("Task Type", pluck="name", order_by="name asc"),
		"departments": frappe.get_all("Department", filters={"disabled": 0, "is_group": 0}, pluck="name", order_by="name asc"),
		"columns": [{"key": k, "label": v} for k, v in COLUMNS],
		"counts": workspace_counts(),
		"badges": badges(),
		"perms": {
			"task_create": bool(frappe.has_permission("Task", "create")),
			"team_create": bool(frappe.has_permission("Task Team", "create")),
			"round_create": bool(frappe.has_permission("Clinical Round", "create")),
			"handover_create": bool(frappe.has_permission("Task Handover", "create")),
			"manager": _is_manager(),
			"full": _full_access(),
			"task_delete": _can_delete(),
		},
		"logo": frappe.db.get_single_value("Navbar Settings", "app_logo"),
		"company": frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company"),
		"today": nowdate(),
	}


@frappe.whitelist()
def workspace_counts():
	user = frappe.session.user
	mine = [t for t in _mine(_get_tasks()) if t.column != "done"]
	return {
		"tasks": len(mine),
		"rounds": frappe.db.count("Clinical Round", {"lead": user, "status": ["in", ["Scheduled", "In Progress"]]})
		if frappe.has_permission("Clinical Round")
		else 0,
		"handovers": frappe.db.count("Task Handover", {"to_user": user, "status": "Pending"})
		if frappe.has_permission("Task Handover")
		else 0,
		"followups": len([t for t in mine if t.type == FOLLOW_UP_TYPE]),
		"overdue": len([t for t in mine if t.overdue]),
	}


@frappe.whitelist()
def badges():
	user = frappe.session.user
	return {
		"activity": _activity_unseen(),
		"chat": sum(c["unread"] for c in chat_channels()),
		"notifications": frappe.db.count("Notification Log", {"for_user": user, "read": 0}),
	}


@frappe.whitelist()
def refresh_meta():
	"""Light refresh after a write: sidebar lists, counters and badges."""
	return {"teams": list_teams(), "counts": workspace_counts(), "badges": badges()}


@frappe.whitelist()
def staff_directory():
	"""Departments and staff for the dashboard filter and the top search.

	Staff come from Employee and Non-Employee (active records). Only what the filter needs is returned:
	name, department, designation and the linked login (tasks are assigned to logins)."""
	departments = frappe.get_all(
		"Department",
		filters={"disabled": 0},
		fields=["name", "parent_department", "is_group"],
		order_by="name asc",
		limit_page_length=0,
	)
	staff = []
	for doctype in ("Employee", "Non-Employee"):
		if not frappe.db.exists("DocType", doctype):
			continue
		filters = {"status": "Active"}
		if frappe.get_meta(doctype).has_field("deleted"):
			filters["deleted"] = 0
		for r in frappe.get_all(
			doctype,
			filters=filters,
			fields=["name", "employee_name", "first_name", "middle_name", "last_name", "user_id", "department", "designation"],
			limit_page_length=0,
		):
			full_name = cstr(r.employee_name).strip() or " ".join(
				p for p in (cstr(r.first_name).strip(), cstr(r.middle_name).strip(), cstr(r.last_name).strip()) if p
			)
			staff.append(
				{
					"id": "{0}:{1}".format(doctype, r.name),
					"source": doctype,
					"full_name": full_name or r.name,
					"user": r.user_id or None,
					"department": r.department or None,
					"designation": r.designation or None,
				}
			)
	staff.sort(key=lambda x: x["full_name"].lower())
	return {"departments": departments, "staff": staff}


# --------------------------------------------------------------------------------------------- board
@frappe.whitelist()
def board_data(days=14):
	"""Everything the Tasks / Overview / Dashboard screens need: tasks plus the widgets under the board."""
	days = min(max(cint(days) or 14, 7), 90)
	tasks = _get_tasks()
	return {
		"tasks": tasks,
		"workload": _workload(tasks),
		"trend": _trend(tasks, days),
		"upcoming": _upcoming(),
		"activity": activity(limit=8)["items"],
	}


def _workload(tasks):
	"""Open tasks per team (falls back to the task's department)."""
	groups = {}
	for t in tasks:
		key = t.tm_team or t.department
		if not key:
			continue
		g = groups.setdefault(key, {"label": key, "kind": "team" if t.tm_team else "department", "open": 0, "done": 0})
		g["done" if t.column == "done" else "open"] += 1
	rows = sorted(groups.values(), key=lambda g: (-g["open"], -g["done"]))
	return rows[:6]


def _trend(tasks, days):
	"""Cumulative created / completed tasks per day over the window."""
	start = getdate(add_days(nowdate(), -(days - 1)))
	labels = [getdate(add_days(start, i)) for i in range(days)]
	created = dict.fromkeys(labels, 0)
	completed = dict.fromkeys(labels, 0)
	for t in tasks:
		d = getdate(t.creation)
		if d in created:
			created[d] += 1
		if t.column == "done":
			d = getdate(t.completed_on or t.modified)
			if d in completed:
				completed[d] += 1
	out, c_sum, d_sum = [], 0, 0
	for d in labels:
		c_sum += created[d]
		d_sum += completed[d]
		out.append({"date": d, "created": c_sum, "completed": d_sum})
	return out


def _upcoming(limit=6):
	if not frappe.has_permission("Clinical Round"):
		return []
	filters = {"round_date": [">=", nowdate()], "status": ["in", ["Scheduled", "In Progress"]]}
	rounds = frappe.get_list(
		"Clinical Round",
		filters=filters,
		fields=["name", "title", "round_type", "round_date", "round_time", "status", "service_unit"],
		order_by="round_date asc, round_time asc",
		limit_page_length=limit,
	)
	_add_patient_counts(rounds)
	return rounds


# --------------------------------------------------------------------------------------------- task detail / writes
@frappe.whitelist()
def get_task(name):
	doc = _task_doc(name)
	d = frappe._dict({f: doc.get(f) for f in TASK_FIELDS if f != "_assign"})
	d.description = _plain(doc.description, 4000)
	d.tm_blocked_reason = doc.get("tm_blocked_reason")
	d.tm_delay_reason = doc.get("tm_delay_reason")
	d.column = _column_of(d)
	d.tm_blocked = cint(d.tm_blocked)
	d.assignees = _assignees(frappe.db.get_value("Task", name, "_assign"))
	if not d.assignees and d.column == "done" and d.completed_by:
		d.assignees = [d.completed_by]
	d.overdue = bool(d.exp_end_date and d.column != "done" and getdate(d.exp_end_date) < getdate())
	d.can_write = bool(doc.has_permission("write"))
	d.can_edit = bool(d.can_write and _can_edit(doc))
	d.can_delete = _can_delete()  # asked directly: a failed permission check would pop up a message
	d.parent_subject = frappe.db.get_value("Task", doc.parent_task, "subject") if doc.parent_task else None
	d.checklist = [
		{"name": r.name, "title": r.title, "completed": cint(r.completed), "completed_by": r.completed_by}
		for r in doc.get("tm_checklist") or []
	]
	d.subtasks = _get_tasks(filters=[["parent_task", "=", name]])
	d.files = _files([("Task", [name])])
	d.comments = frappe.get_all(
		"Comment",
		filters={"reference_doctype": "Task", "reference_name": name, "comment_type": "Comment"},
		fields=["name", "content", "comment_email", "comment_by", "creation"],
		order_by="creation asc",
		limit_page_length=200,
	)
	for c in d.comments:
		c.content = _plain(c.content, 2000)
	d.activity = _activity_rows({"Task": {name: doc.subject}}, limit=40)
	d.links = _related_links(doc)
	return d


def _related_links(doc):
	"""Patient chart shortcuts for the task's patient (latest inpatient record and encounter)."""
	links = []
	patient = doc.get("tm_patient")
	if not patient:
		return links
	if frappe.has_permission("Patient Encounter"):
		enc = frappe.db.sql(
			"select name from `tabPatient Encounter` where patient=%s order by encounter_date desc, creation desc limit 1",
			patient,
		)
		if enc:
			links.append({"label": _("Encounter Note"), "doctype": "Patient Encounter", "name": enc[0][0]})
	if frappe.has_permission("Inpatient Record"):
		ipr = frappe.db.sql(
			"select name from `tabInpatient Record` where patient=%s order by creation desc limit 1", patient
		)
		if ipr:
			links.append({"label": _("Inpatient Record"), "doctype": "Inpatient Record", "name": ipr[0][0]})
	return links


@frappe.whitelist()
def save_task(data):
	"""Create or update a task. `assignees` (list of users) and `column` are optional extras."""
	data = frappe.parse_json(data)
	is_new = not data.get("name")
	doc = frappe.new_doc("Task") if is_new else _task_doc(data.name, "write")
	if not is_new:
		_require_edit(doc)
	elif data.get("parent_task"):
		_require_edit(_task_doc(data.parent_task, "write"))  # a sub-task changes its parent
	before = _column_of(doc.as_dict()) if not is_new else None
	team_before = None if is_new else doc.get("tm_team")
	changed = []
	for f in TASK_WRITABLE:
		if f in data:
			value = data.get(f) or None
			if f == "is_milestone":
				value = cint(value)
			if not is_new and cstr(doc.get(f) or "") != cstr(value or ""):
				changed.append(doc.meta.get_label(f))
			doc.set(f, value)
	_require_owner(doc, data, is_new)
	if "progress" in data:
		doc.progress = min(max(flt(data.progress), 0), 100)
	if data.get("column"):
		_apply_column(doc, data.column)
	if doc.parent_task:
		_make_group(doc.parent_task)
	if is_new:
		for title in data.get("checklist") or []:
			if cstr(title).strip():
				doc.append("tm_checklist", {"title": cstr(title).strip()[:140]})
		doc.insert()
		_log(doc, _("created this task"))
	else:
		doc.save()
		after = _column_of(doc.as_dict())
		if before != after:
			_log(doc, _("moved this task to {0}").format("<b>" + COLUMN_LABEL[after] + "</b>"))
		elif changed:
			_log(doc, _("updated {0}").format(", ".join(changed[:4])))
	if "assignees" in data:
		_set_assignees(doc, data.get("assignees") or [])
	if doc.get("tm_team") and doc.get("tm_team") != team_before:
		_notify_team(doc)
	return doc.name


def _require_owner(doc, data, is_new):
	"""A task must belong to someone: at least one assignee, a department or a team.

	A new sub-task with no owner of its own takes its parent's department / team, or else the parent's
	assignees. Old tasks without an owner can still be edited, as long as the edit does not touch the owner.
	"""
	if not is_new and not any(k in data for k in ("assignees", "department", "tm_team")):
		return
	wanted = [u for u in (data.get("assignees") or []) if u] if "assignees" in data else None
	if wanted is None and not is_new:
		wanted = _assignees(frappe.db.get_value("Task", doc.name, "_assign"))
	if is_new and not wanted and not doc.department and not doc.get("tm_team") and doc.parent_task:
		parent = frappe.db.get_value("Task", doc.parent_task, ["department", "tm_team", "_assign"], as_dict=True) or {}
		doc.department, doc.tm_team = parent.get("department"), parent.get("tm_team")
		if not doc.department and not doc.tm_team:
			wanted = _assignees(parent.get("_assign"))
			if wanted:
				data["assignees"] = wanted
	if not wanted and not doc.department and not doc.get("tm_team"):
		frappe.throw(_("Assign the task to at least one staff member, a department or a team."), title=_("Nobody owns this task"))


def _notify_team(doc):
	"""Tell the members of the team that a task was assigned to their team."""
	team = frappe.get_doc("Task Team", doc.tm_team)
	_log(doc, _("assigned this task to team {0}").format("<b>" + escape_html(team.name) + "</b>"))
	me = frappe.session.user
	for user in {m.user for m in team.members} | ({team.team_lead} if team.team_lead else set()):
		if user and user != me:
			_notify(
				{
					"doctype": "Notification Log",
					"for_user": user,
					"from_user": me,
					"type": "Assignment",
					"document_type": "Task",
					"document_name": doc.name,
					"subject": _("{0} assigned a task to team {1}: {2}").format(
						frappe.utils.get_fullname(me), escape_html(team.name), escape_html(doc.subject)
					),
				}
			)


@frappe.whitelist()
def update_task(name, column=None, comment=None, reason=None):
	"""The assignee's one-step update: new status, a comment and / or the reason for a delay."""
	doc = _task_doc(name, "write")
	comment = cstr(comment).strip()
	reason_changed = False
	if reason is not None:
		reason = cstr(reason).strip()[:1000]
		if reason != cstr(doc.get("tm_delay_reason")).strip():
			doc.tm_delay_reason = reason or None
			reason_changed = True
	moved = bool(column and column != _column_of(doc.as_dict()))
	if reason_changed and not moved:
		doc.save()
	if reason_changed:
		_log(doc, _("gave the reason for the delay: {0}").format(escape_html(reason[:300])) if reason else _("removed the reason for the delay"))
	if moved:
		_apply_column(doc, column)
		doc.save()
		_log(doc, _("moved this task to {0}").format("<b>" + COLUMN_LABEL[column] + "</b>"))
		_notify_moved(doc, column, comment)
		comment_sent = True
	else:
		comment_sent = False
	if comment:
		doc.add_comment("Comment", escape_html(comment[:4000]).replace("\n", "<br>"))
		if not comment_sent:
			_notify_comment(doc, comment)
	return _column_of(doc.as_dict())


def _notify_moved(doc, column, comment=None):
	_notify_task(
		doc,
		_("{0} moved a task to {1}: {2}").format(frappe.utils.get_fullname(frappe.session.user), COLUMN_LABEL[column], escape_html(doc.subject)),
		escape_html(cstr(comment)[:240]) if comment else None,
	)


def _notify_comment(doc, text):
	_notify_task(
		doc,
		_("{0} commented on: {1}").format(frappe.utils.get_fullname(frappe.session.user), escape_html(doc.subject)),
		escape_html(cstr(text)[:240]),
	)


def _make_group(parent):
	"""A task needs is_group=1 before it can have sub-tasks (nested set rule)."""
	if not cint(frappe.db.get_value("Task", parent, "is_group")):
		p = frappe.get_doc("Task", parent)
		p.check_permission("write")
		p.is_group = 1
		p.save()


def _apply_column(doc, column):
	if column not in COLUMN_LABEL:
		frappe.throw(_("Unknown column {0}").format(column))
	reopened = doc.status == "Completed" and column != "done"
	if column == "blocked":
		doc.tm_blocked = 1
		if doc.status in ("Completed", "Cancelled", None, ""):
			doc.status = "Working"
	else:
		doc.tm_blocked = 0
		doc.status = STATUS_FOR_COLUMN[column]
	if reopened:
		# ERPNext sets progress to 100 on completion; a reopened task goes back to its checklist (or 0)
		items = doc.get("tm_checklist") or []
		doc.progress = round(100.0 * len([i for i in items if cint(i.completed)]) / len(items)) if items else 0
	if column == "done":
		doc.completed_on = doc.completed_on or nowdate()
		doc.completed_by = doc.completed_by or frappe.session.user
	else:
		doc.completed_on = None
		doc.completed_by = None


def _set_assignees(doc, users):
	from frappe.desk.form import assign_to

	current = set(_assignees(frappe.db.get_value("Task", doc.name, "_assign")))
	wanted = {u for u in users if u and frappe.db.exists("User", u)}
	for u in current - wanted:
		assign_to.remove("Task", doc.name, u)
	if wanted - current:
		assign_to.add({"assign_to": list(wanted - current), "doctype": "Task", "name": doc.name, "description": doc.subject})


@frappe.whitelist()
def move_task(name, column):
	doc = _task_doc(name, "write")
	before = _column_of(doc.as_dict())
	if before == column:
		return column
	_apply_column(doc, column)
	doc.save()
	_log(doc, _("moved this task to {0}").format("<b>" + COLUMN_LABEL[column] + "</b>"))
	_notify_moved(doc, column)
	return column


@frappe.whitelist()
def delete_task(name):
	frappe.delete_doc("Task", name)  # checks delete permission
	return name


def _sync_progress(task):
	"""Task progress follows its checklist (2 of 4 done -> 50%)."""
	total, done = frappe.db.sql(
		"select count(*), ifnull(sum(completed),0) from `tabTask Checklist Item` where parenttype='Task' and parent=%s", task
	)[0]
	if total and frappe.db.get_value("Task", task, "status") != "Completed":
		frappe.db.set_value("Task", task, "progress", round(100.0 * flt(done) / total))
	return {"total": cint(total), "done": cint(done)}


@frappe.whitelist()
def checklist_add(task, title):
	doc = _task_doc(task, "write")
	_require_edit(doc)
	title = cstr(title).strip()[:140]
	if not title:
		frappe.throw(_("Checklist item is empty"))
	idx = len(doc.get("tm_checklist") or []) + 1
	row = frappe.get_doc(
		{"doctype": "Task Checklist Item", "parent": task, "parenttype": "Task", "parentfield": "tm_checklist", "idx": idx, "title": title}
	)
	row.insert(ignore_permissions=True)
	return dict(_sync_progress(task), name=row.name)


def _checklist_row(row):
	parent = frappe.db.get_value("Task Checklist Item", row, ["parent", "parenttype", "title"], as_dict=True)
	if not parent or parent.parenttype != "Task":
		frappe.throw(_("Checklist item not found"))
	return _task_doc(parent.parent, "write"), parent


@frappe.whitelist()
def checklist_toggle(row, completed):
	doc, info = _checklist_row(row)
	completed = cint(completed)
	frappe.db.set_value(
		"Task Checklist Item",
		row,
		{
			"completed": completed,
			"completed_by": frappe.session.user if completed else None,
			"completed_on": now_datetime() if completed else None,
		},
	)
	if completed:
		_log(doc, _("checked off {0}").format("<b>" + escape_html(info.title) + "</b>"))
	return _sync_progress(doc.name)


@frappe.whitelist()
def checklist_delete(row):
	doc, _info = _checklist_row(row)
	_require_edit(doc)
	frappe.db.delete("Task Checklist Item", {"name": row})
	return _sync_progress(doc.name)


@frappe.whitelist()
def add_comment(task, text):
	doc = _task_doc(task)
	text = cstr(text).strip()
	if not text:
		frappe.throw(_("Comment is empty"))
	c = doc.add_comment("Comment", escape_html(text[:4000]).replace("\n", "<br>"))
	_notify_comment(doc, text)
	return c.name


# --------------------------------------------------------------------------------------------- my workspace
@frappe.whitelist()
def my_work(kind="tasks"):
	"""Lists behind the 'My Workspace' sidebar entries."""
	user = frappe.session.user
	if kind in ("tasks", "followups", "overdue"):
		tasks = [t for t in _mine(_get_tasks()) if t.column != "done"]
		if kind == "followups":
			tasks = [t for t in tasks if t.type == FOLLOW_UP_TYPE]
		elif kind == "overdue":
			tasks = [t for t in tasks if t.overdue]
		return {"tasks": tasks}
	if kind == "rounds":
		return {"rounds": list_rounds(scope="mine")}
	if kind == "handovers":
		return {"handovers": list_handovers(scope="mine")}
	frappe.throw(_("Unknown list {0}").format(kind))


# --------------------------------------------------------------------------------------------- clinical rounds
def _add_patient_counts(rounds):
	if not rounds:
		return
	counts = {
		r.parent: r
		for r in frappe.db.sql(
			"""select parent, count(*) total, sum(seen) seen from `tabClinical Round Patient`
			where parenttype='Clinical Round' and parent in %(n)s group by parent""",
			{"n": [r.name for r in rounds]},
			as_dict=True,
		)
	}
	for r in rounds:
		c = counts.get(r.name)
		r.patients_total = cint(c.total) if c else 0
		r.patients_seen = cint(c.seen) if c else 0


@frappe.whitelist()
def list_rounds(scope="all", from_date=None, to_date=None):
	if not frappe.has_permission("Clinical Round"):
		return []
	filters = []
	if scope == "mine":
		filters.append(["lead", "=", frappe.session.user])
		filters.append(["status", "in", ["Scheduled", "In Progress"]])
	if from_date:
		filters.append(["round_date", ">=", from_date])
	if to_date:
		filters.append(["round_date", "<=", to_date])
	rounds = frappe.get_list(
		"Clinical Round",
		filters=filters,
		fields=[
			"name", "title", "round_type", "status", "round_date", "round_time", "lead", "department",
			"team", "service_unit", "task", "notes",
		],
		order_by="round_date desc, round_time desc",
		limit_page_length=300,
	)
	_add_patient_counts(rounds)
	return rounds


@frappe.whitelist()
def get_round(name):
	doc = frappe.get_doc("Clinical Round", name)
	doc.check_permission("read")
	d = doc.as_dict()
	d["can_write"] = bool(doc.has_permission("write"))
	return d


@frappe.whitelist()
def save_round(data):
	data = frappe.parse_json(data)
	is_new = not data.get("name")
	doc = frappe.new_doc("Clinical Round") if is_new else frappe.get_doc("Clinical Round", data.name)
	for f in ("title", "round_type", "status", "round_date", "round_time", "lead", "department", "team", "service_unit", "task", "notes"):
		if f in data:
			doc.set(f, data.get(f) or None)
	if "patients" in data:
		doc.set("patients", [])
		for p in data.get("patients") or []:
			if p.get("patient"):
				doc.append(
					"patients",
					{
						"patient": p.get("patient"),
						"inpatient_record": p.get("inpatient_record"),
						"bed": p.get("bed"),
						"seen": cint(p.get("seen")),
						"notes": p.get("notes"),
					},
				)
	doc.save()
	if is_new:
		_log(doc, _("scheduled this round"))
	return doc.name


@frappe.whitelist()
def set_round_status(name, status):
	doc = frappe.get_doc("Clinical Round", name)
	doc.status = status
	doc.save()
	_log(doc, _("marked this round {0}").format("<b>" + escape_html(status) + "</b>"))
	return status


@frappe.whitelist()
def round_patient_seen(row, seen):
	parent = frappe.db.get_value("Clinical Round Patient", row, "parent")
	if not parent:
		frappe.throw(_("Patient row not found"))
	doc = frappe.get_doc("Clinical Round", parent)
	doc.check_permission("write")
	frappe.db.set_value("Clinical Round Patient", row, "seen", cint(seen))
	if doc.status == "Scheduled" and cint(seen):
		doc.db_set("status", "In Progress")
	return cint(seen)


# --------------------------------------------------------------------------------------------- handover
@frappe.whitelist()
def list_handovers(scope="all"):
	if not frappe.has_permission("Task Handover"):
		return []
	filters, or_filters = [], None
	if scope == "mine":
		user = frappe.session.user
		or_filters = [["to_user", "=", user], ["from_user", "=", user]]
		filters.append(["status", "in", ["Pending", "Acknowledged"]])
	return frappe.get_list(
		"Task Handover",
		filters=filters,
		or_filters=or_filters,
		fields=[
			"name", "subject", "status", "priority", "handover_date", "shift", "from_user", "to_user",
			"department", "service_unit", "patient", "patient_name", "task", "details", "acknowledged_by",
			"acknowledged_on", "creation",
		],
		order_by="handover_date desc, creation desc",
		limit_page_length=300,
	)


@frappe.whitelist()
def save_handover(data):
	data = frappe.parse_json(data)
	is_new = not data.get("name")
	doc = frappe.new_doc("Task Handover") if is_new else frappe.get_doc("Task Handover", data.name)
	for f in ("subject", "priority", "handover_date", "shift", "from_user", "to_user", "department", "service_unit", "patient", "task", "details"):
		if f in data:
			doc.set(f, data.get(f) or None)
	if is_new and not doc.from_user:
		doc.from_user = frappe.session.user
	doc.save()
	if is_new:
		_log(doc, _("created this handover"))
		if doc.to_user and doc.to_user != frappe.session.user:
			_notify(
				{
					"doctype": "Notification Log",
					"for_user": doc.to_user,
					"from_user": frappe.session.user,
					"type": "Alert",
					"document_type": "Task Handover",
					"document_name": doc.name,
					"subject": _("{0} handed over: {1}").format(
						frappe.utils.get_fullname(frappe.session.user), escape_html(doc.subject)
					),
				}
			)
	return doc.name


@frappe.whitelist()
def set_handover_status(name, status):
	if status not in ("Pending", "Acknowledged", "Completed", "Cancelled"):
		frappe.throw(_("Unknown status"))
	doc = frappe.get_doc("Task Handover", name)
	doc.status = status
	if status == "Acknowledged":
		doc.acknowledged_by = frappe.session.user
		doc.acknowledged_on = now_datetime()
	doc.save()
	_log(doc, _("marked this handover {0}").format("<b>" + status + "</b>"))
	return status


# --------------------------------------------------------------------------------------------- teams
@frappe.whitelist()
def list_teams():
	if not frappe.has_permission("Task Team"):
		return []
	from task_management.task_management.permissions import visible_teams

	# without a projects role a user only gets the teams that concern them
	only = visible_teams()
	if only is not None and not only:
		return []
	teams = frappe.get_list(
		"Task Team",
		filters={"disabled": 0, "name": ["in", list(only)]} if only is not None else {"disabled": 0},
		fields=["name", "team_name", "parent_team", "department", "designation", "team_lead", "color", "description"],
		order_by="team_name asc",
		limit_page_length=1000,
	)
	if not teams:
		return []
	names = [t.name for t in teams]
	members = {}
	for m in frappe.db.sql(
		"""select parent, user, employee, full_name, designation, role_in_team from `tabTask Team Member`
		where parenttype='Task Team' and parent in %(n)s order by idx""",
		{"n": names},
		as_dict=True,
	):
		members.setdefault(m.parent, []).append(
			{"user": m.user, "employee": m.employee, "full_name": m.full_name, "designation": m.designation, "role": m.role_in_team}
		)
	counts = {
		r.tm_team: r
		for r in frappe.db.sql(
			"""select tm_team, sum(status!='Completed') open, sum(status='Completed') done,
			sum(status!='Completed' and exp_end_date < curdate()) overdue
			from `tabTask` where tm_team in %(n)s and status not in ('Cancelled','Template') group by tm_team""",
			{"n": names},
			as_dict=True,
		)
	}
	for t in teams:
		t.members = members.get(t.name, [])
		c = counts.get(t.name)
		t.open = cint(c.open) if c else 0
		t.done = cint(c.done) if c else 0
		t.overdue = cint(c.overdue) if c else 0
	return teams


@frappe.whitelist()
def save_team(data):
	data = frappe.parse_json(data)
	doc = frappe.get_doc("Task Team", data.name) if data.get("name") else frappe.new_doc("Task Team")
	for f in ("team_name", "parent_team", "department", "designation", "team_lead", "color", "description"):
		if f in data and not (f == "team_name" and data.get("name")):
			doc.set(f, data.get(f) or None)
	if "members" in data:
		# the dialog edits members that have a login; staff without a login (employee rows) are kept
		old = {m.user: m for m in doc.members if m.user}
		keep = [m.as_dict() for m in doc.members if not m.user]
		doc.set("members", [])
		seen = set()
		for m in data.get("members") or []:
			user = m.get("user") if isinstance(m, dict) else m
			if user and user not in seen:
				seen.add(user)
				prev = old.get(user)
				doc.append(
					"members",
					{
						"user": user,
						"employee": prev.employee if prev else None,
						"full_name": (prev.full_name if prev else None) or frappe.utils.get_fullname(user),
						"designation": prev.designation if prev else None,
						"role_in_team": (m.get("role") if isinstance(m, dict) else None) or (prev.role_in_team if prev else None),
					},
				)
		for m in keep:
			doc.append("members", {k: m.get(k) for k in ("employee", "full_name", "designation", "role_in_team")})
	if doc.parent_team and (doc.parent_team == doc.name or frappe.db.get_value("Task Team", doc.parent_team, "parent_team")):
		frappe.throw(_("A sub-team must belong to a main team (one level only)."))
	doc.save()
	return doc.name


@frappe.whitelist()
def team_tasks(team):
	"""Tasks of a team; a main team also shows the tasks of its sub-teams."""
	from task_management.task_management.permissions import visible_teams

	frappe.get_doc("Task Team", team).check_permission("read")
	only = visible_teams()
	if only is not None and team not in only:
		frappe.throw(_("You are not part of this team."), frappe.PermissionError)
	teams = [team] + [t for t in frappe.get_all("Task Team", filters={"parent_team": team}, pluck="name") if only is None or t in only]
	return _get_tasks(filters=[["tm_team", "in", teams]])


# --------------------------------------------------------------------------------------------- activity
def _activity_scope():
	"""{doctype: {name: title}} of every task, round and handover the user may see."""
	scope = {}
	flt_ = []
	scope["Task"] = {
		t.name: t.subject
		for t in frappe.get_list("Task", filters=flt_, fields=["name", "subject"], limit_page_length=3000)
	}
	if frappe.has_permission("Clinical Round"):
		scope["Clinical Round"] = {
			r.name: r.title
			for r in frappe.get_list("Clinical Round", filters=flt_, fields=["name", "title"], limit_page_length=1000)
		}
	if frappe.has_permission("Task Handover"):
		scope["Task Handover"] = {
			r.name: r.subject
			for r in frappe.get_list("Task Handover", filters=flt_, fields=["name", "subject"], limit_page_length=1000)
		}
	return scope


def _activity_rows(scope, limit=30, start=0, after=None, not_by=None, count=False):
	conds, values = [], {"types": ACTIVITY_TYPES}
	for i, (dt, names) in enumerate(scope.items()):
		if names:
			conds.append("(reference_doctype=%(dt{0})s and reference_name in %(n{0})s)".format(i))
			values["dt%d" % i] = dt
			values["n%d" % i] = list(names)
	if not conds:
		return 0 if count else []
	extra = ""
	if after:
		extra += " and creation > %(after)s"
		values["after"] = after
	if not_by:
		extra += " and ifnull(comment_email,'') != %(not_by)s"
		values["not_by"] = not_by
	where = "comment_type in %(types)s and ({0}){1}".format(" or ".join(conds), extra)
	if count:
		return frappe.db.sql("select count(*) from `tabComment` where " + where, values)[0][0]
	values.update(limit=cint(limit), start=cint(start))
	rows = frappe.db.sql(
		"""select name, comment_type, comment_email, comment_by, content, reference_doctype, reference_name, creation
		from `tabComment` where {0} order by creation desc limit %(start)s, %(limit)s""".format(where),
		values,
		as_dict=True,
	)
	for r in rows:
		raw = cstr(r.pop("content"))
		r.is_log = raw.startswith(LOG_MARK)
		r.text = _plain(raw)
		r.title = scope.get(r.reference_doctype, {}).get(r.reference_name) or r.reference_name
		r.user = r.pop("comment_email") or None
	return rows


def _activity_unseen():
	seen = _user_default("tm_activity_seen") or add_days(nowdate(), -7)
	n = _activity_rows(_activity_scope(), after=seen, not_by=frappe.session.user, count=True)
	return min(cint(n), 99)


@frappe.whitelist()
def activity(limit=30, start=0, mark_seen=0):
	scope = _activity_scope()
	limit = min(cint(limit) or 30, 100)
	items = _activity_rows(scope, limit=limit + 1, start=start)
	if cint(mark_seen):
		_user_default("tm_activity_seen", cstr(now_datetime()))
	return {"items": items[:limit], "more": len(items) > limit}


# --------------------------------------------------------------------------------------------- chat
def _chat_seen():
	try:
		return json.loads(_user_default("tm_chat_seen") or "{}")
	except Exception:
		return {}


def _chat_key(doctype, name):
	return "{0}::{1}".format(doctype, name)


@frappe.whitelist()
def chat_channels():
	"""A general channel (comments on this Page record), one per team (comments on the Task Team) and
	the user's person-to-person conversations (Task Chat Message)."""
	channels = [{"doctype": "Page", "name": PAGE, "title": _("General")}]
	if frappe.has_permission("Task Team"):
		from task_management.task_management.permissions import chat_teams

		only = chat_teams()  # a team channel is for the people of that team
		for t in frappe.get_list("Task Team", filters={"disabled": 0}, fields=["name"], order_by="name asc", limit_page_length=200):
			if only is None or t.name in only:
				channels.append({"doctype": "Task Team", "name": t.name, "title": t.name})
	if not channels:
		return []
	seen = _chat_seen()
	floor = cstr(add_days(now_datetime(), -30))
	stats = {}
	for r in frappe.db.sql(
		"""select reference_doctype, reference_name, comment_email, comment_by, content, creation from `tabComment`
		where comment_type='Comment' and reference_doctype in %(dts)s and creation > %(floor)s order by creation asc""",
		{"dts": CHAT_DOCTYPES, "floor": floor},
		as_dict=True,
	):
		key = _chat_key(r.reference_doctype, r.reference_name)
		s = stats.setdefault(key, {"unread": 0})
		s["last"] = r
		if r.comment_email != frappe.session.user and cstr(r.creation) > cstr(seen.get(key) or floor):
			s["unread"] += 1
	for c in channels:
		s = stats.get(_chat_key(c["doctype"], c["name"]), {})
		last = s.get("last")
		c["unread"] = s.get("unread", 0)
		c["last_text"] = _plain(last.content, 80) if last else None
		c["last_by"] = last.comment_by if last else None
		c["last_at"] = last.creation if last else None
	channels.sort(key=lambda c: cstr(c["last_at"] or ""), reverse=True)
	return channels + _dm_channels()


def _dm_channels():
	me = frappe.session.user
	rows = frappe.db.sql(
		"""select if(sender=%(me)s, recipient, sender) other, max(creation) last_at,
			sum(recipient=%(me)s and is_read=0) unread
		from `tabTask Chat Message` where sender=%(me)s or recipient=%(me)s group by other order by last_at desc""",
		{"me": me},
		as_dict=True,
	)
	out = []
	for r in rows:
		last = frappe.db.sql(
			"""select message, sender from `tabTask Chat Message`
			where (sender=%(me)s and recipient=%(o)s) or (sender=%(o)s and recipient=%(me)s) order by creation desc limit 1""",
			{"me": me, "o": r.other},
			as_dict=True,
		)[0]
		out.append(
			{
				"doctype": DM,
				"name": r.other,
				"title": frappe.utils.get_fullname(r.other),
				"unread": cint(r.unread),
				"last_text": _plain(escape_html(last.message), 80),
				"last_by": last.sender,
				"last_at": r.last_at,
			}
		)
	return out


def _dm_user(name):
	if name == frappe.session.user or not frappe.db.get_value("User", {"name": name, "enabled": 1, "user_type": "System User"}):
		frappe.throw(_("You cannot message this user."))
	return name


def _chat_doc(doctype, name):
	if doctype not in CHAT_DOCTYPES:
		frappe.throw(_("Unknown channel"))
	doc = frappe.get_doc(doctype, name)
	if doctype == "Page":
		if name != PAGE or not doc.is_permitted():
			frappe.throw(_("Unknown channel"), frappe.PermissionError)
	else:
		from task_management.task_management.permissions import chat_teams

		doc.check_permission("read")
		only = chat_teams()
		if only is not None and name not in only:
			frappe.throw(_("This channel is for the members of the team."), frappe.PermissionError)
	return doc


@frappe.whitelist()
def chat_messages(doctype, name, limit=80):
	if doctype == DM:
		me, other = frappe.session.user, _dm_user(name)
		rows = frappe.db.sql(
			"""select name, message text, sender user, creation, is_read from `tabTask Chat Message`
			where (sender=%(me)s and recipient=%(o)s) or (sender=%(o)s and recipient=%(me)s)
			order by creation desc limit %(limit)s""",
			{"me": me, "o": other, "limit": min(cint(limit) or 80, 300)},
			as_dict=True,
		)
		frappe.db.sql("update `tabTask Chat Message` set is_read=1 where sender=%s and recipient=%s and is_read=0", (other, me))
		return list(reversed(rows))
	_chat_doc(doctype, name)
	rows = frappe.get_all(
		"Comment",
		filters={"reference_doctype": doctype, "reference_name": name, "comment_type": "Comment"},
		fields=["name", "content", "comment_email", "comment_by", "creation"],
		order_by="creation desc",
		limit_page_length=min(cint(limit) or 80, 300),
	)
	for r in rows:
		r.text = _plain(r.pop("content"), 4000)
		r.user = r.pop("comment_email")
	seen = _chat_seen()
	seen[_chat_key(doctype, name)] = cstr(now_datetime())
	_user_default("tm_chat_seen", json.dumps(seen))
	return list(reversed(rows))


@frappe.whitelist()
def chat_send(doctype, name, text):
	from task_management.task_management import notify

	text = cstr(text).strip()
	if not text:
		frappe.throw(_("Message is empty"))
	if doctype == DM:
		me, other = frappe.session.user, _dm_user(name)
		msg = frappe.get_doc({"doctype": "Task Chat Message", "sender": me, "recipient": other, "message": text[:4000]})
		msg.insert(ignore_permissions=True)
		frappe.publish_realtime("tm_chat", {"doctype": DM, "name": me, "by": me}, user=other, after_commit=True)
		notify.push([other], _("New message from {0}").format(frappe.utils.get_fullname(me)), escape_html(text), "task-hub/chat/User/" + me, "chat")
		notify.chat_bell(other, _("{0} sent you a message").format("<strong>" + escape_html(frappe.utils.get_fullname(me)) + "</strong>"), "Task Chat Message", msg.name)
		return msg.name
	doc = _chat_doc(doctype, name)
	c = doc.add_comment("Comment", escape_html(text[:4000]).replace("\n", "<br>"))
	frappe.publish_realtime("tm_chat", {"doctype": doctype, "name": name, "by": frappe.session.user}, after_commit=True)
	if doctype == "Task Team":  # the General channel is for everybody: it shows on the chat badge, without a pop-up
		notify.push(
			notify.team_users(name),
			_("{0} in {1}").format(frappe.utils.get_fullname(frappe.session.user), escape_html(name)),
			escape_html(text),
			"task-hub/chat/Task Team/" + name,
			"chat",
		)
		for user in notify.team_users(name):
			notify.chat_bell(
				user,
				_("{0} wrote in the team channel {1}").format(
					"<strong>" + escape_html(frappe.utils.get_fullname(frappe.session.user)) + "</strong>", "<b>" + escape_html(name) + "</b>"
				),
				"Task Team",
				name,
			)
	return c.name


@frappe.whitelist()
def chat_delete(doctype, name, message):
	"""Remove one of your own chat messages (a Task Chat Message, or your comment in a channel)."""
	me = frappe.session.user
	if doctype == DM:
		other = _dm_user(name)
		if not frappe.db.exists("Task Chat Message", {"name": message, "sender": me, "recipient": other}):
			frappe.throw(_("You can only delete your own messages."), frappe.PermissionError)
		frappe.delete_doc("Task Chat Message", message, ignore_permissions=True)
		frappe.publish_realtime("tm_chat", {"doctype": DM, "name": me, "by": me}, user=other, after_commit=True)
		return True
	_chat_doc(doctype, name)
	if not frappe.db.exists(
		"Comment",
		{"name": message, "reference_doctype": doctype, "reference_name": name, "comment_type": "Comment", "comment_email": me},
	):
		frappe.throw(_("You can only delete your own messages."), frappe.PermissionError)
	frappe.delete_doc("Comment", message, ignore_permissions=True)
	frappe.publish_realtime("tm_chat", {"doctype": doctype, "name": name, "by": me}, after_commit=True)
	return True


# --------------------------------------------------------------------------------------------- calendar / files / search
@frappe.whitelist()
def calendar(start, end):
	start, end = getdate(start), getdate(end)
	events = []
	for t in _get_tasks(filters=[["exp_end_date", "between", [start, end]]]):
		events.append(
			{"kind": "task", "name": t.name, "title": t.subject, "date": t.exp_end_date, "column": t.column, "priority": t.priority, "overdue": t.overdue}
		)
	pf = []
	if frappe.has_permission("Clinical Round"):
		for r in frappe.get_list(
			"Clinical Round",
			filters=pf + [["round_date", "between", [start, end]], ["status", "!=", "Cancelled"]],
			fields=["name", "title", "round_date", "round_time", "status"],
			limit_page_length=500,
		):
			events.append({"kind": "round", "name": r.name, "title": r.title, "date": r.round_date, "time": cstr(r.round_time or "")[:5], "status": r.status})
	if frappe.has_permission("Task Handover"):
		for h in frappe.get_list(
			"Task Handover",
			filters=pf + [["handover_date", "between", [start, end]], ["status", "!=", "Cancelled"]],
			fields=["name", "subject", "handover_date", "status"],
			limit_page_length=500,
		):
			events.append({"kind": "handover", "name": h.name, "title": h.subject, "date": h.handover_date, "status": h.status})
	return events


def _files(groups, limit=300):
	"""groups: [(doctype, [names])]"""
	conds, values = [], {"limit": limit}
	titles = {}
	for i, (dt, names) in enumerate(groups):
		if isinstance(names, dict):
			titles[dt] = names
			names = list(names)
		if names:
			conds.append("(attached_to_doctype=%(dt{0})s and attached_to_name in %(n{0})s)".format(i))
			values["dt%d" % i] = dt
			values["n%d" % i] = list(names)
	if not conds:
		return []
	rows = frappe.db.sql(
		"""select name, file_name, file_url, file_size, is_private, attached_to_doctype, attached_to_name, owner, creation
		from `tabFile` where is_folder=0 and ({0}) order by creation desc limit %(limit)s""".format(" or ".join(conds)),
		values,
		as_dict=True,
	)
	for r in rows:
		r.title = titles.get(r.attached_to_doctype, {}).get(r.attached_to_name) or r.attached_to_name
	return rows


@frappe.whitelist()
def files():
	return _files([(dt, names) for dt, names in _activity_scope().items()])


@frappe.whitelist()
def search(q):
	q = cstr(q).strip()
	if len(q) < 2:
		return []
	like = "%" + q + "%"
	out = []
	for t in frappe.get_list(
		"Task",
		filters=[["status", "not in", ["Cancelled", "Template"]]],
		or_filters=[["subject", "like", like], ["name", "like", like], ["tm_patient", "like", like], ["tm_patient_name", "like", like]],
		fields=["name", "subject", "status"],
		order_by="modified desc",
		limit_page_length=8,
	):
		out.append({"kind": "task", "name": t.name, "title": t.subject, "sub": " · ".join(filter(None, [t.name, t.status]))})
	if frappe.has_permission("Clinical Round"):
		for r in frappe.get_list(
			"Clinical Round", or_filters=[["title", "like", like], ["name", "like", like]], fields=["name", "title", "round_date", "status"], order_by="round_date desc", limit_page_length=5
		):
			out.append({"kind": "round", "name": r.name, "title": r.title, "sub": " · ".join([cstr(r.round_date), r.status or ""])})
	if frappe.has_permission("Task Handover"):
		for h in frappe.get_list(
			"Task Handover",
			or_filters=[["subject", "like", like], ["name", "like", like], ["patient_name", "like", like]],
			fields=["name", "subject", "handover_date", "status"],
			order_by="handover_date desc",
			limit_page_length=5,
		):
			out.append({"kind": "handover", "name": h.name, "title": h.subject, "sub": " · ".join([cstr(h.handover_date), h.status or ""])})
	return out


# --------------------------------------------------------------------------------------------- notifications
@frappe.whitelist()
def notifications(limit=20):
	rows = frappe.get_all(
		"Notification Log",
		filters={"for_user": frappe.session.user},
		fields=["name", "subject", "type", "document_type", "document_name", "from_user", "read", "creation"],
		order_by="creation desc",
		limit_page_length=min(cint(limit) or 20, 50),
	)
	for r in rows:
		r.subject = _plain(r.subject, 200)
	return rows


@frappe.whitelist()
def notification_route(name):
	"""Route inside task-hub for one of the user's notifications (used by the navbar notification button)."""
	from task_management.task_management import notify

	log = frappe.db.get_value("Notification Log", name, ["for_user", "from_user", "document_type", "document_name"], as_dict=True)
	if not log or log.for_user != frappe.session.user:
		return None
	return notify.route_of_log(log)


@frappe.whitelist()
def notifications_read(name=None):
	filters = {"for_user": frappe.session.user, "read": 0}
	if name:
		filters["name"] = name
	for n in frappe.get_all("Notification Log", filters=filters, pluck="name", limit_page_length=500):
		frappe.db.set_value("Notification Log", n, "read", 1, update_modified=False)
	return True
