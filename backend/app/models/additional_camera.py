"""Independent, optional camera configuration for a printer."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base

if TYPE_CHECKING:
    from backend.app.models.printer import Printer


class AdditionalCamera(Base):
    __tablename__ = "additional_cameras"
    __table_args__ = (
        CheckConstraint("camera_type IN ('mjpeg', 'rtsp', 'snapshot', 'usb')"),
        CheckConstraint("rotation IN (0, 90, 180, 270)"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    printer_id: Mapped[int] = mapped_column(ForeignKey("printers.id", ondelete="CASCADE"), unique=True)
    friendly_name: Mapped[str] = mapped_column(String(100))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    camera_type: Mapped[str] = mapped_column(String(20))
    camera_url: Mapped[str] = mapped_column(String(500))
    snapshot_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    rotation: Mapped[int] = mapped_column(default=0)
    additional_icon: Mapped[str] = mapped_column(String(32), default="camera-plus", server_default="camera-plus")
    both_icon: Mapped[str] = mapped_column(String(32), default="dual-camera", server_default="dual-camera")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    printer: Mapped["Printer"] = relationship(back_populates="additional_camera")
