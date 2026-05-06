import type {
	BranchRecord,
	CodePinionUser,
	CommentRecord,
	EpicRecord,
	ExtensionSessionResponse,
	GitCommitResult,
	GitDiffRecord,
	GitStatusRecord,
	GoalRecord,
	PaginatedResponse,
	RefreshResponse,
	RepoPullRequest,
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
	authToken?: string;
	frontendApiKey?: string;
};

type FetchFn = typeof fetch;

export class CodePinionClient {
	constructor(
		private readonly sessionStore: SessionStore,
		private readonly getBackendUrl: () => string,
		private readonly fetchFn: FetchFn = fetch,
	) {}

	async authenticateWithPersonalAccessToken(personalAccessToken: string): Promise<CodePinionUser> {
		const response = await this.rawRequest<ExtensionSessionResponse>("/api/auth/extension/session/", {
			auth: false,
			authToken: personalAccessToken,
			retryOnAuthFailure: false,
		});

		await this.sessionStore.storePersonalAccessTokenSession({
			personalAccessToken,
			user: response.user,
		});
		return response.user;
	}

	async logout(): Promise<void> {
		const session = await this.sessionStore.getSessionSecrets();
		if (session?.authMode === "browserSession" && session.refreshToken) {
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
		const session = await this.rawRequest<ExtensionSessionResponse>("/api/auth/extension/session/", {
			auth: true,
		});
		await this.sessionStore.storeUser(session.user);
		return session.user;
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

	async deleteSprint(sprintId: number): Promise<void> {
		await this.rawRequest<void>(`/api/planning/sprints/${sprintId}/`, { method: "DELETE", auth: true });
	}

	async deleteTask(taskId: number): Promise<void> {
		await this.rawRequest<void>(`/api/planning/tasks/${taskId}/`, { method: "DELETE", auth: true });
	}

	async deleteGoal(goalId: number): Promise<void> {
		await this.rawRequest<void>(`/api/planning/goals/${goalId}/`, { method: "DELETE", auth: true });
	}

	async deleteEpic(epicId: number): Promise<void> {
		await this.rawRequest<void>(`/api/planning/epics/${epicId}/`, { method: "DELETE", auth: true });
	}

	async getWorkspaceGitStatus(workspaceId: number): Promise<GitStatusRecord> {
		return this.rawRequest<GitStatusRecord>(`/api/workspaces/${workspaceId}/git/status/`, { auth: true });
	}

	async getWorkspaceGitDiff(workspaceId: number, path?: string): Promise<GitDiffRecord> {
		const qs = path ? `?path=${encodeURIComponent(path)}` : "";
		return this.rawRequest<GitDiffRecord>(`/api/workspaces/${workspaceId}/git/diff/${qs}`, { auth: true });
	}

	async workspaceGitCommit(workspaceId: number, message: string): Promise<GitCommitResult> {
		return this.rawRequest<GitCommitResult>(`/api/workspaces/${workspaceId}/git/commit/`, {
			method: "POST",
			body: { message },
			auth: true,
		});
	}

	async workspaceGitCheckout(workspaceId: number, branch: string): Promise<void> {
		await this.rawRequest<void>(`/api/workspaces/${workspaceId}/git/checkout/`, {
			method: "POST",
			body: { branch },
			auth: true,
		});
	}

	async workspaceGitCreateBranch(workspaceId: number, name: string, from?: string): Promise<void> {
		await this.rawRequest<void>(`/api/workspaces/${workspaceId}/git/branches/create/`, {
			method: "POST",
			body: from ? { name, from } : { name },
			auth: true,
		});
	}

	async listTaskComments(taskId: number): Promise<CommentRecord[]> {
		return this.rawListRequest<CommentRecord>(`/api/planning/tasks/${taskId}/comments/`);
	}

	async createTaskComment(taskId: number, body: string): Promise<CommentRecord> {
		return this.rawRequest<CommentRecord>(`/api/planning/tasks/${taskId}/comments/`, {
			method: "POST",
			body: { body },
			auth: true,
		});
	}

	async listGoalComments(goalId: number): Promise<CommentRecord[]> {
		return this.rawListRequest<CommentRecord>(`/api/planning/goals/${goalId}/comments/`);
	}

	async createGoalComment(goalId: number, body: string): Promise<CommentRecord> {
		return this.rawRequest<CommentRecord>(`/api/planning/goals/${goalId}/comments/`, {
			method: "POST",
			body: { body },
			auth: true,
		});
	}

	async listRepoPullRequests(repositoryId: number): Promise<RepoPullRequest[]> {
		return this.rawListRequest<RepoPullRequest>(`/api/gitdata/pull-requests/?repository=${repositoryId}`);
	}

	async linkPrToTask(taskId: number, prId: number): Promise<void> {
		await this.rawRequest<void>(`/api/planning/tasks/${taskId}/pull-requests/`, {
			method: "POST",
			body: { pull_request_id: prId },
			auth: true,
		});
	}

	async unlinkPrFromTask(taskId: number, prId: number): Promise<void> {
		await this.rawRequest<void>(`/api/planning/tasks/${taskId}/pull-requests/${prId}/`, {
			method: "DELETE",
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
		if (!session?.authToken) {
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
		const frontendApiKey = options.frontendApiKey ?? (session?.authMode === "browserSession" ? session.frontendApiKey : "");
		const authToken = options.authToken ?? (auth ? session?.authToken ?? "" : "");
		const headers = new Headers({
			Accept: "application/json",
		});

		if (options.body !== undefined) {
			headers.set("Content-Type", "application/json");
		}
		if (frontendApiKey) {
			headers.set("X-API-Key", frontendApiKey);
		}
		if (authToken) {
			headers.set("Authorization", `Bearer ${authToken}`);
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
			session?.authMode === "browserSession" &&
			session.refreshToken &&
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
		if (session.authMode !== "browserSession") {
			await this.sessionStore.clearAuthSession();
			return false;
		}
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
