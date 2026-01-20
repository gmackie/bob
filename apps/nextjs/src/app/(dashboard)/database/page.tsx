"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useCheatCode } from "~/contexts/CheatCodeContext";
import { api } from "~/lib/rest/api";

interface TableData {
  data: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Column {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

export default function DatabasePage() {
  const router = useRouter();
  const { isDatabaseUnlocked } = useCheatCode();
  const [isWarningAccepted, setIsWarningAccepted] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [tableSchema, setTableSchema] = useState<Column[]>([]);
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sqlQuery, setSqlQuery] = useState("");
  const [queryResult, setQueryResult] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  const loadTables = useCallback(async () => {
    try {
      setLoading(true);
      const tablesData = await api.getDatabaseTables();
      setTables(tablesData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tables");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTableSchema = useCallback(async () => {
    if (!selectedTable) return;

    try {
      const schema = (await api.getTableSchema(selectedTable)) as Column[];
      setTableSchema(schema);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load table schema",
      );
    }
  }, [selectedTable]);

  const loadTableData = useCallback(
    async (page: number) => {
      if (!selectedTable) return;

      try {
        setLoading(true);
        const data = (await api.getTableData(
          selectedTable,
          page,
          50,
        )) as TableData;
        setTableData(data);
        setCurrentPage(page);
        setSelectedRows(new Set());
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load table data",
        );
      } finally {
        setLoading(false);
      }
    },
    [selectedTable],
  );

  useEffect(() => {
    if (isWarningAccepted) {
      loadTables();
    }
  }, [isWarningAccepted, loadTables]);

  useEffect(() => {
    if (selectedTable) {
      loadTableSchema();
      loadTableData(1);
      setSelectedRows(new Set());
    }
  }, [selectedTable, loadTableSchema, loadTableData]);

  const executeQuery = async () => {
    if (!sqlQuery.trim()) return;

    try {
      setLoading(true);
      const result = (await api.executeQuery(sqlQuery)) as Record<
        string,
        unknown
      >[];
      setQueryResult(result);
      setError(null);
      setSuccess("Query executed successfully");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute query");
      setQueryResult([]);
    } finally {
      setLoading(false);
    }
  };

  const deleteSelectedRows = async () => {
    const whereClause = prompt(
      "Enter WHERE clause for DELETE operation (e.g., id = 123):",
    );
    if (!whereClause || !selectedTable) return;

    const confirmed = confirm(
      `This will DELETE rows from ${selectedTable} WHERE ${whereClause}. This action cannot be undone. Continue?`,
    );
    if (!confirmed) return;

    try {
      setLoading(true);
      const result = await api.deleteRows(selectedTable, whereClause, true);
      setSuccess(result.message);
      loadTableData(currentPage);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete rows");
    } finally {
      setLoading(false);
    }
  };

  const deleteSelectedRowsById = async () => {
    if (selectedRows.size === 0) {
      setError("No rows selected for deletion");
      return;
    }

    if (!tableData || !selectedTable) return;

    const pkColumn = tableSchema.find((col) => col.pk === 1);
    if (!pkColumn) {
      setError("Cannot delete rows: No primary key found in table schema");
      return;
    }

    const selectedIds = Array.from(selectedRows)
      .map((rowIndex) => {
        const row = tableData.data[rowIndex];
        return row?.[pkColumn.name];
      })
      .filter((id) => id !== undefined);

    const confirmed = confirm(
      `This will DELETE ${selectedIds.length} selected rows from ${selectedTable}. This action cannot be undone. Continue?`,
    );
    if (!confirmed) return;

    try {
      setLoading(true);
      const whereClause = `${pkColumn.name} IN (${selectedIds.map((id) => (typeof id === "string" ? `'${id}'` : id)).join(", ")})`;
      const result = await api.deleteRows(selectedTable, whereClause, true);
      setSuccess(result.message);
      setSelectedRows(new Set());
      loadTableData(currentPage);
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete selected rows",
      );
    } finally {
      setLoading(false);
    }
  };

  const toggleRowSelection = (rowIndex: number) => {
    const newSelection = new Set(selectedRows);
    if (newSelection.has(rowIndex)) {
      newSelection.delete(rowIndex);
    } else {
      newSelection.add(rowIndex);
    }
    setSelectedRows(newSelection);
  };

