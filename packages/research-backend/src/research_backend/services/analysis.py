import json
import selectors
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import fitz
import httpx
from pydantic import BaseModel


class AnalysisResult(BaseModel):
    model: str
    summary_md: str
    extraction_json: dict[str, str]


class AnalysisGateway:
    def summarize(
        self, text: str, *, model: str, provider: str, settings: dict[str, str] | None = None
    ) -> AnalysisResult:
        raise NotImplementedError

    def extract_table(
        self, text: str, *, model: str, provider: str, settings: dict[str, str] | None = None
    ) -> dict[str, str]:
        raise NotImplementedError


@dataclass
class OllamaAnalysisGateway(AnalysisGateway):
    base_url: str

    def summarize(
        self, text: str, *, model: str, provider: str, settings: dict[str, str] | None = None
    ) -> AnalysisResult:
        summary_prompt = (
            "Summarize the following academic paper text in markdown with these sections: "
            "Research Question, Methods, Sample, Findings, Limitations.\n\n"
            f"{text[:12000]}"
        )
        summary = self._generate(model=model, prompt=summary_prompt)
        extraction = self.extract_table(text, model=model, provider=provider, settings=settings)
        return AnalysisResult(model=model, summary_md=summary, extraction_json=extraction)

    def extract_table(
        self, text: str, *, model: str, provider: str, settings: dict[str, str] | None = None
    ) -> dict[str, str]:
        prompt = (
            "Return JSON only with keys research_question, methods, sample, findings, limitations "
            "for this academic paper text.\n\n"
            f"{text[:12000]}"
        )
        content = self._generate(model=model, prompt=prompt)
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:  # pragma: no cover - runtime fallback
            return {
                "research_question": "",
                "methods": "",
                "sample": "",
                "findings": content.strip(),
                "limitations": "",
            }
        return {key: str(parsed.get(key, "")) for key in parsed}

    def _generate(self, *, model: str, prompt: str) -> str:
        response = httpx.post(
            f"{self.base_url}/api/generate",
            json={"model": model, "prompt": prompt, "stream": False},
            timeout=120,
        )
        response.raise_for_status()
        payload = response.json()
        return str(payload.get("response", "")).strip()


