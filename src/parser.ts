import type { SubtitleBlock, SubtitleDocument, VideoSource } from "./types";

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

		if (isTimestamp) {
			// A new timestamp is always a new subtitle, even without a blank line.
			finishBlock();
			blockStart = lineStart;
			blockEnd = lineStart + line.length;
		} else if (blockStart >= 0) {
			if (line.trim().length === 0) finishBlock();
			else blockEnd = lineStart + line.length;
		}

		if (index < lines.length - 1) {
			offset += line.length + (content.startsWith("\r\n", offset + line.length) ? 2 : 1);
		}
	}
	finishBlock();

	return { captions, video: findVideoSource(content) };
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
