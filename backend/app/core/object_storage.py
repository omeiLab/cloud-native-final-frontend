"""S3 / MinIO 物件儲存薄包裝(Batch B A3:archive 真實接入)

對齊設計 04 §8.2:archive job 將 ended > 2 年的活動 metadata 上傳至
`s3://cets-archive/events/{year}/{event_id}.jsonl`。

設計要點:
- 走 `aioboto3` async 介面,共用 main-api 事件迴圈,不開 thread pool
- 透過 `archive_s3_*` settings 注入 endpoint / AK / SK / bucket(:
  K8s Secret cets-minio-archive-key 限定 archive bucket only)
- `archive_s3_endpoint_url == ""` 視為 dry-run(lab 預設):caller 應自行決定
  是否走 stub log,object_storage 端只負責「設定齊全則上傳」
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

import aioboto3

from app.config import settings
from app.core.logging import get_logger

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = get_logger(__name__).bind(component="object_storage")


def is_archive_storage_configured() -> bool:
    """archive S3/MinIO 是否已注入完整 credentials(設定齊全才嘗試上傳)。"""
    return bool(
        settings.archive_s3_endpoint_url
        and settings.archive_s3_access_key_id
        and settings.archive_s3_secret_access_key
        and settings.archive_s3_bucket
    )


@asynccontextmanager
async def archive_s3_client() -> AsyncIterator[Any]:
    """yield 一個 aioboto3 S3 client(已 bind 到 archive bucket 的 endpoint+credentials)。

    使用範例:
        async with archive_s3_client() as s3:
            await s3.put_object(Bucket=..., Key=..., Body=..., ContentType=...)
    """
    session = aioboto3.Session()
    async with session.client(
        "s3",
        endpoint_url=settings.archive_s3_endpoint_url,
        aws_access_key_id=settings.archive_s3_access_key_id,
        aws_secret_access_key=settings.archive_s3_secret_access_key,
        region_name=settings.archive_s3_region,
    ) as s3:
        yield s3


async def put_archive_object(
    *,
    key: str,
    body: bytes,
    content_type: str = "application/x-ndjson",
) -> str:
    """把 archive 物件寫入 archive bucket,回傳 s3:// URI(供 audit log 記錄)。

    呼叫前 caller 應先檢查 `is_archive_storage_configured()`;若設定缺則此函式
    會因為 endpoint_url=="" 直接 raise ValueError(由 aioboto3 抛)。
    """
    if not is_archive_storage_configured():
        raise RuntimeError(
            "archive object storage 未設定(archive_s3_* settings 缺項)— "
            "caller 應先用 is_archive_storage_configured() 守門"
        )

    async with archive_s3_client() as s3:
        await s3.put_object(
            Bucket=settings.archive_s3_bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
        )
    uri = f"s3://{settings.archive_s3_bucket}/{key}"
    logger.info(
        "archive_object_uploaded", key=key, bucket=settings.archive_s3_bucket, size=len(body)
    )
    return uri


async def stream_archive_object(key: str) -> AsyncIterator[bytes]:
    """ Batch B(A6):從 archive bucket 拉物件 stream — 給 export download
    endpoint 代理用。caller 走 FastAPI StreamingResponse 包裝即可。

    需要 access key 有 cets-archive bucket 的 GetObject 權限(見 docs/runbook/archive.md
    更新後的 policy)。
    """
    if not is_archive_storage_configured():
        raise RuntimeError("archive object storage 未設定")
    async with archive_s3_client() as s3:
        obj = await s3.get_object(Bucket=settings.archive_s3_bucket, Key=key)
        async for chunk in obj["Body"].iter_chunks():
            yield chunk


__all__ = [
    "archive_s3_client",
    "is_archive_storage_configured",
    "put_archive_object",
    "stream_archive_object",
]
