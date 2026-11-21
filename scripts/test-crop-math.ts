// Unit tests for src/lib/crop-math.ts (admin photo crop editor math).
// Run: npx tsx scripts/test-crop-math.ts
import {
  CROP_ASPECT,
  CROP_MAX_ZOOM,
  CROP_MIN_ZOOM,
  baseCropRect,
  clampCropCenter,
  clampZoom,
  panCropCenter,
  zoomedCropRect,
} from '../src/lib/crop-math';

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string): void {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`);
  }
}

const approx = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;

// --- base rect: largest 16:10 inside the source ---------------------------
{
  const r = baseCropRect(1600, 1000);
  ok(r.w === 1600 && r.h === 1000 && r.x === 0 && r.y === 0, 'exact 16:10 source keeps everything');
}
{
  const r = baseCropRect(2000, 1000); // wider than 16:10
  ok(r.h === 1000 && approx(r.w, 1600) && approx(r.x, 200) && r.y === 0, 'wide source crops sides, centered');
}
{
  const r = baseCropRect(1000, 2000); // portrait
  ok(r.w === 1000 && approx(r.h, 625) && r.x === 0 && approx(r.y, 687.5), 'portrait source crops top/bottom, centered');
}
{
  const r = baseCropRect(0, 100);
  ok(r.w === 0 && r.h === 0, 'degenerate source yields empty rect');
}
ok(CROP_ASPECT === 1.6, 'aspect is 16:10');

// --- round layout: square crop --------------------------------------------
{
  const r = baseCropRect(2000, 1000, 1);
  ok(r.w === 1000 && r.h === 1000 && approx(r.x, 500) && r.y === 0, 'square crop from a wide source, centered');
}
{
  const r = baseCropRect(1000, 2000, 1);
  ok(r.w === 1000 && r.h === 1000 && r.x === 0 && approx(r.y, 500), 'square crop from a portrait source, centered');
}
{
  const r = zoomedCropRect(1000, 1000, 500, 500, 2, 1);
  ok(approx(r.w, 500) && approx(r.h, 500) && approx(r.x, 250) && approx(r.y, 250), 'square crop stays square when zoomed');
}
{
  const c = panCropCenter(1000, 1000, 500, 500, 1, 100, 0, 500, 1);
  const r = zoomedCropRect(1000, 1000, c.cx, c.cy, 1, 1);
  ok(r.w === 1000 && r.h === 1000 && r.x === 0 && r.y === 0, 'square pan never leaves the source');
}

// --- zoom ------------------------------------------------------------------
ok(clampZoom(0.5) === CROP_MIN_ZOOM, 'zoom below 1 clamps to 1');
ok(clampZoom(99) === CROP_MAX_ZOOM, 'zoom above max clamps to 4');
ok(clampZoom(Number.NaN) === CROP_MIN_ZOOM, 'NaN zoom falls back to 1');
{
  const r = zoomedCropRect(1600, 1000, 800, 500, 2);
  ok(approx(r.w, 800) && approx(r.h, 500) && approx(r.x, 400) && approx(r.y, 250), 'zoom 2 halves the rect around center');
}
{
  // zoomed rect never leaves the photo, even with an edge center
  const r = zoomedCropRect(1600, 1000, 0, 0, 2);
  ok(r.x === 0 && r.y === 0 && approx(r.w, 800) && approx(r.h, 500), 'edge center clamps rect inside');
}
{
  const r = zoomedCropRect(1600, 1000, 1600, 1000, 4);
  ok(approx(r.x + r.w, 1600) && approx(r.y + r.h, 1000), 'max zoom pins rect to the far edge');
}

// --- clamp -----------------------------------------------------------------
{
  const c = clampCropCenter(1600, 1000, 800, 500, 5000, -20);
  ok(c.cx === 1200 && c.cy === 250, 'wild center clamps to the allowed range');
}

// --- pan: drag right moves the window left through the source ---------------
{
  // 1600px source in an 800px viewport at zoom 2: rect is 800 wide,
  // so 1 canvas px = 1 source px
  const c = panCropCenter(1600, 1000, 800, 500, 2, 100, 0, 800);
  ok(approx(c.cx, 700) && approx(c.cy, 500), 'drag right shifts center left by dx * scale');
}
{
  // panning past the edge pins the window, never blanks it
  const c = panCropCenter(1600, 1000, 800, 500, 1, -10000, 0, 800);
  const r = zoomedCropRect(1600, 1000, c.cx, c.cy, 1);
  ok(r.x === 0 && approx(r.w, 1600), 'extreme pan pins rect at the source edge');
}
{
  const c = panCropCenter(1600, 1000, 800, 500, 1, 0, 0, 0);
  ok(c.cx === 800 && c.cy === 500, 'zero viewport width is a safe no-op');
}

console.log(`\ncrop-math: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
