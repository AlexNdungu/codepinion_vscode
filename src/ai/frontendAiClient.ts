export type SprintActionResult = {
	result: unknown;
	modelId: string;
	mocked: boolean;
};

export type StandupResult = {
	summary: string;
};

export type SprintBreakdownResult = {
	epics: Array<{
		title: string;
		description: string;
		userStories: Array<{
			title: string;
			acceptanceCriteria: string[];
			tasks: Array<{
				title: string;
				type: string;
				estimatePoints: number;
				estimateHours: number;
				dependencies: string[];
			}>;
		}>;
	}>;
	suggestedSprintDuration: number;
	totalPoints: number;
	risks: string[];
};

export type ChatMessage = {
	role: "user" | "assistant";
	content: string;
};

export class FrontendAiClient {
	constructor(private readonly getAppUrl: () => string) {}

	async sprintAction(action: string, payload: unknown): Promise<SprintActionResult> {
		const url = `${this.getAppUrl().replace(/\/+$/, "")}/api/ai/sprint`;
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, payload }),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`Sprint AI request failed (${response.status})${text ? `: ${text}` : ""}`);
		}

		return response.json() as Promise<SprintActionResult>;
	}

	async *chatStream(
		messages: ChatMessage[],
		context: Record<string, unknown>,
	): AsyncGenerator<string> {
		const url = `${this.getAppUrl().replace(/\/+$/, "")}/api/ai/chat`;
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messages, context }),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`AI chat request failed (${response.status})${text ? `: ${text}` : ""}`);
		}

		if (!response.body) {
			throw new Error("AI chat response has no body.");
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) {
						continue;
					}
					const raw = line.slice(6).trim();
					if (!raw) {
						continue;
					}
					let chunk: { type: string; delta?: string; error?: string };
					try {
						chunk = JSON.parse(raw) as typeof chunk;
					} catch {
						continue;
					}
					if (chunk.type === "text" && chunk.delta) {
						yield chunk.delta;
					} else if (chunk.type === "done") {
						return;
					} else if (chunk.type === "error") {
						throw new Error(chunk.error ?? "AI stream error");
					}
				}
			}
		} finally {
			reader.releaseLock();
		}
	}
}
