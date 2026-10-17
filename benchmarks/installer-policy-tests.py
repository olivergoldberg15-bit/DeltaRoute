"""Isolated installer policy fixtures; never touches the real user config."""
import contextlib, io, os, pathlib, sys, tempfile, tomllib, unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
HELPER=ROOT/'install-codex-config.py'
class InstallerTests(unittest.TestCase):
    def run_config(self,body,managed=False):
        with tempfile.TemporaryDirectory(prefix='deltaroute-installer-',dir=os.environ.get('DELTAROUTE_TEST_TMP')) as tmp:
            home=pathlib.Path(tmp);config=home/'.codex/config.toml';config.parent.mkdir();config.write_text(body,encoding='utf-8')
            with patch.object(pathlib.Path,'home',return_value=home),patch.object(sys,'argv',[str(HELPER),'node','--config-path',str(config)]+(['--managed-heads'] if managed else [])),contextlib.redirect_stdout(io.StringIO()):
                exec(compile(HELPER.read_text(),str(HELPER),'exec'),{'__file__':str(HELPER),'__name__':'__main__'})
            return tomllib.loads(config.read_text())
    def section(self,tools):
        import json
        return '[mcp_servers.deltaroute]\ncommand="node"\nargs=['+json.dumps(str(ROOT/'server.mjs'))+']\nenabled_tools='+json.dumps(tools)+'\ndisabled_tools=["submit_task"]\ndefault_tools_approval_mode="deny"\n[mcp_servers.deltaroute.tools.get_task]\napproval_mode="deny"\n'
    def test_narrows_broad_tool_list_and_preserves_denies(self):
        c=self.run_config(self.section(['recommend_route','get_task','submit_task','unwanted']))['mcp_servers']['deltaroute']
        self.assertEqual(c['enabled_tools'],['recommend_route','submit_task','get_task']);self.assertEqual(c['disabled_tools'],['submit_task']);self.assertEqual(c['default_tools_approval_mode'],'deny');self.assertEqual(c['tools']['get_task']['approval_mode'],'deny')
    def test_restricted_surface_is_not_broadened(self):
        self.assertEqual(self.run_config(self.section(['get_task']))['mcp_servers']['deltaroute']['enabled_tools'],['get_task'])
    def test_different_existing_server_is_rejected(self):
        with self.assertRaisesRegex(SystemExit,'different server'):
            self.run_config('[mcp_servers.deltaroute]\ncommand="another"\nargs=["elsewhere"]\n')
    def test_managed_heads_allow_only_available_router_tools(self):
        body=self.section(['list_workers','recommend_route','get_task','submit_task','cancel_task']).replace('default_tools_approval_mode="deny"','default_tools_approval_mode="prompt"').replace('disabled_tools=["submit_task"]','disabled_tools=[]')
        c=self.run_config(body,managed=True)['mcp_servers']['deltaroute']
        self.assertEqual(c['tools']['submit_task']['approval_mode'],'approve')
        self.assertEqual(c['tools']['cancel_task']['approval_mode'],'approve')
        self.assertEqual(c['tools']['get_task']['approval_mode'],'deny')
    def test_managed_heads_preserve_explicit_restrictions(self):
        c=self.run_config(self.section(['get_task','submit_task','cancel_task']),managed=True)['mcp_servers']['deltaroute']
        self.assertNotIn('submit_task',c['tools']);self.assertNotIn('cancel_task',c['tools'])
if __name__=='__main__':unittest.main()
