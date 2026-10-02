from app.password import hash_password, needs_rehash, verify_password


def test_hash_and_verify_roundtrip():
    h = hash_password("correct horse battery staple")
    assert verify_password(h, "correct horse battery staple") is True


def test_verify_rejects_wrong_password():
    h = hash_password("correct horse battery staple")
    assert verify_password(h, "wrong password") is False


def test_verify_rejects_malformed_hash_without_raising():
    assert verify_password("not-a-real-argon2-hash", "anything") is False


def test_hash_uses_argon2id():
    assert hash_password("x").startswith("$argon2id$")


def test_hash_is_salted_differently_each_time():
    assert hash_password("same-password") != hash_password("same-password")


def test_needs_rehash_false_for_a_fresh_hash():
    assert needs_rehash(hash_password("x")) is False
