#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
source "$ROOT/apps/tiktok-knowledge/install.sh"
TEST_ROOT=$(mktemp -d)
trap 'rm -rf -- "$TEST_ROOT"' EXIT
APP_DIR="$TEST_ROOT/install"
mkdir -p "$APP_DIR"

assert_equal() {
    [ "$1" = "$2" ] || { printf 'Expected <%s>, received <%s>\n' "$1" "$2" >&2; exit 1; }
}

# Values are data, not shell code. Replacing a key removes duplicates atomically.
printf 'ADMIN_TOKEN=keep-secret\nSITE_URL=http://old.example\nSITE_URL=http://duplicate.example\n' > "$APP_DIR/.env"
set_env_value SITE_URL 'https://learn.example.com'
assert_equal 'keep-secret' "$(env_value ADMIN_TOKEN)"
assert_equal 'https://learn.example.com' "$(env_value SITE_URL)"
assert_equal 1 "$(grep -c '^SITE_URL=' "$APP_DIR/.env")"
set_env_value SITE_URL ''
assert_equal '' "$(env_value SITE_URL)"
validate_origin 'https://learn.example.com'
validate_origin 'http://127.0.0.1:8791'
validate_origin 'http://[::1]:8791'
if validate_origin 'https://example.com/../../etc'; then exit 1; fi
if validate_origin $'https://example.com\nADMIN_TOKEN=injected'; then exit 1; fi
if validate_origin 'https://example.com;id'; then exit 1; fi

# Existing installs must keep their credentials even when --install is repeated.
FIRST_INSTALL=0
RELEASE_IMAGE='example/image:1.0.0'
create_environment
assert_equal 'keep-secret' "$(env_value ADMIN_TOKEN)"
assert_equal 0 "$FIRST_INSTALL"

# A failed domain restart restores SITE_URL and retains all other credentials.
touch "$APP_DIR/compose.yaml"
set_env_value SITE_URL 'https://old.example'
compose() { return 0; }
wait_healthy() { return 1; }
if (set_origin 'https://new.example') >/dev/null 2>&1; then exit 1; fi
assert_equal 'https://old.example' "$(env_value SITE_URL)"
assert_equal 'keep-secret' "$(env_value ADMIN_TOKEN)"

# Rollback restores old configuration and uses the exact old image already on disk.
mkdir -p "$APP_DIR/backups/latest-pre-update"
printf 'ADMIN_TOKEN=original\nTIKTOK_IMAGE=old-tag\n' > "$APP_DIR/backups/latest-pre-update/.env"
printf 'services: {}\n' > "$APP_DIR/backups/latest-pre-update/compose.yaml"
printf '1.0.0\n' > "$APP_DIR/backups/latest-pre-update/VERSION"
wait_healthy() { return 0; }
rollback_application 'sha256:old-image-id'
assert_equal original "$(env_value ADMIN_TOKEN)"
assert_equal 'sha256:old-image-id' "$(env_value TIKTOK_IMAGE)"
assert_equal '1.0.0' "$(cat "$APP_DIR/VERSION")"

# Anonymous GHCR failures can use release assets, with SHA validation before docker load.
WORK_DIR="$TEST_ROOT/release"
mkdir -p "$WORK_DIR"
RELEASE_VERSION=0.1.0
RELEASE_IMAGE="ghcr.io/359073395/tiktok-knowledge:$RELEASE_VERSION"
MOCK_IMAGE="$TEST_ROOT/image.tar.gz"
printf 'mock docker save archive' > "$MOCK_IMAGE"
MOCK_SUM=$(sha256sum "$MOCK_IMAGE" | cut -d ' ' -f 1)
uname() { printf 'x86_64\n'; }
docker() {
    case "$1" in
        pull) return 1 ;;
        load) printf '%s\n' "$*" >> "$TEST_ROOT/loads" ;;
        image) return 0 ;;
        *) return 1 ;;
    esac
}
curl() {
    local url='' output=''
    while [ "$#" -gt 0 ]; do
        case "$1" in
            https://*) url="$1" ;;
            -o) shift; output="$1" ;;
        esac
        shift
    done
    case "$url" in
        */SHA256SUMS) printf '%s  tiktok-knowledge-0.1.0-linux-amd64.tar.gz\n' "$MOCK_SUM" > "$output" ;;
        *.tar.gz) cp "$MOCK_IMAGE" "$output" ;;
        *) return 1 ;;
    esac
}
pull_application_image >/dev/null
assert_equal 1 "$(wc -l < "$TEST_ROOT/loads" | tr -d ' ')"
MOCK_SUM=$(printf '0%.0s' {1..64})
if pull_application_image >/dev/null 2>&1; then exit 1; fi
assert_equal 1 "$(wc -l < "$TEST_ROOT/loads" | tr -d ' ')"

