"""Task store and the single GPU worker. Tasks run one at a time, in order.

Each task is a folder under GEN_DATA_DIR/tasks/<id> holding meta.json, the input image (if any),
and the output files. Finished tasks survive a restart; tasks that were queued or running when
the process stopped come back as FAILED with a clear reason, so the caller can retry.
"""
from __future__ import annotations

import io
import json
import queue
import secrets
import shutil
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from PIL import Image

from .engines import Engine, TaskCanceled
from .postprocess import export_all, prepare

FINAL = ("SUCCEEDED", "FAILED", "CANCELED")
MAX_FACES = {"draft": 150_000, "high": 400_000}


@dataclass
class Task:
    id: str
    kind: str  # text | image
    quality: str  # draft | high
    seed: int
    size_mm: float
    prompt: str | None = None
    remove_background: bool = True
    parent_id: str | None = None
    idempotency_key: str | None = None
    status: str = "QUEUED"
    progress: int = 0
    error: dict | None = None
    stats: dict | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None


class TaskStore:
    def __init__(self, root: Path, engine: Engine, *, keep_days: float = 7) -> None:
        self.root = root / "tasks"
        self.root.mkdir(parents=True, exist_ok=True)
        self.engine = engine
        self.keep_s = keep_days * 86400
        self.tasks: dict[str, Task] = {}
        self.by_key: dict[str, str] = {}
        self.cancel: set[str] = set()
        self.lock = threading.Lock()
        self.q: queue.Queue[str] = queue.Queue()
        self._load()
        self.thread = threading.Thread(target=self._loop, name="gen-worker", daemon=True)
        self.thread.start()

    # --- persistence ---
    def dir(self, task_id: str) -> Path:
        return self.root / task_id

    def _save(self, t: Task) -> None:
        d = self.dir(t.id)
        d.mkdir(exist_ok=True)
        tmp = d / "meta.json.tmp"
        tmp.write_text(json.dumps(asdict(t)))
        tmp.replace(d / "meta.json")

    def _load(self) -> None:
        for meta in self.root.glob("*/meta.json"):
            try:
                t = Task(**json.loads(meta.read_text()))
            except (ValueError, TypeError):
                continue
            if t.status not in FINAL:
                t.status, t.error, t.finished_at = "FAILED", {"code": "SERVER_RESTARTED", "message": "The generation server restarted before this task finished."}, time.time()
                self._save(t)
            self.tasks[t.id] = t
            if t.idempotency_key:
                self.by_key[t.idempotency_key] = t.id

    def prune(self) -> int:
        cutoff = time.time() - self.keep_s
        gone = 0
        with self.lock:
            for t in list(self.tasks.values()):
                if t.status in FINAL and (t.finished_at or t.created_at) < cutoff:
                    shutil.rmtree(self.dir(t.id), ignore_errors=True)
                    self.tasks.pop(t.id, None)
                    if t.idempotency_key:
                        self.by_key.pop(t.idempotency_key, None)
                    gone += 1
        return gone

    # --- API ---
    def create(self, t: Task, image: bytes | None) -> tuple[Task, bool]:
        """Returns (task, created). A repeated idempotency key returns the first task."""
        with self.lock:
            if t.idempotency_key and t.idempotency_key in self.by_key:
                return self.tasks[self.by_key[t.idempotency_key]], False
            t.id = "gt_" + secrets.token_hex(12)
            self.dir(t.id).mkdir()
            if image is not None:
                (self.dir(t.id) / "input.png").write_bytes(image)
            self.tasks[t.id] = t
            if t.idempotency_key:
                self.by_key[t.idempotency_key] = t.id
            self._save(t)
        self.q.put(t.id)
        return t, True

    def get(self, task_id: str) -> Task | None:
        return self.tasks.get(task_id)

    def request_cancel(self, task_id: str) -> Task | None:
        with self.lock:
            t = self.tasks.get(task_id)
            if not t:
                return None
            if t.status == "QUEUED":
                t.status, t.finished_at = "CANCELED", time.time()
                self._save(t)
            elif t.status == "RUNNING":
                self.cancel.add(task_id)
            return t

    def queue_position(self, task_id: str) -> int:
        queued = sorted((t for t in self.tasks.values() if t.status == "QUEUED"), key=lambda t: t.created_at)
        return next((i for i, t in enumerate(queued) if t.id == task_id), -1)

    # --- worker ---
    def _loop(self) -> None:
        while True:
            try:
                task_id = self.q.get(timeout=600)
            except queue.Empty:
                self.prune()
                continue
            t = self.tasks.get(task_id)
            if not t or t.status != "QUEUED":
                continue
            self._run(t)

    def _set(self, t: Task, **kw) -> None:
        with self.lock:
            for k, v in kw.items():
                setattr(t, k, v)
            self._save(t)

    def _run(self, t: Task) -> None:
        self._set(t, status="RUNNING", progress=5)

        def progress(p: int) -> None:
            if p > t.progress:
                self._set(t, progress=min(95, p))

        def canceled() -> bool:
            return t.id in self.cancel

        try:
            if t.kind == "text":
                raw = self.engine.text(t.prompt or "", seed=t.seed, quality=t.quality, progress=progress, canceled=canceled)
            else:
                img = Image.open(io.BytesIO((self.dir(t.id) / "input.png").read_bytes())).convert("RGBA")
                raw = self.engine.image(img, seed=t.seed, quality=t.quality, remove_background=t.remove_background, progress=progress, canceled=canceled)
            if canceled():
                raise TaskCanceled()
            prepared = prepare(raw, size_mm=t.size_mm, max_faces=MAX_FACES[t.quality])
            for fmt, data in export_all(prepared.mesh).items():
                (self.dir(t.id) / f"model.{fmt}").write_bytes(data)
            self._set(t, status="SUCCEEDED", progress=100, stats=prepared.stats, finished_at=time.time())
        except TaskCanceled:
            self._set(t, status="CANCELED", finished_at=time.time())
        except Exception as e:  # noqa: BLE001 - every engine failure ends the task, never the worker
            self._set(t, status="FAILED", error={"code": "GENERATION_FAILED", "message": str(e)[:500] or type(e).__name__}, finished_at=time.time())
        finally:
            self.cancel.discard(t.id)
