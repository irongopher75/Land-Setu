"""state_boundaries table: real state/UT polygons for ST_Intersects state detection

Seeds from backend/seed/boundaries/state_boundaries.geojson (geoBoundaries IND ADM1): the
pilot states (Chandigarh, Tamil Nadu) and their neighbours (Punjab, Haryana, Kerala,
Karnataka, Andhra Pradesh). Idempotent: upserts by state_code, so re-running updates the
seed data in place instead of duplicating rows.

Revision ID: 0009_state_boundaries
Revises: 0008_land_transactions
"""
import json
import os

from alembic import op
import sqlalchemy as sa

revision = "0009_state_boundaries"
down_revision = "0008_land_transactions"
branch_labels = None
depends_on = None

SEED_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "seed", "boundaries", "state_boundaries.geojson",
)


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    op.create_table(
        "state_boundaries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("state_code", sa.String(), nullable=False, unique=True, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("geometry", sa.JSON() if not is_pg else sa.dialects.postgresql.JSON(), nullable=False),
    )

    if not is_pg:
        return  # SQLite dev mode: table exists, geometry stored as JSON, no GIST index, no seed data.

    # geoalchemy2's Geometry type needs the column to already exist in the right shape; alter it to a real
    # PostGIS geometry column instead of trying to add it as that type directly (simpler to express in raw SQL
    # than via op.alter_column across the JSON/geometry type boundary).
    op.execute("ALTER TABLE state_boundaries ALTER COLUMN geometry TYPE geometry(MultiPolygon, 4326) "
               "USING ST_SetSRID(ST_GeomFromGeoJSON(geometry::text), 4326)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_state_boundaries_geometry ON state_boundaries USING gist (geometry)")

    if not os.path.exists(SEED_PATH):
        return

    with open(SEED_PATH, "r", encoding="utf-8") as f:
        features = json.load(f)["features"]

    upsert = sa.text(
        "INSERT INTO state_boundaries (state_code, name, geometry) "
        "VALUES (:code, :name, ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326)) "
        "ON CONFLICT (state_code) DO UPDATE SET name = EXCLUDED.name, geometry = EXCLUDED.geometry"
    )
    for feat in features:
        props = feat["properties"]
        bind.execute(upsert, {
            "code": props["state_code"],
            "name": props["name"],
            "geom": json.dumps(feat["geometry"]),
        })


def downgrade() -> None:
    op.drop_table("state_boundaries")
