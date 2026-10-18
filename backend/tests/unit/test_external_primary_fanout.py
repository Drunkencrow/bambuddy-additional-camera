"""Primary route ownership across built-in and General external sources."""

import asyncio
import time
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from backend.app.api.routes import camera
from backend.app.services import additional_camera, camera_fanout, external_camera

pytestmark = pytest.mark.asyncio
PRINTER_ID = 8461
JPEG = b"\xff\xd8primary\xff\xd9"
CHUNK = b"--frame\r\n\r\n" + JPEG


class Process:
    pid = 98461
    returncode = None
    stdout = None
    stderr = None

    def terminate(self):
        self.returncode = 0

    def kill(self):
        self.returncode = -9

    async def wait(self):
        return self.returncode


@pytest.fixture
async def source(monkeypatch):
    await camera_fanout.shutdown_all_broadcasters()
    for name in (
        "_active_streams",
        "_active_chamber_streams",
        "_disconnect_events",
        "_spawned_ffmpeg_pids",
        "_stream_last_frame_times",
        "_last_frames",
        "_last_frame_times",
        "_stream_start_times",
    ):
        monkeypatch.setattr(camera, name, {})
    monkeypatch.setattr(camera, "_active_external_streams", set())
    monkeypatch.setattr(camera_fanout, "_GRACE_SECONDS", 0.02)
    state = SimpleNamespace(
        opens=0,
        closes=0,
        responses=[],
        processes=[],
        events=[],
        terminate_on_close=True,
        ticks=asyncio.Queue(),
        printer=SimpleNamespace(
            external_camera_enabled=True,
            external_camera_url="mock-source",
            external_camera_type="rtsp",
            external_camera_snapshot_url=None,
            model="X1C",
            ip_address="unused",
            access_code="unused",
            camera_rotation=90,
        ),
    )

    @asynccontextmanager
    async def session():
        yield None

    monkeypatch.setattr(camera.database, "async_session", session)
    monkeypatch.setattr(camera, "get_printer_or_404", AsyncMock(return_value=state.printer))

    async def external(url, kind, fps, *, on_process, on_frame, stop_event):
        assert url == "mock-source"
        assert kind == state.printer.external_camera_type
        assert fps == 15
        state.opens += 1
        state.events.append(stop_event)
        proc = None
        if kind in ("rtsp", "usb"):
            proc = Process()
            state.processes.append(proc)
            on_process(proc)
        try:
            while True:
                on_frame(JPEG)
                yield CHUNK
                await state.ticks.get()
        finally:
            state.closes += 1
            if proc and state.terminate_on_close:
                proc.terminate()

    async def builtin(**kwargs):
        state.opens += 1
        try:
            while True:
                yield CHUNK
                await state.ticks.get()
        finally:
            state.closes += 1

    monkeypatch.setattr(external_camera, "generate_mjpeg_stream", external)
    monkeypatch.setattr(camera, "generate_rtsp_mjpeg_stream", builtin)
    monkeypatch.setattr(camera, "generate_chamber_mjpeg_stream", builtin)

    async def open_viewer(disconnected=None):
        response = await camera.camera_stream(
            PRINTER_ID,
            SimpleNamespace(is_disconnected=disconnected or AsyncMock(return_value=False)),
            fps=30,
            _=None,
        )
        state.responses.append(response)
        assert await asyncio.wait_for(anext(response.body_iterator), 1) == CHUNK
        return response

    state.open = open_viewer
    yield state
    for response in state.responses:
        await response.body_iterator.aclose()
    await camera_fanout.shutdown_all_broadcasters()


