"""Add columns introduced after a database was first created. create_all() only creates missing
tables, so older deployments need these ALTERs. Alembic revision 0004 does the same for managed upgrades."""
from sqlalchemy import inspect, text

NEW_COLUMNS = {
    "parcels": [
        ("status", "VARCHAR NOT NULL DEFAULT 'active'"),
        ("archived_at", "VARCHAR"),
        ("archived_reason", "VARCHAR"),
        ("superseded_by", "VARCHAR"),
    ],
    "boundary_change_requests": [
        ("track", "VARCHAR NOT NULL DEFAULT 'HIGH'"),
        ("requester_uid", "VARCHAR"),
    ],
}


def upgrade_schema(engine) -> None:
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    with engine.begin() as conn:
        for table, cols in NEW_COLUMNS.items():
            if table not in tables:
                continue
            have = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols:
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
