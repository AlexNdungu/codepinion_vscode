import type { BranchRecord, CodePinionUser, CommentRecord, EpicRecord, GitStatusRecord, GoalRecord, RepositoryRecord, SprintRecord, TaskRecord, WorkspaceRecord } from "../api/types";
import type { LocalRepoContext } from "../bridge/git";
import { getRepositoryOwnerLabel } from "../repos/catalog";

const TASK_STATUSES = ["backlog", "in_progress", "in_review", "done", "blocked"] as const;
const SPRINT_STATUSES = ["planning", "active", "completed", "cancelled"] as const;
const PRIORITIES = ["critical", "high", "medium", "low"] as const;

export type DashboardSnapshot = {
	user: CodePinionUser | null;
	hasPersonalAccessToken: boolean;
	localRepo: LocalRepoContext | null;
	repositories: RepositoryRecord[];
	linkedRepository: RepositoryRecord | null;
	workspace: WorkspaceRecord | null;
	workspaceBranches: BranchRecord[];
	workspaceGitStatus: GitStatusRecord | null;
	planning: {
		sprints: SprintRecord[];
		epics: EpicRecord[];
		tasks: TaskRecord[];
		currentTask: TaskRecord | null;
		currentGoals: GoalRecord[];
		currentSprint: SprintRecord | null;
		currentTaskComments: CommentRecord[];
	} | null;
	chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
	generatedAiPrompt: string | null;
	errorMessage: string | null;
	backendUrl: string;
	appUrl: string;
};

