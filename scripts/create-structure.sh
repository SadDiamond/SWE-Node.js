#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

while read -r folder; do
  [ -n "$folder" ] || continue
  mkdir -p "$folder"
  echo "folder  $folder"
done < docs/folders.txt

while read -r file; do
  [ -n "$file" ] || continue
  [ -e "$file" ] || touch "$file"
  echo "file    $file"
done < docs/files.txt

echo "Project structure is ready."
