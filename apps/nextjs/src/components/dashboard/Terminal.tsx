"use client";

import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import type { Terminal as XTermTerminal } from "@xterm/xterm";
import React, { useEffect, useRef, useState } from "react";

import { getWsManager } from "~/lib/websocket";

interface TerminalComponentProps {
  sessionId: string;
  onClose: () => void;
}

type ConnectionState = "connecting" | "connected" | "error" | "closed";

export function TerminalComponent({
  sessionId,
  onClose,
}: TerminalComponentProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<XTermTerminal | null>(null);
  const fitAddon = useRef<XTermFitAddon | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const subscriptionRef = useRef<((message: unknown) => void) | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadAndInitialize = async () => {
      if (!terminalRef.current) return;

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);

      if (!mounted || !terminalRef.current) return;

      terminal.current = new Terminal({
        theme: {
          background: "#1a1a1a",
          foreground: "#e5e5e5",
          cursor: "#ffffff",
        },
        fontSize: 14,
        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
      });

      fitAddon.current = new FitAddon();
      terminal.current.loadAddon(fitAddon.current);
      terminal.current.open(terminalRef.current);

      const fitTerminal = () => {
        if (fitAddon.current && terminal.current) {
          try {
            fitAddon.current.fit();
          } catch (error) {
            console.warn("Terminal fit error:", error);
          }
        }
      };

      setTimeout(fitTerminal, 100);
      setTimeout(fitTerminal, 300);
      setTimeout(fitTerminal, 600);
      setTimeout(fitTerminal, 1000);

      const wsManager = getWsManager();
      const snapshot = wsManager.getSnapshot(sessionId);
      if (snapshot) {
        try {
          terminal.current.write(snapshot);
        } catch {}
      }

      setConnectionState("connecting");
      const onMessage = (message: unknown) => {
        try {
          const msg = message as { type: string; data?: string };
          switch (msg.type) {
            case "data":
              if (msg.data) {
                terminal.current?.write(msg.data);
              }
              break;
            case "ready":
              terminal.current?.focus();
              break;
          }
        } catch (e) {
          console.error("Terminal write error:", e);
        }
      };
      subscriptionRef.current = onMessage;

      wsManager
        .connect(sessionId, onMessage)
        .then(() => {
          if (!mounted) return;
          setConnectionState("connected");
          setTimeout(() => {
            if (fitAddon.current && terminal.current) {
              try {
                fitAddon.current.fit();
              } catch {}
            }
          }, 100);
        })
        .catch(() => {
          if (mounted) setConnectionState("error");
        });

      terminal.current.onData((data: string) => {
        wsManager.send(sessionId, { type: "data", data });
      });

      const handleResize = () => {
        if (fitAddon.current && terminal.current) {
          try {
            fitAddon.current.fit();
            const dims = fitAddon.current.proposeDimensions();
            if (dims) {
              wsManager.send(sessionId, {
                type: "resize",
                cols: dims.cols,
                rows: dims.rows,
              });
            }
          } catch (error) {
            console.warn("Resize fit error:", error);
          }
        }
      };

      window.addEventListener("resize", handleResize);

      const resizeObserver = new ResizeObserver(() => {
        handleResize();
        setTimeout(() => {
          handleResize();
        }, 100);
      });

      if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current);
      }

      setIsLoaded(true);

      return () => {
        window.removeEventListener("resize", handleResize);
        resizeObserver.disconnect();
      };
    };

    loadAndInitialize();

    return () => {
      mounted = false;
      if (subscriptionRef.current) {
        try {
          const wsManager = getWsManager();
          wsManager.disconnect(sessionId, subscriptionRef.current);
        } catch {}
      }
      terminal.current?.dispose();
    };
  }, [sessionId]);

  const getStatusColor = () => {
    switch (connectionState) {
      case "connected":
        return "#28a745";
      case "connecting":
        return "#ffc107";
      case "error":
        return "#dc3545";
      default:
        return "#6c757d";
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
      }}
    >
      <div
        style={{
          padding: "4px 8px",
          background: "#333",
          borderBottom: "1px solid #444",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
          minHeight: "28px",
          height: "28px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "#ccc" }}>
            Terminal Session: {sessionId.slice(-8)}
          </span>
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: getStatusColor(),
            }}
            title={`Connection: ${connectionState}`}
          />
        </div>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#ccc",
            cursor: "pointer",
            fontSize: "16px",
          }}
        >
          ×
        </button>
      </div>
      <div
        ref={terminalRef}
        style={{
          flex: 1,
          minHeight: 0,
          width: "100%",
          height: "100%",
          backgroundColor: "#1a1a1a",
        }}
      />
      {!isLoaded && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            color: "#888",
          }}
        >
          Loading terminal...
        </div>
      )}
    </div>
  );
}
