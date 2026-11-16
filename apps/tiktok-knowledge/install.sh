#!/usr/bin/env bash
# TikTok knowledge system deployment. Data and credentials survive updates/uninstall.
set -Eeuo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/tiktok-knowledge}"
HY_REF="${HY_REF:-main}"
REPOSITORY="359073395/hy"
WORK_DIR=""
RESTORE_BACKUP=""
RESTORE_RESUME=0
ADMIN_PAYLOAD=""

die() { printf '%s\n' "$*" >&2; exit 1; }

env_value() {
    [ -f "$APP_DIR/.env" ] || return 0
    sed -n "s/^${1}=//p" "$APP_DIR/.env" | tail -n 1
}

set_env_value() {
    local key="$1" value="$2" temporary
    temporary=$(mktemp "$APP_DIR/.env.XXXXXX")
    awk -v key="$key" -v value="$value" '
        BEGIN { found = 0 }
        index($0, key "=") == 1 { if (!found) print key "=" value; found = 1; next }
        { print }
        END { if (!found) print key "=" value }
    ' "$APP_DIR/.env" > "$temporary"
    chmod 600 "$temporary"
    mv -f "$temporary" "$APP_DIR/.env"
}

compose() {
    docker compose --project-name tiktok-knowledge --project-directory "$APP_DIR" \
        --env-file "$APP_DIR/.env" -f "$APP_DIR/compose.yaml" "$@"
}

