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
	youtubeId: string | null;
}

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
