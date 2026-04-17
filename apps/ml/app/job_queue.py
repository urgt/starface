"""In-memory async job queue for description generation.

Jobs are processed by N worker coroutines. State is broadcast to subscribers
(SSE streams) via per-listener asyncio queues.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Awaitable, Callable

log = logging.getLogger("starface.queue")


@dataclass
class Job:
    id: str
    celebrity_id: str
    name: str
    status: str = "queued"  # queued | running | done | error | cancelled
    error: str | None = None
    uz_preview: str | None = None
    sources: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None


ProcessFn = Callable[[Job], Awaitable[dict]]


class JobQueue:
    def __init__(self, concurrency: int = 2, max_history: int = 2000):
        self.concurrency = max(1, concurrency)
        self.max_history = max_history
        self._queue: asyncio.Queue[Job | None] = asyncio.Queue()
        self.jobs: dict[str, Job] = {}
        self._subscribers: set[asyncio.Queue[dict]] = set()
        self._workers: list[asyncio.Task] = []
        self._process: ProcessFn | None = None
        self._stopping = False

    def start(self, process: ProcessFn) -> None:
        if self._workers:
            return
        self._process = process
        for i in range(self.concurrency):
            self._workers.append(asyncio.create_task(self._worker(i)))
        log.info("job queue started with %d workers", self.concurrency)

    async def stop(self) -> None:
        self._stopping = True
        for _ in range(len(self._workers)):
            await self._queue.put(None)
        for w in self._workers:
            try:
                await asyncio.wait_for(w, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                w.cancel()
        self._workers.clear()

    async def enqueue(self, celebrity_id: str, name: str) -> Job:
        job = Job(id=str(uuid.uuid4()), celebrity_id=celebrity_id, name=name)
        self.jobs[job.id] = job
        self._trim_history()
        await self._queue.put(job)
        await self._broadcast({"event": "queued", "job": asdict(job)})
        return job

    def cancel_pending(self) -> int:
        cancelled = 0
        # Drain queued items without blocking a worker.
        while True:
            try:
                item = self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            if item is None:
                # sentinel — put back if queue not stopping
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
        queued = sum(1 for j in self.jobs.values() if j.status == "queued")
        running = sum(1 for j in self.jobs.values() if j.status == "running")
        done = sum(1 for j in self.jobs.values() if j.status == "done")
        error = sum(1 for j in self.jobs.values() if j.status == "error")
        cancelled = sum(1 for j in self.jobs.values() if j.status == "cancelled")

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
            "queued": queued,
            "running": running,
            "done": done,
            "error": error,
            "cancelled": cancelled,
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

    async def _worker(self, idx: int) -> None:
        assert self._process is not None
        log.info("worker %d started", idx)
        while True:
            job = await self._queue.get()
            if job is None:
                log.info("worker %d stopping", idx)
                return
            if job.status != "queued":
                # Cancelled before pickup.
                continue
            job.status = "running"
            job.started_at = time.time()
            await self._broadcast({"event": "started", "worker": idx, "job": asdict(job)})
            try:
                result = await self._process(job)
                job.uz_preview = (result.get("uz") or "")[:140]
                job.sources = list(result.get("sources", []))
                job.status = "done"
            except Exception as e:
                log.warning("job %s (%s) failed: %s", job.id, job.name, e)
                job.error = str(e)[:300]
                job.status = "error"
            job.finished_at = time.time()
            await self._broadcast({"event": "finished", "worker": idx, "job": asdict(job)})

    async def _broadcast(self, event: dict) -> None:
        dead: list[asyncio.Queue[dict]] = []
        for q in self._subscribers:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self._subscribers.discard(q)

    def _trim_history(self) -> None:
        if len(self.jobs) <= self.max_history:
            return
        completed = sorted(
            (j for j in self.jobs.values() if j.status in ("done", "error", "cancelled")),
            key=lambda j: j.finished_at or 0,
        )
        to_drop = len(self.jobs) - self.max_history // 2
        for j in completed[:to_drop]:
            self.jobs.pop(j.id, None)