validate_origin() {
    # Origin only, so values are safe in .env and match browser Origin headers.
    [[ "$1" =~ ^https?://([a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?|\[[0-9a-fA-F:]+\])(:[0-9]{1,5})?$ ]]
}

cleanup() {
    ADMIN_PAYLOAD=""
    if [ -n "$RESTORE_BACKUP" ]; then
        local backup="$RESTORE_BACKUP"
        RESTORE_BACKUP=""
        rollback_restore "$backup" || printf '自动恢复失败，请使用 %s 中的数据库和素材恢复。\n' "$backup" >&2
    elif [ "$RESTORE_RESUME" -eq 1 ]; then
        compose up -d --no-build --pull never rest app || true
    fi
    if [[ -n "$WORK_DIR" && "$WORK_DIR" == "$APP_DIR"/.deploy.* && -d "$WORK_DIR" ]]; then
        rm -rf -- "$WORK_DIR"
    fi
}

validate_install_paths() {
    local path
    # Only manage application-owned paths inside the resolved installation directory.
    for path in .env compose.yaml install.sh VERSION SOURCE_REF data postgres backups .install.lock; do
        [ ! -L "$APP_DIR/$path" ] || die "安装路径包含符号链接，请先核对实际位置：$APP_DIR/$path"
    done
}

require_runtime() {
    [ "$(id -u)" -eq 0 ] || die "请使用 root 运行安装器。"
    for tool in docker curl openssl flock sha256sum python3; do
        command -v "$tool" >/dev/null || die "缺少 $tool，请先安装 Docker Compose、curl、openssl、util-linux 和 python3。"
    done
    docker compose version >/dev/null || die "需要 Docker Compose v2。"
    docker info >/dev/null 2>&1 || die "Docker 服务未运行。"
    [[ "$APP_DIR" == /* && "$APP_DIR" != / && "$APP_DIR" != /opt && "$APP_DIR" != /home ]] || die "安装目录无效。"
    [[ "$APP_DIR" != *$'\n'* && "$APP_DIR" != *'/../'* && "$APP_DIR" != */.. ]] || die "安装目录无效。"
    mkdir -p "$APP_DIR"
    APP_DIR=$(cd "$APP_DIR" && pwd -P)
    [[ "$APP_DIR" != / && "$APP_DIR" != /opt && "$APP_DIR" != /home ]] || die "安装目录解析后无效。"
    validate_install_paths
    exec 9> "$APP_DIR/.install.lock"
    flock -n 9 || die "另一个安装或更新任务正在运行。"
    trap cleanup EXIT
}

configure_downloads() {
    DOWNLOAD_SOURCE="${TIKTOK_SOURCE:-$(env_value TIKTOK_SOURCE)}"
    DOWNLOAD_SOURCE="${DOWNLOAD_SOURCE:-github}"
    GITEE_REPOSITORY="${TIKTOK_GITEE_REPOSITORY:-$(env_value TIKTOK_GITEE_REPOSITORY)}"
    GITEE_REPOSITORY="${GITEE_REPOSITORY:-hy91/hy}"
    BUNDLE_BASE="${TIKTOK_BUNDLE_BASE:-$(env_value TIKTOK_BUNDLE_BASE)}"
    BUNDLE_BASE="${BUNDLE_BASE:-https://gitee.com/$GITEE_REPOSITORY/releases/download}"
    BUNDLE_BASE="${BUNDLE_BASE%/}"
    case "$DOWNLOAD_SOURCE" in github|gitee) ;; *) die "TIKTOK_SOURCE 仅支持 github 或 gitee。" ;; esac
    [[ "$GITEE_REPOSITORY" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*/[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] || die "Gitee 仓库应为 用户名/仓库名。"
    [[ "$BUNDLE_BASE" =~ ^https://[a-zA-Z0-9][a-zA-Z0-9.:-]*(/[a-zA-Z0-9._~/%+-]*)*$ ]] || die "TIKTOK_BUNDLE_BASE 必须是无认证信息和查询参数的 HTTPS 地址。"
    USE_IMAGE_BUNDLE=0
    if [ "$DOWNLOAD_SOURCE" = gitee ] || [ -n "${TIKTOK_BUNDLE_DIR:-}" ]; then USE_IMAGE_BUNDLE=1; fi
    SAVE_DOWNLOAD_SETTINGS=0
    if [ "$DOWNLOAD_SOURCE" != github ] || [ "$GITEE_REPOSITORY" != hy91/hy ] ||
        [ "$BUNDLE_BASE" != "https://gitee.com/$GITEE_REPOSITORY/releases/download" ] ||
        [ -n "$(env_value TIKTOK_SOURCE)$(env_value TIKTOK_GITEE_REPOSITORY)$(env_value TIKTOK_BUNDLE_BASE)" ]; then
        SAVE_DOWNLOAD_SETTINGS=1
    fi
}

save_download_settings() {
    [ "$SAVE_DOWNLOAD_SETTINGS" -eq 1 ] || return 0
    set_env_value TIKTOK_SOURCE "$DOWNLOAD_SOURCE"
    set_env_value TIKTOK_GITEE_REPOSITORY "$GITEE_REPOSITORY"
    set_env_value TIKTOK_BUNDLE_BASE "$BUNDLE_BASE"
}

download_file() {
    local url="$1" target="$2" limit="${3:-90}" host attempt partial result
    host="${url#https://}"; host="${host%%/*}"
    [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ] || { printf '下载临时目录不可用。\n' >&2; return 1; }
    for attempt in 1 2 3 4; do
        partial=$(mktemp "$WORK_DIR/.download.XXXXXX") || return 1
        printf '正在下载 %s（%s，第 %s/4 次）...\n' "${target##*/}" "$host" "$attempt" >&2
        # Start each attempt from byte zero. curl 18 is not retried by older curl.
        if curl --fail --silent --show-error --location --retry 0 --connect-timeout 15 --max-time "$limit" \
            "$url" -o "$partial"; then
            if mv -f -- "$partial" "$target"; then return 0; fi
            rm -f -- "$partial"
            return 1
        else
            result=$?
        fi
        rm -f -- "$partial" || return 1
        printf '下载失败：%s（%s，第 %s/4 次，curl %s）。\n' "${target##*/}" "$host" "$attempt" "$result" >&2
        if [ "$attempt" -lt 4 ]; then sleep "$attempt"; fi
    done
    return 1
}

resolve_ref() {
    local response sha api
    configure_downloads
    [[ "$HY_REF" =~ ^[a-zA-Z0-9._/-]+$ ]] || die "无效的 Git 引用。"
    if [[ "$HY_REF" =~ ^[0-9a-f]{40}$ ]]; then
        printf '%s\n' "$HY_REF"
        return
    fi
    api="https://api.github.com/repos/$REPOSITORY/commits/$HY_REF"
    [ "$DOWNLOAD_SOURCE" != gitee ] || api="https://gitee.com/api/v5/repos/$GITEE_REPOSITORY/commits/$HY_REF"
    printf '正在从 %s 解析版本 %s...\n' "$DOWNLOAD_SOURCE" "$HY_REF" >&2
    response=$(curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 60 \
        -H 'Accept: application/json' -H 'Cache-Control: no-cache' "$api") || die "无法从 $DOWNLOAD_SOURCE 解析仓库版本，现有服务保持运行。"
    sha=$(printf '%s' "$response" | python3 -c 'import json,sys; value=json.load(sys.stdin); print(value.get("sha", "") if isinstance(value,dict) else "")') || die "仓库版本响应不是有效 JSON。"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "仓库未返回有效提交。"
    printf '%s\n' "$sha"
}

download_release() {
    local file base
    configure_downloads
    SOURCE_REF=$(resolve_ref) || die "无法确认安装版本，现有服务保持运行。"
    WORK_DIR=$(mktemp -d "$APP_DIR/.deploy.XXXXXX") || die "无法创建下载临时目录。"
    base="https://raw.githubusercontent.com/$REPOSITORY/$SOURCE_REF/apps/tiktok-knowledge"
    [ "$DOWNLOAD_SOURCE" != gitee ] || base="https://gitee.com/$GITEE_REPOSITORY/raw/$SOURCE_REF/apps/tiktok-knowledge"
    for file in compose.yaml VERSION install.sh; do
        download_file "$base/$file" "$WORK_DIR/$file" || die "下载 $file 失败，现有服务保持运行。"
    done
    RELEASE_VERSION=$(tr -d '\r\n' < "$WORK_DIR/VERSION")
    [[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][a-zA-Z0-9.-]+)?$ ]] || die "应用版本格式无效。"
    RELEASE_IMAGE="${TIKTOK_IMAGE:-ghcr.io/359073395/tiktok-knowledge:$RELEASE_VERSION}"
    [[ "$RELEASE_IMAGE" =~ ^[a-zA-Z0-9][a-zA-Z0-9._/@:-]+$ ]] || die "镜像地址格式无效。"
    [ "$(head -n 1 "$WORK_DIR/install.sh")" = '#!/usr/bin/env bash' ] && bash -n "$WORK_DIR/install.sh" ||
        die "下载内容不是有效安装脚本，现有服务保持运行。"
}

bundle_images_available() {
    local image expected_platform image_platform
    case "$(uname -m)" in
        x86_64|amd64) expected_platform=linux/amd64 ;;
        aarch64|arm64) expected_platform=linux/arm64 ;;
        *) return 1 ;;
    esac
    for image in "$RELEASE_IMAGE" postgres:17-alpine postgrest/postgrest:v16.5; do
        image_platform=$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image" 2>/dev/null) || return 1
        [ "$image_platform" = "$expected_platform" ] || return 1
    done
}