# Full first install and failed update preserve the administrator and roll back exactly.
source "$ROOT/apps/tiktok-knowledge/install.sh"
APP_DIR="$TEST_ROOT/deploy"
WORK_DIR=''
mkdir -p "$APP_DIR"
MOCK_VERSION=0.1.0
MOCK_FAIL_HEALTH=0
ACTION=--install
chown() { :; } # The smoke test also runs on Git Bash, without Unix ownership support.
download_release() {
    WORK_DIR=$(mktemp -d "$APP_DIR/.deploy.XXXXXX")
    SOURCE_REF="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    RELEASE_VERSION="$MOCK_VERSION"
    RELEASE_IMAGE="example/test:$MOCK_VERSION"
    printf '%s\n' "$MOCK_VERSION" > "$WORK_DIR/VERSION"
    printf 'services: {}\n' > "$WORK_DIR/compose.yaml"
    cp "$ROOT/apps/tiktok-knowledge/install.sh" "$WORK_DIR/install.sh"
}
pull_application_image() { return 0; }
docker() { printf 'sha256:previous-image\n'; }
compose() {
    printf '%s\n' "$*" >> "$TEST_ROOT/compose-calls"
    if [[ "$*" == *pg_dump* ]]; then printf 'database dump'; fi
    return 0
}
wait_healthy() {
    if [ "$MOCK_FAIL_HEALTH" -eq 1 ] && [ ! -f "$TEST_ROOT/health-failed" ]; then
        touch "$TEST_ROOT/health-failed"
        return 1
    fi
    return 0
}
deploy >/dev/null
original_token=$(env_value ADMIN_TOKEN)
[ "${#original_token}" -eq 48 ]
assert_equal 0.1.0 "$(cat "$APP_DIR/VERSION")"
cleanup
MOCK_VERSION=0.2.0
MOCK_FAIL_HEALTH=1
ACTION=--update
if (deploy) >/dev/null 2>&1; then exit 1; fi
assert_equal "$original_token" "$(env_value ADMIN_TOKEN)"
assert_equal 'sha256:previous-image' "$(env_value TIKTOK_IMAGE)"
assert_equal 0.1.0 "$(cat "$APP_DIR/VERSION")"
assert_equal 'database dump' "$(cat "$APP_DIR/backups/latest-pre-update/database.dump")"
grep -q 'up -d --no-build db' "$TEST_ROOT/compose-calls"

# A missing initial release or failed image pull cannot alter existing credentials.
pull_application_image() { return 1; }
cp "$APP_DIR/.env" "$TEST_ROOT/environment-before-pull"
cp "$APP_DIR/compose.yaml" "$TEST_ROOT/compose-before-pull"
if (deploy) >"$TEST_ROOT/missing-release.log" 2>&1; then exit 1; fi
cmp "$APP_DIR/.env" "$TEST_ROOT/environment-before-pull"
cmp "$APP_DIR/compose.yaml" "$TEST_ROOT/compose-before-pull"
grep -q '0.2.0' "$TEST_ROOT/missing-release.log"
APP_DIR="$TEST_ROOT/unpublished-install"
mkdir -p "$APP_DIR"
ACTION=--install
if (deploy) >/dev/null 2>&1; then exit 1; fi
[ ! -f "$APP_DIR/.env" ]
[ ! -f "$APP_DIR/compose.yaml" ]

# Files outside the application must never be followed for configuration or chown.
if [ "$(command uname -s)" = Linux ]; then
    mkdir -p "$TEST_ROOT/unrelated-data"
    ln -s "$TEST_ROOT/unrelated-data" "$APP_DIR/data"
    if (validate_install_paths) >/dev/null 2>&1; then exit 1; fi
    assert_equal 600 "$(stat -c %a "$TEST_ROOT/deploy/.env")"
fi

# Source only the menu's helper definitions so its shared Nginx operations are testable.
source <(awk '
    { sub(/\r$/, "") }
    /123\|tiktok-knowledge\|tiktok-kb\|tkkb\)/ { section = 1 }
    section && /tkkb_env_value\(\)/ { helpers = 1 }
    helpers && /while true; do/ { exit }
    helpers { print }
