# CodePinion for VS Code

Bring CodePinion into your editor. View and update your sprint tasks, manage workspaces, chat with AI about your code, and generate commit messages and PR descriptions — all without leaving VS Code.

---

## Requirements

- VS Code 1.118.0 or later
- A CodePinion account
- A frontend API key (obtained from your CodePinion account settings)
- A local git repository open in VS Code

---

## Getting Started

### 1. Sign in

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **CodePinion: Login**. Enter your email and password when prompted.

### 2. Set your API key

Run **CodePinion: Set Frontend API Key** from the Command Palette and paste in your frontend API key. This key is stored securely in VS Code's secret storage — it is never written to your settings files.

If the key is missing, a yellow warning banner appears at the top of the dashboard reminding you to set it. AI features will not work until it is configured.

### 3. Link your repository

With a git repository open in VS Code, run **CodePinion: Link Current Repo**. The extension detects your local repo and presents a searchable list of your accessible CodePinion repositories. Select the one that matches and it will be linked automatically.

Once linked, the dashboard loads your sprints, tasks, goals, and epics for that repository.

---

## The Dashboard

Click the CodePinion icon in the Activity Bar to open the sidebar, then click **Open Dashboard** to open the main panel. The dashboard has three tabs.

### Planning tab

Your day-to-day view. Shows the current sprint, all tasks in the sprint, your goals for the active task, and epics.

**Updating status** — Each task, goal, and epic row has an inline status dropdown and a Save button. Change the status and hit Save; the update is sent to CodePinion immediately.

**Creating items** — Each section header has a `+` button:
- `+ Task` — create a new task in the sprint
- `+ Goal` — attach a goal to the current task
- `+ Epic` — add an epic to the sprint
- `+ Sprint` — start a new sprint (shown at the bottom of the panel)

Click the `+` button to expand the form inline, fill it in, and submit.

**Start Work on a task** — Each task row has a "Start Work" button. This creates a branch for the task and opens a workspace on that branch in one step.

**Open Current Task** — The button in the Planning header opens the current task in the CodePinion web app for full details, comments, and attachments.

### AI Chat tab

A persistent chat session scoped to your linked repository and active task. Ask questions about your code, request explanations, get suggestions for implementations, or have it walk through your goals.

The chat automatically includes context about your current sprint, task, and linked repo so you do not need to re-explain the project in every message.

**Prompt Editor** — The "Prompt Editor" button next to Send opens the current file in the AI prompt builder, which pre-populates the chat with the file's content and your task context.

**Copy / Open in editor** — After an AI response, use "Copy Last Response" to copy it to the clipboard or "Open in Editor" to open the full response as a document.

**Clear chat** — The Clear button in the section header wipes the conversation history.

### Repos tab

Shows all repositories you have access to, with a Link button beside each one. The currently linked repository is highlighted.

The Workspace section below the list lets you start or resume a remote workspace and open a terminal into it. If a workspace is already running it shows the branch name and last opened file.

---

## The Sidebar

The CodePinion sidebar has four collapsible views that give quick access without opening the full dashboard.

### Repos view

Shows your local git repository name and branch, the linked CodePinion repository, and a list of accessible repositories. Click **Open Dashboard** to open the main panel or **Link Repo** to change which repository is linked.

### Workspace view

Buttons to start or resume a workspace and open a terminal. When a workspace is active it shows its ID, status, branch, and runtime.

### Planning view

A compact read-only view of your current task, current sprint, goals, tasks, and epics. Click any item to open it in the web app.

### AI view

Quick-action buttons for common AI tasks:
- **Ask AI about current file** — opens the AI chat with the active editor file pre-loaded
- **Generate Daily Standup** — summarises your recent commits into a standup-ready bullet list
- **Sprint Breakdown** — paste in a PRD or requirements block and get a suggested task breakdown for the sprint
- **Generate Commit Message** — analyses your staged changes and proposes a commit message
- **Generate PR Description** — reads the diff between your branch and main and writes a pull request description

---

## Status Bar

Four items appear in the VS Code status bar at the bottom of the window:

| Item | What it shows |
|------|---------------|
| Account | Your display name, or "Not signed in" |
| Repo | The linked repository name, or "No repo" |
| Workspace | Workspace status, or "No workspace" |
| Task | Title of the current task, or "No task" |

Click any status bar item to jump to the relevant section in the sidebar.

---

## Command Reference

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).

| Command | What it does |
|---------|-------------|
| `CodePinion: Login` | Sign in with your email and password |
| `CodePinion: Logout` | Sign out and clear the session |
| `CodePinion: Set Frontend API Key` | Store your API key securely |
| `CodePinion: Open Dashboard` | Open the main dashboard panel |
| `CodePinion: Link Current Repo` | Link the open git repo to a CodePinion repository |
| `CodePinion: Start Workspace` | Start or resume a remote workspace |
| `CodePinion: Open Workspace Terminal` | Open a terminal into the active workspace |
| `CodePinion: Open Current Task` | Open the active task in the CodePinion web app |
| `CodePinion: Ask AI About Current File` | Pre-load the current file into AI chat |
| `CodePinion: Generate Commit Message` | Write a commit message from staged changes |
| `CodePinion: Generate PR Description` | Write a PR description from the branch diff |
| `CodePinion: Generate Daily Standup` | Summarise recent commits as a standup update |
| `CodePinion: AI Sprint Breakdown from PRD` | Turn a PRD into a list of sprint tasks |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codepinion.backendUrl` | `http://127.0.0.1:8000` | URL of your CodePinion backend |
| `codepinion.appUrl` | `http://localhost:3000` | URL of the CodePinion web app |

These only need to be changed if you are running CodePinion on non-default ports or a remote server.

---

## Security Notes

- Your password and API key are stored in VS Code's encrypted secret storage, not in `settings.json` or any file on disk.
- The extension never modifies git remotes or commits anything on your behalf.
- All requests go to the backend URL you configure — no data is sent to third-party servers by the extension itself.

---

## Troubleshooting

**"No repositories loaded"** — Make sure you are signed in, have set an API key, and that your account has access to at least one repository in CodePinion.

**"No local git repo"** — VS Code needs a folder open that contains a `.git` directory. The extension does not work on individual files opened without a workspace.

**AI features not responding** — Check that your frontend API key is set (the yellow warning banner will appear if it is missing). Confirm the backend URL in settings is reachable.

**Workspace terminal not opening** — The workspace must be in a running state before a terminal can be attached. Use "Start or Resume" in the Repos tab first.
