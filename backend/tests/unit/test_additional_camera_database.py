"""Fresh initialization, upgrade, and process/engine restart persistence."""

import pytest
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.app.core import database
from backend.app.models.additional_camera import AdditionalCamera
from backend.app.models.printer import Printer


@pytest.mark.asyncio
@pytest.mark.parametrize("existing", [False, True])
async def test_initialization_and_restart(tmp_path, monkeypatch, existing):
    url = f"sqlite+aiosqlite:///{tmp_path / 'cameras.db'}"
    engine = create_async_engine(url)
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "async_session", async_sessionmaker(engine, expire_on_commit=False))
    # Simulate the pre-feature schema, then run the actual initialization flow.
    if existing:
        async with engine.begin() as conn:
            await conn.run_sync(
                lambda sync: database.Base.metadata.create_all(
                    sync,
                    tables=[
                        table for table in database.Base.metadata.sorted_tables if table.name != "additional_cameras"
                    ],
                )
            )
    await database.init_db()
    async with engine.connect() as conn:
        assert await conn.run_sync(lambda sync: inspect(sync).has_table("additional_cameras"))
    async with async_sessionmaker(engine)() as session:
        printer = Printer(name="Test", serial_number="PHASE1", ip_address="192.168.1.2", access_code="12345678")
        session.add(printer)
        await session.flush()
        session.add(
            AdditionalCamera(
                printer_id=printer.id,
                friendly_name="Persisted",
                enabled=True,
                camera_type="snapshot",
                camera_url="http://cam/frame",
                rotation=180,
            )
        )
        await session.commit()
    await engine.dispose()
    restarted = create_async_engine(url)
    monkeypatch.setattr(database, "engine", restarted)
    monkeypatch.setattr(database, "async_session", async_sessionmaker(restarted, expire_on_commit=False))
    await database.init_db()
    async with async_sessionmaker(restarted)() as session:
        camera = await session.scalar(select(AdditionalCamera))
        assert (camera.additional_icon, camera.both_icon) == ("camera-plus", "dual-camera")
        assert (camera.friendly_name, camera.enabled, camera.rotation) == ("Persisted", True, 180)
    await restarted.dispose()


@pytest.mark.asyncio
async def test_v1_table_upgrade_and_repeat_startup(tmp_path, monkeypatch):
    from sqlalchemy import text

    url = f"sqlite+aiosqlite:///{tmp_path / 'v1-cameras.db'}"
    engine = create_async_engine(url)
    monkeypatch.setattr(database, "engine", engine)
    monkeypatch.setattr(database, "async_session", async_sessionmaker(engine, expire_on_commit=False))
    await database.init_db()
    async with engine.begin() as conn:
        await conn.execute(text("DROP TABLE additional_cameras"))
        # Actual v1 columns, with a pre-existing configuration and no icon metadata.
        await conn.execute(
            text("""CREATE TABLE additional_cameras (
            id INTEGER PRIMARY KEY, printer_id INTEGER NOT NULL UNIQUE REFERENCES printers(id) ON DELETE CASCADE,
            friendly_name VARCHAR(100) NOT NULL, enabled BOOLEAN NOT NULL, camera_type VARCHAR(20) NOT NULL,
            camera_url VARCHAR(500) NOT NULL, snapshot_url VARCHAR(500), rotation INTEGER NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
            CHECK (camera_type IN ('mjpeg', 'rtsp', 'snapshot', 'usb')), CHECK (rotation IN (0,90,180,270)))""")
        )
    async with async_sessionmaker(engine)() as session:
        printer = Printer(name="V1", serial_number="V1ICONS", ip_address="192.168.1.2", access_code="12345678")
        session.add(printer)
        await session.flush()
        await session.execute(
            text("""INSERT INTO additional_cameras
            (printer_id, friendly_name, enabled, camera_type, camera_url, rotation)
            VALUES (:id, 'V1 camera', 1, 'snapshot', 'http://camera/frame', 0)"""),
            {"id": printer.id},
        )
        await session.commit()
    await database.init_db()
    await database.init_db()
    async with async_sessionmaker(engine)() as session:
        camera = await session.scalar(select(AdditionalCamera))
        assert (camera.additional_icon, camera.both_icon) == ("camera-plus", "dual-camera")
        camera.additional_icon, camera.both_icon = "security-camera", "split-camera-view"
        await session.commit()
    await engine.dispose()
    restarted = create_async_engine(url)
    monkeypatch.setattr(database, "engine", restarted)
    monkeypatch.setattr(database, "async_session", async_sessionmaker(restarted, expire_on_commit=False))
    await database.init_db()
    async with async_sessionmaker(restarted)() as session:
        camera = await session.scalar(select(AdditionalCamera))
        assert (camera.additional_icon, camera.both_icon) == ("security-camera", "split-camera-view")
    await restarted.dispose()
