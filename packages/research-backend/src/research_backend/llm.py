"""LLM provider abstraction for knowledge base operations.

Supports provider types:
- claude: Uses the Claude Code CLI in print mode
- codex_app_server: Uses Codex CLI in app-server mode (JSON-RPC over stdio)
- codex_exec: Uses Codex CLI in non-interactive exec mode
- openai: Uses the OpenAI Responses API directly
- ollama: Uses a local Ollama instance via HTTP
"""

from __future__ import annotations

import json
import selectors
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Protocol

import httpx


class LLMProvider(Protocol):
    """Protocol for LLM providers."""

    def generate(self, prompt: str, *, system: str = "") -> str: ...


class ClaudeCodeProvider:
    """Claude Code CLI provider using -p (print) mode."""

    def __init__(
        self,
        command: str = "claude",
        model: str = "claude-sonnet-4-6",
        timeout: int = 300,
    ):
        self.command = command
        self.model = model
        self.timeout = timeout

    def generate(self, prompt: str, *, system: str = "") -> str:
        cmd = [
            self.command, "-p", prompt,
            "--model", self.model,
            "--output-format", "text",
            "--bare",
        ]
        if system:
            cmd.extend(["--append-system-prompt", system])

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=self.timeout,
        )
        if result.returncode != 0:
            raise RuntimeError(f"Claude Code failed (exit {result.returncode}): {result.stderr.strip()}")
        return result.stdout.strip()


class CodexAppServerProvider:
    """Codex CLI in app-server mode (JSON-RPC v2 over stdio).

    Uses the Codex app-server protocol to run prompts through the user's
    Codex/ChatGPT subscription. The model defaults to whatever Codex provides
    (e.g. gpt-5.4); pass model=None or "" to use the default.
    """

    def __init__(
        self,
        command: str = "codex",
        model: str = "",
        timeout: int = 600,
    ):
        self.command = command
        self.model = model
        self.timeout = timeout

    def generate(self, prompt: str, *, system: str = "") -> str:
        full_prompt = f"{system}\n\n{prompt}" if system else prompt

        process = subprocess.Popen(
            [self.command, "app-server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            cwd="/tmp",  # avoid loading project instructions
        )
        assert process.stdin is not None
        assert process.stdout is not None
        assert process.stderr is not None

        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ, data="stdout")
        selector.register(process.stderr, selectors.EVENT_READ, data="stderr")

        def send(message: dict) -> None:
            process.stdin.write(f"{json.dumps(message)}\n")  # type: ignore[union-attr]
            process.stdin.flush()  # type: ignore[union-attr]

        collected: list[str] = []
        thread_id: str | None = None
        started_turn = False
        deadline = time.monotonic() + self.timeout

        # v2 protocol: initialize, then thread/start with sandbox + approval
        send({
            "jsonrpc": "2.0", "method": "initialize", "id": 0,
            "params": {"clientInfo": {"name": "research_kb", "title": "Research KB", "version": "0.1.0"}},
        })

        try:
            while time.monotonic() < deadline:
                events = selector.select(timeout=1.0)
                if not events:
                    if process.poll() is not None:
                        break
                    continue
                for key, _ in events:
                    line = key.fileobj.readline()  # type: ignore[union-attr]
                    if not line:
                        continue
                    if key.data == "stderr":
                        continue
                    message = json.loads(line)
                    method = message.get("method", "")

                    # After initialize response, start a thread
                    if message.get("id") == 0 and "result" in message:
                        thread_params: dict = {
                            "approvalPolicy": "never",
                            "sandbox": "read-only",
                            "ephemeral": True,
                        }
                        if self.model:
                            thread_params["model"] = self.model
                        send({
                            "jsonrpc": "2.0", "method": "thread/start", "id": 1,
                            "params": thread_params,
                        })

                    # After thread/started notification, start turn
                    elif method == "thread/started":
                        thread_id = message.get("params", {}).get("thread", {}).get("id")
                        if thread_id and not started_turn:
                            send({
                                "jsonrpc": "2.0", "method": "turn/start", "id": 2,
                                "params": {
                                    "threadId": thread_id,
                                    "input": [{"type": "text", "text": full_prompt}],
                                },
                            })
                            started_turn = True
                            deadline = time.monotonic() + self.timeout

                    # Collect streaming text deltas
                    elif method == "item/agentMessage/delta":
                        delta = message.get("params", {}).get("delta", "")
                        if delta:
                            collected.append(str(delta))

                    # On item/completed for agentMessage, capture final text
                    elif method == "item/completed":
                        item = message.get("params", {}).get("item", {})
                        if item.get("type") == "agentMessage" and item.get("text"):
                            collected = [str(item["text"])]

                    # Turn completed — return result or raise
                    elif method == "turn/completed":
                        turn = message.get("params", {}).get("turn", {})
                        status = turn.get("status")
                        if status == "completed":
                            result = "".join(collected).strip()
                            if result:
                                return result
                        error = turn.get("error", {})
                        err_msg = error.get("message", "") if isinstance(error, dict) else str(error)
                        raise RuntimeError(f"Codex turn ended with status {status}: {err_msg[:300]}")

                    # Fallback: thread goes idle after turn started = implicit completion
                    elif method == "thread/status/changed" and started_turn:
                        status_type = message.get("params", {}).get("status", {}).get("type")
                        if status_type == "idle":
                            result = "".join(collected).strip()
                            if result:
                                return result

                    # Handle request-level errors (e.g. bad thread/start params)
                    elif "error" in message and message.get("id") is not None:
                        raise RuntimeError(message["error"].get("message", "Codex error"))

                    # Ignore other notifications (commandExecution, reasoning, etc.)

            raise RuntimeError("Timed out waiting for Codex app-server")
        finally:
            selector.close()
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()


