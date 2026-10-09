#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const HELP = `Usage:
  npm run prepare-note -- --video URL --subtitles FILE --title TITLE --output FILE.md
  npm run prepare-note -- --video URL --subtitles FILE --title TITLE --stdout

Input: .srt, .vtt, .json (Bilibili, yt-dlp JSON3, or startMs/text cues), or .md.
The command creates a new note and never overwrites an existing file.`;

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === "--help") return { help: true };
    if (key === "--stdout") {
      options.stdout = true;
      continue;
    }
    if (!["--video", "--subtitles", "--title", "--output"].includes(key)) {
      throw new Error(`Unknown option: ${key}`);
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = value;
  }
  if (!options.video || !options.subtitles || !options.title) {
    throw new Error("--video, --subtitles, and --title are required");
  }
  if (Boolean(options.output) === Boolean(options.stdout)) {
    throw new Error("Choose exactly one of --output or --stdout");
  }
  return options;
}

function validateVideoUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--video must be a supported HTTPS video URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("--video must be a supported HTTPS video URL");
  }
  const host = url.hostname.toLowerCase();
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"].includes(host)) {
    const id = host.endsWith("youtu.be") ? url.pathname.slice(1)
      : url.pathname === "/watch" ? url.searchParams.get("v")
      : url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error("The plugin does not recognize this YouTube URL");
    return `https://www.youtube.com/watch?v=${id}`;
  }
  if (["bilibili.com", "www.bilibili.com", "m.bilibili.com", "player.bilibili.com"].includes(host)) {
    const supported = /^\/video\/(?:BV[0-9A-Za-z]{10}|av\d+)\/?$/.test(url.pathname)
      || /^\/bangumi\/play\/ep\d+\/?$/.test(url.pathname)
      || host === "player.bilibili.com" && url.pathname === "/player.html";
    if (!supported) throw new Error("The plugin does not recognize this Bilibili URL");
    return url.toString();
  }
  if (!/\.(?:mp4|webm|ogv|mov|m4v|mp3|m4a|ogg|wav|flac)$/i.test(url.pathname)) {
    throw new Error("The plugin does not recognize this video URL");
  }
  return url.toString();
}

function secondsFromTimestamp(value) {
  const parts = value.replace(",", ".").split(":");
  if (parts.length < 2 || parts.length > 3) throw new Error(`Invalid timestamp: ${value}`);
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![hours, minutes, seconds].every(Number.isFinite) || minutes >= 60 && hours > 0 || seconds >= 60) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function cleanText(value) {
  return String(value)
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (entity) => ({
      "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " ",
    })[entity.toLowerCase()])
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimedText(content) {
  const blocks = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim());
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) continue;
    const match = lines[timeIndex].match(/^(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->/);
    if (!match) throw new Error(`Invalid cue timing: ${lines[timeIndex]}`);
    const text = cleanText(lines.slice(timeIndex + 1).join(" "));
    if (text) cues.push({ start: secondsFromTimestamp(match[0].split("-->")[0].trim()), text });
  }
  return cues;
}

function parseJson(content) {
  const value = JSON.parse(content);
  let entries;
  if (Array.isArray(value)) entries = value;
  else if (Array.isArray(value.body)) entries = value.body;
  else if (Array.isArray(value.events)) entries = value.events;
  else if (Array.isArray(value.cues)) entries = value.cues;
  else throw new Error("Unsupported JSON subtitle structure");
  return entries.map((entry) => {
    const start = entry.startMs !== undefined ? Number(entry.startMs) / 1000
      : entry.tStartMs !== undefined ? Number(entry.tStartMs) / 1000
      : Number(entry.from ?? entry.startSeconds);
    const text = cleanText(entry.text ?? entry.content ?? entry.segs?.map((segment) => segment.utf8).join(" ") ?? "");
    return { start, text };
  }).filter((cue) => cue.text);
}

function parseMarkdown(content) {
  const cues = [];
  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.match(/^\s*\[((?:\d{1,2}:)?\d{1,2}:\d{2})\]\s*(.*)$/);
    if (match) cues.push({ start: secondsFromTimestamp(match[1]), text: cleanText(match[2]) });
  }
  return cues.filter((cue) => cue.text);
}

export function parseSubtitles(content, extension) {
  const kind = extension.toLowerCase();
  let cues;
  if (kind === ".srt" || kind === ".vtt") cues = parseTimedText(content);
  else if (kind === ".json") cues = parseJson(content);
  else if (kind === ".md") cues = parseMarkdown(content);
  else throw new Error(`Unsupported subtitle file: ${extension}`);
  if (!cues.length) throw new Error("No usable subtitle cues found");
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index];
    if (!Number.isFinite(cue.start) || cue.start < 0) throw new Error(`Invalid cue time at ${index + 1}`);
    if (index > 0 && cue.start < cues[index - 1].start) throw new Error("Subtitle cues are out of order");
  }
  return cues;
}

function formatTime(seconds) {
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor(rounded % 3600 / 60);
  const tail = String(rounded % 60).padStart(2, "0");
  return hours ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${tail}`
    : `${String(minutes).padStart(2, "0")}:${tail}`;
}

export function buildNote({ video, title, cues }) {
  const safeTitle = title.replace(/[\r\n]+/g, " ").trim();
  if (!safeTitle) throw new Error("--title cannot be empty");
  const videoUrl = validateVideoUrl(video);
  const lines = [`## ${safeTitle}`, videoUrl, "", "### 字幕", ""];
  for (const cue of cues) lines.push(`[${formatTime(cue.start)}] ${cue.text}`, "");
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const subtitlePath = resolve(options.subtitles);
  const content = await readFile(subtitlePath, "utf8");
  const cues = parseSubtitles(content, extname(subtitlePath));
  const note = buildNote({ video: options.video, title: options.title, cues });
  if (options.stdout) {
    process.stdout.write(note);
    return;
  }
  const outputPath = resolve(options.output);
  if (extname(outputPath).toLowerCase() !== ".md") throw new Error("--output must end in .md");
  await writeFile(outputPath, note, { flag: "wx" });
  process.stdout.write(`Created ${basename(outputPath)} with ${cues.length} captions\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
