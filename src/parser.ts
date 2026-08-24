import type { SubtitleBlock, SubtitleDocument, SubtitleHeading, SubtitleVideo, VideoSource } from "./types";

const TIMESTAMP = /^\s*\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]\s*(.*)$/;

export function parseSubtitleDocument(content: string): SubtitleDocument {
	const captions: SubtitleBlock[] = [];

	const parseBlock = (raw: string, startOffset: number): void => {
		const lines = raw.split(/\r?\n/);
		const firstLineIndex = lines.findIndex((line) => line.trim().length > 0);
		if (firstLineIndex < 0) return;

		const firstLine = lines[firstLineIndex];
		const timestampMatch = firstLine.match(TIMESTAMP);
		if (!timestampMatch) return;

		const [, hours = "0", minutes, seconds, original] = timestampMatch;
		const startSeconds = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
		const timestamp = firstLine.slice(0, firstLine.indexOf("]") + 1);
		const annotationLines = lines.slice(firstLineIndex + 1);
		captions.push({
			id: `${startOffset}:${timestamp}`,
			videoIndex: null,
			outline: [],
			timestamp,
			startSeconds,
			original,
			lines: annotationLines,
			raw,
			startOffset,
			endOffset: startOffset + raw.length,
		});
	};

	let blockStart = -1;
	let blockEnd = -1;
	let offset = 0;
	const lines = content.split(/\r?\n/);

	const finishBlock = (): void => {
		if (blockStart >= 0) parseBlock(content.slice(blockStart, blockEnd), blockStart);
		blockStart = -1;
		blockEnd = -1;
	};

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const lineStart = offset;
		const isTimestamp = TIMESTAMP.test(line);
		const isHeading = /^\s{0,3}#{1,6}\s+/.test(line);
		const isVideo = findVideoSource(line) !== null;

		if (isTimestamp) {
			// A new timestamp is always a new subtitle, even without a blank line.
			finishBlock();
			blockStart = lineStart;
			blockEnd = lineStart + line.length;
		} else if (blockStart >= 0) {
			if (line.trim().length === 0 || isHeading || isVideo) finishBlock();
			else blockEnd = lineStart + line.length;
		}

		if (index < lines.length - 1) {
			offset += line.length + (content.startsWith("\r\n", offset + line.length) ? 2 : 1);
		}
	}
	finishBlock();

	const videos = findVideoSources(content);
	for (const caption of captions) {
		const precedingIndex = findPrecedingVideoIndex(videos, caption.startOffset);
		caption.videoIndex = precedingIndex >= 0 ? precedingIndex : videos.length === 1 ? 0 : null;
	}
	assignCaptionOutlines(content, captions, videos);

	return { captions, videos };
}

function assignCaptionOutlines(content: string, captions: SubtitleBlock[], videos: SubtitleVideo[]): void {
	const headings = findDocumentHeadings(content);
	for (let videoIndex = 0; videoIndex < videos.length; videoIndex++) {
		const groupCaptions = captions.filter((caption) => caption.videoIndex === videoIndex);
		const groupEnd = videos[videoIndex + 1]?.startOffset ?? content.length;
		const groupHeadings = headings.filter(
			(heading) => heading.startOffset > videos[videoIndex].startOffset && heading.startOffset < groupEnd
		);
		applyHeadingPaths(groupCaptions, groupHeadings);
	}

	const unassigned = captions.filter((caption) => caption.videoIndex === null);
	if (unassigned.length > 0) {
		const firstVideoOffset = videos[0]?.startOffset ?? content.length;
		applyHeadingPaths(
			unassigned,
			headings.filter((heading) => heading.startOffset < firstVideoOffset)
		);
	}
}

function applyHeadingPaths(captions: SubtitleBlock[], headings: SubtitleHeading[]): void {
	const stack: SubtitleHeading[] = [];
	let headingIndex = 0;
	for (const caption of captions) {
		while (headingIndex < headings.length && headings[headingIndex].startOffset < caption.startOffset) {
			const heading = headings[headingIndex++];
			while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) stack.pop();
			stack.push(heading);
		}
		caption.outline = [...stack];
	}
}

function findDocumentHeadings(content: string): SubtitleHeading[] {
	const headings: SubtitleHeading[] = [];
	let offset = 0;
	const lines = content.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
		if (match) {
			headings.push({
				id: `heading-${offset}`,
				level: match[1].length,
				title: stripMarkdown(match[2]),
				startOffset: offset,
			});
		}
		if (index < lines.length - 1) {
			offset += line.length + (content.startsWith("\r\n", offset + line.length) ? 2 : 1);
		}
	}
	return headings;
}

export function findYouTubeId(content: string): string | null {
	const match = content.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
	return match?.[1] ?? null;
}

