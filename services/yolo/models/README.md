Place your trained civic issue checkpoint here as `civic-issues.pt`.

The YOLO service will try model paths in this order:

1. `YOLO_MODEL_PATH`
2. `models/civic-issues.pt`
3. `civic-issues.pt`
4. `yolo11n.pt`

Expected labels should match the app categories when possible:

- `pothole`
- `garbage`
- `broken_streetlight`
- `damaged_road`
- `water_leak`
- `other`
