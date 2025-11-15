import * as vscode from "vscode";

let inRegionMode = false;

// TODO Support editor.emmet.action.matchTag inside JSX code but not when in Typescript code in JSX file

const isSelectionBiggerThan1 = (selection: vscode.Selection | undefined) => {
  if (selection === undefined) {
    return false
  }

  const end: vscode.Position = selection.end;
  const start = selection.start;
  return !start.isEqual(end);
}

export async function activate(context: vscode.ExtensionContext) {
  setRegionMode(false);


  context.subscriptions.push(
    vscode.commands.registerCommand("emacs.closeAllPanels", async () => {
      await vscode.commands.executeCommand("workbench.action.closePanel");
      await vscode.commands.executeCommand("workbench.action.closeSidebar");
      await vscode.commands.executeCommand("workbench.action.closeAuxiliaryBar");
      await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    }),
  )

  context.subscriptions.push(vscode.commands.registerCommand('emacs.testing.reRunLastRun', async () => {
    await vscode.commands.executeCommand('testing.cancelRun');
    await vscode.commands.executeCommand('testing.reRunLastRun')
  }));

  let activeDebugSessions: vscode.DebugSession[] = [];

  context.subscriptions.push(vscode.debug.onDidStartDebugSession(session => {
    // Exclude child sessions
    if (!session.parentSession) {
      activeDebugSessions.push(session);
    }
    // console.log('Started debug session:', session.name);
  }));

  context.subscriptions.push(vscode.debug.onDidTerminateDebugSession(session => {
    activeDebugSessions = activeDebugSessions.filter(s => s !== session);
    // console.log('Terminated debug session:', session.name);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('emacs.debug.restart', async () => {
    if (activeDebugSessions.length > 0) {
      const sessionNames = activeDebugSessions.map(session => session.name);
      let selectedName = sessionNames[0];
      if (sessionNames.length > 1) {
        selectedName = await vscode.window.showQuickPick(sessionNames, {
          placeHolder: 'Select debug session to restart'
        });
      }

      if (selectedName) {
        const selectedSession = activeDebugSessions.find(session => session.name === selectedName);
        if (selectedSession) {
          // Wait a moment for the session to fully stop before restarting
          let terminateDisposable: vscode.Disposable | undefined;
          const terminationPromise = new Promise<void>(resolve => {
            terminateDisposable = vscode.debug.onDidTerminateDebugSession(e => {
              if (e === selectedSession) {
                resolve();
              }
            });
          });

          let startDebugSessionDisposable: vscode.Disposable | undefined;

          const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => {
              reject(new Error("Debug session did not terminate within 10 seconds."));
            }, 10000); // 10 seconds timeout
          });

          await vscode.debug.stopDebugging(selectedSession);

          try {
            await Promise.race([terminationPromise, timeoutPromise]);
            let sessionName = selectedSession.name;
            const separator = ' « ';
            const separatorIndex = sessionName.indexOf(separator);

            if (separatorIndex !== -1) {
              sessionName = sessionName.substring(separatorIndex + separator.length).trim();
            }

            let newDebugSession: vscode.DebugSession | undefined;
            startDebugSessionDisposable = vscode.debug.onDidStartDebugSession(session => {
              newDebugSession = session;
            });
            await vscode.debug.startDebugging(selectedSession.workspaceFolder, sessionName);
          } catch (error: any) {
            vscode.window.showErrorMessage(error.message);
          } finally {
            terminateDisposable?.dispose();
            startDebugSessionDisposable?.dispose();
          }
        }
      }
    } else {
      // If no session is active, just start the default one
      await vscode.commands.executeCommand('workbench.action.debug.start');
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand("emacs.copyAll", async () => {
    const activeTextEditor = vscode.window.activeTextEditor;
    const lastLine = activeTextEditor.document.lineCount - 1
    activeTextEditor.selection = new vscode.Selection(new vscode.Position(0, 0), activeTextEditor.document.lineAt(lastLine).range.end)
    await vscode.commands.executeCommand("editor.action.clipboardCopyAction");
    removeSelection();
  }));


  vscode.window.onDidChangeTextEditorSelection(async (e) => {
    // console.log(e, inRegionMode);
    if (!inRegionMode && isSelectionBiggerThan1(e.selections[0])) {
      const selection = e.selections[0];
      const end: vscode.Position = selection.end;
      const start = selection.start;
      // Starte regionMode, wenn der Benutzer manuell selektiert
      if (!start.isEqual(end)) {
        inRegionMode = true;
        await startRegionMode();
      }
    } else if (inRegionMode && !isSelectionBiggerThan1(e.selections[0])) {
      inRegionMode = false;
      await exitRegionMode();
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("emacs.startRegionMode", async () => {
      await startRegionMode();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("emacs.exitRegionMode", async () => {
      await exitRegionMode().then(removeSelection);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("emacs.killLine", async () => {
      const activeSelection = vscode.window.activeTextEditor.selection;
      const start = activeSelection.start;
      const document = vscode.window.activeTextEditor.document;
      const workspaceEdit = new vscode.WorkspaceEdit();
      const line = document.lineAt(start);
      const selection = new vscode.Range(start, line.range.end);
      workspaceEdit.replace(document.uri, selection, '');
      const success = await vscode.workspace.applyEdit(workspaceEdit);
      if (!success) {
        console.warn(`Cannot kill line`);
      }
    })
  );

  var selectionActions: string[] = [
    "action.clipboardCopyAction",
    "action.clipboardPasteAction",
    "action.clipboardCutAction"
  ];
  selectionActions.forEach(selectionAction => {
    context.subscriptions.push(
      vscode.commands.registerCommand("emacs." + selectionAction, async () => {
        // Don't know why this is necessary. Cuts whole line otherwise.
        if (selectionAction === 'action.clipboardCutAction' && vscode.window.activeTextEditor !== undefined) {
          const activeSelection = vscode.window.activeTextEditor.selection;
          const end: vscode.Position = activeSelection.end;
          const start = activeSelection.start;
          if (start.isEqual(end)) {
            return;
          }
        }
        let commandExecution: Thenable<any> = vscode.commands
          .executeCommand("editor." + selectionAction)
          .then(exitRegionMode);
        if (selectionAction === 'action.clipboardCopyAction') {
          commandExecution = commandExecution.then(removeSelection);
        }
        await commandExecution;
      })
    );
  });
}

function startRegionMode() {
  inRegionMode = true;
  return setRegionMode(true);
}

function exitRegionMode() {
  inRegionMode = false;
  return setRegionMode(false);
}

function setRegionMode(value): Thenable<{}> {
  return vscode.commands.executeCommand("setContext", "inRegionMode", value);
}

function removeSelection() {
  const activeSelection = vscode.window.activeTextEditor.selection;
  const end: vscode.Position = activeSelection.end;
  const start = activeSelection.start;
  if (!start.isEqual(end)) {
    vscode.window.activeTextEditor.selection = new vscode.Selection(end, end);
  }
}

// this method is called when your extension is deactivated
export function deactivate() {
  setRegionMode(false);
}