@dataclass
class CodexAppServerGateway(AnalysisGateway):
    command: str = "codex"
    startup_timeout_seconds: float = 10.0
    turn_timeout_seconds: float = 180.0
    prompt_text_limit: int = 12000

    def summarize(
        self, text: str, *, model: str, provider: str, settings: dict[str, str] | None = None
    ) -> AnalysisResult:
        extraction = self.extract_table(text, model=model, provider=provider, settings=settings)
        summary = self._format_summary_markdown(extraction)
        return AnalysisResult(model=model, summary_md=summary, extraction_json=extraction)

    def extract_table(
        self, text: str, *, model: str, provider: str, settings: dict[str, str] | None = None
    ) -> dict[str, str]:
        prompt = (
            "You are analyzing academic paper text for a local research toolkit.\n"
            "Do not run shell commands, modify files, or use tools. Work only from the provided text.\n"
            "Return JSON only with keys research_question, methods, sample, findings, limitations. "
            "Each value must be a string. Use empty strings when the text does not support a field.\n\n"
            f"{text[:self.prompt_text_limit]}"
        )
        content = self._run_turn(prompt=prompt, model=model, settings=settings)
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError:  # pragma: no cover - runtime fallback
            return {
                "research_question": "",
                "methods": "",
                "sample": "",
                "findings": content.strip(),
                "limitations": "",
            }
        return {
            key: str(parsed.get(key, ""))
            for key in ("research_question", "methods", "sample", "findings", "limitations")
        }

    def _run_turn(self, *, prompt: str, model: str, settings: dict[str, str] | None = None) -> str:
        runtime = settings or {}
        command = runtime.get("codex_app_server_command", self.command)
        effective_model = runtime.get("codex_model", model)
        timeout_seconds = float(runtime.get("codex_turn_timeout_seconds", self.turn_timeout_seconds))
        process = subprocess.Popen(
            [command, "app-server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        assert process.stdin is not None
        assert process.stdout is not None
        assert process.stderr is not None

        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ, data="stdout")
        selector.register(process.stderr, selectors.EVENT_READ, data="stderr")
        stderr_lines: list[str] = []

        def send(message: dict) -> None:
            process.stdin.write(f"{json.dumps(message)}\n")
            process.stdin.flush()

        thread_id: str | None = None
        collected: list[str] = []
        started_turn = False
        deadline = time.monotonic() + timeout_seconds

        send(
            {
                "method": "initialize",
                "id": 0,
                "params": {
                    "clientInfo": {
                        "name": "research_toolkit",
                        "title": "Research Toolkit",
                        "version": "0.1.0",
                    }
                },
            }
        )
        send({"method": "initialized", "params": {}})
        send({"method": "thread/start", "id": 1, "params": {"model": effective_model}})

        try:
            while time.monotonic() < deadline:
                events = selector.select(timeout=1.0)
                if not events:
                    if process.poll() is not None:
                        break
                    continue
                for key, _ in events:
                    line = key.fileobj.readline()
                    if not line:
                        continue
                    if key.data == "stderr":
                        stderr_lines.append(line.strip())
                        continue
                    message = json.loads(line)
                    if message.get("id") == 1:
                        thread_id = message.get("result", {}).get("thread", {}).get("id")
                        if thread_id and not started_turn:
                            send(
                                {
                                    "method": "turn/start",
                                    "id": 2,
                                    "params": {
                                        "threadId": thread_id,
                                        "input": [{"type": "text", "text": prompt}],
                                    },
                                }
                            )
                            started_turn = True
                            deadline = time.monotonic() + timeout_seconds
                    elif message.get("id") == 2 and message.get("error"):
                        raise RuntimeError(message["error"].get("message", "Codex turn failed"))
                    elif message.get("method") == "item/agentMessage/delta":
                        delta = message.get("params", {}).get("delta", "")
                        if delta:
                            collected.append(str(delta))
                    elif message.get("method") == "item/completed":
                        item = message.get("params", {}).get("item", {})
                        if item.get("type") == "agentMessage" and item.get("text"):
                            collected = [str(item.get("text"))]
                    elif message.get("method") == "turn/completed":
                        status = message.get("params", {}).get("turn", {}).get("status")
                        if status == "completed":
                            result = "".join(collected).strip()
                            if result:
                                return result
                        raise RuntimeError(f"Codex turn ended with status {status}")
                    elif message.get("error"):
                        raise RuntimeError(message["error"].get("message", "Codex app-server error"))
            raise RuntimeError("Timed out waiting for Codex app-server turn to complete")
        finally:
            selector.close()
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:  # pragma: no cover - cleanup fallback
                    process.kill()
            if stderr_lines:
                stderr_text = "\n".join(stderr_lines).strip()
                if stderr_text:
                    # Keep stderr attached to runtime failures for debugging.
                    collected.append(f"\n{stderr_text}")

    def _format_summary_markdown(self, extraction: dict[str, str]) -> str:
        sections = [
            ("Research Question", extraction.get("research_question", "")),
            ("Methods", extraction.get("methods", "")),
            ("Sample", extraction.get("sample", "")),
            ("Findings", extraction.get("findings", "")),
            ("Limitations", extraction.get("limitations", "")),
        ]
        return "\n\n".join(f"## {heading}\n\n{body or 'Not reported.'}" for heading, body in sections)


@dataclass
class MultiProviderAnalysisGateway(AnalysisGateway):
    codex_gateway: CodexAppServerGateway | None = None
    ollama_gateway: OllamaAnalysisGateway | None = None

    def summarize(
        self, text: str, *, model: str, provider: str, settings: dict[str, str] | None = None
    ) -> AnalysisResult:
        gateway = self._select(provider)
        return gateway.summarize(text, model=model, provider=provider, settings=settings)

    def extract_table(
        self, text: str, *, model: str, provider: str, settings: dict[str, str] | None = None
    ) -> dict[str, str]:
        gateway = self._select(provider)
        return gateway.extract_table(text, model=model, provider=provider, settings=settings)

    def _select(self, provider: str) -> AnalysisGateway:
        if provider == "codex_app_server" and self.codex_gateway is not None:
            return self.codex_gateway
        if provider == "ollama" and self.ollama_gateway is not None:
            return self.ollama_gateway
        raise RuntimeError(f"Unsupported analysis provider: {provider}")


def extract_pdf_text(path: Path) -> tuple[str, int]:
    document = fitz.open(path)
    try:
        text = "\n".join(page.get_text("text") for page in document)
        return text.strip(), document.page_count
    finally:
        document.close()
