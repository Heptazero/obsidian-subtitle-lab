import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildNote, main, parseSubtitles } from "../scripts/prepare.mjs";

test("SRT and VTT cues keep their start times and readable text", () => {
  const srt = "1\n00:00:01,200 --> 00:00:03,000\n<i>Lock in</i> now.\n\n2\n00:01:04,500 --> 00:01:06,000\nNext line";
  assert.deepEqual(parseSubtitles(srt, ".srt"), [
    { start: 1.2, text: "Lock in now." },
    { start: 64.5, text: "Next line" },
  ]);
  const vtt = "WEBVTT\n\nintro\n00:00:05.000 --> 00:00:08.000 align:start\nHello &amp; welcome\n\n00:00:10.250 --> 00:00:12.000\nSecond";
  assert.deepEqual(parseSubtitles(vtt, ".vtt"), [
    { start: 5, text: "Hello & welcome" },
    { start: 10.25, text: "Second" },
  ]);
});

test("Bilibili, JSON3, native cues, and Markdown timestamps are accepted", () => {
  assert.deepEqual(parseSubtitles(JSON.stringify({ body: [{ from: 2.5, content: "Hi" }] }), ".json"), [
    { start: 2.5, text: "Hi" },
  ]);
  assert.deepEqual(parseSubtitles(JSON.stringify({ events: [{ tStartMs: 3000, segs: [{ utf8: "Hi" }] }] }), ".json"), [
    { start: 3, text: "Hi" },
  ]);
  assert.deepEqual(parseSubtitles(JSON.stringify([{ startMs: 4500, text: "Hi" }]), ".json"), [
    { start: 4.5, text: "Hi" },
  ]);
  assert.deepEqual(parseSubtitles("[00:06] Hello\n[00:08] World", ".md"), [
    { start: 6, text: "Hello" },
    { start: 8, text: "World" },
  ]);
});

test("invalid subtitles and unsupported links fail before writing", () => {
  assert.throws(() => parseSubtitles("WEBVTT\n\nNo cues", ".vtt"), /No usable/);
  assert.throws(() => parseSubtitles("[00:10] Later\n[00:05] Earlier", ".md"), /out of order/);
  assert.throws(() => buildNote({ video: "https://www.youtube.com/", title: "Title", cues: [] }), /does not recognize/);
});

test("generated note is plugin-readable and existing files are not overwritten", async () => {
  const directory = await mkdtemp(join(tmpdir(), "subtitle-lab-test-"));
  try {
    const input = join(directory, "captions.srt");
    const output = join(directory, "Today.md");
    await writeFile(input, "1\n00:00:01,000 --> 00:00:03,000\nHello.\n", "utf8");
    const args = ["--video", "https://m.youtube.com/watch?list=x&v=Tu8COtr2dEo", "--title", "Today's video", "--subtitles", input, "--output", output];
    await main(args);
    const note = await readFile(output, "utf8");
    assert.match(note, /https:\/\/www\.youtube\.com\/watch\?v=Tu8COtr2dEo/);
    assert.match(note, /\[00:01\] Hello\./);
    await assert.rejects(main(args), { code: "EEXIST" });
    assert.equal(await readFile(output, "utf8"), note);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
