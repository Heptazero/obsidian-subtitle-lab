import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { parseSubtitleDocument, videoSourceKey } from "./parser";
import type SubtitleLabPlugin from "./main";
import { attachToolbarReorder, type ToolbarAction } from "./toolbar";
import type { FieldStyle, SubtitleBlock, SubtitleHeading, SubtitleVideo, VideoSource } from "./types";

export const SUBTITLE_LAB_VIEW = "subtitle-lab-view";

interface CaptionOutlineNode {
	heading: SubtitleHeading | null;
	captionIndices: number[];
	children: CaptionOutlineNode[];
}

export class SubtitleLabView extends ItemView {
	private file: TFile | null = null;
	private captions: SubtitleBlock[] = [];
	private videos: SubtitleVideo[] = [];
	private activeVideoIndex = -1;
	private currentIndex = -1;
	private editingIndex = -1;
	private iframePlayer: HTMLIFrameElement | null = null;
	private mediaPlayer: HTMLMediaElement | null = null;
	private playerReady = false;
	private isPlaying = false;
	private followPlayback = true;
	private pendingLocateCurrentCaption = false;
	private playerHostEl: HTMLElement | null = null;
	private sourceLabelEl: HTMLElement | null = null;
	private outlineButtonEl: HTMLButtonElement | null = null;
	private outlinePanelEl: HTMLElement | null = null;
	private outlinePanelOpen = false;
	private captionsEl: HTMLElement | null = null;
	private captionEls = new Map<number, HTMLElement>();
	private videoGroupEls = new Map<number, HTMLDetailsElement>();
	private outlineOpenState = new Map<string, boolean>();
	private playerPoll: number | null = null;
	private toolbarReorderCleanup: (() => void) | null = null;

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
		this.followPlayback = this.plugin.settings.followPlayback;
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
		this.toolbarReorderCleanup?.();
	}

	async showForFile(file: TFile): Promise<void> {
		const isNewFile = this.file?.path !== file.path;
		this.file = file;
		this.currentIndex = -1;
		this.editingIndex = -1;
		if (isNewFile) {
			this.activeVideoIndex = -1;
			this.outlinePanelOpen = false;
		}
		await this.loadFile(file, isNewFile);
	}

	async loadFile(file: TFile, rebuildShell = false): Promise<void> {
		if (file.extension !== "md") return;
		const previousVideoKey = this.activeVideoKey();
		const previousVideoStructure = this.videoStructureKey();
		this.file = file;
		const parsed = parseSubtitleDocument(await this.app.vault.read(file));
		this.captions = parsed.captions;
		this.videos = parsed.videos;
		if (this.videos.length === 0) this.activeVideoIndex = -1;
		else if (this.activeVideoIndex < 0 || this.activeVideoIndex >= this.videos.length) this.activeVideoIndex = 0;
		if (this.currentIndex >= this.captions.length) this.currentIndex = this.captions.length - 1;
		if (
			rebuildShell ||
			previousVideoKey !== this.activeVideoKey() ||
			previousVideoStructure !== this.videoStructureKey() ||
			!this.captionsEl
		)
			this.render();
		else this.renderCaptions();
	}

	private activeVideo(): SubtitleVideo | null {
		return this.videos[this.activeVideoIndex] ?? null;
	}

	private activeVideoKey(): string {
		const video = this.activeVideo();
		return video ? `${this.activeVideoIndex}:${videoSourceKey(video.source)}` : "none";
	}

	private videoStructureKey(): string {
		return this.videos.map((video) => `${video.title}:${videoSourceKey(video.source)}`).join("\n");
	}

	refresh(): void {
		this.followPlayback = this.plugin.settings.followPlayback;
		this.updateFollowButton();
		if (this.captionsEl) this.renderCaptions();
		else this.render();
	}

	goRelative(direction: 1 | -1): void {
		if (this.captions.length === 0) return;
		if (this.currentIndex < 0) {
			const activeCaptions = this.captionIndicesForVideo(this.activeVideoIndex);
			const initial = direction > 0 ? activeCaptions[0] : activeCaptions[activeCaptions.length - 1];
			if (initial !== undefined) this.goTo(initial, true);
			return;
		}
		this.goTo(Math.max(0, Math.min(this.captions.length - 1, this.currentIndex + direction)), true);
	}

	togglePlayback(): void {
		const source = this.activeVideo()?.source;
		if (source?.kind === "bilibili") {
			new Notice("哔哩哔哩外链播放器需使用视频内的播放按钮。");
			return;
		}
		if (this.mediaPlayer) {
			if (this.mediaPlayer.paused) void this.mediaPlayer.play();
			else this.mediaPlayer.pause();
			return;
		}
		if (source?.kind === "youtube") {
			this.isPlaying = !this.isPlaying;
			this.sendYouTubeCommand(this.isPlaying ? "playVideo" : "pauseVideo");
			this.updatePlaybackButton();
		}
	}

	setFollowPlayback(enabled: boolean): void {
		if (enabled && this.activeVideo()?.source.kind === "bilibili") {
			new Notice("哔哩哔哩外链播放器无法读取当前播放时间。自动跟随不可用。");
			return;
		}
		this.followPlayback = enabled;
		this.plugin.settings.followPlayback = enabled;
		void this.plugin.saveSettings();
		this.updateFollowButton();
		if (enabled) this.locateCurrentCaption();
	}

	toggleFollowPlayback(): void {
		this.setFollowPlayback(!this.followPlayback);
	}

	locateCurrentCaption(): void {
		if (this.mediaPlayer) {
			this.followTime(this.mediaPlayer.currentTime, true);
			return;
		}
		const source = this.activeVideo()?.source;
		if (source?.kind === "youtube") {
			if (!this.playerReady) {
				new Notice("播放器尚未就绪。");
				return;
			}
			this.pendingLocateCurrentCaption = true;
			this.requestPlayerTime();
			return;
		}
		if (source?.kind === "bilibili") {
			new Notice("哔哩哔哩外链播放器无法读取当前播放时间。");
			return;
		}
		new Notice("当前笔记没有可读取播放时间的视频。");
	}

	toggleOutlineNavigator(): void {
		if (!this.outlinePanelEl) return;
		this.outlinePanelOpen = !this.outlinePanelOpen;
		this.outlinePanelEl.hidden = !this.outlinePanelOpen;
		if (this.outlinePanelOpen) this.renderOutlineNavigator();
		this.updateOutlineButton();
	}

	editCurrent(): void {
		if (this.currentIndex < 0) this.currentIndex = this.captionIndicesForVideo(this.activeVideoIndex)[0] ?? -1;
		if (this.currentIndex >= 0) this.startEditing(this.currentIndex);
	}

	private startEditing(index: number): void {
		const caption = this.captions[index];
		if (!caption) return;
		if (caption.videoIndex !== null && caption.videoIndex !== this.activeVideoIndex) this.switchVideo(caption.videoIndex);
		this.currentIndex = index;
		this.editingIndex = index;
		this.renderCaptions();
		this.updateActiveCaption(false);
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("subtitle-lab");
		this.toolbarReorderCleanup?.();
		this.toolbarReorderCleanup = null;
		this.playerHostEl = null;
		this.sourceLabelEl = null;
		this.outlineButtonEl = null;
		this.outlinePanelEl = null;
		this.captionsEl = null;
		this.iframePlayer = null;
		this.mediaPlayer = null;
		this.playerReady = false;
		this.isPlaying = false;
		this.captionEls.clear();
		this.videoGroupEls.clear();

		const toolbar = root.createDiv({ cls: "subtitle-lab-toolbar" });
		const title = toolbar.createDiv({ cls: "subtitle-lab-title" });
		title.createSpan({ text: this.file?.basename ?? "选择一个字幕 Markdown", cls: "subtitle-lab-file-name" });
		title.createSpan({ text: this.captions.length ? `${this.captions.length} 句` : "", cls: "subtitle-lab-count" });
		this.sourceLabelEl = title.createSpan({ text: this.videoSourceLabel(), cls: "subtitle-lab-source" });

		const controls = toolbar.createDiv({ cls: "subtitle-lab-controls" });
		this.plugin.settings.toolbarOrder.forEach((action) => this.renderToolbarAction(controls, action));
		this.toolbarReorderCleanup = attachToolbarReorder(controls, (order) => {
			this.plugin.settings.toolbarOrder = order;
			void this.plugin.saveSettings();
		});

		if (!this.file) {
			root.createDiv({ text: "打开一篇含时间戳的 Markdown 后，再执行“打开字幕学习视图”。", cls: "subtitle-lab-empty" });
			return;
		}

		this.outlinePanelEl = root.createDiv({ cls: "subtitle-lab-outline-navigator" });
		this.outlinePanelEl.hidden = !this.outlinePanelOpen;
		if (this.outlinePanelOpen) this.renderOutlineNavigator();

		this.playerHostEl = root.createDiv({ cls: "subtitle-lab-player-host" });
		this.renderActivePlayer();

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
		this.videoGroupEls.clear();
		if (this.captions.length === 0) {
			captionsEl.createDiv({
				text: "未找到字幕块。每条字幕需以 [00:00] 开头；空行或下一条时间戳都会结束当前字幕。",
				cls: "subtitle-lab-empty",
			});
			return;
		}

		if (this.videos.length <= 1) {
			this.renderCaptionOutline(
				captionsEl,
				this.captions.map((_, index) => index),
				this.activeVideoIndex
			);
		} else {
			this.renderCaptionGroups(captionsEl);
		}
		this.updateActiveCaption(false);
		captionsEl.scrollTop = scrollTop;
		window.requestAnimationFrame(() => {
			if (this.captionsEl === captionsEl) captionsEl.scrollTop = scrollTop;
		});
	}

	private renderToolbarAction(parent: HTMLElement, action: ToolbarAction): void {
		let button: HTMLButtonElement;
		if (action === "outline") {
			button = this.createIconButton(parent, "list-tree", "打开字幕大纲", () => this.toggleOutlineNavigator());
			button.addClass("subtitle-lab-outline-button");
			button.disabled = this.captions.length === 0;
			this.outlineButtonEl = button;
		} else if (action === "follow") {
			button = this.createIconButton(parent, "captions", "切换字幕跟随视频", () => this.toggleFollowPlayback());
			button.addClass("subtitle-lab-follow-button");
		} else if (action === "locate") {
			button = this.createIconButton(parent, "locate-fixed", "定位到视频当前字幕", () => this.locateCurrentCaption());
			button.addClass("subtitle-lab-locate-button");
		} else if (action === "previous") {
			button = this.createIconButton(parent, "chevron-up", "上一句", () => this.goRelative(-1));
		} else if (action === "next") {
			button = this.createIconButton(parent, "chevron-down", "下一句", () => this.goRelative(1));
		} else if (action === "playback") {
			button = this.createIconButton(parent, "play", this.playbackTooltip(), () => this.togglePlayback());
			button.addClass("subtitle-lab-play-button");
		} else if (action === "edit") {
			button = this.createIconButton(parent, "pencil", "编辑当前字幕块", () => this.editCurrent());
		} else {
			button = this.createIconButton(parent, "refresh-cw", "重新读取字幕", () => this.file && void this.loadFile(this.file));
		}
		button.addClass("subtitle-lab-toolbar-action");
		button.dataset.action = action;
		if (action === "follow") this.updateFollowButton();
		if (action === "outline") this.updateOutlineButton();
	}

	private renderCaptionGroups(parent: HTMLElement): void {
		this.videos.forEach((video, videoIndex) => {
			const indices = this.captionIndicesForVideo(videoIndex);
			this.renderCaptionGroup(parent, videoIndex, video.title, indices);
		});

		const unassigned = this.captionIndicesForVideo(null);
		if (unassigned.length > 0) this.renderCaptionGroup(parent, -1, "未关联视频", unassigned);
	}

	private renderOutlineNavigator(): void {
		const panel = this.outlinePanelEl;
		if (!panel) return;
		panel.empty();
		this.videos.forEach((video, videoIndex) => {
			const indices = this.captionIndicesForVideo(videoIndex);
			this.renderOutlineNavigatorGroup(panel, videoIndex, video.title, indices);
		});
		const unassigned = this.captionIndicesForVideo(null);
		if (unassigned.length > 0) this.renderOutlineNavigatorGroup(panel, -1, "未关联视频", unassigned);
	}

	private renderOutlineNavigatorGroup(
		parent: HTMLElement,
		videoIndex: number,
		title: string,
		indices: number[]
	): void {
		const group = parent.createDiv({ cls: "subtitle-lab-outline-nav-group" });
		const videoButton = group.createEl("button", { text: title, cls: "subtitle-lab-outline-nav-video" });
		videoButton.toggleClass("is-current", videoIndex === this.activeVideoIndex);
		videoButton.addEventListener("click", () => {
			const firstCaption = indices[0];
			if (firstCaption !== undefined) this.navigateFromOutline(firstCaption);
			else if (videoIndex >= 0) {
				this.switchVideo(videoIndex);
				this.closeOutlineNavigator();
			}
		});

		const root = this.buildCaptionOutline(indices);
		const visibleRoot = root.captionIndices.length === 0 && root.children.length === 1 ? root.children[0] : root;
		visibleRoot.children.forEach((node) => this.renderOutlineNavigatorNode(group, node, 0));
	}

	private renderOutlineNavigatorNode(parent: HTMLElement, node: CaptionOutlineNode, depth: number): void {
		const heading = node.heading;
		if (!heading) return;
		const firstCaption = this.firstOutlineCaptionIndex(node);
		if (firstCaption === null) return;
		const button = parent.createEl("button", { text: heading.title, cls: "subtitle-lab-outline-nav-item" });
		button.style.paddingLeft = `${22 + depth * 16}px`;
		button.toggleClass(
			"is-current",
			this.captions[this.currentIndex]?.outline.some((item) => item.id === heading.id) ?? false
		);
		button.addEventListener("click", () => this.navigateFromOutline(firstCaption));
		node.children.forEach((child) => this.renderOutlineNavigatorNode(parent, child, depth + 1));
	}

	private firstOutlineCaptionIndex(node: CaptionOutlineNode): number | null {
		if (node.captionIndices.length > 0) return node.captionIndices[0];
		for (const child of node.children) {
			const index = this.firstOutlineCaptionIndex(child);
			if (index !== null) return index;
		}
		return null;
	}

	private navigateFromOutline(captionIndex: number): void {
		this.closeOutlineNavigator();
		this.goTo(captionIndex, true);
	}

	private closeOutlineNavigator(): void {
		this.outlinePanelOpen = false;
		if (this.outlinePanelEl) this.outlinePanelEl.hidden = true;
		this.updateOutlineButton();
	}

	private renderCaptionGroup(parent: HTMLElement, videoIndex: number, title: string, indices: number[]): void {
		const details = parent.createEl("details", { cls: "subtitle-lab-video-group" });
		details.open = videoIndex === this.activeVideoIndex;
		details.toggleClass("is-active", videoIndex === this.activeVideoIndex);
		this.videoGroupEls.set(videoIndex, details);

		const summary = details.createEl("summary", { cls: "subtitle-lab-video-group-summary" });
		summary.createSpan({ text: title, cls: "subtitle-lab-video-group-title" });
		summary.createSpan({ text: `${indices.length} 句`, cls: "subtitle-lab-video-group-count" });
		if (videoIndex >= 0) {
			summary.addEventListener("click", (event) => {
				if (videoIndex !== this.activeVideoIndex) {
					event.preventDefault();
					this.switchVideo(videoIndex);
					details.open = true;
				}
			});
		}

		const body = details.createDiv({ cls: "subtitle-lab-video-group-body" });
		if (indices.length === 0) body.createDiv({ text: "该视频下没有时间戳字幕。", cls: "subtitle-lab-empty is-compact" });
		else this.renderCaptionOutline(body, indices, videoIndex);
	}

	private captionIndicesForVideo(videoIndex: number | null): number[] {
		const indices: number[] = [];
		this.captions.forEach((caption, index) => {
			if (caption.videoIndex === videoIndex) indices.push(index);
		});
		return indices;
	}

	private renderCaptionOutline(parent: HTMLElement, indices: number[], videoIndex: number): void {
		const root = this.buildCaptionOutline(indices);
		if (root.captionIndices.length === 0 && root.children.length === 1) {
			// A lone container such as "字幕" adds no useful folding level.
			this.renderOutlineContents(parent, root.children[0], videoIndex, 0);
			return;
		}
		this.renderOutlineContents(parent, root, videoIndex, 0);
	}

	private buildCaptionOutline(indices: number[]): CaptionOutlineNode {
		const root: CaptionOutlineNode = { heading: null, captionIndices: [], children: [] };
		for (const captionIndex of indices) {
			const caption = this.captions[captionIndex];
			let node = root;
			for (const heading of caption.outline) {
				let child = node.children.find((candidate) => candidate.heading?.id === heading.id);
				if (!child) {
					child = { heading, captionIndices: [], children: [] };
					node.children.push(child);
				}
				node = child;
			}
			node.captionIndices.push(captionIndex);
		}
		return root;
	}

	private renderOutlineContents(parent: HTMLElement, node: CaptionOutlineNode, videoIndex: number, depth: number): void {
		node.captionIndices.forEach((captionIndex) => this.renderCaption(parent, this.captions[captionIndex], captionIndex));
		node.children.forEach((child) => this.renderOutlineSection(parent, child, videoIndex, depth));
	}

	private renderOutlineSection(parent: HTMLElement, node: CaptionOutlineNode, videoIndex: number, depth: number): void {
		const heading = node.heading;
		if (!heading) return;
		const details = parent.createEl("details", { cls: "subtitle-lab-outline-section" });
		const stateKey = `${this.file?.path ?? ""}:${videoIndex}:${heading.id}`;
		details.open = this.outlineOpenState.get(stateKey) ?? true;
		details.addEventListener("toggle", () => this.outlineOpenState.set(stateKey, details.open));

		const summary = details.createEl("summary", { cls: "subtitle-lab-outline-summary" });
		summary.style.setProperty("--subtitle-lab-outline-top", `${depth * 34}px`);
		summary.createSpan({ text: heading.title, cls: "subtitle-lab-outline-title" });
		summary.createSpan({ text: `${this.countOutlineCaptions(node)} 句`, cls: "subtitle-lab-outline-count" });
		const body = details.createDiv({ cls: "subtitle-lab-outline-body" });
		this.renderOutlineContents(body, node, videoIndex, depth + 1);
	}

	private countOutlineCaptions(node: CaptionOutlineNode): number {
		return node.captionIndices.length + node.children.reduce((total, child) => total + this.countOutlineCaptions(child), 0);
	}

	private switchVideo(videoIndex: number, startSeconds = 0, autoplay = false): void {
		if (!this.videos[videoIndex]) return;
		const changed = videoIndex !== this.activeVideoIndex;
		this.activeVideoIndex = videoIndex;
		this.pendingLocateCurrentCaption = false;
		if (changed) {
			this.currentIndex = -1;
			this.updateActiveCaption(false);
		}
		this.renderActivePlayer(startSeconds, autoplay);
		this.updateVideoControls();
		const group = this.videoGroupEls.get(videoIndex);
		if (group) group.open = true;
	}

	private renderActivePlayer(startSeconds = 0, autoplay = false): void {
		const host = this.playerHostEl;
		if (!host) return;
		this.mediaPlayer?.pause();
		host.empty();
		this.iframePlayer = null;
		this.mediaPlayer = null;
		this.playerReady = false;
		this.isPlaying = false;
		this.pendingLocateCurrentCaption = false;

		const video = this.activeVideo();
		if (video) this.renderPlayer(host, video.source, startSeconds, autoplay);
		else host.createDiv({ text: "没有识别到支持的视频链接。字幕仍可浏览和编辑。", cls: "subtitle-lab-video-hint" });
		this.updatePlaybackButton();
	}

	private updateVideoControls(): void {
		if (this.sourceLabelEl) this.sourceLabelEl.setText(this.videoSourceLabel());
		for (const [videoIndex, group] of this.videoGroupEls) group.toggleClass("is-active", videoIndex === this.activeVideoIndex);
		const playButton = this.contentEl.querySelector<HTMLButtonElement>(".subtitle-lab-play-button");
		const followSupported = this.supportsLiveFollow();
		const followButton = this.contentEl.querySelector<HTMLButtonElement>(".subtitle-lab-follow-button");
		const locateButton = this.contentEl.querySelector<HTMLButtonElement>(".subtitle-lab-locate-button");
		playButton?.toggleClass("is-unavailable", !this.activeVideo() || this.activeVideo()?.source.kind === "bilibili");
		followButton?.toggleClass("is-unavailable", !followSupported);
		locateButton?.toggleClass("is-unavailable", !followSupported);
		this.updatePlaybackButton();
		this.updateFollowButton();
		if (this.outlinePanelOpen) this.renderOutlineNavigator();
	}

	private supportsLiveFollow(): boolean {
		const source = this.activeVideo()?.source;
		return !!source && source.kind !== "bilibili";
	}

	private updateFollowButton(): void {
		const button = this.contentEl.querySelector<HTMLButtonElement>(".subtitle-lab-follow-button");
		if (!button) return;
		const supported = this.supportsLiveFollow();
		button.toggleClass("is-unavailable", !supported);
		button.toggleClass("is-active", supported && this.followPlayback);
		button.setAttribute("aria-pressed", String(supported && this.followPlayback));
		const tooltip = !supported
			? "当前视频不支持字幕自动跟随"
			: this.followPlayback
				? "关闭字幕跟随视频"
				: "开启字幕跟随视频";
		button.setAttribute("aria-label", tooltip);
		button.setAttribute("title", tooltip);
	}

	private updateOutlineButton(): void {
		const button = this.outlineButtonEl;
		if (!button) return;
		button.toggleClass("is-active", this.outlinePanelOpen);
		button.setAttribute("aria-expanded", String(this.outlinePanelOpen));
		const tooltip = this.outlinePanelOpen ? "关闭字幕大纲" : "打开字幕大纲";
		button.setAttribute("aria-label", tooltip);
		button.setAttribute("title", tooltip);
	}

	private renderPlayer(root: HTMLElement, source: VideoSource, startSeconds = 0, autoplay = false): void {
		const playerWrap = root.createDiv({ cls: "subtitle-lab-player-wrap" });
		if (source.kind === "youtube") {
			this.renderYouTubePlayer(playerWrap, source.id, startSeconds, autoplay);
			return;
		}
		if (source.kind === "bilibili") {
			this.renderBilibiliPlayer(playerWrap, source, startSeconds, autoplay);
			return;
		}

		if (source.kind === "direct") {
			this.renderHtmlMediaPlayer(playerWrap, source.url, startSeconds, autoplay);
			return;
		}

		const mediaUrl = this.resolveVaultMediaUrl(source.path);
		if (!mediaUrl) {
			playerWrap.remove();
			root.createDiv({ text: `找不到 vault 媒体文件：${source.path}`, cls: "subtitle-lab-video-hint" });
			return;
		}
		this.renderHtmlMediaPlayer(playerWrap, mediaUrl, startSeconds, autoplay);
	}

	private renderYouTubePlayer(playerWrap: HTMLElement, youtubeId: string, startSeconds: number, autoplay: boolean): void {
		const params = new URLSearchParams({
			enablejsapi: "1",
			playsinline: "1",
			rel: "0",
			start: String(Math.max(0, Math.floor(startSeconds))),
			autoplay: autoplay ? "1" : "0",
		});
		this.iframePlayer = playerWrap.createEl("iframe", {
			cls: "subtitle-lab-player",
			attr: {
				id: "subtitle-lab-youtube-player",
				src: `https://www.youtube.com/embed/${youtubeId}?${params.toString()}`,
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

	private renderHtmlMediaPlayer(playerWrap: HTMLElement, mediaUrl: string, startSeconds: number, autoplay: boolean): void {
		const media = playerWrap.createEl("video", {
			cls: "subtitle-lab-player",
			attr: { src: mediaUrl, controls: "true", preload: "metadata", playsinline: "true" },
		});
		this.mediaPlayer = media;
		this.playerReady = media.readyState >= HTMLMediaElement.HAVE_METADATA;
		media.addEventListener("loadedmetadata", () => {
			this.playerReady = true;
			if (startSeconds > 0) media.currentTime = startSeconds;
			if (autoplay) void media.play();
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
		return this.activeVideo()?.source.kind === "bilibili" ? "请使用哔哩哔哩播放器控件" : "播放或暂停";
	}

	private videoSourceLabel(): string {
		const source = this.activeVideo()?.source;
		if (!source) return "";
		if (source.kind === "youtube") return "YouTube";
		if (source.kind === "bilibili") return "哔哩哔哩·时间戳定位";
		if (source.kind === "vault") return "本地视频·完整同步";
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
		const originalOffset = caption.startOffset;
		const originalVideoIndex = caption.videoIndex;
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
		const refreshedIndex = this.captions.findIndex(
			(item) => item.startOffset === originalOffset && item.videoIndex === originalVideoIndex
		);
		this.goTo(refreshedIndex >= 0 ? refreshedIndex : this.findCaptionByTime(candidate.startSeconds), false);
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
		const caption = this.captions[index];
		if (!caption) return;
		if (seek) {
			if (caption.videoIndex !== null && caption.videoIndex !== this.activeVideoIndex) {
				this.switchVideo(caption.videoIndex, caption.startSeconds, true);
			} else {
				this.seekTo(caption.startSeconds);
			}
		}
		this.currentIndex = index;
		this.updateActiveCaption(true);
	}

	private seekTo(seconds: number): void {
		if (this.mediaPlayer) {
			this.mediaPlayer.currentTime = seconds;
			return;
		}
		const source = this.activeVideo()?.source;
		if (source?.kind === "youtube") {
			this.sendYouTubeCommand("seekTo", [seconds, true]);
			window.setTimeout(() => this.requestPlayerTime(), 200);
			return;
		}
		if (source?.kind === "bilibili") this.renderActivePlayer(seconds, true);
	}

	private updateActiveCaption(shouldScroll: boolean): void {
		for (const [index, card] of this.captionEls) card.toggleClass("is-active", index === this.currentIndex);
		const active = this.captionEls.get(this.currentIndex);
		if (active) {
			let section = active.parentElement?.closest<HTMLDetailsElement>("details");
			while (section && this.captionsEl?.contains(section)) {
				section.open = true;
				section = section.parentElement?.closest<HTMLDetailsElement>("details");
			}
		}
		if (active && shouldScroll) {
			active.scrollIntoView({ behavior: "smooth", block: "center" });
		}
		if (this.outlinePanelOpen) this.renderOutlineNavigator();
	}

	private findCaptionByTime(time: number): number {
		return this.captions.findIndex(
			(caption) => caption.videoIndex === this.activeVideoIndex && caption.startSeconds === time
		);
	}

	private requestPlayerTime(): void {
		if (this.mediaPlayer) {
			this.followTime(this.mediaPlayer.currentTime);
			return;
		}
		if (this.playerReady && this.activeVideo()?.source.kind === "youtube") this.sendYouTubeCommand("getCurrentTime");
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
		if (this.activeVideo()?.source.kind !== "youtube") return;
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
		if (typeof currentTime === "number") {
			const force = this.pendingLocateCurrentCaption;
			this.pendingLocateCurrentCaption = false;
			this.followTime(currentTime, force);
		}
		if (payload.event === "onStateChange") {
			this.isPlaying = payload.info === 1;
			this.updatePlaybackButton();
			this.requestPlayerTime();
		}
	}

	private followTime(currentTime: number, force = false): void {
		if (!this.followPlayback && !force) return;
		let index = -1;
		const activeCaptions = this.captionIndicesForVideo(this.activeVideoIndex);
		for (let position = 0; position < activeCaptions.length; position++) {
			const captionIndex = activeCaptions[position];
			const nextIndex = activeCaptions[position + 1];
			const next = nextIndex === undefined ? undefined : this.captions[nextIndex];
			if (this.captions[captionIndex].startSeconds <= currentTime && (!next || next.startSeconds > currentTime)) {
				index = captionIndex;
				break;
			}
		}
		if (index >= 0 && (index !== this.currentIndex || force)) {
			this.currentIndex = index;
			this.updateActiveCaption(true);
		}
	}

	private updatePlaybackButton(): void {
		const button = this.contentEl.querySelector<HTMLButtonElement>(".subtitle-lab-play-button");
		if (!button) return;
		button.empty();
		setIcon(button, this.isPlaying ? "pause" : "play");
		const tooltip = this.activeVideo()?.source.kind === "bilibili" ? "请使用哔哩哔哩播放器控件" : this.isPlaying ? "暂停" : "播放";
		button.setAttribute("aria-label", tooltip);
		button.setAttribute("title", tooltip);
	}
}
