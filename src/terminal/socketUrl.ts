import { normalizeBaseUrl } from "../api/client";

export function buildTerminalSocketUrl(
	backendUrl: string,
	workspaceId: number,
	sessionId: string,
	authToken: string,
	frontendApiKey?: string,
): string {
	const baseUrl = new URL(normalizeBaseUrl(backendUrl));
	const protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
	const params = new URLSearchParams({
		auth_token: authToken,
	});
	if (frontendApiKey?.trim()) {
		params.set("api_key", frontendApiKey.trim());
	}
	return `${protocol}//${baseUrl.host}/ws/workspaces/${workspaceId}/terminal/sessions/${sessionId}/?${params.toString()}`;
}
