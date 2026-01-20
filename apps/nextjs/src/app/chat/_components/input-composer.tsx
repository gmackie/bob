"use client";

import { useState, useRef, useCallback, KeyboardEvent } from "react";
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

export function InputComposer({
  onSend,
  disabled = false,
  placeholder = "Type a message...",
  agentType,
  sessionId,
}: InputComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isElevenLabs = agentType === "elevenlabs";
  
  const { state: voiceState, startVoice, stopVoice } = useVoiceSession(
    sessionId ?? null,
    agentType
  );
  
  const isVoiceActive = voiceState.status === "connected" && voiceState.isRecording;

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setValue("");
    
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  const handleVoiceToggle = useCallback(() => {
    if (!isElevenLabs || !sessionId) return;
    
    if (isVoiceActive) {
      stopVoice();
    } else {
      startVoice();
    }
  }, [isElevenLabs, sessionId, isVoiceActive, startVoice, stopVoice]);

  return (
    <div className="border-t p-4">
      {isElevenLabs && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-blue-50 p-2 dark:bg-blue-900/20">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Voice Mode</span>
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                isVoiceActive ? "bg-green-500 animate-pulse" : "bg-gray-400"
              )}
            />
          </div>
          <Button
            size="sm"
            variant={isVoiceActive ? "destructive" : "default"}
            onClick={handleVoiceToggle}
            disabled={disabled}
          >
            {isVoiceActive ? "Stop Voice" : "Start Voice"}
          </Button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={placeholder}
            disabled={disabled || isVoiceActive}
            rows={1}
            className={cn(
              "bg-background w-full resize-none rounded-lg border px-4 py-3 pr-12 text-sm",
              "focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "max-h-[200px]"
            )}
          />
        </div>
        
        <Button
          onClick={handleSend}
          disabled={disabled || !value.trim() || isVoiceActive}
          size="lg"
          className="shrink-0"
        >
          Send
        </Button>
      </div>
      
      <div className="mt-2 text-xs text-gray-500">
        {isVoiceActive
          ? "Voice mode active - speak into your microphone"
          : "Press Enter to send, Shift+Enter for new line"}
      </div>
    </div>
  );
}