@pytest.mark.parametrize("kind", ["builtin-rtsp", "builtin-chamber", "rtsp", "mjpeg", "snapshot", "usb"])
async def test_two_primary_viewers_share_upstream_and_survive_peer_stop(source, kind):
    if kind.startswith("builtin"):
        source.printer.external_camera_enabled = False
        source.printer.model = "A1" if kind == "builtin-chamber" else "X1C"
    else:
        source.printer.external_camera_type = kind
    first = await source.open()
    started = camera._stream_start_times[PRINTER_ID]
    second = await source.open()
    assert source.opens == 1, "multiple Primary viewers must share one source/device reader"
    assert camera._stream_start_times[PRINTER_ID] == started
    assert camera_fanout.get_subscriber_count(f"printer-{PRINTER_ID}") == 2
    await first.body_iterator.aclose()
    result = await camera.stop_camera_stream(PRINTER_ID, _=None)
    assert result == {"stopped": 0, "skipped": True}
    assert camera_fanout.get_subscriber_count(f"printer-{PRINTER_ID}") == 1
    assert source.closes == 0
    source.ticks.put_nowait(None)
    assert await asyncio.wait_for(anext(second.body_iterator), 1) == CHUNK
    reopened = await source.open()
    assert source.opens == 1
    await second.body_iterator.aclose()
    assert (await camera.stop_camera_stream(PRINTER_ID, _=None))["skipped"]
    source.ticks.put_nowait(None)
    assert await asyncio.wait_for(anext(reopened.body_iterator), 1) == CHUNK
    await reopened.body_iterator.aclose()
    for _ in range(100):
        if source.closes:
            break
        await asyncio.sleep(0.005)
    assert source.closes == 1
    assert all(proc.returncode is not None for proc in source.processes)
    assert not camera._active_streams
    assert not camera._disconnect_events
    assert not camera._spawned_ffmpeg_pids
    assert PRINTER_ID not in camera._active_external_streams
    if not kind.startswith("builtin"):
        assert PRINTER_ID not in camera._last_frames
        assert PRINTER_ID not in camera._stream_start_times
        assert source.events[0].is_set()


@pytest.mark.parametrize("kind", ["rtsp", "mjpeg", "snapshot", "usb"])
async def test_external_primary_publishes_status_and_capture_frame_until_final_shutdown(source, kind):
    source.printer.external_camera_type = kind
    first = await source.open()
    await source.open()
    assert camera.live_frame_for_capture(PRINTER_ID) == (True, JPEG)
    assert camera.try_get_active_buffered_frame(PRINTER_ID) == JPEG
    status = await camera.camera_status(PRINTER_ID, _=None)
    assert status["active"] and status["has_frames"] and not status["stalled"]
    await first.body_iterator.aclose()
    assert camera.live_frame_for_capture(PRINTER_ID) == (True, JPEG)
    # Application shutdown uses this same entry point.
    await camera_fanout.shutdown_all_broadcasters()
    assert source.closes == 1
    assert camera.live_frame_for_capture(PRINTER_ID) == (False, None)
    assert not (await camera.camera_status(PRINTER_ID, _=None))["active"]
    assert not camera._active_streams
    assert not camera._spawned_ffmpeg_pids


async def test_external_primary_reopens_after_final_cleanup(source):
    first = await source.open()
    await first.body_iterator.aclose()
    await camera.stop_camera_stream(PRINTER_ID, _=None)
    await source.open()
    assert source.opens == 2
    assert source.closes == 1
    assert source.processes[-1].returncode is None


async def test_stop_with_two_external_primary_viewers_does_not_terminate_process(source):
    await source.open()
    await source.open()
    result = await camera.stop_camera_stream(PRINTER_ID, _=None)
    assert all(proc.returncode is None for proc in source.processes)
    assert result == {"stopped": 0, "skipped": True}


async def test_abrupt_disconnect_unsubscribes_without_stopping_survivor(source):
    disconnected = AsyncMock(return_value=False)
    first = await source.open(disconnected)
    second = await source.open()
    disconnected.return_value = True
    with pytest.raises(StopAsyncIteration):
        await anext(first.body_iterator)
    assert camera_fanout.get_subscriber_count(f"printer-{PRINTER_ID}") == 1
    assert (await camera.stop_camera_stream(PRINTER_ID, _=None))["skipped"]
    source.ticks.put_nowait(None)
    assert await asyncio.wait_for(anext(second.body_iterator), 1) == CHUNK


async def test_rejoin_during_grace_reuses_external_upstream(source):
    first = await source.open()
    await first.body_iterator.aclose()
    await source.open()
    await asyncio.sleep(0.04)
    assert source.opens == 1
    assert source.closes == 0


async def test_shutdown_reaps_process_left_alive_by_transport(source):
    source.terminate_on_close = False
    await source.open()
    await camera_fanout.shutdown_all_broadcasters()
    assert source.processes[0].returncode == 0
    assert not camera._spawned_ffmpeg_pids
    assert not camera._active_streams


