import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const getActiveUri = (): vscode.Uri | undefined => {
        return (
            vscode.window.activeTextEditor?.document.uri ||
            (vscode.window.tabGroups?.activeTabGroup?.activeTab?.input as any)?.uri
        );
    };

    const getFolderPath = (filePath: string) => {
        if (!filePath) return '';
        return path.dirname(filePath);
    };

    const getFolderFiles = (folderPath: string) => {
        if (!folderPath) return [];
        let files = fs.readdirSync(folderPath, 'utf-8');
        return files
            .map((i) => path.join(folderPath, i))
            .filter((path) => {
                return fs.statSync(path).isFile();
            });
    };

    const switchFile = (uri: vscode.Uri, isNext: boolean = false) => {
        try {
            let filePath = uri.fsPath;
            let folderPath = getFolderPath(filePath);
            let folderFiles = getFolderFiles(folderPath);
            let curIndex = folderFiles.indexOf(filePath);
            folderFiles = folderFiles.filter((i) => i !== filePath);
            if (folderFiles.length === 0) return;
            let next;
            if (curIndex === 0 && !isNext) {
                next = folderFiles[folderFiles.length - 1];
            } else if (curIndex === folderFiles.length && isNext) {
                next = folderFiles[0];
            } else {
                next = isNext
                    ? folderFiles.find((file) => file.localeCompare(filePath) > 0)
                    : folderFiles.reverse().find((file) => file.localeCompare(filePath) <= 0);
            }
            if (!next) return;
            let fileUri = vscode.Uri.file(next);
            return vscode.commands.executeCommand('vscode.open', fileUri);
        } catch (err) {
            console.log(err);
        }
    };

    const handleSwitchFile = async () => {
        let options: vscode.QuickPickItem[] = ['Next', 'Previous'].map((tag) => {
            return {
                label: tag,
                detail: (tag === 'Next' ? '$(arrow-down)' : '$(arrow-up)') + ` Switch to ${tag} file`,
            };
        });
        let res;
        while ((res = await vscode.window.showQuickPick<vscode.QuickPickItem>(options))) {
            let uri = getActiveUri();
            if (!uri) break;
            if (res.label === 'Previous') {
                await switchFile(uri, false);
            } else {
                await switchFile(uri, true);
            }
        }
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('switch-file.next', (uri?: vscode.Uri) => {
            uri = uri || getActiveUri();
            if (!uri) return;
            switchFile(uri, true);
        }),
        vscode.commands.registerCommand('switch-file.previous', (uri?: vscode.Uri) => {
            uri = uri || getActiveUri();
            if (!uri) return;
            switchFile(uri, false);
        }),
        vscode.commands.registerCommand('switch-file.switchFile', handleSwitchFile),
    );
}

// This method is called when your extension is deactivated
export function deactivate() {}
