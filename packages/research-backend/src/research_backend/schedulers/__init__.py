"""Scheduled jobs for the research buddy.

Modules:
- ``standing_interests``: periodic query of OpenAlex/S2 for active
  ``standing_interest`` rows; writes to ``findings_inbox``.
- ``thread_synergy``: nightly thread-memory maintenance and cross-thread
  link extraction (topic / citation overlaps).
- ``cli``: entry points for manual + systemd-driven runs.

Cold-thread updates are NOT computed here; the dashboard computes them
on the fly from ``thread_memory`` × ``findings_inbox`` (see design §5).
"""
