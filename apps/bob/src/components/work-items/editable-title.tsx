"use client";

import { InlineEditable } from "@gmacko/core/ui/inline-editable";

interface EditableTitleProps {
  value: string;
  onSave: (value: string) => unknown | Promise<unknown>;
  disabled?: boolean;
}

export function EditableTitle({ value, onSave, disabled }: EditableTitleProps) {
  return (
    <InlineEditable
      value={value}
      onSave={onSave}
      disabled={disabled}
      placeholder="Untitled"
      inputClassName="font-display text-2xl font-semibold"
    >
      {({ value: v, onClick }) => (
        <h1
          onClick={onClick}
          className="cursor-pointer font-display text-2xl font-semibold text-foreground transition-colors hover:text-foreground"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") onClick();
          }}
        >
          {v || <span className="text-muted-foreground">Untitled</span>}
        </h1>
      )}
    </InlineEditable>
  );
}