' "$ROOT/harvey.sh")
tkkb_port=8791
tkkb_domain_valid 'learn.example.com'
if tkkb_domain_valid '../example.com'; then exit 1; fi
if tkkb_domain_valid '-learn.example.com'; then exit 1; fi
if tkkb_domain_valid 'learn.example.com;id'; then exit 1; fi
printf 'server 127.0.0.1:8791;\n' > "$TEST_ROOT/owned.conf"
printf 'server 127.0.0.1:8790;\n' > "$TEST_ROOT/other.conf"
tkkb_domain_matches "$TEST_ROOT/owned.conf"
if tkkb_domain_matches "$TEST_ROOT/other.conf"; then exit 1; fi
tkkb_write_proxy "$TEST_ROOT/proxy.conf" 'learn.example.com'
tkkb_domain_matches "$TEST_ROOT/proxy.conf"
grep -q 'proxy_cache off;' "$TEST_ROOT/proxy.conf"
if grep -q 'proxy_cache_path' "$TEST_ROOT/proxy.conf"; then exit 1; fi
assert_equal 1 "$(grep -c 'client_max_body_size 220m;' "$TEST_ROOT/proxy.conf")"
assert_equal 1 "$(grep -c 'proxy_read_timeout 300s;' "$TEST_ROOT/proxy.conf")"
grep -Fq 'proxy_set_header X-Forwarded-Proto $scheme;' "$TEST_ROOT/proxy.conf"
if declare -f tkkb_remove_domain | grep -q 'web_del'; then exit 1; fi

# Menu installs resolve main once and execute the installer from that exact commit.
HY_REF=main
tkkb_dir="$TEST_ROOT/menu-install"
export RUN_CAPTURE="$TEST_ROOT/menu-arguments"
curl() {
    local url='' output=''
    while [ "$#" -gt 0 ]; do
        case "$1" in
            https://*) url="$1" ;;
            -o) shift; output="$1" ;;
        esac
        shift
    done
    printf '%s\n' "$url" >> "$TEST_ROOT/download-urls"
    case "$url" in
        */commits/main) printf '{\n  "sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"\n}\n' ;;
        */bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/apps/tiktok-knowledge/install.sh)
            printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@" > "$RUN_CAPTURE"\n' > "$output"
            ;;
        *) return 1 ;;
    esac
}
assert_equal bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$(resolve_ref)"
tkkb_run --install
assert_equal $'--install\n--ref\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' "$(cat "$RUN_CAPTURE")"
grep -q '/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/apps/tiktok-knowledge/install.sh' "$TEST_ROOT/download-urls"
rm -f "$RUN_CAPTURE"
curl() { return 1; }
if tkkb_run --install >/dev/null 2>&1; then exit 1; fi
[ ! -f "$RUN_CAPTURE" ]

# Restore validates archives before stopping services, then preserves site configuration.
source "$ROOT/apps/tiktok-knowledge/install.sh"
APP_DIR="$TEST_ROOT/restore-install"
mkdir -p "$APP_DIR/data"
printf 'ADMIN_TOKEN=target-token\nSITE_URL=https://target.example\nAPP_PORT=8791\n' > "$APP_DIR/.env"
printf 'services: {}\n' > "$APP_DIR/compose.yaml"
printf '0.1.0\n' > "$APP_DIR/VERSION"
printf 'previous data' > "$APP_DIR/data/previous.txt"
printf 'PGDMPprevious database' > "$TEST_ROOT/current-database"
python3 - "$TEST_ROOT" <<'PY'
import hashlib
import io
import json
import pathlib
import sys
import tarfile

root = pathlib.Path(sys.argv[1])
files = {'database.dump': b'PGDMPimported database', 'data/image.txt': b'imported image'}
def entry(name):
    return {'bytes': len(files[name]), 'sha256': hashlib.sha256(files[name]).hexdigest()}
