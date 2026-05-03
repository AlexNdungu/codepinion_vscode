import type { GoalRecord, RepositoryRecord, SprintRecord, TaskRecord, WorkspaceRecord } from "../api/types";
import type { LocalRepoContext } from "../bridge/git";

export type AiPromptContext = {
	question: string;
	filePath: string;
	selectionText: string;
	localRepo: LocalRepoContext | null;
	repository: RepositoryRecord | null;
	workspace: WorkspaceRecord | null;
	task: TaskRecord | null;
	goals: GoalRecord[];
	sprint: SprintRecord | null;
};

export function buildAiPrompt(context: AiPromptContext): string {
	const lines = [
		"# CodePinion AI Prompt",
		"",
		"Use the following CodePinion editor context to answer the user's question.",
		"",
		`Question: ${context.question}`,
		"",
		"## Repository Context",
		`- Local repo root: ${context.localRepo?.repoRoot ?? "Not detected"}`,
		`- Local branch: ${context.localRepo?.branchName ?? "Unknown"}`,
		`- CodePinion repo: ${context.repository?.full_name ?? "Not linked"}`,
		`- Workspace status: ${context.workspace?.status ?? "No active workspace"}`,
		`- Workspace branch: ${context.workspace?.branch_name ?? "N/A"}`,
		"",
		"## Planning Context",
		`- Current sprint: ${context.sprint ? `${context.sprint.name} (${context.sprint.status})` : "None"}`,
		`- Current task: ${context.task ? `${context.task.title} (${context.task.status})` : "None"}`,
	];

	if (context.goals.length > 0) {
		lines.push(`- Goals: ${context.goals.map((goal) => `${goal.title} (${goal.status})`).join(", ")}`);
	} else {
		lines.push("- Goals: None");
	}

	lines.push(
		"",
		"## File Context",
		`- File: ${context.filePath || "No active file"}`,
		"",
		"## Selected Code",
		context.selectionText || "No explicit selection.",
	);

	return lines.join("\n");
}

