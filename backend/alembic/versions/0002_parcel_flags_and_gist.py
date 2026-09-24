"""Parcel.flags cache column and explicit GIST indexes

Revision ID: 0002_parcel_flags_gist
Revises: 257b89b6dada
Create Date: 2026-09-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = '0002_parcel_flags_gist'
down_revision: Union[str, Sequence[str], None] = '257b89b6dada'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    is_pg = bind.dialect.name == "postgresql"

    flags_type = postgresql.JSONB() if is_pg else sa.JSON()
    # NULL = stale. Existing rows are filled lazily on first read.
    op.add_column('parcels', sa.Column('flags', flags_type, nullable=True))

    if is_pg:
        # Same names geoalchemy2 spatial_index=True generates, so no duplicates.
        op.execute("CREATE INDEX IF NOT EXISTS idx_parcels_geometry ON parcels USING gist (geometry)")
        op.execute("CREATE INDEX IF NOT EXISTS idx_protected_zones_geometry ON protected_zones USING gist (geometry)")


def downgrade() -> None:
    # The GIST indexes belong to the initial schema, so they stay.
    op.drop_column('parcels', 'flags')