manifest = {
    'format': 'tiktok-knowledge-backup', 'version': 1, 'createdAt': '2026-11-12T00:00:00Z',
    'appVersion': '0.1.0', 'postgresMajor': 17,
    'database': {'file': 'database.dump', 'format': 'custom', **entry('database.dump')},
    'data': {'directory': 'data', 'files': 1, 'bytes': len(files['data/image.txt'])},
    'files': [{'path': 'data/image.txt', **entry('data/image.txt')}],
}
for kind in ['valid', 'traversal', 'symlink', 'duplicate', 'checksum', 'future', 'missing']:
    content = dict(files)
    current_manifest = json.loads(json.dumps(manifest))
    if kind == 'checksum':
        current_manifest['database']['sha256'] = '0' * 64
    if kind == 'future':
        current_manifest['appVersion'] = '99.0.0'
    if kind == 'missing':
        del content['data/image.txt']
    content['manifest.json'] = json.dumps(current_manifest).encode()
    with tarfile.open(root / (kind + '.tar.gz'), 'w:gz') as bundle:
        for name, body in content.items():
            info = tarfile.TarInfo(name)
            info.size = len(body)
            bundle.addfile(info, io.BytesIO(body))
        if kind == 'traversal':
            info = tarfile.TarInfo('../outside.txt')
            info.size = 1
            bundle.addfile(info, io.BytesIO(b'x'))
        if kind == 'symlink':
            info = tarfile.TarInfo('data/link')
            info.type = tarfile.SYMTYPE
            info.linkname = '/etc/passwd'
            bundle.addfile(info)
        if kind == 'duplicate':
            body = content['data/image.txt']
            info = tarfile.TarInfo('data/image.txt')
            info.size = len(body)
            bundle.addfile(info, io.BytesIO(body))
PY
for malformed in traversal symlink duplicate checksum future missing; do
    WORK_DIR=$(mktemp -d "$APP_DIR/.deploy.XXXXXX")
    if extract_backup "$TEST_ROOT/$malformed.tar.gz" >/dev/null 2>&1; then
        printf 'Unsafe archive accepted: %s\n' "$malformed" >&2
        exit 1
    fi
    cleanup
done
[ ! -e "$APP_DIR/outside.txt" ]
compose() {
    printf '%s\n' "$*" >> "$TEST_ROOT/restore-calls"
    if [[ "$*" == *pg_dump* ]]; then cat "$TEST_ROOT/current-database"; fi
    if [[ "$*" == *pg_restore* ]]; then
        if [[ "$*" == *--list* ]]; then cat >/dev/null
        else cat > "$TEST_ROOT/current-database"
        fi
    fi
    return 0
}
wait_healthy() { return 0; }
restore_backup "$TEST_ROOT/valid.tar.gz" >/dev/null
assert_equal 'imported image' "$(cat "$APP_DIR/data/image.txt")"
assert_equal 'PGDMPimported database' "$(cat "$TEST_ROOT/current-database")"
assert_equal 'previous data' "$(cat "$APP_DIR/backups/latest-pre-restore/data/previous.txt")"
assert_equal target-token "$(env_value ADMIN_TOKEN)"
assert_equal 'https://target.example' "$(env_value SITE_URL)"
grep -q 'pg_isready -h 127.0.0.1' "$TEST_ROOT/restore-calls"
grep -q 'stop app rest' "$TEST_ROOT/restore-calls"
cleanup

# A failed restored application's health check restores both its former database and files.
printf 'data before failed restore' > "$APP_DIR/data/image.txt"
printf 'PGDMPdatabase before failed restore' > "$TEST_ROOT/current-database"
wait_healthy() {
    if [ ! -f "$TEST_ROOT/restore-health-failed" ]; then
        touch "$TEST_ROOT/restore-health-failed"
        return 1
    fi
    return 0
}
if (restore_backup "$TEST_ROOT/valid.tar.gz") >/dev/null 2>&1; then exit 1; fi
assert_equal 'data before failed restore' "$(cat "$APP_DIR/data/image.txt")"
assert_equal 'PGDMPdatabase before failed restore' "$(cat "$TEST_ROOT/current-database")"
assert_equal target-token "$(env_value ADMIN_TOKEN)"

# Both menus use the same route and install/domain helpers.
for entry in harvey.sh cn/harvey.sh; do
    bash -n "$ROOT/$entry"
    grep -q '123|tiktok-knowledge|tiktok-kb|tkkb)' "$ROOT/$entry"
    grep -q 'tkkb_run --set-domain' "$ROOT/$entry"
    grep -q 'tkkb_run --clear-domain' "$ROOT/$entry"
done
diff <(sed -n '/123|tiktok-knowledge|tiktok-kb|tkkb)/,/^\s*b)/p' "$ROOT/harvey.sh") \
     <(sed -n '/123|tiktok-knowledge|tiktok-kb|tkkb)/,/^\s*b)/p' "$ROOT/cn/harvey.sh")
bash -n "$ROOT/apps/tiktok-knowledge/install.sh"
printf 'TikTok knowledge installer smoke tests passed.\n'
