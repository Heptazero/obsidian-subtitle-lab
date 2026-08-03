# Subtitle Lab

An Obsidian plugin for studying Markdown subtitles alongside a YouTube video.

## Features

- Opens a dedicated subtitle-learning tab with a pinned YouTube player.
- Parses timestamped Markdown subtitles. A blank line or the next timestamp starts a new subtitle block.
- Follows video playback, highlights the active subtitle, and supports previous/next subtitle commands.
- Renders normal Obsidian Markdown in subtitle blocks, including emphasis, links, and formulas.
- Lets you edit the current subtitle block without resetting video playback or the subtitle scroll position.
- Supports configurable styles for annotation prefixes such as `Translation:` and `Vocabulary:`.

## Install Manually

1. Copy `main.js`, `manifest.json`, and `styles.css` into `<vault>/.obsidian/plugins/subtitle-lab/`.
2. In Obsidian, enable **Subtitle Lab** under Community plugins.
3. Open a Markdown note containing a YouTube link and timestamped subtitles, then run **Open Subtitle Learning View**.

## Subtitle Format

```md
![Video title](https://www.youtube.com/watch?v=VIDEO_ID)

[00:00] First short subtitle sentence.
Translation: 第一条简短字幕。
Vocabulary: **lock in**（进入高度专注状态）

[00:05] A second subtitle starts at the next timestamp.
```

## Development

```bash
npm install
npm run build
```

The production build is committed as `main.js` so manual installation works directly from a release or repository checkout.

## License

No license has been selected yet. All rights are reserved by default.
