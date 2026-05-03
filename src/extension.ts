import * as vscode from "vscode";

import { buildAiPrompt } from "./ai/promptBuilder";
import { FrontendAiClient } from "./ai/frontendAiClient";
import { getLocalBranchDiff, getStagedDiff } from "./ai/gitHelpers";
import { CodePinionApiError, CodePinionClient } from "./api/client";
import type { BranchRecord, CodePinionUser, EpicRecord, GoalRecord, RepositoryRecord, SprintRecord, TaskRecord, WorkspaceRecord } from "./api/types";
import { SessionStore } from "./auth/sessionStore";
import { detectLocalRepo, type LocalRepoContext } from "./bridge/git";
import { RepoLinkStore } from "./bridge/repoLinkStore";
import { scoreRepositoriesForLocalRepo } from "./bridge/repoMatcher";
import { CodePinionDashboardPanel, type DashboardAction } from "./dashboard/panel";
import { StatusBarController } from "./status/statusBarController";
import { CodePinionTerminal } from "./terminal/codepinionTerminal";
import { SimpleTreeProvider, type TreeNode } from "./views/treeProvider";

type PlanningState = {
	sprints: SprintRecord[];
	epics: EpicRecord[];
	tasks: TaskRecord[];
	currentTask: TaskRecord | null;
	currentGoals: GoalRecord[];
	currentSprint: SprintRecord | null;
};

type ExtensionSnapshot = {
	user: CodePinionUser | null;
	hasFrontendApiKey: boolean;
	localRepo: LocalRepoContext | null;
	repositories: RepositoryRecord[];
	linkedRepository: RepositoryRecord | null;
	workspace: WorkspaceRecord | null;
	workspaceBranches: BranchRecord[];
	planning: PlanningState | null;
	generatedAiPrompt: string | null;
	errorMessage: string | null;
};

class CodePinionExtensionController implements vscode.Disposable {
	private readonly sessionStore: SessionStore;
	private readonly client: CodePinionClient;
	private readonly repoLinkStore: RepoLinkStore;
	private readonly statusBar: StatusBarController;
	private readonly reposProvider: SimpleTreeProvider;
	private readonly workspaceProvider: SimpleTreeProvider;
	private readonly planningProvider: SimpleTreeProvider;
	private readonly aiProvider: SimpleTreeProvider;
	private readonly dashboardPanel: CodePinionDashboardPanel;
	private readonly frontendAiClient: FrontendAiClient;
	private dashboardGeneratedAiPrompt: string | null = null;
	private dashboardChatHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
	private snapshot: ExtensionSnapshot = {
		user: null,
		hasFrontendApiKey: false,
		localRepo: null,
		repositories: [],
		linkedRepository: null,
		workspace: null,
		workspaceBranches: [],
		planning: null,
		generatedAiPrompt: null,
		errorMessage: null,
	};

	constructor(private readonly context: vscode.ExtensionContext) {
		this.sessionStore = new SessionStore(context.secrets, context.globalState);
		this.client = new CodePinionClient(this.sessionStore, () => this.readConfiguredBackendUrl());
		this.repoLinkStore = new RepoLinkStore(context.globalState);
		this.statusBar = new StatusBarController();
		this.reposProvider = new SimpleTreeProvider(() => this.buildReposNodes());
		this.workspaceProvider = new SimpleTreeProvider(() => this.buildWorkspaceNodes());
		this.planningProvider = new SimpleTreeProvider(() => this.buildPlanningNodes());
		this.aiProvider = new SimpleTreeProvider(() => this.buildAiNodes());
		this.dashboardPanel = new CodePinionDashboardPanel(this.context.extensionUri, (action) => this.handleDashboardAction(action));
		this.frontendAiClient = new FrontendAiClient(() => this.readConfiguredAppUrl());
	}

	register(): void {
		this.context.subscriptions.push(
			this.statusBar,
			this.dashboardPanel,
			vscode.window.registerTreeDataProvider("codepinion.repos", this.reposProvider),
			vscode.window.registerTreeDataProvider("codepinion.workspace", this.workspaceProvider),
			vscode.window.registerTreeDataProvider("codepinion.planning", this.planningProvider),
			vscode.window.registerTreeDataProvider("codepinion.ai", this.aiProvider),
			vscode.commands.registerCommand("codepinion.login", () => this.login()),
			vscode.commands.registerCommand("codepinion.logout", () => this.logout()),
			vscode.commands.registerCommand("codepinion.setFrontendApiKey", () => this.setFrontendApiKey()),
			vscode.commands.registerCommand("codepinion.linkCurrentRepo", () => this.linkCurrentRepo()),
			vscode.commands.registerCommand("codepinion.startWorkspace", () => this.startWorkspace()),
			vscode.commands.registerCommand("codepinion.openWorkspaceTerminal", () => this.openWorkspaceTerminal()),
			vscode.commands.registerCommand("codepinion.openCurrentTask", () => this.openCurrentTask()),
			vscode.commands.registerCommand("codepinion.askAiAboutCurrentFile", () => this.askAiAboutCurrentFile()),
			vscode.commands.registerCommand("codepinion.openDashboard", () => this.openDashboard()),
			vscode.commands.registerCommand("codepinion.refresh", () => this.refresh()),
			vscode.commands.registerCommand("codepinion.openExternalUrl", (url?: string) => {
				if (url) { void vscode.env.openExternal(vscode.Uri.parse(url)); }
			}),
			vscode.commands.registerCommand("codepinion.generateStandup", () => this.generateStandup()),
			vscode.commands.registerCommand("codepinion.sprintBreakdown", () => this.sprintBreakdown()),
			vscode.commands.registerCommand("codepinion.generateCommitMessage", () => this.generateCommitMessage()),
			vscode.commands.registerCommand("codepinion.generatePrDescription", () => this.generatePrDescription()),
			vscode.workspace.onDidChangeWorkspaceFolders(() => {
				void this.refresh();
			}),
			vscode.window.onDidChangeWindowState(() => {
				void this.refresh();
			}),
		);

		void this.refresh();
	}

	dispose(): void {
		// Disposables are registered through context subscriptions.
	}

