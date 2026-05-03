import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_DIFF_CHARS = 3000;

export async function getStagedDiff(repoRoot: string): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", repoRoot, "diff", "--staged"]);
	return stdout.slice(0, MAX_DIFF_CHARS);
}

export async function getLocalBranchDiff(repoRoot: string, base: string): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", repoRoot, "diff", `${base}...HEAD`]);
	return stdout.slice(0, MAX_DIFF_CHARS);
}
