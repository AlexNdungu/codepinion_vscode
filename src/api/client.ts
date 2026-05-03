import type {
	BranchRecord,
	CodePinionTokens,
	CodePinionUser,
	EpicRecord,
	GoalRecord,
	LoginResponse,
	PaginatedResponse,
	RefreshResponse,
	RepositoryRecord,
	SprintRecord,
	TaskRecord,
	WorkspaceRecord,
	WorkspaceTerminalSession,
} from "./types";
import type { SessionSecrets, SessionStore } from "../auth/sessionStore";

type SprintWritePayload = {
	repository: number;
	name: string;
	description?: string;
	status?: string;
	start_date: string;
	end_date: string;
	goal?: string;
};

type TaskWritePayload = {
	sprint: number;
	repository: number;
	parent_epic?: number | null;
	title: string;
	description?: string;
	status?: string;
	priority?: string;
	branch?: number | null;
	branch_name_snapshot?: string;
	due_date?: string | null;
	codebase_area?: string;
	story_points?: number;
	effort_estimate_hours?: number;
	assignee_ids?: number[];
};

type GoalWritePayload = {
	task: number;
	repository: number;
	branch_name: string;
	title: string;
	description?: string;
	status?: string;
	priority?: string;
	order?: number;
	due_date?: string | null;
};

type StartTaskWorkResponse = {
	workspace: WorkspaceRecord;
	task: TaskRecord;
	branch_name: string;
	branch_created: boolean;
	workspace_created: boolean;
};

type EpicWritePayload = {
	sprint: number;
	repository: number;
	title: string;
	description?: string;
	status?: string;
	order?: number;
};

export class CodePinionApiError extends Error {
	public readonly status: number;
	public readonly payload: unknown;

	constructor(message: string, status: number, payload: unknown) {
		super(message);
		this.name = "CodePinionApiError";
		this.status = status;
		this.payload = payload;
	}
}

type RequestOptions = {
	method?: string;
	body?: unknown;
	auth?: boolean;
	retryOnAuthFailure?: boolean;
	frontendApiKey?: string;
};

type FetchFn = typeof fetch;

export class CodePinionClient {
	constructor(
		private readonly sessionStore: SessionStore,
		private readonly getBackendUrl: () => string,
		private readonly fetchFn: FetchFn = fetch,
	) {}

	async login(email: string, password: string, frontendApiKey: string): Promise<CodePinionUser> {
		const response = await this.rawRequest<LoginResponse>("/api/auth/login/", {
			method: "POST",
			body: { email, password },
			auth: false,
			frontendApiKey,
			retryOnAuthFailure: false,
		});

		await this.sessionStore.storeFrontendApiKey(frontendApiKey);
		await this.sessionStore.storeTokens({
			accessToken: response.access,
			refreshToken: response.refresh,
			user: response.user,
		});
		return response.user;
	}

	async logout(): Promise<void> {
		const session = await this.sessionStore.getSessionSecrets();
		if (session?.refreshToken) {
			try {
				await this.rawRequest("/api/auth/logout/", {
					method: "POST",
					body: { refresh: session.refreshToken },
					auth: true,
					retryOnAuthFailure: false,
				});
			} catch {
				// Best effort. Local logout still needs to complete.
			}
		}
		await this.sessionStore.clearAuthSession();
	}

	async getCurrentUser(): Promise<CodePinionUser> {
		const user = await this.rawRequest<CodePinionUser>("/api/auth/me/", {
			auth: true,
		});
		await this.sessionStore.storeUser(user);
		return user;
	}

	async listRepositories(): Promise<RepositoryRecord[]> {
		return this.rawListRequest<RepositoryRecord>("/api/repositories/");
	}

	async createOrResumeWorkspace(repositoryId: number, branchName: string): Promise<WorkspaceRecord> {
		return this.rawRequest<WorkspaceRecord>("/api/workspaces/", {
			method: "POST",
			body: {
				repository: repositoryId,
				branch_name: branchName,
			},
			auth: true,
		});
	}

