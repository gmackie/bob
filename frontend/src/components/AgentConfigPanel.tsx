import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { AgentType } from '../types';

interface ConfigFile {
  name: string;
  path: string;
  exists: boolean;
  content?: string;
}

interface AgentConfigPanelProps {
  onClose: () => void;
}

const AGENT_TYPES: { type: AgentType; name: string; icon: string }[] = [
  { type: 'claude', name: 'Claude', icon: '🤖' },
  { type: 'gemini', name: 'Gemini', icon: '✨' },
  { type: 'opencode', name: 'OpenCode', icon: '💻' },
  { type: 'kiro', name: 'Kiro', icon: '🔮' },
  { type: 'codex', name: 'Codex', icon: '📝' },
];

export const AgentConfigPanel: React.FC<AgentConfigPanelProps> = ({ onClose }) => {
  const [selectedAgent, setSelectedAgent] = useState<AgentType>('claude');
  const [configFiles, setConfigFiles] = useState<ConfigFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<ConfigFile | null>(null);
  const [editedContent, setEditedContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [configDir, setConfigDir] = useState<string>('');
  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const loadConfig = useCallback(async (agentType: AgentType) => {
    setLoading(true);
    setError(null);
    setSelectedFile(null);
    setEditedContent('');
    setHasUnsavedChanges(false);
    
    try {
      const config = await api.getAgentConfig(agentType);
      setConfigFiles(config.files);
      setConfigDir(config.configDir);
      
      // Auto-select first existing file
      const existingFile = config.files.find(f => f.exists);
      if (existingFile) {
        setSelectedFile(existingFile);
        setEditedContent(existingFile.content || '{}');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load config');
      setConfigFiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig(selectedAgent);
  }, [selectedAgent, loadConfig]);

  const handleAgentChange = (agentType: AgentType) => {
    if (hasUnsavedChanges) {
      if (!window.confirm('You have unsaved changes. Discard them?')) {
        return;
      }
    }
    setSelectedAgent(agentType);
  };

  const handleFileSelect = (file: ConfigFile) => {
    if (hasUnsavedChanges) {
      if (!window.confirm('You have unsaved changes. Discard them?')) {
        return;
      }
    }
    setSelectedFile(file);
    setEditedContent(file.content || '{}');
    setHasUnsavedChanges(false);
    setError(null);
    setSuccessMessage(null);
  };

  const handleContentChange = (value: string) => {
    setEditedContent(value);
    setHasUnsavedChanges(value !== (selectedFile?.content || '{}'));
    setError(null);
    setSuccessMessage(null);
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(editedContent);
      const formatted = JSON.stringify(parsed, null, 2);
      setEditedContent(formatted);
      setHasUnsavedChanges(formatted !== (selectedFile?.content || '{}'));
    } catch (e) {
      setError('Invalid JSON - cannot format');
    }
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    
    // Validate JSON
    try {
      JSON.parse(editedContent);
    } catch (e) {
      setError('Invalid JSON - please fix before saving');
      return;
    }
    
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    
    try {
      if (selectedFile.exists) {
        await api.saveAgentConfig(selectedAgent, selectedFile.name, editedContent);
      } else {
        await api.createAgentConfigFile(selectedAgent, selectedFile.name, editedContent);
      }
      
      setSuccessMessage('Config saved successfully');
      setHasUnsavedChanges(false);
      
      // Reload to get updated state
      await loadConfig(selectedAgent);
      
      // Re-select the file
      const updatedFile = configFiles.find(f => f.name === selectedFile.name);
      if (updatedFile) {
        setSelectedFile({ ...updatedFile, content: editedContent, exists: true });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return;
    
    let fileName = newFileName.trim();
    if (!fileName.endsWith('.json')) {
      fileName += '.json';
    }
    
    try {
      await api.createAgentConfigFile(selectedAgent, fileName, '{\n  \n}');
      setShowNewFileModal(false);
      setNewFileName('');
      await loadConfig(selectedAgent);
      
      // Select the new file
      setSelectedFile({
        name: fileName,
        path: `${configDir}/${fileName}`,
        exists: true,
        content: '{\n  \n}'
      });
      setEditedContent('{\n  \n}');
    } catch (err: any) {
      setError(err.message || 'Failed to create file');
    }
  };

  const handleDeleteFile = async () => {
    if (!selectedFile || !selectedFile.exists) return;
    
    if (!window.confirm(`Delete ${selectedFile.name}? This cannot be undone.`)) {
      return;
    }
    
    try {
      await api.deleteAgentConfigFile(selectedAgent, selectedFile.name);
      setSelectedFile(null);
      setEditedContent('');
      await loadConfig(selectedAgent);
    } catch (err: any) {
      setError(err.message || 'Failed to delete file');
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000
    }}>
      <div style={{
        width: '90%',
        maxWidth: '1200px',
        height: '80vh',
        backgroundColor: '#1e1e1e',
        borderRadius: '8px',
        border: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '16px 20px',
          borderBottom: '1px solid #333',
          backgroundColor: '#252526'
        }}>
          <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '16px' }}>
            Agent Configuration
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '0 8px',
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Agent Selector Sidebar */}
          <div style={{
            width: '200px',
            borderRight: '1px solid #333',
            backgroundColor: '#252526',
            overflowY: 'auto'
          }}>
            <div style={{ padding: '12px', borderBottom: '1px solid #333' }}>
              <div style={{ color: '#888', fontSize: '11px', textTransform: 'uppercase', marginBottom: '8px' }}>
                Agents
              </div>
              {AGENT_TYPES.map(agent => (
                <div
                  key={agent.type}
                  onClick={() => handleAgentChange(agent.type)}
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    borderRadius: '4px',
                    marginBottom: '4px',
                    backgroundColor: selectedAgent === agent.type ? '#094771' : 'transparent',
                    color: selectedAgent === agent.type ? '#fff' : '#ccc',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <span>{agent.icon}</span>
                  <span>{agent.name}</span>
                </div>
              ))}
            </div>

            {/* Config Files */}
            <div style={{ padding: '12px' }}>
              <div style={{ 
                color: '#888', 
                fontSize: '11px', 
                textTransform: 'uppercase', 
                marginBottom: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span>Config Files</span>
                <button
                  onClick={() => setShowNewFileModal(true)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#4CAF50',
                    cursor: 'pointer',
                    fontSize: '16px',
                    padding: 0
                  }}
                  title="Create new config file"
                >
                  +
                </button>
              </div>
              
              {loading ? (
                <div style={{ color: '#666', fontSize: '12px' }}>Loading...</div>
              ) : (
                configFiles.map(file => (
                  <div
                    key={file.name}
                    onClick={() => handleFileSelect(file)}
                    style={{
                      padding: '8px 10px',
                      cursor: 'pointer',
                      borderRadius: '4px',
                      marginBottom: '4px',
                      backgroundColor: selectedFile?.name === file.name ? '#333' : 'transparent',
                      color: file.exists ? '#ccc' : '#666',
                      fontSize: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <span style={{ opacity: file.exists ? 1 : 0.5 }}>📄</span>
                    <span style={{ 
                      flex: 1, 
                      overflow: 'hidden', 
                      textOverflow: 'ellipsis',
                      fontStyle: file.exists ? 'normal' : 'italic'
                    }}>
                      {file.name}
                    </span>
                    {!file.exists && (
                      <span style={{ fontSize: '10px', color: '#666' }}>(new)</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Editor */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Editor Header */}
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid #333',
              backgroundColor: '#2d2d2d',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                {selectedFile ? (
                  <div>
                    <span style={{ color: '#fff', fontSize: '14px' }}>{selectedFile.name}</span>
                    <span style={{ color: '#666', fontSize: '12px', marginLeft: '8px' }}>
                      {configDir}
                    </span>
                    {hasUnsavedChanges && (
                      <span style={{ color: '#f0ad4e', fontSize: '12px', marginLeft: '8px' }}>
                        (unsaved)
                      </span>
                    )}
                  </div>
                ) : (
                  <span style={{ color: '#666' }}>Select a config file</span>
                )}
              </div>
              
              {selectedFile && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={formatJson}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#444',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    Format JSON
                  </button>
                  {selectedFile.exists && (
                    <button
                      onClick={handleDeleteFile}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#5c1a1a',
                        color: '#ff6b6b',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px'
                      }}
                    >
                      Delete
                    </button>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving || !hasUnsavedChanges}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: hasUnsavedChanges ? '#238636' : '#333',
                      color: hasUnsavedChanges ? '#fff' : '#666',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: hasUnsavedChanges ? 'pointer' : 'not-allowed',
                      fontSize: '12px'
                    }}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            {/* Messages */}
            {error && (
              <div style={{
                padding: '10px 16px',
                backgroundColor: '#5c1a1a',
                color: '#ff6b6b',
                fontSize: '13px'
              }}>
                {error}
              </div>
            )}
            {successMessage && (
              <div style={{
                padding: '10px 16px',
                backgroundColor: '#1a3d1a',
                color: '#4CAF50',
                fontSize: '13px'
              }}>
                {successMessage}
              </div>
            )}

            {/* Textarea Editor */}
            <div style={{ flex: 1, padding: '16px', overflow: 'hidden' }}>
              {selectedFile ? (
                <textarea
                  value={editedContent}
                  onChange={(e) => handleContentChange(e.target.value)}
                  style={{
                    width: '100%',
                    height: '100%',
                    backgroundColor: '#1a1a1a',
                    color: '#d4d4d4',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    padding: '12px',
                    fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
                    fontSize: '13px',
                    resize: 'none',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                  spellCheck={false}
                />
              ) : (
                <div style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#666'
                }}>
                  Select a config file from the sidebar to edit
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* New File Modal */}
      {showNewFileModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1001
        }}>
          <div style={{
            backgroundColor: '#2d2d2d',
            padding: '24px',
            borderRadius: '8px',
            border: '1px solid #444',
            width: '400px'
          }}>
            <h3 style={{ color: '#fff', margin: '0 0 16px 0', fontSize: '16px' }}>
              Create New Config File
            </h3>
            <input
              type="text"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="filename.json"
              style={{
                width: '100%',
                padding: '10px 12px',
                backgroundColor: '#1a1a1a',
                border: '1px solid #444',
                borderRadius: '4px',
                color: '#fff',
                fontSize: '14px',
                marginBottom: '16px',
                boxSizing: 'border-box'
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFile()}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                onClick={() => {
                  setShowNewFileModal(false);
                  setNewFileName('');
                }}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'transparent',
                  color: '#888',
                  border: '1px solid #444',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFile}
                disabled={!newFileName.trim()}
                style={{
                  padding: '8px 16px',
                  backgroundColor: newFileName.trim() ? '#238636' : '#333',
                  color: newFileName.trim() ? '#fff' : '#666',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: newFileName.trim() ? 'pointer' : 'not-allowed'
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
