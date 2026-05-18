"""lottery-runner CronJob entrypoint — 設計 06 §9.4、07 §抽籤流程

K8s CronJob `concurrencyPolicy: Forbid` + `startingDeadlineSeconds: 30` 保證
單實例;`pg_try_advisory_lock`(session-bound,跨 transaction commit 仍持有)
作為跨副本互斥的第二道防線。

 改用兩 connection 模式:
  - **lock_session**:dedicated connection 持鎖,從 main 開頭到結尾不參與業務
    transaction;commit/rollback 不影響 lock(connection-bound)
  - **work_session**:獨立 connection 跑 service,內部 commit/rollback 不釋放
    lock_session 的鎖

流程:
  1. init DB engine
  2. 取 advisory_lock(session-level)在 lock_session;失敗 exit 2
  3. work_session 跑 list_sessions_for_lottery + 對每場 execute_lottery,
     exception 不中斷其他場(設計 §9.4)
  4. finally:advisory_unlock + close engines
"""

import asyncio
import sys

import structlog

from app.config import settings
from app.core.db import close_db_engines, get_rw_session_maker, init_db_engines
from app.core.logging import configure_logging, get_logger
from app.core.metrics import SCHEDULER_JOB_RUNS
from app.core.redis import close_redis, init_redis
from app.core.scheduler import (
    JOB_ID_LOTTERY_RUNNER,
    advisory_session_unlock,
    try_advisory_session_lock,
)
from app.modules.event.service import EventService
from app.modules.lottery.service import LotteryService
from app.modules.registration.service import RegistrationService

logger = get_logger(__name__)

_JOB_NAME = "lottery_runner"


async def run() -> int:
    """exit code:0=成功(含無事可做),1=部分場次失敗,2=取不到 lock"""
    configure_logging(settings.log_level)
    structlog.contextvars.bind_contextvars(component="lottery-runner")

    await init_db_engines(settings.database_url_rw, settings.database_url_ro)
    await init_redis(settings.redis_url)
    try:
        session_maker = get_rw_session_maker()

        # lock_session:專門持有 advisory lock,connection-bound,跨 commit 仍有效
        async with session_maker() as lock_session:
            locked = await try_advisory_session_lock(lock_session, JOB_ID_LOTTERY_RUNNER)
            if not locked:
                logger.info("lottery_runner_skip_other_holds_lock")
                SCHEDULER_JOB_RUNS.labels(job=_JOB_NAME, outcome="skipped").inc()
                return 2

            try:
                # work_session:獨立 connection 跑 service;內部 commit 不影響 lock_session
                async with session_maker() as work_session:
                    event_svc = EventService(work_session)
                    reg_svc = RegistrationService(work_session, event_svc)
                    lottery_svc = LotteryService(work_session, event_svc, reg_svc)

                    sessions = await event_svc.list_sessions_for_lottery()
                    logger.info("lottery_runner_sessions_pending", count=len(sessions))

                    failed = 0
                    executed = 0
                    for sess in sessions:
                        try:
                            await lottery_svc.execute_lottery(sess.id)
                            executed += 1
                        except Exception as exc:
                            failed += 1
                            logger.exception(
                                "lottery_runner_session_failed",
                                session_id=sess.id,
                                error_type=type(exc).__name__,
                            )

                    logger.info(
                        "lottery_runner_done",
                        processed=executed,
                        failed=failed,
                        pending=len(sessions),
                    )

                if failed == 0:
                    SCHEDULER_JOB_RUNS.labels(job=_JOB_NAME, outcome="success").inc()
                    return 0
                SCHEDULER_JOB_RUNS.labels(job=_JOB_NAME, outcome="error").inc()
                return 1
            finally:
                # 顯式 unlock(防 connection 留 idle 在 pool 仍持鎖)
                try:
                    await advisory_session_unlock(lock_session, JOB_ID_LOTTERY_RUNNER)
                    await lock_session.commit() # release transaction holding the SELECT
                except Exception:
                    logger.exception("advisory_session_unlock_failed")
    finally:
        await close_redis()
        await close_db_engines()


def main() -> None:
    sys.exit(asyncio.run(run()))


if __name__ == "__main__":
    main()
