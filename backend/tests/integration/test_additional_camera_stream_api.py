"""Additional media routes, transport arguments, authorization and isolation."""

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import anyio
import pytest

from backend.app.api.routes import camera as primary
from backend.app.models.additional_camera import AdditionalCamera
from backend.app.services import additional_camera
from backend.tests.integration.test_additional_cameras_api import PAYLOAD, path


async def save(async_client, printer_factory, **changes):
    printer = await printer_factory(camera_rotation=180)
    response = await async_client.put(path(printer.id), json={**PAYLOAD, **changes})
    assert response.status_code == 200
    return printer


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["stream", "snapshot"])
async def test_missing_disabled_and_nonexistent(async_client, printer_factory, endpoint):
    assert (await async_client.get(path(999999) + "/" + endpoint)).status_code == 404
    printer = await printer_factory()
    assert (await async_client.get(path(printer.id) + "/" + endpoint)).status_code == 404
    await async_client.put(path(printer.id), json={**PAYLOAD, "enabled": False})
    assert (await async_client.get(path(printer.id) + "/" + endpoint)).status_code == 409


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "changes",
    [
        {"camera_url": ""},
        {"camera_url": "http://127.0.0.1/video"},
        {"snapshot_url": "file:///etc/passwd"},
        {"camera_type": "usb", "camera_url": "/dev/not-a-camera"},
    ],
)
async def test_invalid_persisted_configuration(async_client, printer_factory, db_session, changes):
    printer = await printer_factory()
    db_session.add(AdditionalCamera(printer_id=printer.id, **{**PAYLOAD, **changes}))
    await db_session.commit()
    assert (await async_client.get(path(printer.id) + "/stream")).status_code == 422
    assert (await async_client.get(path(printer.id) + "/snapshot")).status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "camera_type,url",
    [
        ("rtsp", "rtsp://camera.local/live"),
        ("mjpeg", "http://camera.local/video"),
        ("snapshot", "http://camera.local/frame"),
        ("usb", "/dev/video0"),
    ],
)
async def test_stream_transport_and_primary_isolation(async_client, printer_factory, camera_type, url):
    printer = await save(async_client, printer_factory, camera_type=camera_type, camera_url=url)
    registries = [
        "_last_frames",
        "_last_frame_times",
        "_stream_start_times",
        "_active_external_streams",
        "_active_streams",
        "_active_chamber_streams",
        "_disconnect_events",
        "_spawned_ffmpeg_pids",
    ]
    before = {name: getattr(primary, name).copy() for name in registries}
    process = MagicMock(pid=999999, returncode=None)
    process.communicate = AsyncMock(return_value=(b"", b""))
    closed = []

    async def transport(*args, **kwargs):
        assert args == (url, camera_type, 7)
        assert kwargs["rotation"] == 90  # Printer rotation remains 180.
        kwargs["on_process"](process)
        kwargs["on_frame"](b"jpeg")
        try:
            assert additional_camera.active_process_ids() == {process.pid}
            assert additional_camera.status(printer.id)["frames_recent"]
            assert not primary.is_stream_active(printer.id)
            assert primary.try_get_active_buffered_frame(printer.id) is None
            yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\njpeg\r\n"
        finally:
            closed.append(True)

    with (
        patch("backend.app.services.external_camera.generate_mjpeg_stream", transport),
        patch("backend.app.services.external_camera._safe_usb_device_path", return_value="/dev/video0"),
    ):
        response = await async_client.get(path(printer.id) + "/stream?fps=7")
    assert response.status_code == 200
    assert response.headers["content-type"] == "multipart/x-mixed-replace; boundary=frame"
    assert b"jpeg" in response.content
    assert closed == [True]
    assert additional_camera.status(printer.id)["active_sessions"] == 0
    assert not additional_camera.active_process_ids()
    assert before == {name: getattr(primary, name).copy() for name in registries}


@pytest.mark.asyncio
async def test_snapshot_uses_additional_source_and_override(async_client, printer_factory):
    printer = await save(async_client, printer_factory)
    with (
        patch("backend.app.services.external_camera.capture_frame", AsyncMock(return_value=b"jpeg")) as capture,
        patch("backend.app.api.routes.additional_cameras.apply_camera_rotation", return_value=b"rotated") as rotate,
    ):
        response = await async_client.get(path(printer.id) + "/snapshot")
    assert response.status_code == 200
    assert response.content == b"rotated"
    assert response.headers["content-type"] == "image/jpeg"
    capture.assert_awaited_once_with(PAYLOAD["camera_url"], "mjpeg", snapshot_url=PAYLOAD["snapshot_url"])
    assert rotate.call_args.args[1] == 90
    with patch("backend.app.services.external_camera.capture_frame", AsyncMock(return_value=None)):
        assert (await async_client.get(path(printer.id) + "/snapshot")).status_code == 502


