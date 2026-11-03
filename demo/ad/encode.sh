#!/usr/bin/env bash
# Frames (+ the mixed soundtrack, when there is one) to a 1080p30 H.264 MP4.
#   ./encode.sh FRAMES_DIR OUT.mp4 [MIX.wav]
set -euo pipefail
frames=$1 out=$2 mix=${3:-}
if [[ -n "$mix" ]]; then
  ffmpeg -v error -y -framerate 30 -i "$frames/%05d.jpg" -i "$mix" \
    -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -movflags +faststart \
    -c:a aac -b:a 192k -ar 48000 -shortest "$out"   # mix.py already normalised it to -14 LUFS
else
  ffmpeg -v error -y -framerate 30 -i "$frames/%05d.jpg" \
    -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -movflags +faststart "$out"
fi
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$out"
