#!/usr/bin/env bash
# Every breakpoint x every beat: is anything clipped, does the page scroll
# sideways. One Chrome launch per breakpoint — beat-audit.html walks the whole
# sequence itself, reading the beat map off the engine, so the sweep covers
# whatever beats the page actually has and never checks the wrong moment.
#
#   bash scripts/sweep-beats.sh                                  # the demo
#   bash scripts/sweep-beats.sh --src ../../index.html --pin .days-pin \
#        --ignore .dk-slot--a,.sg--in
#
#   --port N     port of a server serving THIS skill folder     (default 8769)
#   --src PATH   page to audit, relative to scripts/       (default ../gallery.html)
#   --pin SEL    the pinned subtree to walk                     (default .bs-pin)
#   --ignore SEL,SEL   elements that leave the frame on purpose (see below)
#   --sizes "390x844 ..."   override the breakpoint list
#
# ON --ignore. Some elements leave the frame BY DESIGN: a losing variant sliding
# out, traffic lanes flowing in from beyond the edge. Those are motion, not
# defects, and the tell is that they clip identically at 1440 and at 390.
# Everything else that crosses an edge is a bug. Do not add a selector here to
# quieten a real failure — the whole value of the sweep is that it is allowed to
# say no.
#
# Needs Chrome or Chromium (found automatically, or CHROME_PATH) and a server on --port serving the scroll/ folder:
#   cd <skill folder> && python3 -m http.server 8769
set -u

PORT=8769
SRC='../gallery.html'
PIN='.bs-pin'
IGNORE=''
SIZES="390x844 414x896 560x900 768x1024 834x1112 1024x768 1280x800 1440x900"

while [ $# -gt 0 ]; do
  case "$1" in
    --port)   PORT="$2"; shift 2 ;;
    --src)    SRC="$2"; shift 2 ;;
    --pin)    PIN="$2"; shift 2 ;;
    --ignore) IGNORE="$2"; shift 2 ;;
    --sizes)  SIZES="$2"; shift 2 ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done

# Chrome or Chromium, wherever this OS keeps it; CHROME_PATH overrides
CH="${CHROME_PATH:-}"
if [ -z "$CH" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser /snap/bin/chromium \
           "/c/Program Files/Google/Chrome/Application/chrome.exe" \
           "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"; do
    [ -x "$c" ] && { CH="$c"; break; }
  done
fi
[ -n "$CH" ] && [ -x "$CH" ] || { echo "Chrome/Chromium not found. Install Chrome, or set CHROME_PATH to its executable."; exit 1; }
curl -s -o /dev/null "http://localhost:$PORT/scripts/beat-audit.html" || {
  echo "No server on $PORT serving the scroll/ folder. Run:  python3 -m http.server $PORT"; exit 1; }

fail=0
for wh in $SIZES; do
  w=${wh%x*}; h=${wh#*x}
  url="http://localhost:$PORT/scripts/beat-audit.html?w=$w&h=$h&src=$SRC&pin=$PIN"
  [ -n "$IGNORE" ] && url="$url&ignore=$IGNORE"
  # The window is deliberately far bigger than the viewport under test: the
  # harness sizes an inner iframe, because headless Chrome refuses a window
  # narrower than ~500px and merely CROPS the capture instead — which looks
  # exactly like content clipping. Every "mobile" screenshot taken by shrinking
  # the window is lying to you.
  out=$("$CH" --headless --disable-gpu --virtual-time-budget=25000 \
        --window-size=1700,1400 --dump-dom "$url" 2>/dev/null \
        | sed -n '/<pre id="out">/,/<\/pre>/p' | sed 's/<[^>]*>//g')
  if printf '%s\n' "$out" | grep -q 'VERDICT PASS'; then
    echo "PASS  ${w}x${h}"
  else
    fail=1
    echo "FAIL  ${w}x${h}"
    printf '%s\n' "$out" | grep -E '^FAIL|^        ' | sed 's/^/      /'
  fi
done

if [ $fail -eq 0 ]; then
  echo "ALL BREAKPOINTS x ALL BEATS: nothing clipped, no sideways scroll"
fi
exit $fail
