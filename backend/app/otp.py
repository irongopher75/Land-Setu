"""OTP step interface stub (docs/rbac-migration-plan.md Phase 6). Not wired into the login flow yet —
this exists so a real provider (SMS/email gateway) can be dropped in later without touching auth.py's
call sites. `OTP_ENABLED` stays false until a real provider exists; flipping it on with the null
provider would not add security, only friction.
"""
import os
from abc import ABC, abstractmethod


class OTPProvider(ABC):
    @abstractmethod
    def send(self, user_id: int) -> str:
        """Send a one-time code to the user, returning an opaque challenge_id."""

    @abstractmethod
    def verify(self, challenge_id: str, code: str) -> bool:
        """True if `code` is the current, unexpired code for `challenge_id`."""


class NullOTPProvider(OTPProvider):
    """No-op placeholder. Never used while OTP_ENABLED is false (the default)."""

    def send(self, user_id: int) -> str:
        raise NotImplementedError("No OTP provider is configured")

    def verify(self, challenge_id: str, code: str) -> bool:
        return False


OTP_ENABLED = os.getenv("OTP_ENABLED", "false").lower() == "true"


def get_otp_provider() -> OTPProvider:
    return NullOTPProvider()
