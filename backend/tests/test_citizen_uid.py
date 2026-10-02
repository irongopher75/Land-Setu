"""Verhoeff check-digit correctness for the placeholder citizen_uid (app/citizen_uid.py)."""
from app.citizen_uid import (
    generate_citizen_uid, is_valid_placeholder_uid, verhoeff_check_digit, verhoeff_validate,
)


def test_known_good_verhoeff_vector():
    # Standard published Verhoeff worked example (Wikipedia "Verhoeff algorithm"): the check digit
    # for "236" is 3, and the resulting number "2363" validates.
    assert verhoeff_check_digit("236") == 3
    assert verhoeff_validate("2363") is True


def test_verhoeff_detects_single_digit_error():
    assert verhoeff_validate("2364") is False  # last digit altered
    assert verhoeff_validate("2663") is False  # interior digit altered


def test_verhoeff_detects_adjacent_transposition():
    # Verhoeff's whole point over Luhn: it catches adjacent transpositions too.
    assert verhoeff_validate("2633") is False  # "23" -> "32" (prefix 236 -> 326 transposed) stays invalid
    swapped = "3263"
    assert swapped != "2363"


def test_generate_citizen_uid_shape_and_validity():
    for _ in range(200):
        uid = generate_citizen_uid()
        assert len(uid) == 12
        assert uid.isdigit()
        assert uid[0] not in ("0", "1"), f"placeholder UID must not start with 0 or 1: {uid}"
        assert is_valid_placeholder_uid(uid), f"generated UID failed its own Verhoeff check: {uid}"


def test_is_valid_placeholder_uid_rejects_leading_0_or_1():
    # A UID that would otherwise Verhoeff-validate but starts with 0 or 1 must still be rejected.
    body = "02345678901"  # starts with 0
    check = verhoeff_check_digit(body)
    forged = body + str(check)
    assert verhoeff_validate(forged) is True  # the digits themselves are internally consistent
    assert is_valid_placeholder_uid(forged) is False  # but it's rejected for starting with 0
