"""Assemble the chapter videos: stills -> slow zoom -> crossfade + narration."""

from __future__ import annotations

import json
import os
import subprocess
import wave

from script import CHAPTERS
from narration import NARRATION

HERE = os.path.dirname(os.path.abspath(__file__))
FF = subprocess.check_output(
    ["python3", "-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"]
).decode().strip()

FPS = 25
OUT_W, OUT_H = 1920, 1080
XFADE = 0.45          # crossfade between scenes (seconds)
LEAD = 0.45           # silence before narration starts
TAIL = 1.1            # breathing room after narration ends

AUDIO_SETS = {
    "01-start-here": ["ch01-a.mp3"],
    "02-masters-setup": ["ch02-a.mp3"],
    "03-sales-gst-invoice": ["ch03-a.mp3"],
    "04-purchase-procurement": ["ch04-a.mp3"],
    "05-customer-jobwork": ["ch05-a.mp3"],
    "06-manufacturing": ["ch06-a.mp3", "ch06-b.mp3"],
    "07-inventory-accounting": ["ch07-a.mp3"],
    "08-reports-gst-tally": ["ch08-a.mp3", "ch08-b.mp3"],
}


def run(args: list[str]):
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(" ".join(args[:6]) + "\n" + proc.stderr[-3000:])
    return proc.stdout + proc.stderr


def wav_duration(path: str) -> float:
    with wave.open(path, "rb") as w:
        return w.getnframes() / w.getframerate()


def chapter_audio(slug: str, work: str) -> str:
    clips = AUDIO_SETS[slug]
    out = os.path.join(work, f"{slug}.wav")
    if len(clips) == 1:
        args = [FF, "-y", "-i", os.path.join(HERE, "audio", clips[0])]
    else:
        inputs, filters = [], []
        for i, c in enumerate(clips):
            inputs += ["-i", os.path.join(HERE, "audio", c)]
            filters.append(f"[{i}:a]")
        args = [FF, "-y", *inputs, "-filter_complex",
                "".join(filters) + f"concat=n={len(clips)}:v=0:a=1"]
    args += ["-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", out]
    run(args)
    return out


def detect_pauses(wav: str):
    """Sentence-level pauses in the narration, so scene cuts land on them."""
    out = run([FF, "-hide_banner", "-i", wav, "-af",
               "silencedetect=noise=-32dB:d=0.15", "-f", "null", "-"])
    pauses, starts = [], []
    for line in out.splitlines():
        if "silence_start:" in line:
            starts.append(float(line.split("silence_start:")[1].split()[0]))
        elif "silence_end:" in line and starts:
            end = float(line.split("silence_end:")[1].split("|")[0])
            dur = float(line.split("silence_duration:")[1].split()[0])
            if dur >= 0.3:
                pauses.append((starts.pop(), end, dur))
    return pauses


def scene_durations(chapter, audio_len: float, pauses) -> list[float]:
    texts = NARRATION[chapter["slug"]]
    weights = []
    for scene, text in zip(chapter["scenes"], texts):
        w = max(6.0, float(len(text)))
        if scene.get("kind") == "chapter":
            w += 12
        weights.append(w)

    # char-proportional expectation, then snap each cut to the nearest pause
    total_w = sum(weights)
    expected, acc = [], 0.0
    for w in weights:
        acc += w
        expected.append(acc / total_w * audio_len)

    cuts = [0.0]
    prev = 0.0
    for i in range(len(weights) - 1):
        target = expected[i]
        lo, hi = max(prev + 2.2, target - 9), min(audio_len - 2.5, target + 9)
        best = None
        for start, end, dur in pauses:
            mid = (start + end) / 2
            if lo <= mid <= hi and (best is None or abs(mid - target) < abs(best - target)):
                best = mid
        if best is None:
            best = min(max(target, prev + 2.2), audio_len - 2.5)
        cuts.append(best)
        prev = best
    cuts.append(audio_len)

    durs = [cuts[i + 1] - cuts[i] for i in range(len(weights))]
    total = audio_len + LEAD + TAIL + XFADE * (len(weights) - 1)
    scale = total / audio_len
    return [d * scale for d in durs]


