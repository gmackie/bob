import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { wsManager } from '../services/WebSocketManager';

interface TerminalComponentProps {
  sessionId: string;
  onClose: () => void;
}

export const TerminalComponent: React.FC<TerminalComponentProps> = ({ sessionId, onClose }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'error' | 'closed'>('connecting');
  const subscriptionRef = useRef<((message: any) => void) | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    terminal.current = new Terminal({
      theme: {
        background: '#1a1a1a',
        foreground: '#e5e5e5',
        cursor: '#ffffff',
      },
      fontSize: 14,
      fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
    });

    fitAddon.current = new FitAddon();
    terminal.current.loadAddon(fitAddon.current);
    terminal.current.open(terminalRef.current);
    
    // Multiple fitting attempts to ensure proper sizing
    const fitTerminal = () => {
      if (fitAddon.current && terminal.current) {
        try {
          fitAddon.current.fit();
        } catch (error) {
          console.warn('Terminal fit error:', error);
        }
      }
    };

    // Initial fit with small delay
    setTimeout(fitTerminal, 100);
    
    // Additional fits to ensure proper sizing
    setTimeout(fitTerminal, 300);
    setTimeout(fitTerminal, 600);
    setTimeout(fitTerminal, 1000);

    // Write any buffered snapshot immediately
    const snapshot = wsManager.getSnapshot(sessionId);
    if (snapshot) {
      try {
        terminal.current.write(snapshot);
      } catch {}
    }

    // Establish or reuse persistent WS connection via manager
    setConnectionState('connecting');
    const onMessage = (message: any) => {
      try {
        switch (message.type) {
          case 'data':
            terminal.current?.write(message.data);
            break;
          case 'ready':
            terminal.current?.focus();
            break;
        }
      } catch (e) {
        console.error('Terminal write error:', e);
      }
    };
    subscriptionRef.current = onMessage;
    wsManager
      .connect(sessionId, onMessage)
      .then(() => {
        setConnectionState('connected');
        setTimeout(() => {
          if (fitAddon.current && terminal.current) {
            try { fitAddon.current.fit(); } catch {}
          }
        }, 100);
      })
      .catch(() => setConnectionState('error'));

    terminal.current.onData((data) => {
      wsManager.send(sessionId, { type: 'data', data });
    });

    const handleResize = () => {
      if (fitAddon.current && terminal.current) {
        try {
          fitAddon.current.fit();
          const dims = fitAddon.current.proposeDimensions();
          if (dims) {
            wsManager.send(sessionId, { type: 'resize', cols: dims.cols, rows: dims.rows });
          }
        } catch (error) {
          console.warn('Resize fit error:', error);
        }
      }
    };

    // Listen for window resize
    window.addEventListener('resize', handleResize);

    // Create ResizeObserver to watch container size changes
    const resizeObserver = new ResizeObserver(() => {
      // Immediate resize for better responsiveness
      handleResize();
      // Also do a delayed resize to catch any missed sizing
      setTimeout(() => {
        handleResize();
      }, 100);
    });
    
    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      if (subscriptionRef.current) {
        wsManager.disconnect(sessionId, subscriptionRef.current);
      }
      terminal.current?.dispose();
    };
  }, [sessionId]);

  return (
    <div style={{ 
      flex: 1, 
      display: 'flex', 
      flexDirection: 'column',
      minHeight: 0,
      height: '100%'
    }}>
      <div style={{ 
        padding: '4px 8px', 
        background: '#333', 
        borderBottom: '1px solid #444',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
        minHeight: '28px',
        height: '28px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '12px', color: '#ccc' }}>
            Terminal Session: {sessionId.slice(-8)}
          </span>
          <div
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor:
                connectionState === 'connected' ? '#28a745' :
                connectionState === 'connecting' ? '#ffc107' :
                connectionState === 'error' ? '#dc3545' : '#6c757d'
            }}
            title={`Connection: ${connectionState}`}
          />
        </div>
        <button 
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#ccc',
            cursor: 'pointer',
            fontSize: '16px'
          }}
        >
          ×
        </button>
      </div>
      <div ref={terminalRef} style={{ 
        flex: 1, 
        minHeight: 0,
        width: '100%',
        height: '100%',
        backgroundColor: '#1a1a1a'
      }} />
    </div>
  );
};
