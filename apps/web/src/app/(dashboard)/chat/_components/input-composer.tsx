"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { KeyboardEvent } from "react";
import { cn } from "@bob/ui";
import { Button } from "@bob/ui/button";
import { useVoiceSession } from "~/hooks/use-voice-session";

interface InputComposerProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  agentType?: string;
  sessionId?: string;
}

const quickPrompts = [
  "Explain this goal and suggest a plan",
  "Summarize key decisions and next steps",
  "Generate a practical implementation plan",
  "Refactor this with safer patterns",
  "Run a quick self-check on this work",
];

function getInputHeight(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
}

export function InputComposer({
  onSend,
  disabled = false,
  placeholder = "Type a message...",
  agentType,
  sessionId,
}: InputComposerProps) {
  const [value, setValue] = useState("");
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [uploadPreview, setUploadPreview] = useState<{
    file: File;
    previewUrl: string;
    uploadedUrl?: string;
    isUploading: boolean;
    error?: string;
  } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isElevenLabs = agentType === "elevenlabs";
  const canSend = (value.trim().length > 0 || uploadPreview?.uploadedUrl) && !disabled;
  
  const { state: voiceState, startVoice, stopVoice } = useVoiceSession(
    sessionId ?? null,
    agentType,
  );
  
  const isVoiceActive = voiceState.status === "connected" && voiceState.isRecording;

  const resizeComposerInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    getInputHeight(textarea);
  }, []);

  useEffect(() => {
    resizeComposerInput();
  }, [value, resizeComposerInput]);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    const imageUrl = uploadPreview?.uploadedUrl;

    if (!trimmed && !imageUrl) return;
    if (disabled) return;

    const parts: string[] = [];
    if (trimmed) parts.push(trimmed);
    if (imageUrl) parts.push(imageUrl);

    onSend(parts.join("\n"));
    setValue("");
    setUploadPreview(null);
  }, [value, disabled, onSend, uploadPreview]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInput = useCallback(() => {
    resizeComposerInput();
  }, [resizeComposerInput]);

  const handleVoiceToggle = useCallback(() => {
    if (!isElevenLabs || !sessionId) return;
    
    if (isVoiceActive) {
      void stopVoice();
    } else {
      void startVoice();
    }
  }, [isElevenLabs, sessionId, isVoiceActive, startVoice, stopVoice]);

  const handlePromptSelect = useCallback(
    (prompt: string) => {
      if (disabled || isVoiceActive) return;

      setValue((prevValue) =>
        prevValue.trim().length > 0 ? `${prevValue.trim()}\n${prompt}` : prompt,
      );
      setIsFocusMode(true);

      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    },
    [disabled, isVoiceActive],
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset input so same file can be re-selected
      e.target.value = "";

      if (!file.type.startsWith("image/")) return;

      const previewUrl = URL.createObjectURL(file);
      setUploadPreview({ file, previewUrl, isUploading: true });

      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        if (!res.ok) {
          const data = await res.json() as { error?: string };
          throw new Error(data.error ?? "Upload failed");
        }
        const data = await res.json() as { url: string };
        setUploadPreview((prev) =>
          prev ? { ...prev, uploadedUrl: data.url, isUploading: false } : null,
        );
      } catch (err) {
        setUploadPreview((prev) =>
          prev
            ? { ...prev, isUploading: false, error: err instanceof Error ? err.message : "Upload failed" }
            : null,
        );
      }
    },
    [],
  );

  const handleRemovePreview = useCallback(() => {
    if (uploadPreview) {
      URL.revokeObjectURL(uploadPreview.previewUrl);
    }
    setUploadPreview(null);
  }, [uploadPreview]);

  return (
    <div className={cn("chat-composer", isFocusMode && "is-focus")}>
      {isElevenLabs && (
        <div className="chat-voicePanel">
          <div className="chat-voiceStatus">
            Voice Mode
            <span
              className={cn(
                "chat-voiceDot",
                isVoiceActive && "is-active",
              )}
            />
          </div>
          <Button
            size="sm"
            variant={isVoiceActive ? "destructive" : "default"}
            onClick={handleVoiceToggle}
            disabled={disabled}
            className={isVoiceActive ? "" : "chat-sidebarButtonPrimary"}
          >
            {isVoiceActive ? "Stop Voice" : "Start Voice"}
          </Button>
        </div>
      )}

      <div className="chat-composerMode">
        <button
          type="button"
          className={cn("chat-composerModeButton", isFocusMode && "is-focus")}
          onClick={() => setIsFocusMode((prev) => !prev)}
          aria-pressed={isFocusMode}
          aria-label={isFocusMode ? "Switch to compact composer" : "Switch to focus mode"}
        >
          {isFocusMode ? "Compact mode" : "Focus mode"}
        </button>
      </div>

      {!isVoiceActive && (
        <div
          className="chat-composerPrompts"
          aria-label="Quick prompts"
          role="group"
        >
          {quickPrompts.map((prompt) => (
            <Button
              type="button"
              key={prompt}
              variant="outline"
              size="sm"
              className="chat-quickPrompt"
              onClick={() => handlePromptSelect(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </div>
      )}

      {uploadPreview && (
        <div className="chat-uploadPreview">
          <div className="chat-uploadPreviewThumb">
            <img src={uploadPreview.previewUrl} alt="Upload preview" />
            {uploadPreview.isUploading && (
              <div className="chat-uploadPreviewSpinner">
                <div className="chat-uploadPreviewSpinnerDot" />
              </div>
            )}
          </div>
          <span className="chat-uploadPreviewName">
            {uploadPreview.error ?? uploadPreview.file.name}
          </span>
          <button
            type="button"
            className="chat-uploadPreviewRemove"
            onClick={handleRemovePreview}
            aria-label="Remove image"
          >
            &times;
          </button>
        </div>
      )}

      <div className="chat-composerRow">
        <div className="chat-composerField">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onFocus={() => setIsFocusMode(true)}
            placeholder={placeholder}
            disabled={disabled || isVoiceActive}
            aria-label="Message input"
            rows={1}
            maxLength={3000}
            className="chat-composerInput"
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => void handleFileSelect(e)}
          className="sr-only"
          aria-label="Attach image"
          tabIndex={-1}
        />
        <button
          type="button"
          className="chat-attachButton"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isVoiceActive || !!uploadPreview}
          aria-label="Attach image"
        >
          <span className="chat-attachButtonIcon" aria-hidden="true">
            &#128206;
          </span>
        </button>

        <Button
          type="button"
          onClick={handleSend}
          disabled={!canSend || isVoiceActive}
          size="lg"
          className={cn("chat-sendButton", canSend && "is-ready")}
        >
          <span className="chat-sendButtonLabel">Send</span>
          <span className="chat-sendButtonIcon" aria-hidden="true">
            →
          </span>
        </Button>
      </div>

      <div className="chat-composerHint">
        {isVoiceActive
          ? "Voice mode active - speak into your microphone"
          : `${value.length}/3000 characters • Press Enter to send, Shift+Enter for new line`}
      </div>
    </div>
  );
}
