"""Fix two correctness gaps found reviewing 0010/0011 before any router uses them
(docs/rbac-migration-plan.md Phase 1/2 review):

1. admin_units.path was being set by application code (the 0010 seed loader), not the database — the
   first manual insert outside that loader would silently get it wrong. A trigger now computes it from
   parent_id + slug on every insert, so the app never has to remember to.
2. parcels.admin_path was plain text, so a scope check could never use the ltree GiST index. It stays
   text (the ORM column is String, and converting it to ltree broke every INSERT through the ORM —
   caught by running the full test suite against this migration, see docs/rbac-migration-plan.md
   review) but now has a GiST index on the ltree-cast expression, which `admin_path::ltree <@ :scope`
   queries (app/authz.py) can use without the column itself changing type.
3. officer_assignments had no DB-level guard against the same (user_id, role, admin_unit_id) having two
   overlapping valid_from/valid_to ranges (a double-booked posting) — an exclusion constraint now
   enforces it. Multiple *different* simultaneous assignments for one user (e.g. a sub_registrar's
   several tehsils, or acting-in-charge of two units) are still allowed; only an exact-same-triple
   overlap is rejected.

Revision ID: 0012_admin_units_path_trigger
Revises: 0011_rbac_users
"""
import sqlalchemy as sa
from alembic import op

revision = "0012_admin_units_path_trigger"
down_revision = "0011_rbac_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    if is_pg:
        op.execute("""
            CREATE OR REPLACE FUNCTION admin_units_set_path() RETURNS trigger AS $$
            DECLARE parent_path ltree;
            BEGIN
                IF NEW.parent_id IS NULL THEN
                    NEW.path := text2ltree(NEW.slug);
                ELSE
                    SELECT path INTO parent_path FROM admin_units WHERE id = NEW.parent_id;
                    IF parent_path IS NULL THEN
                        RAISE EXCEPTION 'admin_units.parent_id % does not exist or has no path', NEW.parent_id;
                    END IF;
                    NEW.path := parent_path || text2ltree(NEW.slug);
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql
        """)
        op.execute("""
            CREATE TRIGGER trg_admin_units_set_path
            BEFORE INSERT OR UPDATE OF parent_id, slug ON admin_units
            FOR EACH ROW EXECUTE FUNCTION admin_units_set_path()
        """)
        # NOTE: this recomputes the row being written, not its descendants. Reparenting an existing
        # subtree (changing a district's parent_id after it has children) would leave children's paths
        # stale — not needed for the seed-script-only usage so far; a recursive repair is deferred.

        op.execute("CREATE INDEX IF NOT EXISTS idx_parcels_admin_path_gist "
                   "ON parcels USING gist ((admin_path::ltree))")

        op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
        # valid_from/valid_to are always timezone-aware ISO-8601 (datetime.now(timezone.utc).isoformat()),
        # so this cast is deterministic regardless of session timezone — safe to mark IMMUTABLE, which a
        # bare ::timestamptz cast in the exclusion constraint is not allowed to be.
        op.execute("""
            CREATE OR REPLACE FUNCTION iso_to_tstz(ts text) RETURNS timestamptz AS $$
                SELECT ts::timestamptz
            $$ LANGUAGE sql IMMUTABLE STRICT
        """)
        op.execute("""
            ALTER TABLE officer_assignments ADD CONSTRAINT excl_officer_assignment_overlap
            EXCLUDE USING gist (
                user_id WITH =,
                role WITH =,
                admin_unit_id WITH =,
                tstzrange(iso_to_tstz(valid_from), coalesce(iso_to_tstz(valid_to), 'infinity'::timestamptz)) WITH &&
            )
        """)
    else:
        # SQLite dev fallback: AFTER INSERT (SQLite triggers cannot assign NEW columns before the row is
        # written, unlike Postgres), single-level parent lookup — correct because parents are always
        # inserted before children (seed order, and the FK itself requires it).
        op.execute("""
            CREATE TRIGGER trg_admin_units_set_path AFTER INSERT ON admin_units
            BEGIN
                UPDATE admin_units SET path =
                    CASE WHEN NEW.parent_id IS NULL THEN NEW.slug
                         ELSE (SELECT path FROM admin_units WHERE id = NEW.parent_id) || '.' || NEW.slug END
                WHERE id = NEW.id;
            END
        """)


def downgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"
    if is_pg:
        op.execute("ALTER TABLE officer_assignments DROP CONSTRAINT IF EXISTS excl_officer_assignment_overlap")
        op.execute("DROP FUNCTION IF EXISTS iso_to_tstz(text)")
        op.execute("DROP INDEX IF EXISTS idx_parcels_admin_path_gist")
        op.execute("DROP TRIGGER IF EXISTS trg_admin_units_set_path ON admin_units")
        op.execute("DROP FUNCTION IF EXISTS admin_units_set_path()")
    else:
        op.execute("DROP TRIGGER IF EXISTS trg_admin_units_set_path")
