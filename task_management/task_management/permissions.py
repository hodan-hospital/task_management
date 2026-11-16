# Copyright (c) 2026, Hodan Hospital
"""Row-level rules that let every desk user work in the page `task-hub`.

Role "Task User" may read / write / create Task, Task Handover and read Clinical Round, but such a user
(no Task Manager, Projects User, Projects Manager or System Manager role) only reaches the records that concern them:

  Task            created by them, assigned to them, completed by them, or given to a team they belong to
  Task Handover   created by them, from them or to them
  Clinical Round  created by them, led by them, or of a team they belong to

Users with a full-access role are not restricted in what they see.

On a task that a Task User reaches:
  the creator   may change everything (subject, description, dates, priority, assignees, checklist, sub-tasks)
  an assignee   may only change the status, give the reason for a delay, tick checklist items, comment and attach files
  nobody        may delete it: deleting is for Task Manager and System Manager only
Wired in hooks.py (permission_query_conditions / has_permission).
"""
import frappe

# "Task Manager" is this app's own role: give it to someone who must see every task, team and channel
FULL_ACCESS_ROLES = {"Task Manager", "Projects User", "Projects Manager", "System Manager"}


# only these roles may delete a task (not even its creator)
DELETE_ROLES = {"Task Manager", "System Manager"}

# what only the creator of a task (or a full-access user) may change; see task_validate
CORE_FIELDS = (
	"subject", "description", "exp_start_date", "exp_end_date", "priority", "type", "department",
	"tm_team", "tm_patient", "project", "parent_task", "is_milestone",
)


def has_full_access(user=None):
	user = user or frappe.session.user
	return user == "Administrator" or bool(FULL_ACCESS_ROLES.intersection(frappe.get_roles(user)))


def my_teams(user=None):
	"""Teams the user belongs to (as member or lead)."""
	user = user or frappe.session.user
	teams = set(frappe.get_all("Task Team Member", filters={"user": user, "parenttype": "Task Team"}, pluck="parent"))
	teams.update(frappe.get_all("Task Team", filters={"team_lead": user}, pluck="name"))
	return teams


def chat_teams(user=None):
	"""Teams whose channel a user may read and write: None means every team (full access).

	Otherwise the teams the user belongs to - as a member (by login or by their employee record) or as the
	lead - together with the main team above each of them and the sub-teams of the teams they lead.
	"""
	user = user or frappe.session.user
	if has_full_access(user):
		return None
	teams = my_teams(user)
	employees = frappe.get_all("Employee", filters={"user_id": user}, pluck="name")
	if employees:
		teams.update(
			frappe.get_all("Task Team Member", filters={"employee": ["in", employees], "parenttype": "Task Team"}, pluck="parent")
		)
	if teams:
		rows = frappe.get_all("Task Team", filters={"name": ["in", list(teams)]}, fields=["name", "parent_team", "team_lead"])
		teams.update(r.parent_team for r in rows if r.parent_team)
		led = [r.name for r in rows if r.team_lead == user]
		if led:
			teams.update(frappe.get_all("Task Team", filters={"parent_team": ["in", led]}, pluck="name"))
	return teams


def visible_teams(user=None):
	"""Teams shown to a user on the Teams page: None means every team (full access).

	Their own teams (see chat_teams) plus the teams of the tasks that concern them - tasks they created,
	are assigned to or completed - and the main team above each of those.
	"""
	user = user or frappe.session.user
	teams = chat_teams(user)
	if teams is None:
		return None
	of_tasks = set(
		frappe.get_list("Task", filters={"tm_team": ["is", "set"]}, pluck="tm_team", limit_page_length=0, user=user)
	) - teams
	if of_tasks:
		teams.update(of_tasks)
		teams.update(
			p for p in frappe.get_all("Task Team", filters={"name": ["in", list(of_tasks)]}, pluck="parent_team") if p
		)
	return teams


def _in_teams(column, user):
	teams = my_teams(user)
	if not teams:
		return ""
	return " or {0} in ({1})".format(column, ", ".join(frappe.db.escape(t) for t in teams))


def _assigned(doc, user):
	return user in frappe.parse_json(doc.get("_assign") or "[]")


# ------------------------------------------------------------------ Task
def task_query(user=None):
	user = user or frappe.session.user
	if has_full_access(user):
		return ""
	u = frappe.db.escape(user)
	like = frappe.db.escape('%"' + user + '"%')
	return "(`tabTask`.owner = {u} or `tabTask`.completed_by = {u} or `tabTask`._assign like {like}{teams})".format(
		u=u, like=like, teams=_in_teams("`tabTask`.tm_team", user)
	)


def can_delete_task(user=None):
	user = user or frappe.session.user
	return user == "Administrator" or bool(DELETE_ROLES.intersection(frappe.get_roles(user)))


def can_edit_task(doc, user=None):
	"""The creator of a task and full-access users may change the task itself."""
	user = user or frappe.session.user
	return has_full_access(user) or doc.owner == user


def task_validate(doc, method=None):
	"""An assignee may move a task and explain a delay, but not rewrite it (doc_events: Task.validate)."""
	if doc.is_new() or doc.flags.ignore_permissions or doc.flags.ignore_recursion_check or can_edit_task(doc):
		return
	before = doc.get_doc_before_save()
	if not before:
		return
	text = lambda v: "" if v in (None, 0, "0") else str(v)  # noqa: E731
	changed = [doc.meta.get_label(f) for f in CORE_FIELDS if text(before.get(f)) != text(doc.get(f))]
	if [(r.name, r.title) for r in before.get("tm_checklist") or []] != [(r.name, r.title) for r in doc.get("tm_checklist") or []]:
		changed.append(doc.meta.get_label("tm_checklist"))
	if changed:
		frappe.throw(
			frappe._("Only the creator of this task or a Task Manager can change: {0}. You can update the status, give a reason or add a comment.").format(", ".join(changed)),
			frappe.PermissionError,
			title=frappe._("Not your task to edit"),
		)


def task_has_permission(doc, ptype=None, user=None):
	user = user or frappe.session.user
	if doc.is_new():
		return True
	if ptype == "delete":
		return can_delete_task(user)
	if has_full_access(user):
		return True
	return bool(
		doc.owner == user
		or doc.get("completed_by") == user
		or _assigned(doc, user)
		or (doc.get("tm_team") and doc.tm_team in my_teams(user))
	)


# ------------------------------------------------------------------ Task Handover
def handover_query(user=None):
	user = user or frappe.session.user
	if has_full_access(user):
		return ""
	u = frappe.db.escape(user)
	return "(`tabTask Handover`.owner = {u} or `tabTask Handover`.from_user = {u} or `tabTask Handover`.to_user = {u})".format(u=u)


def handover_has_permission(doc, ptype=None, user=None):
	user = user or frappe.session.user
	if has_full_access(user) or doc.is_new():
		return True
	return user in (doc.owner, doc.get("from_user"), doc.get("to_user"))


# ------------------------------------------------------------------ Clinical Round
def round_query(user=None):
	user = user or frappe.session.user
	if has_full_access(user):
		return ""
	u = frappe.db.escape(user)
	return "(`tabClinical Round`.owner = {u} or `tabClinical Round`.`lead` = {u}{teams})".format(
		u=u, teams=_in_teams("`tabClinical Round`.team", user)
	)


def round_has_permission(doc, ptype=None, user=None):
	user = user or frappe.session.user
	if has_full_access(user) or doc.is_new():
		return True
	return bool(user in (doc.owner, doc.get("lead")) or (doc.get("team") and doc.team in my_teams(user)))
