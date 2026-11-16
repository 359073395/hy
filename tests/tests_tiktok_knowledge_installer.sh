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
    if [[ "$*" == *deploy/admin-account.cjs* ]]; then
        local payload
        payload=$(cat)
        if [[ "$payload" == '{"action":"status"}' ]]; then
            if [ -f "$TEST_ROOT/admin-configured" ]; then
                printf '{"admins":[{"id":"admin-id","name":"网站管理员","username":"owner","hasPassword":true,"status":"active"}],"hasPasswordAdmin":true}\n'
            else
                printf '{"admins":[],"hasPasswordAdmin":false}\n'
            fi
        else
            printf '%s' "$payload" > "$TEST_ROOT/admin-input.json"
            touch "$TEST_ROOT/admin-configured"
            printf '{"ok":true,"user":{"id":"admin-id","name":"网站管理员","username":"owner"}}\n'
        fi
    fi
    return 0
}
wait_healthy() {
    if [ "$MOCK_FAIL_HEALTH" -eq 1 ] && [ ! -f "$TEST_ROOT/health-failed" ]; then
        touch "$TEST_ROOT/health-failed"
        return 1
    fi
    return 0
}
deploy > "$TEST_ROOT/installed.log"
original_token=$(env_value ADMIN_TOKEN)
[ "${#original_token}" -eq 48 ]
assert_equal 0.1.0 "$(cat "$APP_DIR/VERSION")"
grep -q '/admin/login' "$TEST_ROOT/installed.log"
grep -q -- '--admin-account' "$TEST_ROOT/installed.log"
if grep -q "$original_token" "$TEST_ROOT/installed.log"; then exit 1; fi

# Password input preserves spaces and shell characters and travels only over stdin JSON.
test_password='  CI "quote" \slash $value `literal`  '
prompt_admin_credentials reset admin-id owner < <(printf '%s\n' OWNER "$test_password" "$test_password") > /dev/null
apply_admin_payload > "$TEST_ROOT/admin-output.log"
python3 - "$TEST_ROOT/admin-input.json" <<'PY'
import json,sys
with open(sys.argv[1], encoding='utf-8') as stream:
    value = json.load(stream)
assert value == {'action': 'reset', 'userId': 'admin-id', 'username': 'owner', 'password': '  CI "quote" \\slash $value `literal`  '}
PY
assert_equal '' "$ADMIN_PAYLOAD"
if grep -q 'quote\|slash\|literal' "$TEST_ROOT/admin-output.log" "$APP_DIR/.env"; then exit 1; fi
set_env_value SITE_URL 'https://bound.example'
show_access > "$TEST_ROOT/access.log"
grep -q 'https://bound.example/admin/login' "$TEST_ROOT/access.log"
cp "$TEST_ROOT/admin-input.json" "$TEST_ROOT/admin-before-update.json"
ADMIN_PAYLOAD='{"action":"create","username":"unrequested","password":"unused-password"}'
ensure_admin_account
cmp "$TEST_ROOT/admin-input.json" "$TEST_ROOT/admin-before-update.json"
assert_equal '' "$ADMIN_PAYLOAD"
assert_equal 'https://bound.example' "$(env_value SITE_URL)"
assert_equal "$original_token" "$(env_value ADMIN_TOKEN)"

# Explicit unattended setup files require private permissions and get passed over stdin.
if [ "$(command uname -s)" = Linux ]; then
    rm -f "$TEST_ROOT/admin-configured"
    ADMIN_SETUP_FILE="$TEST_ROOT/admin-setup.json"
    printf '{"action":"create","username":"owner","password":"CI-only-password"}' > "$ADMIN_SETUP_FILE"
    chmod 600 "$ADMIN_SETUP_FILE"
    ensure_admin_account > "$TEST_ROOT/setup.log"
    grep -q '"create"' "$TEST_ROOT/admin-input.json"
    if grep -q 'CI-only-password' "$TEST_ROOT/setup.log" "$APP_DIR/.env"; then exit 1; fi
    chmod 644 "$ADMIN_SETUP_FILE"
    if load_admin_setup_file >/dev/null 2>&1; then exit 1; fi
    unset ADMIN_SETUP_FILE
