"""Placeholder citizen_uid generator (docs/rbac-migration-plan.md Phase 2). NEVER a real Aadhaar
number — a 12-digit placeholder with a valid Verhoeff check digit, never starting with 0 or 1 (the
rule real Aadhaar numbers follow, kept here only so a placeholder is visually indistinguishable in
shape from the thing it stands in for, while being synthetic by construction).
"""
import secrets

# Verhoeff algorithm tables (standard constants: multiplication table d, permutation table p, inverse inv).
_D = [
    [0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],
    [4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],
    [8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0],
]
_P = [
    [0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],
    [9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8],
]
_INV = [0,4,3,2,1,5,6,7,8,9]


def verhoeff_check_digit(number: str) -> int:
    """The Verhoeff check digit for `number` (digits only, most significant digit first). Position is
    shifted by one relative to `verhoeff_validate` below: the check digit being computed will occupy
    position 0 once appended, so the existing digits occupy positions 1.. during generation."""
    c = 0
    for i, digit in enumerate(reversed(number)):
        c = _D[c][_P[(i + 1) % 8][int(digit)]]
    return _INV[c]


def verhoeff_validate(number_with_check_digit: str) -> bool:
    c = 0
    for i, digit in enumerate(reversed(number_with_check_digit)):
        c = _D[c][_P[i % 8][int(digit)]]
    return c == 0


def _random_11_digits_not_starting_0_or_1() -> str:
    first = secrets.choice("23456789")
    rest = "".join(secrets.choice("0123456789") for _ in range(10))
    return first + rest


def generate_citizen_uid() -> str:
    """A 12-digit placeholder citizen_uid: 11 random digits (never starting with 0 or 1) plus a valid
    Verhoeff check digit. Caller is responsible for retrying on a uniqueness collision against
    citizens.citizen_uid (see scripts/seed_accounts.py) — this function alone cannot guarantee global
    uniqueness."""
    body = _random_11_digits_not_starting_0_or_1()
    return body + str(verhoeff_check_digit(body))


def is_valid_placeholder_uid(citizen_uid: str) -> bool:
    return (
        len(citizen_uid) == 12
        and citizen_uid.isdigit()
        and citizen_uid[0] not in ("0", "1")
        and verhoeff_validate(citizen_uid)
    )


def generate_unique_citizen_uid(db, max_attempts: int = 10) -> str:
    """generate_citizen_uid(), retried against citizens.citizen_uid (primary key, so a collision raises
    on insert, not here) until a free one is found. 11 random digits give ~9*10^10 possibilities, so a
    collision should be vanishingly rare — this exists so a rare collision retries instead of failing an
    entire seed run (docs/rbac-migration-plan.md Phase 2)."""
    from app.models import Citizen
    for _ in range(max_attempts):
        uid = generate_citizen_uid()
        if db.query(Citizen.citizen_uid).filter(Citizen.citizen_uid == uid).first() is None:
            return uid
    raise RuntimeError(f"could not generate a free citizen_uid after {max_attempts} attempts")


def mask_citizen_uid(citizen_uid: str) -> str:
    """'XXXX-XXXX-1234' — the only form a citizen_uid may appear in in any UI or log."""
    return f"XXXX-XXXX-{citizen_uid[-4:]}"
