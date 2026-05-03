import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildRepoFingerprint, parseGitRemotes } from "./gitShared";

const execFileAsync = promisify(execFile);

export type LocalRepoRemote = {
	name: string;
	url: string;
};

export type LocalRepoContext = {
	workspaceFolder: vscode.WorkspaceFolder;
	repoRoot: string;
	branchName: string;
	originUrl: string;
	remotes: LocalRepoRemote[];
};

export async function detectLocalRepo(): Promise<LocalRepoContext | null> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return null;
	}

	const repoRoot = await runGitCommand(["rev-parse", "--show-toplevel"], folder.uri.fsPath).catch(() => "");
	if (!repoRoot) {
		return null;
	}

	const branchName = (await runGitCommand(["branch", "--show-current"], repoRoot).catch(() => "")).trim();
	const remotesRaw = await runGitCommand(["remote", "-v"], repoRoot).catch(() => "");
	const remotes = parseGitRemotes(remotesRaw);
	const originUrl = remotes.find((remote) => remote.name === "origin")?.url ?? "";

	return {
		workspaceFolder: folder,
		repoRoot: repoRoot.trim(),
		branchName: branchName || "HEAD",
		originUrl,
		remotes,
	};
}

async function runGitCommand(args: string[], cwd: string): Promise<string> {
	const result = await execFileAsync("git", args, { cwd });
	return `${result.stdout}`.trim();
}

export { buildRepoFingerprint, parseGitRemotes };
