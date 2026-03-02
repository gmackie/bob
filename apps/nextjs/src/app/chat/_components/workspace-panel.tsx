"use client";

import type { FormEvent } from "react";
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";

import { useTRPC } from "~/trpc/react";

interface WorkspacePanelProps {
  sessionId: string;
  workingDirectory: string;
  canSendCommands: boolean;
  onSendCommand: (command: string) => void;
}

interface FileBrowserEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  modified: string;
}

type ActiveWorkspaceTab = "status" | "files" | "viewer" | "commands";

const QUICK_COMMANDS = [
  {
    label: "Git Add .",
    command: "git add .",
    description: "Stage all tracked/untracked changes",
  },
  {
    label: "Git Push",
    command: "git push",
    description: "Push current branch",
  },
  {
    label: "Git Pull --rebase",
    command: "git pull --rebase",
    description: "Rebase from remote branch",
  },
] as const;

const pathSeparatorFrom = (path: string): "/" | "\\" => {
  return path.includes("\\") ? "\\" : "/";
};

function toParentPath(
  targetPath: string,
  rootPath: string,
  separator: "/" | "\\",
): string {
  const normalizedTarget = targetPath.replace(new RegExp(`${separator}+$`), "");
  const normalizedRoot = rootPath.replace(new RegExp(`${separator}+$`), "");

  if (!normalizedTarget || normalizedTarget === normalizedRoot) {
    return normalizedRoot;
  }

  const idx = normalizedTarget.lastIndexOf(separator);
  if (idx <= 0) return normalizedRoot;

  return normalizedTarget.slice(0, idx);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function getFileExtension(path: string): string {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return "";
  return path.slice(lastDot + 1).toLowerCase();
}

function getLanguageClass(path: string): string {
  const extension = getFileExtension(path);
  if (["ts", "tsx"].includes(extension)) return "typescript";
  if (["js", "jsx", "mjs", "cjs"].includes(extension)) return "javascript";
  if (["css", "scss", "sass", "less"].includes(extension)) return "css";
  if (["json", "yml", "yaml", "toml", "ini", "env"].includes(extension))
    return "config";
  if (["md", "mdx"].includes(extension)) return "markdown";
  if (["sh", "bash", "zsh", "fish"].includes(extension)) return "shell";
  if (["html", "xml"].includes(extension)) return "markup";
  return "text";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function applySimpleHighlight(source: string, extension: string): string {
  if (["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(extension)) {
    return "⚠️ Binary content";
  }

  const escaped = escapeHtml(source);
  const withComments = escaped.replace(
    /((?:^|[\n\r])[ \t]*(?:#|\/\/).*[^\n\r]*)/g,
    '<span class="chat-fileCodeComment">$1</span>',
  );
  const withStrings = withComments.replace(
    /(&quot;[^&]*?&quot;|&#39;[^&#]*?&#39;|`[^`]*?`)/g,
    '<span class="chat-fileCodeString">$1</span>',
  );
  const withKeywords = withStrings.replace(
    /\b(async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|false|finally|for|function|if|in|let|new|null|return|super|switch|this|throw|try|typeof|var|void|while|with|yield)\b/g,
    '<span class="chat-fileCodeKeyword">$1</span>',
  );

  return withKeywords.replace(
    /\b(\d+(?:\.\d+)?)\b/g,
    '<span class="chat-fileCodeNumber">$1</span>',
  );
}

export function WorkspacePanel({
  sessionId,
  workingDirectory,
  canSendCommands,
  onSendCommand,
}: WorkspacePanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const separator = useMemo(
    () => pathSeparatorFrom(workingDirectory),
    [workingDirectory],
  );

  const [activeTab, setActiveTab] = useState<ActiveWorkspaceTab>("status");
  const [browserPath, setBrowserPath] = useState(workingDirectory);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [commandQueue, setCommandQueue] = useState<string[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [customCommand, setCustomCommand] = useState("");
  const [commitMessage, setCommitMessage] = useState("");

  const { data: workspaceStatus, isLoading: isWorkspaceStatusLoading } =
    useQuery(
      trpc.git.status.queryOptions(
        {
          path: workingDirectory,
        },
        { enabled: Boolean(workingDirectory) },
      ),
    );

  const {
    data: fileEntries,
    isLoading: isFileListLoading,
    refetch: refetchFileList,
  } = useQuery(
    trpc.filesystem.list.queryOptions(
      { path: browserPath, showHidden: false },
      { enabled: Boolean(browserPath) },
    ),
  );

  const { data: fileContent, isFetching: isFileLoading } = useQuery(
    trpc.filesystem.read.queryOptions(
      { path: selectedFile ?? "", encoding: "utf-8" },
      { enabled: Boolean(selectedFile) },
    ),
  );

  const addQueuedCommand = useCallback((command: string) => {
    setCommandQueue((prev) => [...prev, command]);
  }, []);

  const runQueuedCommands = useCallback(() => {
    if (commandQueue.length === 0 || !canSendCommands) return;

    const commandsToRun = [...commandQueue];
    setCommandQueue([]);
    setCommandHistory((prev) => [
      ...commandsToRun.map((command) => `${new Date().toLocaleTimeString()}: ${command}`),
      ...prev,
    ].slice(0, 30));

    for (const command of commandsToRun) {
      onSendCommand(command);
    }

    void refetchFileList();
    void queryClient.invalidateQueries({
      queryKey: trpc.git.status.queryKey({ path: workingDirectory }),
    });
  }, [
    canSendCommands,
    commandQueue,
    onSendCommand,
    queryClient,
    refetchFileList,
    trpc.git.status,
    workingDirectory,
  ]);

  const handleCommit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const message = commitMessage.trim();
      if (!message) return;
      addQueuedCommand(`git commit -m ${JSON.stringify(message)}`);
      setCommitMessage("");
    },
    [addQueuedCommand, commitMessage],
  );

  const handleAddCustomCommand = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const command = customCommand.trim();
      if (!command) return;
      addQueuedCommand(command);
      setCustomCommand("");
    },
    [addQueuedCommand, customCommand],
  );

  const handleSelectDirectory = useCallback((entry: FileBrowserEntry) => {
    if (entry.isDirectory) {
      setBrowserPath(entry.path);
      setSelectedFile(null);
      return;
    }
    setSelectedFile(entry.path);
    setActiveTab("viewer");
  }, []);

  const handleNavigateUp = useCallback(() => {
    setBrowserPath((current) => toParentPath(current, workingDirectory, separator));
  }, [workingDirectory, separator]);

  const handleRunCommand = useCallback(
    (command: string) => {
      if (!canSendCommands) return;
      addQueuedCommand(command);
    },
    [addQueuedCommand, canSendCommands],
  );

  const workingDirectoryShort =
    workingDirectory.split(separator).at(-1) ?? workingDirectory;

  return (
    <aside className="chat-workspacePanel">
      <div className="chat-workspaceTabs" role="tablist" aria-label="Workspace views">
        <button
          type="button"
          role="tab"
          className={cn("chat-workspaceTab", activeTab === "status" && "is-active")}
          onClick={() => setActiveTab("status")}
        >
          Repo Status
        </button>
        <button
          type="button"
          role="tab"
          className={cn("chat-workspaceTab", activeTab === "files" && "is-active")}
          onClick={() => setActiveTab("files")}
        >
          Files
        </button>
        <button
          type="button"
          role="tab"
          className={cn(
            "chat-workspaceTab",
            activeTab === "viewer" && "is-active",
          )}
          onClick={() => setActiveTab("viewer")}
          disabled={!selectedFile}
        >
          Viewer
        </button>
        <button
          type="button"
          role="tab"
          className={cn(
            "chat-workspaceTab",
            activeTab === "commands" && "is-active",
          )}
          onClick={() => setActiveTab("commands")}
        >
          Commands
        </button>
      </div>

      {activeTab === "status" && (
        <section className="chat-workspacePanelBody">
          <div className="chat-workspaceSectionTitle">
            {workingDirectoryShort}
          </div>
          {isWorkspaceStatusLoading ? (
            <div className="chat-emptyText">Loading repository status...</div>
          ) : !workspaceStatus ? (
            <div className="chat-emptyText">No git status available.</div>
          ) : (
            <>
              <div className="chat-workspaceMeta">
                <div>
                  <span className="chat-workspaceMetaLabel">Branch</span>
                  <span className="chat-workspaceMetaValue">{workspaceStatus.branch}</span>
                </div>
                <div>
                  <span className="chat-workspaceMetaLabel">Ahead / Behind</span>
                  <span className="chat-workspaceMetaValue">
                    {workspaceStatus.ahead} / {workspaceStatus.behind}
                  </span>
                </div>
              </div>

              <div className="chat-workspaceStatusLists">
                <div>
                  <h4 className="chat-workspaceListTitle">Staged</h4>
                  {workspaceStatus.staged.length === 0 ? (
                    <p className="chat-workspaceListEmpty">No staged files</p>
                  ) : (
                    <ul className="chat-workspaceList">
                      {workspaceStatus.staged.map((file) => (
                        <li key={file} className="chat-workspaceListItem">
                          {file}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h4 className="chat-workspaceListTitle">Modified</h4>
                  {workspaceStatus.unstaged.length === 0 ? (
                    <p className="chat-workspaceListEmpty">No modified files</p>
                  ) : (
                    <ul className="chat-workspaceList">
                      {workspaceStatus.unstaged.map((file) => (
                        <li key={file} className="chat-workspaceListItem">
                          {file}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h4 className="chat-workspaceListTitle">Untracked</h4>
                  {workspaceStatus.untracked.length === 0 ? (
                    <p className="chat-workspaceListEmpty">No untracked files</p>
                  ) : (
                    <ul className="chat-workspaceList">
                      {workspaceStatus.untracked.map((file) => (
                        <li key={file} className="chat-workspaceListItem">
                          {file}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {activeTab === "files" && (
        <section className="chat-workspacePanelBody">
          <div className="chat-workspaceSectionTitle">
            <div>
              <div className="chat-workspaceSubTitle">Working Directory</div>
              <div className="chat-workspacePath">{browserPath}</div>
            </div>
            <div className="chat-workspacePathNav">
              <Button
                size="sm"
                variant="outline"
                onClick={handleNavigateUp}
                disabled={browserPath === workingDirectory}
              >
                Up
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBrowserPath(workingDirectory)}
              >
                Root
              </Button>
            </div>
          </div>

          {isFileListLoading ? (
            <div className="chat-emptyText">Loading files…</div>
          ) : !fileEntries || fileEntries.length === 0 ? (
            <div className="chat-emptyText">No files in this directory.</div>
          ) : (
            <div className="chat-fileBrowserList">
              {fileEntries
                .slice()
                .sort((a, b) => {
                  if (a.isDirectory !== b.isDirectory) {
                    return a.isDirectory ? -1 : 1;
                  }
                  return a.name.localeCompare(b.name);
                })
                .map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    className={cn(
                      "chat-fileBrowserEntry",
                      entry.isDirectory && "is-directory",
                    )}
                    onClick={() => handleSelectDirectory(entry)}
                  >
                    <span>
                      {entry.isDirectory ? "📁" : "📄"} {entry.name}
                    </span>
                    <span className="chat-fileBrowserMeta">
                      {entry.isFile ? formatBytes(entry.size) : "DIR"}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </section>
      )}

      {activeTab === "viewer" && (
        <section className="chat-workspacePanelBody">
          <div className="chat-workspaceSectionTitle">
            <div>
              <div className="chat-workspaceSubTitle">File Viewer</div>
              <div className="chat-workspacePath">
                {selectedFile ?? "No file selected"}
              </div>
            </div>
            {selectedFile && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setActiveTab("files")}
              >
                Back
              </Button>
            )}
          </div>

          {!selectedFile ? (
            <div className="chat-emptyText">Select a file to preview.</div>
          ) : isFileLoading ? (
            <div className="chat-emptyText">Loading file content…</div>
          ) : !fileContent ? (
            <div className="chat-emptyText">Could not load file.</div>
          ) : (
            <div className="chat-fileViewer">
              <pre className="chat-fileCode">
                <code
                  className={cn(
                    "chat-fileCodeBody",
                    `chat-fileCodeBody--${getLanguageClass(selectedFile)}`,
                  )}
                  dangerouslySetInnerHTML={{
                    __html: applySimpleHighlight(
                      fileContent.content,
                      getFileExtension(selectedFile),
                    ),
                  }}
                />
              </pre>
            </div>
          )}
        </section>
      )}

      {activeTab === "commands" && (
        <section className="chat-workspacePanelBody">
          <div className="chat-workspaceSectionTitle">
            <div>
              <div className="chat-workspaceSubTitle">Command Queue</div>
              <div className="chat-workspaceMetaValue">Session {sessionId.slice(0, 8)}</div>
            </div>
            <Button
              size="sm"
              variant={commandQueue.length === 0 ? "outline" : "default"}
              onClick={runQueuedCommands}
              disabled={commandQueue.length === 0 || !canSendCommands}
            >
              Run Queue ({commandQueue.length})
            </Button>
          </div>

          <div className="chat-commandQuickActions">
            {QUICK_COMMANDS.map((quick) => (
              <Button
                key={quick.label}
                size="sm"
                variant="outline"
                onClick={() => handleRunCommand(quick.command)}
                className="chat-commandQuickButton"
                disabled={!canSendCommands}
              >
                {quick.label}
              </Button>
            ))}
          </div>
          <p className="chat-commandQuickHint">
            {`Quick actions enqueue commands for the active agent session.`}
          </p>

          <form
            className="chat-commandCompose"
            onSubmit={handleCommit}
          >
            <label className="chat-commandLabel">Commit message</label>
            <input
              type="text"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder='Example: "chore: update docs"'
              className="chat-commandInput"
              disabled={!canSendCommands}
            />
            <div className="chat-commandComposeRow">
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={!commitMessage.trim() || !canSendCommands}
              >
                Add Commit Command
              </Button>
            </div>
          </form>

          <form
            className="chat-commandCompose"
            onSubmit={handleAddCustomCommand}
          >
            <label className="chat-commandLabel">Custom command</label>
            <input
              type="text"
              value={customCommand}
              onChange={(event) => setCustomCommand(event.target.value)}
              placeholder="Example: git status --short"
              className="chat-commandInput"
              disabled={!canSendCommands}
            />
            <div className="chat-commandComposeRow">
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={!customCommand.trim() || !canSendCommands}
              >
                Add Command
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setCommandQueue([])}
                disabled={commandQueue.length === 0}
              >
                Clear Queue
              </Button>
            </div>
          </form>

          <div className="chat-commandQueue">
            <h4 className="chat-commandQueueTitle">Queued</h4>
            {commandQueue.length === 0 ? (
              <p className="chat-workspaceListEmpty">Queue empty</p>
            ) : (
              <ol className="chat-commandQueueList">
                {commandQueue.map((command, index) => (
                  <li key={`${command}-${index}`} className="chat-commandQueueItem">
                    <span>{index + 1}.</span>
                    <span>{command}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="chat-commandQueue">
            <h4 className="chat-commandQueueTitle">Executed</h4>
            {commandHistory.length === 0 ? (
              <p className="chat-workspaceListEmpty">No command history yet</p>
            ) : (
              <ol className="chat-commandQueueList">
                {commandHistory.map((entry) => (
                  <li key={entry} className="chat-commandQueueItem chat-commandQueueItem--muted">
                    <span>{entry}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      )}
    </aside>
  );
}
