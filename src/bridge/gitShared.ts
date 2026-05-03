export type ParsedGitRemote = {
	name: string;
	url: string;
};

export function parseGitRemotes(raw: string): ParsedGitRemote[] {
	const seen = new Set<string>();
	const remotes: ParsedGitRemote[] = [];

	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		const match = /^([^\s]+)\s+([^\s]+)\s+\((fetch|push)\)$/.exec(trimmed);
		if (!match) {
			continue;
		}
		const key = `${match[1]}::${match[2]}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		remotes.push({
			name: match[1],
			url: match[2],
		});
	}

	return remotes;
}

export function buildRepoFingerprint(repo: { repoRoot: string; originUrl: string }): string {
	return `${repo.repoRoot.toLowerCase()}::${repo.originUrl.toLowerCase()}`;
}