fetch_bundle_file() {
    local file="$1" target="$2" limit="${3:-90}"
    if [ -n "${TIKTOK_BUNDLE_DIR:-}" ]; then
        [ -f "$TIKTOK_BUNDLE_DIR/$file" ] && [ ! -L "$TIKTOK_BUNDLE_DIR/$file" ] || { printf '本地镜像包缺少文件：%s。\n' "$file" >&2; return 1; }
        cp "$TIKTOK_BUNDLE_DIR/$file" "$target"
    else
        download_file "$BUNDLE_BASE/tiktok-knowledge-v$RELEASE_VERSION/$file" "$target" "$limit"
    fi
}

load_image_bundle() {
    local architecture stem manifest expected file actual archive
    [ "$RELEASE_IMAGE" = "ghcr.io/359073395/tiktok-knowledge:$RELEASE_VERSION" ] || {
        printf '完整镜像包仅支持该版本的官方应用镜像，请取消自定义 TIKTOK_IMAGE。\n' >&2; return 1;
    }
    if bundle_images_available; then
        printf '该版本应用、PostgreSQL 和 PostgREST 镜像已在本机，跳过镜像包下载。\n'
        return 0
    fi
    case "$(uname -m)" in
        x86_64|amd64) architecture=amd64 ;;
        aarch64|arm64) architecture=arm64 ;;
        *) printf '完整镜像包仅支持 amd64 和 arm64。\n' >&2; return 1 ;;
    esac
    stem="tiktok-knowledge-$RELEASE_VERSION-linux-$architecture-full"
    manifest="$WORK_DIR/$stem.sha256"
    fetch_bundle_file "$stem.sha256" "$manifest" 120 || return 1
    # Accept only this version/architecture's consecutively numbered parts, never paths.
    python3 - "$manifest" "$stem" "$WORK_DIR/bundle-parts" <<'PY' || return 1
import pathlib, re, sys
try:
    manifest, stem, output = sys.argv[1:]
    if pathlib.Path(manifest).stat().st_size > 256 * 1024:
        raise ValueError('清单文件过大')
    entries = pathlib.Path(manifest).read_text(encoding='utf-8').splitlines()
    if not entries or len(entries) > 1000:
        raise ValueError('清单为空或分块数量过多')
    normalized = []
    for index, line in enumerate(entries):
        match = re.fullmatch(r'([0-9a-fA-F]{64}) [ *](' + re.escape(stem) + r'\.tar\.gz\.part-[0-9]{3})', line)
        if not match or match[2] != f'{stem}.tar.gz.part-{index:03d}':
            raise ValueError('文件名、顺序或 SHA256 格式无效')
        normalized.append(f'{match[1].lower()}\t{match[2]}\n')
    with open(output, 'w', encoding='utf-8', newline='\n') as stream:
        stream.write(''.join(normalized))
except (OSError, UnicodeError, ValueError) as error:
    print(f'完整镜像包清单无效：{error}。', file=sys.stderr)
    sys.exit(1)
PY
    archive="$WORK_DIR/$stem.tar.gz"
    : > "$archive"
    while IFS=$'\t' read -r expected file; do
        fetch_bundle_file "$file" "$WORK_DIR/$file" 1800 || return 1
        actual=$(sha256sum "$WORK_DIR/$file" | cut -d ' ' -f 1) || return 1
        [ "$actual" = "$expected" ] || { printf '镜像分块 SHA256 校验失败：%s。\n' "$file" >&2; return 1; }
        cat "$WORK_DIR/$file" >> "$archive" || return 1
        rm -f -- "$WORK_DIR/$file"
    done < "$WORK_DIR/bundle-parts"
    printf '完整镜像包校验通过，正在导入应用、PostgreSQL 和 PostgREST...\n'
    docker load --input "$archive" || return 1
    bundle_images_available || { printf '完整镜像包未包含所需版本和架构的全部三个镜像。\n' >&2; return 1; }
}

prepare_dependency_images() {
    if [ "$USE_IMAGE_BUNDLE" -eq 1 ]; then bundle_images_available
    else compose pull db rest
    fi
}

