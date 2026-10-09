"""Windows compatibility patches for genlayer-test 0.29.2."""

from __future__ import annotations

import os
import sys
import tempfile


def install_windows_direct_compatibility() -> None:
    if sys.platform != "win32":
        return

    from gltest.direct import loader
    from gltest.direct.vm import VMContext

    if getattr(loader, "_contract_test_windows_compat", False):
        return

    def inject_message_to_fd0(vm):
        try:
            from genlayer.py import calldata
            from genlayer.py.types import Address
        except ImportError:
            return

        sender = Address(vm.sender) if isinstance(vm.sender, bytes) else vm.sender
        contract_address = (
            Address(vm._contract_address)
            if isinstance(vm._contract_address, bytes)
            else vm._contract_address
        )
        origin = Address(vm.origin) if isinstance(vm.origin, bytes) else vm.origin
        encoded = calldata.encode(
            {
                "contract_address": contract_address,
                "sender_address": sender,
                "origin_address": origin,
                "stack": [],
                "value": vm._value,
                "datetime": vm._datetime,
                "is_init": False,
                "chain_id": vm._chain_id,
                "entry_kind": 0,
                "entry_data": b"",
                "entry_stage_data": None,
            }
        )

        fd, path = tempfile.mkstemp()
        try:
            os.write(fd, encoded)
            os.lseek(fd, 0, os.SEEK_SET)
            vm._original_stdin_fd = os.dup(0)
            os.dup2(fd, 0)
            vm._contract_test_stdin_path = path
        finally:
            os.close(fd)

    original_cleanup = VMContext._cleanup_after_deactivate
    original_refresh = VMContext._refresh_gl_message

    def refresh_gl_message(vm):
        original_refresh(vm)
        gl_module = sys.modules.get("genlayer.gl")
        if gl_module is not None and getattr(
            gl_module,
            "message_raw",
            None,
        ) is not None:
            gl_module.message_raw["datetime"] = vm._datetime

    def cleanup_after_deactivate(vm):
        path = getattr(vm, "_contract_test_stdin_path", None)
        try:
            original_cleanup(vm)
        finally:
            if path:
                try:
                    os.unlink(path)
                except FileNotFoundError:
                    pass
                vm._contract_test_stdin_path = None

    loader._inject_message_to_fd0 = inject_message_to_fd0
    VMContext._refresh_gl_message = refresh_gl_message
    VMContext._cleanup_after_deactivate = cleanup_after_deactivate
    loader._contract_test_windows_compat = True


def install_glsim_direct_compatibility() -> None:
    install_windows_direct_compatibility()

    import glsim.engine as engine_module

    if getattr(engine_module, "_contract_test_direct_compat", False):
        return

    original_deploy_contract = engine_module.deploy_contract

    def deploy_contract_unwrapped(*args, **kwargs):
        deployed = original_deploy_contract(*args, **kwargs)
        return getattr(deployed, "_instance", deployed)

    engine_module.deploy_contract = deploy_contract_unwrapped
    engine_module._contract_test_direct_compat = True
