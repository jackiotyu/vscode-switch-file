import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const EXT_NAME = 'switch-file';

    enum Command {
        next = 'switch-file.next',
        previous = 'switch-file.previous',
        switchFile = 'switch-file.switchFile',
    }

    enum Direction {
        next = 'next',
        previous = 'previous',
    }

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
            })
            .sort((a, b) => {
                return a.localeCompare(b);
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
        let baseOptions: vscode.QuickPickItem[] = ['Next', 'Previous'].map((tag) => {
            return {
                label: tag,
                detail: (tag === 'Next' ? '$(arrow-down)' : '$(arrow-up)') + ` Switch to ${tag} file`,
            };
        });
        let options: vscode.QuickPickItem[] = baseOptions;
        let res: vscode.QuickPickItem | undefined;
        while ((res = await vscode.window.showQuickPick<vscode.QuickPickItem>(options))) {
            let uri = getActiveUri();
            if (!uri || !res) break;
            if (res.label === 'Previous') {
                await switchFile(uri, false);
                options = [...baseOptions].reverse();
            } else {
                await switchFile(uri, true);
                options = baseOptions;
            }
        }
    };

    class StatusBarManager {
        private previousBar: vscode.StatusBarItem;
        private nextBar: vscode.StatusBarItem;
        private readonly confName = EXT_NAME;
        private readonly conf = 'statusBar';
        private isShow: boolean = false;
        private isActive: boolean = false;
        private timer: NodeJS.Timeout | undefined;
        constructor(context: vscode.ExtensionContext) {
            this.nextBar = this.createBar(Command.next, Direction.next);
            this.previousBar = this.createBar(Command.previous, Direction.previous);
            this.checkActive();
            this.checkCanShow();
            context.subscriptions.push(
                this.nextBar,
                this.previousBar,
                vscode.workspace.onDidChangeConfiguration((event) => {
                    event.affectsConfiguration(this.confName) && this.checkActive();
                }),
                vscode.window.tabGroups.onDidChangeTabs(() => {
                    clearTimeout(this.timer);
                    if(!this.isActive) return;
                    this.timer = setTimeout(() => {
                        this.checkCanShow();
                    }, 30);
                }),
            );
        }
        private createBar(id: string, direction: Direction = Direction.next) {
            const isNext = direction === Direction.next;
            let bar = vscode.window.createStatusBarItem(id, vscode.StatusBarAlignment.Left, isNext ? -101 : -100);
            bar.command = {
                command: isNext ? Command.next : Command.previous,
                title: `switch ${direction} file`,
            };
            bar.text = isNext ? '$(arrow-right)' : `$(arrow-left)`;
            bar.tooltip = `Switch ${direction} file`;
            return bar;
        }
        private toggleAll(show = false) {
            if(!this.isActive) return;
            if(show === this.isShow) return;
            if (show) {
                this.nextBar.show();
                this.previousBar.show();
            } else {
                this.nextBar.hide();
                this.previousBar.hide();
            }
            this.isShow = show;
        }
        private checkCanShow(): void {
            let uri = getActiveUri();
            if (uri) return this.toggleAll(true);
            this.toggleAll(false);
        }
        private checkActive() {
            let show = vscode.workspace.getConfiguration(this.confName).get(this.conf);
            this.isActive = !!show;
            this.toggleAll(!!show);
        }
    }
    new StatusBarManager(context);
    context.subscriptions.push(
        vscode.commands.registerCommand(Command.next, (uri?: vscode.Uri) => {
            uri = uri || getActiveUri();
            if (!uri) return;
            switchFile(uri, true);
        }),
        vscode.commands.registerCommand(Command.previous, (uri?: vscode.Uri) => {
            uri = uri || getActiveUri();
            if (!uri) return;
            switchFile(uri, false);
        }),
        vscode.commands.registerCommand(Command.switchFile, handleSwitchFile),
    );
}

export function deactivate() {}
