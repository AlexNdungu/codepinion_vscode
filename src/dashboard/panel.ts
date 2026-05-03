import * as vscode from "vscode";

import { buildDashboardHtml, type DashboardSnapshot } from "./html";

export type DashboardAction = {
	command: string;
	repositoryId?: number;
	taskId?: number;
	sprintId?: number;
	goalId?: number;
	epicId?: number;
	payload?: Record<string, unknown>;
};

type DashboardActionHandler = (action: DashboardAction) => Thenable<unknown> | void;

export class CodePinionDashboardPanel implements vscode.Disposable {
	private panel: vscode.WebviewPanel | null = null;
	private readonly iconUri: vscode.Uri;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly onAction: DashboardActionHandler,
	) {
		this.iconUri = vscode.Uri.joinPath(this.extensionUri, "media", "codepinion-icon.png");
	}

	show(snapshot: DashboardSnapshot): void {
		if (this.panel) {
			this.panel.reveal(vscode.ViewColumn.One, true);
			this.render(snapshot);
			return;
		}

		this.panel = vscode.window.createWebviewPanel(
			"codepinion.dashboard",
			"CodePinion",
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
			},
		);
		this.panel.iconPath = this.iconUri;
		this.panel.onDidDispose(() => {
			this.panel = null;
		});
		this.panel.webview.onDidReceiveMessage((message: {
			command?: unknown;
			repositoryId?: unknown;
			taskId?: unknown;
			sprintId?: unknown;
			goalId?: unknown;
			epicId?: unknown;
			payload?: unknown;
		}) => {
			if (typeof message.command === "string" && message.command.trim()) {
				void this.onAction({
					command: message.command,
					repositoryId: typeof message.repositoryId === "number" ? message.repositoryId : undefined,
					taskId: typeof message.taskId === "number" ? message.taskId : undefined,
					sprintId: typeof message.sprintId === "number" ? message.sprintId : undefined,
					goalId: typeof message.goalId === "number" ? message.goalId : undefined,
					epicId: typeof message.epicId === "number" ? message.epicId : undefined,
					payload: isRecord(message.payload) ? message.payload : undefined,
				});
			}
		});
		this.render(snapshot);
	}

	update(snapshot: DashboardSnapshot): void {
		if (!this.panel) {
			return;
		}
		this.render(snapshot);
	}

	sendToWebview(message: Record<string, unknown>): void {
		void this.panel?.webview.postMessage(message);
	}

	dispose(): void {
		this.panel?.dispose();
		this.panel = null;
	}

	private render(snapshot: DashboardSnapshot): void {
		if (!this.panel) {
			return;
		}
		this.panel.webview.html = buildDashboardHtml(snapshot, {
			cspSource: this.panel.webview.cspSource,
			iconUri: this.panel.webview.asWebviewUri(this.iconUri).toString(),
		});
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
