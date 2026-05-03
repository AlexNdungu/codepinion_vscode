import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAiPrompt } from '../ai/promptBuilder';
import { buildApiUrl, normalizeListPayload, normalizeBaseUrl } from '../api/client';
import { parseGitRemotes } from '../bridge/gitShared';
import { normalizeRemote, scoreRepositoryForLocalRepo } from '../bridge/repoMatcher';
import { buildDashboardHtml } from '../dashboard/html';
import { buildTerminalSocketUrl } from '../terminal/socketUrl';

test('normalizes backend URLs cleanly', () => {
	assert.strictEqual(normalizeBaseUrl('http://127.0.0.1:8000/'), 'http://127.0.0.1:8000');
	assert.strictEqual(buildApiUrl('http://127.0.0.1:8000/', '/api/auth/me/'), 'http://127.0.0.1:8000/api/auth/me/');
});

test('normalizes paginated payloads', () => {
	assert.deepStrictEqual(normalizeListPayload([{ id: 1 }]), [{ id: 1 }]);
	assert.deepStrictEqual(normalizeListPayload({
		count: 1,
		next: null,
		previous: null,
		results: [{ id: 2 }],
	}), [{ id: 2 }]);
});

test('parses git remotes without duplicates', () => {
	const remotes = parseGitRemotes([
		'origin\tgit@github.com:alex/codepinion.git (fetch)',
		'origin\tgit@github.com:alex/codepinion.git (push)',
		'upstream\thttps://github.com/example/project.git (fetch)',
	].join('\n'));

	assert.strictEqual(remotes.length, 2);
	assert.strictEqual(remotes[0].name, 'origin');
	assert.strictEqual(remotes[1].name, 'upstream');
});

test('scores repository matches from git remotes', () => {
	const match = scoreRepositoryForLocalRepo(
		{
			repoRoot: '/tmp/codepinion',
			originUrl: 'git@github.com:team/codepinion.git',
		},
		{
			id: 1,
			organization: null,
			organization_name: null,
			owner_user: 1,
			owner_type: 'personal',
			owner_name: 'Team',
			owner_slug: 'team',
			owner_avatar: null,
			full_name: 'team/codepinion',
			can_manage: true,
			name: 'CodePinion',
			slug: 'codepinion',
			description: '',
			visibility: 'private',
			default_branch: 'main',
			language: 'typescript',
			status: 'active',
			created_at: '',
			updated_at: '',
		},
	);

	assert.ok(match.score > 0);
	assert.ok(match.reasons.length > 0);
	assert.strictEqual(normalizeRemote('HTTPS://GitHub.com/Team/CodePinion.git'), 'https://github.com/team/codepinion.git');
});

test('builds terminal websocket URLs', () => {
	const url = buildTerminalSocketUrl(
		'http://127.0.0.1:8000/',
		42,
		'session-abc',
		'access-token',
		'frontend-key',
	);

	assert.ok(url.startsWith('ws://127.0.0.1:8000/ws/workspaces/42/terminal/sessions/session-abc/'));
	assert.ok(url.includes('access_token=access-token'));
	assert.ok(url.includes('api_key=frontend-key'));
});

test('builds repo-aware AI prompts', () => {
	const prompt = buildAiPrompt({
		question: 'Summarize this file',
		filePath: '/workspace/repo/src/example.ts',
		selectionText: 'const answer = 42;',
		localRepo: {
			workspaceFolder: { uri: { fsPath: '/workspace/repo' } as never, index: 0, name: 'repo' },
			repoRoot: '/workspace/repo',
			branchName: 'tasks/example',
			originUrl: 'git@github.com:team/codepinion.git',
			remotes: [],
		},
		repository: {
			id: 1,
			organization: null,
			organization_name: null,
			owner_user: 1,
			owner_type: 'personal',
			owner_name: 'Team',
			owner_slug: 'team',
			owner_avatar: null,
			full_name: 'team/codepinion',
			can_manage: true,
			name: 'CodePinion',
			slug: 'codepinion',
			description: '',
			visibility: 'private',
			default_branch: 'main',
			language: 'typescript',
			status: 'active',
			created_at: '',
			updated_at: '',
		},
		workspace: null,
		task: null,
		goals: [],
		sprint: null,
	});

	assert.ok(prompt.includes('CodePinion AI Prompt'));
	assert.ok(prompt.includes('team/codepinion'));
	assert.ok(prompt.includes('const answer = 42;'));
});

