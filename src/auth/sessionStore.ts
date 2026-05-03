import * as vscode from "vscode";

import type { CodePinionUser } from "../api/types";

const SECRET_KEYS = {
	accessToken: "codepinion.accessToken",
	refreshToken: "codepinion.refreshToken",
	frontendApiKey: "codepinion.frontendApiKey",
} as const;

const GLOBAL_KEYS = {
	user: "codepinion.user",
} as const;

export type SessionSecrets = {
	accessToken: string;
	refreshToken: string;
	frontendApiKey: string;
};

type StoredTokens = {
	accessToken: string;
	refreshToken: string;
	user: CodePinionUser;
};

type RefreshedTokens = {
	accessToken: string;
	refreshToken: string;
};

export class SessionStore {
	constructor(
		private readonly secrets: vscode.SecretStorage,
		private readonly globalState: vscode.Memento,
	) {}

	async getSessionSecrets(): Promise<SessionSecrets | null> {
		const [accessToken, refreshToken, frontendApiKey] = await Promise.all([
			this.secrets.get(SECRET_KEYS.accessToken),
			this.secrets.get(SECRET_KEYS.refreshToken),
			this.secrets.get(SECRET_KEYS.frontendApiKey),
		]);

		if (!accessToken || !refreshToken || !frontendApiKey) {
			return null;
		}

		return {
			accessToken,
			refreshToken,
			frontendApiKey,
		};
	}

	async storeTokens(value: StoredTokens): Promise<void> {
		await Promise.all([
			this.secrets.store(SECRET_KEYS.accessToken, value.accessToken),
			this.secrets.store(SECRET_KEYS.refreshToken, value.refreshToken),
			this.globalState.update(GLOBAL_KEYS.user, value.user),
		]);
	}

	async storeRefreshedTokens(value: RefreshedTokens): Promise<void> {
		await Promise.all([
			this.secrets.store(SECRET_KEYS.accessToken, value.accessToken),
			this.secrets.store(SECRET_KEYS.refreshToken, value.refreshToken),
		]);
	}

	async storeFrontendApiKey(value: string): Promise<void> {
		await this.secrets.store(SECRET_KEYS.frontendApiKey, value);
	}

	async getFrontendApiKey(): Promise<string | null> {
		return await this.secrets.get(SECRET_KEYS.frontendApiKey) ?? null;
	}

	async storeUser(user: CodePinionUser): Promise<void> {
		await this.globalState.update(GLOBAL_KEYS.user, user);
	}

	getStoredUser(): CodePinionUser | null {
		return this.globalState.get<CodePinionUser | null>(GLOBAL_KEYS.user, null);
	}

	async clear(): Promise<void> {
		await Promise.all([
			this.secrets.delete(SECRET_KEYS.accessToken),
			this.secrets.delete(SECRET_KEYS.refreshToken),
			this.secrets.delete(SECRET_KEYS.frontendApiKey),
			this.globalState.update(GLOBAL_KEYS.user, undefined),
		]);
	}

	async clearAuthSession(): Promise<void> {
		await Promise.all([
			this.secrets.delete(SECRET_KEYS.accessToken),
			this.secrets.delete(SECRET_KEYS.refreshToken),
			this.globalState.update(GLOBAL_KEYS.user, undefined),
		]);
	}
}
