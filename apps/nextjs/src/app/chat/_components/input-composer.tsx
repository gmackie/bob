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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isElevenLabs = agentType === "elevenlabs";
  const canSend = value.trim().length > 0 && !disabled;
  
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
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setValue("");
  }, [value, disabled, onSend]);

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
