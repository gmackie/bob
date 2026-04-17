import { type FormEvent, useRef, useEffect } from "react";

interface CreateBranchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}

export function CreateBranchDialog({ isOpen, onClose, onSubmit }: CreateBranchDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const name = inputRef.current?.value.trim();
    if (name) {
      onSubmit(name);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div
      data-testid="create-branch-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-[var(--color-bg)] p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold text-[var(--color-text)]">
          Create Branch
        </h2>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Branch name"
            className="mb-4 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none"
            required
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm text-[var(--color-bg)] hover:opacity-90"
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
