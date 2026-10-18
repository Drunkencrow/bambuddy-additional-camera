"""Additional camera configuration and unsaved connection-test inputs."""

from datetime import datetime
from typing import Literal, get_args

from pydantic import BaseModel, ConfigDict, Field, field_validator

CameraType = Literal["mjpeg", "rtsp", "snapshot", "usb"]

AdditionalCameraIcon = Literal[
    "camera-plus", "video-plus", "overhead", "chamber", "webcam", "security-camera", "board-camera"
]
BothCamerasIcon = Literal["dual-camera", "overlapping-cameras", "side-by-side", "split-camera-view"]


def normalized_additional_icon(value: object) -> AdditionalCameraIcon:
    return value if value in get_args(AdditionalCameraIcon) else "camera-plus"


def normalized_both_icon(value: object) -> BothCamerasIcon:
    return value if value in get_args(BothCamerasIcon) else "dual-camera"


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
    additional_icon: AdditionalCameraIcon = "camera-plus"
    both_icon: BothCamerasIcon = "dual-camera"
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

    # Reads tolerate old/corrupted storage; submitted configuration remains strict.
    @field_validator("additional_icon", mode="before")
    @classmethod
    def normalize_additional(cls, value: object) -> AdditionalCameraIcon:
        return normalized_additional_icon(value)

    @field_validator("both_icon", mode="before")
    @classmethod
    def normalize_both(cls, value: object) -> BothCamerasIcon:
        return normalized_both_icon(value)
