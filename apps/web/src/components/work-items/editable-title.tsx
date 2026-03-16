"use client";

import { InlineEditable } from "@bob/ui/inline-editable";

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
      inputClassName="text-2xl font-semibold"
    >
      {({ value: v, onClick }) => (
        <h1
          onClick={onClick}
          className="cursor-pointer text-2xl font-semibold text-white transition-colors hover:text-white/80"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") onClick();
          }}
        >
          {v || <span className="text-white/35">Untitled</span>}
        </h1>
      )}
    </InlineEditable>
  );
}
