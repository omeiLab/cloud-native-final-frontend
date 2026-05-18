"""PII mask helpers(設計 05 §13.6 + 13.8)。

姓名:中文/中字遮罩;`王小明` → `王*明`、`王明` → `王*`、`John Doe` → `J*** D**`
employee_id:`E12345` → `E1****`(留前 2 位 + 後續全 *,2 字以下不 mask)
email:`alice@example.com` → `a****@example.com`(local-part 留首字)

呼叫端:admin 報名清單 / 匯出時 mask_pii=True 套用。

:CJK pattern 擴充至 Extension A/B(罕字姓如 𠮷)、混合 CJK+Latin
走拉丁路徑(`Alice 王` 不該被遮成 `A*****王`,空格不能吃掉)。
"""

import re

# CJK Unified Ideographs(BMP)+ Extension A + Extension B 與相容區
_CJK_PATTERN = re.compile(
    r"["
    r"㐀-䶿" # CJK Extension A
    r"一-鿿" # CJK Unified Ideographs (BMP)
    r"豈-﫿" # CJK Compatibility Ideographs
    r"\U00020000-\U0002a6df" # CJK Extension B
    r"]"
)
_LATIN_PATTERN = re.compile(r"[A-Za-z]")


def mask_name(name: str) -> str:
    """姓名遮罩(後修正混合 pattern):
    - 純 CJK 字符 → 留首末字、中間 *;單字不 mask
    - 含拉丁字母 → 走拉丁路徑(每段獨立 mask),即便混 CJK 也不誤吃空格
    """
    if not name:
        return name
    has_cjk = bool(_CJK_PATTERN.search(name))
    has_latin = bool(_LATIN_PATTERN.search(name))
    # 混合(CJK + Latin)→ 走拉丁路徑,避免空格被中段吃掉
    if has_cjk and not has_latin:
        if len(name) <= 1:
            return name
        if len(name) == 2:
            return name[0] + "*"
        return name[0] + "*" * (len(name) - 2) + name[-1]
    # 拉丁(或拉丁 + CJK 混合):首字 + 後續每字留首字其餘 * 號
    parts = name.split(" ")
    out: list[str] = []
    for p in parts:
        if not p:
            continue
        if len(p) <= 1:
            out.append(p)
        else:
            out.append(p[0] + "*" * (len(p) - 1))
    return " ".join(out)


def mask_employee_id(employee_id: str) -> str:
    """留前 2 字 + 中段 * 號(2 字以上才 mask)"""
    if not employee_id or len(employee_id) <= 2:
        return employee_id
    return employee_id[:2] + "*" * (len(employee_id) - 2)


def mask_email(email: str, *, mask_domain: bool = False) -> str:
    """`alice@example.com` → `a****@example.com`(預設留 domain)
    `mask_domain=True` → `a****@***.com`(對外稽核 export 用,設計)
    """
    if not email or "@" not in email:
        return email
    local, _, domain = email.partition("@")
    masked_local = local if len(local) <= 1 else local[0] + "*" * (len(local) - 1)
    if not mask_domain:
        return masked_local + "@" + domain
    # mask domain:留 TLD 其餘 *
    if "." not in domain:
        return masked_local + "@***"
    parts = domain.split(".")
    return masked_local + "@" + "*" * len(parts[0]) + "." + ".".join(parts[1:])
