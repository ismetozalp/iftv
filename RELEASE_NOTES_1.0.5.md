## IF TV v1.0.5

- Persistent poster/logo disk cache — the channel grid loads near-instantly on
  repeat visits (was re-downloading every poster each time). Dead logo URLs time
  out faster so they no longer stall the grid.
- Backup: optional "Include cached posters" checkbox; restore brings them back so
  a restored install has a fast grid immediately.
- Wider Settings dialog.
- Security: reject path-traversal filenames when restoring cached posters from a backup.
