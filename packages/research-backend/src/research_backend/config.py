from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file_encoding="utf-8",
        extra="ignore",
    )

    api_host: str = Field(default="0.0.0.0", alias="API_HOST")
    api_port: int = Field(default=8000, alias="API_PORT")
    api_base_url: str = Field(default="http://localhost:8000", alias="API_BASE_URL")
    database_url: str = Field(alias="DATABASE_URL")
    research_vault_path: str = Field(default="", alias="RESEARCH_VAULT_PATH")
    kbs_dir: str = Field(default="", alias="KBS_DIR")
    sources_dir: str = Field(default="", alias="SOURCES_DIR")
    analysis_provider: str = Field(default="codex_app_server", alias="ANALYSIS_PROVIDER")
    codex_app_server_command: str = Field(default="codex", alias="CODEX_APP_SERVER_COMMAND")
    codex_model: str = Field(default="gpt-5.4", alias="CODEX_MODEL")
    codex_turn_timeout_seconds: int = Field(default=600, alias="CODEX_TURN_TIMEOUT_SECONDS")
    ollama_base_url: str = Field(default="http://localhost:11434", alias="OLLAMA_BASE_URL")
    ollama_generation_model: str = Field(
        default="qwen2.5:14b-instruct", alias="OLLAMA_GENERATION_MODEL"
    )
    ollama_embedding_model: str = Field(
        default="nomic-embed-text", alias="OLLAMA_EMBEDDING_MODEL"
    )
    unpaywall_email: str = Field(default="", alias="UNPAYWALL_EMAIL")
    semantic_scholar_api_key: str = Field(default="", alias="SEMANTIC_SCHOLAR_API_KEY")
    openalex_api_key: str = Field(default="", alias="OPENALEX_API_KEY")

    def model_post_init(self, __context) -> None:
        """Derive kbs_dir and sources_dir from research_vault_path if not explicitly set."""
        if not self.kbs_dir and self.research_vault_path:
            self.kbs_dir = str(Path(self.research_vault_path) / "kbs")
        if not self.sources_dir and self.research_vault_path:
            self.sources_dir = str(Path(self.research_vault_path) / "sources")

    @classmethod
    def from_overrides(cls, overrides: dict[str, str] | None = None) -> "Settings":
        if not overrides:
            return cls()
        return cls.model_validate(overrides)


def get_settings() -> Settings:
    """Return a cached ``Settings`` instance (reads env / .env on first call)."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


_settings: Settings | None = None
