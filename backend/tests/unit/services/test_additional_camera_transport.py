"""Optional output rotation and deterministic nested transport cleanup."""

from io import BytesIO
from unittest.mock import patch

import pytest
from PIL import Image

from backend.app.services import external_camera


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "camera_type,helper", [("mjpeg", "_stream_mjpeg"), ("rtsp", "_stream_rtsp"), ("usb", "_stream_usb")]
)
@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
async def test_rotation_and_generator_close(camera_type, helper, rotation):
    output = BytesIO()
    Image.new("RGB", (8, 4), "red").save(output, format="JPEG")
    original = output.getvalue()
    closed = []
    published = []

    async def frames(*args, **kwargs):
        try:
            yield original
            yield original
        finally:
            closed.append(True)

    with patch.object(external_camera, helper, frames):
        stream = external_camera.generate_mjpeg_stream(
            "source", camera_type, rotation=rotation, on_frame=published.append
        )
        chunk = await anext(stream)
        await stream.aclose()
    assert closed == [True]
    assert published[0] in chunk
    image = Image.open(BytesIO(published[0]))
    assert image.size == ((4, 8) if rotation in (90, 270) else (8, 4))
    if rotation == 0:
        assert published[0] == original


@pytest.mark.asyncio
async def test_snapshot_poll_rotation():
    from unittest.mock import AsyncMock

    output = BytesIO()
    Image.new("RGB", (8, 4), "red").save(output, format="JPEG")
    with patch.object(external_camera, "_capture_snapshot", AsyncMock(return_value=output.getvalue())):
        stream = external_camera.generate_mjpeg_stream("http://cam/frame", "snapshot", rotation=90)
        chunk = await anext(stream)
        await stream.aclose()
    jpeg = chunk.split(b"\r\n\r\n", 1)[1][:-2]
    assert Image.open(BytesIO(jpeg)).size == (4, 8)
