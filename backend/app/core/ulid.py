"""ULID 生成 — 對齊資料庫設計書 §2.4(主鍵全用 ULID)"""

from ulid import ULID


def generate_ulid() -> str:
    """26 字元 Base32 ULID,可排序、固定長度"""
    return str(ULID())
