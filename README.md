# Task Management (task_management)

Quality Control Tracker for Hodan Hospital inside ERPNext v14. It replaces the Google Sheets tracker.
Workspace: **Quality Control**. Page: **Quality Control Tracker** (`/app/qc-tracker`).

The tracker keeps its original screens. They run inside an ERPNext page, and the data is stored in ERPNext.

## Who can do what
| Role | Can |
|---|---|
| QC User | open the tracker; log and update non-clinical complaints, clinical complaints, audits and meetings; delete what they recorded |
| QC Manager | everything above, plus verify & close (or reopen) items, delete anyone's records, edit QC Settings, archive and restore, and see the QC Records and QC Audit Log reports |

The person using the tracker is the signed-in ERPNext user. There are no PINs or team passwords.

## Tabs
Dashboard · Non-Clinical Complaints · Clinical Complaints · Round Report · Issues & CAPA · Management Meeting · Round Audits · Department Rankings · Trends.
The old Settings tab is now **QC Settings** (deadlines, department heads and WhatsApp, heads group link, meeting committee, round audit checklists, archive) and user roles in ERPNext.

Round audit checklists: each department has its own checklist in *QC Settings → Round audit checklists*; departments without one use the general checklist. QC Managers can also change a department's checklist with **Edit checklist** on the Round Audits tab. Saved audits keep the items they were scored on.

## How it fits together
- `quality_control/tracker_app/index.html`: the tracker page. It is built from the original `Index.html` by
  `build_tracker.py`, and every change is listed at the top of that script. Rebuild it with
  `python3 build_tracker.py /path/to/Index.html`.
- `quality_control/api.py`: the endpoint behind the page, `qc`, which handles the requests init, pull, put, photo and patients.
  - The server records who did what.
  - It enforces the role rules.
  - It gives the never-reused numbers (`MC-YYYYMMDD-0001` per day, `MM-YYYYMMDD-NN` running) and writes the audit log.
- `QC Document`: one row per tracker item, with JSON data plus readable columns used by reports and the archive.
- `QC Counter`: running numbers and the change counter.
- Photos and attachments are private ERPNext Files in `Home/QC Tracker` (stored on S3 when S3 is on).
- Daily job: old deleted-item markers are removed after *QC Settings → Keep deleted-item markers for (days)*. The audit log keeps the history.

## Importing the Google Sheets data
1. Run `ExportForMigration.gs` (read-only) and download `qc-export.json` and the *QC Rounds Tracker Photos* folder.
2. `node verify-export.js qc-export.json "<photos folder>"` must say `RESULT: OK`.
3. Department matching:
   `bench --site <site> execute task_management.quality_control.importer.department_template --kwargs "{'export_path': '<qc-export.json>', 'out_csv': '<dept-map.csv>'}"`.
   Check the `erpnext_department` column. An empty cell keeps the old name.
4. Dry run, then the real import (add `'dry_run': 0`):
   `bench --site <site> execute task_management.quality_control.importer.import_export --kwargs "{'export_path': '<qc-export.json>', 'photos_dir': '<photos folder>', 'dept_map_csv': '<dept-map.csv>', 'dry_run': 1}"`

The import can be run again; items are matched by id and numbers are kept.
PINs, PIN hashes, the team password and items deleted in Google Sheets are not imported.
The export contains patient data: keep it on hospital storage and delete it after the switch-over.
