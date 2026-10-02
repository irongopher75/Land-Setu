"""Canonical role ladder (docs/rbac-migration-plan.md Phase 2). The backend authorizes against these
names only; `role_titles` in backend/configs/*.yaml are display labels for the same canonical role and
carry no authorization weight.

`scope_level` is the admin_units.level an assignment for that role must point at. An officer's actual
scope is the union of their active officer_assignments rows (see app/authz.py) — `sub_registrar` is
commonly assigned several `tehsil` units (an "SRO area"), which is why scope is a set, not a single row.
"""

OFFICER_ROLES = (
    "village_officer",
    "surveyor",
    "revenue_inspector",
    "tehsildar",
    "naib_tehsildar",
    "sdo",
    "district_collector",
    "additional_collector",
    "sub_registrar",
    "state_land_records_admin",
    "state_auditor",
    "national_viewer",
    "system_admin",
)

# Non-officer: identifies a citizen's own records via parcel_owners, not an admin_units scope.
CITIZEN_ROLE = "citizen"

ALL_ROLES = OFFICER_ROLES + (CITIZEN_ROLE,)

SCOPE_LEVEL = {
    "village_officer": "village",
    "surveyor": "tehsil",
    "revenue_inspector": "circle",
    "tehsildar": "tehsil",
    "naib_tehsildar": "tehsil",
    "sdo": "subdivision",
    "district_collector": "district",
    "additional_collector": "district",
    "sub_registrar": "tehsil",  # an SRO area is one or more tehsils; assign one row per tehsil.
    "state_land_records_admin": "state",
    "state_auditor": "state",
    "national_viewer": "country",
    "system_admin": None,  # no land-record scope; manages users/technical config only.
}

# Roles that may act on parcel-level workflow steps. state_land_records_admin/state_auditor are
# read-only (separation of duties); national_viewer gets aggregates only; system_admin has no land-record
# access at all (break-glass read is a separate, audited path — see app/authz.py).
WORKFLOW_ACTOR_ROLES = (
    "village_officer", "surveyor", "revenue_inspector", "tehsildar", "naib_tehsildar",
    "sdo", "district_collector", "additional_collector", "sub_registrar",
)

READ_ONLY_STATE_ROLES = ("state_land_records_admin", "state_auditor")


def role_title(state_config: dict, role: str) -> str:
    """Localised title for `role` from a state's adapter config, falling back to the canonical name."""
    titles = (state_config or {}).get("role_titles") or {}
    return titles.get(role, role.replace("_", " ").title())
