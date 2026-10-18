"""Configuration-only camera API persistence and primary-camera isolation."""

from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from backend.app.models.additional_camera import AdditionalCamera

PAYLOAD = {
    "friendly_name": "Side view",
    "enabled": True,
    "camera_type": "mjpeg",
    "camera_url": "http://camera.local/video",
    "snapshot_url": "http://camera.local/frame.jpg",
    "rotation": 90,
}


def path(printer_id):
    return f"/api/v1/printers/{printer_id}/additional-camera"


@pytest.mark.asyncio
async def test_crud_and_primary_isolation(async_client, printer_factory, db_session):
    printer = await printer_factory(
        external_camera_url="rtsp://primary/live",
        external_camera_type="rtsp",
        external_camera_enabled=True,
        external_camera_snapshot_url="http://primary/frame",
        camera_rotation=180,
    )
    url = path(printer.id)
    assert (await async_client.get(url)).json() is None
    created = await async_client.put(url, json=PAYLOAD)
    assert created.status_code == 200
    data = created.json()
    assert data.items() >= PAYLOAD.items()
    assert data["printer_id"] == printer.id
    assert data["created_at"]
    # A new request/session reads committed configuration.
    assert (await async_client.get(url)).json() == data
    updated = await async_client.put(
        url,
        json={
            **PAYLOAD,
            "friendly_name": "Back",
            "enabled": False,
            "camera_type": "usb",
            "camera_url": "/dev/video0",
            "rotation": 270,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["id"] == data["id"]
    assert updated.json()["camera_url"] == "/dev/video0"
    assert updated.json()["enabled"] is False
    assert (await async_client.delete(url)).status_code == 204
    assert (await async_client.get(url)).json() is None
    assert (await async_client.delete(url)).status_code == 204
    await db_session.refresh(printer)
    assert (
        printer.external_camera_url,
        printer.external_camera_type,
        printer.external_camera_enabled,
        printer.external_camera_snapshot_url,
        printer.camera_rotation,
    ) == ("rtsp://primary/live", "rtsp", True, "http://primary/frame", 180)


@pytest.mark.asyncio
async def test_uniqueness_only_per_printer(async_client, printer_factory, db_session):
    first, second = await printer_factory(), await printer_factory()
    for printer in (first, second):
        assert (await async_client.put(path(printer.id), json=PAYLOAD)).status_code == 200
    db_session.add(AdditionalCamera(printer_id=first.id, **PAYLOAD))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
    assert len((await db_session.scalars(select(AdditionalCamera))).all()) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "camera_type,camera_url",
    [
        ("mjpeg", "http://cam/video"),
        ("rtsp", "rtsp://cam/live"),
        ("snapshot", "http://cam/frame"),
        ("usb", "/dev/video0"),
    ],
)
async def test_unsaved_connection_uses_existing_service(async_client, printer_factory, camera_type, camera_url):
    printer = await printer_factory()
    with patch("backend.app.services.external_camera.test_connection", new_callable=AsyncMock) as test:
        test.return_value = {"success": True, "resolution": "640x480", "coalesced": False}
        response = await async_client.post(
            path(printer.id) + "/test", json={"camera_type": camera_type, "camera_url": camera_url}
        )
        assert response.status_code == 200
        assert response.json() == test.return_value
        test.assert_awaited_once_with(camera_url, camera_type)
    assert (await async_client.get(path(printer.id))).json() is None


@pytest.mark.asyncio
async def test_connection_failure_passthrough(async_client, printer_factory):
    printer = await printer_factory()
    with patch("backend.app.services.external_camera.test_connection", new_callable=AsyncMock) as test:
        test.return_value = {"success": False, "error": "Connection failed: TimeoutError"}
        response = await async_client.post(path(printer.id) + "/test", json=PAYLOAD)
        assert response.json() == test.return_value


@pytest.mark.asyncio
async def test_printer_deletion_cascades(async_client, printer_factory, db_session):
    printer = await printer_factory()
    assert (await async_client.put(path(printer.id), json=PAYLOAD)).status_code == 200
    # Exercise the same ORM deletion used by the printer API.
    await db_session.delete(printer)
    await db_session.commit()
    assert (await db_session.scalars(select(AdditionalCamera))).all() == []
    assert (await async_client.get(path(printer.id))).status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "changes",
    [
        {"friendly_name": " "},
        {"friendly_name": "x" * 101},
        {"camera_type": "invalid"},
        {"camera_url": " "},
        {"rotation": 45},
    ],
)
async def test_validation(async_client, printer_factory, changes):
    printer = await printer_factory()
    assert (await async_client.put(path(printer.id), json={**PAYLOAD, **changes})).status_code == 422


@pytest.mark.asyncio
async def test_missing_printer(async_client):
    url = path(999999)
    assert (await async_client.get(url)).status_code == 404
    assert (await async_client.put(url, json=PAYLOAD)).status_code == 404
    assert (await async_client.delete(url)).status_code == 404
    assert (await async_client.post(url + "/test", json=PAYLOAD)).status_code == 404


