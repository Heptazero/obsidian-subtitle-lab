import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { parseSubtitleDocument } from "./parser";
import { DEFAULT_SETTINGS, SubtitleLabSettingTab } from "./settings";
import { SUBTITLE_LAB_VIEW, SubtitleLabView } from "./subtitle-view";
import type { SubtitleBlock, SubtitleLabSettings } from "./types";

export default class SubtitleLabPlugin extends Plugin {
	settings: SubtitleLabSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.registerView(SUBTITLE_LAB_VIEW, (leaf) => new SubtitleLabView(leaf, this));
		this.addSettingTab(new SubtitleLabSettingTab(this.app, this));

		this.addCommand({
			id: "open-subtitle-lab",
			name: "打开字幕学习视图",
			callback: () => void this.openForActiveFile(),
		});
		this.addCommand({
			id: "previous-caption",
			name: "跳到上一句字幕",
			callback: () => void this.withView((view) => view.goRelative(-1)),
		});
		this.addCommand({
			id: "next-caption",
			name: "跳到下一句字幕",
			callback: () => void this.withView((view) => view.goRelative(1)),
		});
		this.addCommand({
			id: "toggle-playback",
			name: "播放或暂停字幕视频",
			callback: () => void this.withView((view) => view.togglePlayback()),
		});
		this.addCommand({
			id: "edit-current-caption",
			name: "编辑当前字幕块",
			callback: () => void this.withView((view) => view.editCurrent()),
		});
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(SUBTITLE_LAB_VIEW);
	}

	async loadSettings(): Promise<void> {
		const saved = await this.loadData();
		this.settings = {
			...DEFAULT_SETTINGS,
			...saved,
			fields: Array.isArray(saved?.fields) ? saved.fields : DEFAULT_SETTINGS.fields,
		};
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	refreshAllViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(SUBTITLE_LAB_VIEW)) {
			if (leaf.view instanceof SubtitleLabView) leaf.view.refresh();
		}
	}

	async replaceCaptionBlock(file: TFile, expected: SubtitleBlock, nextRaw: string): Promise<boolean> {
		let replaced = false;
		await this.app.vault.process(file, (content) => {
			const live = parseSubtitleDocument(content).captions.find(
				(caption) => caption.startSeconds === expected.startSeconds && caption.raw === expected.raw
			);
			if (!live) return content;
			replaced = true;
			return `${content.slice(0, live.startOffset)}${nextRaw}${content.slice(live.endOffset)}`;
		});
		return replaced;
	}

	private async openForActiveFile(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice("请先打开一篇 Markdown 字幕笔记。");
			return;
		}
		// Subtitle Lab belongs in the main tab group. Closing a prior view also
		// migrates the older sidebar instance created by earlier plugin versions.
		this.app.workspace.detachLeavesOfType(SUBTITLE_LAB_VIEW);
		const leaf = await this.getOrCreateLeaf();
		await leaf.setViewState({ type: SUBTITLE_LAB_VIEW, active: true });
		await (leaf.view as SubtitleLabView).showForFile(file);
		this.app.workspace.revealLeaf(leaf);
	}

	private async withView(action: (view: SubtitleLabView) => void): Promise<void> {
		let view = this.getOpenView();
		if (!view) {
			await this.openForActiveFile();
			view = this.getOpenView();
		}
		if (view) action(view);
	}

	private getOpenView(): SubtitleLabView | null {
		for (const leaf of this.app.workspace.getLeavesOfType(SUBTITLE_LAB_VIEW)) {
			if (leaf.view instanceof SubtitleLabView) return leaf.view;
		}
		return null;
	}

	private async getOrCreateLeaf(): Promise<WorkspaceLeaf> {
		return this.app.workspace.getLeaf("tab");
	}
}
