import * as vscode from "vscode";

import { CodePinionClient } from "../api/client";
import type { WorkspaceTerminalSession } from "../api/types";
import { buildTerminalSocketUrl } from "./socketUrl";

type TerminalDependencies = {
	client: CodePinionClient;
	workspaceId: number;
	workspaceLabel: string;
	backendUrl: string;
	authToken: string;
	frontendApiKey?: string;
};

export class CodePinionTerminal implements vscode.Pseudoterminal {
	private readonly writeEmitter = new vscode.EventEmitter<string>();
	private readonly closeEmitter = new vscode.EventEmitter<number | void>();
	private socket: WebSocket | null = null;
	private session: WorkspaceTerminalSession | null = null;
	private heartbeat: NodeJS.Timeout | null = null;

	public readonly onDidWrite = this.writeEmitter.event;
	public readonly onDidClose = this.closeEmitter.event;

	constructor(private readonly deps: TerminalDependencies) {}

	open(initialDimensions: vscode.TerminalDimensions | undefined): void {
		void this.initialize(initialDimensions);
	}

	close(): void {
		void this.terminate("terminal_closed");
	}

	handleInput(data: string): void {
		this.sendMessage("terminal.input", { data });
	}

	setDimensions(dimensions: vscode.TerminalDimensions): void {
		this.sendMessage("terminal.resize", {
			cols: dimensions.columns,
			rows: dimensions.rows,
		});
	}

	private async initialize(initialDimensions: vscode.TerminalDimensions | undefined): Promise<void> {
		if (typeof WebSocket === "undefined") {
			this.writeEmitter.fire("\r\n[codepinion] WebSocket is unavailable in this VS Code runtime.\r\n");
			this.closeEmitter.fire();
			return;
		}

		try {
			this.session = await this.deps.client.createTerminalSession(
				this.deps.workspaceId,
				initialDimensions?.columns ?? 120,
				initialDimensions?.rows ?? 32,
			);
			this.writeEmitter.fire(`\r\n[codepinion] Opening terminal for ${this.deps.workspaceLabel}...\r\n`);
			this.openSocket();
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to start CodePinion terminal.";
			this.writeEmitter.fire(`\r\n[codepinion] ${message}\r\n`);
			this.closeEmitter.fire();
		}
	}

	private openSocket(): void {
		if (!this.session) {
			return;
		}

		this.socket = new WebSocket(
			buildTerminalSocketUrl(
				this.deps.backendUrl,
				this.deps.workspaceId,
				this.session.id,
				this.deps.authToken,
				this.deps.frontendApiKey,
			),
		);

		this.socket.onopen = () => {
			this.startHeartbeat();
		};
		this.socket.onmessage = (event: MessageEvent) => {
			this.handleMessage(event.data);
		};
		this.socket.onclose = () => {
			this.stopHeartbeat();
			this.closeEmitter.fire();
		};
		this.socket.onerror = () => {
			this.writeEmitter.fire("\r\n[codepinion] Terminal stream failed.\r\n");
		};
	}

	private handleMessage(rawMessage: string): void {
		let parsed: { type?: string; payload?: Record<string, unknown> };
		try {
			parsed = JSON.parse(rawMessage) as { type?: string; payload?: Record<string, unknown> };
		} catch {
			this.writeEmitter.fire(rawMessage);
			return;
		}

		const type = parsed.type ?? "";
		const payload = parsed.payload ?? {};

		if (type === "terminal.output") {
			const data = payload.data;
			const encoding = payload.encoding;
			if (typeof data === "string" && encoding === "base64") {
				this.writeEmitter.fire(Buffer.from(data, "base64").toString("utf8"));
				return;
			}
			if (typeof data === "string") {
				this.writeEmitter.fire(data);
			}
			return;
		}

		if (type === "terminal.error") {
			const message = payload.message;
			if (typeof message === "string" && message.trim()) {
				this.writeEmitter.fire(`\r\n[codepinion] ${message}\r\n`);
			}
			return;
		}

		if (type === "terminal.closed" || type === "terminal.exit" || type === "terminal.failed" || type === "terminal.revoked") {
			const reason = payload.reason;
			if (typeof reason === "string" && reason.trim()) {
				this.writeEmitter.fire(`\r\n[codepinion] Terminal closed: ${reason}\r\n`);
			}
			this.socket?.close();
			return;
		}
	}

	private sendMessage(type: string, payload: Record<string, unknown>): void {
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify({ type, payload }));
		}
	}

	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.heartbeat = setInterval(() => {
			this.sendMessage("terminal.ping", {
				timestamp: new Date().toISOString(),
			});
		}, 30_000);
	}

	private stopHeartbeat(): void {
		if (this.heartbeat) {
			clearInterval(this.heartbeat);
			this.heartbeat = null;
		}
	}

	private async terminate(reason: string): Promise<void> {
		this.stopHeartbeat();
		if (this.session) {
			try {
				await this.deps.client.terminateTerminalSession(this.deps.workspaceId, this.session.id, reason);
			} catch {
				// Best effort.
			}
		}
		this.socket?.close();
		this.socket = null;
	}
}