export function buildDashboardHtml(
	snapshot: DashboardSnapshot,
	options: {
		cspSource: string;
		iconUri: string;
		nonce?: string;
	},
): string {
	const nonce = options.nonce ?? createNonce();
	const userLabel = snapshot.user
		? escapeHtml(snapshot.user.full_name || snapshot.user.email)
		: "Not signed in";
	const localRepoLabel = snapshot.localRepo
		? `${escapeHtml(snapshot.localRepo.workspaceFolder.name)} · ${escapeHtml(snapshot.localRepo.branchName)}`
		: "No local git repo";
	const linkedRepoLabel = snapshot.linkedRepository
		? escapeHtml(snapshot.linkedRepository.full_name)
		: "Not linked";
	const workspaceLabel = snapshot.workspace
		? `#${snapshot.workspace.id} · ${escapeHtml(snapshot.workspace.status)} · ${escapeHtml(snapshot.workspace.branch_name)}`
		: "No active workspace";
	const currentTaskLabel = snapshot.planning?.currentTask
		? escapeHtml(snapshot.planning.currentTask.title)
		: "—";
	const sprintOptions = buildSprintOptions(snapshot.planning?.sprints ?? [], snapshot.planning?.currentSprint?.id);
	const taskOptions = buildTaskOptions(snapshot.planning?.tasks ?? [], snapshot.planning?.currentTask?.id);
	const epicOptions = buildEpicOptions(snapshot.planning?.epics ?? [], snapshot.planning?.currentSprint?.id);
	const currentGoalCount = snapshot.planning?.currentGoals.length ?? 0;
	const currentTaskCommentCount = snapshot.planning?.currentTaskComments.length ?? 0;

	const taskCommentsMarkup = snapshot.planning?.currentTaskComments.length
		? snapshot.planning.currentTaskComments.map((c) => `
			<div class="comment-item">
				<span class="comment-author">${escapeHtml(c.author_name)}</span>
				<span class="meta-text">${escapeHtml(formatRelativeTime(c.created_at))}</span>
				<p class="comment-body">${escapeHtml(c.body)}</p>
			</div>
		`).join("")
		: `<p class="empty-text" style="padding:8px 12px;">No comments yet.</p>`;

	const gitStatusMarkup = snapshot.workspaceGitStatus
		? snapshot.workspaceGitStatus.files.length
			? snapshot.workspaceGitStatus.files.map((f) => `
				<li>
					<div class="item-title">
						<span class="mono">${escapeHtml(f.path)}</span>
					</div>
					<div class="item-meta">
						${statusChip(f.staged ? "active" : "backlog")}
						<span class="meta-text">${escapeHtml(f.status)}</span>
					</div>
				</li>
			`).join("")
			: `<li class="empty-li">Working tree is clean.</li>`
		: `<li class="empty-li">No active workspace.</li>`;

	const epicsMarkup = snapshot.planning?.epics.length
		? snapshot.planning.epics.map((epic) => `
			<li>
				<div class="item-title">${escapeHtml(epic.title)}</div>
				<div class="item-meta">
					${statusChip(epic.status)}
					${epic.description ? `<span class="meta-text">${escapeHtml(truncate(epic.description, 60))}</span>` : ""}
				</div>
				<div class="item-actions">
					<select aria-label="Update epic status" class="inline-select" data-epic-status="${epic.id}">
						${buildOptions(["active", "completed", "cancelled"], epic.status)}
					</select>
					<button class="btn-secondary sm" data-command="codepinion.dashboard.updateEpicStatus" data-epic-id="${epic.id}">Save</button>
					<button class="btn-ghost sm" data-command="codepinion.dashboard.deleteEpic" data-epic-id="${epic.id}" title="Delete epic">✕</button>
				</div>
			</li>
		`).join("")
		: `<li class="empty-li">No epics for this sprint.</li>`;

	const branchPickerMarkup = snapshot.workspaceBranches.length
		? `
			<div class="section-body" style="padding-top:0;">
				<label style="font-size:11px;color:var(--muted);">Workspace branches
					<select class="inline-select" style="width:100%;" aria-label="Workspace branches">
						${snapshot.workspaceBranches.map((b) => `<option value="${escapeHtml(b.name)}"${b.name === snapshot.workspace?.branch_name ? " selected" : ""}>${escapeHtml(b.name)}${b.is_default ? " (default)" : ""}</option>`).join("")}
					</select>
				</label>
			</div>
		`
		: "";

	const sprintControlMarkup = snapshot.planning?.currentSprint
		? `
			<div class="sprint-ctrl">
				<select aria-label="Sprint status" class="inline-select" data-sprint-status="${snapshot.planning.currentSprint.id}">
					${buildOptions(SPRINT_STATUSES, snapshot.planning.currentSprint.status)}
				</select>
				<button class="btn-secondary sm" data-command="codepinion.dashboard.updateSprintStatus" data-sprint-id="${snapshot.planning.currentSprint.id}">Save</button>
				<button class="btn-ghost sm" data-command="codepinion.dashboard.deleteSprint" data-sprint-id="${snapshot.planning.currentSprint.id}" title="Delete sprint">✕</button>
			</div>
		`
		: `<p class="empty-text">No active sprint to edit yet.</p>`;

	const goalsMarkup = snapshot.planning?.currentGoals.length
		? snapshot.planning.currentGoals.map((goal) => `
			<li>
				<div class="item-title">${escapeHtml(goal.title)}</div>
				<div class="item-meta">
					${statusChip(goal.status)}
					${statusChip(goal.priority)}
					${goal.comment_count > 0 ? `<span class="comment-badge">💬 ${goal.comment_count}</span>` : ""}
					${goal.branch_name ? `<span class="meta-text">${escapeHtml(goal.branch_name)}</span>` : ""}
				</div>
				${goal.linked_commits.length > 0 ? `
				<div class="item-links">
					${goal.linked_commits.slice(0, 2).map((commit) => `
						<span class="commit-chip">
							<span class="mono">${escapeHtml(commit.sha.slice(0, 7))}</span>
							${escapeHtml(truncate(commit.message, 40))}
						</span>
					`).join("")}
				</div>` : ""}
				<div class="item-actions">
					<select aria-label="Update goal status" class="inline-select" data-goal-status="${goal.id}">
						${buildOptions(TASK_STATUSES, goal.status)}
					</select>
					<button class="btn-secondary sm" data-command="codepinion.dashboard.updateGoalStatus" data-goal-id="${goal.id}">Save</button>
					<button class="btn-ghost sm" data-toggle="goal-comments-${goal.id}">💬</button>
					<button class="btn-ghost sm" data-command="codepinion.dashboard.deleteGoal" data-goal-id="${goal.id}" title="Delete goal">✕</button>
				</div>
				<div id="goal-comments-${goal.id}" class="create-form-wrap" style="display:none;">
					<form class="form-body" data-command="codepinion.dashboard.postGoalComment" data-goal-id="${goal.id}">
						<label>Comment <textarea name="body" rows="2" required placeholder="Add a comment…"></textarea></label>
						<div><button type="submit" class="btn-primary sm">Post</button></div>
					</form>
				</div>
			</li>
		`).join("")
		: `<li class="empty-li">No goals linked to the current task.</li>`;

	const repoMarkup = snapshot.repositories.length
		? snapshot.repositories.map((repository) => `
			<li class="repo-item" data-repo-search="${escapeHtml([
				repository.full_name,
				repository.name,
				repository.slug,
				repository.description,
				repository.organization_name,
				repository.owner_name,
				repository.owner_slug,
				repository.language,
				repository.status,
			].filter(Boolean).join(" ").toLowerCase())}">
				<div class="item-title">${escapeHtml(repository.full_name)}</div>
				<div class="item-meta">
					<span class="meta-text">${escapeHtml(getRepositoryOwnerLabel(repository))} • ${escapeHtml(repository.description || repository.language || repository.status)}</span>
					${snapshot.linkedRepository?.id === repository.id ? statusChip("active") : ""}
				</div>
				<div class="item-actions">
					<button class="sm ${snapshot.linkedRepository?.id === repository.id ? "btn-primary" : "btn-secondary"}" data-command="codepinion.linkRepository" data-repository-id="${repository.id}">
						${snapshot.linkedRepository?.id === repository.id ? "Selected" : "Select"}
					</button>
				</div>
			</li>
		`).join("")
		: `<li class="empty-li">No repositories loaded.</li>`;

	const canCreateBranch = snapshot.workspace?.capabilities.can_create_branch ?? true;

	const taskMarkup = snapshot.planning?.tasks.length
		? snapshot.planning.tasks.slice(0, 12).map((task) => `
			<li>
				<div class="item-title">${escapeHtml(task.title)}</div>
				<div class="item-meta">
					${statusChip(task.status)}
					${statusChip(task.priority)}
					${task.comment_count > 0 ? `<span class="comment-badge">💬 ${task.comment_count}</span>` : ""}
					${task.branch_name_snapshot ? `<span class="meta-text">${escapeHtml(task.branch_name_snapshot)}</span>` : ""}
				</div>
				${task.linked_pull_requests.length > 0 ? `
				<div class="item-links">
					${task.linked_pull_requests.slice(0, 3).map((pr) => `
						<button class="link-chip btn-ghost sm" data-command="codepinion.openExternalUrl" data-url="${escapeHtml(pr.web_url)}">
							<span class="chip" data-s="${escapeHtml(pr.status)}">#${pr.number}</span> ${escapeHtml(truncate(pr.title, 32))}
						</button>
					`).join("")}
				</div>` : ""}
				${task.linked_commits.length > 0 ? `
				<div class="item-links">
					${task.linked_commits.slice(0, 2).map((commit) => `
						<span class="commit-chip">
							<span class="mono">${escapeHtml(commit.sha.slice(0, 7))}</span>
							${escapeHtml(truncate(commit.message, 40))}
						</span>
					`).join("")}
				</div>` : ""}
				<div class="item-actions">
					<select aria-label="Update task status" class="inline-select" data-task-status="${task.id}">
						${buildOptions(TASK_STATUSES, task.status)}
					</select>
					<button class="btn-secondary sm" data-command="codepinion.dashboard.updateTaskStatus" data-task-id="${task.id}">Save</button>
					${canCreateBranch ? `<button class="btn-secondary sm" data-command="codepinion.dashboard.startTaskWork" data-task-id="${task.id}">Start Work</button>` : ""}
					<button class="btn-ghost sm" data-command="codepinion.openTaskById" data-task-id="${task.id}">Open ↗</button>
					<button class="btn-ghost sm" data-command="codepinion.dashboard.linkPrToTask" data-task-id="${task.id}">+ PR</button>
					<button class="btn-ghost sm" data-toggle="task-comments-${task.id}">💬</button>
					<button class="btn-ghost sm" data-command="codepinion.dashboard.deleteTask" data-task-id="${task.id}" title="Delete task">✕</button>
				</div>
				<div id="task-comments-${task.id}" class="create-form-wrap" style="display:none;">
					<form class="form-body" data-command="codepinion.dashboard.postTaskComment" data-task-id="${task.id}">
						<label>Comment <textarea name="body" rows="2" required placeholder="Add a comment…"></textarea></label>
						<div><button type="submit" class="btn-primary sm">Post</button></div>
					</form>
				</div>
			</li>
		`).join("")
		: `<li class="empty-li">No tasks loaded for this repository.</li>`;

	const chatHistory = snapshot.chatHistory ?? [];
	const chatBubblesMarkup = chatHistory.map((msg) =>
		`<div class="chat-bubble ${escapeHtml(msg.role)}">${escapeHtml(msg.content)}</div>`,
	).join("");
	const hasLastAssistant = chatHistory.some((m) => m.role === "assistant");

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${options.cspSource} https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>CodePinion</title>
	<style>
		:root {
			--bg: var(--vscode-editor-background);
			--panel: var(--vscode-editorWidget-background, var(--vscode-sideBar-background, var(--vscode-editor-background)));
			--border: var(--vscode-panel-border, rgba(128,128,128,0.2));
			--text: var(--vscode-editor-foreground);
			--muted: var(--vscode-descriptionForeground);
			--input-bg: var(--vscode-input-background);
			--input-fg: var(--vscode-input-foreground);
			--input-border: var(--vscode-input-border, rgba(128,128,128,0.35));
			--btn-bg: var(--vscode-button-background);
			--btn-fg: var(--vscode-button-foreground);
			--btn-hover: var(--vscode-button-hoverBackground, color-mix(in srgb, var(--vscode-button-background) 85%, white));
			--btn2-bg: var(--vscode-button-secondaryBackground, color-mix(in srgb, var(--vscode-button-background) 15%, var(--vscode-editor-background)));
			--btn2-fg: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
			--btn2-hover: var(--vscode-button-secondaryHoverBackground, color-mix(in srgb, var(--vscode-button-background) 25%, var(--vscode-editor-background)));
			--list-hover: var(--vscode-list-hoverBackground, rgba(128,128,128,0.07));
			--focus: var(--vscode-focusBorder, rgba(0,120,212,0.8));
			--err-bg: var(--vscode-inputValidation-errorBackground);
			--err-border: var(--vscode-inputValidation-errorBorder);
		}
		*, *::before, *::after { box-sizing: border-box; }
		body {
			margin: 0;
			font-family: var(--vscode-font-family);
			font-size: var(--vscode-font-size, 13px);
			background: var(--bg);
			color: var(--text);
			line-height: 1.5;
		}

		/* ── Header ─────────────────────────────────────────── */
		.header {
			position: sticky;
			top: 0;
			z-index: 10;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 8px 16px;
			background: var(--panel);
			border-bottom: 1px solid var(--border);
		}
		.header-left { display: flex; align-items: center; gap: 10px; }
		.header-icon { width: 24px; height: 24px; border-radius: 5px; flex-shrink: 0; }
		.header-name { font-size: 13px; font-weight: 600; }
		.header-user { font-size: 11px; color: var(--muted); }
		.header-actions { display: flex; align-items: center; gap: 6px; }

		/* ── Page ────────────────────────────────────────────── */
		.page { padding: 12px 16px; display: grid; gap: 10px; }

		/* ── Action strip ────────────────────────────────────── */
		.action-strip {
			display: flex;
			flex-wrap: wrap;
			gap: 5px;
			padding: 8px 10px;
			border: 1px solid var(--border);
			border-radius: 4px;
			background: var(--panel);
		}

		/* ── Context bar ─────────────────────────────────────── */
		.context-bar {
			display: flex;
			flex-wrap: wrap;
			border: 1px solid var(--border);
			border-radius: 4px;
			overflow: hidden;
		}
		.ctx-cell {
			flex: 1 1 140px;
			display: grid;
			gap: 2px;
			padding: 8px 12px;
			border-right: 1px solid var(--border);
			min-width: 0;
		}
		.ctx-cell:last-child { border-right: none; }
		.ctx-label {
			font-size: 10px;
			font-weight: 600;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--muted);
		}
		.ctx-value {
			font-size: 12px;
			font-weight: 500;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		/* ── Status chips ────────────────────────────────────── */
		.chip {
			display: inline-block;
			padding: 1px 6px;
			border-radius: 3px;
			font-size: 11px;
			font-weight: 500;
			white-space: nowrap;
		}
		.chip[data-s="active"],
		.chip[data-s="completed"] { background: rgba(76,175,80,0.15); color: #4caf50; }
		.chip[data-s="in_progress"] { background: rgba(74,158,255,0.15); color: #4a9eff; }
		.chip[data-s="in_review"] { background: rgba(185,102,231,0.15); color: #b966e7; }
		.chip[data-s="blocked"],
		.chip[data-s="cancelled"] { background: rgba(244,71,71,0.15); color: #f44747; }
		.chip[data-s="planning"] { background: rgba(230,185,58,0.12); color: #e6b93a; }
		.chip[data-s="backlog"],
		.chip[data-s="done"] { background: rgba(128,128,128,0.12); color: var(--muted); }
		.chip[data-s="critical"] { background: rgba(244,71,71,0.15); color: #f44747; }
		.chip[data-s="high"] { background: rgba(230,185,58,0.12); color: #e6b93a; }
		.chip[data-s="medium"],
		.chip[data-s="low"] { background: rgba(128,128,128,0.10); color: var(--muted); }

		/* ── Buttons ─────────────────────────────────────────── */
		button {
			display: inline-flex;
			align-items: center;
			gap: 5px;
			border: none;
			border-radius: 3px;
			padding: 5px 11px;
			background: var(--btn-bg);
			color: var(--btn-fg);
			cursor: pointer;
			font: inherit;
			font-size: var(--vscode-font-size, 13px);
			white-space: nowrap;
		}
		button:hover { background: var(--btn-hover); }
		button:focus-visible { outline: 1px solid var(--focus); outline-offset: 1px; }
		.btn-primary { background: var(--btn-bg); color: var(--btn-fg); }
		.btn-primary:hover { background: var(--btn-hover); }
		.btn-secondary { background: var(--btn2-bg); color: var(--btn2-fg); }
		.btn-secondary:hover { background: var(--btn2-hover); }
		.btn-ghost {
			background: transparent;
			color: var(--text);
			border: 1px solid var(--border);
		}
		.btn-ghost:hover { background: var(--list-hover); }
		.btn-icon {
			padding: 4px 7px;
			background: transparent;
			color: var(--muted);
			border: none;
			font-size: 15px;
		}
		.btn-icon:hover { background: var(--list-hover); color: var(--text); }
		button.sm { padding: 3px 8px; font-size: 11px; }

		/* ── Layout ──────────────────────────────────────────── */
		.layout {
			display: grid;
			grid-template-columns: minmax(0, 1.3fr) minmax(260px, 0.9fr);
			gap: 10px;
			align-items: start;
		}
		.column { display: grid; gap: 10px; }

		/* ── Sections ────────────────────────────────────────── */
		.section {
			border: 1px solid var(--border);
			border-radius: 4px;
			overflow: hidden;
		}
		.section-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 7px 12px;
			background: var(--panel);
			border-bottom: 1px solid var(--border);
		}
		.section-header + .section-header { border-top: 1px solid var(--border); }
		.eyebrow {
			font-size: 10px;
			font-weight: 600;
			letter-spacing: 0.06em;
			text-transform: uppercase;
			color: var(--muted);
		}
		.section-body {
			padding: 10px 12px;
			display: grid;
			gap: 8px;
		}
		.inline-actions { display: flex; gap: 4px; align-items: center; }

		/* ── Lists ───────────────────────────────────────────── */
		ul { list-style: none; margin: 0; padding: 0; }
		li {
			padding: 8px 12px;
			border-bottom: 1px solid var(--border);
			display: grid;
			gap: 4px;
		}
		li:last-child { border-bottom: none; }
		li:hover { background: var(--list-hover); }
		.list-wrap { max-height: 300px; overflow-y: auto; }
		.list-wrap::-webkit-scrollbar { width: 5px; }
		.list-wrap::-webkit-scrollbar-thumb {
			background: color-mix(in srgb, var(--muted) 35%, transparent);
			border-radius: 3px;
		}
		.item-title {
			font-size: 13px;
			font-weight: 500;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.item-meta { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
		.item-actions { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; margin-top: 2px; }
		.item-links { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 3px; }
		.meta-text { font-size: 11px; color: var(--muted); }
		.comment-badge { font-size: 11px; color: var(--muted); }
		.link-chip { font-size: 11px; gap: 4px; }
		.commit-chip {
			display: inline-flex;
			align-items: center;
			gap: 5px;
			font-size: 11px;
			color: var(--muted);
			padding: 1px 0;
		}
		.mono { font-family: var(--vscode-editor-font-family, monospace); font-size: 10px; }
		.empty-li {
			padding: 14px 12px;
			text-align: center;
			color: var(--muted);
			font-size: 12px;
			font-style: italic;
		}
		.empty-li:hover { background: transparent; }

		/* ── Sprint control ──────────────────────────────────── */
		.sprint-ctrl { display: flex; gap: 6px; align-items: center; }
		.sprint-ctrl .inline-select { flex: 1; }

		/* ── Inputs ──────────────────────────────────────────── */
		input, textarea, select {
			width: 100%;
			padding: 5px 8px;
			background: var(--input-bg);
			color: var(--input-fg, var(--text));
			border: 1px solid var(--input-border);
			border-radius: 3px;
			font: inherit;
			font-size: 12px;
		}
		input:focus, textarea:focus, select:focus {
			outline: 1px solid var(--focus);
			outline-offset: -1px;
			border-color: transparent;
		}
		textarea { min-height: 62px; resize: vertical; }
		textarea[readonly] {
			min-height: 160px;
			background: color-mix(in srgb, var(--input-bg) 60%, transparent);
		}
		.inline-select {
			width: auto;
			padding: 3px 6px;
			font-size: 11px;
		}
		label { display: grid; gap: 4px; font-size: 11px; color: var(--muted); }
		.field-grid {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			gap: 8px;
		}

		/* ── Collapsible creation forms ──────────────────────── */
		details.create-panel { border-top: 1px solid var(--border); }
		details.create-panel > summary {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 7px 12px;
			cursor: pointer;
			list-style: none;
			user-select: none;
			background: var(--panel);
			color: var(--muted);
		}
		details.create-panel > summary::-webkit-details-marker { display: none; }
		details.create-panel > summary:hover { background: var(--list-hover); color: var(--text); }
		details.create-panel > summary .toggle-icon { font-size: 13px; line-height: 1; flex-shrink: 0; }
		details[open].create-panel > summary .toggle-icon::before { content: "▾"; }
		details:not([open]).create-panel > summary .toggle-icon::before { content: "▸"; }
		.form-body {
			padding: 12px;
			display: grid;
			gap: 10px;
			background: color-mix(in srgb, var(--panel) 50%, transparent);
			border-top: 1px solid var(--border);
		}

		/* ── AI Chat ─────────────────────────────────────────── */
		.chat-messages {
			display: flex;
			flex-direction: column;
			gap: 6px;
			padding: 8px 12px;
			max-height: 280px;
			overflow-y: auto;
			border-bottom: 1px solid var(--border);
		}
		.chat-messages::-webkit-scrollbar { width: 5px; }
		.chat-messages::-webkit-scrollbar-thumb {
			background: color-mix(in srgb, var(--muted) 35%, transparent);
			border-radius: 3px;
		}
		.chat-bubble {
			padding: 7px 10px;
			border-radius: 4px;
			font-size: 12px;
			line-height: 1.55;
			white-space: pre-wrap;
			word-break: break-word;
		}
		.chat-bubble.user {
			background: color-mix(in srgb, var(--btn-bg) 15%, transparent);
			border: 1px solid color-mix(in srgb, var(--btn-bg) 30%, transparent);
			margin-left: 24px;
		}
		.chat-bubble.assistant {
			background: var(--panel);
			border: 1px solid var(--border);
			margin-right: 24px;
		}
		/* ── AI output (legacy prompt display) ──────────────── */
		.ai-result { border-top: 1px solid var(--border); }
		.ai-result-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: 7px 12px;
		}

		/* ── Misc ────────────────────────────────────────────── */
		.banner {
			padding: 8px 12px;
			border-radius: 3px;
			background: var(--err-bg);
			border: 1px solid var(--err-border);
			font-size: 12px;
		}
		.footer-meta {
			display: flex;
			flex-wrap: wrap;
			gap: 10px;
			padding: 7px 12px;
			border-top: 1px solid var(--border);
		}
		.footer-meta span { font-size: 11px; color: var(--muted); }
		.empty-text { margin: 0; font-size: 12px; color: var(--muted); font-style: italic; }

		@media (max-width: 900px) {
			.layout { grid-template-columns: 1fr; }
			.context-bar { flex-direction: column; }
			.ctx-cell { border-right: none; border-bottom: 1px solid var(--border); }
			.ctx-cell:last-child { border-bottom: none; }
			.field-grid { grid-template-columns: 1fr; }
		}

		/* ── Tab bar ──────────────────────────────────────── */
		.tab-bar {
			display: flex;
			background: var(--panel);
			border: 1px solid var(--border);
			border-radius: 4px 4px 0 0;
			border-bottom: none;
		}
		.tab-btn {
			padding: 8px 16px;
			background: transparent;
			color: var(--muted);
			border: none;
			border-bottom: 2px solid transparent;
			border-radius: 0;
			font-size: 12px;
			font-weight: 500;
			cursor: pointer;
			flex-shrink: 0;
		}
		.tab-btn:hover { color: var(--text); background: var(--list-hover); }
		.tab-btn.active { color: var(--text); border-bottom-color: var(--btn-bg); }
		.tab-panel { display: grid; gap: 10px; }

		/* ── API key warning banner ───────────────────────── */
		.banner-warn {
			padding: 7px 12px;
			border-radius: 3px;
			background: rgba(230,185,58,0.1);
			border: 1px solid rgba(230,185,58,0.35);
			font-size: 12px;
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
		}

		/* ── Inline toggle create forms ───────────────────── */
		.create-form-wrap {
			border-top: 1px solid var(--border);
			background: color-mix(in srgb, var(--panel) 50%, transparent);
		}

		/* ── Comments ─────────────────────────────────────── */
		.comment-list { border-top: 1px solid var(--border); }
		.comment-item {
			padding: 8px 12px;
			border-bottom: 1px solid var(--border);
			display: grid;
			gap: 3px;
		}
		.comment-item:last-child { border-bottom: none; }
		.comment-author { font-size: 11px; font-weight: 600; }
		.comment-body { margin: 0; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
	</style>
</head>
<body>
	<header class="header">
		<div class="header-left">
			<img src="${options.iconUri}" class="header-icon" alt="">
			<div>
				<div class="header-name">CodePinion</div>
				<div class="header-user">${userLabel}</div>
			</div>
		</div>
		<div class="header-actions">
			<button class="btn-icon" data-command="codepinion.refresh" title="Refresh">⟳</button>
			<button class="${snapshot.user ? "btn-ghost sm" : "btn-primary"}" data-command="${snapshot.user ? "codepinion.logout" : "codepinion.login"}">${snapshot.user ? "Sign Out" : "Sign In"}</button>
		</div>
	</header>

	<div class="page">
		${snapshot.errorMessage ? `<div class="banner">${escapeHtml(snapshot.errorMessage)}</div>` : ""}

		${!snapshot.user && !snapshot.hasPersonalAccessToken ? `
		<div class="banner-warn">
			<span>⚠ No personal access token configured for this VS Code profile.</span>
			<button class="btn-secondary sm" data-command="codepinion.setPersonalAccessToken">Set Token</button>
		</div>` : ""}

		<div class="context-bar">
			<div class="ctx-cell">
				<span class="ctx-label">Local Repo</span>
				<span class="ctx-value" title="${localRepoLabel}">${localRepoLabel}</span>
			</div>
			<div class="ctx-cell">
				<span class="ctx-label">Linked Repo</span>
				<span class="ctx-value" title="${linkedRepoLabel}">${linkedRepoLabel}</span>
			</div>
			<div class="ctx-cell">
				<span class="ctx-label">Sprint</span>
				<span class="ctx-value">
					${snapshot.planning?.currentSprint
						? `<span class="chip" data-s="${escapeHtml(snapshot.planning.currentSprint.status)}">${escapeHtml(snapshot.planning.currentSprint.name)}</span>`
						: `<span class="chip" data-s="backlog">None</span>`}
				</span>
			</div>
			<div class="ctx-cell">
				<span class="ctx-label">Current Task</span>
				<span class="ctx-value" title="${currentTaskLabel}">${currentTaskLabel}</span>
			</div>
		</div>

		<div class="tab-bar">
			<button class="tab-btn active" data-tab="repos">Repos</button>
			<button class="tab-btn" data-tab="planning">Planning</button>
			<button class="tab-btn" data-tab="ai">AI Chat</button>
		</div>

		<!-- Repos tab -->
		<div class="tab-panel" id="tab-repos">
			<div class="section">
				<div class="section-header">
					<span class="eyebrow">Repositories</span>
					<div class="inline-actions">
						<span class="meta-text">${snapshot.repositories.length} accessible</span>
						<button class="btn-ghost sm" data-command="codepinion.selectRepository">Search & Select</button>
						<button class="btn-ghost sm" data-command="codepinion.linkCurrentRepo">Link Local Repo</button>
					</div>
				</div>
				<div class="section-body" style="padding-top:0;">
					<label>
						<input id="repo-search-input" type="search" placeholder="Search repositories by name, owner, language, or status" />
					</label>
				</div>
				<div class="list-wrap">
					<ul id="repo-list">${repoMarkup}</ul>
				</div>
			</div>

			<div class="section">
				<div class="section-header">
					<span class="eyebrow">Workspace</span>
				</div>
				<div class="section-body">
					<div class="inline-actions">
						<button class="btn-secondary sm" data-command="codepinion.startWorkspace">Start or Resume</button>
						${(snapshot.workspace?.capabilities.can_run_terminal ?? true) ? `<button class="btn-ghost sm" data-command="codepinion.openWorkspaceTerminal">Open Terminal</button>` : ""}
					</div>
					<p class="empty-text">${escapeHtml(workspaceLabel)}</p>
					${snapshot.workspace?.last_opened_file_path ? `<p class="empty-text" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(snapshot.workspace.last_opened_file_path)}">Last file: <span class="mono">${escapeHtml(snapshot.workspace.last_opened_file_path)}</span></p>` : ""}
				</div>
				${branchPickerMarkup}
			</div>

			${snapshot.workspace ? `
			<div class="section">
				<div class="section-header">
					<span class="eyebrow">Git</span>
					<div class="inline-actions">
						<span class="meta-text">${escapeHtml(snapshot.workspaceGitStatus?.branch ?? snapshot.workspace.branch_name)}</span>
						<button class="btn-ghost sm" data-command="codepinion.dashboard.workspaceCheckout">Checkout</button>
						<button class="btn-ghost sm" data-command="codepinion.dashboard.workspaceCreateBranch">+ Branch</button>
					</div>
				</div>
				<div class="list-wrap">
					<ul>${gitStatusMarkup}</ul>
				</div>
				<div class="section-header">
					<span class="eyebrow">Commit</span>
					<button class="btn-ghost sm" data-toggle="workspace-commit-form">+ Commit</button>
				</div>
				<div id="workspace-commit-form" class="create-form-wrap" style="display:none;">
					<form class="form-body" data-command="codepinion.dashboard.workspaceCommit">
						<label>Message <textarea name="message" rows="3" required placeholder="Describe your changes…">${escapeHtml(snapshot.generatedAiPrompt ?? "")}</textarea></label>
						<div><button type="submit" class="btn-primary">Commit</button></div>
					</form>
				</div>
			</div>` : ""}
		</div>

		<!-- Planning tab -->
		<div class="tab-panel" id="tab-planning" style="display:none;">
			<div class="section">
				<div class="section-header">
					<span class="eyebrow">Planning</span>
					<div class="inline-actions">
						<button class="btn-ghost sm" data-command="codepinion.openCurrentTask">Open Current Task</button>
					</div>
				</div>

				<div class="section-body">
					<span class="eyebrow">Current Sprint</span>
					${sprintControlMarkup}
				</div>

				<div class="section-header">
					<span class="eyebrow">Recent Tasks</span>
					<div class="inline-actions">
						<span class="meta-text">${snapshot.planning?.tasks.length ?? 0} loaded</span>
						<button class="btn-ghost sm" data-toggle="create-task-form">+ Task</button>
					</div>
				</div>
				<div id="create-task-form" class="create-form-wrap" style="display:none;">
					<form class="form-body" data-command="codepinion.dashboard.createTask">
						<label>Title <input name="title" required placeholder="Implement task actions in dashboard"/></label>
						<label>Description <textarea name="description" placeholder="Scope, acceptance criteria, notes"></textarea></label>
						<div class="field-grid">
							<label>Sprint <select name="sprintId">${sprintOptions}</select></label>
							<label>Priority <select name="priority">${buildOptions(PRIORITIES, "medium")}</select></label>
							<label>Status <select name="status">${buildOptions(TASK_STATUSES, "backlog")}</select></label>
							<label>Branch <input name="branchName" value="${escapeHtml(snapshot.localRepo?.branchName ?? "")}" placeholder="tasks/feature-name"/></label>
							<label>Codebase area <input name="codebaseArea" placeholder="extension/dashboard"/></label>
							<label>Story points <input name="storyPoints" type="number" min="0" value="1"/></label>
							<label>Effort hours <input name="effortHours" type="number" min="0" value="1"/></label>
							<label>Due date <input name="dueDate" type="date"/></label>
							<label>Assignee IDs <input name="assigneeIds" placeholder="1,2"/></label>
						</div>
						<div><button type="submit" class="btn-primary">Create Task</button></div>
					</form>
				</div>
				<div class="list-wrap">
					<ul>${taskMarkup}</ul>
				</div>

				<div class="section-header">
					<span class="eyebrow">Current Task Goals</span>
					<div class="inline-actions">
						<span class="meta-text">${currentGoalCount}</span>
						<button class="btn-ghost sm" data-toggle="create-goal-form">+ Goal</button>
					</div>
				</div>
				<div id="create-goal-form" class="create-form-wrap" style="display:none;">
					<form class="form-body" data-command="codepinion.dashboard.createGoal">
						<label>Title <input name="title" required placeholder="Wire status update action"/></label>
						<label>Description <textarea name="description" placeholder="Goal-level detail or checklist item"></textarea></label>
						<div class="field-grid">
							<label>Task <select name="taskId">${taskOptions}</select></label>
							<label>Priority <select name="priority">${buildOptions(PRIORITIES, "medium")}</select></label>
							<label>Status <select name="status">${buildOptions(TASK_STATUSES, "backlog")}</select></label>
							<label>Branch <input name="branchName" value="${escapeHtml(snapshot.planning?.currentTask?.branch_name_snapshot || snapshot.localRepo?.branchName || "")}" placeholder="tasks/feature-name"/></label>
							<label>Order <input name="order" type="number" min="0" value="${currentGoalCount}"/></label>
							<label>Due date <input name="dueDate" type="date"/></label>
						</div>
						<div><button type="submit" class="btn-primary">Create Goal</button></div>
					</form>
				</div>
				<div class="list-wrap">
					<ul>${goalsMarkup}</ul>
				</div>

				<div class="section-header">
					<span class="eyebrow">Task Comments</span>
					<div class="inline-actions">
						<span class="meta-text">${currentTaskCommentCount}</span>
						<button class="btn-ghost sm" data-toggle="task-comments-panel">+ Comment</button>
					</div>
				</div>
				<div id="task-comments-panel" class="create-form-wrap" style="display:none;">
					<form class="form-body" data-command="codepinion.dashboard.postTaskComment" data-task-id="${snapshot.planning?.currentTask?.id ?? 0}">
						<label>Comment <textarea name="body" rows="2" required placeholder="Add a comment on the current task…"></textarea></label>
						<div><button type="submit" class="btn-primary sm">Post</button></div>
					</form>
				</div>
				${currentTaskCommentCount > 0 ? `<div class="comment-list">${taskCommentsMarkup}</div>` : ""}

				<div class="section-header">
					<span class="eyebrow">Epics</span>
					<div class="inline-actions">
						<span class="meta-text">${snapshot.planning?.epics.length ?? 0}</span>
						<button class="btn-ghost sm" data-toggle="create-epic-form">+ Epic</button>
					</div>
				</div>
				<div id="create-epic-form" class="create-form-wrap" style="display:none;">
					<form class="form-body" data-command="codepinion.dashboard.createEpic">
						<label>Title <input name="title" required placeholder="Auth system overhaul"/></label>
						<label>Description <textarea name="description" placeholder="Epic-level scope and objective"></textarea></label>
						<div class="field-grid">
							<label>Sprint <select name="sprintId">${sprintOptions}</select></label>
							<label>Status <select name="status">${buildOptions(["active", "completed", "cancelled"], "active")}</select></label>
							<label>Order <input name="order" type="number" min="0" value="0"/></label>
						</div>
						<div><button type="submit" class="btn-primary">Create Epic</button></div>
					</form>
				</div>
				<div class="list-wrap">
					<ul>${epicsMarkup}</ul>
				</div>

				<div class="section-header">
					<span class="eyebrow">New Sprint</span>
					<button class="btn-ghost sm" data-toggle="create-sprint-form">+ Sprint</button>
				</div>
				<div id="create-sprint-form" class="create-form-wrap" style="display:none;">
					<form class="form-body" data-command="codepinion.dashboard.createSprint">
						<label>Name <input name="name" required placeholder="Sprint 12"/></label>
						<label>Description <textarea name="description" placeholder="What this sprint is trying to ship"></textarea></label>
						<div class="field-grid">
							<label>Status <select name="status">${buildOptions(SPRINT_STATUSES, "planning")}</select></label>
							<label>Goal <input name="goal" placeholder="Ship interactive extension dashboard"/></label>
							<label>Start date <input name="startDate" type="date"/></label>
							<label>End date <input name="endDate" type="date"/></label>
						</div>
						<div><button type="submit" class="btn-primary">Create Sprint</button></div>
					</form>
				</div>
			</div>
		</div>

		<!-- AI Chat tab -->
		<div class="tab-panel" id="tab-ai" style="display:none;">
			<div class="section">
				<div class="section-header">
					<span class="eyebrow">AI Chat</span>
					${chatHistory.length > 0 ? `<button class="btn-ghost sm" data-command="codepinion.dashboard.clearChat">Clear</button>` : ""}
				</div>
				${chatHistory.length > 0 ? `<div id="chat-messages" class="chat-messages">${chatBubblesMarkup}</div>` : ""}
				<div id="chat-stream" class="chat-bubble assistant" style="display:none;margin:8px 12px;"></div>
				<div class="section-body" style="gap:6px;">
					<form id="chat-form" data-command="codepinion.dashboard.chatSend">
						<label>
							<textarea name="question" id="chat-input" rows="5" required placeholder="Ask about the current file, task, or codebase…"></textarea>
						</label>
						<div class="inline-actions" style="margin-top:6px;">
							<button type="submit" class="btn-primary" id="chat-send">Send</button>
							<button type="button" class="btn-ghost sm" data-command="codepinion.askAiAboutCurrentFile">Prompt Editor</button>
						</div>
					</form>
					${hasLastAssistant ? `
					<div class="inline-actions">
						<button class="btn-secondary sm" id="copy-last-response">Copy Last Response</button>
						<button class="btn-ghost sm" data-command="codepinion.dashboard.openAiPromptDocument">Open in Editor</button>
					</div>` : ""}
				</div>
			</div>
		</div>

	</div>

	<script nonce="${nonce}">
		const vscode = acquireVsCodeApi();

		function postAction(command, extra) {
			vscode.postMessage(Object.assign({ command }, extra));
		}

		function collectFormPayload(form) {
			return Object.fromEntries(new FormData(form).entries());
		}

		document.querySelectorAll("[data-command]").forEach(function(el) {
			el.addEventListener("click", function() {
				var command = el.getAttribute("data-command");
				if (!command) { return; }

				if (command === "codepinion.dashboard.updateTaskStatus") {
					var taskId = Number(el.getAttribute("data-task-id"));
					var sel = document.querySelector('[data-task-status="' + taskId + '"]');
					postAction(command, { taskId: taskId, payload: { status: sel ? sel.value : "" } });
					return;
				}
				if (command === "codepinion.dashboard.startTaskWork" || command === "codepinion.openTaskById") {
					postAction(command, { taskId: Number(el.getAttribute("data-task-id")) });
					return;
				}
				if (command === "codepinion.openExternalUrl") {
					postAction(command, { url: el.getAttribute("data-url") });
					return;
				}
				if (command === "codepinion.dashboard.updateGoalStatus") {
					var goalId = Number(el.getAttribute("data-goal-id"));
					var sel = document.querySelector('[data-goal-status="' + goalId + '"]');
					postAction(command, { goalId: goalId, payload: { status: sel ? sel.value : "" } });
					return;
				}
				if (command === "codepinion.dashboard.updateSprintStatus") {
					var sprintId = Number(el.getAttribute("data-sprint-id"));
					var sel = document.querySelector('[data-sprint-status="' + sprintId + '"]');
					postAction(command, { sprintId: sprintId, payload: { status: sel ? sel.value : "" } });
					return;
				}
				if (command === "codepinion.dashboard.updateEpicStatus") {
					var epicId = Number(el.getAttribute("data-epic-id"));
					var sel = document.querySelector('[data-epic-status="' + epicId + '"]');
					postAction(command, { epicId: epicId, payload: { status: sel ? sel.value : "" } });
					return;
				}
				if (command === "codepinion.dashboard.deleteTask") {
					postAction(command, { taskId: Number(el.getAttribute("data-task-id")) });
					return;
				}
				if (command === "codepinion.dashboard.deleteGoal") {
					postAction(command, { goalId: Number(el.getAttribute("data-goal-id")) });
					return;
				}
				if (command === "codepinion.dashboard.deleteEpic") {
					postAction(command, { epicId: Number(el.getAttribute("data-epic-id")) });
					return;
				}
				if (command === "codepinion.dashboard.deleteSprint") {
					postAction(command, { sprintId: Number(el.getAttribute("data-sprint-id")) });
					return;
				}
				if (command === "codepinion.dashboard.linkPrToTask") {
					postAction(command, { taskId: Number(el.getAttribute("data-task-id")) });
					return;
				}

				postAction(command, {
					repositoryId: el.hasAttribute("data-repository-id") ? Number(el.getAttribute("data-repository-id")) : undefined,
				});
			});
		});

		document.querySelectorAll("form[data-command]").forEach(function(form) {
			form.addEventListener("submit", function(event) {
				event.preventDefault();
				var command = form.getAttribute("data-command");
				if (!command) { return; }
				var extra = { payload: collectFormPayload(form) };
				var rawTaskId = form.getAttribute("data-task-id");
				var rawGoalId = form.getAttribute("data-goal-id");
				if (rawTaskId) { extra.taskId = Number(rawTaskId); }
				if (rawGoalId) { extra.goalId = Number(rawGoalId); }
				postAction(command, extra);
			});
		});

		// Chat form: disable button during streaming
		var chatForm = document.getElementById("chat-form");
		if (chatForm) {
			chatForm.addEventListener("submit", function() {
				var btn = document.getElementById("chat-send");
				var stream = document.getElementById("chat-stream");
				if (btn) { btn.disabled = true; btn.textContent = "Thinking…"; }
				if (stream) { stream.textContent = ""; }
			});
		}

		// Copy last response (client-side)
		var copyLastBtn = document.getElementById("copy-last-response");
		if (copyLastBtn) {
			copyLastBtn.addEventListener("click", function() {
				var bubbles = document.querySelectorAll(".chat-bubble.assistant");
				var last = bubbles[bubbles.length - 1];
				if (last) { navigator.clipboard.writeText(last.textContent || ""); }
			});
		}

		// Receive streaming tokens from the extension host
		window.addEventListener("message", function(event) {
			var data = event.data;
			if (!data || !data.type) { return; }
			var stream = document.getElementById("chat-stream");
			var btn = document.getElementById("chat-send");
			if (data.type === "chat.delta" && stream) {
				stream.style.display = "";
				stream.textContent += data.delta;
				stream.scrollIntoView({ block: "end", behavior: "smooth" });
			} else if (data.type === "chat.done") {
				if (stream) { stream.style.display = "none"; stream.textContent = ""; }
				if (btn) { btn.disabled = false; btn.textContent = "Send"; }
				var input = document.getElementById("chat-input");
				if (input) { input.value = ""; }
			} else if (data.type === "chat.error") {
				if (stream) {
					stream.style.display = "";
					stream.textContent = "⚠ " + (data.error || "AI error");
				}
				if (btn) { btn.disabled = false; btn.textContent = "Send"; }
			}
		});

		// Scroll chat to bottom on load
		var chatMessages = document.getElementById("chat-messages");
		if (chatMessages) { chatMessages.scrollTop = chatMessages.scrollHeight; }

		// Tab switching
		document.querySelectorAll(".tab-btn").forEach(function(btn) {
			btn.addEventListener("click", function() {
				var targetTab = btn.getAttribute("data-tab");
				document.querySelectorAll(".tab-btn").forEach(function(b) { b.classList.remove("active"); });
				document.querySelectorAll(".tab-panel").forEach(function(p) { p.style.display = "none"; });
				btn.classList.add("active");
				var panel = document.getElementById("tab-" + targetTab);
				if (panel) { panel.style.display = ""; }
			});
		});

		var repoSearchInput = document.getElementById("repo-search-input");
		if (repoSearchInput) {
			repoSearchInput.addEventListener("input", function() {
				var query = String(repoSearchInput.value || "").trim().toLowerCase();
				document.querySelectorAll(".repo-item").forEach(function(item) {
					var haystack = String(item.getAttribute("data-repo-search") || "");
					item.style.display = !query || haystack.includes(query) ? "" : "none";
				});
			});
		}

		// Inline create form toggles
		document.querySelectorAll("[data-toggle]").forEach(function(btn) {
			btn.addEventListener("click", function() {
				var targetId = btn.getAttribute("data-toggle");
				var target = document.getElementById(targetId);
				if (target) { target.style.display = target.style.display === "none" ? "" : "none"; }
			});
		});
	</script>
</body>
</html>`;
}

function statusChip(value: string): string {
	return `<span class="chip" data-s="${escapeHtml(value)}">${escapeHtml(labelize(value))}</span>`;
}

function formatRelativeTime(isoString: string): string {
	const diffMs = Date.now() - new Date(isoString).getTime();
	const diffMin = Math.floor(diffMs / 60000);
	if (diffMin < 1) { return "just now"; }
	if (diffMin < 60) { return `${diffMin}m ago`; }
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) { return `${diffHr}h ago`; }
	return `${Math.floor(diffHr / 24)}d ago`;
}

function truncate(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function buildEpicOptions(epics: EpicRecord[], currentSprintId?: number | null): string {
	const filtered = currentSprintId ? epics.filter((e) => e.sprint === currentSprintId) : epics;
	if (filtered.length === 0) {
		return `<option value="">No epics in current sprint</option>`;
	}
	return filtered.map((epic) => `
		<option value="${epic.id}">${escapeHtml(epic.title)}</option>
	`).join("");
}

function buildSprintOptions(sprints: SprintRecord[], selectedId?: number | null): string {
	if (sprints.length === 0) {
		return `<option value="">Create a sprint first</option>`;
	}
	return sprints.map((sprint) => `
		<option value="${sprint.id}"${selectedId === sprint.id ? " selected" : ""}>
			${escapeHtml(`${sprint.name} · ${sprint.status}`)}
		</option>
	`).join("");
}

function buildTaskOptions(tasks: TaskRecord[], selectedId?: number | null): string {
	if (tasks.length === 0) {
		return `<option value="">Create a task first</option>`;
	}
	return tasks.map((task) => `
		<option value="${task.id}"${selectedId === task.id ? " selected" : ""}>
			${escapeHtml(`${task.title} · ${task.status}`)}
		</option>
	`).join("");
}

function buildOptions(values: readonly string[], selectedValue: string): string {
	return values.map((value) => `
		<option value="${value}"${selectedValue === value ? " selected" : ""}>${escapeHtml(labelize(value))}</option>
	`).join("");
}

function labelize(value: string): string {
	return value
		.split("_")
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function createNonce(): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let value = "";
	for (let index = 0; index < 24; index += 1) {
		value += alphabet[Math.floor(Math.random() * alphabet.length)];
	}
	return value;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}
