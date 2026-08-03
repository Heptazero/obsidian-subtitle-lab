import type { SubtitleBlock, SubtitleDocument } from "./types";

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

	return { captions, youtubeId: findYouTubeId(content) };
}

export function findYouTubeId(content: string): string | null {
	const match = content.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
	return match?.[1] ?? null;
}

export function formatTimestamp(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = Math.floor(totalSeconds % 60);
	const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	return hours > 0 ? `${String(hours).padStart(2, "0")}:${mmss}` : mmss;
}