fi
cleanup
MOCK_VERSION=0.2.0
MOCK_FAIL_HEALTH=1
ACTION=--update
if (deploy) >/dev/null 2>&1; then exit 1; fi
assert_equal "$original_token" "$(env_value ADMIN_TOKEN)"
assert_equal 'sha256:previous-image' "$(env_value TIKTOK_IMAGE)"
assert_equal 0.1.0 "$(cat "$APP_DIR/VERSION")"
assert_equal 'database dump' "$(cat "$APP_DIR/backups/latest-pre-update/database.dump")"
grep -q '^up -d --no-build --no-recreate db$' "$TEST_ROOT/compose-calls"

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
        */commits/main) printf '{"commit":{"sha":"nested-value-is-not-the-commit"},"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n' ;;
        */bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/apps/tiktok-knowledge/install.sh)
            printf '#!/usr/bin/env bash\nprintf "%%s\\n" "$@" > "$RUN_CAPTURE"\nprintf "%%s\\n" "${TIKTOK_SOURCE:-github}" > "$RUN_CAPTURE.source"\n' > "$output"
            ;;
        *) return 1 ;;
    esac
}
assert_equal bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$(resolve_ref)"
tkkb_run --install
assert_equal $'--install\n--ref\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' "$(cat "$RUN_CAPTURE")"
grep -q '/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/apps/tiktok-knowledge/install.sh' "$TEST_ROOT/download-urls"
TIKTOK_SOURCE=gitee tkkb_run --install
assert_equal gitee "$(cat "$RUN_CAPTURE.source")"
grep -q 'https://gitee.com/api/v5/repos/hy91/hy/commits/main' "$TEST_ROOT/download-urls"
grep -q 'https://gitee.com/hy91/hy/raw/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/apps/tiktok-knowledge/install.sh' "$TEST_ROOT/download-urls"
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