  const toggleAllRows = () => {
    if (!tableData) return;

    if (selectedRows.size === tableData.data.length) {
      setSelectedRows(new Set());
    } else {
      const allRowIndices = new Set(tableData.data.map((_, index) => index));
      setSelectedRows(allRowIndices);
    }
  };

  const updateSelectedRows = async () => {
    const setClause = prompt(
      'Enter SET clause for UPDATE operation (e.g., status = "stopped"):',
    );
    if (!setClause) return;

    const whereClause = prompt(
      "Enter WHERE clause for UPDATE operation (e.g., id = 123):",
    );
    if (!whereClause || !selectedTable) return;

    const confirmed = confirm(
      `This will UPDATE ${selectedTable} SET ${setClause} WHERE ${whereClause}. Continue?`,
    );
    if (!confirmed) return;

    try {
      setLoading(true);
      const result = await api.updateRows(
        selectedTable,
        setClause,
        whereClause,
        true,
      );
      setSuccess(result.message);
      loadTableData(currentPage);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update rows");
    } finally {
      setLoading(false);
    }
  };

  if (!isDatabaseUnlocked) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          backgroundColor: "#1e1e1e",
          color: "#e5e5e5",
        }}
      >
        <h2>Database Manager</h2>
        <p style={{ color: "#888", marginTop: "16px" }}>
          This feature is locked. Type the secret code to unlock.
        </p>
        <button
          onClick={() => router.push("/")}
          style={{
            marginTop: "24px",
            padding: "10px 20px",
            backgroundColor: "#333",
            color: "#fff",
            border: "1px solid #444",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Return to Dashboard
        </button>
      </div>
    );
  }

  if (!isWarningAccepted) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          backgroundColor: "#1e1e1e",
          color: "#e5e5e5",
          padding: "40px",
        }}
      >
        <div
          style={{
            maxWidth: "600px",
            backgroundColor: "#2d1b1b",
            border: "1px solid #5a1f1f",
            borderRadius: "8px",
            padding: "32px",
          }}
        >
          <h2 style={{ color: "#ff6b6b", marginBottom: "16px" }}>
            ⚠️ Database Management
          </h2>
          <div style={{ color: "#e5e5e5", lineHeight: "1.6" }}>
            <p>
              <strong>WARNING:</strong> Doing anything with this page can cause
              issues with Bob and your Git repositories and may require manual
              cleanup.
            </p>
            <ul style={{ marginTop: "16px", paddingLeft: "20px" }}>
              <li>Only use this page if you know what you&apos;re doing</li>
              <li>Always backup your data before making modifications</li>
              <li>Incorrect operations may corrupt your Bob database</li>
              <li>
                You may need to manually clean up Git repositories if something
                goes wrong
              </li>
            </ul>
            <p style={{ marginTop: "16px", color: "#888" }}>
              This interface provides direct access to Bob&apos;s SQLite
              database for debugging and manual maintenance purposes.
            </p>
          </div>
          <div
            style={{
              display: "flex",
              gap: "12px",
              marginTop: "24px",
              justifyContent: "center",
            }}
          >
            <button
              onClick={() => router.push("/")}
              style={{
                padding: "10px 20px",
                backgroundColor: "#333",
                color: "#fff",
                border: "1px solid #444",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Go Back
            </button>
            <button
              onClick={() => setIsWarningAccepted(true)}
              style={{
                padding: "10px 20px",
                backgroundColor: "#dc3545",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              I Understand the Risks - Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderTableData = () => {
    if (!tableData || tableData.data.length === 0) {
      return (
        <div style={{ color: "#888", textAlign: "center", padding: "40px" }}>
          No data found
        </div>
      );
    }

    const firstRow = tableData.data[0];
    if (!firstRow) return null;
    const columns = Object.keys(firstRow);
    const pkColumn = tableSchema.find((col) => col.pk === 1);
    const canDelete = !!pkColumn;

    return (
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h3 style={{ color: "#fff", margin: 0 }}>
            {selectedTable} ({tableData.total} rows)
          </h3>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={updateSelectedRows}
              style={{
                padding: "6px 12px",
                backgroundColor: "#f59e0b",
                color: "#000",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Update Rows
            </button>
            <button
              onClick={deleteSelectedRows}
              style={{
                padding: "6px 12px",
                backgroundColor: "#dc3545",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              Delete Rows (WHERE)
            </button>
            {canDelete && (
              <button
                onClick={deleteSelectedRowsById}
                disabled={selectedRows.size === 0}
                style={{
                  padding: "6px 12px",
                  backgroundColor: selectedRows.size === 0 ? "#666" : "#dc3545",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: selectedRows.size === 0 ? "not-allowed" : "pointer",
                  fontSize: "12px",
                }}
              >
                Delete Selected ({selectedRows.size})
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            overflowX: "auto",
            backgroundColor: "#0d1117",
            border: "1px solid #30363d",
            borderRadius: "6px",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "12px",
            }}
          >
            <thead>
              <tr style={{ backgroundColor: "#21262d" }}>
                {canDelete && (
                  <th style={{ padding: "8px", width: "40px" }}>
                    <input
                      type="checkbox"
                      checked={
                        tableData.data.length > 0 &&
                        selectedRows.size === tableData.data.length
                      }
                      onChange={toggleAllRows}
                      title="Select all rows"
                    />
                  </th>
                )}
                {columns.map((col) => (
                  <th
                    key={col}
                    style={{
                      padding: "8px",
                      textAlign: "left",
                      color: "#e6edf3",
                      borderBottom: "1px solid #30363d",
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableData.data.map((row, index) => (
                <tr
                  key={index}
                  style={{
                    backgroundColor: selectedRows.has(index)
                      ? "#1f3a5f"
                      : "transparent",
                  }}
                >
                  {canDelete && (
                    <td style={{ padding: "8px" }}>
                      <input
                        type="checkbox"
                        checked={selectedRows.has(index)}
                        onChange={() => toggleRowSelection(index)}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col}
                      style={{
                        padding: "8px",
                        color: "#e6edf3",
                        borderBottom: "1px solid #21262d",
                        maxWidth: "200px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={String(row[col])}
                    >
                      {String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {tableData.totalPages > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: "16px",
              marginTop: "16px",
            }}
          >
            <button
              onClick={() => loadTableData(currentPage - 1)}
              disabled={currentPage === 1}
              style={{
                padding: "6px 12px",
                backgroundColor: currentPage === 1 ? "#333" : "#007acc",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor: currentPage === 1 ? "not-allowed" : "pointer",
              }}
            >
              Previous
            </button>
            <span style={{ color: "#888" }}>
              Page {currentPage} of {tableData.totalPages}
            </span>
            <button
              onClick={() => loadTableData(currentPage + 1)}
              disabled={currentPage === tableData.totalPages}
              style={{
                padding: "6px 12px",
                backgroundColor:
                  currentPage === tableData.totalPages ? "#333" : "#007acc",
                color: "#fff",
                border: "none",
                borderRadius: "4px",
                cursor:
                  currentPage === tableData.totalPages
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderQueryResult = () => {
    if (queryResult.length === 0) return null;

    const firstRow = queryResult[0];
    if (!firstRow) return null;
    const columns = Object.keys(firstRow);

    return (
      <div style={{ marginTop: "24px" }}>
        <h4 style={{ color: "#fff", marginBottom: "12px" }}>
          Query Result ({queryResult.length} rows)
        </h4>
        <div
          style={{
            overflowX: "auto",
            backgroundColor: "#0d1117",
            border: "1px solid #30363d",
            borderRadius: "6px",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "12px",
            }}
          >
            <thead>
              <tr style={{ backgroundColor: "#21262d" }}>
                {columns.map((col) => (
                  <th
                    key={col}
                    style={{
                      padding: "8px",
                      textAlign: "left",
                      color: "#e6edf3",
                      borderBottom: "1px solid #30363d",
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queryResult.map((row, index) => (
                <tr key={index}>
                  {columns.map((col) => (
                    <td
                      key={col}
                      style={{
                        padding: "8px",
                        color: "#e6edf3",
                        borderBottom: "1px solid #21262d",
                        maxWidth: "200px",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={String(row[col])}
                    >
                      {String(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "#1e1e1e",
        color: "#e5e5e5",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          borderBottom: "1px solid #333",
          backgroundColor: "#252526",
        }}
      >
        <h2 style={{ margin: 0 }}>Database Management</h2>
        <button
          onClick={() => router.push("/")}
          style={{
            padding: "8px 16px",
            backgroundColor: "#333",
            color: "#fff",
            border: "1px solid #444",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Exit Database Manager
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: "12px 24px",
            backgroundColor: "#2d1b1b",
            borderBottom: "1px solid #5a1f1f",
            color: "#ff6b6b",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              color: "#ff6b6b",
              fontSize: "18px",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
      )}

      {success && (
        <div
          style={{
            padding: "12px 24px",
            backgroundColor: "#1b2d1b",
            borderBottom: "1px solid #1f5a1f",
            color: "#6bff6b",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{success}</span>
          <button
            onClick={() => setSuccess(null)}
            style={{
              background: "none",
              border: "none",
              color: "#6bff6b",
              fontSize: "18px",
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
      )}

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div
          style={{
            width: "250px",
            backgroundColor: "#252526",
            borderRight: "1px solid #333",
            overflow: "auto",
            padding: "16px",
          }}
        >
          <h3 style={{ color: "#fff", fontSize: "14px", marginBottom: "12px" }}>
            Tables
          </h3>
          {loading && tables.length === 0 ? (
            <div style={{ color: "#888" }}>Loading...</div>
          ) : (
            <div
              style={{ display: "flex", flexDirection: "column", gap: "4px" }}
            >
              {tables.map((table) => (
                <button
                  key={table}
                  onClick={() => setSelectedTable(table)}
                  style={{
                    padding: "8px 12px",
                    backgroundColor:
                      selectedTable === table ? "#094771" : "transparent",
                    color: selectedTable === table ? "#fff" : "#ccc",
                    border: "none",
                    borderRadius: "4px",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: "13px",
                  }}
                >
                  {table}
                </button>
              ))}
            </div>
          )}

          {selectedTable && tableSchema.length > 0 && (
            <div style={{ marginTop: "24px" }}>
              <h4
                style={{
                  color: "#888",
                  fontSize: "12px",
                  marginBottom: "8px",
                }}
              >
                Schema: {selectedTable}
              </h4>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                  fontSize: "11px",
                }}
              >
                {tableSchema.map((col) => (
                  <div
                    key={col.name}
                    style={{
                      padding: "4px 8px",
                      backgroundColor: "#333",
                      borderRadius: "4px",
                    }}
                  >
                    <div style={{ color: "#fff", fontWeight: "bold" }}>
                      {col.name}
                    </div>
                    <div style={{ color: "#888", display: "flex", gap: "8px" }}>
                      <span>{col.type}</span>
                      {col.pk === 1 && (
                        <span style={{ color: "#f59e0b" }}>PK</span>
                      )}
                      {col.notnull === 1 && (
                        <span style={{ color: "#3b82f6" }}>NOT NULL</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "24px" }}>
          {selectedTable ? (
            renderTableData()
          ) : (
            <div
              style={{ color: "#888", textAlign: "center", padding: "40px" }}
            >
              Select a table to view its data
            </div>
          )}

          <div
            style={{
              marginTop: "32px",
              paddingTop: "24px",
              borderTop: "1px solid #333",
            }}
          >
            <h3 style={{ color: "#fff", marginBottom: "12px" }}>
              Execute SQL Query
            </h3>
            <p
              style={{ color: "#888", fontSize: "12px", marginBottom: "12px" }}
            >
              Only SELECT queries are allowed for safety
            </p>
            <div style={{ display: "flex", gap: "12px" }}>
              <textarea
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                placeholder="SELECT * FROM repositories LIMIT 10;"
                style={{
                  flex: 1,
                  minHeight: "80px",
                  padding: "12px",
                  backgroundColor: "#0d1117",
                  border: "1px solid #30363d",
                  borderRadius: "6px",
                  color: "#e6edf3",
                  fontFamily: "monospace",
                  fontSize: "13px",
                  resize: "vertical",
                }}
              />
              <button
                onClick={executeQuery}
                disabled={loading || !sqlQuery.trim()}
                style={{
                  padding: "12px 24px",
                  backgroundColor:
                    loading || !sqlQuery.trim() ? "#333" : "#007acc",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  cursor:
                    loading || !sqlQuery.trim() ? "not-allowed" : "pointer",
                  alignSelf: "flex-start",
                }}
              >
                Execute Query
              </button>
            </div>
            {renderQueryResult()}
          </div>
        </div>
      </div>
    </div>
  );
}
