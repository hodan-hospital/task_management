# Copyright (c) 2026, Hodan Hospital
"""Copy the round audit checklists of the old tracker page into QC Settings (they used to be built into the page)."""
from task_management.install import seed_checklists


def execute():
	seed_checklists()
