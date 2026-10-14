"""Independent additional-camera configuration and viewer-driven media routes."""

import asyncio
import logging

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core import database
from backend.app.core.auth import RequireCameraStreamTokenIfAuthEnabled, RequirePermissionIfAuthEnabled
from backend.app.core.database import get_db
from backend.app.core.permissions import Permission
from backend.app.models.additional_camera import AdditionalCamera
from backend.app.models.printer import Printer
from backend.app.schemas.additional_camera import AdditionalCameraResponse, AdditionalCameraSave, AdditionalCameraTest
from backend.app.services import additional_camera, external_camera
from backend.app.services.camera import apply_camera_rotation


class AdditionalCameraStreamingResponse(StreamingResponse):
    """Close the iterator even when disconnect cancellation happens during send."""

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            with anyio.CancelScope(shield=True):
                await self.body_iterator.aclose()


router = APIRouter(prefix="/printers/{printer_id}/additional-camera", tags=["additional cameras"])


async def configuration(printer_id: int, db: AsyncSession) -> AdditionalCamera | None:
    if await db.get(Printer, printer_id) is None:
        raise HTTPException(status_code=404, detail="Printer not found")
    return await db.scalar(select(AdditionalCamera).where(AdditionalCamera.printer_id == printer_id))


@router.get("", response_model=AdditionalCameraResponse | None)
async def read_configuration(
    printer_id: int,
    db: AsyncSession = Depends(get_db),
    _=RequirePermissionIfAuthEnabled(Permission.PRINTERS_UPDATE),
):
    # Configuration includes URL credentials; require modification permission.
    return await configuration(printer_id, db)


@router.put("", response_model=AdditionalCameraResponse)
async def save_configuration(
    printer_id: int,
    data: AdditionalCameraSave,
    db: AsyncSession = Depends(get_db),
    _=RequirePermissionIfAuthEnabled(Permission.PRINTERS_UPDATE),
):
    camera = await configuration(printer_id, db)
    if camera is None:
        camera = AdditionalCamera(printer_id=printer_id, **data.model_dump())
        db.add(camera)
    else:
        for key, value in data.model_dump().items():
            setattr(camera, key, value)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Camera configuration changed; reload and try again") from None
    await db.refresh(camera)
    return camera


@router.delete("", status_code=204)
async def delete_configuration(
    printer_id: int,
    db: AsyncSession = Depends(get_db),
    _=RequirePermissionIfAuthEnabled(Permission.PRINTERS_UPDATE),
):
    camera = await configuration(printer_id, db)
    if camera is not None:
        await db.delete(camera)
        await db.commit()
    return Response(status_code=204)


@router.post("/test")
async def test_configuration(
    printer_id: int,
    data: AdditionalCameraTest,
    db: AsyncSession = Depends(get_db),
    _=RequirePermissionIfAuthEnabled(Permission.PRINTERS_UPDATE),
):
    await configuration(printer_id, db)
    return await external_camera.test_connection(data.camera_url, data.camera_type)


async def media_configuration(printer_id: int) -> AdditionalCamera:
    # Release the database connection before a potentially hours-long stream.
    async with database.async_session() as db:
        camera = await configuration(printer_id, db)
    if camera is None:
        raise HTTPException(status_code=404, detail="Additional Camera not configured")
    if not camera.enabled:
        raise HTTPException(status_code=409, detail="Additional Camera disabled")
    validate_media_configuration(camera)
    return camera


def validate_media_configuration(camera: AdditionalCamera) -> None:
    if camera.camera_type not in ("mjpeg", "rtsp", "snapshot", "usb") or not camera.camera_url:
        raise HTTPException(status_code=422, detail="Incomplete Additional Camera source")
    if camera.rotation not in (0, 90, 180, 270):
        raise HTTPException(status_code=422, detail="Invalid Additional Camera rotation")
    if camera.camera_type == "usb":
        valid = external_camera._safe_usb_device_path(camera.camera_url)
    else:
        schemes = ("rtsp", "rtsps") if camera.camera_type == "rtsp" else ("http", "https")
        valid = external_camera._validate_camera_url(camera.camera_url, schemes)
    if not valid:
        raise HTTPException(status_code=422, detail="Invalid Additional Camera URL or unavailable USB device")
    if camera.snapshot_url and not external_camera._validate_camera_url(camera.snapshot_url, ("http", "https")):
        raise HTTPException(status_code=422, detail="Invalid Additional Camera snapshot URL")


@router.get("/stream")
async def stream(
    printer_id: int,
    fps: int = Query(default=10, ge=1, le=15),
    _=RequireCameraStreamTokenIfAuthEnabled,
):
    camera = await media_configuration(printer_id)
    return AdditionalCameraStreamingResponse(
        additional_camera.stream(printer_id, camera.camera_url, camera.camera_type, fps, camera.rotation),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate", "X-Accel-Buffering": "no"},
    )


@router.get("/snapshot")
async def snapshot(printer_id: int, _=RequireCameraStreamTokenIfAuthEnabled):
    camera = await media_configuration(printer_id)
    frame = await external_camera.capture_frame(camera.camera_url, camera.camera_type, snapshot_url=camera.snapshot_url)
    if not frame:
        raise HTTPException(status_code=502, detail="Additional Camera capture failed")
    frame = await asyncio.to_thread(apply_camera_rotation, frame, camera.rotation, logging.getLogger(__name__))
    return Response(content=frame, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@router.get("/status")
async def status(printer_id: int, _=RequireCameraStreamTokenIfAuthEnabled):
    async with database.async_session() as db:
        camera = await configuration(printer_id, db)
    return {
        "configured": camera is not None,
        "enabled": bool(camera and camera.enabled),
        **additional_camera.status(printer_id),
    }
