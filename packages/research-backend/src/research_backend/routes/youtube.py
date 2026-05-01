"""YouTube source API routes.

Exposes import status, source browsing, and enrichment to the web UI.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel

router = APIRouter(prefix="/api/youtube", tags=["youtube"])


def _get_sources_root(request: Request) -> Path:
    """Resolve sources/youtube dir from app settings."""
    return Path(request.app.state.settings.sources_dir) / "youtube"


class YouTubeStatus(BaseModel):
    total_videos: int
    total_watch_events: int
    music_videos: int
    enriched_videos: int
    first_watch: str | None = None
    last_watch: str | None = None
    imports: list[dict[str, Any]]


class YouTubeVideo(BaseModel):
    video_id: str
    title: str
    channel: str
    url: str
    watch_count: int
    first_watched_at: str
    last_watched_at: str
    is_music: bool
    transcript_status: str
    enrichment_status: str


class YouTubeVideoDetail(YouTubeVideo):
    watch_timestamps: list[str]
    takeout_imports: list[str]
    body: str  # full markdown body (after the frontmatter)


class YouTubeImportResult(BaseModel):
    import_id: str
    events_parsed: int
    videos_created: int
    videos_updated: int
    music_entries: int
    errors: list[str]
    skipped_reason: str = ""


class EnrichRequest(BaseModel):
    video_id: str


class EnrichResult(BaseModel):
    video_id: str
    status: str
    reason: str = ""
    transcript_chars: int = 0


@router.get("/status", response_model=YouTubeStatus)
def youtube_status(request: Request) -> YouTubeStatus:
    """Summary of imported YouTube content and import history.

    Uses a cached stats file when available (written after each import).
    Falls back to a fast file count if the cache is missing, avoiding
    the full 60K-file scan on every page load.
    """
    import json as _json

    from research_backend.youtube.manifest import iter_events, manifest_path

    sources_root = _get_sources_root(request)
    cache_path = sources_root / "stats_cache.json"
    stats_data: dict[str, Any] = {}

    if cache_path.exists():
        try:
            stats_data = _json.loads(cache_path.read_text())
        except Exception:
            pass

    if not stats_data:
        # Fast fallback: just count files, don't parse frontmatter
        raw_dir = sources_root / "raw"
        total = sum(1 for _ in raw_dir.glob("*.md")) if raw_dir.exists() else 0
        stats_data = {
            "total_videos": total,
            "total_watch_events": 0,
            "music_videos": 0,
            "enriched_videos": 0,
            "first_watch": None,
            "last_watch": None,
        }

    imports: list[dict[str, Any]] = []
    if sources_root.exists():
        manifest = manifest_path(sources_root)
        by_id: dict[str, dict[str, Any]] = {}
        for event in iter_events(manifest):
            kind = event.get("kind")
            if kind == "import_started":
                iid = event.get("import_id", "")
                by_id[iid] = {
                    "import_id": iid,
                    "source": event.get("source", ""),
                    "started_at": event.get("started_at", ""),
                    "finished_at": None,
                    "events": 0,
                    "videos": 0,
                }
            elif kind == "import_finished":
                iid = event.get("import_id", "")
                if iid in by_id:
                    by_id[iid]["finished_at"] = event.get("finished_at")
                    by_id[iid]["events"] = event.get("events", 0)
                    by_id[iid]["videos"] = event.get("videos", 0)
        imports = list(by_id.values())
        imports.sort(key=lambda r: r.get("started_at", ""), reverse=True)

    return YouTubeStatus(
        total_videos=stats_data.get("total_videos", 0),
        total_watch_events=stats_data.get("total_watch_events", 0),
        music_videos=stats_data.get("music_videos", 0),
        enriched_videos=stats_data.get("enriched_videos", 0),
        first_watch=stats_data.get("first_watch") or None,
        last_watch=stats_data.get("last_watch") or None,
        imports=imports,
    )


@router.post("/stats/refresh")
def refresh_stats(request: Request) -> dict[str, str]:
    """Rebuild the stats cache by scanning all source notes. Slow (~50s for 60K files)."""
    import json as _json

    from research_backend.youtube.stats import compute_stats

    sources_root = _get_sources_root(request)
    stats = compute_stats(sources_root)
    cache = {
        "total_videos": stats.total_videos,
        "total_watch_events": stats.total_watch_events,
        "music_videos": stats.music_videos,
        "enriched_videos": stats.enriched_videos,
        "first_watch": stats.first_watch,
        "last_watch": stats.last_watch,
        "top_channels": stats.top_channels,
        "most_rewatched": stats.most_rewatched,
    }
    cache_path = sources_root / "stats_cache.json"
    cache_path.write_text(_json.dumps(cache), encoding="utf-8")
    return {"status": "ok", "total_videos": str(stats.total_videos)}


@router.get("/videos", response_model=list[YouTubeVideo])
def list_videos(
    request: Request,
    channel: str | None = None,
    limit: int = 50,
    offset: int = 0,
    enriched_only: bool = False,
) -> list[YouTubeVideo]:
    """Paginated list of imported videos with optional filtering."""
    from research_backend.youtube.stats import read_frontmatter

    sources_root = _get_sources_root(request)
    raw_dir = sources_root / "raw"
    if not raw_dir.exists():
        return []

    # Reverse sort by mtime to get most recently modified first
    paths = sorted(raw_dir.glob("*.md"), key=lambda p: p.stat().st_mtime, reverse=True)

    matches: list[YouTubeVideo] = []
    skipped = 0
    scan_budget = max(500, (offset + limit) * 10) if (channel or enriched_only) else offset + limit
    scanned = 0

    for note_path in paths:
        if scanned >= scan_budget and len(matches) >= offset + limit:
            break
        scanned += 1
        fm = read_frontmatter(note_path)
        if fm.get("source_type") != "youtube_video":
            continue
        if channel and channel.lower() not in str(fm.get("channel", "")).lower():
            continue
        if enriched_only and fm.get("enrichment_status") in (None, "metadata_only"):
            continue
        matches.append(_video_from_frontmatter(fm))

    return matches[offset : offset + limit]


@router.get("/videos/{video_id}", response_model=YouTubeVideoDetail)
def get_video(request: Request, video_id: str) -> YouTubeVideoDetail:
    """Full video source note including enrichment body."""
    from research_backend.youtube.models import is_valid_video_id
    from research_backend.youtube.notes import video_note_path
    from research_backend.youtube.stats import read_frontmatter

    sources_root = _get_sources_root(request)
    if not is_valid_video_id(video_id):
        raise HTTPException(400, "Invalid video_id")

    note_path = video_note_path(sources_root / "raw", video_id)
    if not note_path.exists():
        raise HTTPException(404, f"Video {video_id} not imported")

    fm = read_frontmatter(note_path)
    text = note_path.read_text(encoding="utf-8")
    body = text.split("---\n", 2)[-1] if text.count("---\n") >= 2 else text

    base = _video_from_frontmatter(fm)
    return YouTubeVideoDetail(
        **base.model_dump(),
        watch_timestamps=list(fm.get("watch_timestamps") or []),
        takeout_imports=list(fm.get("takeout_imports") or []),
        body=body,
    )


@router.post("/import", response_model=YouTubeImportResult)
async def import_takeout_endpoint(
    request: Request,
    file: UploadFile = File(...),
    dry_run: bool = Query(False),
    filter_channel: list[str] | None = Query(None),
    exclude_channel: list[str] | None = Query(None),
    no_music: bool = Query(False),
    no_copy: bool = Query(False),
) -> YouTubeImportResult:
    """Upload a Takeout watch-history file and import it."""
    import tempfile

    from research_backend.youtube.importer import import_takeout

    sources_root = _get_sources_root(request)
    if not file.filename:
        raise HTTPException(400, "Missing filename")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in (".json", ".html", ".htm"):
        raise HTTPException(400, f"Unsupported Takeout format: {suffix}")

    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        report = import_takeout(
            tmp_path,
            sources_root,
            dry_run=dry_run,
            filter_channels=filter_channel or None,
            exclude_channels=exclude_channel or None,
            include_music=not no_music,
            copy_takeout=not no_copy,
        )
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass

    # Invalidate stats cache so next status call rebuilds
    cache_path = sources_root / "stats_cache.json"
    if cache_path.exists() and not dry_run:
        cache_path.unlink(missing_ok=True)

    return YouTubeImportResult(
        import_id=report.import_id,
        events_parsed=report.events_parsed,
        videos_created=report.videos_created,
        videos_updated=report.videos_updated,
        music_entries=report.music_entries,
        errors=report.errors[:10],
        skipped_reason=report.skipped_reason,
    )


@router.post("/enrich", response_model=EnrichResult)
def enrich_video_endpoint(request: Request, req: EnrichRequest) -> EnrichResult:
    """Fetch transcript/metadata for a single video via yt-dlp."""
    from research_backend.youtube.enrichment import enrich_video

    sources_root = _get_sources_root(request)
    result = enrich_video(req.video_id, sources_root)
    return EnrichResult(
        video_id=req.video_id,
        status=result.get("status", "unknown"),
        reason=result.get("reason", ""),
        transcript_chars=result.get("transcript_chars", 0),
    )


# --- internals ------------------------------------------------------------

def _video_from_frontmatter(fm: dict) -> YouTubeVideo:
    return YouTubeVideo(
        video_id=str(fm.get("video_id", "")),
        title=str(fm.get("title", "")),
        channel=str(fm.get("channel", "")),
        url=str(fm.get("url", "")),
        watch_count=int(fm.get("watch_count", 0) or 0),
        first_watched_at=str(fm.get("first_watched_at", "")),
        last_watched_at=str(fm.get("last_watched_at", "")),
        is_music=bool(fm.get("is_music", False)),
        transcript_status=str(fm.get("transcript_status", "missing")),
        enrichment_status=str(fm.get("enrichment_status", "metadata_only")),
    )
