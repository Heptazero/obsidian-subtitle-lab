# Subtitle Lab

An Obsidian plugin for studying Markdown subtitles alongside YouTube, Bilibili, direct-link, or vault videos.

## Features

- Opens a dedicated subtitle-learning tab with a pinned video player.
- Recognizes YouTube links, Bilibili BV/AV/bangumi links, direct media URLs, and video files in the vault.
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

## License

No license has been selected yet. All rights are reserved by default.
