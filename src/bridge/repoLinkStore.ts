import * as vscode from "vscode";

import type { RepositoryRecord } from "../api/types";
import type { LocalRepoContext } from "./git";
import { buildRepoFingerprint } from "./git";

const GLOBAL_KEY = "codepinion.repoLinks";

export type RepoLink = {
	fingerprint: string;
	repoRoot: string;
	repositoryId: number;
	repositoryFullName: string;
	workspaceId?: number;
	lastLinkedAt: string;
};

export class RepoLinkStore {
	constructor(private readonly globalState: vscode.Memento) {}

	getLink(localRepo: LocalRepoContext): RepoLink | null {
		const links = this.readLinks();
		return links[buildRepoFingerprint(localRepo)] ?? null;
	}

	async saveLink(localRepo: LocalRepoContext, repository: RepositoryRecord): Promise<RepoLink> {
		const nextLink: RepoLink = {
			fingerprint: buildRepoFingerprint(localRepo),
			repoRoot: localRepo.repoRoot,
			repositoryId: repository.id,
			repositoryFullName: repository.full_name,
			workspaceId: this.getLink(localRepo)?.workspaceId,
			lastLinkedAt: new Date().toISOString(),
		};
		await this.persistLink(nextLink);
		return nextLink;
	}

	async updateWorkspaceId(localRepo: LocalRepoContext, workspaceId: number): Promise<void> {
		const existing = this.getLink(localRepo);
		if (!existing) {
			return;
		}
		await this.persistLink({
			...existing,
			workspaceId,
		});
	}

	async clearLink(localRepo: LocalRepoContext): Promise<void> {
		const links = this.readLinks();
		delete links[buildRepoFingerprint(localRepo)];
		await this.globalState.update(GLOBAL_KEY, links);
	}

	private async persistLink(link: RepoLink): Promise<void> {
		const links = this.readLinks();
		links[link.fingerprint] = link;
		await this.globalState.update(GLOBAL_KEY, links);
	}

	private readLinks(): Record<string, RepoLink> {
		return this.globalState.get<Record<string, RepoLink>>(GLOBAL_KEY, {});
	}
}

