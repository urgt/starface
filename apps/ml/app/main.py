"""FastAPI entrypoint for the StarFace ML service."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shlex
import time
from contextlib import asynccontextmanager
from typing import Literal

import psycopg
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import enrich as enrich_mod
from . import generate_descriptions as gd
from .embed import (
    LowQualityError,
    MultipleFacesError,
    NoFaceError,
    embed_image,
    warmup,
)
from .enrich_queue import EnrichQueue
from .job_queue import Job, JobQueue

log = logging.getLogger("starface.ml")
logging.basicConfig(level=logging.INFO)


description_queue = JobQueue(concurrency=int(os.getenv("DESC_WORKERS", "2")))
enrich_queue = EnrichQueue(concurrency=int(os.getenv("ENRICH_WORKERS", "1")))


async def _process_description_job(job: Job) -> dict:
    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        raise RuntimeError("DATABASE_URL not set")

    def _run() -> dict:
        settings = gd.resolve_settings(database_url)
        with psycopg.connect(database_url) as conn:
            return gd.process_one(conn, job.celebrity_id, settings)

    return await asyncio.to_thread(_run)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    log.info("loading InsightFace buffalo_l ...")
    warmup()
    log.info("model loaded")
    description_queue.start(_process_description_job)
    enrich_queue.start()
    try:
        yield
    finally:
        await description_queue.stop()
        await enrich_queue.stop()


app = FastAPI(title="StarFace ML", version="0.1.0", lifespan=lifespan)


class EmbedRequest(BaseModel):
    image_base64: str = Field(..., description="JPEG/PNG data URL or raw base64")
    allow_multiple: bool = Field(False, description="Pick center-most face if multiple")


class EmbedResponse(BaseModel):
    embedding: list[float]
    bbox: list[float]
    det_score: float
    face_quality: str


@app.get("/ml/health")
def health():
    return {"status": "ok", "model": "buffalo_l"}


@app.post("/ml/embed", response_model=EmbedResponse)
def embed(req: EmbedRequest):
    try:
        result = embed_image(req.image_base64, allow_multiple=req.allow_multiple)
    except NoFaceError as e:
        raise HTTPException(status_code=422, detail={"code": "no_face", "message": str(e)})
    except MultipleFacesError as e:
        raise HTTPException(status_code=422, detail={"code": "multiple_faces", "message": str(e)})
    except LowQualityError as e:
        raise HTTPException(status_code=422, detail={"code": "low_quality", "message": str(e)})
    except Exception as e:
        log.exception("embed failure")
        raise HTTPException(status_code=500, detail={"code": "internal", "message": str(e)})

    return EmbedResponse(
        embedding=result.embedding,
        bbox=result.bbox,
        det_score=result.det_score,
        face_quality=result.face_quality,
    )


# ---------------------------------------------------------------------------
# Import pipeline (fetch_wikidata → enroll → generate_descriptions)

Category = Literal["uz", "cis", "world", "all"]


class ImportRequest(BaseModel):
    category: Category = "all"
    limit: int | None = None
    skip_fetch: bool = False
    skip_enroll: bool = False
    skip_generate: bool = False
    out_dir: str = "/data/seeds/wikidata"


def _sse(event: str, payload: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


async def _stream_subprocess(cmd: list[str], env: dict | None = None):
    full_env = os.environ.copy()
    if env:
        full_env.update(env)
    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        env=full_env,
    )
    assert process.stdout is not None
    while True:
        line = await process.stdout.readline()
        if not line:
            break
        yield line.decode("utf-8", errors="replace").rstrip()
    rc = await process.wait()
    yield f"__rc={rc}"


@app.post("/ml/import")
async def ml_import(req: ImportRequest):
    database_url = os.getenv("DATABASE_URL", "")
    manifest_path = f"{req.out_dir.rstrip('/')}/celebrities.csv"

    async def gen():
        yield _sse("start", {"category": req.category, "limit": req.limit})

        # Phase 1 — fetch
        if not req.skip_fetch:
            yield _sse("phase", {"name": "fetch", "title": "Wikidata → photos + metadata"})
            cmd = [
                "python", "-u", "-m", "app.fetch_wikidata",
                "--category", req.category,
                "--out-dir", req.out_dir,
            ]
            if req.limit:
                cmd += ["--limit", str(req.limit)]
            rc = 0
            async for line in _stream_subprocess(cmd):
                if line.startswith("__rc="):
                    rc = int(line[5:])
                    continue
                yield _sse("log", {"phase": "fetch", "line": line})
            yield _sse("phase_done", {"name": "fetch", "rc": rc})
            if rc != 0:
                yield _sse("done", {"ok": False, "phase": "fetch", "rc": rc})
                return

        # Phase 2 — enroll
        if not req.skip_enroll:
            yield _sse("phase", {"name": "enroll", "title": "Face detection + DB insert"})
            cmd = [
                "python", "-u", "-m", "app.enroll",
                "--manifest", manifest_path,
                "--database-url", database_url,
                "--data-dir", "/data",
            ]
            rc = 0
            async for line in _stream_subprocess(cmd):
                if line.startswith("__rc="):
                    rc = int(line[5:])
                    continue
                yield _sse("log", {"phase": "enroll", "line": line})
            yield _sse("phase_done", {"name": "enroll", "rc": rc})
            if rc != 0:
                yield _sse("done", {"ok": False, "phase": "enroll", "rc": rc})
                return

        # Phase 3 — enqueue descriptions (async, runs in background workers)
        if not req.skip_generate:
            yield _sse("phase", {"name": "generate", "title": "Enqueue → LM Studio (async queue)"})
            # Enqueue only rows missing UZ description so repeated imports are cheap.
            rows = _fetch_candidates(EnqueueRequest(all=True, only_empty=True))
            for cid, cname in rows:
                await description_queue.enqueue(cid, cname)
            yield _sse(
                "log",
                {
                    "phase": "generate",
                    "line": f"  enqueued {len(rows)} celebrities for description generation",
                },
            )
            yield _sse(
                "log",
                {
                    "phase": "generate",
                    "line": "  progress visible in /admin/settings → job queue panel",
                },
            )
            yield _sse("phase_done", {"name": "generate", "rc": 0, "enqueued": len(rows)})

        yield _sse("done", {"ok": True})

    return StreamingResponse(gen(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Description queue


class EnqueueRequest(BaseModel):
    ids: list[str] | None = None
    all: bool = False
    only_empty: bool = False


def _fetch_candidates(body: EnqueueRequest) -> list[tuple[str, str]]:
    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        raise RuntimeError("DATABASE_URL not set")

    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        if body.ids:
            placeholders = ",".join(["%s"] * len(body.ids))
            cur.execute(
                f"SELECT id::text, name FROM celebrities WHERE id::text IN ({placeholders}) ORDER BY created_at",
                tuple(body.ids),
            )
        else:
            if body.only_empty:
                where = (
                    "(description_uz IS NULL OR description_uz = '' "
                    "OR description_ru IS NULL OR description_ru = '' "
                    "OR description_en IS NULL OR description_en = '')"
                )
            else:
                where = "TRUE"
            cur.execute(
                f"SELECT id::text, name FROM celebrities WHERE {where} ORDER BY created_at"
            )
        return cur.fetchall()


@app.post("/ml/describe/enqueue")
async def describe_enqueue(body: EnqueueRequest):
    if not body.ids and not body.all:
        raise HTTPException(status_code=400, detail="ids or all=true required")
    rows = _fetch_candidates(body)
    for cid, name in rows:
        await description_queue.enqueue(cid, name)
    return {"enqueued": len(rows)}


@app.get("/ml/describe/status")
async def describe_status():
    return description_queue.snapshot()


@app.post("/ml/describe/cancel")
async def describe_cancel():
    cancelled = description_queue.cancel_pending()
    return {"cancelled": cancelled}


@app.get("/ml/describe/events")
async def describe_events():
    q = description_queue.subscribe()

    async def stream():
        try:
            yield _sse("snapshot", description_queue.snapshot())
            while True:
                try:
                    evt = await asyncio.wait_for(q.get(), timeout=25)
                except asyncio.TimeoutError:
                    yield _sse("ping", {"ts": time.time()})
                    continue
                yield _sse(evt.get("event", "event"), evt)
        except asyncio.CancelledError:
            raise
        finally:
            description_queue.unsubscribe(q)

    return StreamingResponse(stream(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Photo enrichment queue (Playwright-based image scraper + InsightFace scoring)


class EnrichEnqueueRequest(BaseModel):
    ids: list[str] | None = None
    all: bool = False
    only_missing: bool = False
    target_count: int = Field(8, ge=1, le=30)


def _fetch_enrich_candidates(body: EnrichEnqueueRequest) -> list[tuple[str, str]]:
    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        raise RuntimeError("DATABASE_URL not set")

    with psycopg.connect(database_url) as conn:
        if body.ids:
            placeholders = ",".join(["%s"] * len(body.ids))
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT id::text, name FROM celebrities WHERE id::text IN ({placeholders}) ORDER BY created_at",
                    tuple(body.ids),
                )
                return cur.fetchall()
        if body.only_missing:
            return enrich_mod.select_missing_celebrities(conn, body.target_count)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id::text, name FROM celebrities WHERE COALESCE(active, true) ORDER BY created_at"
            )
            return cur.fetchall()


@app.post("/ml/enrich/enqueue")
async def enrich_enqueue(body: EnrichEnqueueRequest):
    if not body.ids and not body.all and not body.only_missing:
        raise HTTPException(status_code=400, detail="ids, all=true, or only_missing=true required")
    rows = _fetch_enrich_candidates(body)
    for cid, name in rows:
        await enrich_queue.enqueue(cid, name or "", target_count=body.target_count)
    return {"enqueued": len(rows)}


@app.get("/ml/enrich/status")
async def enrich_status():
    return enrich_queue.snapshot()


@app.post("/ml/enrich/cancel")
async def enrich_cancel():
    cancelled = enrich_queue.cancel_pending()
    return {"cancelled": cancelled}


@app.get("/ml/enrich/events")
async def enrich_events():
    q = enrich_queue.subscribe()

    async def stream():
        try:
            yield _sse("snapshot", enrich_queue.snapshot())
            while True:
                try:
                    evt = await asyncio.wait_for(q.get(), timeout=25)
                except asyncio.TimeoutError:
                    yield _sse("ping", {"ts": time.time()})
                    continue
                yield _sse(evt.get("event", "event"), evt)
        except asyncio.CancelledError:
            raise
        finally:
            enrich_queue.unsubscribe(q)

    return StreamingResponse(stream(), media_type="text/event-stream")


# unused-import guard
_ = shlex
