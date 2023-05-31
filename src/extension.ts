import * as vscode from 'vscode';
import fs from 'fs';
import path from 'path';

export function activate(context: vscode.ExtensionContext) {
    const EXT_NAME = 'switch-file';
    const OPEN_FILE_TIPS = 'There currently no opened file. Please open a file first.';
    const PICK_SETTING_TIPS = 'Checked items to open, unchecked items to close';

    class FolderFilesManager {
        private _folderPath: string = '';
        private _folderFiles: string[] = [];
        private timer: NodeJS.Timeout | undefined;
        private folderWatcher?: vscode.FileSystemWatcher;
        constructor(context: vscode.ExtensionContext) {
            context.subscriptions.push(
                vscode.window.tabGroups.onDidChangeTabs(() => {
                    clearTimeout(this.timer);
                    this.timer = setTimeout(() => {
                        if (!vscode.window.tabGroups.activeTabGroup.activeTab) {
                            this._folderPath = '';
                            this._folderFiles = [];
                            this.folderWatcher?.dispose();
                        } else {
                            this.checkFolderFiles();
                        }
                    }, 30);
                }),
                this,
            );
        }
        dispose = () => {
            clearTimeout(this.timer);
            this._folderFiles = [];
            this._folderPath = '';
            this.folderWatcher?.dispose();
        };
        createFolderWatcher() {
            const folderPathPattern = new vscode.RelativePattern(vscode.Uri.file(this._folderPath), '**');
            this.folderWatcher?.dispose();
            this.folderWatcher = vscode.workspace.createFileSystemWatcher(folderPathPattern, false, false, false);
            this.folderWatcher.onDidChange(this.checkFolderFiles);
            this.folderWatcher.onDidCreate(this.checkFolderFiles);
            this.folderWatcher.onDidDelete(this.checkFolderFiles);
        }
        set folderPath(value: string) {
            let oldFolderPath = this._folderPath;
            this._folderPath = value;
            if (oldFolderPath !== value) {
                this.checkFolderFiles();
                this.createFolderWatcher();
            }
        }
        get folderFiles() {
            return this._folderFiles;
        }
        private checkFolderFiles = () => {
            if (!this._folderPath) return;
            this._folderFiles = getFolderFiles(this._folderPath);
        };
    }

    const folderFilesManager = new FolderFilesManager(context);

    enum Command {
        next = 'switch-file.next',
        previous = 'switch-file.previous',
        switchFile = 'switch-file.switchFile',
        toggleSetting = 'switch-file.toggleSetting',
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
            folderFilesManager.folderPath = folderPath;
            let folderFiles = folderFilesManager.folderFiles;
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
        if (!getActiveUri()) {
            return vscode.window.showErrorMessage(OPEN_FILE_TIPS);
        }
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

    const toggleSetting = async () => {
        const options: vscode.QuickPickItem[] = [
            {
                label: 'title',
                picked: vscode.workspace.getConfiguration(EXT_NAME).get('title'),
            },
            {
                label: 'statusBar',
                picked: vscode.workspace.getConfiguration(EXT_NAME).get('statusBar'),
            },
        ];
        let items = await vscode.window.showQuickPick(options, {
            title: PICK_SETTING_TIPS,
            canPickMany: true,
        });
        if (items === undefined) return;
        options.forEach((item) => {
            let check = items!.some((row) => row.label === item.label);
            vscode.workspace.getConfiguration(EXT_NAME).update(item.label, check, vscode.ConfigurationTarget.Global);
        });
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
                    if (!this.isActive) return;
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
        private toggleAll(show = false, forceUpdate = false) {
            if (!this.isActive && !forceUpdate) return;
            if (show === this.isShow) return;
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
            let show = !!vscode.workspace.getConfiguration(this.confName).get(this.conf);
            this.isActive = show;
            this.toggleAll(show, true);
        }
    }

    new StatusBarManager(context);

    context.subscriptions.push(
        vscode.commands.registerCommand(Command.next, (uri?: vscode.Uri) => {
            uri = uri || getActiveUri();
            if (!uri) return vscode.window.showErrorMessage(OPEN_FILE_TIPS);
            switchFile(uri, true);
        }),
        vscode.commands.registerCommand(Command.previous, (uri?: vscode.Uri) => {
            uri = uri || getActiveUri();
            if (!uri) return vscode.window.showErrorMessage(OPEN_FILE_TIPS);
            switchFile(uri, false);
        }),
        vscode.commands.registerCommand(Command.switchFile, handleSwitchFile),
        vscode.commands.registerCommand(Command.toggleSetting, toggleSetting),
    );
}

export function deactivate() {}