test('builds dashboard html with actionable content', () => {
	const html = buildDashboardHtml(
		{
			user: null,
			hasFrontendApiKey: false,
			localRepo: null,
			repositories: [{
				id: 1,
				organization: null,
				organization_name: null,
				owner_user: 1,
				owner_type: 'personal',
				owner_name: 'Team',
				owner_slug: 'team',
				owner_avatar: null,
				full_name: 'team/codepinion',
				can_manage: true,
				name: 'CodePinion',
				slug: 'codepinion',
				description: '',
				visibility: 'private',
				default_branch: 'main',
				language: 'typescript',
				status: 'active',
				created_at: '',
				updated_at: '',
			}],
			linkedRepository: {
				id: 1,
				organization: null,
				organization_name: null,
				owner_user: 1,
				owner_type: 'personal',
				owner_name: 'Team',
				owner_slug: 'team',
				owner_avatar: null,
				full_name: 'team/codepinion',
				can_manage: true,
				name: 'CodePinion',
				slug: 'codepinion',
				description: '',
				visibility: 'private',
				default_branch: 'main',
				language: 'typescript',
				status: 'active',
				created_at: '',
				updated_at: '',
			},
			workspace: null,
			workspaceBranches: [],
			planning: {
				epics: [],
				sprints: [{
					id: 3,
					repository: 1,
					name: 'Sprint 3',
					description: '',
					status: 'active',
					start_date: '',
					end_date: '',
					goal: '',
					task_count: 1,
					created_at: '',
					updated_at: '',
				}],
				tasks: [{
					id: 7,
					sprint: 3,
					repository: 1,
					parent_epic: null,
					title: 'Link repo',
					description: '',
					status: 'backlog',
					priority: 'medium',
					branch: null,
					branch_name_snapshot: 'tasks/link-repo',
					due_date: null,
					codebase_area: 'extension',
					story_points: 2,
					effort_estimate_hours: 1,
					comment_count: 0,
					linked_pull_requests: [],
					linked_commits: [],
					created_at: '',
					updated_at: '',
				}],
				currentTask: null,
				currentGoals: [],
				currentSprint: {
					id: 3,
					repository: 1,
					name: 'Sprint 3',
					description: '',
					status: 'active',
					start_date: '',
					end_date: '',
					goal: '',
					task_count: 1,
					created_at: '',
					updated_at: '',
				},
			},
			chatHistory: [],
			generatedAiPrompt: 'Prompt body',
			errorMessage: null,
			backendUrl: 'http://127.0.0.1:8000',
			appUrl: 'http://localhost:3000',
		},
		{
			cspSource: 'vscode-webview',
			iconUri: 'webview:/media/codepinion-icon.png',
			nonce: 'test-nonce',
		},
	);

	assert.ok(html.includes('<title>CodePinion</title>'));
	assert.ok(html.includes('codepinion.login'));
	assert.ok(html.includes('codepinion.setFrontendApiKey'));
	assert.ok(html.includes('data-repository-id="1"'));
	assert.ok(html.includes('data-task-id="7"'));
	assert.ok(html.includes('codepinion.dashboard.createSprint'));
	assert.ok(html.includes('codepinion.dashboard.updateTaskStatus'));
	assert.ok(html.includes('codepinion.dashboard.chatSend'));
	assert.ok(html.includes('Start Work'));
	assert.ok(html.includes('codepinion.setFrontendApiKey'));
	assert.ok(html.includes('Backend: http://127.0.0.1:8000'));
});