	async getWorkspace(workspaceId: number): Promise<WorkspaceRecord> {
		return this.rawRequest<WorkspaceRecord>(`/api/workspaces/${workspaceId}/`, {
			auth: true,
		});
	}

	async createTerminalSession(workspaceId: number, cols: number, rows: number): Promise<WorkspaceTerminalSession> {
		return this.rawRequest<WorkspaceTerminalSession>(`/api/workspaces/${workspaceId}/terminal/sessions/`, {
			method: "POST",
			body: {
				cwd: "/workspace/repo",
				shell: "/bin/bash",
				cols,
				rows,
			},
			auth: true,
		});
	}

	async terminateTerminalSession(workspaceId: number, sessionId: string, reason: string): Promise<void> {
		await this.rawRequest(`/api/workspaces/${workspaceId}/terminal/sessions/${sessionId}/terminate/`, {
			method: "POST",
			body: { reason },
			auth: true,
		});
	}

	async listSprints(repositoryId: number): Promise<SprintRecord[]> {
		return this.rawListRequest<SprintRecord>(`/api/planning/sprints/?repository=${repositoryId}`);
	}

	async listTasks(sprintId: number): Promise<TaskRecord[]> {
		return this.rawListRequest<TaskRecord>(`/api/planning/tasks/?sprint=${sprintId}`);
	}

	async listGoals(taskId: number): Promise<GoalRecord[]> {
		return this.rawListRequest<GoalRecord>(`/api/planning/goals/?task=${taskId}`);
	}

	async createSprint(payload: SprintWritePayload): Promise<SprintRecord> {
		return this.rawRequest<SprintRecord>("/api/planning/sprints/", {
			method: "POST",
			body: payload,
			auth: true,
		});
	}

	async updateSprint(sprintId: number, payload: Partial<SprintWritePayload>): Promise<SprintRecord> {
		return this.rawRequest<SprintRecord>(`/api/planning/sprints/${sprintId}/`, {
			method: "PATCH",
			body: payload,
			auth: true,
		});
	}

	async createTask(payload: TaskWritePayload): Promise<TaskRecord> {
		return this.rawRequest<TaskRecord>("/api/planning/tasks/", {
			method: "POST",
			body: payload,
			auth: true,
		});
	}

	async updateTask(taskId: number, payload: Partial<TaskWritePayload>): Promise<TaskRecord> {
		return this.rawRequest<TaskRecord>(`/api/planning/tasks/${taskId}/`, {
			method: "PATCH",
			body: payload,
			auth: true,
		});
	}

	async startTaskWork(taskId: number): Promise<StartTaskWorkResponse> {
		return this.rawRequest<StartTaskWorkResponse>(`/api/planning/tasks/${taskId}/start-work/`, {
			method: "POST",
			auth: true,
		});
	}

	async createGoal(payload: GoalWritePayload): Promise<GoalRecord> {
		return this.rawRequest<GoalRecord>("/api/planning/goals/", {
			method: "POST",
			body: payload,
			auth: true,
		});
	}

	async updateGoal(goalId: number, payload: Partial<GoalWritePayload>): Promise<GoalRecord> {
		return this.rawRequest<GoalRecord>(`/api/planning/goals/${goalId}/`, {
			method: "PATCH",
			body: payload,
			auth: true,
		});
	}

	async listEpics(repositoryId: number, sprintId?: number): Promise<EpicRecord[]> {
		const qs = sprintId ? `?repository=${repositoryId}&sprint=${sprintId}` : `?repository=${repositoryId}`;
		return this.rawListRequest<EpicRecord>(`/api/planning/epics/${qs}`);
	}

	async createEpic(payload: EpicWritePayload): Promise<EpicRecord> {
		return this.rawRequest<EpicRecord>("/api/planning/epics/", {
			method: "POST",
			body: payload,
			auth: true,
		});
	}

	async updateEpic(epicId: number, payload: Partial<EpicWritePayload>): Promise<EpicRecord> {
		return this.rawRequest<EpicRecord>(`/api/planning/epics/${epicId}/`, {
			method: "PATCH",
			body: payload,
			auth: true,
		});
	}

