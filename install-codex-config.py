"""Narrow DeltaRoute TOML edits. Does not change unrelated server/policy tables."""
import argparse
import json
import os
import pathlib
import re
try:
    import tomllib
except ImportError:
    raise SystemExit('Python 3.11 or newer is required for the Codex TOML installer.')


def configure(node, config_path, context_start=None, check=False, managed_heads=False):
    root = pathlib.Path(__file__).resolve().parent
    config_path = pathlib.Path(config_path)
    text = config_path.read_text(encoding='utf-8-sig') if config_path.exists() else ''
    cfg = tomllib.loads(text)
    expected = {'deltaroute': (node, str(root / 'server.mjs'))}
    if context_start:
        expected['deltaroute-context'] = (node, str(pathlib.Path(context_start).resolve()))
    servers = cfg.get('mcp_servers', {})
    normalize = lambda value: os.path.normcase(os.path.abspath(value))
    for name, (command, script) in expected.items():
        found = servers.get(name)
        if found and (not isinstance(found.get('command'), str) or normalize(found['command']) != normalize(command)
                      or not found.get('args') or normalize(found['args'][0]) != normalize(script)):
            raise SystemExit('A different server already uses ' + name + '; preserving it.')
    if check:
        return json.dumps({name: bool(servers.get(name)) for name in ['deltaroute', 'deltaroute-context']})
    allowed_tools = {
        'deltaroute': ['list_workers', 'recommend_route', 'submit_task', 'get_task', 'cancel_task'],
        'deltaroute-context': ['ctx_execute', 'ctx_execute_file', 'ctx_batch_execute', 'ctx_index', 'ctx_search', 'ctx_stats', 'ctx_doctor'],
    }
    for name in expected:
        if name not in servers:
            continue
        server = servers[name]
        key = '(?:' + re.escape(name) + '|"' + re.escape(name) + '")'
        pattern = re.compile(r'(?ms)^\[mcp_servers\.' + key + r'\][ \t]*\r?\n(.*?)(?=^\[|\Z)')
        match = pattern.search(text)
        if not match:
            raise SystemExit('Cannot safely locate server section ' + name + '.')
        body = match.group(1)
        previous = server.get('enabled_tools')
        if previous is not None and not isinstance(previous, list):
            raise SystemExit('Invalid enabled_tools value for ' + name + '; preserving configuration.')
        restricted = [tool for tool in allowed_tools[name] if previous is None or tool in previous]
        if previous is not None:
            body, count = re.subn(r'(?ms)^enabled_tools\s*=\s*\[.*?\][ \t]*(?:#[^\n]*)?\r?\n',
                                 lambda _: 'enabled_tools = ' + json.dumps(restricted) + '\n', body, count=1)
            if count != 1:
                raise SystemExit('Cannot safely narrow enabled_tools for ' + name + '.')
        settings = {'enabled_tools': json.dumps(restricted), 'startup_timeout_sec': '30', 'tool_timeout_sec': '60',
                    'default_tools_approval_mode': '"prompt"'}
        for setting, value in settings.items():
            if setting not in server:
                body += setting + ' = ' + value + '\n'
        text = text[:match.start(1)] + body + '\n' + text[match.end(1):]
        # Retain server-wide deny, enabled=false, disabled_tools, every existing
        # per-tool decision and a narrower enabled_tools list.
        if server.get('default_tools_approval_mode') == 'deny' or server.get('enabled') is False:
            continue
        read_tools = ['list_workers', 'recommend_route', 'get_task'] if name == 'deltaroute' else ['ctx_stats', 'ctx_doctor']
        if name == 'deltaroute' and managed_heads:
            read_tools += ['submit_task', 'cancel_task']
        for tool in read_tools:
            if tool in restricted and tool not in server.get('disabled_tools', []) and tool not in server.get('tools', {}):
                text += '\n[mcp_servers.' + name + '.tools.' + tool + ']\napproval_mode = "approve"\n'
    tomllib.loads(text)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(text, encoding='utf-8')
    return 'DeltaRoute tool scope configured; existing deny and approval policies preserved.'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('node')
    default_home = pathlib.Path(os.environ.get('CODEX_HOME', pathlib.Path.home() / '.codex'))
    parser.add_argument('--config-path', default=str(default_home / 'config.toml'))
    parser.add_argument('--context-start')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--managed-heads', action='store_true', help='Explicitly allow submit/cancel only where not already restricted.')
    args = parser.parse_args()
    print(configure(args.node, args.config_path, args.context_start, args.check, args.managed_heads))
