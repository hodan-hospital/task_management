# Copyright (c) 2026, Hodan Hospital

from frappe.model.document import Document

from task_management.quality_control.api import clear_config_cache


class QCSettings(Document):
	def validate(self):
		for f in ("sla_critical", "sla_urgent", "sla_routine"):
			if (self.get(f) or 0) < 1:
				self.set(f, 1)
		if (self.tombstone_days or 0) < 7:
			self.tombstone_days = 7

	def on_update(self):
		clear_config_cache()