export function findVideoSource(content: string): VideoSource | null {
	const youtubeId = findYouTubeId(content);
	if (youtubeId) return { kind: "youtube", id: youtubeId };

	const bilibili = findBilibiliSource(content);
	if (bilibili) return bilibili;

	const vaultVideo = content.match(/!\[\[([^\]|#]+\.(?:mp4|webm|ogv|mov|m4v|mp3|m4a|ogg|wav|flac))(?:[|#][^\]]*)?\]\]/i);
	if (vaultVideo) return { kind: "vault", path: vaultVideo[1].trim() };
	const markdownVideo = content.match(/!?\[[^\]]*\]\((?!https?:\/\/)([^)]+\.(?:mp4|webm|ogv|mov|m4v|mp3|m4a|ogg|wav|flac))(?:[?#][^)]*)?\)/i);
	if (markdownVideo) return { kind: "vault", path: decodePath(markdownVideo[1].trim()) };

	for (const url of findHttpUrls(content)) {
		try {
			const parsed = new URL(url);
			if (/\.(?:mp4|webm|ogv|mov|m4v|mp3|m4a|ogg|wav|flac)$/i.test(parsed.pathname)) {
				return { kind: "direct", url };
			}
		} catch {
			// Ignore malformed URLs and continue looking for a playable source.
		}
	}

	return null;
}

export function findVideoSources(content: string): SubtitleVideo[] {
	const videos: SubtitleVideo[] = [];
	let offset = 0;
	let currentHeading = "";
	const lines = content.split(/\r?\n/);

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
		if (heading) currentHeading = stripMarkdown(heading[1]);

		const source = findVideoSource(line);
		if (source) {
			const title = currentHeading || findLinkLabel(line) || `视频 ${videos.length + 1}`;
			videos.push({
				id: `video-${videos.length}:${videoSourceKey(source)}`,
				title,
				source,
				startOffset: offset,
			});
		}

		if (index < lines.length - 1) {
			offset += line.length + (content.startsWith("\r\n", offset + line.length) ? 2 : 1);
		}
	}

	return videos;
}

function findPrecedingVideoIndex(videos: SubtitleVideo[], captionOffset: number): number {
	let result = -1;
	for (let index = 0; index < videos.length; index++) {
		if (videos[index].startOffset >= captionOffset) break;
		result = index;
	}
	return result;
}

function findLinkLabel(line: string): string {
	const label = line.match(/!?\[([^\]]+)\]\(/)?.[1] ?? line.match(/!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/)?.[1] ?? "";
	return stripMarkdown(label);
}

function stripMarkdown(value: string): string {
	return value.replace(/[*_`~]/g, "").trim();
}

function findBilibiliSource(content: string): VideoSource | null {
	const embedded = content.match(/player\.bilibili\.com\/player\.html\?[^\s<>"'()\]]*/i)?.[0];
	if (embedded) {
		const query = new URL(`https://${embedded.replace(/^https?:\/\//i, "")}`).searchParams;
		const bvid = query.get("bvid");
		const aid = query.get("aid");
		const episodeId = query.get("episodeId");
		const page = positivePage(query.get("p"));
		if (bvid) return { kind: "bilibili", idType: "bvid", id: bvid, page };
		if (aid) return { kind: "bilibili", idType: "aid", id: aid, page };
		if (episodeId) return { kind: "bilibili", idType: "episodeId", id: episodeId, page };
	}

	const bvid = content.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]{10})/i);
	if (bvid) return { kind: "bilibili", idType: "bvid", id: bvid[1], page: findBilibiliPage(content, bvid.index) };

	const aid = content.match(/bilibili\.com\/video\/av(\d+)/i);
	if (aid) return { kind: "bilibili", idType: "aid", id: aid[1], page: findBilibiliPage(content, aid.index) };

	const episode = content.match(/bilibili\.com\/bangumi\/play\/ep(\d+)/i);
	if (episode) return { kind: "bilibili", idType: "episodeId", id: episode[1], page: 1 };

	return null;
}

function findBilibiliPage(content: string, matchIndex = 0): number {
	const linkTail = content.slice(matchIndex, matchIndex + 300);
	return positivePage(linkTail.match(/[?&]p=(\d+)/i)?.[1] ?? null);
}

function positivePage(value: string | null): number {
	const page = Number(value);
	return Number.isInteger(page) && page > 0 ? page : 1;
}

function findHttpUrls(content: string): string[] {
	return Array.from(content.matchAll(/https?:\/\/[^\s<>"']+/g), (match) => match[0].replace(/[),.;!?\]]+$/, ""));
}

function decodePath(path: string): string {
	try {
		return decodeURIComponent(path);
	} catch {
		return path;
	}
}

export function videoSourceKey(source: VideoSource | null): string {
	if (!source) return "none";
	if (source.kind === "youtube") return `youtube:${source.id}`;
	if (source.kind === "bilibili") return `bilibili:${source.idType}:${source.id}:${source.page}`;
	if (source.kind === "direct") return `direct:${source.url}`;
	return `vault:${source.path}`;
}

export function formatTimestamp(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = Math.floor(totalSeconds % 60);
	const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	return hours > 0 ? `${String(hours).padStart(2, "0")}:${mmss}` : mmss;
}
