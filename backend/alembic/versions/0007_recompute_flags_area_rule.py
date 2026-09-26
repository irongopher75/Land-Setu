"""clear cached rule flags so the new area_mismatch rule is evaluated for every parcel

Revision ID: 0007_recompute_flags_area_rule
Revises: 0006_intelligence
"""
from alembic import op

revision = "0007_recompute_flags_area_rule"
down_revision = "0006_intelligence"
branch_labels = None
depends_on = None


def upgrade():
    # NULL means "not computed": each parcel's flags are recomputed, with the new rule, on its next read.
    op.execute("UPDATE parcels SET flags = NULL")


def downgrade():
    # Recomputing is always safe, so there is nothing to undo.
    op.execute("UPDATE parcels SET flags = NULL")