@pytest.mark.asyncio
async def test_configuration_permissions(async_client, printer_factory):
    printer = await printer_factory()
    setup = await async_client.post(
        "/api/v1/auth/setup",
        json={
            "auth_enabled": True,
            "admin_username": "cameraadmin",
            "admin_password": "AdminPass1!",
        },
    )
    assert setup.status_code == 200
    login = await async_client.post("/api/v1/auth/login", json={"username": "cameraadmin", "password": "AdminPass1!"})
    admin = {"Authorization": f"Bearer {login.json()['access_token']}"}
    groups = (await async_client.get("/api/v1/groups/", headers=admin)).json()
    viewer = next(group for group in groups if group["name"] == "Viewers")
    created = await async_client.post(
        "/api/v1/users/",
        headers=admin,
        json={
            "username": "cameraviewer",
            "password": "ViewerPass1!",
            "group_ids": [viewer["id"]],
        },
    )
    assert created.status_code == 201
    login = await async_client.post("/api/v1/auth/login", json={"username": "cameraviewer", "password": "ViewerPass1!"})
    restricted = {"Authorization": f"Bearer {login.json()['access_token']}"}
    url = path(printer.id)
    assert (await async_client.put(url, headers=admin, json=PAYLOAD)).status_code == 200
    for method, endpoint, body in [
        ("GET", url, None),
        ("PUT", url, PAYLOAD),
        ("DELETE", url, None),
        ("POST", url + "/test", PAYLOAD),
    ]:
        response = await async_client.request(method, endpoint, headers=restricted, json=body)
        assert response.status_code == 403
    assert (await async_client.get(url, headers=admin)).status_code == 200
    assert (await async_client.delete(url, headers=admin)).status_code == 204


@pytest.mark.asyncio
async def test_icon_retention_and_independence(async_client, printer_factory, db_session):
    first, second = await printer_factory(), await printer_factory()
    url = path(first.id)
    defaults = (await async_client.put(url, json=PAYLOAD)).json()
    assert (defaults["additional_icon"], defaults["both_icon"]) == ("camera-plus", "dual-camera")
    selected = {"additional_icon": "webcam", "both_icon": "side-by-side"}
    response = await async_client.put(url, json={**PAYLOAD, **selected})
    assert response.json().items() >= selected.items()
    # Old clients omit both fields, including on disable/re-enable and source edits.
    for enabled in (False, True):
        response = await async_client.put(
            url,
            json={
                **PAYLOAD,
                "enabled": enabled,
                "friendly_name": "Changed",
                "camera_type": "rtsp",
                "camera_url": "rtsp://user:secret@camera/live",
                "rotation": 180,
            },
        )
        assert response.json().items() >= selected.items()
    for field, value in (("additional_icon", "overhead"), ("both_icon", "split-camera-view")):
        selected[field] = value
        response = await async_client.put(url, json={**PAYLOAD, field: value})
        assert response.json().items() >= selected.items()
    other = (await async_client.put(path(second.id), json=PAYLOAD)).json()
    assert (other["additional_icon"], other["both_icon"]) == ("camera-plus", "dual-camera")
    assert (await async_client.get(url)).json().items() >= selected.items()
    await async_client.delete(url)
    recreated = (await async_client.put(url, json=PAYLOAD)).json()
    assert (recreated["additional_icon"], recreated["both_icon"]) == ("camera-plus", "dual-camera")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field,values",
    [
        (
            "additional_icon",
            ["camera-plus", "video-plus", "overhead", "chamber", "webcam", "security-camera", "board-camera"],
        ),
        ("both_icon", ["dual-camera", "overlapping-cameras", "side-by-side", "split-camera-view"]),
    ],
)
async def test_valid_icons(async_client, printer_factory, field, values):
    url = path((await printer_factory()).id)
    for value in values:
        assert (await async_client.put(url, json={**PAYLOAD, field: value})).json()[field] == value
        assert (await async_client.get(url)).json()[field] == value


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["additional_icon", "both_icon"])
@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "invalid",
        "<svg/>",
        "<b>camera</b>",
        "https://camera/icon",
        "/tmp/icon.svg",
        "color:red",
        "AdditionalCameraIcon",
        "x" * 33,
        "__proto__",
        "constructor",
        123,
        {},
    ],
)
async def test_invalid_icon_metadata(async_client, printer_factory, field, value):
    url = path((await printer_factory()).id)
    await async_client.put(url, json=PAYLOAD)
    response = await async_client.put(url, json={**PAYLOAD, field: value})
    assert response.status_code == 422
    assert (await async_client.get(url)).json()[field] == (
        "camera-plus" if field == "additional_icon" else "dual-camera"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("field,value", [("additional_icon", "dual-camera"), ("both_icon", "camera-plus")])
async def test_cross_family_icons(async_client, printer_factory, field, value):
    response = await async_client.put(path((await printer_factory()).id), json={**PAYLOAD, field: value})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_status_icons_and_corrupt_storage(async_client, printer_factory, db_session, monkeypatch):
    from backend.app.api.routes import additional_cameras

    printer = await printer_factory()
    url = path(printer.id)

    # Route owns a short-lived session in production; use the fixture session here.
    class SessionContext:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *args):
            pass

    monkeypatch.setattr(additional_cameras.database, "async_session", SessionContext)
    initial = (await async_client.get(url + "/status")).json()
    assert initial["configured"] is False
    assert (initial["additional_icon"], initial["both_icon"]) == ("camera-plus", "dual-camera")
    await async_client.put(
        url,
        json={
            **PAYLOAD,
            "camera_url": "http://user:secret@camera/video",
            "additional_icon": "board-camera",
            "both_icon": "overlapping-cameras",
        },
    )
    status = (await async_client.get(url + "/status")).json()
    assert (status["additional_icon"], status["both_icon"]) == ("board-camera", "overlapping-cameras")
    assert set(status) == {
        "configured",
        "enabled",
        "friendly_name",
        "additional_icon",
        "both_icon",
        "active_sessions",
        "frames_recent",
        "last_frame_age_seconds",
    }
    assert "secret" not in str(status)
    camera = await db_session.scalar(select(AdditionalCamera).where(AdditionalCamera.printer_id == printer.id))
    camera.additional_icon = "<svg/>"
    camera.both_icon = "webcam"
    await db_session.commit()
    for endpoint in (url, url + "/status"):
        data = (await async_client.get(endpoint)).json()
        assert (data["additional_icon"], data["both_icon"]) == ("camera-plus", "dual-camera")
