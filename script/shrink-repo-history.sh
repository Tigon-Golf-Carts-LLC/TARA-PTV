#!/usr/bin/env bash
#
# shrink-repo-history.sh — ONE-TIME maintenance. Purges the uncompressed
# image originals from git history.
#
# Why this is needed: `npm run compress:sources` took assets-src/images from
# 1,256 MB to 304 MB, but git keeps every old blob forever. A full clone is
# 1.38 GB (old originals + new masters) until the originals are removed from
# history, which cannot be done without rewriting commits.
#
#   before : 1.38 GB   after : ~399 MB
#
# THIS REWRITES HISTORY. Every commit SHA changes and the result must be
# force-pushed. Anyone with an existing clone has to re-clone (or
# `git fetch && git reset --hard origin/<branch>`). Read all of this before
# running it.
#
# IMPORTANT — run this only AFTER the static-site branch has landed on the
# default branch. Roughly 1,068 MB of the strippable blobs are the default
# branch's *current* image files. If you rewrite while the default branch
# still points at the old Replit app, that branch is left with empty image
# directories.
#
# Usage:
#   bash script/shrink-repo-history.sh            # dry run: report only
#   bash script/shrink-repo-history.sh --apply    # rewrite local history
#
# Then, after checking the result:
#   git push --force origin main
#
# GitHub does not reclaim the space immediately — unreachable objects sit in
# the remote until its GC runs. Ask GitHub Support to run `git gc` on the
# repository if the reported size does not drop.
set -euo pipefail

cd "$(dirname "$0")/.."

command -v git-filter-repo >/dev/null 2>&1 || {
  echo "git-filter-repo is required:  pip install git-filter-repo" >&2
  exit 1
}

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

KEEP=$(mktemp) ALL=$(mktemp) STRIP=$(mktemp)
trap 'rm -f "$KEEP" "$ALL" "$STRIP"' EXIT

# Blobs reachable from every branch tip — these must survive.
for ref in $(git for-each-ref --format='%(refname)' refs/heads refs/remotes); do
  git ls-tree -r "$ref" --format='%(objectname)'
done | sort -u > "$KEEP"

# Every image blob that has ever existed, at either path the images lived at.
git rev-list --objects --all \
  | grep -E '(^|[[:space:]])(assets-src|artifacts/tara-ev/public)/images/' \
  | awk '{print $1}' | sort -u > "$ALL"

comm -23 "$ALL" "$KEEP" > "$STRIP"

BYTES=$(git cat-file --batch-check='%(objectsize:disk)' < "$STRIP" | awk '{n+=$1} END{print n+0}')
printf 'image blobs in history : %s\n' "$(wc -l < "$ALL")"
printf 'reachable from a tip   : %s (kept)\n' "$(comm -12 "$ALL" "$KEEP" | wc -l)"
printf 'to strip               : %s  (%.0f MB on disk)\n' "$(wc -l < "$STRIP")" "$(echo "$BYTES/1048576" | bc -l)"
git count-objects -vH | grep size-pack

if [ "$APPLY" -ne 1 ]; then
  echo
  echo "Dry run. Re-run with --apply to rewrite history."
  exit 0
fi

echo
echo "Rewriting history — this changes every commit SHA."
cp "$STRIP" .git-strip-ids
git filter-repo --force --strip-blobs-with-ids .git-strip-ids
rm -f .git-strip-ids

echo
git count-objects -vH | grep size-pack
cat <<'MSG'

Done. git-filter-repo removed the "origin" remote on purpose, as a guard.
Check the result, then:

  git remote add origin https://github.com/Tigon-Golf-Carts-LLC/TARA-PTV.git
  git push --force origin main

MSG
