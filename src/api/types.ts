export type CodePinionUser = {
	id: number;
	email: string;
	username: string;
	full_name: string;
	avatar: string | null;
	job_title: string;
	timezone: string;
};

export type CodePinionTokens = {
	access: string;
	refresh: string;
};

export type LoginResponse = CodePinionTokens & {
	user: CodePinionUser;
};

export type RefreshResponse = {
	access: string;
	refresh?: string;
};

export type RepositoryRecord = {
	id: number;
	organization: number | null;
	organization_name: string | null;
	owner_user: number | null;
	owner_type: "personal" | "organization";
	owner_name: string | null;
	owner_slug: string | null;
	owner_avatar: string | null;
	full_name: string;
	can_manage: boolean;
	name: string;
	slug: string;
	description: string;
	visibility: "private" | "team" | "public";
	default_branch: string;
	language: string;
	status: "active" | "review" | "planning" | "archived";
	created_at: string;
	updated_at: string;
};

export type WorkspaceCapabilities = {
	can_edit: boolean;
	can_run_terminal: boolean;
	can_start_preview: boolean;
	can_create_branch: boolean;
	can_push: boolean;
};

export type WorkspaceRecord = {
	id: number;
	repository: number;
	repository_slug: string;
	repository_name: string;
	repository_owner_type: "personal" | "organization";
	branch_name: string;
	status: "provisioning" | "ready" | "busy" | "idle" | "stopping" | "stopped" | "failed" | "degraded" | "revoked";
	runtime_identifier: string;
	execution_profile: "node_basic" | "python_basic" | "polyglot_web" | "general_base";
	last_opened_file_path: string;
	capabilities: WorkspaceCapabilities;
	created_at: string;
	updated_at: string;
	last_active_at: string;
};

export type WorkspaceTerminalSession = {
	id: string;
	workspace: number;
	status: "creating" | "ready" | "streaming" | "closed" | "failed" | "revoked";
	shell: string;
	cwd: string;
	cols: number;
	rows: number;
	runtime_identifier: string;
	runtime_terminal_session_id: string;
	opened_at: string;
	last_active_at: string;
	closed_at: string | null;
	exit_code: number | null;
	close_reason: string;
};

export type SprintRecord = {
	id: number;
	repository: number;
	name: string;
	description: string;
	status: "planning" | "active" | "completed" | "cancelled";
	start_date: string;
	end_date: string;
	goal: string;
	task_count: number;
	created_at: string;
	updated_at: string;
};

export type LinkedPullRequest = {
	id: number;
	number: number;
	title: string;
	status: string;
	source_branch: string;
	target_branch: string;
	web_url: string;
	linked_at: string;
	source: string;
};

export type LinkedCommit = {
	id: number;
	sha: string;
	message: string;
	author_name: string;
	committed_at: string | null;
	additions: number;
	deletions: number;
	attribution_origin: string | null;
	attribution_actor_name: string | null;
	linked_at: string;
	source: string;
};

export type TaskRecord = {
	id: number;
	sprint: number;
	repository: number;
	parent_epic: number | null;
	title: string;
	description: string;
	status: "backlog" | "in_progress" | "in_review" | "done" | "blocked";
	priority: "critical" | "high" | "medium" | "low";
	branch: number | null;
	branch_name_snapshot: string;
	due_date: string | null;
	codebase_area: string;
	story_points: number;
	effort_estimate_hours: number;
	comment_count: number;
	linked_pull_requests: LinkedPullRequest[];
	linked_commits: LinkedCommit[];
	created_at: string;
	updated_at: string;
};

export type GoalRecord = {
	id: number;
	task: number;
	repository: number;
	branch_name: string;
	title: string;
	description: string;
	status: "backlog" | "in_progress" | "in_review" | "done" | "blocked";
	priority: "critical" | "high" | "medium" | "low";
	order: number;
	due_date: string | null;
	comment_count: number;
	linked_pull_requests: LinkedPullRequest[];
	linked_commits: LinkedCommit[];
	created_at: string;
	updated_at: string;
};

export type EpicRecord = {
	id: number;
	sprint: number;
	repository: number;
	title: string;
	description: string;
	status: string;
	order: number;
};

export type BranchRecord = {
	name: string;
	is_default: boolean;
	exists_local: boolean;
	exists_remote: boolean;
	head_commit_sha: string;
	last_synced_at: string | null;
};

export type PaginatedResponse<T> = {
	count: number;
	next: string | null;
	previous: string | null;
	results: T[];
};

