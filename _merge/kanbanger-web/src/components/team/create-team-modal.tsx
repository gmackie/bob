"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@linear-clone/ui/components/button";
import { Input } from "@linear-clone/ui/components/input";
import { Label } from "@linear-clone/ui/components/label";
import { api } from "@/lib/trpc/client";
import { X, Loader2, Users } from "lucide-react";

interface CreateTeamModalProps {
  workspaceId: string;
  workspaceSlug: string;
  onClose: () => void;
  onSuccess?: () => void;
}

const TEAM_COLORS = [
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#ec4899", // pink
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#3b82f6", // blue
];

export function CreateTeamModal({
  workspaceId,
  workspaceSlug,
  onClose,
  onSuccess,
}: CreateTeamModalProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(TEAM_COLORS[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const utils = api.useUtils();
  const createTeam = api.team.create.useMutation({
    onSuccess: (team) => {
      utils.team.list.invalidate();
      onSuccess?.();
      onClose();
      router.push(`/dashboard/${workspaceSlug}/${team.key}/issues`);
    },
    onError: (err) => {
      setError(err.message);
      setIsSubmitting(false);
    },
  });

  // Auto-generate key from name
  const handleNameChange = (value: string) => {
    setName(value);
    // Generate uppercase key from name (first letters of each word, or first 3 chars)
    const words = value.trim().split(/\s+/);
    let generatedKey: string;
    if (words.length >= 2) {
      generatedKey = words
        .map((w) => w[0])
        .join("")
        .toUpperCase()
        .slice(0, 5);
    } else {
      generatedKey = value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 5);
    }
    setKey(generatedKey);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !key.trim()) return;

    setError(null);
    setIsSubmitting(true);
    createTeam.mutate({
      workspaceId,
      name: name.trim(),
      key: key.trim().toUpperCase(),
      description: description.trim() || undefined,
      color,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">Create Team</span>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 p-4">
            <p className="text-sm text-muted-foreground">
              Teams organize issues and projects. Each team has its own board and backlog.
            </p>

            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="team-name">Team name</Label>
              <Input
                id="team-name"
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Engineering"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-key">Team key</Label>
              <Input
                id="team-key"
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder="ENG"
                maxLength={10}
              />
              <p className="text-xs text-muted-foreground">
                Used in issue identifiers (e.g., ENG-123). Uppercase letters and numbers only.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-description">Description (optional)</Label>
              <Input
                id="team-description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this team work on?"
              />
            </div>

            <div className="space-y-2">
              <Label>Team color</Label>
              <div className="flex flex-wrap gap-2">
                {TEAM_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`h-6 w-6 rounded-full transition-all ${
                      color === c ? "ring-2 ring-offset-2 ring-offset-background ring-primary" : ""
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !key.trim() || isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create team"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