async def test_primary_status_stall_and_recovery_use_shared_frame_timing(source):
    await source.open()
    camera._stream_start_times[PRINTER_ID] = time.time() - 30
    camera._last_frame_times[PRINTER_ID] = time.time() - 20
    assert (await camera.camera_status(PRINTER_ID, _=None))["stalled"]
    source.ticks.put_nowait(None)
    for _ in range(100):
        if time.time() - camera._last_frame_times[PRINTER_ID] < 1:
            break
        await asyncio.sleep(0.005)
    assert not (await camera.camera_status(PRINTER_ID, _=None))["stalled"]


async def test_primary_snapshot_keeps_existing_external_capture_selection(source, monkeypatch):
    capture = AsyncMock(return_value=JPEG)
    monkeypatch.setattr(external_camera, "capture_frame", capture)
    response = await camera.camera_snapshot(PRINTER_ID, _=None)
    assert response.body == JPEG
    capture.assert_awaited_once_with("mock-source", "rtsp", timeout=15, snapshot_url=None)


async def test_orphan_cleanup_protects_shared_primary_and_additional_but_reaps_orphan(source, monkeypatch):
    import os
    import signal

    extra_proc = Process()
    extra_proc.pid = 98462
    session = additional_camera.Session(PRINTER_ID, process=extra_proc, last_frame_time=time.monotonic())
    sessions = {"additional-camera:independent": session}
    monkeypatch.setattr(additional_camera, "_sessions", sessions)
    await source.open()
    await source.open()
    primary = source.processes[0]
    orphan_pid = 98463
    monkeypatch.setattr(camera, "_scan_bambu_ffmpeg_pids", lambda: [primary.pid, extra_proc.pid, orphan_pid])
    kills = []
    monkeypatch.setattr(os, "kill", lambda pid, sig: kills.append((pid, sig)))
    await camera.cleanup_orphaned_streams()
    assert [pid for pid, sig in kills if sig == signal.SIGKILL] == [orphan_pid]
    assert primary.returncode is None
    assert extra_proc.returncode is None
    assert len(camera._active_streams) == 1
    assert camera.get_buffered_frame(PRINTER_ID) == JPEG
    await camera_fanout.shutdown_all_broadcasters()
    assert primary.returncode == 0
    assert extra_proc.returncode is None
    assert additional_camera._sessions == sessions


@pytest.mark.parametrize("kind", ["builtin-chamber", "rtsp"])
@pytest.mark.parametrize("leaving", ["stock", "both"])
@pytest.mark.parametrize("stop_before_disconnect", [False, True])
async def test_stock_and_both_close_orders_preserve_primary_subscription(source, kind, leaving, stop_before_disconnect):
    """Both owns one normal Primary subscription, even when stop races disconnect."""
    if kind == "builtin-chamber":
        source.printer.external_camera_enabled = False
        source.printer.model = "P1S"
    stock = await source.open()
    both = await source.open()
    closing, survivor = (stock, both) if leaving == "stock" else (both, stock)
    if stop_before_disconnect:
        assert (await camera.stop_camera_stream(PRINTER_ID, _=None))["skipped"]
    await closing.body_iterator.aclose()
    if not stop_before_disconnect:
        assert (await camera.stop_camera_stream(PRINTER_ID, _=None))["skipped"]
    assert camera_fanout.get_subscriber_count(f"printer-{PRINTER_ID}") == 1
    # Cross the real fixture grace period: a leaving subscriber must never
    # schedule upstream teardown while its peer remains subscribed.
    await asyncio.sleep(0.04)
    assert source.opens == 1
    assert source.closes == 0
    source.ticks.put_nowait(None)
    assert await asyncio.wait_for(anext(survivor.body_iterator), 1) == CHUNK
    # The mocked built-in generator only emits chunks; external's real route
    # wrapper additionally publishes status/frame timing in this fixture.
    if kind == "rtsp":
        status = await camera.camera_status(PRINTER_ID, _=None)
        assert status["active"] and not status["stalled"]
    await source.open()
    assert source.opens == 1
    assert camera_fanout.get_subscriber_count(f"printer-{PRINTER_ID}") == 2
