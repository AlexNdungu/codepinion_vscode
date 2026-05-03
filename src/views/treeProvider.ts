import * as vscode from "vscode";

export type TreeNode = {
	label: string;
	description?: string;
	tooltip?: string;
	command?: vscode.Command;
	iconPath?: vscode.ThemeIcon;
	collapsibleState?: vscode.TreeItemCollapsibleState;
	children?: TreeNode[];
};

export class SimpleTreeProvider implements vscode.TreeDataProvider<TreeNode> {
	private readonly emitter = new vscode.EventEmitter<TreeNode | undefined | void>();
	public readonly onDidChangeTreeData = this.emitter.event;

	constructor(private readonly buildRootNodes: () => TreeNode[]) {}

	refresh(): void {
		this.emitter.fire();
	}

	getTreeItem(element: TreeNode): vscode.TreeItem {
		const item = new vscode.TreeItem(
			element.label,
			element.collapsibleState ?? (element.children?.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None),
		);
		item.description = element.description;
		item.tooltip = element.tooltip;
		item.command = element.command;
		item.iconPath = element.iconPath;
		return item;
	}

	getChildren(element?: TreeNode): Thenable<TreeNode[]> {
		return Promise.resolve(element?.children ?? this.buildRootNodes());
	}
}

