#!/bin/sh
# assemble.sh <part1.mp4> <part2.mp4> <cut-from> <cut-to> <out.mp4>
# Joins the two parts with a soft cross-fade, drops the stretch of part 2 between the two times (the preview
# loading), and fades the film in and out. Full HD, 30 frames a second, no sound.
set -e
p1=$1; p2=$2; a=$3; b=$4; out=$5
dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
d1=$(dur "$p1"); d2=$(dur "$p2")
X=0.8   # cross-fade between the parts
C=0.5   # cross-fade over the cut
calc() { python3 -c "print(round($1, 3))"; }
o1=$(calc "$d1 - $X")                 # where part 2 starts to fade in
o2=$(calc "$d1 - $X + $a - $C")       # where the cut's cross-fade starts
total=$(calc "$d1 - $X + $a - $C + ($d2 - $b)")
ffmpeg -y -loglevel error -i "$p1" -i "$p2" -filter_complex "
  [1:v]trim=0:$a,setpts=PTS-STARTPTS[b1];
  [1:v]trim=start=$b,setpts=PTS-STARTPTS[b2];
  [0:v][b1]xfade=transition=fade:duration=$X:offset=$o1[x1];
  [x1][b2]xfade=transition=fade:duration=$C:offset=$o2[x2];
  [x2]fade=t=in:st=0:d=0.6,fade=t=out:st=$(calc "$total - 1.0"):d=1.0,format=yuv420p[v]" \
  -map "[v]" -an -r 30 -c:v libx264 -preset slow -crf 20 -profile:v high -movflags +faststart "$out"
echo "$out: $(dur "$out") s"
