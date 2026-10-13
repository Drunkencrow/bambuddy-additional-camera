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
        assert (camera.friendly_name, camera.enabled, camera.rotation) == ("Persisted", True, 180)
    await restarted.dispose()
