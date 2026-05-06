import * as vscode from "vscode";

import type { CodePinionUser } from "../api/types";

const SECRET_KEYS = {
	personalAccessToken: "codepinion.personalAccessToken",
	accessToken: "codepinion.accessToken",
	refreshToken: "codepinion.refreshToken",
	frontendApiKey: "codepinion.frontendApiKey",
} as const;

const GLOBAL_KEYS = {
	user: "codepinion.user",
	authMode: "codepinion.authMode",
} as const;

export type PersonalAccessTokenSessionSecrets = {
	authMode: "personalAccessToken";
	personalAccessToken: string;
	authToken: string;
};

export type BrowserSessionSecrets = {
	authMode: "browserSession";
	accessToken: string;
	refreshToken: string;
	frontendApiKey: string;
	authToken: string;
};

export type SessionSecrets = PersonalAccessTokenSessionSecrets | BrowserSessionSecrets;

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
		const authMode = this.globalState.get<string | null>(GLOBAL_KEYS.authMode, null);
		const [personalAccessToken, accessToken, refreshToken, frontendApiKey] = await Promise.all([
			this.secrets.get(SECRET_KEYS.personalAccessToken),
			this.secrets.get(SECRET_KEYS.accessToken),
			this.secrets.get(SECRET_KEYS.refreshToken),
			this.secrets.get(SECRET_KEYS.frontendApiKey),
		]);

		if (authMode === "personalAccessToken" && personalAccessToken) {
			return {
				authMode: "personalAccessToken",
				personalAccessToken,
				authToken: personalAccessToken,
			};
		}

		if (authMode === "browserSession" && accessToken && refreshToken && frontendApiKey) {
			return {
				authMode: "browserSession",
				accessToken,
				refreshToken,
				frontendApiKey,
				authToken: accessToken,
			};
		}

		if (personalAccessToken) {
			await this.globalState.update(GLOBAL_KEYS.authMode, "personalAccessToken");
			return {
				authMode: "personalAccessToken",
				personalAccessToken,
				authToken: personalAccessToken,
			};
		}

		if (accessToken && refreshToken && frontendApiKey) {
			await this.globalState.update(GLOBAL_KEYS.authMode, "browserSession");
			return {
				authMode: "browserSession",
				accessToken,
				refreshToken,
				frontendApiKey,
				authToken: accessToken,
			};
		}
		return null;
	}

	async storeBrowserSession(value: StoredTokens): Promise<void> {
		await Promise.all([
			this.globalState.update(GLOBAL_KEYS.authMode, "browserSession"),
			this.secrets.store(SECRET_KEYS.accessToken, value.accessToken),
			this.secrets.store(SECRET_KEYS.refreshToken, value.refreshToken),
			this.globalState.update(GLOBAL_KEYS.user, value.user),
		]);
	}

	async storePersonalAccessTokenSession(value: { personalAccessToken: string; user: CodePinionUser }): Promise<void> {
		await Promise.all([
			this.globalState.update(GLOBAL_KEYS.authMode, "personalAccessToken"),
			this.secrets.store(SECRET_KEYS.personalAccessToken, value.personalAccessToken),
			this.globalState.update(GLOBAL_KEYS.user, value.user),
			this.secrets.delete(SECRET_KEYS.accessToken),
			this.secrets.delete(SECRET_KEYS.refreshToken),
			this.secrets.delete(SECRET_KEYS.frontendApiKey),
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
			this.secrets.delete(SECRET_KEYS.personalAccessToken),
			this.secrets.delete(SECRET_KEYS.accessToken),
			this.secrets.delete(SECRET_KEYS.refreshToken),
			this.secrets.delete(SECRET_KEYS.frontendApiKey),
			this.globalState.update(GLOBAL_KEYS.user, undefined),
			this.globalState.update(GLOBAL_KEYS.authMode, undefined),
		]);
	}

	async clearAuthSession(): Promise<void> {
		await Promise.all([
			this.secrets.delete(SECRET_KEYS.personalAccessToken),
			this.secrets.delete(SECRET_KEYS.accessToken),
			this.secrets.delete(SECRET_KEYS.refreshToken),
			this.globalState.update(GLOBAL_KEYS.user, undefined),
			this.globalState.update(GLOBAL_KEYS.authMode, undefined),
		]);
	}
}
