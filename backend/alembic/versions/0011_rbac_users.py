"""Postgres-native RBAC tables: users, officer_assignments, citizens, parcel_owners, refresh_tokens,
citizen_merge_candidates, jurisdiction_reconciliation (docs/rbac-migration-plan.md Phase 2/4/6).

Revision ID: 0011_rbac_users
Revises: 0010_admin_units
"""
import sqlalchemy as sa
from alembic import op

revision = "0011_rbac_users"
down_revision = "0010_admin_units"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(), nullable=True, unique=True, index=True),
        sa.Column("user_type", sa.String(), nullable=False, index=True),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("must_change_password", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("failed_logins", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("deactivation_reason", sa.String(), nullable=True),
    )

    op.create_table(
        "officer_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("role", sa.String(), nullable=False, index=True),
        sa.Column("admin_unit_id", sa.Integer(), sa.ForeignKey("admin_units.id"), nullable=False, index=True),
        sa.Column("valid_from", sa.String(), nullable=False),
        sa.Column("valid_to", sa.String(), nullable=True, index=True),
        sa.Column("assigned_by", sa.String(), nullable=True),
    )

    op.create_table(
        "citizens",
        sa.Column("citizen_uid", sa.String(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, unique=True, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("masked_display", sa.String(), nullable=False),
    )

    op.create_table(
        "parcel_owners",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ulpin", sa.String(), sa.ForeignKey("parcels.ulpin"), nullable=False, index=True),
        sa.Column("citizen_uid", sa.String(), sa.ForeignKey("citizens.citizen_uid"), nullable=False, index=True),
        sa.Column("share_fraction", sa.Float(), nullable=False, server_default="1.0"),
        sa.Column("owner_since", sa.String(), nullable=True),
        sa.Column("source", sa.String(), nullable=False, server_default="seed"),
        sa.UniqueConstraint("ulpin", "citizen_uid", name="uq_parcel_owner"),
    )

    op.create_table(
        "citizen_merge_candidates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("normalised_name", sa.String(), nullable=False, index=True),
        sa.Column("village_admin_unit_id", sa.Integer(), sa.ForeignKey("admin_units.id"), nullable=True),
        sa.Column("citizen_uids", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending", index=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("resolved_at", sa.String(), nullable=True),
        sa.Column("resolved_by", sa.String(), nullable=True),
    )

    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.String(), nullable=False, unique=True, index=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False, index=True),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("issued_at", sa.String(), nullable=False),
        sa.Column("expires_at", sa.String(), nullable=False),
        sa.Column("revoked_at", sa.String(), nullable=True),
    )

    op.create_table(
        "jurisdiction_reconciliation",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("ulpin", sa.String(), sa.ForeignKey("parcels.ulpin"), nullable=False, unique=True, index=True),
        sa.Column("reason_code", sa.String(), nullable=False),
        sa.Column("best_known_state", sa.String(), nullable=True, index=True),
        sa.Column("candidate_admin_unit_ids", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("resolved_at", sa.String(), nullable=True),
        sa.Column("resolved_by", sa.String(), nullable=True),
        sa.Column("resolution_note", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("jurisdiction_reconciliation")
    op.drop_table("refresh_tokens")
    op.drop_table("citizen_merge_candidates")
    op.drop_table("parcel_owners")
    op.drop_table("citizens")
    op.drop_table("officer_assignments")
    op.drop_table("users")
