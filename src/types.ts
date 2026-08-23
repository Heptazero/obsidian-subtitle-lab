export interface SubtitleBlock {
	id: string;
	timestamp: string;
	startSeconds: number;
	original: string;
	lines: string[];
	raw: string;
	startOffset: number;
	endOffset: number;
}

export interface SubtitleDocument {
	captions: SubtitleBlock[];
	video: VideoSource | null;
}

export type VideoSource =
	| { kind: "youtube"; id: string }
	| { kind: "bilibili"; idType: "bvid" | "aid" | "episodeId"; id: string; page: number }
	| { kind: "direct"; url: string }
	| { kind: "vault"; path: string };

export interface FieldStyle {
	id: string;
	name: string;
	prefix: string;
	textColor: string;
	backgroundColor: string;
}

export interface SubtitleLabSettings {
	fields: FieldStyle[];
	autoScroll: boolean;
}
