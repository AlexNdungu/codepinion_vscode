import * as vscode from "vscode";

import type { RepositoryRecord, TaskRecord, WorkspaceRecord } from "../api/types";
import type { LocalRepoContext } from "../bridge/git";

export type StatusSnapshot = {
	isAuthenticated: boolean;
	localRepo: LocalRepoContext | null;
	repository: RepositoryRecord | null;
	workspace: WorkspaceRecord | null;
	task: TaskRecord | null;
};

export class StatusBarController implements vscode.Disposable {
	private readonly authItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	private readonly repoItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	private readonly workspaceItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
	private readonly taskItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);

	constructor() {
		this.authItem.command = "codepinion.login";
		this.repoItem.command = "codepinion.linkCurrentRepo";
		this.workspaceItem.command = "codepinion.startWorkspace";
		this.taskItem.command = "codepinion.openCurrentTask";
	}

	update(snapshot: StatusSnapshot): void {
		this.authItem.text = snapshot.isAuthenticated ? "$(account) CodePinion" : "$(account) Sign in";
		this.authItem.tooltip = snapshot.isAuthenticated ? "Signed in to CodePinion." : "Sign in to CodePinion.";
		this.authItem.show();

		this.repoItem.text = snapshot.repository
			? `$(repo) ${snapshot.repository.full_name}`
			: snapshot.localRepo
				? `$(repo) ${snapshot.localRepo.workspaceFolder.name}`
				: "$(repo) No repo";
		this.repoItem.tooltip = snapshot.repository
			? `Linked repo: ${snapshot.repository.full_name}`
			: snapshot.localRepo
				? "Link the current repo to CodePinion."
				: "Open a git repo to link it to CodePinion.";
		this.repoItem.show();

		this.workspaceItem.text = snapshot.workspace
			? `$(server-environment) ${snapshot.workspace.status}`
			: "$(server-environment) Workspace";
		this.workspaceItem.tooltip = snapshot.workspace
			? `Workspace #${snapshot.workspace.id} on ${snapshot.workspace.branch_name}`
			: "Start or resume a CodePinion workspace.";
		this.workspaceItem.show();

		this.taskItem.text = snapshot.task ? `$(checklist) ${snapshot.task.title}` : "$(checklist) No task";
		this.taskItem.tooltip = snapshot.task
			? `Current branch task: ${snapshot.task.title}`
			: "No task matches the current branch.";
		this.taskItem.show();
	}

	dispose(): void {
		this.authItem.dispose();
		this.repoItem.dispose();
		this.workspaceItem.dispose();
		this.taskItem.dispose();
	}
}

