import { App, PluginSettingTab, Setting } from "obsidian";
import type SubtitleLabPlugin from "./main";
import type { FieldStyle, SubtitleLabSettings } from "./types";

export const DEFAULT_SETTINGS: SubtitleLabSettings = {
	fields: [
		{ id: "translation", name: "翻译", prefix: "翻译：", textColor: "#5c6470", backgroundColor: "#eef2f6" },
		{ id: "vocabulary", name: "词汇", prefix: "词汇：", textColor: "#075985", backgroundColor: "#e0f2fe" },
		{ id: "expression", name: "表达", prefix: "表达：", textColor: "#075985", backgroundColor: "#e0f2fe" },
		{ id: "spoken", name: "口语", prefix: "口语：", textColor: "#075985", backgroundColor: "#e0f2fe" },
		{ id: "meta", name: "元批注", prefix: "元批注：", textColor: "#7c2d12", backgroundColor: "#ffedd5" },
		{ id: "bracketed-meta", name: "标签批注", prefix: "【", textColor: "#7c2d12", backgroundColor: "#ffedd5" },
		{ id: "culture", name: "梗与背景", prefix: "梗：", textColor: "#6b21a8", backgroundColor: "#f3e8ff" },
	],
	autoScroll: true,
};

export class SubtitleLabSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: SubtitleLabPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("字幕分块").setHeading();
		new Setting(containerEl)
			.setName("自动居中当前字幕")
			.setDesc("YouTube、本地视频或直链视频推进时，将对应字幕块滚动到视图中央。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoScroll).onChange(async (value) => {
					this.plugin.settings.autoScroll = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl).setName("字段样式").setHeading();
		containerEl.createEl("p", {
			text: "字幕块首行是原文。后续每行只要以这里的前缀开头，就会以对应颜色和背景显示；空行才结束一个字幕块。",
			cls: "setting-item-description",
		});

		for (const field of this.plugin.settings.fields) {
			this.addFieldSetting(containerEl, field);
		}

		new Setting(containerEl)
			.setName("添加字段")
			.setDesc("例如“推理：”“地名：”或“情绪：”。")
			.addButton((button) =>
				button.setButtonText("添加").onClick(async () => {
					this.plugin.settings.fields.push({
						id: `field-${Date.now()}`,
						name: "新字段",
						prefix: "新字段：",
						textColor: "#3f3f46",
						backgroundColor: "#f4f4f5",
					});
					await this.plugin.saveSettings();
					this.plugin.refreshAllViews();
					this.display();
				})
			);
	}

	private addFieldSetting(containerEl: HTMLElement, field: FieldStyle): void {
		new Setting(containerEl)
			.setName(field.name)
			.setDesc("依次设置：名称、识别前缀、文字色、背景色。名称只用于设置页。")
			.addText((text) =>
				text.setPlaceholder("字段名称").setValue(field.name).onChange(async (value) => {
					field.name = value.trim() || "未命名字段";
					await this.saveAndRefresh();
				})
			)
			.addText((text) =>
				text.setPlaceholder("前缀，如：翻译：").setValue(field.prefix).onChange(async (value) => {
					field.prefix = value;
					await this.saveAndRefresh();
				})
			)
			.addColorPicker((picker) =>
				picker.setValue(field.textColor).onChange(async (value) => {
					field.textColor = value;
					await this.saveAndRefresh();
				})
			)
			.addColorPicker((picker) =>
				picker.setValue(field.backgroundColor).onChange(async (value) => {
					field.backgroundColor = value;
					await this.saveAndRefresh();
				})
			)
			.addExtraButton((button) =>
				button.setIcon("trash-2").setTooltip("删除字段").onClick(async () => {
					this.plugin.settings.fields = this.plugin.settings.fields.filter((item) => item.id !== field.id);
					await this.plugin.saveSettings();
					this.plugin.refreshAllViews();
					this.display();
				})
			);
	}

	private async saveAndRefresh(): Promise<void> {
		await this.plugin.saveSettings();
		this.plugin.refreshAllViews();
	}
}