# Domestic installs and local image bundles never contact foreign registries.
(
source "$ROOT/apps/tiktok-knowledge/install.sh"
unset TIKTOK_SOURCE TIKTOK_GITEE_REPOSITORY TIKTOK_BUNDLE_BASE TIKTOK_BUNDLE_DIR TIKTOK_IMAGE
APP_DIR="$TEST_ROOT/domestic-install"
mkdir -p "$APP_DIR/data" "$TEST_ROOT/bundle-origin"
printf 'ADMIN_TOKEN=unchanged-token\nPOSTGRES_PASSWORD=unchanged-password\nSITE_URL=https://existing.example\nAPP_PORT=8791\nTIKTOK_IMAGE=old-image\n' > "$APP_DIR/.env"
printf 'services: {}\n' > "$APP_DIR/compose.yaml"
printf '0.3.0\n' > "$APP_DIR/VERSION"
printf 'existing uploaded image' > "$APP_DIR/data/keep.txt"
printf 'existing employee and exam data' > "$TEST_ROOT/domestic-database"
cp "$APP_DIR/.env" "$TEST_ROOT/domestic-original-env"
configure_downloads
assert_equal github "$DOWNLOAD_SOURCE"
assert_equal 0 "$SAVE_DOWNLOAD_SETTINGS"
TIKTOK_SOURCE=github TIKTOK_GITEE_REPOSITORY=hy91/hy configure_downloads
assert_equal 0 "$SAVE_DOWNLOAD_SETTINGS"

stem=tiktok-knowledge-0.3.1-linux-amd64-full
printf 'first image archive portion' > "$TEST_ROOT/bundle-origin/$stem.tar.gz.part-000"
printf 'second image archive portion' > "$TEST_ROOT/bundle-origin/$stem.tar.gz.part-001"
for part in 000 001; do
    sum=$(sha256sum "$TEST_ROOT/bundle-origin/$stem.tar.gz.part-$part" | cut -d ' ' -f 1)
    printf '%s  %s.tar.gz.part-%s\n' "$sum" "$stem" "$part"
done > "$TEST_ROOT/bundle-origin/$stem.sha256"
cat "$TEST_ROOT/bundle-origin/$stem.tar.gz.part-000" "$TEST_ROOT/bundle-origin/$stem.tar.gz.part-001" > "$TEST_ROOT/expected-full-archive"
curl() {
    local url='' output='' file
    while [ "$#" -gt 0 ]; do
        case "$1" in https://*) url="$1" ;; -o) shift; output="$1" ;; esac
        shift
    done
    printf '%s\n' "$url" >> "$TEST_ROOT/domestic-downloads"
    case "$url" in
        https://gitee.com/api/v5/repos/hy91/hy/commits/main)
            printf '{"commit":{"sha":"wrong-nested-sha"},"sha":"cccccccccccccccccccccccccccccccccccccccc"}' ;;
        https://gitee.com/hy91/hy/raw/cccccccccccccccccccccccccccccccccccccccc/apps/tiktok-knowledge/*)
            file="${url##*/}"
            if [ "$file" = install.sh ] && [ "${MOCK_BAD_INSTALLER:-0}" -eq 1 ]; then printf '<html>Login required</html>\n' > "$output"
            elif [ "$file" = VERSION ]; then printf '0.3.1\n' > "$output"
            else cp "$ROOT/apps/tiktok-knowledge/$file" "$output"
            fi ;;
        https://gitee.com/hy91/hy/releases/download/tiktok-knowledge-v0.3.1/*)
            cp "$TEST_ROOT/bundle-origin/${url##*/}" "$output" ;;
        *) printf 'Unexpected network request: %s\n' "$url" >&2; return 1 ;;
    esac
}
docker() {
    printf '%s\n' "$*" >> "$TEST_ROOT/domestic-docker"
    case "$1" in
        image) [ -f "$TEST_ROOT/bundle-loaded" ] || return 1; printf '%s\n' "${MOCK_BUNDLE_PLATFORM:-linux/amd64}" ;;
        load)
            cmp "$3" "$TEST_ROOT/expected-full-archive" || return 1
            touch "$TEST_ROOT/bundle-loaded" ;;
        inspect) printf 'sha256:old-image-id\n' ;;
        *) printf 'Unexpected Docker command: %s\n' "$*" >&2; return 1 ;;
    esac
}
compose() {
    printf '%s\n' "$*" >> "$TEST_ROOT/domestic-compose"
    case "$*" in
        *pull\ db*|pull*) return 1 ;;
        *pg_dump*) cat "$TEST_ROOT/domestic-database" ;;
    esac
    return 0
}
wait_healthy() { return 0; }
ensure_admin_account() { return 0; }
HY_REF=main
TIKTOK_SOURCE=gitee
assert_equal cccccccccccccccccccccccccccccccccccccccc "$(resolve_ref)"
ACTION=--update
deploy > "$TEST_ROOT/domestic-install.log"
assert_equal unchanged-token "$(env_value ADMIN_TOKEN)"
assert_equal unchanged-password "$(env_value POSTGRES_PASSWORD)"
assert_equal 'https://existing.example' "$(env_value SITE_URL)"
assert_equal 'existing uploaded image' "$(cat "$APP_DIR/data/keep.txt")"
assert_equal 'existing employee and exam data' "$(cat "$TEST_ROOT/domestic-database")"
assert_equal gitee "$(env_value TIKTOK_SOURCE)"
assert_equal hy91/hy "$(env_value TIKTOK_GITEE_REPOSITORY)"
assert_equal 'https://gitee.com/hy91/hy/releases/download' "$(env_value TIKTOK_BUNDLE_BASE)"
cmp "$APP_DIR/backups/latest-pre-update/.env" "$TEST_ROOT/domestic-original-env"
grep -q '^up -d --no-build --no-recreate --pull never db$' "$TEST_ROOT/domestic-compose"
if grep -q '^pull ' "$TEST_ROOT/domestic-docker" "$TEST_ROOT/domestic-compose"; then exit 1; fi
grep -Fq 'image inspect --format {{.Os}}/{{.Architecture}} ghcr.io/359073395/tiktok-knowledge:0.3.1' "$TEST_ROOT/domestic-docker"
grep -Fq 'image inspect --format {{.Os}}/{{.Architecture}} postgres:17-alpine' "$TEST_ROOT/domestic-docker"
grep -Fq 'image inspect --format {{.Os}}/{{.Architecture}} postgrest/postgrest:v16.5' "$TEST_ROOT/domestic-docker"
if MOCK_BUNDLE_PLATFORM=linux/arm64 bundle_images_available; then exit 1; fi
if grep -Eq 'github|ghcr|docker.io' "$TEST_ROOT/domestic-downloads"; then exit 1; fi
cleanup