	async listWorkspaceBranches(workspaceId: number): Promise<BranchRecord[]> {
		const response = await this.rawRequest<{ branches: BranchRecord[] }>(
			`/api/workspaces/${workspaceId}/git/branches/`,
			{ auth: true },
		);
		return response.branches ?? [];
	}

	async ensureSession(): Promise<SessionSecrets> {
		const session = await this.sessionStore.getSessionSecrets();
		if (!session?.accessToken || !session.frontendApiKey) {
			throw new Error("Sign in to CodePinion first.");
		}
		return session;
	}

	private async rawListRequest<T>(path: string): Promise<T[]> {
		const payload = await this.rawRequest<T[] | PaginatedResponse<T>>(path, {
			auth: true,
		});
		return normalizeListPayload(payload);
	}

	private async rawRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
		const auth = options.auth ?? false;
		const retryOnAuthFailure = options.retryOnAuthFailure ?? true;
		const session = auth ? await this.sessionStore.getSessionSecrets() : null;
		const frontendApiKey = options.frontendApiKey ?? session?.frontendApiKey ?? "";
		const headers = new Headers({
			Accept: "application/json",
		});

		if (options.body !== undefined) {
			headers.set("Content-Type", "application/json");
		}
		if (frontendApiKey) {
			headers.set("X-API-Key", frontendApiKey);
		}
		if (auth && session?.accessToken) {
			headers.set("Authorization", `Bearer ${session.accessToken}`);
		}

		const response = await this.fetchFn(buildApiUrl(this.getBackendUrl(), path), {
			method: options.method ?? "GET",
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});

		const responseText = await response.text();
		const payload = responseText ? safeParseJson(responseText) : null;

		if (
			response.status === 401 &&
			auth &&
			retryOnAuthFailure &&
			session?.refreshToken &&
			path !== "/api/auth/token/refresh/"
		) {
			const refreshed = await this.refreshAccessToken(session);
			if (refreshed) {
				return this.rawRequest<T>(path, {
					...options,
					retryOnAuthFailure: false,
				});
			}
		}

		if (!response.ok) {
			throw new CodePinionApiError(getErrorMessage(payload, response.statusText), response.status, payload);
		}

		return payload as T;
	}

	private async refreshAccessToken(session: SessionSecrets): Promise<boolean> {
		const response = await this.rawRequest<RefreshResponse>("/api/auth/token/refresh/", {
			method: "POST",
			body: { refresh: session.refreshToken },
			auth: false,
			frontendApiKey: session.frontendApiKey,
			retryOnAuthFailure: false,
		}).catch(async () => {
			await this.sessionStore.clearAuthSession();
			return null;
		});

		if (!response?.access) {
			await this.sessionStore.clearAuthSession();
			return false;
		}

		await this.sessionStore.storeRefreshedTokens({
			accessToken: response.access,
			refreshToken: response.refresh ?? session.refreshToken,
		});
		return true;
	}
}

export function buildApiUrl(baseUrl: string, path: string): string {
	const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	return `${normalizedBaseUrl}${normalizedPath}`;
}

export function normalizeBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

export function normalizeListPayload<T>(payload: T[] | PaginatedResponse<T>): T[] {
	if (Array.isArray(payload)) {
		return payload;
	}
	if (payload && Array.isArray(payload.results)) {
		return payload.results;
	}
	return [];
}

function safeParseJson(value: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}

function getErrorMessage(payload: unknown, fallback: string): string {
	if (typeof payload === "string" && payload.trim()) {
		return payload;
	}
	if (payload && typeof payload === "object") {
		const entries = Object.values(payload as Record<string, unknown>);
		for (const entry of entries) {
			if (typeof entry === "string" && entry.trim()) {
				return entry;
			}
			if (Array.isArray(entry) && typeof entry[0] === "string") {
				return entry[0];
			}
		}
		const detail = (payload as Record<string, unknown>).detail;
		if (typeof detail === "string" && detail.trim()) {
			return detail;
		}
	}
	return fallback || "CodePinion request failed.";
}
