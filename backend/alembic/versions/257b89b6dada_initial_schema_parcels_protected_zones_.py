"""Initial schema: parcels, protected_zones, boundary_change_requests

Revision ID: 257b89b6dada
Revises: 
Create Date: 2026-09-13 13:58:44.825843

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '257b89b6dada'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    from app.db import IS_SQLITE
    if not IS_SQLITE:
        try:
            from geoalchemy2 import Geometry
            geom_type = Geometry("POLYGON", srid=4326, spatial_index=True)
        except ImportError:
            geom_type = sa.JSON()
    else:
        geom_type = sa.JSON()

    # Create parcels table
    op.create_table(
        'parcels',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('ulpin', sa.String(), nullable=False),
        sa.Column('state', sa.String(), nullable=False),
        sa.Column('area_sqm', sa.Float(), nullable=True),
        sa.Column('geometry', geom_type, nullable=False),
        sa.Column('layers', sa.JSON(), nullable=False),
        sa.Column('raw_record', sa.JSON(), nullable=True),
    )
    op.create_index('ix_parcels_id', 'parcels', ['id'])
    op.create_index('ix_parcels_ulpin', 'parcels', ['ulpin'], unique=True)
    op.create_index('ix_parcels_state', 'parcels', ['state'])

    # Create protected_zones table
    op.create_table(
        'protected_zones',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('zone_id', sa.String(), nullable=False),
        sa.Column('state', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('geometry', geom_type, nullable=False),
    )
    op.create_index('ix_protected_zones_id', 'protected_zones', ['id'])
    op.create_index('ix_protected_zones_zone_id', 'protected_zones', ['zone_id'], unique=True)
    op.create_index('ix_protected_zones_state', 'protected_zones', ['state'])

    # Create boundary_change_requests table
    op.create_table(
        'boundary_change_requests',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('ulpin', sa.String(), nullable=False),
        sa.Column('state', sa.String(), nullable=False),
        sa.Column('requester_role', sa.String(), nullable=False),
        sa.Column('requested_by', sa.String(), nullable=False),
        sa.Column('geometry', sa.JSON(), nullable=False),
        sa.Column('area_sqm', sa.Float(), nullable=False),
        sa.Column('reason', sa.String(), nullable=True),
        sa.Column('status', sa.String(), nullable=False, server_default='PENDING_APPROVAL'),
        sa.Column('approved_by', sa.String(), nullable=True),
        sa.Column('approver_role', sa.String(), nullable=True),
        sa.Column('created_at', sa.String(), nullable=False),
    )
    op.create_index('ix_boundary_change_requests_id', 'boundary_change_requests', ['id'])
    op.create_index('ix_boundary_change_requests_ulpin', 'boundary_change_requests', ['ulpin'])
    op.create_index('ix_boundary_change_requests_state', 'boundary_change_requests', ['state'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('boundary_change_requests')
    op.drop_table('protected_zones')
    op.drop_table('parcels')