pull_application_image() {
    if [ "${USE_IMAGE_BUNDLE:-0}" -eq 1 ]; then load_image_bundle; return $?; fi
    if docker pull "$RELEASE_IMAGE"; then return 0; fi
    [ "$RELEASE_IMAGE" = "ghcr.io/359073395/tiktok-knowledge:$RELEASE_VERSION" ] || return 1
    local architecture asset release_url expected actual
    case "$(uname -m)" in
        x86_64|amd64) architecture=amd64 ;;
        aarch64|arm64) architecture=arm64 ;;
        *) printf '预构建包支持 amd64 和 arm64，请为当前架构自行构建镜像。\n' >&2; return 1 ;;
    esac
    asset="tiktok-knowledge-$RELEASE_VERSION-linux-$architecture.tar.gz"
    release_url="https://github.com/$REPOSITORY/releases/download/tiktok-knowledge-v$RELEASE_VERSION"
    printf '镜像仓库拉取失败，改从 GitHub Release 下载 %s。\n' "$asset"
    curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --max-time 120 \
        "$release_url/SHA256SUMS" -o "$WORK_DIR/SHA256SUMS" || return 1
    curl --fail --show-error --location --retry 3 --connect-timeout 15 --max-time 1800 \
        "$release_url/$asset" -o "$WORK_DIR/$asset" || return 1
    expected=$(awk -v name="$asset" '$2 == name || $2 == "*" name { print $1 }' "$WORK_DIR/SHA256SUMS")
    [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || { printf '发布包校验清单无效。\n' >&2; return 1; }
    actual=$(sha256sum "$WORK_DIR/$asset" | cut -d ' ' -f 1)
    [ "${expected,,}" = "$actual" ] || { printf '发布包 SHA256 校验失败。\n' >&2; return 1; }
    docker load --input "$WORK_DIR/$asset" || return 1
    docker image inspect "$RELEASE_IMAGE" >/dev/null 2>&1
}

