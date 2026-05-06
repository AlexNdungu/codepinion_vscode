import type { RepositoryRecord } from "../api/types";

export type RepositoryOwnerGroup = {
	ownerKey: string;
	ownerLabel: string;
	ownerType: RepositoryRecord["owner_type"];
	repositories: RepositoryRecord[];
};

export type GroupedRepositories = {
	personal: RepositoryOwnerGroup[];
	organization: RepositoryOwnerGroup[];
};

export function getRepositoryOwnerLabel(repository: RepositoryRecord): string {
	if (repository.owner_type === "organization") {
		return repository.organization_name || repository.owner_name || "Organization";
	}
	return repository.owner_name || "Personal";
}

export function filterRepositories(repositories: RepositoryRecord[], query: string): RepositoryRecord[] {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return repositories;
	}

	return repositories.filter((repository) => [
		repository.full_name,
		repository.name,
		repository.slug,
		repository.description,
		repository.organization_name,
		repository.owner_name,
		repository.owner_slug,
		repository.language,
		repository.status,
	].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedQuery)));
}

export function groupRepositoriesByOwner(repositories: RepositoryRecord[]): GroupedRepositories {
	const personal = new Map<string, RepositoryOwnerGroup>();
	const organization = new Map<string, RepositoryOwnerGroup>();

	for (const repository of repositories) {
		const ownerLabel = getRepositoryOwnerLabel(repository);
		const ownerKey = `${repository.owner_type}:${repository.owner_slug || ownerLabel.toLowerCase()}`;
		const target = repository.owner_type === "organization" ? organization : personal;
		const existing = target.get(ownerKey);

		if (existing) {
			existing.repositories.push(repository);
			continue;
		}

		target.set(ownerKey, {
			ownerKey,
			ownerLabel,
			ownerType: repository.owner_type,
			repositories: [repository],
		});
	}

	return {
		personal: [...personal.values()],
		organization: [...organization.values()],
	};
}