@pytest.mark.asyncio
async def test_status_does_not_open_transport(async_client, printer_factory):
    printer = await printer_factory()
    with patch("backend.app.services.external_camera.generate_mjpeg_stream") as transport:
        response = await async_client.get(path(printer.id) + "/status")
        assert response.json() == {
            "configured": False,
            "enabled": False,
            "friendly_name": None,
            "active_sessions": 0,
            "frames_recent": False,
            "last_frame_age_seconds": None,
        }
        transport.assert_not_called()
    assert (await async_client.get(path(999999) + "/status")).status_code == 404


@pytest.mark.asyncio
async def test_status_exposes_friendly_name_without_source_credentials(async_client, printer_factory):
    printer = await save(async_client, printer_factory)
    response = await async_client.get(path(printer.id) + "/status")
    assert response.status_code == 200
    assert response.json()["friendly_name"] == PAYLOAD["friendly_name"]
    assert "camera_url" not in response.json()
    assert "snapshot_url" not in response.json()


@pytest.mark.asyncio
async def test_two_viewers_close_independently_and_stock_stop(async_client, printer_factory):
    printer = await printer_factory()
    processes = [MagicMock(pid=90001, returncode=None), MagicMock(pid=90002, returncode=None)]
    for process in processes:
        process.communicate = AsyncMock(return_value=(b"", b""))
    closed = []

    async def transport(*args, **kwargs):
        process = processes.pop(0)
        kwargs["on_process"](process)
        try:
            while True:
                kwargs["on_frame"](b"jpeg")
                yield b"frame"
        finally:
            closed.append(process.pid)

    with patch("backend.app.services.external_camera.generate_mjpeg_stream", transport):
        first = additional_camera.stream(printer.id, "rtsp://cam/live", "rtsp", 10, 0)
        second = additional_camera.stream(printer.id, "rtsp://cam/live", "rtsp", 10, 0)
        try:
            await anext(first)
            await anext(second)
            assert all(k.startswith(f"additional-camera:{printer.id}:") for k in additional_camera._sessions)
            response = await async_client.post(f"/api/v1/printers/{printer.id}/camera/stop")
            assert response.json()["stopped"] == 0
            assert not closed
            await first.aclose()
            assert closed == [90001]
            assert additional_camera.active_process_ids() == {90002}
            assert await anext(second) == b"frame"
        finally:
            await first.aclose()
            await second.aclose()
    assert closed == [90001, 90002]


@pytest.mark.asyncio
async def test_primary_janitor_protects_additional_process():
    session = additional_camera.Session(12, MagicMock(pid=90123, returncode=None))
    with (
        patch.dict(additional_camera._sessions, {"additional-camera:12:test": session}),
        patch.object(primary, "_scan_bambu_ffmpeg_pids", return_value=[90123]),
        patch("os.kill") as kill,
    ):
        await primary.cleanup_orphaned_streams()
        kill.assert_not_called()


@pytest.mark.asyncio
async def test_disconnect_cancellation_closes_transport():
    started = asyncio.Event()
    closed = asyncio.Event()

    async def transport(*args, **kwargs):
        try:
            started.set()
            await anyio.sleep_forever()
            yield b"unreachable"
        finally:
            await asyncio.sleep(0)
            closed.set()

    async def consume():
        async for _ in additional_camera.stream(123, "rtsp://cam/live", "rtsp", 10, 0):
            pass

    with patch("backend.app.services.external_camera.generate_mjpeg_stream", transport):
        task = asyncio.create_task(consume())
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert closed.is_set()
    assert additional_camera.status(123)["active_sessions"] == 0


