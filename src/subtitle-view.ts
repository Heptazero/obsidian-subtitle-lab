import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { parseSubtitleDocument, videoSourceKey } from "./parser";
import type SubtitleLabPlugin from "./main";
import type { FieldStyle, SubtitleBlock, VideoSource } from "./types";

export const SUBTITLE_LAB_VIEW = "subtitle-lab-view";

export class SubtitleLabView extends ItemView {
	private file: TFile | null = null;
	private captions: SubtitleBlock[] = [];
	private currentIndex = -1;
	private editingIndex = -1;
	private iframePlayer: HTMLIFrameElement | null = null;
	private mediaPlayer: HTMLMediaElement | null = null;
	private playerReady = false;
	private isPlaying = false;
	private videoSource: VideoSource | null = null;
	private captionsEl: HTMLElement | null = null;
	private captionEls = new Map<number, HTMLElement>();
	private playerPoll: number | null = null;

	constructor(leaf: WorkspaceLeaf, private plugin: SubtitleLabPlugin) {
		super(leaf);
	}

	getViewType(): string {
		return SUBTITLE_LAB_VIEW;
	}

	getDisplayText(): string {
		return "字幕学习";
	}

	getIcon(): string {
		return "languages";
	}

	async onOpen(): Promise<void> {
		this.registerDomEvent(window, "message", (event) => this.handlePlayerMessage(event));
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && this.file?.path === file.path && this.editingIndex < 0) void this.loadFile(file);
			})
		);
		this.playerPoll = window.setInterval(() => this.requestPlayerTime(), 750);
		this.render();
	}

	async onClose(): Promise<void> {
		if (this.playerPoll !== null) window.clearInterval(this.playerPoll);
	}

	async showForFile(file: TFile): Promise<void> {
		const isNewFile = this.file?.path !== file.path;
		this.file = file;
		this.currentIndex = -1;
		this.editingIndex = -1;
		await this.loadFile(file, isNewFile);
	}

	async loadFile(file: TFile, rebuildShell = false): Promise<void> {
		if (file.extension !== "md") return;
		const previousVideoKey = videoSourceKey(this.videoSource);
		this.file = file;
		const parsed = parseSubtitleDocument(await this.app.vault.read(file));
		this.captions = parsed.captions;
		this.videoSource = parsed.video;
		if (this.currentIndex >= this.captions.length) this.currentIndex = this.captions.length - 1;
		if (rebuildShell || previousVideoKey !== videoSourceKey(this.videoSource) || !this.captionsEl) this.render();
		else this.renderCaptions();
	}

	refresh(): void {
		if (this.captionsEl) this.renderCaptions();
		else this.render();
	}

	goRelative(direction: 1 | -1): void {
		if (this.captions.length === 0) return;
		const from = this.currentIndex < 0 ? 0 : this.currentIndex;
		this.goTo(Math.max(0, Math.min(this.captions.length - 1, from + direction)), true);
	}

	togglePlayback(): void {
		if (this.videoSource?.kind === "bilibili") {
			new Notice("哔哩哔哩外链播放器需使用视频内的播放按钮。");
			return;
		}
		if (this.mediaPlayer) {
			if (this.mediaPlayer.paused) void this.mediaPlayer.play();
			else this.mediaPlayer.pause();
			return;
		}
		if (this.videoSource?.kind === "youtube") {
			this.isPlaying = !this.isPlaying;
			this.sendYouTubeCommand(this.isPlaying ? "playVideo" : "pauseVideo");
			this.updatePlaybackButton();
		}
	}

	editCurrent(): void {
		if (this.currentIndex < 0 && this.captions.length > 0) this.currentIndex = 0;
		if (this.currentIndex >= 0) this.startEditing(this.currentIndex);
	}

	private startEditing(index: number): void {
		if (!this.captions[index]) return;
		this.currentIndex = index;
		this.editingIndex = index;
		this.renderCaptions();
		this.updateActiveCaption(false);
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("subtitle-lab");
		this.captionsEl = null;
		this.iframePlayer = null;
		this.mediaPlayer = null;
		this.playerReady = false;
		this.isPlaying = false;
		this.captionEls.clear();

		const toolbar = root.createDiv({ cls: "subtitle-lab-toolbar" });
		const title = toolbar.createDiv({ cls: "subtitle-lab-title" });
		title.createSpan({ text: this.file?.basename ?? "选择一个字幕 Markdown", cls: "subtitle-lab-file-name" });
		title.createSpan({ text: this.captions.length ? `${this.captions.length} 句` : "", cls: "subtitle-lab-count" });
		if (this.videoSource) title.createSpan({ text: this.videoSourceLabel(), cls: "subtitle-lab-source" });

		const controls = toolbar.createDiv({ cls: "subtitle-lab-controls" });
		this.createIconButton(controls, "refresh-cw", "重新读取字幕", () => this.file && void this.loadFile(this.file));
		this.createIconButton(controls, "chevron-up", "上一句", () => this.goRelative(-1));
		this.createIconButton(controls, "chevron-down", "下一句", () => this.goRelative(1));
		const playButton = this.createIconButton(controls, "play", this.playbackTooltip(), () => this.togglePlayback());
		playButton.addClass("subtitle-lab-play-button");
		playButton.disabled = !this.videoSource || this.videoSource.kind === "bilibili";
		this.createIconButton(controls, "pencil", "编辑当前字幕块", () => this.editCurrent());

		if (!this.file) {
			root.createDiv({ text: "打开一篇含时间戳的 Markdown 后，再执行“打开字幕学习视图”。", cls: "subtitle-lab-empty" });
			return;
		}

		if (this.videoSource) this.renderPlayer(root, this.videoSource);
		else root.createDiv({ text: "没有识别到支持的视频链接。字幕仍可浏览和编辑。", cls: "subtitle-lab-video-hint" });

		// Compatibility class lets reading-mode integrations (for example Lexis)
		// recognize selections in this custom view as Markdown preview content.
		this.captionsEl = root.createDiv({ cls: "subtitle-lab-captions markdown-preview-view" });
		this.renderCaptions();
	}

	private renderCaptions(): void {
		const captionsEl = this.captionsEl;
		if (!captionsEl) {
			this.render();
			return;
		}

		const scrollTop = captionsEl.scrollTop;
		captionsEl.empty();
		this.captionEls.clear();
		if (this.captions.length === 0) {
			captionsEl.createDiv({
				text: "未找到字幕块。每条字幕需以 [00:00] 开头；空行或下一条时间戳都会结束当前字幕。",
				cls: "subtitle-lab-empty",
			});
			return;
		}

		this.captions.forEach((caption, index) => this.renderCaption(captionsEl, caption, index));
		this.updateActiveCaption(false);
		captionsEl.scrollTop = scrollTop;
		window.requestAnimationFrame(() => {
			if (this.captionsEl === captionsEl) captionsEl.scrollTop = scrollTop;
		});
	}

	private renderPlayer(root: HTMLElement, source: VideoSource): void {
		const playerWrap = root.createDiv({ cls: "subtitle-lab-player-wrap" });
		if (source.kind === "youtube") {
			this.renderYouTubePlayer(playerWrap, source.id);
			return;
		}
		if (source.kind === "bilibili") {
			this.renderBilibiliPlayer(playerWrap, source, 0, false);
			return;
		}

		if (source.kind === "direct") {
			this.renderHtmlMediaPlayer(playerWrap, source.url);
			return;
		}

		const mediaUrl = this.resolveVaultMediaUrl(source.path);
		if (!mediaUrl) {
			playerWrap.remove();
			root.createDiv({ text: `找不到 vault 媒体文件：${source.path}`, cls: "subtitle-lab-video-hint" });
			return;
		}
		this.renderHtmlMediaPlayer(playerWrap, mediaUrl);
	}

	private renderYouTubePlayer(playerWrap: HTMLElement, youtubeId: string): void {
		this.iframePlayer = playerWrap.createEl("iframe", {
			cls: "subtitle-lab-player",
			attr: {
				id: "subtitle-lab-youtube-player",
				src: `https://www.youtube.com/embed/${youtubeId}?enablejsapi=1&playsinline=1&rel=0`,
				title: "YouTube 视频",
				allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
				allowfullscreen: "true",
			},
		});
		this.playerReady = false;
		this.iframePlayer.addEventListener("load", () => {
			this.playerReady = true;
			this.initializeYouTubeCommunication();
			window.setTimeout(() => this.initializeYouTubeCommunication(), 250);
		});
	}

	private renderBilibiliPlayer(
		playerWrap: HTMLElement,
		source: Extract<VideoSource, { kind: "bilibili" }>,
		startSeconds: number,
		autoplay: boolean
	): void {
		this.iframePlayer?.remove();
		const params = new URLSearchParams({
			[source.idType]: source.id,
			p: String(source.page),
			t: String(Math.max(0, Math.floor(startSeconds))),
			autoplay: autoplay ? "1" : "0",
			danmaku: "0",
		});
		this.iframePlayer = playerWrap.createEl("iframe", {
			cls: "subtitle-lab-player",
			attr: {
				src: `https://player.bilibili.com/player.html?${params.toString()}`,
				title: "哔哩哔哩视频",
				allow: "autoplay; encrypted-media; picture-in-picture",
				allowfullscreen: "true",
				scrolling: "no",
			},
		});
		this.playerReady = false;
	}

	private renderHtmlMediaPlayer(playerWrap: HTMLElement, mediaUrl: string): void {
		const media = playerWrap.createEl("video", {
			cls: "subtitle-lab-player",
			attr: { src: mediaUrl, controls: "true", preload: "metadata", playsinline: "true" },
		});
		this.mediaPlayer = media;
		this.playerReady = media.readyState >= HTMLMediaElement.HAVE_METADATA;
		media.addEventListener("loadedmetadata", () => {
			this.playerReady = true;
		});
		media.addEventListener("timeupdate", () => this.followTime(media.currentTime));
		media.addEventListener("seeked", () => this.followTime(media.currentTime));
		media.addEventListener("play", () => {
			this.isPlaying = true;
			this.updatePlaybackButton();
		});
		media.addEventListener("pause", () => {
			this.isPlaying = false;
			this.updatePlaybackButton();
		});
	}

	private resolveVaultMediaUrl(path: string): string | null {
		const mediaFile = this.app.metadataCache.getFirstLinkpathDest(path, this.file?.path ?? "");
		return mediaFile ? this.app.vault.getResourcePath(mediaFile) : null;
	}

	private playbackTooltip(): string {
		return this.videoSource?.kind === "bilibili" ? "请使用哔哩哔哩播放器控件" : "播放或暂停";
	}

	private videoSourceLabel(): string {
		if (this.videoSource?.kind === "youtube") return "YouTube";
		if (this.videoSource?.kind === "bilibili") return "哔哩哔哩·时间戳定位";
		if (this.videoSource?.kind === "vault") return "本地视频·完整同步";
		return "直链视频·完整同步";
	}

	private renderCaption(parent: HTMLElement, caption: SubtitleBlock, index: number): void {
		const card = parent.createEl("article", { cls: "subtitle-lab-caption" });
		card.dataset.index = String(index);
		this.captionEls.set(index, card);

		const primaryLine = card.createDiv({ cls: "subtitle-lab-primary-line" });
		const visibleTimestamp = caption.timestamp.slice(1, -1);
		const timeButton = primaryLine.createEl("button", { text: visibleTimestamp, cls: "subtitle-lab-time" });
		timeButton.setAttribute("aria-label", `跳到 ${visibleTimestamp}`);
		timeButton.addEventListener("click", () => this.goTo(index, true));

		if (this.editingIndex === index) {
			this.renderEditor(card, caption, index);
			return;
		}

		const originalEl = primaryLine.createDiv({ cls: "subtitle-lab-original" });
		this.renderMarkdown(originalEl, caption.original);
		this.createIconButton(primaryLine, "pencil", "编辑这个字幕块", () => this.startEditing(index), "subtitle-lab-caption-edit");
		for (const line of caption.lines) {
			const field = this.findField(line);
			const lineEl = card.createDiv({ cls: "subtitle-lab-line" });
			if (field) this.applyFieldStyle(lineEl, field);
			this.renderMarkdown(lineEl, line);
		}
	}

	private renderMarkdown(target: HTMLElement, markdown: string): void {
		void MarkdownRenderer.render(this.app, markdown, target, this.file?.path ?? "", this);
	}

	private renderEditor(card: HTMLElement, caption: SubtitleBlock, index: number): void {
		const textarea = card.createEl("textarea", { cls: "subtitle-lab-editor" });
		textarea.value = caption.raw;
		textarea.rows = Math.max(4, caption.raw.split(/\r?\n/).length + 1);
		const actions = card.createDiv({ cls: "subtitle-lab-editor-actions" });
		this.createIconButton(actions, "check", "保存字幕块", () => void this.saveEdit(index, textarea.value));
		this.createIconButton(actions, "x", "取消编辑", () => {
			this.editingIndex = -1;
			this.renderCaptions();
		});
		window.setTimeout(() => textarea.focus(), 0);
	}

	private async saveEdit(index: number, nextRaw: string): Promise<void> {
		const caption = this.captions[index];
		if (!caption || !this.file) return;
		const candidate = parseSubtitleDocument(nextRaw).captions[0];
		if (!candidate || candidate.startOffset !== 0) {
			new Notice("字幕块第一行必须保留 [00:00] 时间戳。");
			return;
		}

		const saved = await this.plugin.replaceCaptionBlock(this.file, caption, nextRaw.replace(/\s+$/, ""));
		if (!saved) {
			new Notice("原文已变化，未覆盖保存。重新读取后再编辑即可。");
			return;
		}
		this.editingIndex = -1;
		await this.loadFile(this.file);
		this.goTo(this.findCaptionByTime(candidate.startSeconds), false);
	}

	private findField(line: string): FieldStyle | undefined {
		const trimmed = line.trimStart();
		return this.plugin.settings.fields.find((field) => field.prefix.length > 0 && trimmed.startsWith(field.prefix));
	}

	private applyFieldStyle(element: HTMLElement, field: FieldStyle): void {
		element.dataset.fieldId = field.id;
		element.addClass("subtitle-lab-field");
		element.style.color = field.textColor;
		element.style.backgroundColor = field.backgroundColor;
	}

	private createIconButton(parent: HTMLElement, icon: string, tooltip: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
		const button = parent.createEl("button", { cls: `clickable-icon subtitle-lab-icon-button ${extraClass ?? ""}` });
		button.setAttribute("aria-label", tooltip);
		button.setAttribute("title", tooltip);
		setIcon(button, icon);
		button.addEventListener("click", onClick);
		return button;
	}

	private goTo(index: number, seek: boolean): void {
		if (!this.captions[index]) return;
		this.currentIndex = index;
		if (seek) {
			this.seekTo(this.captions[index].startSeconds);
		}
		this.updateActiveCaption(true);
	}

	private seekTo(seconds: number): void {
		if (this.mediaPlayer) {
			this.mediaPlayer.currentTime = seconds;
			return;
		}
		if (this.videoSource?.kind === "youtube") {
			this.sendYouTubeCommand("seekTo", [seconds, true]);
			window.setTimeout(() => this.requestPlayerTime(), 200);
			return;
		}
		if (this.videoSource?.kind === "bilibili" && this.iframePlayer?.parentElement) {
			this.renderBilibiliPlayer(this.iframePlayer.parentElement, this.videoSource, seconds, true);
		}
	}

	private updateActiveCaption(shouldScroll: boolean): void {
		for (const [index, card] of this.captionEls) card.toggleClass("is-active", index === this.currentIndex);
		const active = this.captionEls.get(this.currentIndex);
		if (active && shouldScroll && this.plugin.settings.autoScroll) {
			active.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	}

	private findCaptionByTime(time: number): number {
		return this.captions.findIndex((caption) => caption.startSeconds === time);
	}

	private requestPlayerTime(): void {
		if (this.mediaPlayer) {
			this.followTime(this.mediaPlayer.currentTime);
			return;
		}
		if (this.playerReady && this.videoSource?.kind === "youtube") this.sendYouTubeCommand("getCurrentTime");
	}

	private initializeYouTubeCommunication(): void {
		if (!this.iframePlayer?.contentWindow) return;
		this.iframePlayer.contentWindow.postMessage(
			JSON.stringify({ event: "listening", id: "subtitle-lab-youtube-player", channel: "widget" }),
			"*"
		);
		this.sendYouTubeCommand("addEventListener", ["onStateChange"]);
		this.requestPlayerTime();
	}

	private sendYouTubeCommand(func: string, args: unknown[] = []): void {
		this.iframePlayer?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
	}

	private handlePlayerMessage(event: MessageEvent): void {
		if (this.videoSource?.kind !== "youtube") return;
		if (!event.origin.includes("youtube")) return;
		if (this.iframePlayer && event.source !== this.iframePlayer.contentWindow) return;
		let data: unknown = event.data;
		if (typeof data === "string") {
			try {
				data = JSON.parse(data);
			} catch {
				return;
			}
		}
		if (!data || typeof data !== "object") return;
		const payload = data as {
			event?: string;
			info?: { currentTime?: number } | number;
			infoDelivery?: { currentTime?: number };
		};
		const currentTime =
			(typeof payload.info === "object" ? payload.info.currentTime : undefined) ?? payload.infoDelivery?.currentTime;
		if (typeof currentTime === "number") this.followTime(currentTime);
		if (payload.event === "onStateChange") {
			this.isPlaying = payload.info === 1;
			this.updatePlaybackButton();
			this.requestPlayerTime();
		}
	}

	private followTime(currentTime: number): void {
		let index = -1;
		for (let i = 0; i < this.captions.length; i++) {
			const next = this.captions[i + 1];
			if (this.captions[i].startSeconds <= currentTime && (!next || next.startSeconds > currentTime)) {
				index = i;
				break;
			}
		}
		if (index >= 0 && index !== this.currentIndex) {
			this.currentIndex = index;
			this.updateActiveCaption(true);
		}
	}

	private updatePlaybackButton(): void {
		const button = this.contentEl.querySelector<HTMLButtonElement>(".subtitle-lab-play-button");
		if (!button) return;
		button.empty();
		setIcon(button, this.isPlaying ? "pause" : "play");
		const tooltip = this.videoSource?.kind === "bilibili" ? "请使用哔哩哔哩播放器控件" : this.isPlaying ? "暂停" : "播放";
		button.setAttribute("aria-label", tooltip);
		button.setAttribute("title", tooltip);
	}
}
