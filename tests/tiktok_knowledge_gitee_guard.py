#!/usr/bin/env python3
"""Deny installer calls that would fetch GitHub files or pull registry images."""
import os
import pathlib
import sys
from urllib.parse import urlsplit


def check(tool, args):
    if tool == 'curl':
        for value in args:
            if value == '--config' or value.startswith(('-K', '--config=')):
                raise ValueError('curl configuration files are not permitted in this test')
            if value.startswith('--url='):
                value = value[len('--url='):]
            if value.lower().startswith(('https://', 'http://')):
                host = (urlsplit(value).hostname or '').lower()
                forbidden = ('github.com', 'githubusercontent.com', 'ghcr.io', 'docker.io', 'docker.com')
                if any(host == suffix or host.endswith('.' + suffix) for suffix in forbidden):
                    raise ValueError('GitHub and registry download URLs are blocked')
    elif tool == 'docker':
        if 'pull' in args or 'build' in args or 'buildx' in args:
            raise ValueError('Registry pulls and builds are blocked')
        if args and args[0] == 'compose' and any(value in args for value in ('up', 'run', 'create')):
            never = '--pull=never' in args or any(
                value == '--pull' and args[index + 1:index + 2] == ['never']
                for index, value in enumerate(args)
            )
            if not never:
                raise ValueError('Compose startup must explicitly use --pull never')
    else:
        raise ValueError('Unknown guarded command')


def self_test():
    allowed = [
        ('curl', ['-fsSL', 'https://gitee.com/hy91/hy/raw/main/apps/tiktok-knowledge/VERSION']),
        ('curl', ['--fail', 'http://127.0.0.1:8791/api/health']),
        ('docker', ['compose', '--project-name', 'test', 'up', '-d', '--pull', 'never']),
        ('docker', ['compose', 'up', '--pull=never', 'db']),
        ('docker', ['compose', 'exec', '-T', 'db', 'pg_dump']),
        ('docker', ['load', '--input', '/tmp/images.tar.gz']),
    ]
    denied = [
        ('curl', ['https://raw.githubusercontent.com/owner/repo/main/file']),
        ('curl', ['https://api.github.com/repos/owner/repo']),
        ('curl', ['--url', 'https://github.com/owner/repo/releases/download/file']),
        ('curl', ['https://ghcr.io/v2/']),
        ('curl', ['--url=https://github.com/owner/repo']),
        ('curl', ['HTTPS://API.GITHUB.COM/repos/owner/repo']),
        ('curl', ['--config', '/tmp/curlrc']),
        ('curl', ['-K/tmp/curlrc']),
        ('docker', ['pull', 'postgres:17-alpine']),
        ('docker', ['image', 'pull', 'postgres:17-alpine']),
        ('docker', ['compose', '--env-file', '/tmp/.env', 'pull', 'db', 'rest']),
        ('docker', ['compose', 'up', '-d']),
        ('docker', ['compose', 'up', '--pull', 'always']),
        ('docker', ['build', '.']),
    ]
    for tool, args in allowed:
        check(tool, args)
    for tool, args in denied:
        try:
            check(tool, args)
        except ValueError:
            continue
        raise AssertionError(f'Guard accepted a prohibited {tool} call')
    print(f'PASS {len(allowed) + len(denied)} network guard cases')


def main():
    if sys.argv[1:] == ['--self-test']:
        self_test()
        return
    tool, *args = sys.argv[1:]
    log = pathlib.Path(os.environ['TIKTOK_GUARD_LOG'])
    try:
        check(tool, args)
    except ValueError as error:
        with log.open('a', encoding='utf-8') as stream:
            stream.write(f'blocked\t{tool}\t{error}\n')
        print(f'NETWORK GUARD: {error}', file=sys.stderr)
        raise SystemExit(97)
    # Record only commands/URL paths, never authentication headers or exec payloads.
    if tool == 'curl':
        urls = [value.removeprefix('--url=') for value in args]
        labels = [urlsplit(value).netloc + urlsplit(value).path for value in urls if value.lower().startswith(('https://', 'http://'))]
        event = 'curl\t' + '\t'.join(labels)
    else:
        event = 'docker\t' + next((value for value in ('load', 'up', 'exec', 'inspect', 'info', 'version', 'config') if value in args), 'other')
    with log.open('a', encoding='utf-8') as stream:
        stream.write(event + '\n')
    binary = os.environ['TIKTOK_REAL_' + tool.upper()]
    os.execv(binary, [binary, *args])


if __name__ == '__main__':
    main()
