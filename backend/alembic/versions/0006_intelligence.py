"""transfer and encumbrance history, parcel entry time and district, parcel_intelligence cache

Revision ID: 0006_intelligence
Revises: 0005_request_flags_actor_ref
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_intelligence"
down_revision = "0005_request_flags_actor_ref"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("parcels", sa.Column("created_at", sa.String(), nullable=True))
    op.add_column("parcels", sa.Column("district", sa.String(), nullable=True))
    op.create_table(
        "registration_transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ulpin", sa.String(), nullable=False, index=True),
        sa.Column("transaction_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False, server_default="sale"),
        sa.Column("seller_name", sa.String(), nullable=True),
        sa.Column("buyer_name", sa.String(), nullable=True),
        sa.Column("deed_date", sa.String(), nullable=False),
        sa.Column("recorded_at", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False, server_default="sub_registrar"),
        sa.Column("synthetic_fixture", sa.String(), nullable=True),
    )
    op.create_table(
        "encumbrance_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ulpin", sa.String(), nullable=False, index=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("holder", sa.String(), nullable=True),
        sa.Column("raised_at", sa.String(), nullable=False),
        sa.Column("cleared_at", sa.String(), nullable=True),
        sa.Column("source", sa.String(), nullable=False, server_default="sub_registrar"),
        sa.Column("synthetic_fixture", sa.String(), nullable=True),
    )
    op.create_table(
        "parcel_intelligence",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ulpin", sa.String(), nullable=False, unique=True, index=True),
        sa.Column("state", sa.String(), nullable=False, index=True),
        sa.Column("fraud_flags", sa.JSON(), nullable=True),
        sa.Column("risk_score", sa.Float(), nullable=True),
        sa.Column("risk_score_factors", sa.JSON(), nullable=True),
        sa.Column("zoning_anomaly", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("zoning_explanation", sa.String(), nullable=True),
        sa.Column("computed_at", sa.String(), nullable=True),
        sa.Column("stale", sa.Boolean(), nullable=False, server_default=sa.true(), index=True),
    )


def downgrade():
    for t in ("parcel_intelligence", "encumbrance_events", "registration_transactions"):
        op.drop_table(t)
    op.drop_column("parcels", "district")
    op.drop_column("parcels", "created_at")
