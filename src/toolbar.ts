export const TOOLBAR_ACTIONS = [
	"outline",
	"follow",
	"locate",
	"previous",
	"next",
	"playback",
	"edit",
	"refresh",
] as const;

export type ToolbarAction = (typeof TOOLBAR_ACTIONS)[number];

export const DEFAULT_TOOLBAR_ORDER: ToolbarAction[] = [...TOOLBAR_ACTIONS];

export function normalizeToolbarOrder(value: unknown): ToolbarAction[] {
	const requested = Array.isArray(value) ? value : [];
	const valid = requested.filter(
		(action, index): action is ToolbarAction =>
			typeof action === "string" &&
			TOOLBAR_ACTIONS.includes(action as ToolbarAction) &&
			requested.indexOf(action) === index
	);
	return [...valid, ...TOOLBAR_ACTIONS.filter((action) => !valid.includes(action))];
}

export function attachToolbarReorder(
	container: HTMLElement,
	onCommit: (order: ToolbarAction[]) => void
): () => void {
	let holdTimer: number | null = null;
	let dragging: HTMLButtonElement | null = null;
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let suppressButton: HTMLButtonElement | null = null;
	let suppressTimer: number | null = null;

	const clearHold = (): void => {
		if (holdTimer !== null) window.clearTimeout(holdTimer);
		holdTimer = null;
	};

	const finish = (commit: boolean): void => {
		clearHold();
		if (!dragging) {
			pointerId = null;
			return;
		}
		const completedButton = dragging;
		completedButton.removeClass("is-dragging");
		container.removeClass("is-reordering");
		if (pointerId !== null && completedButton.hasPointerCapture(pointerId)) completedButton.releasePointerCapture(pointerId);
		dragging = null;
		pointerId = null;
		if (!commit) return;

		suppressButton = completedButton;
		if (suppressTimer !== null) window.clearTimeout(suppressTimer);
		suppressTimer = window.setTimeout(() => {
			suppressButton = null;
			suppressTimer = null;
		}, 500);
		const order = Array.from(container.querySelectorAll<HTMLButtonElement>(".subtitle-lab-toolbar-action"))
			.map((button) => button.dataset.action)
			.filter((action): action is ToolbarAction => TOOLBAR_ACTIONS.includes(action as ToolbarAction));
		onCommit(order);
	};

	const onPointerDown = (event: PointerEvent): void => {
		const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".subtitle-lab-toolbar-action") : null;
		if (!target || target.disabled || event.button !== 0 || pointerId !== null) return;
		clearHold();
		startX = event.clientX;
		startY = event.clientY;
		pointerId = event.pointerId;
		holdTimer = window.setTimeout(() => {
			dragging = target;
			target.addClass("is-dragging");
			container.addClass("is-reordering");
			target.setPointerCapture(event.pointerId);
			holdTimer = null;
		}, 450);
	};

	const onPointerMove = (event: PointerEvent): void => {
		if (pointerId !== event.pointerId) return;
		if (!dragging) {
			if (Math.hypot(event.clientX - startX, event.clientY - startY) > 8) clearHold();
			return;
		}
		event.preventDefault();
		const hit = document.elementFromPoint(event.clientX, event.clientY);
		const target = hit?.closest<HTMLButtonElement>(".subtitle-lab-toolbar-action");
		if (!target || target === dragging || target.parentElement !== container) return;
		const rect = target.getBoundingClientRect();
		container.insertBefore(dragging, event.clientX < rect.left + rect.width / 2 ? target : target.nextSibling);
	};

	const onPointerUp = (event: PointerEvent): void => {
		if (pointerId !== event.pointerId) return;
		if (dragging) event.preventDefault();
		finish(true);
	};

	const onPointerCancel = (event: PointerEvent): void => {
		if (pointerId === event.pointerId) finish(false);
	};
	const onClick = (event: MouseEvent): void => {
		const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".subtitle-lab-toolbar-action") : null;
		if (!target || target !== suppressButton) return;
		event.preventDefault();
		event.stopImmediatePropagation();
		suppressButton = null;
	};
	const onContextMenu = (event: MouseEvent): void => {
		if (dragging) event.preventDefault();
	};

	container.addEventListener("pointerdown", onPointerDown);
	window.addEventListener("pointermove", onPointerMove);
	window.addEventListener("pointerup", onPointerUp);
	window.addEventListener("pointercancel", onPointerCancel);
	container.addEventListener("click", onClick, true);
	container.addEventListener("contextmenu", onContextMenu);

	return () => {
		finish(false);
		if (suppressTimer !== null) window.clearTimeout(suppressTimer);
		container.removeEventListener("pointerdown", onPointerDown);
		window.removeEventListener("pointermove", onPointerMove);
		window.removeEventListener("pointerup", onPointerUp);
		window.removeEventListener("pointercancel", onPointerCancel);
		container.removeEventListener("click", onClick, true);
		container.removeEventListener("contextmenu", onContextMenu);
	};
}