create_environment() {
    [ -f "$APP_DIR/.env" ] && return
    local port="${APP_PORT:-8791}" origin="${SITE_URL:-}" password token
    [[ "$port" =~ ^[0-9]{1,5}$ ]] && ((10#$port >= 1 && 10#$port <= 65535)) || die "APP_PORT 应为 1 到 65535。"
    if [ -n "$origin" ]; then validate_origin "$origin" || die "SITE_URL 必须是 http(s) 访问地址。"; fi
    password=$(openssl rand -hex 32)
    token=$(openssl rand -hex 24)
    cat > "$APP_DIR/.env" <<EOF
POSTGRES_PASSWORD=$password
ADMIN_TOKEN=$token
APP_PORT=$port
APP_BIND=0.0.0.0
SITE_URL=$origin
TIKTOK_IMAGE=$RELEASE_IMAGE
EOF
    chmod 600 "$APP_DIR/.env"
    FIRST_INSTALL=1
}

admin_cli() {
    compose exec -T -w /app app node deploy/admin-account.cjs
}

admin_status() {
    printf '{"action":"status"}\n' | admin_cli
}

show_access() {
    local origin address
    origin=$(env_value SITE_URL)
    if [ -z "$origin" ]; then
        address=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
        address=${address:-127.0.0.1}
        [[ "$address" != *:* ]] || address="[$address]"
        origin="http://$address:$(env_value APP_PORT)"
    fi
    printf '网站地址 %s\n后台登录 %s/admin/login\n' "$origin" "$origin"
}

load_admin_setup_file() {
    ADMIN_PAYLOAD=$(python3 - "$ADMIN_SETUP_FILE" <<'PY'
import json
import os
import stat
import sys

try:
    file = sys.argv[1]
    info = os.lstat(file)
    if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError('管理员设置文件必须为权限600的普通文件')
    if info.st_size > 16384:
        raise ValueError('管理员设置文件过大')
    with open(file, encoding='utf-8') as stream:
        data = json.load(stream)
    if not isinstance(data, dict) or data.get('action') not in ('create', 'reset'):
        raise ValueError('管理员设置文件需要create或reset操作')
    print(json.dumps(data, ensure_ascii=False))
except (OSError, ValueError) as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
PY
    )
}

prompt_admin_credentials() {
    local action="$1" user_id="${2:-}" default_username="${3:-admin}" username password repeated
    while true; do
        read -r -p "超级管理员用户名 [${default_username:-admin}]: " username || return 1
        username=${username:-${default_username:-admin}}
        username=${username,,}
        if [[ "$username" =~ ^[a-z0-9_.-]{3,64}$ ]]; then break; fi
        printf '用户名需要3到64个字母、数字、下划线、点或短横线。\n'
    done
    while true; do
        IFS= read -r -s -p "设置登录密码（8到128个字符）: " password || return 1
        printf '\n'
        IFS= read -r -s -p "再次输入密码: " repeated || return 1
        printf '\n'
        if [ "${#password}" -ge 8 ] && [ "${#password}" -le 128 ] && [ "$password" = "$repeated" ]; then break; fi
        printf '密码长度不符或两次输入不同，请重新输入。\n'
    done
    ADMIN_PAYLOAD=$(printf '%s\0%s\0%s\0%s' "$action" "$user_id" "$username" "$password" | python3 -c '
import json, sys
action, user_id, username, password = sys.stdin.buffer.read().decode("utf-8").split("\0")
payload = {"action": action, "username": username, "password": password}
if user_id:
    payload["userId"] = user_id
print(json.dumps(payload, ensure_ascii=False))
')
    password="" repeated=""
}

apply_admin_payload() {
    local result
    if ! result=$(printf '%s\n' "$ADMIN_PAYLOAD" | admin_cli); then
        ADMIN_PAYLOAD=""
        printf '管理员账号设置失败，请使用菜单4重新设置。\n' >&2
        return 1
    fi
    ADMIN_PAYLOAD=""
    printf '%s' "$result" | python3 -c 'import json,sys; data=json.load(sys.stdin); print("超级管理员用户名 " + data["user"]["username"])'
    printf '请使用刚设置的密码登录后台。\n'
    show_access
}

ensure_admin_account() {
    local status configured
    status=$(admin_status) || { printf '管理员状态读取失败，请使用菜单4重试。\n' >&2; return 1; }
    configured=$(printf '%s' "$status" | python3 -c 'import json,sys; print("yes" if json.load(sys.stdin)["hasPasswordAdmin"] else "no")' 2>/dev/null) || {
        printf '管理员状态响应无效，请使用菜单4重试。\n' >&2
        return 1
    }
    if [ "$configured" = yes ]; then ADMIN_PAYLOAD=""; return 0; fi
    if [ -n "${ADMIN_SETUP_FILE:-}" ]; then
        load_admin_setup_file || return 1
        printf '%s' "$ADMIN_PAYLOAD" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("action") == "create" else 1)' || {
            ADMIN_PAYLOAD=""
            printf '安装及更新的管理员设置文件需要使用create操作。\n' >&2
            return 1
        }
    elif [ -z "$ADMIN_PAYLOAD" ] && [ -t 0 ]; then
        printf '设置账号密码登录，接下来新增一个网站超级管理员。\n'
        prompt_admin_credentials create || { ADMIN_PAYLOAD=""; return 1; }
    fi
    if [ -z "$ADMIN_PAYLOAD" ]; then
        printf '请运行 bash %s/install.sh --admin-account 设置后台用户名和密码。\n' "$APP_DIR"
        return 0
    fi
    apply_admin_payload
}

manage_admin_account() {
    [ -f "$APP_DIR/compose.yaml" ] && [ -f "$APP_DIR/.env" ] || die "请先安装应用。"
    command -v python3 >/dev/null || die "账号管理需要 Python 3，请先安装 python3。"
    local status choice count selected user_id username
    status=$(admin_status) || die "请先选择2更新应用，然后设置后台账号。"
    if [ -n "${ADMIN_SETUP_FILE:-}" ]; then
        load_admin_setup_file || return 1
        apply_admin_payload
        return
    fi
    [ -t 0 ] || die "请在SSH交互终端运行账号管理，或使用ADMIN_SETUP_FILE指定权限600的JSON文件。"
    printf '%s' "$status" | python3 -c '
import json,sys
for index,user in enumerate(json.load(sys.stdin)["admins"], 1):
    label = user.get("username") or "尚未设置用户名"
    state = "，已停用" if user.get("status") == "disabled" else ""
    print(str(index) + ". " + user["name"] + "（" + label + state + "）")
'
    count=$(printf '%s' "$status" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["admins"]))')
    printf '0. 新增超级管理员\n'
    read -r -p "选择要设置或重置的管理员，回车新增 [0]: " choice || return 1
    choice=${choice:-0}
    [[ "$choice" =~ ^[0-9]{1,6}$ ]] && ((10#$choice <= count)) || { printf '管理员选择无效。\n' >&2; return 1; }
    if ((10#$choice == 0)); then
        prompt_admin_credentials create || return 1
    else
        selected=$(printf '%s' "$status" | python3 -c 'import json,sys; user=json.load(sys.stdin)["admins"][int(sys.argv[1])-1]; print(user["id"] + "\t" + (user.get("username") or "admin"))' "$((10#$choice))")
        IFS=$'\t' read -r user_id username <<< "$selected"
        prompt_admin_credentials reset "$user_id" "$username" || return 1
    fi
    apply_admin_payload
}

wait_healthy() {
    local attempt port
    port=$(env_value APP_PORT)
    for attempt in $(seq 1 90); do
        if curl --fail --silent --show-error --max-time 4 "http://127.0.0.1:${port:-8791}/api/health" >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done
    return 1
}

wait_database() {
    local attempt
    for attempt in $(seq 1 30); do
        if compose exec -T db pg_isready -h 127.0.0.1 -U knowledge -d knowledge >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done
    return 1
}

save_update_backup() {
    # An uninstall keeps data but removes containers. Restart the database for its dump.
    if [ "${USE_IMAGE_BUNDLE:-0}" -eq 1 ]; then
        compose up -d --no-build --no-recreate --pull never db || die "无法启动现有数据库进行备份。"
    else
        compose up -d --no-build --no-recreate db || die "无法启动现有数据库进行备份。"
    fi
    wait_database || die "数据库尚未就绪，更新已停止。"
    mkdir -p "$WORK_DIR/backup"
    cp "$APP_DIR/.env" "$WORK_DIR/backup/.env"
    cp "$APP_DIR/compose.yaml" "$WORK_DIR/backup/compose.yaml"
    [ ! -f "$APP_DIR/VERSION" ] || cp "$APP_DIR/VERSION" "$WORK_DIR/backup/VERSION"
    [ ! -f "$APP_DIR/SOURCE_REF" ] || cp "$APP_DIR/SOURCE_REF" "$WORK_DIR/backup/SOURCE_REF"
    if ! compose exec -T db pg_dump -U knowledge -d knowledge --format=custom > "$WORK_DIR/backup/database.dump"; then
        die "更新前数据库备份失败，请先恢复数据库服务。"
    fi
    [ -s "$WORK_DIR/backup/database.dump" ] || die "数据库备份为空，更新已停止。"
    mkdir -p "$APP_DIR/backups"
    # Keep the previous valid backup until the new dump is complete.
    rm -rf -- "$APP_DIR/backups/latest-pre-update.previous"
    if [ -d "$APP_DIR/backups/latest-pre-update" ]; then
        mv "$APP_DIR/backups/latest-pre-update" "$APP_DIR/backups/latest-pre-update.previous"
    fi
    mv "$WORK_DIR/backup" "$APP_DIR/backups/latest-pre-update"
    rm -rf -- "$APP_DIR/backups/latest-pre-update.previous"
}

rollback_application() {
    local previous_image="$1" backup="$APP_DIR/backups/latest-pre-update"
    cp "$backup/.env" "$APP_DIR/.env"
    cp "$backup/compose.yaml" "$APP_DIR/compose.yaml"
    [ ! -f "$backup/VERSION" ] || cp "$backup/VERSION" "$APP_DIR/VERSION"
    [ ! -f "$backup/SOURCE_REF" ] || cp "$backup/SOURCE_REF" "$APP_DIR/SOURCE_REF"
    [ -z "$previous_image" ] || set_env_value TIKTOK_IMAGE "$previous_image"
    compose up -d --no-build --pull never && wait_healthy
}

deploy() {
    local updating=0 previous_image=""
    FIRST_INSTALL=0
    validate_install_paths
    configure_downloads
    if [ -f "$APP_DIR/compose.yaml" ] && [ -f "$APP_DIR/.env" ]; then updating=1; fi
    if [ "$ACTION" = --update ] && [ "$updating" -eq 0 ]; then die "尚未安装，请先选择安装。"; fi
    download_release
    # Pull the new image before changing any installed configuration.
    pull_application_image || die "获取 $RELEASE_VERSION 发布镜像失败，请检查上方下载源、完整镜像包或镜像仓库错误。本次未修改现有配置和数据。"
    command -v python3 >/dev/null || die "账号管理需要 Python 3，请先安装 python3。"
    if [ "$updating" -eq 0 ] && [ -t 0 ] && [ -z "${ADMIN_SETUP_FILE:-}" ]; then
        printf '请设置网站超级管理员的用户名和密码。\n'
        prompt_admin_credentials create || die "已取消安装。"
    fi
    if [ "$updating" -eq 1 ]; then
        previous_image=$(docker inspect --format '{{.Image}}' tiktok-knowledge 2>/dev/null || true)
        save_update_backup
    fi
    create_environment
    set_env_value TIKTOK_IMAGE "$RELEASE_IMAGE"
    cp "$WORK_DIR/compose.yaml" "$APP_DIR/compose.yaml"
    mkdir -p "$APP_DIR/data" "$APP_DIR/postgres"
    chown 1001:1001 "$APP_DIR/data"
    chmod 750 "$APP_DIR/data"
    if compose config --quiet && prepare_dependency_images && compose up -d --no-build --pull never && wait_healthy; then
        save_download_settings
        cp "$WORK_DIR/VERSION" "$APP_DIR/VERSION"
        printf '%s\n' "$SOURCE_REF" > "$APP_DIR/SOURCE_REF"
        install -m 700 "$WORK_DIR/install.sh" "$APP_DIR/install.sh"
        printf 'TikTok 知识系统 %s 已启动，访问端口 %s。\n' "$RELEASE_VERSION" "$(env_value APP_PORT)"
        show_access
        ensure_admin_account || printf '应用已启动。请使用菜单4完成管理员账号设置。\n' >&2
        printf '域名访问请使用应用菜单中的“5. 添加域名访问”。\n'
        return
    fi
    compose logs --tail 60 app >&2 || true
    if [ "$updating" -eq 1 ]; then
        if rollback_application "$previous_image"; then
            die "新版本健康检查失败，已恢复旧应用。更新前数据库备份位于 $APP_DIR/backups/latest-pre-update。"
        fi
        die "更新失败且旧应用未恢复健康，请检查日志。配置和数据库备份位于 $APP_DIR/backups/latest-pre-update。"
    fi
    die "应用未通过健康检查。配置和数据已保留，修复后可重新选择安装。"
}

set_origin() {
    [ -f "$APP_DIR/compose.yaml" ] && [ -f "$APP_DIR/.env" ] || die "请先安装应用。"
    local origin="$1" previous
    if [ -n "$origin" ]; then validate_origin "$origin" || die "域名地址格式无效。"; fi
    previous=$(env_value SITE_URL)
    set_env_value SITE_URL "$origin"
    if compose up -d --no-deps --no-build app && wait_healthy; then
        printf '访问地址配置已更新。\n'
        show_access
        return
    fi
    set_env_value SITE_URL "$previous"
    compose up -d --no-deps --no-build app || true
    die "域名配置生效失败，已恢复原访问地址设置。"
}

extract_backup() {
    python3 - "$1" "$WORK_DIR/restore" "$(cat "$APP_DIR/VERSION")" <<'PY'
import hashlib
import json
import pathlib
import re
import shutil
import sys
import tarfile

archive, output, installed_version = sys.argv[1:]
destination = pathlib.Path(output)

def require(condition, message):
    if not condition:
        raise ValueError(message)

def safe_name(name):
    while name.startswith('./'):
        name = name[2:]
    require('\\' not in name and not name.startswith('/'), '备份包含无效路径')
    parts = name.rstrip('/').split('/')
    require(all(part not in ('', '.', '..') for part in parts), '备份包含不安全路径')
    return '/'.join(parts)

def version_numbers(value):
    match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)(?:[.-][A-Za-z0-9.-]+)?', value)
    require(match is not None, '备份中的应用版本无效')
    return tuple(int(part) for part in match.groups())

try:
    with tarfile.open(archive, 'r:gz') as bundle:
        members = {}
        for member in bundle.getmembers():
            if member.isdir() and member.name in ('.', './'):
                continue
            name = safe_name(member.name)
            require(member.isfile() or member.isdir(), '备份包含链接或特殊文件')
            require(name in ('manifest.json', 'database.dump', 'data') or name.startswith('data/'), '备份包含未知文件')
            require(name not in members, '备份包含重复路径')
            members[name] = member
        require(all(name in members and members[name].isfile() for name in ('manifest.json', 'database.dump')), '备份缺少清单或数据库')
        require(members['manifest.json'].size <= 32 * 1024 * 1024, '备份清单过大')
        manifest = json.load(bundle.extractfile(members['manifest.json']))
        require(manifest['format'] == 'tiktok-knowledge-backup' and manifest['version'] == 1, '不支持此备份格式')
        require(manifest['postgresMajor'] == 17, '备份需要 PostgreSQL 17')
        require(version_numbers(manifest['appVersion']) <= version_numbers(installed_version), '请先升级应用，再恢复更新版本的备份')
        database = manifest['database']
        require(database['file'] == 'database.dump' and database['format'] == 'custom', '数据库格式无效')
        expected = {'database.dump': database}
        for entry in manifest['files']:
            name = safe_name(entry['path'])
            require(name.startswith('data/') and name not in expected, '素材清单路径无效或重复')
            expected[name] = entry
        actual = {name for name, member in members.items() if member.isfile() and name != 'manifest.json'}
        require(actual == set(expected), '备份文件与清单不一致')
        require(manifest['data']['directory'] == 'data', '素材目录无效')
        require(manifest['data']['files'] == len(expected) - 1, '素材数量不一致')
        require(manifest['data']['bytes'] == sum(entry['bytes'] for name, entry in expected.items() if name != 'database.dump'), '素材总大小不一致')
        for name, entry in expected.items():
            require(type(entry['bytes']) is int and entry['bytes'] >= 0 and entry['bytes'] == members[name].size, '备份文件大小不一致')
            require(re.fullmatch(r'[a-fA-F0-9]{64}', entry['sha256']) is not None, '备份校验值无效')
        required_space = sum(member.size for member in members.values())
        require(shutil.disk_usage(destination.parent).free > required_space, '磁盘空间不足，无法解压备份')
        destination.mkdir(mode=0o700)
        (destination / 'data').mkdir(mode=0o700)
        for name, member in members.items():
            target = destination / name
            if member.isdir():
                target.mkdir(mode=0o700, parents=True, exist_ok=True)
                continue
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            digest = hashlib.sha256()
            with bundle.extractfile(member) as source, target.open('wb') as result:
                while chunk := source.read(1024 * 1024):
                    digest.update(chunk)
                    result.write(chunk)
            if name in expected:
                require(digest.hexdigest() == expected[name]['sha256'].lower(), '备份文件 SHA256 校验失败')
        with (destination / 'database.dump').open('rb') as database_file:
            require(database_file.read(5) == b'PGDMP', '数据库不是 PostgreSQL custom 归档')
except (OSError, ValueError, KeyError, TypeError, tarfile.TarError) as error:
    print(f'备份验证失败，{error}', file=sys.stderr)
    sys.exit(1)
PY
}

restore_database() {
    compose exec -T db dropdb --force --if-exists -U knowledge knowledge &&
        compose exec -T db createdb -U knowledge knowledge &&
        compose exec -T db pg_restore -U knowledge -d knowledge --clean --if-exists --no-owner --no-acl --exit-on-error --single-transaction < "$1"
}

rollback_restore() {
    local backup="$1"
    compose stop app rest || return 1
    restore_database "$backup/database.dump" || return 1
    rm -rf -- "$APP_DIR/data"
    cp -a "$backup/data" "$APP_DIR/data" || return 1
    compose up -d --no-build --pull never rest app && wait_healthy
}

restore_backup() {
    local archive="$1" backup="$APP_DIR/backups/latest-pre-restore" candidate
    [ -f "$APP_DIR/.env" ] && [ -f "$APP_DIR/compose.yaml" ] && [ -f "$APP_DIR/VERSION" ] || die "请先安装应用后再恢复备份。"
    [ -f "$archive" ] || die "备份文件不存在。"
    command -v python3 >/dev/null || die "恢复备份需要 Python 3，请先安装 python3。"
    validate_install_paths
    WORK_DIR=$(mktemp -d "$APP_DIR/.deploy.XXXXXX")
    extract_backup "$archive" || die "备份校验未通过。"
    compose up -d --no-build db || die "数据库启动失败。"
    wait_database || die "数据库尚未就绪，恢复已停止。"
    compose exec -T db pg_restore --list < "$WORK_DIR/restore/database.dump" >/dev/null || die "数据库归档校验失败。"
    RESTORE_RESUME=1
    compose stop app rest || die "无法进入恢复维护状态。"
    candidate="$WORK_DIR/pre-restore"
    mkdir -p "$candidate"
    if ! compose exec -T db pg_dump -U knowledge -d knowledge --format=custom --no-owner --no-acl > "$candidate/database.dump" ||
        [ ! -s "$candidate/database.dump" ] ||
        ! cp -a "$APP_DIR/data" "$candidate/data" ||
        ! cp "$APP_DIR/.env" "$APP_DIR/compose.yaml" "$APP_DIR/VERSION" "$candidate/"; then
        die "恢复前备份失败，已停止恢复。"
    fi
    mkdir -p "$APP_DIR/backups"
    rm -rf -- "$backup.previous"
    [ ! -d "$backup" ] || mv "$backup" "$backup.previous"
    mv "$candidate" "$backup"
    rm -rf -- "$backup.previous"
    RESTORE_BACKUP="$backup"
    RESTORE_RESUME=0
    if restore_database "$WORK_DIR/restore/database.dump" &&
        rm -rf -- "$APP_DIR/data" && mv "$WORK_DIR/restore/data" "$APP_DIR/data" &&
        chown -R 1001:1001 "$APP_DIR/data" && chmod 750 "$APP_DIR/data" &&
        compose up -d --no-build --pull never rest app && wait_healthy; then
        RESTORE_BACKUP=""
        printf '完整备份已恢复，服务器端口和域名配置已保留。恢复前数据位于 %s。\n' "$backup"
        return
    fi
    RESTORE_BACKUP=""
    if rollback_restore "$backup"; then
        die "恢复失败，已回滚到恢复前的数据。恢复前备份位于 $backup。"
    fi
    die "恢复失败且自动回滚未完成，请使用 $backup 中的数据库和素材恢复。"
}

main() {
    ACTION="${1:---install}"
    [ "$#" -eq 0 ] || shift
    local origin="" archive=""
    if [ "$ACTION" = --set-domain ]; then
        [ "$#" -gt 0 ] || die "用法：--set-domain https://你的域名"
        origin="$1"; shift
    fi
    if [ "$ACTION" = --restore ]; then
        [ "$#" -gt 0 ] || die "用法：--restore /path/tiktok-knowledge-backup.tar.gz"
        archive="$1"; shift
    fi
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --ref) [ "$#" -ge 2 ] || die "--ref 缺少参数"; HY_REF="$2"; shift 2 ;;
            *) die "未知参数：$1" ;;
        esac
    done
    case "$ACTION" in
        --install|--update|--uninstall|--status|--logs|--set-domain|--clear-domain|--restore|--admin-account|--admin-status) ;;
        *) die "支持 --install、--update、--uninstall、--status、--logs、--set-domain、--clear-domain、--restore、--admin-account、--admin-status，可追加 --ref 提交SHA。" ;;
    esac
    require_runtime
    case "$ACTION" in
        --install|--update) deploy ;;
        --restore) restore_backup "$archive" ;;
        --admin-account) manage_admin_account ;;
        --admin-status) admin_status ;;
        --set-domain) set_origin "$origin" ;;
        --clear-domain) set_origin '' ;;
        --status) [ -f "$APP_DIR/compose.yaml" ] || die "尚未安装。"; compose ps ;;
        --logs) [ -f "$APP_DIR/compose.yaml" ] || die "尚未安装。"; flock -u 9; compose logs --tail 100 -f app ;;
        --uninstall)
            [ -f "$APP_DIR/compose.yaml" ] || die "尚未安装。"
            compose down
            printf '应用容器已卸载。人员、知识、考试、素材和配置保留在 %s，重新安装可恢复。\n' "$APP_DIR"
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
