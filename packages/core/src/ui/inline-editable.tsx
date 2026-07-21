"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "./utils";

interface InlineEditableProps {
  value: string;
  onSave: (value: string) => unknown | Promise<unknown>;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
  disabled?: boolean;
  children?: (props: {
    value: string;
    onClick: () => void;
    editing: boolean;
  }) => React.ReactNode;
}

export function InlineEditable({
  value,
  onSave,
  placeholder = "Click to edit",
  className,
  inputClassName,
  multiline = false,
  disabled = false,
  children,
}: InlineEditableProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const startEditing = useCallback(() => {
    if (disabled || saving) return;
    setDraft(value);
    setEditing(true);
  }, [disabled, saving, value]);

  const save = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }, [draft, value, onSave]);

  const cancel = useCallback(() => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
      if (e.key === "Enter" && !multiline) {
        e.preventDefault();
        save();
      }
      if (e.key === "Enter" && multiline && e.metaKey) {
        e.preventDefault();
        save();
      }
    },
    [cancel, save, multiline],
  );

  if (children) {
    return (
      <>
        {!editing &&
          children({ value, onClick: startEditing, editing: false })}
        {editing && (
          <div className={cn("relative", className)}>
            {multiline ? (
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={save}
                onKeyDown={handleKeyDown}
                disabled={saving}
                className={cn(
                  "w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-ring",
                  saving && "opacity-50",
                  inputClassName,
                )}
              />
            ) : (
              <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={save}
                onKeyDown={handleKeyDown}
                disabled={saving}
                className={cn(
                  "w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-ring",
                  saving && "opacity-50",
                  inputClassName,
                )}
              />
            )}
          </div>
        )}
      </>
    );
  }

  if (!editing) {
    return (
      <button
        onClick={startEditing}
        disabled={disabled}
        className={cn(
          "cursor-pointer rounded px-1 py-0.5 text-left transition-colors hover:bg-accent",
          disabled && "cursor-default",
          className,
        )}
      >
        {value || (
          <span className="text-muted-foreground/70">{placeholder}</span>
        )}
      </button>
    );
  }

  return (
    <div className={cn("relative", className)}>
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          disabled={saving}
          placeholder={placeholder}
          className={cn(
            "w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-ring",
            saving && "opacity-50",
            inputClassName,
          )}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={handleKeyDown}
          disabled={saving}
          placeholder={placeholder}
          className={cn(
            "w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-ring",
            saving && "opacity-50",
            inputClassName,
          )}
        />
      )}
    </div>
  );
}
