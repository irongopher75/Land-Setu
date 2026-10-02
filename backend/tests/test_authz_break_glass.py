"""break_glass_read must deny today, unconditionally — it is not wired to a real caller yet
(docs/rbac-migration-plan.md Phase 2/6 review). No DB needed: it must raise before touching one."""
import pytest

from app.authz import ScopeDenied, UserContext, break_glass_read


def test_break_glass_denies_system_admin_with_reason():
    ctx = UserContext(user_id=1, user_type="officer", role="system_admin")
    with pytest.raises(ScopeDenied):
        break_glass_read(db=None, ctx=ctx, ulpin="TEST-1", reason="investigating a fraud report")


def test_break_glass_denies_non_system_admin():
    ctx = UserContext(user_id=2, user_type="officer", role="village_officer")
    with pytest.raises(ScopeDenied):
        break_glass_read(db=None, ctx=ctx, ulpin="TEST-1", reason="investigating a fraud report")


def test_break_glass_denies_empty_reason():
    ctx = UserContext(user_id=1, user_type="officer", role="system_admin")
    with pytest.raises(ScopeDenied):
        break_glass_read(db=None, ctx=ctx, ulpin="TEST-1", reason="")
