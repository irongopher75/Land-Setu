"""parcel status, request track and requester, append-only audit log

Revision ID: 0004_archival_tracks_audit_log
Revises: 0003_request_type_payload
"""
from alembic import op
import sqlalchemy as sa

revision = "0004_archival_tracks_audit_log"
down_revision = "0003_request_type_payload"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("parcels", sa.Column("status", sa.String(), nullable=False, server_default="active"))
    op.add_column("parcels", sa.Column("archived_at", sa.String(), nullable=True))
    op.add_column("parcels", sa.Column("archived_reason", sa.String(), nullable=True))
    op.add_column("parcels", sa.Column("superseded_by", sa.String(), nullable=True))
    op.create_index("ix_parcels_status", "parcels", ["status"])
    op.add_column("boundary_change_requests", sa.Column("track", sa.String(), nullable=False, server_default="HIGH"))
    op.add_column("boundary_change_requests", sa.Column("requester_uid", sa.String(), nullable=True))
    op.create_table(
        "parcel_audit_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ulpin", sa.String(), nullable=False, index=True),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("request_id", sa.Integer(), nullable=True),
        sa.Column("event", sa.String(), nullable=False),
        sa.Column("from_status", sa.String(), nullable=True),
        sa.Column("to_status", sa.String(), nullable=True),
        sa.Column("actor_role", sa.String(), nullable=False),
        sa.Column("note", sa.String(), nullable=True),
        sa.Column("payload_digest", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("prev_hash", sa.String(), nullable=False),
        sa.Column("entry_hash", sa.String(), nullable=False),
        sa.UniqueConstraint("ulpin", "seq", name="uq_parcel_audit_seq"),
    )
    # The append-only trigger is installed by the application at startup (app/audit.py).


def downgrade():
    op.drop_table("parcel_audit_log")
    op.drop_column("boundary_change_requests", "requester_uid")
    op.drop_column("boundary_change_requests", "track")
    op.drop_index("ix_parcels_status", table_name="parcels")
    for c in ("superseded_by", "archived_reason", "archived_at", "status"):
        op.drop_column("parcels", c)
