"use client";

import * as React from "react";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { Button } from "@bob/ui/button";
import { Input } from "@bob/ui/input";

import { useTRPC } from "~/trpc/react";

type ConfigRootId =
  | "opencode_xdg"
  | "opencode_dot"
  | "claude_dot"
  | "codex_dot"
  | "gemini_dot"
  | "kiro_dot"
  | "cursor_agent_dot";

function initialContentForNewFile(fileName: string): string {
  return fileName.toLowerCase().endsWith(".json") ? "{}\n" : "";
}

export function ConfigFilesSection() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const OPENCODE_JSON_TEMPLATE =
    "{\n" +
    "  \"$schema\": \"https://opencode.ai/config.json\",\n" +
    "  \"model\": \"anthropic/claude-opus-4-5\",\n" +
    "  \"small_model\": \"anthropic/claude-haiku-4-5\",\n" +
    "  \"autoupdate\": false\n" +
    "}\n";

  const OPENCODE_CONFIG_JSON_TEMPLATE =
    "{\n" +
    "  \"$schema\": \"https://opencode.ai/schemas/config.json\",\n" +
    "  \"mcpServers\": {\n" +
    "    \"bob\": {\n" +
    "      \"type\": \"stdio\",\n" +
    "      \"command\": \"npx\",\n" +
    "      \"args\": [\"@bob/mcp-server\"],\n" +
    "      \"env\": {\n" +
    "        \"BOB_API_URL\": \"\\${env:BOB_API_URL}\",\n" +
    "        \"BOB_API_KEY\": \"\\${env:BOB_API_KEY}\",\n" +
    "        \"BOB_SESSION_ID\": \"\\${env:BOB_SESSION_ID}\"\n" +
    "      }\n" +
    "    }\n" +
    "  },\n" +
    "  \"skills\": [\n" +
    "    {\n" +
    "      \"name\": \"bob-workflow\",\n" +
    "      \"description\": \"Workflow and status reporting for Bob-managed sessions\",\n" +
    "      \"path\": \"./skills/bob-workflow.md\"\n" +
    "    }\n" +
    "  ]\n" +
    "}\n";

  const BOB_WORKFLOW_SKILL_TEMPLATE =
    "# Bob Workflow Skill\n\n" +
    "This is a starter skill file for Bob + OpenCode.\n\n" +
    "Typical flow:\n" +
    "- Call update_status regularly while working\n" +
    "- Use request_input when you need a decision (with a sensible default_action)\n" +
    "- Use mark_blocked when you cannot proceed\n" +
    "- Use submit_for_review when a PR is ready\n\n" +
    "Required env (for bob MCP server): BOB_API_URL, BOB_API_KEY, BOB_SESSION_ID\n";

  const [selectedRootId, setSelectedRootId] = React.useState<ConfigRootId | "">(
    "",
  );
  const [currentDir, setCurrentDir] = React.useState("");
  const [selectedFile, setSelectedFile] = React.useState<string | null>(null);
  const [fileContent, setFileContent] = React.useState("");
  const [isCreating, setIsCreating] = React.useState(false);
  const [newFileName, setNewFileName] = React.useState("");

  const { data: roots } = useQuery(
    trpc.settings.listConfigRoots.queryOptions(undefined),
  );

  React.useEffect(() => {
    const first = roots?.[0];
    if (first && !selectedRootId) {
      setSelectedRootId(first.id as ConfigRootId);
    }
  }, [roots, selectedRootId]);

  const { data: entriesData, isLoading: isLoadingEntries } = useQuery(
    trpc.settings.listConfigEntries.queryOptions(
      selectedRootId
        ? { rootId: selectedRootId as ConfigRootId, dir: currentDir }
        : skipToken,
    ),
  );

  const { data: fileData, isLoading: isLoadingFile } = useQuery(
    trpc.settings.readConfigFile.queryOptions(
      selectedRootId && selectedFile
        ? { rootId: selectedRootId as ConfigRootId, path: selectedFile }
        : skipToken,
    ),
  );

  React.useEffect(() => {
    if (fileData) {
      setFileContent(fileData.content);
    }
  }, [fileData]);

  const invalidateEntries = () => {
    void queryClient.invalidateQueries({
      queryKey: trpc.settings.listConfigEntries.queryKey({
        rootId: selectedRootId as ConfigRootId,
        dir: currentDir,
      }),
    });
  };

  const saveMutation = useMutation(
    trpc.settings.writeConfigFile.mutationOptions({
      onSuccess: (data) => {
        if (isCreating) {
          setIsCreating(false);
          setNewFileName("");
          setSelectedFile(data.path);
          invalidateEntries();
        }

        void queryClient.invalidateQueries({
          queryKey: trpc.settings.readConfigFile.queryKey({
            rootId: selectedRootId as ConfigRootId,
            path: data.path,
          }),
        });
      },
    }),
  );

  const deleteMutation = useMutation(
    trpc.settings.deleteConfigFile.mutationOptions({
      onSuccess: () => {
        setSelectedFile(null);
        setFileContent("");
        invalidateEntries();
      },
    }),
  );

  const templateMutation = useMutation(
    trpc.settings.writeConfigFile.mutationOptions({
      onSuccess: (data) => {
        invalidateEntries();
        void queryClient.invalidateQueries({
          queryKey: trpc.settings.readConfigFile.queryKey({
            rootId: selectedRootId as ConfigRootId,
            path: data.path,
          }),
        });
        setSelectedFile(data.path);
        setIsCreating(false);
      },
    }),
  );

  const handleWriteTemplate = async (
    files: { path: string; content: string }[],
  ) => {
    if (!selectedRootId) return;
    if (canSave) {
      if (!confirm("You have unsaved changes. Overwrite?")) return;
    }

    for (const file of files) {
      await templateMutation.mutateAsync({
        rootId: selectedRootId as ConfigRootId,
        path: file.path,
        content: file.content,
      });
    }
  };

  const handleRootChange = (id: ConfigRootId) => {
    setSelectedRootId(id);
    setCurrentDir("");
    setSelectedFile(null);
    setFileContent("");
    setIsCreating(false);
    setNewFileName("");
  };

  const handleDirClick = (p: string) => {
    setCurrentDir(p);
    setSelectedFile(null);
    setFileContent("");
    setIsCreating(false);
  };

  const handleFileClick = (p: string) => {
    setSelectedFile(p);
    setIsCreating(false);
  };

  const handleUpClick = () => {
    const parts = currentDir.split("/").filter(Boolean);
    parts.pop();
    setCurrentDir(parts.join("/"));
    setSelectedFile(null);
    setFileContent("");
  };

  const handleCreate = () => {
    if (!newFileName) return;
    const p = currentDir ? `${currentDir}/${newFileName}` : newFileName;
    saveMutation.mutate({
      rootId: selectedRootId as ConfigRootId,
      path: p,
      content: initialContentForNewFile(newFileName),
      createOnly: true,
    });
  };

  const handleSave = () => {
    if (!selectedFile) return;
    saveMutation.mutate({
      rootId: selectedRootId as ConfigRootId,
      path: selectedFile,
      content: fileContent,
    });
  };

  const handleDelete = () => {
    if (!selectedFile) return;
    if (!confirm("Delete this file?")) return;
    deleteMutation.mutate({
      rootId: selectedRootId as ConfigRootId,
      path: selectedFile,
    });
  };

  const entries = entriesData?.entries ?? [];
  const selectedRoot = roots?.find((r) => r.id === selectedRootId);
  const canSave = !!selectedFile && fileContent !== fileData?.content;

  return (
    <section className="rounded-lg border p-6">
      <h2 className="mb-4 text-xl font-semibold">
        Config Files (MCP / Skills / Agents)
      </h2>

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap gap-2">
          {roots?.map((root) => (
            <Button
              key={root.id}
              variant={selectedRootId === root.id ? "default" : "outline"}
              size="sm"
              onClick={() => handleRootChange(root.id as ConfigRootId)}
            >
              {root.label}
              {!root.exists && " (new)"}
            </Button>
          ))}
          {!roots && (
            <div className="bg-muted h-8 w-full animate-pulse rounded" />
          )}
        </div>

        <div className="grid h-[500px] grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col overflow-hidden rounded-md border">
            <div className="bg-muted/50 flex items-center justify-between border-b px-3 py-2">
              <span className="text-muted-foreground truncate font-mono text-sm">
                {selectedRoot?.dir ? selectedRoot.dir : ""}
                {currentDir ? `/${currentDir}` : ""}
              </span>
              {currentDir && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2"
                  onClick={handleUpClick}
                >
                  ..
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {isLoadingEntries ? (
                <div className="space-y-2 p-2">
                  <div className="bg-muted h-4 w-3/4 animate-pulse rounded" />
                  <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
                </div>
              ) : (
                <div className="space-y-1">
                  {entries.length === 0 && !isCreating && (
                    <div className="text-muted-foreground py-4 text-center text-sm">
                      No files found
                    </div>
                  )}
                  {entries.map((entry) => (
                    <button
                      key={entry.path}
                      onClick={() =>
                        entry.isDir
                          ? handleDirClick(entry.path)
                          : handleFileClick(entry.path)
                      }
                      className={`hover:bg-muted flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm ${
                        selectedFile === entry.path
                          ? "bg-muted font-medium"
                          : ""
                      }`}
                    >
                      <span className="text-muted-foreground font-mono text-xs">
                        {entry.isDir ? "DIR" : "FILE"}
                      </span>
                      <span className="truncate">{entry.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t p-2">
              {isCreating ? (
                <div className="flex flex-col gap-2">
                  <Input
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder="filename.json"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreate();
                      if (e.key === "Escape") setIsCreating(false);
                    }}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={handleCreate}
                      disabled={saveMutation.isPending || !newFileName}
                    >
                      Create
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsCreating(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                  {saveMutation.error && (
                    <p className="text-destructive text-xs">
                      {saveMutation.error.message}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => setIsCreating(true)}
                    disabled={!selectedRootId}
                  >
                    + New File
                  </Button>

                  <div className="border-t pt-2">
                    <p className="text-muted-foreground mb-2 text-xs font-medium">
                      Starter templates
                    </p>
                    <div className="flex flex-col gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto justify-start px-2 py-1 text-xs"
                        onClick={() =>
                          handleWriteTemplate([
                            {
                              path: "opencode.json",
                              content: OPENCODE_JSON_TEMPLATE,
                            },
                          ])
                        }
                        disabled={!selectedRootId || templateMutation.isPending}
                      >
                        Write opencode.json
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto justify-start px-2 py-1 text-xs"
                        onClick={() =>
                          handleWriteTemplate([
                            {
                              path: "skills/bob-workflow.md",
                              content: BOB_WORKFLOW_SKILL_TEMPLATE,
                            },
                            {
                              path: "opencode-config.json",
                              content: OPENCODE_CONFIG_JSON_TEMPLATE,
                            },
                          ])
                        }
                        disabled={!selectedRootId || templateMutation.isPending}
                      >
                        Write opencode-config.json + skill
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col overflow-hidden rounded-md border">
            {selectedFile ? (
              <>
                <div className="bg-muted/50 flex items-center justify-between border-b px-3 py-2">
                  <span className="truncate font-mono text-sm font-medium">
                    {selectedFile.split("/").pop()}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 px-2"
                      onClick={handleDelete}
                      disabled={deleteMutation.isPending}
                    >
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 px-3"
                      onClick={handleSave}
                      disabled={
                        saveMutation.isPending || isLoadingFile || !canSave
                      }
                    >
                      Save
                    </Button>
                  </div>
                </div>

                {isLoadingFile ? (
                  <div className="text-muted-foreground flex flex-1 items-center justify-center">
                    Loading...
                  </div>
                ) : (
                  <textarea
                    className="bg-background flex-1 resize-none p-4 font-mono text-sm leading-relaxed outline-none"
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    spellCheck={false}
                  />
                )}

                {saveMutation.error && (
                  <div className="bg-destructive/10 border-destructive/20 text-destructive border-t p-2 text-xs">
                    Error saving: {saveMutation.error.message}
                  </div>
                )}
              </>
            ) : (
              <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
                Select a file to edit
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
