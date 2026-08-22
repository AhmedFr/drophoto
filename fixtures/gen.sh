#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
ffmpeg -y -loglevel error -f lavfi -i testsrc=size=640x480:rate=25 -frames:v 1 sample.png
ffmpeg -y -loglevel error -f lavfi -i testsrc=size=640x480:rate=25 -frames:v 1 -q:v 3 sample.jpg
exiftool -overwrite_original -DateTimeOriginal="2025:09:12 14:03:21" -Model="Sony ILCE-7M4" -LensModel="FE 35mm F1.4 GM" -FNumber=2.0 -ExposureTime=1/800 -ISO=100 -FocalLength=35 -GPSLatitude=38.71 -GPSLatitudeRef=N -GPSLongitude=9.13 -GPSLongitudeRef=W sample.jpg
sips -s format heic sample.jpg --out sample.heic >/dev/null
ffmpeg -y -loglevel error -f lavfi -i testsrc=size=640x480:rate=25 -t 2 -pix_fmt yuv420p sample.mp4
ffmpeg -y -loglevel error -f lavfi -i testsrc=size=640x480:rate=25 -t 2 -pix_fmt yuv422p10le -c:v prores -profile:v 0 sample.mov
echo "Generated. Optionally drop a real RAW as fixtures/sample.raf (gitignored)."
