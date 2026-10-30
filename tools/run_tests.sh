#!/bin/bash
cd /home/user/ruby-phone
for f in "$@"; do
  out=$(node --test "tests/${f}.test.mjs" 2>&1)
  p=$(printf '%s\n' "$out" | grep -E 'pass [0-9]+' | head -1 | grep -oE '[0-9]+')
  fl=$(printf '%s\n' "$out" | grep -E 'fail [0-9]+' | head -1 | grep -oE '[0-9]+')
  printf '%-18s pass=%s fail=%s\n' "$f" "${p:-NA}" "${fl:-NA}"
done