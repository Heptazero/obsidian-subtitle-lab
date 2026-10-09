# Subtitle Lab

An Obsidian plugin for studying Markdown subtitles alongside YouTube, Bilibili, direct-link, or vault videos.

## Features

- Opens a dedicated subtitle-learning tab with a pinned video player.
- Recognizes YouTube links, Bilibili BV/AV/bangumi links, direct media URLs, and video files in the vault.
- Supports multiple videos in one note with a single active player, a full-note outline navigator, and collapsible subtitle groups.
- Builds collapsible subtitle outlines from Markdown headings that contain timestamped captions.
- Keeps the current outline heading pinned above the scrolling captions; the pinned heading remains the section's collapse control.
- Lets users pause or resume subtitle-following independently of video playback and locate the current caption on demand.
- Saves a custom toolbar order after a press-and-hold drag.
- Parses timestamped Markdown subtitles. A blank line or the next timestamp starts a new subtitle block.
- Follows playback for YouTube and HTML5 media, highlights the active subtitle, and supports previous/next subtitle commands.
- Uses Bilibili's official external player and its `t` parameter for timestamp jumps.
- Renders normal Obsidian Markdown in subtitle blocks, including emphasis, links, and formulas.
- Lets you edit the current subtitle block without resetting video playback or the subtitle scroll position.
- Supports configurable styles for annotation prefixes such as `Translation:` and `Vocabulary:`.

## Install Manually

1. Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/subtitle-lab/`.
2. In Obsidian, enable **Subtitle Lab** under Community plugins.
3. Open a Markdown note containing a supported video link and timestamped subtitles, then run **Open Subtitle Learning View**.

## Subtitle Format

```md
![Video title](https://www.youtube.com/watch?v=VIDEO_ID)

[00:00] First short subtitle sentence.
Translation: 第一条简短字幕。
Vocabulary: **lock in**（进入高度专注状态）

[00:05] A second subtitle starts at the next timestamp.
```

The video line can also use a full Bilibili URL:

```md
https://www.bilibili.com/video/BV1B7411m7LV?p=1
```

Or an HTML5-compatible direct/vault video:

```md
https://cdn.example.com/lesson.mp4

![[assets/lesson.webm]]
```

### Multiple Videos in One Note

Each recognized video link starts a new subtitle group. Every following timestamp belongs to that video until the next video link. A heading immediately above the link becomes the group title.

```md
### Interview
https://youtu.be/VIDEO_ID_1

[00:00] First video's opening line.
[00:06] Another line from the first video.

### Follow-up clip
https://www.bilibili.com/video/BV1B7411m7LV

[00:00] The second video may restart from zero.
[00:04] Clicking this line switches the active player and seeks here.
```

Headings organize and name groups, but only a recognized video link starts a new group. If a note contains one video, timestamps before its link remain associated with that video for compatibility. In a multi-video note, timestamps before the first link appear under **Unassigned video**.

### Subtitle Outlines

Headings after a video link organize its following captions. Only heading branches that contain recognized timestamps appear in the learning view. A lone wrapper such as `### Transcript` is omitted, while its meaningful child sections remain collapsible.

```md
## Video title
https://youtu.be/VIDEO_ID

### Transcript
[00:00] Opening caption.

#### Main idea
[00:20] This section appears as a collapsible outline item.

## Key points
[02:10] A second timestamped section also appears in the outline.
```

The outline button opens a compact navigator for every video and timestamped heading in the note. Selecting an item switches videos when needed and seeks to that section's first caption.

### Follow Controls and Commands

The toolbar has separate controls for automatic subtitle following and one-time location. Turning following off leaves the video playing without moving the selected caption or subtitle scroll position. **Locate current caption** synchronizes once without enabling automatic following.

The Obsidian command palette includes commands to enable, disable, or toggle subtitle following; locate the current caption; and open or close the subtitle outline. Toolbar action buttons can be reordered by holding one briefly and dragging it; the order is saved in plugin data.

## Compatibility

| Source | Embed | Timestamp jump | Play/pause command | Live subtitle follow |
| --- | --- | --- | --- | --- |
| YouTube | Yes | Yes | Yes | Yes |
| Bilibili | Yes | Yes, by reloading at `t` | Use player controls | No |
| Direct media URL | Yes | Yes | Yes | Yes |
| Vault video | Yes | Yes | Yes | Yes |

Bilibili's documented external-player interface supports an initial `t` value but does not expose a public JavaScript API for reading playback time. A Bilibili page link therefore supports embedding and timestamp jumps, but not live subtitle following. Short `b23.tv` links are not resolved; use the full Bilibili URL.

## Development

```bash
npm install
npm run build
```

The production build is committed as `main.js` so manual installation works directly from a release or repository checkout.

## Prepare a note from the command line

An agent can create a plugin-ready note without running Obsidian. Node.js is the only requirement for this command; provide a subtitle file acquired separately from the same video. Supported inputs are SRT, VTT, Bilibili subtitle JSON (`body`), YouTube JSON3 (`events`), `startMs`/`text` JSON cues, and timestamped Markdown. No video or audio is downloaded by this command.

```bash
npm run prepare-note -- \
  --video 'https://www.youtube.com/watch?v=Tu8COtr2dEo' \
  --subtitles /path/to/captions.vtt \
  --title 'This Setup Helps me LOCK IN' \
  --output '/path/to/vault/60_english/material/vedio/This Setup Helps me LOCK IN.md'
```

Use `--stdout` instead of `--output` to preview the Markdown or pipe it to another tool. The output directory must exist. The command refuses to overwrite an existing file; the agent should inspect and edit an existing note explicitly instead of regenerating it. Subtitle fetching and transcription are deliberately separate so the agent can verify that the transcript belongs to the requested video before writing it. The generated note is a starting point for translation or annotations, not an AI-generated interpretation.

The manifest permits installation on mobile starting with 0.5.1. Mobile playback, scrolling, and background audio still require a real-device check. Bilibili's embedded player does not expose live playback time to this plugin, so its captions do not auto-follow on desktop or mobile.

## License

No license has been selected yet. All rights are reserved by default.