	private async login(): Promise<void> {
		const frontendApiKey = await this.ensureFrontendApiKey();
		if (!frontendApiKey) {
			return;
		}

		const email = await vscode.window.showInputBox({
			prompt: "CodePinion account email",
			ignoreFocusOut: true,
			placeHolder: "you@example.com",
			validateInput: (value) => value.trim() ? undefined : "Email is required.",
		});
		if (!email) {
			return;
		}

		const password = await vscode.window.showInputBox({
			prompt: "CodePinion password",
			ignoreFocusOut: true,
			password: true,
			validateInput: (value) => value.trim() ? undefined : "Password is required.",
		});
		if (!password) {
			return;
		}

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Signing in to CodePinion",
			},
			async () => {
				try {
					const user = await this.client.login(email.trim(), password, frontendApiKey.trim());
					vscode.window.showInformationMessage(`Signed in to CodePinion as ${user.email}.`);
					await this.refresh();
				} catch (error) {
					this.handleError(error, "Could not sign in to CodePinion.");
				}
			},
		);
	}

	private async logout(): Promise<void> {
		try {
			await this.client.logout();
			this.dashboardGeneratedAiPrompt = null;
			vscode.window.showInformationMessage("Signed out of CodePinion.");
			await this.refresh();
		} catch (error) {
			this.handleError(error, "Could not sign out of CodePinion.");
		}
	}

	private async openDashboard(): Promise<void> {
		this.dashboardPanel.show(this.buildDashboardSnapshot());
	}

	private async setFrontendApiKey(): Promise<void> {
		const currentValue = await this.sessionStore.getFrontendApiKey();
		const frontendApiKey = await vscode.window.showInputBox({
			prompt: "CodePinion frontend API key",
			ignoreFocusOut: true,
			password: true,
			placeHolder: "cp_frontend_...",
			value: currentValue ?? "",
			validateInput: (value) => value.trim() ? undefined : "A frontend API key is required.",
		});
		if (!frontendApiKey) {
			return;
		}

		await this.sessionStore.storeFrontendApiKey(frontendApiKey.trim());
		vscode.window.showInformationMessage("Saved the CodePinion frontend API key for this VS Code profile.");
		await this.refresh();
	}

	private async ensureFrontendApiKey(): Promise<string | null> {
		const storedKey = await this.sessionStore.getFrontendApiKey();
		if (storedKey?.trim()) {
			return storedKey.trim();
		}

		const frontendApiKey = await vscode.window.showInputBox({
			prompt: "CodePinion frontend API key",
			ignoreFocusOut: true,
			password: true,
			placeHolder: "cp_frontend_...",
			validateInput: (value) => value.trim() ? undefined : "A frontend API key is required.",
		});
		if (!frontendApiKey) {
			return null;
		}

		const normalizedKey = frontendApiKey.trim();
		await this.sessionStore.storeFrontendApiKey(normalizedKey);
		return normalizedKey;
	}

	private async linkCurrentRepo(): Promise<void> {
		if (!(await this.ensureSignedIn())) {
			return;
		}

		const localRepo = await detectLocalRepo();
		if (!localRepo) {
			vscode.window.showErrorMessage("Open a local git repository in VS Code first.");
			return;
		}

		let repositories: RepositoryRecord[];
		try {
			repositories = await this.client.listRepositories();
		} catch (error) {
			this.handleError(error, "Could not load CodePinion repositories.");
			return;
		}

		if (repositories.length === 0) {
			vscode.window.showErrorMessage("No accessible CodePinion repositories were found for this account.");
			return;
		}

		const scored = scoreRepositoriesForLocalRepo(localRepo, repositories);
		const quickPickItems = repositories.map((repository) => {
			const match = scored.find((candidate) => candidate.repository.id === repository.id);
			return {
				label: repository.full_name,
				description: repository.description || repository.language || repository.status,
				detail: match ? `Likely match: ${match.reasons.join(", ")}` : "Manual link",
				repository,
			};
		}).sort((left, right) => {
			const leftScore = scored.find((candidate) => candidate.repository.id === left.repository.id)?.score ?? 0;
			const rightScore = scored.find((candidate) => candidate.repository.id === right.repository.id)?.score ?? 0;
			return rightScore - leftScore || left.label.localeCompare(right.label);
		});

		const selected = await vscode.window.showQuickPick(quickPickItems, {
			title: "Link local repo to CodePinion",
			ignoreFocusOut: true,
			matchOnDescription: true,
			matchOnDetail: true,
		});
		if (!selected) {
			return;
		}

		await this.repoLinkStore.saveLink(localRepo, selected.repository);
		vscode.window.showInformationMessage(`Linked ${localRepo.workspaceFolder.name} to ${selected.repository.full_name}.`);
		await this.refresh();
	}

	private async startWorkspace(): Promise<void> {
		const linkedRepository = this.snapshot.linkedRepository;
		const localRepo = this.snapshot.localRepo;
		if (!(await this.ensureLinkedRepo(linkedRepository, localRepo))) {
			return;
		}
		if (!linkedRepository || !localRepo) {
			return;
		}

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Starting CodePinion workspace",
			},
			async () => {
				try {
					const workspace = await this.client.createOrResumeWorkspace(
						linkedRepository.id,
						localRepo.branchName || linkedRepository.default_branch,
					);
					await this.repoLinkStore.updateWorkspaceId(localRepo, workspace.id);
					vscode.window.showInformationMessage(
						`Workspace #${workspace.id} is ${workspace.status} on ${workspace.branch_name}.`,
					);
					await this.refresh();
				} catch (error) {
					this.handleError(error, "Could not start or resume the CodePinion workspace.");
				}
			},
		);
	}

	private async openWorkspaceTerminal(): Promise<void> {
		const workspace = this.snapshot.workspace;
		const linkedRepository = this.snapshot.linkedRepository;
		const localRepo = this.snapshot.localRepo;
		if (!(await this.ensureLinkedRepo(linkedRepository, localRepo))) {
			return;
		}
		if (!linkedRepository || !localRepo) {
			return;
		}

		const activeWorkspace = workspace ?? await this.startWorkspaceAndReturn();
		if (!activeWorkspace) {
			return;
		}

		const session = await this.client.ensureSession().catch((error) => {
			this.handleError(error, "Sign in before opening a CodePinion terminal.");
			return null;
		});
		if (!session) {
			return;
		}

		const terminal = vscode.window.createTerminal({
			name: `CodePinion: ${linkedRepository.full_name}`,
			pty: new CodePinionTerminal({
				client: this.client,
				workspaceId: activeWorkspace.id,
					workspaceLabel: linkedRepository.full_name,
					backendUrl: this.readConfiguredBackendUrl(),
				accessToken: session.accessToken,
				frontendApiKey: session.frontendApiKey,
			}),
		});
		terminal.show();
	}

	private async openCurrentTask(): Promise<void> {
		const task = this.snapshot.planning?.currentTask;
		if (!task) {
			vscode.window.showErrorMessage("No CodePinion task matches the current branch.");
			return;
		}
		await this.openTask(task);
	}

	private async askAiAboutCurrentFile(): Promise<void> {
		const question = await vscode.window.showInputBox({
			prompt: "What do you want CodePinion AI to help with?",
			ignoreFocusOut: true,
			placeHolder: "Explain this file in the context of the current task",
			validateInput: (value) => value.trim() ? undefined : "A question is required.",
		});
		if (!question) {
			return;
		}

		const prompt = this.buildAiPrompt(question);
		await this.publishAiPrompt(prompt, true);
	}

	private buildAiPrompt(question: string): string {
		const editor = vscode.window.activeTextEditor;
		return buildAiPrompt({
			question,
			filePath: editor?.document.uri.fsPath ?? "",
			selectionText: editor?.selection && !editor.selection.isEmpty
				? editor.document.getText(editor.selection)
				: "",
			localRepo: this.snapshot.localRepo,
			repository: this.snapshot.linkedRepository,
			workspace: this.snapshot.workspace,
			task: this.snapshot.planning?.currentTask ?? null,
			goals: this.snapshot.planning?.currentGoals ?? [],
			sprint: this.snapshot.planning?.currentSprint ?? null,
		});
	}

	private async publishAiPrompt(prompt: string, openInEditor: boolean): Promise<void> {
		this.dashboardGeneratedAiPrompt = prompt;
		this.snapshot = {
			...this.snapshot,
			generatedAiPrompt: prompt,
		};
		await vscode.env.clipboard.writeText(prompt);
		if (openInEditor) {
			const document = await vscode.workspace.openTextDocument({
				content: prompt,
				language: "markdown",
			});
			await vscode.window.showTextDocument(document, { preview: false });
		}
		this.dashboardPanel.update(this.buildDashboardSnapshot());
		vscode.window.showInformationMessage("Prepared a CodePinion AI prompt and copied it to your clipboard.");
	}

	private async refresh(): Promise<void> {
		const localRepo = await detectLocalRepo();
		const user = this.sessionStore.getStoredUser();

		const nextSnapshot: ExtensionSnapshot = {
			user,
			hasFrontendApiKey: Boolean(await this.sessionStore.getFrontendApiKey()),
			localRepo,
			repositories: [],
			linkedRepository: null,
			workspace: null,
			workspaceBranches: [],
			planning: null,
			generatedAiPrompt: this.dashboardGeneratedAiPrompt,
			errorMessage: null,
		};

		const hasSession = await this.sessionStore.getSessionSecrets();
		if (hasSession) {
			try {
				nextSnapshot.user = user ?? await this.client.getCurrentUser();
				nextSnapshot.repositories = await this.client.listRepositories();
			} catch (error) {
				nextSnapshot.errorMessage = error instanceof Error ? error.message : "Could not load CodePinion state.";
			}
		}

		if (localRepo && nextSnapshot.repositories.length > 0) {
			const link = this.repoLinkStore.getLink(localRepo);
			nextSnapshot.linkedRepository = link
				? nextSnapshot.repositories.find((repository) => repository.id === link.repositoryId) ?? null
				: null;

			if (nextSnapshot.linkedRepository && link?.workspaceId) {
				try {
					nextSnapshot.workspace = await this.client.getWorkspace(link.workspaceId);
					if (nextSnapshot.workspace?.status === "ready" || nextSnapshot.workspace?.status === "idle") {
						nextSnapshot.workspaceBranches = await this.client.listWorkspaceBranches(nextSnapshot.workspace.id).catch(() => []);
					}
				} catch (error) {
					if (!(error instanceof CodePinionApiError && error.status === 404)) {
						nextSnapshot.errorMessage = error instanceof Error ? error.message : nextSnapshot.errorMessage;
					}
				}
			}

			if (nextSnapshot.linkedRepository) {
				try {
					nextSnapshot.planning = await this.loadPlanningState(nextSnapshot.linkedRepository, localRepo.branchName);
				} catch (error) {
					if (!nextSnapshot.errorMessage) {
						nextSnapshot.errorMessage = error instanceof Error ? error.message : "Could not load planning state.";
					}
				}
			}
		}

		this.snapshot = nextSnapshot;
		this.reposProvider.refresh();
		this.workspaceProvider.refresh();
		this.planningProvider.refresh();
		this.aiProvider.refresh();
		this.dashboardPanel.update(this.buildDashboardSnapshot());
		this.statusBar.update({
			isAuthenticated: Boolean(nextSnapshot.user),
			localRepo: nextSnapshot.localRepo,
			repository: nextSnapshot.linkedRepository,
			workspace: nextSnapshot.workspace,
			task: nextSnapshot.planning?.currentTask ?? null,
		});
	}

	private async loadPlanningState(repository: RepositoryRecord, branchName: string): Promise<PlanningState> {
		const [sprints, epics] = await Promise.all([
			this.client.listSprints(repository.id),
			this.client.listEpics(repository.id),
		]);
		const tasksNested = await Promise.all(sprints.map((sprint) => this.client.listTasks(sprint.id)));
		const tasks = tasksNested.flat();
		const currentTask = tasks.find((task) => task.branch_name_snapshot === branchName) ?? null;
		const currentGoals = currentTask ? await this.client.listGoals(currentTask.id) : [];
		const currentSprint = currentTask
			? sprints.find((sprint) => sprint.id === currentTask.sprint) ?? null
			: sprints.find((sprint) => sprint.status === "active") ?? sprints.find((sprint) => sprint.status === "planning") ?? null;

		return {
			sprints,
			epics,
			tasks,
			currentTask,
			currentGoals,
			currentSprint,
		};
	}

	private buildReposNodes(): TreeNode[] {
		const nodes: TreeNode[] = [actionNode("Open Dashboard", "codepinion.openDashboard", "dashboard")];

		if (!this.snapshot.user) {
			nodes.push(actionNode("Sign in to CodePinion", "codepinion.login", "account"));
			nodes.push(actionNode("Set Frontend API Key", "codepinion.setFrontendApiKey", "key"));
			return nodes;
		}

		if (this.snapshot.localRepo) {
			nodes.push({
				label: this.snapshot.localRepo.workspaceFolder.name,
				description: this.snapshot.localRepo.branchName,
				tooltip: this.snapshot.localRepo.originUrl || this.snapshot.localRepo.repoRoot,
				iconPath: new vscode.ThemeIcon("repo"),
				children: [
					leafNode("Repo root", this.snapshot.localRepo.repoRoot, "folder"),
					leafNode("Origin", this.snapshot.localRepo.originUrl || "No origin remote detected", "link"),
				],
			});
		} else {
			nodes.push(leafNode("Open a local git repo to link it.", undefined, "warning"));
		}

		if (this.snapshot.linkedRepository) {
			nodes.push({
				label: "Linked Repo",
				description: this.snapshot.linkedRepository.full_name,
				iconPath: new vscode.ThemeIcon("plug"),
				children: [
					leafNode("Visibility", this.snapshot.linkedRepository.visibility, "eye"),
					leafNode("Default branch", this.snapshot.linkedRepository.default_branch, "git-branch"),
				],
			});
		} else if (this.snapshot.localRepo) {
			nodes.push(actionNode("Link current repo", "codepinion.linkCurrentRepo", "plug"));
		}

		if (this.snapshot.repositories.length > 0) {
			nodes.push({
				label: "Accessible Repos",
				description: `${this.snapshot.repositories.length}`,
				iconPath: new vscode.ThemeIcon("repo-clone"),
				children: this.snapshot.repositories.slice(0, 8).map((repository) =>
					leafNode(repository.full_name, repository.description || repository.language || repository.status, "repo")),
			});
		}

		return withErrorNode(nodes, this.snapshot.errorMessage);
	}

	private buildWorkspaceNodes(): TreeNode[] {
		const nodes: TreeNode[] = [actionNode("Open Dashboard", "codepinion.openDashboard", "dashboard")];
		if (!this.snapshot.user) {
			nodes.push(actionNode("Sign in to start a workspace", "codepinion.login", "account"));
			return nodes;
		}
		if (!this.snapshot.linkedRepository) {
			nodes.push(actionNode("Link the current repo first", "codepinion.linkCurrentRepo", "plug"));
			return nodes;
		}

		nodes.push(actionNode("Start or resume workspace", "codepinion.startWorkspace", "server-environment"));
		nodes.push(actionNode("Open workspace terminal", "codepinion.openWorkspaceTerminal", "terminal"));

		if (this.snapshot.workspace) {
			nodes.push({
				label: `Workspace #${this.snapshot.workspace.id}`,
				description: this.snapshot.workspace.status,
				iconPath: new vscode.ThemeIcon("server-environment"),
				children: [
					leafNode("Branch", this.snapshot.workspace.branch_name, "git-branch"),
					leafNode("Runtime", this.snapshot.workspace.runtime_identifier || "Not assigned", "vm"),
					leafNode("Profile", this.snapshot.workspace.execution_profile, "gear"),
				],
			});
		} else {
			nodes.push(leafNode("No active CodePinion workspace yet.", undefined, "circle-slash"));
		}

		return withErrorNode(nodes, this.snapshot.errorMessage);
	}

	private buildPlanningNodes(): TreeNode[] {
		const dashboardNode = actionNode("Open Dashboard", "codepinion.openDashboard", "dashboard");
		const planning = this.snapshot.planning;
		if (!this.snapshot.user) {
			return [dashboardNode, actionNode("Sign in to load planning", "codepinion.login", "account")];
		}
		if (!this.snapshot.linkedRepository) {
			return [dashboardNode, actionNode("Link the current repo first", "codepinion.linkCurrentRepo", "plug")];
		}
		if (!planning) {
			return withErrorNode([dashboardNode, leafNode("Planning context is not available yet.", undefined, "clock")], this.snapshot.errorMessage);
		}

		const nodes: TreeNode[] = [dashboardNode];
		if (planning.currentTask) {
			nodes.push({
				label: planning.currentTask.title,
				description: planning.currentTask.status,
				command: {
					command: "codepinion.openCurrentTask",
					title: "Open current task",
				},
				iconPath: new vscode.ThemeIcon("checklist"),
				children: [
					leafNode("Branch", planning.currentTask.branch_name_snapshot || "N/A", "git-branch"),
					leafNode("Priority", planning.currentTask.priority, "arrow-up"),
					leafNode("PR links", `${planning.currentTask.linked_pull_requests.length}`, "git-pull-request"),
					leafNode("Commit links", `${planning.currentTask.linked_commits.length}`, "git-commit"),
				],
			});
		} else {
			nodes.push(leafNode("No task matches the current branch.", undefined, "circle-slash"));
		}

		if (planning.currentSprint) {
			nodes.push(leafNode("Current sprint", `${planning.currentSprint.name} (${planning.currentSprint.status})`, "project"));
		}
		if (planning.currentGoals.length > 0) {
			nodes.push({
				label: "Goals",
				description: `${planning.currentGoals.length}`,
				iconPath: new vscode.ThemeIcon("list-selection"),
				children: planning.currentGoals.map((goal) => leafNode(goal.title, goal.status, "target")),
			});
		}
		nodes.push(leafNode("Sprints loaded", `${planning.sprints.length}`, "project"));
		nodes.push(leafNode("Tasks loaded", `${planning.tasks.length}`, "checklist"));
		if (planning.epics.length > 0) {
			nodes.push({
				label: "Epics",
				description: `${planning.epics.length}`,
				iconPath: new vscode.ThemeIcon("layers"),
				children: planning.epics.map((epic) => leafNode(epic.title, epic.status, "symbol-class")),
			});
		}
		return withErrorNode(nodes, this.snapshot.errorMessage);
	}

	private buildAiNodes(): TreeNode[] {
		const nodes: TreeNode[] = [
			actionNode("Open Dashboard", "codepinion.openDashboard", "dashboard"),
			actionNode("Set Frontend API Key", "codepinion.setFrontendApiKey", "key"),
			actionNode("Ask AI About Current File", "codepinion.askAiAboutCurrentFile", "sparkle"),
			actionNode("Generate Daily Standup", "codepinion.generateStandup", "comment-discussion"),
			actionNode("AI Sprint Breakdown", "codepinion.sprintBreakdown", "layers"),
			actionNode("Generate Commit Message", "codepinion.generateCommitMessage", "git-commit"),
			actionNode("Generate PR Description", "codepinion.generatePrDescription", "git-pull-request"),
		];

		if (this.snapshot.linkedRepository) {
			nodes.push(leafNode("Repo context", this.snapshot.linkedRepository.full_name, "repo"));
		}
		if (this.snapshot.planning?.currentTask) {
			nodes.push(leafNode("Task context", this.snapshot.planning.currentTask.title, "checklist"));
		}
		if (this.snapshot.workspace) {
			nodes.push(leafNode("Workspace context", `${this.snapshot.workspace.status} on ${this.snapshot.workspace.branch_name}`, "server-environment"));
		}

		return withErrorNode(nodes, this.snapshot.errorMessage);
	}

	private async ensureSignedIn(): Promise<boolean> {
		const session = await this.sessionStore.getSessionSecrets();
		if (session?.accessToken) {
			return true;
		}
		vscode.window.showErrorMessage("Sign in to CodePinion first.");
		return false;
	}

	private async ensureLinkedRepo(
		linkedRepository: RepositoryRecord | null,
		localRepo: LocalRepoContext | null,
	): Promise<boolean> {
		if (!(await this.ensureSignedIn())) {
			return false;
		}
		if (!localRepo) {
			vscode.window.showErrorMessage("Open a local git repository in VS Code first.");
			return false;
		}
		if (!linkedRepository) {
			vscode.window.showErrorMessage("Link the current repo to CodePinion first.");
			return false;
		}
		return true;
	}

	private async startWorkspaceAndReturn(): Promise<WorkspaceRecord | null> {
		const linkedRepository = this.snapshot.linkedRepository;
		const localRepo = this.snapshot.localRepo;
		if (!(await this.ensureLinkedRepo(linkedRepository, localRepo))) {
			return null;
		}
		if (!linkedRepository || !localRepo) {
			return null;
		}

		try {
			const workspace = await this.client.createOrResumeWorkspace(linkedRepository.id, localRepo.branchName || linkedRepository.default_branch);
			await this.repoLinkStore.updateWorkspaceId(localRepo, workspace.id);
			await this.refresh();
			return workspace;
		} catch (error) {
			this.handleError(error, "Could not start or resume the CodePinion workspace.");
			return null;
		}
	}

	private async linkRepositoryById(repositoryId: number): Promise<void> {
		if (!(await this.ensureSignedIn())) {
			return;
		}

		const localRepo = this.snapshot.localRepo ?? await detectLocalRepo();
		if (!localRepo) {
			vscode.window.showErrorMessage("Open a local git repository in VS Code first.");
			return;
		}

		const repository = this.snapshot.repositories.find((candidate) => candidate.id === repositoryId);
		if (!repository) {
			vscode.window.showErrorMessage("That CodePinion repository is not available in the current session.");
			return;
		}

		await this.repoLinkStore.saveLink(localRepo, repository);
		vscode.window.showInformationMessage(`Linked ${localRepo.workspaceFolder.name} to ${repository.full_name}.`);
		await this.refresh();
	}

	private async openTask(task: TaskRecord): Promise<void> {
		const sprint = this.snapshot.planning?.sprints.find((candidate) => candidate.id === task.sprint)
			?? this.snapshot.planning?.currentSprint
			?? null;
		if (sprint) {
			await vscode.env.openExternal(
				vscode.Uri.parse(`${this.readConfiguredAppUrl().replace(/\/+$/, "")}/planning/${sprint.id}/tasks/${task.id}`),
			);
			return;
		}

		const document = await vscode.workspace.openTextDocument({
			content: [
				`Task: ${task.title}`,
				`Status: ${task.status}`,
				`Priority: ${task.priority}`,
				`Branch: ${task.branch_name_snapshot || "N/A"}`,
				"",
				task.description || "No description.",
			].join("\n"),
			language: "markdown",
		});
		await vscode.window.showTextDocument(document, { preview: true });
	}

	private async createSprintFromDashboard(payload: Record<string, unknown>): Promise<void> {
		const repository = this.snapshot.linkedRepository;
		if (!(await this.ensureLinkedRepo(repository, this.snapshot.localRepo)) || !repository) {
			return;
		}

		const today = new Date();
		const startDate = readString(payload, "startDate") || formatDate(today);
		const endDate = readString(payload, "endDate") || formatDate(new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000));
		const name = readString(payload, "name");
		if (!name) {
			vscode.window.showErrorMessage("Sprint name is required.");
			return;
		}

		await this.client.createSprint({
			repository: repository.id,
			name,
			description: readString(payload, "description") ?? "",
			status: readString(payload, "status") ?? "planning",
			start_date: startDate,
			end_date: endDate,
			goal: readString(payload, "goal") ?? "",
		});
		vscode.window.showInformationMessage(`Created sprint "${name}".`);
		await this.refresh();
	}

	private async createTaskFromDashboard(payload: Record<string, unknown>): Promise<void> {
		const repository = this.snapshot.linkedRepository;
		if (!(await this.ensureLinkedRepo(repository, this.snapshot.localRepo)) || !repository) {
			return;
		}

		const title = readString(payload, "title");
		if (!title) {
			vscode.window.showErrorMessage("Task title is required.");
			return;
		}

		const sprintId = readNumber(payload, "sprintId") ?? this.snapshot.planning?.currentSprint?.id ?? null;
		if (!sprintId) {
			vscode.window.showErrorMessage("Create a sprint first or select an existing sprint.");
			return;
		}

		const assigneeIdsRaw = readString(payload, "assigneeIds") ?? "";
		const assigneeIds = assigneeIdsRaw
			.split(",")
			.map((s) => Number(s.trim()))
			.filter((n) => Number.isFinite(n) && n > 0);

		await this.client.createTask({
			sprint: sprintId,
			repository: repository.id,
			title,
			description: readString(payload, "description") ?? "",
			status: readString(payload, "status") ?? "backlog",
			priority: readString(payload, "priority") ?? "medium",
			branch_name_snapshot: readString(payload, "branchName") ?? this.snapshot.localRepo?.branchName ?? "",
			due_date: readString(payload, "dueDate") || null,
			codebase_area: readString(payload, "codebaseArea") ?? "",
			story_points: readNumber(payload, "storyPoints") ?? 0,
			effort_estimate_hours: readNumber(payload, "effortHours") ?? 0,
			assignee_ids: assigneeIds.length > 0 ? assigneeIds : undefined,
		});
		vscode.window.showInformationMessage(`Created task "${title}".`);
		await this.refresh();
	}

	private async createGoalFromDashboard(payload: Record<string, unknown>): Promise<void> {
		const repository = this.snapshot.linkedRepository;
		if (!(await this.ensureLinkedRepo(repository, this.snapshot.localRepo)) || !repository) {
			return;
		}

		const title = readString(payload, "title");
		if (!title) {
			vscode.window.showErrorMessage("Goal title is required.");
			return;
		}

		const taskId = readNumber(payload, "taskId") ?? this.snapshot.planning?.currentTask?.id ?? null;
		if (!taskId) {
			vscode.window.showErrorMessage("Choose a task before creating a goal.");
			return;
		}

		const selectedTask = this.snapshot.planning?.tasks.find((task) => task.id === taskId) ?? null;
		const branchName = readString(payload, "branchName")
			?? selectedTask?.branch_name_snapshot
			?? this.snapshot.localRepo?.branchName
			?? "";

		await this.client.createGoal({
			task: taskId,
			repository: repository.id,
			branch_name: branchName,
			title,
			description: readString(payload, "description") ?? "",
			status: readString(payload, "status") ?? "backlog",
			priority: readString(payload, "priority") ?? "medium",
			order: readNumber(payload, "order") ?? 0,
			due_date: readString(payload, "dueDate") || null,
		});
		vscode.window.showInformationMessage(`Created goal "${title}".`);
		await this.refresh();
	}

	private async updateSprintStatusFromDashboard(sprintId: number, payload: Record<string, unknown>): Promise<void> {
		const status = readString(payload, "status");
		if (!status) {
			vscode.window.showErrorMessage("Sprint status is required.");
			return;
		}

		await this.client.updateSprint(sprintId, { status });
		vscode.window.showInformationMessage("Updated sprint status.");
		await this.refresh();
	}

	private async updateTaskStatusFromDashboard(taskId: number, payload: Record<string, unknown>): Promise<void> {
		const status = readString(payload, "status");
		if (!status) {
			vscode.window.showErrorMessage("Task status is required.");
			return;
		}

		await this.client.updateTask(taskId, { status });
		vscode.window.showInformationMessage("Updated task status.");
		await this.refresh();
	}

	private async updateGoalStatusFromDashboard(goalId: number, payload: Record<string, unknown>): Promise<void> {
		const status = readString(payload, "status");
		if (!status) {
			vscode.window.showErrorMessage("Goal status is required.");
			return;
		}

		await this.client.updateGoal(goalId, { status });
		vscode.window.showInformationMessage("Updated goal status.");
		await this.refresh();
	}

	private async createEpicFromDashboard(payload: Record<string, unknown>): Promise<void> {
		const repository = this.snapshot.linkedRepository;
		if (!(await this.ensureLinkedRepo(repository, this.snapshot.localRepo)) || !repository) {
			return;
		}

		const title = readString(payload, "title");
		if (!title) {
			vscode.window.showErrorMessage("Epic title is required.");
			return;
		}

		const sprintId = readNumber(payload, "sprintId") ?? this.snapshot.planning?.currentSprint?.id ?? null;
		if (!sprintId) {
			vscode.window.showErrorMessage("Select a sprint for this epic.");
			return;
		}

		await this.client.createEpic({
			sprint: sprintId,
			repository: repository.id,
			title,
			description: readString(payload, "description") ?? "",
			status: readString(payload, "status") ?? "active",
			order: readNumber(payload, "order") ?? 0,
		});
		vscode.window.showInformationMessage(`Created epic "${title}".`);
		await this.refresh();
	}

	private async updateEpicStatusFromDashboard(epicId: number, payload: Record<string, unknown>): Promise<void> {
		const status = readString(payload, "status");
		if (!status) {
			vscode.window.showErrorMessage("Epic status is required.");
			return;
		}

		await this.client.updateEpic(epicId, { status });
		vscode.window.showInformationMessage("Updated epic status.");
		await this.refresh();
	}

	private async startTaskWorkById(taskId: number): Promise<void> {
		if (!(await this.ensureLinkedRepo(this.snapshot.linkedRepository, this.snapshot.localRepo))) {
			return;
		}

		const response = await this.client.startTaskWork(taskId);
		if (this.snapshot.localRepo) {
			await this.repoLinkStore.updateWorkspaceId(this.snapshot.localRepo, response.workspace.id);
		}
		vscode.window.showInformationMessage(
			`Started work on ${response.task.title} using branch ${response.branch_name}. Workspace #${response.workspace.id} is ${response.workspace.status}.`,
		);
		await this.refresh();
	}

	private async generateDashboardAiPrompt(payload: Record<string, unknown>): Promise<void> {
		const question = readString(payload, "question");
		if (!question) {
			vscode.window.showErrorMessage("Enter a question for CodePinion AI.");
			return;
		}

		const prompt = this.buildAiPrompt(question);
		await this.publishAiPrompt(prompt, false);
	}

	private async copyDashboardAiPrompt(): Promise<void> {
		if (!this.dashboardGeneratedAiPrompt) {
			vscode.window.showErrorMessage("Generate an AI prompt first.");
			return;
		}
		await vscode.env.clipboard.writeText(this.dashboardGeneratedAiPrompt);
		vscode.window.showInformationMessage("Copied the generated AI prompt.");
	}

	private async openDashboardAiPromptDocument(): Promise<void> {
		const lastAssistant = [...this.dashboardChatHistory].reverse().find((m) => m.role === "assistant");
		const content = lastAssistant?.content ?? this.dashboardGeneratedAiPrompt;
		if (!content) {
			vscode.window.showErrorMessage("Start a chat or generate a prompt first.");
			return;
		}
		const document = await vscode.workspace.openTextDocument({
			content,
			language: "markdown",
		});
		await vscode.window.showTextDocument(document, { preview: false });
	}

	private async handleChatSend(payload: Record<string, unknown>): Promise<void> {
		const question = readString(payload, "question");
		if (!question) {
			this.dashboardPanel.sendToWebview({ type: "chat.error", error: "Question is required." });
			return;
		}

		this.dashboardChatHistory.push({ role: "user", content: question });

		const snap = this.snapshot;
		const context: Record<string, unknown> = {};
		if (snap.localRepo) { context.localRepo = snap.localRepo; }
		if (snap.linkedRepository) { context.repository = snap.linkedRepository; }
		if (snap.workspace) { context.workspace = snap.workspace; }
		if (snap.planning?.currentTask) { context.task = snap.planning.currentTask; }
		if (snap.planning?.currentGoals.length) { context.goals = snap.planning.currentGoals; }
		if (snap.planning?.currentSprint) { context.sprint = snap.planning.currentSprint; }

		const messages = this.dashboardChatHistory.map((m) => ({ role: m.role, content: m.content }));
		let fullText = "";
		try {
			for await (const delta of this.frontendAiClient.chatStream(messages, context)) {
				fullText += delta;
				this.dashboardPanel.sendToWebview({ type: "chat.delta", delta });
			}
			this.dashboardChatHistory.push({ role: "assistant", content: fullText });
			this.dashboardPanel.sendToWebview({ type: "chat.done", fullText });
			this.dashboardPanel.update(this.buildDashboardSnapshot());
		} catch (error) {
			this.dashboardChatHistory.pop();
			const message = error instanceof Error ? error.message : "AI chat error";
			this.dashboardPanel.sendToWebview({ type: "chat.error", error: message });
		}
	}

	private clearDashboardChat(): void {
		this.dashboardChatHistory = [];
		this.dashboardPanel.update(this.buildDashboardSnapshot());
	}

	private async generateStandup(): Promise<void> {
		const planning = this.snapshot.planning;
		if (!planning) {
			vscode.window.showErrorMessage("Load a linked repository with planning data first.");
			return;
		}

		const completedTasks = planning.tasks.filter((t) => t.status === "done").map((t) => t.title);
		const inProgressTasks = planning.tasks.filter((t) => t.status === "in_progress").map((t) => t.title);
		const blockedTasks = planning.tasks.filter((t) => t.status === "blocked").map((t) => t.title);

		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: "Generating standup…" },
			async () => {
				try {
					const result = await this.frontendAiClient.sprintAction("standup", {
						completedTasks,
						inProgressTasks,
						blockers: blockedTasks,
						sprintName: planning.currentSprint?.name,
					});
					const summary = typeof (result.result as Record<string, unknown>)?.summary === "string"
						? (result.result as Record<string, unknown>).summary as string
						: JSON.stringify(result.result, null, 2);
					await vscode.env.clipboard.writeText(summary);
					void vscode.window.showInformationMessage("Standup copied to clipboard.", "Open in Editor").then((choice) => {
						if (choice === "Open in Editor") {
							void vscode.workspace.openTextDocument({ content: summary, language: "markdown" })
								.then((doc) => vscode.window.showTextDocument(doc, { preview: false }));
						}
					});
				} catch (error) {
					this.handleError(error, "Could not generate standup.");
				}
			},
		);
	}

	private async sprintBreakdown(): Promise<void> {
		const prdText = await vscode.window.showInputBox({
			prompt: "Paste a PRD or feature description for AI sprint breakdown",
			ignoreFocusOut: true,
			placeHolder: "As a user I want to…",
			validateInput: (value) => value.trim() ? undefined : "A description is required.",
		});
		if (!prdText) { return; }

		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: "Generating sprint breakdown…" },
			async () => {
				try {
					const result = await this.frontendAiClient.sprintAction("breakdown", { prdText });
					const content = JSON.stringify(result.result, null, 2);
					const document = await vscode.workspace.openTextDocument({ content, language: "json" });
					await vscode.window.showTextDocument(document, { preview: false });
				} catch (error) {
					this.handleError(error, "Could not generate sprint breakdown.");
				}
			},
		);
	}

	private async generateCommitMessage(): Promise<void> {
		const repoRoot = this.snapshot.localRepo?.repoRoot;
		if (!repoRoot) {
			vscode.window.showErrorMessage("No local git repository detected.");
			return;
		}

		let diff: string;
		try {
			diff = await getStagedDiff(repoRoot);
		} catch {
			vscode.window.showErrorMessage("Could not read staged diff.");
			return;
		}
		if (!diff.trim()) {
			vscode.window.showErrorMessage("No staged changes found. Stage some changes first.");
			return;
		}

		const task = this.snapshot.planning?.currentTask;
		const goals = this.snapshot.planning?.currentGoals ?? [];
		const contextLines = [
			`Staged diff (truncated):\n\`\`\`diff\n${diff}\n\`\`\``,
			task ? `Current task: ${task.title}` : "",
			goals.length > 0 ? `Goals: ${goals.map((g) => g.title).join(", ")}` : "",
		].filter(Boolean);

		const prompt = [
			"Write a short git commit message for these changes.",
			"Use the imperative mood. One subject line only, under 72 characters. No body.",
			"",
			...contextLines,
		].join("\n");

		let message = "";
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: "Generating commit message…" },
			async () => {
				try {
					for await (const delta of this.frontendAiClient.chatStream(
						[{ role: "user", content: prompt }],
						{},
					)) {
						message += delta;
					}
				} catch (error) {
					this.handleError(error, "Could not generate commit message.");
				}
			},
		);

		if (!message.trim()) { return; }

		const edited = await vscode.window.showInputBox({
			prompt: "AI-generated commit message — edit before using",
			value: message.trim(),
			ignoreFocusOut: true,
		});
		if (edited) {
			await vscode.env.clipboard.writeText(edited);
			vscode.window.showInformationMessage("Commit message copied to clipboard.");
		}
	}

	private async generatePrDescription(): Promise<void> {
		const localRepo = this.snapshot.localRepo;
		const linkedRepository = this.snapshot.linkedRepository;
		if (!localRepo) {
			vscode.window.showErrorMessage("No local git repository detected.");
			return;
		}

		const base = linkedRepository?.default_branch ?? "main";
		let diff: string;
		try {
			diff = await getLocalBranchDiff(localRepo.repoRoot, base);
		} catch {
			vscode.window.showErrorMessage(`Could not read branch diff against ${base}.`);
			return;
		}
		if (!diff.trim()) {
			vscode.window.showErrorMessage(`No commits ahead of ${base}.`);
			return;
		}

		const task = this.snapshot.planning?.currentTask;
		const contextLines = [
			`Branch diff against ${base} (truncated):\n\`\`\`diff\n${diff}\n\`\`\``,
			task ? `Task: ${task.title}` : "",
			task?.description ? `Task description: ${task.description}` : "",
			linkedRepository ? `Repository: ${linkedRepository.full_name}` : "",
		].filter(Boolean);

		const prompt = [
			"Write a pull request description for these changes.",
			"Include a short summary paragraph and bullet-point key changes. Use markdown.",
			"",
			...contextLines,
		].join("\n");

		let description = "";
		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: "Generating PR description…" },
			async () => {
				try {
					for await (const delta of this.frontendAiClient.chatStream(
						[{ role: "user", content: prompt }],
						{},
					)) {
						description += delta;
					}
				} catch (error) {
					this.handleError(error, "Could not generate PR description.");
				}
			},
		);

		if (!description.trim()) { return; }
		const document = await vscode.workspace.openTextDocument({ content: description, language: "markdown" });
		await vscode.window.showTextDocument(document, { preview: false });
	}

	private handleError(error: unknown, fallbackMessage: string): void {
		const message = error instanceof Error ? error.message : fallbackMessage;
		vscode.window.showErrorMessage(message || fallbackMessage);
	}

	private buildDashboardSnapshot() {
		return {
			...this.snapshot,
			chatHistory: this.dashboardChatHistory,
			backendUrl: this.readConfiguredBackendUrl(),
			appUrl: this.readConfiguredAppUrl(),
		};
	}

	private readConfiguredBackendUrl(): string {
		return vscode.workspace.getConfiguration("codepinion").get<string>("backendUrl", "http://127.0.0.1:8000");
	}

	private readConfiguredAppUrl(): string {
		return vscode.workspace.getConfiguration("codepinion").get<string>("appUrl", "http://localhost:3000");
	}

	private async handleDashboardAction(action: DashboardAction): Promise<void> {
		try {
			if (action.command === "codepinion.refresh") {
				await this.refresh();
				return;
			}
			if (action.command === "codepinion.openExternalUrl") {
				const url = typeof action.payload?.url === "string" ? action.payload.url : undefined;
				if (url) { await vscode.env.openExternal(vscode.Uri.parse(url)); }
				return;
			}
			if (action.command === "codepinion.linkRepository" && typeof action.repositoryId === "number") {
				await this.linkRepositoryById(action.repositoryId);
				return;
			}
			if (action.command === "codepinion.openTaskById" && typeof action.taskId === "number") {
				const task = this.snapshot.planning?.tasks.find((candidate) => candidate.id === action.taskId) ?? null;
				if (!task) {
					vscode.window.showErrorMessage("That task is not available in the current dashboard state.");
					return;
				}
				await this.openTask(task);
				return;
			}
			if (action.command === "codepinion.dashboard.createSprint") {
				await this.createSprintFromDashboard(action.payload ?? {});
				return;
			}
			if (action.command === "codepinion.dashboard.createTask") {
				await this.createTaskFromDashboard(action.payload ?? {});
				return;
			}
			if (action.command === "codepinion.dashboard.createGoal") {
				await this.createGoalFromDashboard(action.payload ?? {});
				return;
			}
			if (action.command === "codepinion.dashboard.createEpic") {
				await this.createEpicFromDashboard(action.payload ?? {});
				return;
			}
			if (action.command === "codepinion.dashboard.updateEpicStatus" && typeof action.epicId === "number") {
				await this.updateEpicStatusFromDashboard(action.epicId, action.payload ?? {});
				return;
			}
			if (action.command === "codepinion.dashboard.updateSprintStatus" && typeof action.sprintId === "number") {
				await this.updateSprintStatusFromDashboard(action.sprintId, action.payload ?? {});
				return;
			}
			if (action.command === "codepinion.dashboard.updateTaskStatus" && typeof action.taskId === "number") {
				await this.updateTaskStatusFromDashboard(action.taskId, action.payload ?? {});
				return;
			}
			if (action.command === "codepinion.dashboard.updateGoalStatus" && typeof action.goalId === "number") {
				await this.updateGoalStatusFromDashboard(action.goalId, action.payload ?? {});
				return;
			}
			if (action.command === "codepinion.dashboard.startTaskWork" && typeof action.taskId === "number") {
				await this.startTaskWorkById(action.taskId);
				return;
			}
			if (action.command === "codepinion.dashboard.generateAiPrompt") {
				await this.generateDashboardAiPrompt(action.payload ?? {});
				return;
			}
			if (action.command === "codepinion.dashboard.copyAiPrompt") {
				await this.copyDashboardAiPrompt();
				return;
			}
			if (action.command === "codepinion.dashboard.openAiPromptDocument") {
				await this.openDashboardAiPromptDocument();
				return;
			}
			if (action.command === "codepinion.dashboard.chatSend") {
				await this.handleChatSend(action.payload ?? {});
				return;
			}
			if (action.command === "codepinion.dashboard.clearChat") {
				this.clearDashboardChat();
				return;
			}
			await vscode.commands.executeCommand(action.command);
		} catch (error) {
			this.handleError(error, "Could not complete the CodePinion dashboard action.");
		}
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const controller = new CodePinionExtensionController(context);
	controller.register();
	context.subscriptions.push(controller);
}

export function deactivate(): void {}

function leafNode(
	label: string,
	description?: string,
	iconId?: string,
	tooltip?: string,
): TreeNode {
	return {
		label,
		description,
		tooltip,
		iconPath: iconId ? new vscode.ThemeIcon(iconId) : undefined,
	};
}

function actionNode(label: string, command: string, iconId: string): TreeNode {
	return {
		label,
		command: {
			command,
			title: label,
		},
		iconPath: new vscode.ThemeIcon(iconId),
	};
}

function withErrorNode(nodes: TreeNode[], errorMessage: string | null): TreeNode[] {
	if (!errorMessage) {
		return nodes;
	}
	return [
		leafNode("Last sync error", errorMessage, "error", errorMessage),
		...nodes,
	];
}

function readString(payload: Record<string, unknown>, key: string): string | null {
	const value = payload[key];
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.trim();
	return normalized ? normalized : null;
}

function readNumber(payload: Record<string, unknown>, key: string): number | null {
	const value = payload[key];
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function formatDate(value: Date): string {
	return value.toISOString().slice(0, 10);
}
