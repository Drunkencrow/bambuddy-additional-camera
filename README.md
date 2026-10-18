# Bambuddy Additional Camera

A private/custom modification of [Bambuddy](https://github.com/maziggy/bambuddy) that adds **one independent Additional Camera per printer**, while preserving Bambuddy's existing Stock camera behavior.

This repository (`Drunkencrow/bambuddy-additional-camera`) is a separate customization, not an official Bambuddy feature or official Bambuddy distribution.

**Current completed/tested release:** `additional-camera-v1.0.0`

**Development branch:** `additional-camera-dev`

## Stock and Additional cameras

Bambuddy's existing **General → Camera → External Camera** setting remains unchanged. That setting can replace the printer's built-in camera as Bambuddy's **Stock / Primary camera**.

This modification adds a **separate Additional Camera** through **Configure Bambuddy → Additional Cameras**. It does not replace the Stock camera. Each printer can show its Stock camera, its Additional Camera, or both simultaneously.

| Camera | Source |
| --- | --- |
| Stock / Primary | Whatever Bambuddy currently uses as its normal camera: the built-in camera or the existing stock External Camera configuration. |
| Additional | The independent second camera configured for that printer. |
| Both | Primary and Additional together in one viewer. |

If **General → Camera → External Camera** is enabled, that external camera remains the Primary camera. The Both Cameras viewer therefore works with either **built-in Primary + Additional** or **stock External Primary + Additional**.

## Configuration

Open **Configure Bambuddy → Additional Cameras**, select a printer, and configure its second camera.

| Setting or action | Purpose |
| --- | --- |
| Friendly Name | Identifies the Additional Camera in its viewer and in the Additional pane of Both Cameras. |
| Enabled | Enables or disables the Additional Camera for that printer. |
| Source type | MJPEG, RTSP, HTTP Snapshot, or USB/V4L2. |
| Source URL / device | The camera stream, snapshot endpoint, or USB/V4L2 device for the selected source type. |
| Optional snapshot URL | Provides a separate snapshot endpoint where supported. |
| Rotation | Adjusts the Additional Camera's displayed orientation. |
| Test Camera / Connection | Checks the configured camera connection before use. |

Saved configurations remain visible as persistent camera cards, so multiple printers' Additional Cameras can be reviewed and edited without selecting each printer again. The printer selector offers printers that do not yet have an Additional Camera configuration. Saving a configuration leaves its card visible and removes that printer from the available choices; removing the configuration makes the printer available again. Disabling a camera retains its configuration.

### Supported sources

| Additional Camera source | Description |
| --- | --- |
| MJPEG | A camera feed delivered as a sequence of JPEG frames. |
| RTSP | A camera video stream accessed through RTSP. |
| HTTP Snapshot | Still images retrieved from an HTTP snapshot endpoint. |
| USB/V4L2 | A local camera exposed through a Video4Linux2 device. |

## Printer card controls

The printer card provides **Stock | Additional | Both** camera controls.

| Control | Behavior | Icon |
| --- | --- | --- |
| Stock | Normal Bambuddy camera behavior with unchanged source semantics. | Existing Stock Video icon. |
| Additional | Opens the independently configured second camera. | Custom Additional Camera icon. |
| Both | Opens Primary and Additional simultaneously. | Custom dual-camera icon. |

**Additional** and **Both** appear only when an Additional Camera is configured and enabled for that printer.

### View modes

All three controls support **New Window** and **Embedded Overlay**. They share Bambuddy's remembered camera view-mode behavior: the remembered choice applies across Stock, Additional, and Both controls.

## Additional Camera viewer

The Additional Camera viewer uses the camera's **Friendly Name** and a Stock-style Bambuddy presentation. It supports zoom/pan, fullscreen, and a resizable, minimizable embedded overlay.

Streaming is viewer-driven. Minimizing the Additional overlay releases its Additional stream; expanding it automatically reconnects. The embedded viewer supports restoration across navigation within Bambuddy. If the Additional Camera fails, **Retry** lets you reconnect it.

## Both Cameras viewer

The combined viewer uses the same Stock-style Bambuddy presentation and contains two panes:

- **Primary:** Bambuddy's current Stock / Primary camera.
- **Additional:** The independently configured second camera, labeled with its Friendly Name.

Wide layouts show the panes side-by-side; narrow layouts stack them. Each pane has independent zoom/pan, and combined fullscreen shows both cameras together.

Failures are handled independently. One failed camera does not tear down the other, and the Additional pane offers **Retry** to reconnect its camera.

## Camera isolation

Stock, Additional, and Both viewers can coexist. Closing or minimizing an Additional or Both viewer releases that viewer's camera use without destructively affecting another open camera viewer. This includes using an external RTSP Primary alongside an Additional Camera.

## Installation from source

Use Bambuddy's normal prerequisites and deployment model, but clone and build **this repository and branch** to use the modification. Access to the private repository is required. No public Docker image or package release is provided here for this customization.

```bash
git clone --branch additional-camera-dev git@github.com:Drunkencrow/bambuddy-additional-camera.git
cd bambuddy-additional-camera
```

For a Docker Compose deployment, review the checked-in [Compose configuration](docker-compose.yml) for your host's networking, storage, and device access, then build from this checkout:

```bash
docker compose up -d --build
```

The Compose file includes an upstream image reference as well as a local build definition. Use the explicit source build above to include this modification; pulling an upstream image does not include the custom branch's changes.

For native deployments, follow Bambuddy's normal source-install prerequisites and build/start procedure using this checkout. Refer to the [upstream Bambuddy project](https://github.com/maziggy/bambuddy) for the original project's deployment documentation. Ensure any installation tooling uses this private repository and the intended branch or tag rather than fetching upstream code or a prebuilt upstream release.

For the completed initial implementation, use the `additional-camera-v1.0.0` tag as the source revision instead of the development branch.

## Upstream updates

This repository keeps upstream development separate from the custom branch:

| Role | Repository / branch |
| --- | --- |
| `upstream` | `https://github.com/maziggy/bambuddy.git` |
| `private` | `git@github.com:Drunkencrow/bambuddy-additional-camera.git` |
| Custom development | `additional-camera-dev` |

Bring upstream Bambuddy changes into the custom branch deliberately, review conflicts and camera behavior, and retest before deployment. Replacing the custom branch with upstream code would discard the Additional Camera modification. Updating an upstream container image is not a substitute for integrating and building this branch.

## Version and testing

**`additional-camera-v1.0.0`** represents the extensively tested initial Additional Camera implementation. This release does not claim compatibility with future Bambuddy versions; later upstream integrations require their own validation.

Development validation covered:

- Backend tests and frontend tests.
- TypeScript, linting, i18n parity, and the production build.
- The Safari 16 browser baseline and Chromium browser checks.
- Real RTSP camera testing.
- Concurrent Stock / Additional / Both viewers and close-order isolation.
- External RTSP Primary + Additional operation.

## Screenshots

Screenshots of this modification can be added here once repository-safe captures are available:

- Additional Cameras configuration and persistent camera cards.
- Printer card with Stock / Additional / Both controls.
- Additional Camera viewer.
- Both Cameras viewer in wide and narrow layouts.

These are placeholders; no screenshot files are linked yet.

## Attribution and license

This modification is **based on [Bambuddy](https://github.com/maziggy/bambuddy)**. Bambuddy is developed and maintained by its upstream project and authors, who retain credit for the original project and code.

The Additional Camera modification is separate and is not an official upstream feature or distribution. Visit [upstream Bambuddy](https://github.com/maziggy/bambuddy) for the original project.

See [LICENSE](LICENSE) for the repository's license. Existing upstream attribution and license files remain unchanged.
