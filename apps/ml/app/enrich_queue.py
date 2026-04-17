"""Async job queue for the photo-enrichment agent.

Mirrors the shape of job_queue.py (descriptions) but with a per-job `progress`
dict that is broadcast throttled (~1/s) so the admin UI can render a live
progress bar. Jobs run in a worker thread because both Playwright (sync API)
and psycopg are blocking.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path

import psycopg

from . import enrich as enrich_mod

log = logging.getLogger("starface.enrich_queue")


def _empty_progress() -> dict:
    return {"searched": 0, "downloaded": 0, "scored": 0, "added": 0, "skipped": 0}


@dataclass
class EnrichJob:
    id: str
    celebrity_id: str
    name: str
    target_count: int = 8
    status: str = "queued"  # queued | running | done | error | cancelled
    error: str | None = None
    progress: dict = field(default_factory=_empty_progress)
    added_paths: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None


class EnrichQueue:
    def __init__(self, concurrency: int = 1, max_history: int = 1000):
        self.concurrency = max(1, concurrency)
        self.max_history = max_history
        self._queue: asyncio.Queue[EnrichJob | None] = asyncio.Queue()
        self.jobs: dict[str, EnrichJob] = {}
        self._subscribers: set[asyncio.Queue[dict]] = set()
        self._workers: list[asyncio.Task] = []
        self._stopping = False
        self._loop: asyncio.AbstractEventLoop | None = None

    # --- lifecycle ---

    def start(self) -> None:
        if self._workers:
            return
        self._loop = asyncio.get_running_loop()
        for i in range(self.concurrency):
            self._workers.append(asyncio.create_task(self._worker(i)))
        log.info("enrich queue started with %d worker(s)", self.concurrency)

    async def stop(self) -> None:
        self._stopping = True
        for _ in range(len(self._workers)):
            await self._queue.put(None)
        for w in self._workers:
            try:
                await asyncio.wait_for(w, timeout=10)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                w.cancel()
        self._workers.clear()

    # --- public API ---

    async def enqueue(self, celebrity_id: str, name: str, target_count: int = 8) -> EnrichJob:
        job = EnrichJob(
            id=str(uuid.uuid4()),
            celebrity_id=celebrity_id,
            name=name,
            target_count=target_count,
        )
        self.jobs[job.id] = job
        self._trim_history()
        await self._queue.put(job)
        await self._broadcast({"event": "queued", "job": asdict(job)})
        return job

    def cancel_pending(self) -> int:
        cancelled = 0
        while True:
            try:
                item = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            if item is None:
                if not self._stopping:
                    self._queue.put_nowait(item)
                continue
            if item.status == "queued":
                item.status = "cancelled"
                item.finished_at = time.time()
                cancelled += 1
                asyncio.create_task(
                    self._broadcast({"event": "finished", "job": asdict(item)})
                )
        return cancelled

    def snapshot(self) -> dict:
        by = lambda s: sum(1 for j in self.jobs.values() if j.status == s)  # noqa: E731
        active = [
            asdict(j) for j in self.jobs.values() if j.status in ("queued", "running")
        ]
        active.sort(key=lambda j: j["created_at"])
        recent = sorted(
            (j for j in self.jobs.values() if j.status in ("done", "error", "cancelled")),
            key=lambda j: j.finished_at or 0,
            reverse=True,
        )[:100]
        return {
            "queued": by("queued"),
            "running": by("running"),
            "done": by("done"),
            "error": by("error"),
            "cancelled": by("cancelled"),
            "workers": self.concurrency,
            "active": active,
            "recent": [asdict(j) for j in recent],
        }

    def subscribe(self) -> asyncio.Queue[dict]:
        q: asyncio.Queue[dict] = asyncio.Queue(maxsize=4000)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict]) -> None:
        self._subscribers.discard(q)

    # --- worker ---

    async def _worker(self, idx: int) -> None:
        database_url = os.getenv("DATABASE_URL", "")
        data_dir = Path(os.getenv("DATA_DIR", "/data"))
        if not database_url:
            log.error("DATABASE_URL not set — enrich worker %d cannot run", idx)
            return

        log.info("enrich worker %d started", idx)
        while True:
            job = await self._queue.get()
            if job is None:
                log.info("enrich worker %d stopping", idx)
                return
            if job.status != "queued":
                continue
            job.status = "running"
            job.started_at = time.time()
            await self._broadcast({"event": "started", "worker": idx, "job": asdict(job)})
            try:
                await asyncio.to_thread(self._run_one, job, database_url, data_dir)
                if not job.error:
                    job.status = "done"
                else:
                    job.status = "error"
            except Exception as e:
                log.exception("enrich job %s (%s) failed", job.id, job.name)
                job.error = str(e)[:300]
                job.status = "error"
            job.finished_at = time.time()
            await self._broadcast({"event": "finished", "worker": idx, "job": asdict(job)})

    def _run_one(self, job: EnrichJob, database_url: str, data_dir: Path) -> None:
        """Blocking pipeline: Playwright + psycopg. Called via asyncio.to_thread."""
        from playwright.sync_api import sync_playwright

        last_ts = [0.0]

        def on_progress(p) -> None:
            job.progress = {
                "searched": p.searched,
                "downloaded": p.downloaded,
                "scored": p.scored,
                "added": p.added,
                "skipped": p.skipped,
            }
            now = time.time()
            if now - last_ts[0] < 1.0:
                return
            last_ts[0] = now
            self._broadcast_threadsafe({"event": "progress", "job": asdict(job)})

        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            try:
                with psycopg.connect(database_url) as conn:
                    res = enrich_mod.enrich_one(
                        conn,
                        job.celebrity_id,
                        target_count=job.target_count,
                        data_dir=data_dir,
                        browser=browser,
                        on_progress=on_progress,
                    )
            finally:
                try:
                    browser.close()
                except Exception:
                    pass

        job.progress = {
            "searched": res.progress.searched,
            "downloaded": res.progress.downloaded,
            "scored": res.progress.scored,
            "added": res.progress.added,
            "skipped": res.progress.skipped,
        }
        job.added_paths = list(res.added_paths)
        if res.error:
            job.error = res.error

    # --- broadcast ---

    async def _broadcast(self, event: dict) -> None:
        dead: list[asyncio.Queue[dict]] = []
        for q in self._subscribers:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self._subscribers.discard(q)

    def _broadcast_threadsafe(self, event: dict) -> None:
        loop = self._loop
        if loop is None:
            return
        loop.call_soon_threadsafe(lambda: asyncio.create_task(self._broadcast(event)))

    def _trim_history(self) -> None:
        if len(self.jobs) <= self.max_history:
            return
        completed = sorted(
            (j for j in self.jobs.values() if j.status in ("done", "error", "cancelled")),
            key=lambda j: j.finished_at or 0,
        )
        drop_n = len(self.jobs) - self.max_history // 2
        for j in completed[:drop_n]:
            self.jobs.pop(j.id, None)
