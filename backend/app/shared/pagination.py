"""跨模組共用分頁回應(對齊設計 05 §3.2)"""

from pydantic import BaseModel


class PagedResult[T](BaseModel):
    """PEP 695 generic;FastAPI / Pydantic v2 都認"""

    items: list[T]
    page: int
    page_size: int
    total: int
    has_next: bool

    @classmethod
    def build(cls, items: list[T], *, page: int, page_size: int, total: int) -> "PagedResult[T]":
        """工廠:統一 has_next 計算公式,免每個 endpoint 重寫"""
        return cls(
            items=items,
            page=page,
            page_size=page_size,
            total=total,
            has_next=page * page_size < total,
        )
