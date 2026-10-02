"""argon2id password hashing (docs/rbac-migration-plan.md Phase 2 Part B). Single source of truth for
hash/verify parameters, so no login call site picks its own and no route verifies a password with a
hand-rolled comparison."""
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerifyMismatchError

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """False on any mismatch or malformed hash — never raises, so a caller can treat 'no such account'
    and 'wrong password' identically without a try/except at every call site."""
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHash):
        return False


def needs_rehash(password_hash: str) -> bool:
    """True if `password_hash` was produced with weaker-than-current argon2id parameters — call after a
    successful verify_password and re-hash+store if so, so a parameter bump upgrades accounts on their
    next login instead of needing a bulk migration."""
    return _hasher.check_needs_rehash(password_hash)
