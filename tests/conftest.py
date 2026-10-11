from pathlib import Path
import pytest

from tests.gltest_windows_compat import install_windows_direct_compatibility

CONTRACT_PATH = Path(__file__).resolve().parents[1] / "contracts" / "task_route.py"
LOCAL_TEST_RUNNER = "1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6"
install_windows_direct_compatibility()


@pytest.fixture
def contract(direct_vm, direct_deploy, direct_alice, tmp_path):
    direct_vm.sender = direct_alice
    direct_vm.warp("2026-10-07T12:00:00Z")
    # The local v0.2.16 cache contains this runner; Studio Next uses the
    # concrete runner pinned in the production contract source.
    source = CONTRACT_PATH.read_text(encoding="utf-8")
    test_source = source.replace("5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng", LOCAL_TEST_RUNNER, 1)
    test_source = test_source.replace(
        "import genlayer as gl\nfrom genlayer.storage import DynArray, TreeMap\nfrom genlayer.types import u256",
        "from genlayer import *",
        1,
    ).replace("class TaskRoute(gl.contract.Contract):", "class TaskRoute(gl.Contract):", 1)
    test_path = tmp_path / "task_route_direct.py"
    test_path.write_text(test_source, encoding="utf-8")
    return direct_deploy(str(test_path), 4, sdk_version="v0.2.16")