class CodexExecProvider:
    """Codex CLI provider using `codex exec` with output capture."""

    def __init__(
        self,
        command: str = "codex",
        model: str = "o4-mini",
        timeout: int = 300,
        max_retries: int = 3,
    ):
        self.command = command
        self.model = model
        self.timeout = timeout
        self.max_retries = max_retries

    def generate(self, prompt: str, *, system: str = "") -> str:
        full_prompt = f"{system}\n\n{prompt}" if system else prompt
        with tempfile.NamedTemporaryFile(prefix="research-codex-", suffix=".txt") as output_file:
            cmd = [
                self.command,
                "exec",
                full_prompt,
                "--model",
                self.model,
                "--output-last-message",
                output_file.name,
                "--sandbox",
                "read-only",
            ]
            for attempt in range(self.max_retries):
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=self.timeout,
                )
                if result.returncode == 0:
                    return Path(output_file.name).read_text(encoding="utf-8").strip()

                stderr = result.stderr.strip()
                if attempt < self.max_retries - 1 and _is_transient_codex_exec_error(stderr):
                    time.sleep(2 ** attempt)
                    continue
                raise RuntimeError(f"Codex exec failed (exit {result.returncode}): {stderr}")

            raise RuntimeError("Codex exec failed without producing output")


class OpenAIProvider:
    """OpenAI API provider (works with any OpenAI-compatible endpoint)."""

    def __init__(
        self,
        model: str = "o4-mini",
        max_tokens: int = 16384,
        timeout: int = 300,
    ):
        import os
        self.model = model
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.api_key = os.environ.get("OPENAI_API_KEY", "")

    def generate(self, prompt: str, *, system: str = "") -> str:
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        resp = httpx.post(
            "https://api.openai.com/v1/responses",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.model,
                "instructions": system or None,
                "input": prompt,
                "max_output_tokens": self.max_tokens,
            },
            timeout=self.timeout,
        )
        if not resp.is_success:
            raise RuntimeError(f"OpenAI API error ({resp.status_code}): {resp.text[:500]}")
        data = resp.json()
        # Extract text from the response output items
        for item in data.get("output", []):
            if item.get("type") == "message":
                for content in item.get("content", []):
                    if content.get("type") == "output_text":
                        return content["text"]
        raise RuntimeError(f"No text in OpenAI response: {str(data)[:500]}")


def _is_transient_codex_exec_error(stderr: str) -> bool:
    """Return True for retryable Codex transport failures."""
    transient_markers = (
        "stream disconnected before completion",
        "failed to connect to websocket",
        "record overflow",
        "record layer failure",
        "invalidcontenttype",
        "transport channel closed",
    )
    lowered = stderr.lower()
    return any(marker in lowered for marker in transient_markers)


class OllamaProvider:
    """Local Ollama LLM provider."""

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        model: str = "qwen2.5:14b-instruct",
        timeout: int = 300,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout

    def generate(self, prompt: str, *, system: str = "") -> str:
        payload: dict = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
        }
        if system:
            payload["system"] = system
        resp = httpx.post(
            f"{self.base_url}/api/generate",
            json=payload,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return resp.json()["response"]


def get_provider(config: dict[str, str]) -> LLMProvider:
    """Create an LLM provider from kb.yaml provider config.

    Supported provider types:
    - claude: Claude Code CLI in print mode (default)
    - codex_app_server: Codex CLI in app-server mode
    - codex_exec: Codex CLI in non-interactive exec mode
    - ollama: Local Ollama HTTP API
    """
    provider_type = config.get("default", "claude")
    model = config.get("model", "")

    if provider_type == "claude":
        return ClaudeCodeProvider(
            command=config.get("command", "claude"),
            model=model or "claude-sonnet-4-6",
        )
    elif provider_type == "openai":
        return OpenAIProvider(model=model or "o4-mini")
    elif provider_type == "codex_app_server":
        return CodexAppServerProvider(
            command=config.get("command", "codex"),
            model=model or "",  # empty = use codex default (e.g. gpt-5.4)
        )
    elif provider_type == "codex_exec":
        return CodexExecProvider(
            command=config.get("command", "codex"),
            model=model or "o4-mini",
        )
    elif provider_type == "ollama":
        return OllamaProvider(
            base_url=config.get("base_url", "http://localhost:11434"),
            model=model or "qwen2.5:14b-instruct",
        )
    else:
        raise ValueError(f"Unknown provider: {provider_type}")
