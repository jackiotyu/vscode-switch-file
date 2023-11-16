import * as vscode from 'vscode';
import path from 'path';

interface QuickPickItem extends vscode.QuickPickItem {
    label: 'Next' | 'Previous'
}

interface ISiblingResult {
    previous?: string;
    next?: string;
}

export function activate(context: vscode.ExtensionContext) {
    const EXT_NAME = 'switch-file';
    const OPEN_FILE_TIPS = 'There currently no opened file. Please open a file first.';
    const PICK_SETTING_TIPS = 'Checked item(s) to open, unchecked item(s) to close';

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
            this.folderWatcher?.dispose();
            if (!this._folderPath) return;
            const folderPathPattern = new vscode.RelativePattern(vscode.Uri.file(this._folderPath), '*');
            this.folderWatcher = vscode.workspace.createFileSystemWatcher(folderPathPattern, false, false, false);
            this.folderWatcher.onDidChange(this.checkFolderFiles);
            this.folderWatcher.onDidCreate(this.checkFolderFiles);
            this.folderWatcher.onDidDelete(this.checkFolderFiles);
        }
        setFolderPath(value: string) {
            let oldFolderPath = this._folderPath;
            this._folderPath = value;
            if (oldFolderPath !== value) {
                return this.checkFolderFiles();
            }
        }
        get folderFiles() {
            return this._folderFiles;
        }
        private checkFolderFiles = async () => {
            this.folderWatcher?.dispose();
            if (!this._folderPath) return;
            this._folderFiles = await getFolderFiles(this._folderPath);
            this.createFolderWatcher();
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

    const getFolderFiles = async (folderPath: string) => {
        if (!folderPath) return [];
        const files = await vscode.workspace.findFiles(
            new vscode.RelativePattern(vscode.Uri.file(folderPath), '*'),
        );
        const collator = new Intl.Collator(undefined, { numeric: true });
        return files.map((i) => i.fsPath).sort((a, b) => collator.compare(a, b));
    };


    const getSiblingFiles = async (uri: vscode.Uri): Promise<ISiblingResult> => {
        let filePath = uri.fsPath;
        await folderFilesManager.setFolderPath(getFolderPath(filePath));
        let files = folderFilesManager.folderFiles;
        let len = files.length;
        if (len === 1) return {};
        if (len === 2) {
            let other = files.filter((i) => i !== filePath)[0];
            return { previous: other, next: other };
        }
        let curIndex = files.findIndex((i) => i === filePath);
        let previousIndex = curIndex === 0 ? files.length - 1 : curIndex - 1;
        let nextIndex = curIndex === files.length - 1 ? 0 : curIndex + 1;
        return {
            previous: files[previousIndex],
            next: files[nextIndex],
        };
    };

    const switchFile = async (uri: vscode.Uri, isNext: boolean = false) => {
        try {
            let { next, previous } = await getSiblingFiles(uri);
            let nextItem = isNext ? next : previous;
            if (!nextItem) return;
            let fileUri = vscode.Uri.file(nextItem);
            return vscode.commands.executeCommand('vscode.open', fileUri);
        } catch (err) {
            console.log(err);
        }
    };

    const buildOptions = async (uri: vscode.Uri) => {
        const { next, previous } = await getSiblingFiles(uri);
        const tagList = ['Next', 'Previous'] as const;
        const options: QuickPickItem[] = tagList.map((tag) => {
            const isNext = tag === 'Next';
            const fileName = isNext ? next : previous;
            const fileText = fileName ? fileName : '-';
            return {
                iconPath: new vscode.ThemeIcon(isNext ? 'arrow-down' : 'arrow-up'),
                label: tag,
                description: `${path.basename(fileName || '-')}`,
                detail: ` Switch to: ${fileText}`,
            };
        });
        return options;
    };

    const handleSwitchFile = async () => {
        if (!getActiveUri()) {
            return vscode.window.showErrorMessage(OPEN_FILE_TIPS);
        }
        let res: QuickPickItem | undefined;
        let uri = getActiveUri();
        if(!uri) return;
        let options = await buildOptions(uri);
        while ((res = await vscode.window.showQuickPick<QuickPickItem>(options))) {
            uri = getActiveUri();
            if (!uri || !res) break;
            const selectNext = res.label === 'Next';
            await switchFile(uri, selectNext);
            // next loop options
            uri = getActiveUri();
            if(!uri) break;
            options = await buildOptions(uri);
            if(!selectNext) options = options.reverse();
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