@pytest.mark.asyncio
async def test_stream_tokens_required_and_shared(async_client, printer_factory):
    printer = await save(async_client, printer_factory)
    setup = await async_client.post(
        "/api/v1/auth/setup",
        json={
            "auth_enabled": True,
            "admin_username": "streamadmin",
            "admin_password": "AdminPass1!",
        },
    )
    assert setup.status_code == 200
    login = await async_client.post("/api/v1/auth/login", json={"username": "streamadmin", "password": "AdminPass1!"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await async_client.post("/api/v1/printers/camera/stream-token")).status_code == 401
    token = (await async_client.post("/api/v1/printers/camera/stream-token", headers=headers)).json()["token"]

    async def transport(*args, **kwargs):
        yield b"frame"

    for endpoint in ("stream", "snapshot", "status"):
        url = path(printer.id) + "/" + endpoint
        assert (await async_client.get(url)).status_code == 401
        assert (await async_client.get(url + "?token=invalid")).status_code == 401
        assert (await async_client.get(url, headers=headers)).status_code == 401
        with (
            patch("backend.app.services.external_camera.generate_mjpeg_stream", transport),
            patch("backend.app.services.external_camera.capture_frame", AsyncMock(return_value=b"jpeg")),
        ):
            assert (await async_client.get(url + "?token=" + token)).status_code == 200


@pytest.mark.asyncio
async def test_asgi_disconnect_reaps_usb_process_without_stopping_primary():
    """Exercise the real USB transport under Starlette's disconnect cancel scope."""
    from backend.app.api.routes.additional_cameras import AdditionalCameraStreamingResponse

    body_sent = asyncio.Event()
    process = MagicMock(pid=90125, returncode=None)
    process.stdout.read = AsyncMock(return_value=b"\xff\xd8fake-jpeg\xff\xd9")
    process.wait = AsyncMock(return_value=0)
    process.communicate = AsyncMock(return_value=(b"", b""))
    stock = MagicMock(pid=90126, returncode=None)

    async def receive():
        await body_sent.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.body" and message.get("body"):
            body_sent.set()
            await asyncio.sleep(0)

    with (
        patch("backend.app.services.external_camera.get_ffmpeg_path", return_value="/fake/ffmpeg"),
        patch("backend.app.services.external_camera._safe_usb_device_path", return_value="/dev/video0"),
        patch("backend.app.services.external_camera.asyncio.create_subprocess_exec", AsyncMock(return_value=process)),
        patch.dict(primary._active_streams, {"44-stock": stock}),
    ):
        response = AdditionalCameraStreamingResponse(additional_camera.stream(44, "/dev/video0", "usb", 10, 0))
        await asyncio.wait_for(response({"type": "http", "asgi": {"spec_version": "2.0"}}, receive, send), timeout=5)
        assert primary._active_streams["44-stock"] is stock
    process.terminate.assert_called()
    process.communicate.assert_awaited_once()
    stock.terminate.assert_not_called()
    assert additional_camera.status(44)["active_sessions"] == 0


@pytest.mark.asyncio
async def test_user_without_camera_view_cannot_mint_token(async_client):
    await async_client.post(
        "/api/v1/auth/setup",
        json={
            "auth_enabled": True,
            "admin_username": "cameraowner",
            "admin_password": "AdminPass1!",
        },
    )
    login = await async_client.post("/api/v1/auth/login", json={"username": "cameraowner", "password": "AdminPass1!"})
    admin = {"Authorization": f"Bearer {login.json()['access_token']}"}
    group = await async_client.post("/api/v1/groups/", headers=admin, json={"name": "No camera", "permissions": []})
    assert group.status_code == 201
    user = await async_client.post(
        "/api/v1/users/",
        headers=admin,
        json={
            "username": "nocamera",
            "password": "ViewerPass1!",
            "group_ids": [group.json()["id"]],
        },
    )
    assert user.status_code == 201
    login = await async_client.post("/api/v1/auth/login", json={"username": "nocamera", "password": "ViewerPass1!"})
    restricted = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await async_client.post("/api/v1/printers/camera/stream-token", headers=restricted)).status_code == 403


@pytest.mark.asyncio
async def test_camera_viewer_can_read_title_without_configuration_permission(async_client, printer_factory):
    printer = await save(async_client, printer_factory)
    await async_client.post(
        "/api/v1/auth/setup",
        json={"auth_enabled": True, "admin_username": "viewerowner", "admin_password": "AdminPass1!"},
    )
    login = await async_client.post("/api/v1/auth/login", json={"username": "viewerowner", "password": "AdminPass1!"})
    admin = {"Authorization": f"Bearer {login.json()['access_token']}"}
    group = await async_client.post(
        "/api/v1/groups/", headers=admin, json={"name": "Camera only", "permissions": ["camera:view"]}
    )
    assert group.status_code == 201
    user = await async_client.post(
        "/api/v1/users/",
        headers=admin,
        json={"username": "cameraonly", "password": "ViewerPass1!", "group_ids": [group.json()["id"]]},
    )
    assert user.status_code == 201
    login = await async_client.post("/api/v1/auth/login", json={"username": "cameraonly", "password": "ViewerPass1!"})
    viewer = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert (await async_client.get(path(printer.id), headers=viewer)).status_code == 403
    response = await async_client.post("/api/v1/printers/camera/stream-token", headers=viewer)
    assert response.status_code == 200
    token = response.json()["token"]
    response = await async_client.get(path(printer.id) + "/status?token=" + token)
    assert response.status_code == 200
    assert response.json()["friendly_name"] == PAYLOAD["friendly_name"]
    assert set(response.json()) == {
        "configured",
        "enabled",
        "friendly_name",
        "active_sessions",
        "frames_recent",
        "last_frame_age_seconds",
    }
