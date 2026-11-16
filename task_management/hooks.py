from . import __version__ as app_version  # noqa: F401

app_name = "task_management"
app_title = "Task Management"
app_publisher = "Hodan Hospital"
app_description = "Quality Control Tracker (non-clinical and clinical complaints, rounds, audits, management meetings)"
app_email = "admin@hodanhospital.com"
app_license = "MIT"

before_install = "task_management.install.before_install"
after_install = "task_management.install.after_install"
after_migrate = "task_management.install.after_migrate"

scheduler_events = {
	"daily": [
		"task_management.quality_control.api.purge_old_tombstones",
	],
}

# Task Management (page task-hub) is for the roles Task User and Task Manager. A Task User only reaches the
# tasks, handovers and rounds that concern them; a Task Manager sees everything. See task_management/permissions.py.
permission_query_conditions = {
	"Task": "task_management.task_management.permissions.task_query",
	"Task Handover": "task_management.task_management.permissions.handover_query",
	"Clinical Round": "task_management.task_management.permissions.round_query",
}
has_permission = {
	"Task": "task_management.task_management.permissions.task_has_permission",
	"Task Handover": "task_management.task_management.permissions.handover_has_permission",
	"Clinical Round": "task_management.task_management.permissions.round_has_permission",
}

# Live pop-up + sound for task notifications on every desk page (see task_management/notify.py).
app_include_js = ["/assets/task_management/js/tm_notify.js"]
doc_events = {
	"Task": {"validate": "task_management.task_management.permissions.task_validate"},
	"ToDo": {"after_insert": "task_management.task_management.notify.on_todo_insert"},
}
