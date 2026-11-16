#!/usr/bin/env bash
# Package published images only. Never include running containers, .env or application data.
set -Eeuo pipefail
export LC_ALL=C
umask 022

die() { printf '%s\n' "$*" >&2; exit 1; }
version=$(tr -d '\r\n' < "$(dirname "${BASH_SOURCE[0]}")/../VERSION")
architecture=''
output=''
work=''
lock=''

while [ "$#" -gt 0 ]; do
    case "$1" in
        --version) [ "$#" -ge 2 ] || die '--version requires a value'; version="$2"; shift 2 ;;
        --arch) [ "$#" -ge 2 ] || die '--arch requires a value'; architecture="$2"; shift 2 ;;
        --output) [ "$#" -ge 2 ] || die '--output requires a directory'; output="$2"; shift 2 ;;
        *) die "Unknown argument: $1" ;;
    esac
done

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9.-]+)?$ ]] || die 'Invalid application version'
if [ -z "$architecture" ]; then
    case "$(uname -m)" in
        x86_64|amd64) architecture=amd64 ;;
        aarch64|arm64) architecture=arm64 ;;
        *) die 'Only linux/amd64 and linux/arm64 packages are supported' ;;
    esac
fi
[[ "$architecture" == amd64 || "$architecture" == arm64 ]] || die 'Invalid architecture'
[ -n "$output" ] && [[ "$output" != *$'\n'* ]] || die '--output requires a directory'
for tool in docker gzip split sha256sum mktemp; do
    command -v "$tool" >/dev/null || die "Missing command: $tool"
done
mkdir -p -- "$output"
output=$(cd -- "$output" && pwd -P)
[ "$output" != / ] || die 'The filesystem root cannot be the output directory'
prefix="tiktok-knowledge-$version-linux-$architecture-full"
lock="$output/.$prefix.lock"
mkdir -- "$lock" || die 'Another package task is using this output directory'

cleanup() {
    if [[ -n "$work" && "$work" == "$output"/.offline-package.* && -d "$work" ]]; then
        rm -rf -- "$work"
    fi
    [ -z "$lock" ] || rmdir -- "$lock" 2>/dev/null || true
}
trap cleanup EXIT
shopt -s nullglob
existing=("$output/$prefix"*)
[ "${#existing[@]}" -eq 0 ] || die "Package files already exist for $version/$architecture; use a new output directory"

images=("ghcr.io/359073395/tiktok-knowledge:$version" 'postgres:17-alpine' 'postgrest/postgrest:v16.5')
for image in "${images[@]}"; do
    platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image") || die "Published image must be loaded first: $image"
    [ "$platform" = "linux/$architecture" ] || die "Image platform mismatch for $image: $platform"
done

work=$(mktemp -d "$output/.offline-package.XXXXXX")
# Streaming avoids retaining a second full archive. 90 MiB is below the 100 MB attachment cap.
docker save "${images[@]}" | gzip -6 | split -b 90M -d -a 3 - "$work/$prefix.tar.gz.part-"
parts=("$work/$prefix.tar.gz.part-"[0-9][0-9][0-9])
[ "${#parts[@]}" -gt 0 ] || die 'Docker did not produce any image archive parts'
(
    cd -- "$work"
    sha256sum "$prefix.tar.gz.part-"[0-9][0-9][0-9] > "$prefix.sha256"
    sha256sum --check "$prefix.sha256"
)
# Publish the manifest last; its existence marks a complete package.
mv -- "${parts[@]}" "$output/"
mv -- "$work/$prefix.sha256" "$output/"
printf 'Created %s parts and %s.sha256 in %s\n' "${#parts[@]}" "$prefix" "$output"