# A later direct --update reuses the saved source; existing images need no bundle download.
unset TIKTOK_SOURCE
configure_downloads
assert_equal gitee "$DOWNLOAD_SOURCE"
cp "$APP_DIR/.env" "$TEST_ROOT/domestic-saved-env"
if (MOCK_BAD_INSTALLER=1 deploy) >/dev/null 2>&1; then exit 1; fi
cmp "$APP_DIR/.env" "$TEST_ROOT/domestic-saved-env"
: > "$TEST_ROOT/domestic-downloads"
deploy >/dev/null
cmp "$APP_DIR/.env" "$TEST_ROOT/domestic-saved-env"
if grep -q '/releases/download/' "$TEST_ROOT/domestic-downloads"; then exit 1; fi
cleanup
TIKTOK_SOURCE=github configure_downloads
assert_equal github "$DOWNLOAD_SOURCE"
configure_downloads
assert_equal gitee "$DOWNLOAD_SOURCE"

# Failed health after changing source settings restores the original complete .env.
TIKTOK_GITEE_REPOSITORY=hy91/hy
TIKTOK_BUNDLE_BASE=https://downloads.example/releases
wait_healthy() {
    if [ ! -f "$TEST_ROOT/domestic-health-failed" ]; then touch "$TEST_ROOT/domestic-health-failed"; return 1; fi
    return 0
}
if (deploy) >/dev/null 2>&1; then exit 1; fi
assert_equal 'https://gitee.com/hy91/hy/releases/download' "$(env_value TIKTOK_BUNDLE_BASE)"
assert_equal unchanged-token "$(env_value ADMIN_TOKEN)"
assert_equal 'https://existing.example' "$(env_value SITE_URL)"
unset TIKTOK_GITEE_REPOSITORY TIKTOK_BUNDLE_BASE
wait_healthy() { return 0; }

# Local copied bundles work without any image-network calls and never persist their path.
rm -f "$TEST_ROOT/bundle-loaded"
TIKTOK_BUNDLE_DIR="$TEST_ROOT/bundle-origin"
deploy >/dev/null
if grep -q '^TIKTOK_BUNDLE_DIR=' "$APP_DIR/.env"; then exit 1; fi
cleanup

# A local bundle also selects registry-free image loading when the source is GitHub.
TIKTOK_SOURCE=github configure_downloads
assert_equal 1 "$USE_IMAGE_BUNDLE"
configure_downloads
rm -f "$TEST_ROOT/bundle-loaded"
cp "$APP_DIR/.env" "$TEST_ROOT/before-broken-bundle-env"
cp "$APP_DIR/compose.yaml" "$TEST_ROOT/before-broken-bundle-compose"
cp "$TEST_ROOT/bundle-origin/$stem.sha256" "$TEST_ROOT/valid-bundle.sha256"

