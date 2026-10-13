"""Additional camera configuration and unsaved connection-test inputs."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

CameraType = Literal["mjpeg", "rtsp", "snapshot", "usb"]


class AdditionalCameraTest(BaseModel):
    camera_type: CameraType
    camera_url: str = Field(min_length=1, max_length=500)

    @field_validator("camera_url")
    @classmethod
    def nonblank_url(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Camera URL / USB device must not be blank")
        return value


class AdditionalCameraSave(AdditionalCameraTest):
    friendly_name: str = Field(min_length=1, max_length=100)
    enabled: bool = False
    snapshot_url: str | None = Field(default=None, max_length=500)
    rotation: Literal[0, 90, 180, 270] = 0

    @field_validator("friendly_name")
    @classmethod
    def nonblank_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Friendly Name must not be blank")
        return value

    @field_validator("snapshot_url")
    @classmethod
    def optional_url(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None


class AdditionalCameraResponse(AdditionalCameraSave):
    model_config = ConfigDict(from_attributes=True)
    id: int
    printer_id: int
    created_at: datetime
    updated_at: datetime
