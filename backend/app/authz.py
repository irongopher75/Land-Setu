"""Single authorization policy module (docs/rbac-migration-plan.md Phase 2/6). No route should hand-roll
a jurisdiction or ownership check — call into here instead, so the rule lives in exactly one place.

Out-of-scope is always 404 (ScopeDenied), never 403: a record a caller cannot see should not reveal that
it exists. Role-only checks (does this role exist at all, independent of which parcel) still use
`app.routes.auth.require_roles` and may 403 — only *parcel-shaped* denials go through here.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.db import IS_SQLITE
from app.models import Citizen, JurisdictionReconciliation, OfficerAssignment, AdminUnit, Parcel, ParcelOwner
from app.roles import READ_ONLY_STATE_ROLES, SCOPE_LEVEL


class ScopeDenied(Exception):
    """Raise this, not HTTPException, from policy code — routes translate it to a 404."""


@dataclass
class UserContext:
    user_id: int
    user_type: str  # officer | citizen | system
    role: str | None  # officer role, or "citizen", or None for system
    citizen_uid: str | None = None
    scope_paths: list[str] = field(default_factory=list)  # admin_units.path values this role is assigned to
    scope_level: str | None = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_context(db: Session, user_id: int, user_type: str, role: str | None) -> UserContext:
    if user_type == "citizen":
        citizen = db.query(Citizen).filter(Citizen.user_id == user_id).first()
        return UserContext(user_id=user_id, user_type="citizen", role="citizen",
                            citizen_uid=citizen.citizen_uid if citizen else None)

    if user_type == "system":
        return UserContext(user_id=user_id, user_type="system", role=role)

    now = _now_iso()
    rows = (
        db.query(OfficerAssignment, AdminUnit.path)
        .join(AdminUnit, AdminUnit.id == OfficerAssignment.admin_unit_id)
        .filter(OfficerAssignment.user_id == user_id)
        .filter(OfficerAssignment.role == role)
        .filter(OfficerAssignment.valid_from <= now)
        .filter(or_(OfficerAssignment.valid_to.is_(None), OfficerAssignment.valid_to > now))
        .all()
    )
    paths = [path for _assignment, path in rows]
    return UserContext(user_id=user_id, user_type="officer", role=role,
                        scope_paths=paths, scope_level=SCOPE_LEVEL.get(role))


def _covers(scope_paths: list[str], admin_path: str | None) -> bool:
    """True if `admin_path` is `scope_path` itself or a descendant of it (ltree ancestor semantics,
    expressed in Python so the same check works against Postgres `path` strings and the SQLite dev
    fallback alike). Prefer `ST_scope_filter` below inside a real query — this is for in-Python checks
    on a single already-loaded parcel."""
    if not admin_path:
        return False
    for scope_path in scope_paths:
        if admin_path == scope_path or admin_path.startswith(scope_path + "."):
            return True
    return False


def can_read_parcel(ctx: UserContext, parcel: Parcel, db: Session) -> bool:
    if ctx.user_type == "citizen":
        if not ctx.citizen_uid:
            return False
        return db.query(ParcelOwner.id).filter(
            ParcelOwner.ulpin == parcel.ulpin, ParcelOwner.citizen_uid == ctx.citizen_uid
        ).first() is not None

    if ctx.user_type == "system":
        return False  # break-glass only; see break_glass_read()

    if parcel.jurisdiction_status in ("unresolved", "boundary_straddle"):
        # Quarantined: only a state_land_records_admin for the best-known state, via the reconciliation
        # queue, not the normal scope check (see app/routes/admin.py reconciliation endpoints).
        return False

    return _covers(ctx.scope_paths, parcel.admin_path)


def scope_filter_sql(ctx: UserContext) -> tuple[str, dict] | None:
    """A parameterized SQL boolean fragment + bind params for scoping a list/search/aggregate query to
    `ctx.scope_paths` (each a prefix match: the unit itself or any descendant). Returns None when the
    caller has no admin-unit scope (citizen, or an officer role with zero active assignments) — callers
    must treat None as "match nothing", not "match everything". Values are always bound, never
    interpolated, even though `path` is loader-controlled (slugs only) — paths never reach SQL as raw text.

    On Postgres this casts admin_path to ltree and uses `<@` (descendant-or-self), which
    idx_parcels_admin_path_gist (migration 0012, a GiST index on the `admin_path::ltree` expression) can
    serve — confirmed with EXPLAIN in the Phase 1/2 review, see docs/rbac-migration-plan.md. The SQLite
    dev fallback has no ltree type, so it falls back to an equivalent LIKE-prefix match there.
    """
    if not ctx.scope_paths:
        return None
    clauses = []
    params = {}
    for i, p in enumerate(ctx.scope_paths):
        if IS_SQLITE:
            clauses.append(f"(admin_path = :scope_{i} OR admin_path LIKE :scope_{i}_prefix)")
            params[f"scope_{i}_prefix"] = p + ".%"
        else:
            clauses.append(f"admin_path::ltree <@ :scope_{i}::ltree")
        params[f"scope_{i}"] = p
    return " OR ".join(clauses), params


def require_actor_not_quarantined(parcel: Parcel) -> None:
    if parcel.jurisdiction_status in ("unresolved", "boundary_straddle"):
        raise ScopeDenied("parcel is in jurisdiction reconciliation; not actionable by district officers")


def conflict_of_interest(db: Session, ctx: UserContext, ulpin: str) -> bool:
    """True if this officer's linked citizen_uid is a party (owner) on this parcel — they must not act on
    their own case."""
    if not ctx.user_id:
        return False
    citizen = db.query(Citizen).filter(Citizen.user_id == ctx.user_id).first()
    if not citizen:
        return False
    return db.query(ParcelOwner.id).filter(
        ParcelOwner.ulpin == ulpin, ParcelOwner.citizen_uid == citizen.citizen_uid
    ).first() is not None


def can_resolve_jurisdiction(ctx: UserContext, reconciliation_state: str | None) -> bool:
    """Only a state_land_records_admin for the parcel's best-known state, or a system_admin break-glass
    (handled separately — break_glass_read is the only system_admin path, and it's read-only), may touch
    a jurisdiction_reconciliation row. District/tehsil/village-scoped officers never can, regardless of
    whether the row's best-known state happens to overlap their own scope — quarantine is deliberately
    outside the normal scope check (see can_read_parcel above).

    Not wired into any route yet — there is no reconciliation endpoint to call this from yet (Phase 4/6).
    This function exists now so the rule lives in one place before that endpoint is written, per
    docs/rbac-migration-plan.md: the schema alone enforces nothing without this.

    `reconciliation_state` must be an admin_units STATE CODE (e.g. "TN"), the same value that appears as
    the second path segment ("IN.TN...") — not Parcel.state's display name ("TamilNadu"). The Phase 4
    migration script that populates JurisdictionReconciliation.best_known_state is responsible for that
    mapping; this function does not guess it.
    """
    if ctx.user_type != "officer" or ctx.role != "state_land_records_admin":
        return False
    if not reconciliation_state:
        return False
    # ctx.scope_paths for a state_land_records_admin are state-level admin_unit paths, e.g. "IN.TN".
    return any(p.endswith("." + reconciliation_state) or p == reconciliation_state for p in ctx.scope_paths)


def is_read_only_role(role: str) -> bool:
    return role in READ_ONLY_STATE_ROLES


def break_glass_read(db: Session, ctx: UserContext, ulpin: str, reason: str) -> None:
    """system_admin read of a land record outside the normal policy, gated on system_admin role, a
    mandatory reason string, and a high-severity audit entry (Phase 2 "break-glass read").

    HARD-DISABLED for now. The review that found this function had no role check at all (any
    UserContext with a non-empty reason string would pass) also found no wired caller and no route that
    reaches it. Rather than fix the role check alone and leave an unused, untested privilege-escalation
    path live, this raises unconditionally until Phase 6 wires a real caller (auth.py's system_admin
    session + an actual route) and that caller's test suite exercises the allow path, not just this
    deny path. Flip this back on only alongside that route and its tests — see
    docs/rbac-migration-plan.md Phase 6/2.
    """
    raise ScopeDenied(
        "break-glass read is disabled: not yet wired to a real system_admin session or route "
        "(docs/rbac-migration-plan.md Phase 6)"
    )
