# Shell helpers for the laptop. Load them with: . ~/homepi-infra/scripts/lib.sh

# Commit the given paths, then sign, verify and push a release tag to the Pi.
# Every step can be resumed: an existing commit with the same subject is reused,
# and an existing tag stops the function before anything is pushed.
# Usage: release "<commit subject>" "<commit body>" <tag> "<tag message>" <path>...
release() {
  local subject="$1" body="$2" tag="$3" tagmsg="$4" rc
  shift 4
  [ "$(hostname)" = "DESKTOP-581OMPC" ] || { echo "STOPPED: run this on the laptop"; return 1; }
  cd ~/homepi-infra || return 1
  if [ "$(git log -1 --format=%s)" != "$subject" ]; then
    { git add -- "$@" && ! git diff --cached --quiet; } || { echo "STOPPED: nothing staged for this commit"; cd ~; return 1; }
    git commit -q -m "$subject" -m "$body" || { echo "STOPPED: the commit failed (run release again)"; cd ~; return 1; }
  fi
  if git rev-parse -q --verify "refs/tags/$tag" > /dev/null; then echo "STOPPED: tag $tag already exists"; cd ~; return 1; fi
  git tag -s "$tag" -m "$tagmsg" && git tag -v "$tag" > /dev/null 2>&1 && echo "tag verified" && git push pi main "refs/tags/$tag" 2>&1 | tail -2
  rc=$?
  cd ~
  return $rc
}
