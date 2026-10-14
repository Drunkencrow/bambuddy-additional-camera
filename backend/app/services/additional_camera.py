"""Viewer-owned additional-camera sessions; never publish primary-camera state."""

import asyncio
import time
import uuid
from dataclasses import dataclass

import anyio

from backend.app.services import external_camera


@dataclass
class Session:
    printer_id: int
    process: asyncio.subprocess.Process | None = None
    last_frame_time: float | None = None


_sessions: dict[str, Session] = {}


def active_process_ids() -> set[int]:
    """Protect live USB/RTSP sessions from the primary orphan process scanner."""
    return {s.process.pid for s in _sessions.values() if s.process is not None and s.process.returncode is None}


def status(printer_id: int) -> dict:
    sessions = [s for s in _sessions.values() if s.printer_id == printer_id]
    times = [s.last_frame_time for s in sessions if s.last_frame_time is not None]
    age = time.monotonic() - max(times) if times else None
    return {
        "active_sessions": len(sessions),
        "frames_recent": age is not None and age < 30,
        "last_frame_age_seconds": age,
    }


async def stream(printer_id: int, url: str, camera_type: str, fps: int, rotation: int):
    """One transport per HTTP viewer. Closing a viewer closes only its session."""
    session_id = f"additional-camera:{printer_id}:{uuid.uuid4().hex}"
    session = Session(printer_id)
    stop_event = asyncio.Event()

    def on_process(process):
        session.process = process

    def on_frame(frame):
        session.last_frame_time = time.monotonic()

    transport = external_camera.generate_mjpeg_stream(
        url,
        camera_type,
        fps,
        on_process=on_process,
        on_frame=on_frame,
        stop_event=stop_event,
        rotation=rotation,
    )
    _sessions[session_id] = session
    try:
        async for chunk in transport:
            yield chunk
    finally:
        stop_event.set()
        # Starlette disconnect cancellation must not interrupt process cleanup.
        with anyio.CancelScope(shield=True):
            try:
                await transport.aclose()
            finally:
                try:
                    # A transport may swallow cancellation before its process wait
                    # completes. Drain/reap this request's last process under the
                    # disconnect shield; never touch a primary process registry.
                    process = session.process
                    if process is not None:
                        if process.returncode is None:
                            process.terminate()
                        try:
                            await asyncio.wait_for(process.communicate(), timeout=2)
                        except TimeoutError:
                            if process.returncode is None:
                                process.kill()
                            await asyncio.wait_for(process.communicate(), timeout=2)
                finally:
                    _sessions.pop(session_id, None)
