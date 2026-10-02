"""admin_units: real administrative hierarchy (country -> state -> district -> subdivision ->
tehsil -> circle -> village), replacing bbox-only state detection as the jurisdiction source of truth.

Seeds from config/districts.yaml (editable, not hardcoded) — see docs/rbac-migration-plan.md Phase 1.
Idempotent: upserts by `path`, so re-running updates names in place instead of duplicating rows. No
boundary polygon or LGD code is invented here: a unit with no GeoJSON in data/boundaries/ or entry in a
data/lgd/ export is created with geom NULL, lgd_code NULL, boundary_verified=false ("unmapped").

Also adds Parcel.admin_unit_id / Parcel.admin_path / Parcel.jurisdiction_status, used by the Phase 4
jurisdiction-resolution backfill (scripts/migrate_legacy.py) and by app/authz.py scope checks.

Revision ID: 0010_admin_units
Revises: 0009_state_boundaries
"""
import os

import sqlalchemy as sa
import yaml
from alembic import op

revision = "0010_admin_units"
down_revision = "0009_state_boundaries"
branch_labels = None
depends_on = None

CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "config", "districts.yaml",
)


def _iter_units(config: dict):
    """Yields (level, slug, name, parent_path_parts) for every unit in config/districts.yaml, depth-first,
    parents before children so each row's parent already exists when it's inserted."""
    country = config["country"]
    yield ("country", country["code"], country["name"], [])
    for state in config["states"]:
        state_parts = [country["code"]]
        yield ("state", state["code"], state["name"], state_parts)
        for district in state.get("districts", []):
            district_parts = state_parts + [state["code"]]
            yield ("district", district["slug"], district["name"], district_parts)
            for subdivision in district.get("subdivisions", []):
                subdivision_parts = district_parts + [district["slug"]]
                yield ("subdivision", subdivision["slug"], subdivision["name"], subdivision_parts)
                for tehsil in subdivision.get("tehsils", []):
                    tehsil_parts = subdivision_parts + [subdivision["slug"]]
                    yield ("tehsil", tehsil["slug"], tehsil["name"], tehsil_parts)
                    for circle in tehsil.get("circles", []):
                        circle_parts = tehsil_parts + [tehsil["slug"]]
                        yield ("circle", circle["slug"], circle["name"], circle_parts)
                        for village in circle.get("villages", []):
                            yield ("village", village["slug"], village["name"], circle_parts + [circle["slug"]])
            # shallow-tier districts: tehsils directly under the district, no subdivision/circle/village.
            for tehsil in district.get("tehsils", []):
                yield ("tehsil", tehsil["slug"], tehsil["name"], district_parts + [district["slug"]])


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    op.create_table(
        "admin_units",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("level", sa.String(), nullable=False, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("local_name", sa.String(), nullable=True),
        sa.Column("lgd_code", sa.String(), nullable=True, unique=True),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("admin_units.id"), nullable=True, index=True),
        sa.Column("slug", sa.String(), nullable=False, index=True),
        sa.Column("path", sa.String(), nullable=False, unique=True, index=True),
        sa.Column("geom", sa.JSON() if not is_pg else sa.dialects.postgresql.JSON(), nullable=True),
        sa.Column("boundary_source", sa.String(), nullable=True),
        sa.Column("boundary_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
    )

    op.add_column("parcels", sa.Column("admin_unit_id", sa.Integer(), nullable=True))
    op.add_column("parcels", sa.Column("admin_path", sa.String(), nullable=True))
    op.add_column(
        "parcels",
        sa.Column("jurisdiction_status", sa.String(), nullable=False, server_default="unresolved"),
    )
    op.create_index("ix_parcels_admin_unit_id", "parcels", ["admin_unit_id"])

    if is_pg:
        op.execute("CREATE EXTENSION IF NOT EXISTS ltree")
        op.execute("ALTER TABLE admin_units ALTER COLUMN path TYPE ltree USING path::ltree")
        op.execute("CREATE INDEX IF NOT EXISTS idx_admin_units_path_gist ON admin_units USING gist (path)")
        op.execute("ALTER TABLE admin_units ALTER COLUMN geom TYPE geometry(MultiPolygon, 4326) "
                   "USING CASE WHEN geom IS NULL THEN NULL ELSE ST_SetSRID(ST_GeomFromGeoJSON(geom::text), 4326) END")
        op.execute("CREATE INDEX IF NOT EXISTS idx_admin_units_geom_gist ON admin_units USING gist (geom)")

    if not os.path.exists(CONFIG_PATH):
        return  # nothing to seed from; table exists empty, seed later with the loader script.

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = yaml.safe_load(f)

    path_to_id = {}
    for level, slug, name, parent_parts in _iter_units(config):
        parent_path = ".".join(parent_parts) if parent_parts else None
        path = ".".join(parent_parts + [slug]) if parent_parts else slug
        parent_id = path_to_id.get(parent_path) if parent_path else None

        if is_pg:
            row = bind.execute(
                sa.text(
                    "INSERT INTO admin_units (level, name, slug, path, parent_id, boundary_verified) "
                    "VALUES (:level, :name, :slug, CAST(:path AS ltree), :parent_id, false) "
                    "ON CONFLICT (path) DO UPDATE SET name = EXCLUDED.name "
                    "RETURNING id"
                ),
                {"level": level, "name": name, "slug": slug, "path": path, "parent_id": parent_id},
            )
            path_to_id[path] = row.scalar()
        else:
            existing = bind.execute(
                sa.text("SELECT id FROM admin_units WHERE path = :path"), {"path": path}
            ).scalar()
            if existing:
                bind.execute(sa.text("UPDATE admin_units SET name = :name WHERE id = :id"),
                             {"name": name, "id": existing})
                path_to_id[path] = existing
            else:
                row = bind.execute(
                    sa.text(
                        "INSERT INTO admin_units (level, name, slug, path, parent_id, boundary_verified) "
                        "VALUES (:level, :name, :slug, :path, :parent_id, 0)"
                    ),
                    {"level": level, "name": name, "slug": slug, "path": path, "parent_id": parent_id},
                )
                path_to_id[path] = row.lastrowid


def downgrade() -> None:
    op.drop_index("ix_parcels_admin_unit_id", table_name="parcels")
    op.drop_column("parcels", "jurisdiction_status")
    op.drop_column("parcels", "admin_path")
    op.drop_column("parcels", "admin_unit_id")
    op.drop_table("admin_units")
