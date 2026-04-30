"""Wiki health checks: provenance, orphans, contradictions."""

from __future__ import annotations

import re
from pathlib import Path

from research_backend.models import KBConfig, LintIssue


def lint_kb(
    kb_root: Path,
    config: KBConfig,
    *,
    check_provenance: bool = True,
    check_orphans: bool = True,
    check_links: bool = True,
) -> list[LintIssue]:
    """Run lint checks on a knowledge base wiki."""
    wiki_dir = kb_root / "wiki"
    raw_dir = kb_root / "raw"
    issues: list[LintIssue] = []

    if not wiki_dir.exists():
        issues.append(LintIssue("error", "_", "No wiki/ directory found. Run compile first."))
        return issues

    articles = _collect_articles(wiki_dir)
    raw_files = _collect_known_source_files(kb_root, raw_dir, config)
    all_slugs = {a.stem for subdir, a in articles}

    for subdir, article_path in articles:
        content = article_path.read_text()
        slug = f"{subdir}/{article_path.stem}"

        if check_provenance:
            issues.extend(_check_provenance(slug, content, raw_files))

        if check_links:
            issues.extend(_check_wikilinks(slug, content, all_slugs))

        issues.extend(_check_frontmatter(slug, content, config))

    if check_orphans:
        issues.extend(_check_orphans(articles))

    return issues


def _collect_known_source_files(kb_root: Path, raw_dir: Path, config: KBConfig) -> set[str]:
    """Collect source filenames from local raw/ and matching external pools."""
    known = {f.name for f in raw_dir.iterdir() if f.is_file()} if raw_dir.exists() else set()
    repo_root = kb_root.parent.parent if kb_root.parent.name == "kbs" else kb_root.parent

    for ext in config.external_sources:
        if not isinstance(ext, dict):
            continue
        ext_path = ext.get("path")
        if not ext_path:
            continue
        ext_dir = (repo_root / ext_path).resolve()
        if not ext_dir.exists():
            continue
        filter_rules = ext.get("filter", {})
        for source_file in ext_dir.glob("*.md"):
            text = source_file.read_text(encoding="utf-8")
            frontmatter = _parse_frontmatter(text)
            if filter_rules and not _matches_filter(frontmatter, filter_rules):
                continue
            known.add(source_file.name)

    return known


def _collect_articles(wiki_dir: Path) -> list[tuple[str, Path]]:
    """Collect all article files from wiki subdirectories."""
    articles = []
    for subdir in ["concepts", "protocols", "entities"]:
        d = wiki_dir / subdir
        if not d.exists():
            continue
        for f in sorted(d.glob("*.md")):
            articles.append((subdir, f))
    return articles


def _check_provenance(slug: str, content: str, raw_files: set[str]) -> list[LintIssue]:
    """Check that articles cite sources and cited sources exist."""
    issues = []

    # Find all [source: X] citations
    citations = re.findall(r"\[source:\s*([^\]]+)\]", content)

    if not citations:
        issues.append(LintIssue(
            "error",
            slug,
            "No [source: filename] citations found. Every factual claim must cite its source.",
            "Add [source: filename] citations to factual claims.",
        ))
        return issues

    # Check each citation references a real source
    for cite in citations:
        cite = cite.strip()
        if cite not in raw_files:
            issues.append(LintIssue(
                "warning",
                slug,
                f"Citation references '{cite}' but no such file is available to this KB.",
                f"Check if '{cite}' exists in raw/ or configured external_sources, or fix the citation.",
            ))

    # Check frontmatter sources list
    fm_sources = re.findall(r"^sources:\s*\[([^\]]*)\]", content, re.MULTILINE)
    if fm_sources:
        listed = [s.strip() for s in fm_sources[0].split(",")]
        for src in listed:
            if src and src not in raw_files:
                issues.append(LintIssue(
                    "warning",
                    slug,
                    f"Frontmatter lists source '{src}' but no such file is available to this KB.",
                ))

    return issues


def _parse_frontmatter(text: str) -> dict:
    """Extract YAML frontmatter from a markdown file. Returns {} if none."""
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}
    try:
        import yaml

        data = yaml.safe_load(text[4:end])
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _matches_filter(frontmatter: dict, rules: dict) -> bool:
    """Substring-match every rule against the corresponding frontmatter value."""
    for key, expected in rules.items():
        value = frontmatter.get(key)
        if value is None:
            return False
        if not isinstance(value, str):
            value = str(value)
        if not isinstance(expected, str):
            expected = str(expected)
        if expected.lower() not in value.lower():
            return False
    return True


def _check_wikilinks(slug: str, content: str, all_slugs: set[str]) -> list[LintIssue]:
    """Check that [[wikilinks]] reference existing articles."""
    issues = []
    links = re.findall(r"\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]", content)

    for link in links:
        # Normalize: could be "concepts/cold-exposure" or just "cold-exposure"
        link_slug = link.split("/")[-1] if "/" in link else link
        if link_slug not in all_slugs and link not in {f"{d}/{s}" for s in all_slugs for d in ["concepts", "protocols", "entities"]}:
            issues.append(LintIssue(
                "info",
                slug,
                f"Wikilink [[{link}]] references a non-existent article.",
                "Create the linked article or fix the link.",
            ))

    return issues


def _check_frontmatter(slug: str, content: str, config: KBConfig) -> list[LintIssue]:
    """Check YAML frontmatter is present and valid."""
    issues = []

    if not content.startswith("---"):
        issues.append(LintIssue(
            "error",
            slug,
            "Missing YAML frontmatter (must start with ---).",
            "Add frontmatter with title, type, category, sources, last_compiled.",
        ))
        return issues

    required_fields = ["title", "type", "sources", "last_compiled"]
    for field in required_fields:
        if f"{field}:" not in content.split("---")[1]:
            issues.append(LintIssue(
                "warning",
                slug,
                f"Missing frontmatter field: {field}",
            ))

    return issues


def _check_orphans(articles: list[tuple[str, Path]]) -> list[LintIssue]:
    """Find articles that are never linked to from other articles."""
    issues = []
    all_content = ""
    slugs_by_path = {}

    for subdir, path in articles:
        content = path.read_text()
        all_content += content
        slugs_by_path[path] = f"{subdir}/{path.stem}"

    for subdir, path in articles:
        slug = path.stem
        full_slug = f"{subdir}/{slug}"
        # Check if this article is linked from anywhere
        if f"[[{slug}" not in all_content and f"[[{full_slug}" not in all_content:
            # Check it's not just the only article
            if len(articles) > 1:
                issues.append(LintIssue(
                    "info",
                    full_slug,
                    "Orphaned article: no other article links to this one.",
                    "Add [[wikilinks]] from related articles.",
                ))

    return issues
