import type { RepositoryRecord } from "../api/types";
import type { LocalRepoContext } from "./git";

export type RepositoryMatch = {
	repository: RepositoryRecord;
	score: number;
	reasons: string[];
};

export function scoreRepositoriesForLocalRepo(
	localRepo: LocalRepoContext,
	repositories: RepositoryRecord[],
): RepositoryMatch[] {
	return repositories
		.map((repository) => scoreRepositoryForLocalRepo(localRepo, repository))
		.filter((match) => match.score > 0)
		.sort((left, right) => right.score - left.score || left.repository.full_name.localeCompare(right.repository.full_name));
}

export function scoreRepositoryForLocalRepo(
	localRepo: Pick<LocalRepoContext, "originUrl" | "repoRoot">,
	repository: RepositoryRecord,
): RepositoryMatch {
	const remote = normalizeRemote(localRepo.originUrl);
	const fullName = repository.full_name.toLowerCase();
	const slug = repository.slug.toLowerCase();
	const name = repository.name.toLowerCase();
	const ownerSlug = (repository.owner_slug ?? "").toLowerCase();
	const reasons: string[] = [];
	let score = 0;

	if (!remote) {
		return { repository, score: 0, reasons };
	}

	if (remote.includes(`/${fullName}.git`) || remote.endsWith(`/${fullName}`)) {
		score += 120;
		reasons.push("remote matches repo full name");
	}

	if (ownerSlug && (remote.includes(`/${ownerSlug}/${slug}.git`) || remote.endsWith(`/${ownerSlug}/${slug}`))) {
		score += 80;
		reasons.push("remote matches owner/slug");
	}

	if (remote.endsWith(`/${slug}.git`) || remote.endsWith(`/${slug}`)) {
		score += 40;
		reasons.push("remote matches slug");
	}

	if (remote.includes(name)) {
		score += 10;
		reasons.push("remote contains repo name");
	}

	return { repository, score, reasons };
}

export function normalizeRemote(remote: string): string {
	return remote.trim().toLowerCase().replace(/\\/g, "/");
}