# A corrupt part must be rejected before backups, service changes or docker load.
printf 'corrupt payload' > "$TEST_ROOT/bundle-origin/$stem.tar.gz.part-001"
: > "$TEST_ROOT/domestic-compose"
: > "$TEST_ROOT/domestic-docker"
if (deploy) > "$TEST_ROOT/broken-bundle.log" 2>&1; then exit 1; fi
grep -q 'SHA256' "$TEST_ROOT/broken-bundle.log"
cmp "$APP_DIR/.env" "$TEST_ROOT/before-broken-bundle-env"
cmp "$APP_DIR/compose.yaml" "$TEST_ROOT/before-broken-bundle-compose"
[ ! -s "$TEST_ROOT/domestic-compose" ]
if grep -q '^load ' "$TEST_ROOT/domestic-docker"; then exit 1; fi

# Reject empty, path-traversal, duplicate, out-of-order and non-contiguous manifests.
printf 'second image archive portion' > "$TEST_ROOT/bundle-origin/$stem.tar.gz.part-001"
configure_downloads
WORK_DIR=$(mktemp -d "$APP_DIR/.deploy.XXXXXX")
RELEASE_VERSION=0.3.1
RELEASE_IMAGE=ghcr.io/359073395/tiktok-knowledge:0.3.1
sum=$(printf '0%.0s' {1..64})
for malformed in empty traversal duplicate gap reversed; do
    case "$malformed" in
        empty) : > "$TEST_ROOT/bundle-origin/$stem.sha256" ;;
        traversal) printf '%s  ../outside\n' "$sum" > "$TEST_ROOT/bundle-origin/$stem.sha256" ;;
        duplicate) head -n 1 "$TEST_ROOT/valid-bundle.sha256" > "$TEST_ROOT/bundle-origin/$stem.sha256"; head -n 1 "$TEST_ROOT/valid-bundle.sha256" >> "$TEST_ROOT/bundle-origin/$stem.sha256" ;;
        gap) sed 's/part-001/part-002/' "$TEST_ROOT/valid-bundle.sha256" > "$TEST_ROOT/bundle-origin/$stem.sha256" ;;
        reversed) tail -n 1 "$TEST_ROOT/valid-bundle.sha256" > "$TEST_ROOT/bundle-origin/$stem.sha256"; head -n 1 "$TEST_ROOT/valid-bundle.sha256" >> "$TEST_ROOT/bundle-origin/$stem.sha256" ;;
    esac
    if load_image_bundle >/dev/null 2>&1; then printf 'Accepted invalid bundle: %s\n' "$malformed" >&2; exit 1; fi
done
if grep -q '^load ' "$TEST_ROOT/domestic-docker"; then exit 1; fi
cleanup
)

# Both menus use the same route and install/domain helpers.
for entry in harvey.sh cn/harvey.sh; do
    bash -n "$ROOT/$entry"
    grep -q '123|tiktok-knowledge|tiktok-kb|tkkb)' "$ROOT/$entry"
    grep -q 'tkkb_run --set-domain' "$ROOT/$entry"
    grep -q 'tkkb_run --clear-domain' "$ROOT/$entry"
    grep -q '4) tkkb_run --admin-account' "$ROOT/$entry"
    grep -q '后台登录.*admin/login' "$ROOT/$entry"
done
diff <(sed -n '/123|tiktok-knowledge|tiktok-kb|tkkb)/,/^\s*b)/p' "$ROOT/harvey.sh") \
     <(sed -n '/123|tiktok-knowledge|tiktok-kb|tkkb)/,/^\s*b)/p' "$ROOT/cn/harvey.sh")
bash -n "$ROOT/apps/tiktok-knowledge/install.sh"
printf 'TikTok knowledge installer smoke tests passed.\n'
