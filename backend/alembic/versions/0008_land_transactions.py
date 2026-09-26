"""cross-department land transactions: stages, handoffs, dispute cases, notifications

Revision ID: 0008_land_transactions
Revises: 0007_recompute_flags_area_rule
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "0008_land_transactions"
down_revision = "0007_recompute_flags_area_rule"
branch_labels = None
depends_on = None

Details = sa.JSON(none_as_null=True).with_variant(JSONB(none_as_null=True), "postgresql")


def upgrade():
    op.create_table(
        "land_transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ulpin", sa.String(), sa.ForeignKey("parcels.ulpin"), nullable=False, index=True),
        sa.Column("state", sa.String(), nullable=False, index=True),
        sa.Column("transaction_type", sa.String(), nullable=False),
        sa.Column("deed_reference", sa.String(), nullable=False),
        sa.Column("initiated_at", sa.String(), nullable=False),
        sa.Column("initiated_by_ref", sa.String(), nullable=True),
        sa.Column("current_department", sa.String(), nullable=False),
        sa.Column("current_stage", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, index=True),
        sa.Column("details", Details, nullable=True),
    )
    op.create_table(
        "mutation_stages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("transaction_id", sa.Integer(), sa.ForeignKey("land_transactions.id"), nullable=False, index=True),
        sa.Column("department", sa.String(), nullable=False),
        sa.Column("stage_name", sa.String(), nullable=False),
        sa.Column("stage_order", sa.Integer(), nullable=False),
        sa.Column("role_required", sa.String(), nullable=False),
        sa.Column("officer_id", sa.String(), nullable=True),
        sa.Column("action", sa.String(), nullable=True),
        sa.Column("remarks", sa.String(), nullable=True),
        sa.Column("acted_at", sa.String(), nullable=True),
    )
    op.create_table(
        "department_handoffs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("transaction_id", sa.Integer(), sa.ForeignKey("land_transactions.id"), nullable=False, index=True),
        sa.Column("from_department", sa.String(), nullable=True),
        sa.Column("to_department", sa.String(), nullable=False),
        sa.Column("handoff_reason", sa.String(), nullable=False),
        sa.Column("handoff_at", sa.String(), nullable=False),
        sa.Column("actor_ref", sa.String(), nullable=True),
    )
    op.create_table(
        "dispute_cases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("transaction_id", sa.Integer(), sa.ForeignKey("land_transactions.id"), nullable=False, index=True),
        sa.Column("ulpin", sa.String(), nullable=False, index=True),
        sa.Column("objection_reason", sa.String(), nullable=False),
        sa.Column("objected_at", sa.String(), nullable=False),
        sa.Column("escalated_at", sa.String(), nullable=True),
        sa.Column("resolved_at", sa.String(), nullable=True),
        sa.Column("resolution", sa.String(), nullable=True),
        sa.Column("resolution_remarks", sa.String(), nullable=True),
    )
    op.create_table(
        "transaction_notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("transaction_id", sa.Integer(), sa.ForeignKey("land_transactions.id"), nullable=False, index=True),
        sa.Column("ulpin", sa.String(), nullable=False, index=True),
        sa.Column("event", sa.String(), nullable=False),
        sa.Column("recipient_department", sa.String(), nullable=False),
        sa.Column("recipient_role", sa.String(), nullable=True),
        sa.Column("message", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )


def downgrade():
    for t in ("transaction_notifications", "dispute_cases", "department_handoffs", "mutation_stages", "land_transactions"):
        op.drop_table(t)
