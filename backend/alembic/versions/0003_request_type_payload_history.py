"""BoundaryChangeRequest type, payload, history

Revision ID: 0003_request_type_payload
Revises: 0002_parcel_flags_gist
Create Date: 2026-09-23

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0003_request_type_payload'
down_revision: Union[str, Sequence[str], None] = '0002_parcel_flags_gist'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('boundary_change_requests',
                  sa.Column('type', sa.String(), nullable=False, server_default='BOUNDARY'))
    op.add_column('boundary_change_requests', sa.Column('payload', sa.JSON(), nullable=True))
    op.add_column('boundary_change_requests', sa.Column('history', sa.JSON(), nullable=True))
    op.create_index('ix_boundary_change_requests_type', 'boundary_change_requests', ['type'])


def downgrade() -> None:
    op.drop_index('ix_boundary_change_requests_type', table_name='boundary_change_requests')
    op.drop_column('boundary_change_requests', 'history')
    op.drop_column('boundary_change_requests', 'payload')
    op.drop_column('boundary_change_requests', 'type')
