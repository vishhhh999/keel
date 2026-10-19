"""Records the real Keel dashboard while scripts/proof.sh runs.
Usage: python3 record_dashboard.py <out_dir> <token> <max_seconds>   (stops early when <out_dir>/stop appears)
Writes <out_dir>/dashboard.webm and <out_dir>/dashboard.start (epoch ms when recording began).
"""
import sys, time, shutil, pathlib
from playwright.sync_api import sync_playwright

out, token, seconds = pathlib.Path(sys.argv[1]), sys.argv[2], int(sys.argv[3])
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 760, "height": 1080}, device_scale_factor=1,
                        record_video_dir=str(out / "vid"), record_video_size={"width": 760, "height": 1080})
    ctx.add_init_script(f"localStorage.setItem('keel.token', '{token}')")
    page = ctx.new_page()
    (out / "dashboard.start").write_text(str(int(time.time() * 1000)))
    page.goto("http://localhost:8080/")
    end = time.time() + seconds
    while time.time() < end and not (out / "stop").exists():
        page.wait_for_timeout(500)
    path = page.video.path()
    ctx.close(); b.close()
    shutil.move(path, out / "dashboard.webm")
    shutil.rmtree(out / "vid", ignore_errors=True)
print("dashboard recorded")