def build_chapter(chapter, work: str, out_dir: str) -> dict:
    slug = chapter["slug"]
    wav = chapter_audio(slug, work)
    audio_len = wav_duration(wav)
    durs = scene_durations(chapter, audio_len, detect_pauses(wav))
    n = len(durs)
    args = [FF, "-y"]
    filters = []
    for i, dur in enumerate(durs):
        args += ["-loop", "1", "-t", f"{dur:.3f}", "-i",
                 os.path.join(HERE, "frames", f"{slug}-s{i + 1:02d}.png")]
    # subtle alternating push-in / pull-out, always above 1080p source detail
    for i, dur in enumerate(durs):
        frames = max(2, int(dur * FPS))
        if i % 2 == 0:
            z = f"1+0.055*on/{frames - 1}"
        else:
            z = f"1.055-0.055*on/{frames - 1}"
        x = "iw/2-(iw/zoom/2)+6*sin(on/70)"
        y = "ih/2-(ih/zoom/2)+5*cos(on/80)"
        filters.append(
            f"[{i}:v]scale={int(OUT_W * 1.4)}:{int(OUT_H * 1.4)}:flags=lanczos,"
            f"zoompan=z='{z}':x='{x}':y='{y}':d=1:s={OUT_W}x{OUT_H}:fps={FPS},"
            f"setsar=1[v{i}]"
        )
    # crossfade chain
    last = "v0"
    offset = durs[0] - XFADE
    for i in range(1, n):
        label = f"x{i}"
        filters.append(
            f"[{last}][v{i}]xfade=transition=fade:duration={XFADE}:offset={offset:.3f}[{label}]"
        )
        offset += durs[i] - XFADE
        last = label
    filters.append(f"[{last}]fade=t=in:st=0:d=0.5,"
                   f"fade=t=out:st={audio_len + LEAD + TAIL - 0.9:.3f}:d=0.9,format=yuv420p[vout]")

    args += ["-i", wav]
    total = audio_len + LEAD + TAIL
    filters.append(
        f"[{n}:a]adelay={int(LEAD * 1000)}|{int(LEAD * 1000)},"
        f"apad=whole_dur={total:.3f},atrim=0:{total:.3f},"
        f"afade=t=in:st=0:d=0.3,afade=t=out:st={total - 1.0:.3f}:d=1.0[aout]"
    )
    out = os.path.join(out_dir, f"ForgeERP-{slug}.mp4")
    args += ["-filter_complex", ";".join(filters), "-map", "[vout]", "-map", "[aout]",
             "-t", f"{total:.3f}", "-r", str(FPS),
             "-c:v", "libx264", "-preset", "medium", "-crf", "33",
             "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p",
             "-tune", "stillimage", "-g", str(FPS * 5), "-bf", "2",
             "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
             "-movflags", "+faststart", out]
    print(f"  encoding {os.path.basename(out)} ({total:.1f}s, {n} scenes)")
    run(args)
    return {"slug": slug, "file": os.path.basename(out), "seconds": round(total, 1),
            "scenes": n, "scenes_dur": [round(d, 2) for d in durs]}


def main():
    only = set(__import__("sys").argv[1:])
    work = os.path.join(HERE, "work")
    out_dir = os.path.join(HERE, "..", "demo-videos")
    os.makedirs(work, exist_ok=True)
    os.makedirs(out_dir, exist_ok=True)
    report = []
    for chapter in CHAPTERS:
        if only and chapter["slug"] not in only:
            continue
        print(f"chapter {chapter['id']} — {chapter['title']}")
        report.append(build_chapter(chapter, work, out_dir))
    if only:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return
    # full course film
    listing = os.path.join(work, "concat.txt")
    with open(listing, "w") as fh:
        for row in report:
            fh.write(f"file '{os.path.join(out_dir, row['file'])}'\n")
    full = os.path.join(out_dir, "ForgeERP-Pura-Course-Full.mp4")
    run([FF, "-y", "-f", "concat", "-safe", "0", "-i", listing, "-c", "copy",
         "-movflags", "+faststart", full])
    report.append({"slug": "full", "file": os.path.basename(full),
                   "seconds": round(sum(r["seconds"] for r in report), 1),
                   "scenes": sum(r["scenes"] for r in report)})
    with open(os.path.join(work, "report.json"), "w") as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False)
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
