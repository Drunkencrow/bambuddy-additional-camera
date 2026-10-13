"""Configuration only: these routes never select or start a printer camera."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.auth import RequirePermissionIfAuthEnabled
from backend.app.core.database import get_db
from backend.app.core.permissions import Permission
from backend.app.models.additional_camera import AdditionalCamera
from backend.app.models.printer import Printer
from backend.app.schemas.additional_camera import AdditionalCameraResponse, AdditionalCameraSave, AdditionalCameraTest
from backend.app.services import external_camera

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
