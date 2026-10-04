#!/bin/sh
# Generates the probe media. 150 s "track" (chord + noise, stereo, 44.1 kHz) and a 2 s loop
# (440 Hz sine, exactly 880 cycles, so the PCM loops without a seam).
set -e
cd "$(dirname "$0")/media"
T="aevalsrc=0.2*sin(2*PI*220*t)+0.15*sin(2*PI*277.18*t)+0.1*sin(2*PI*329.63*t)+0.05*(random(0)-0.5)|0.2*sin(2*PI*221*t)+0.15*sin(2*PI*330*t)+0.05*(random(1)-0.5):s=44100:d=150"
L="aevalsrc=0.5*sin(2*PI*440*t)|0.5*sin(2*PI*440*t):s=44100:d=2"
for kind in track loop; do
  if [ $kind = track ]; then SRC="$T"; else SRC="$L"; fi
  ffmpeg -y -loglevel error -f lavfi -i "$SRC" -c:a pcm_s16le $kind.wav
  ffmpeg -y -loglevel error -i $kind.wav -c:a libmp3lame -b:a 128k $kind.mp3
  ffmpeg -y -loglevel error -i $kind.wav -c:a aac_at -b:a 128k $kind.m4a
  ffmpeg -y -loglevel error -i $kind.wav -c:a libvorbis -q:a 4 $kind.ogg
  ffmpeg -y -loglevel error -i $kind.wav -c:a libopus -b:a 96k $kind.opus.ogg
  ffmpeg -y -loglevel error -i $kind.wav -c:a libopus -b:a 96k $kind.webm
done
ls -l
