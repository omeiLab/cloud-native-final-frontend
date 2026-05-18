"""PII mask helper tests(設計 05 §13.6 / 13.8)"""

from app.modules.admin.pii import mask_email, mask_employee_id, mask_name


def test_mask_name_cjk_three_chars() -> None:
    assert mask_name("王小明") == "王*明"


def test_mask_name_cjk_two_chars() -> None:
    assert mask_name("王明") == "王*"


def test_mask_name_cjk_single_char_unchanged() -> None:
    assert mask_name("王") == "王"


def test_mask_name_latin() -> None:
    assert mask_name("John Doe") == "J*** D**"


def test_mask_name_mixed_uses_latin_path() -> None:
    """:混合 CJK + 英文走拉丁路徑(不該吃掉空格)"""
    # `Alice 王` → `A**** 王`(每 token 各 mask;單字符的 `王` 不 mask)
    assert mask_name("Alice 王") == "A**** 王"


def test_mask_name_cjk_extension() -> None:
    """:CJK Extension 罕字仍走 CJK 路徑"""
    # `𠮷王` 是 CJK Extension B + BMP;3 字以下 → 留首末
    masked = mask_name("𠮷王明")
    # 不該被 split 成 latin path(因為都是 CJK)
    assert masked.startswith("𠮷")
    assert masked.endswith("明")


def test_mask_name_empty() -> None:
    assert mask_name("") == ""


def test_mask_employee_id() -> None:
    assert mask_employee_id("E12345") == "E1****"
    assert mask_employee_id("AB") == "AB" # 2 字以內不 mask
    assert mask_employee_id("") == ""


def test_mask_email() -> None:
    assert mask_email("alice@example.com") == "a****@example.com"
    assert mask_email("a@b") == "a@b" # local-part <= 1 不 mask
    assert mask_email("not-email") == "not-email"
