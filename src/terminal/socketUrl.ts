import { normalizeBaseUrl } from "../api/client";

export function buildTerminalSocketUrl(
	backendUrl: string,
	workspaceId: number,
	sessionId: string,
	accessToken: string,
	frontendApiKey: string,
): string {
	const baseUrl = new URL(normalizeBaseUrl(backendUrl));
	const protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";
	const params = new URLSearchParams({
		access_token: accessToken,
		api_key: frontendApiKey,
	});
	return `${protocol}//${baseUrl.host}/ws/workspaces/${workspaceId}/terminal/sessions/${sessionId}/?${params.toString()}`;
}

