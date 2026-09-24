"""request concerns (flags) and hashed actor reference on the audit log

Revision ID: 0005_request_flags_actor_ref
Revises: 0004_archival_tracks_audit_log
"""
from alembic import op
import sqlalchemy as sa

revision = "0005_request_flags_actor_ref"
down_revision = "0004_archival_tracks_audit_log"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("parcel_audit_log", sa.Column("actor_ref", sa.String(), nullable=True))
    op.create_table(
        "request_flags",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("request_id", sa.Integer(), nullable=False, index=True),
        sa.Column("ulpin", sa.String(), nullable=False, index=True),
        sa.Column("raised_by_uid", sa.String(), nullable=False),
        sa.Column("raised_by_role", sa.String(), nullable=False),
        sa.Column("raised_at", sa.String(), nullable=False),
        sa.Column("stage_at_raise", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="open", index=True),
        sa.Column("acknowledged_by_uid", sa.String(), nullable=True),
        sa.Column("acknowledged_at", sa.String(), nullable=True),
        sa.Column("resolved_by_uid", sa.String(), nullable=True),
        sa.Column("resolved_by_role", sa.String(), nullable=True),
        sa.Column("resolved_at", sa.String(), nullable=True),
        sa.Column("resolution_note", sa.String(), nullable=True),
    )


def downgrade():
    op.drop_table("request_flags")
    op.drop_column("parcel_audit_log", "actor_ref")
