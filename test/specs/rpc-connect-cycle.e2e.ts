import { browser } from '@wdio/globals';
import { resolve as resolvePath } from 'node:path';
import { loadSingleFileWorkspace } from '../helpers';
import { requireRpcPrerequisites } from './rpc-prerequisites';

// Half the RPC failures are before-each or after-each hooks, across three
// different specs, while the failing tests vary between runs. What those hooks
// share is starting and stopping Neovim, so this exercises that cycle with
// nothing else around it.
//
// Twelve cycles locally settled every time, but the full spec is only about
// one run in six locally against four in six on CI, so the local result
// settles nothing. Excluded from the sharded run and dispatched through the
// stress workflow, which collects several cold starts.
//
// Reports rather than asserts: a cycle that fails to settle is the finding,
// and a hard failure here would be indistinguishable from the flakiness it is
// meant to characterise.

type RpcPlugin = {
    settings: Record<string, unknown>;
    saveSettings: () => Promise<void>;
    reloadFeatures: () => void;
    getNeovimConnectionState: () => { connected: boolean };
};

const TEST_CONFIG_PATH = resolvePath('test/fixtures/nvim/init.lua');
const WRAPPER =
    process.platform === 'win32'
        ? ''
        : resolvePath('test/fixtures/nvim-exit-wrapper.sh');

async function setRpc(enabled: boolean): Promise<void> {
    await browser.executeObsidian(
        async ({ app }, next: boolean, cfg: string, bin: string) => {
            const plugin = (
                app as unknown as {
                    plugins: { plugins: Record<string, RpcPlugin> };
                }
            ).plugins.plugins['vim-motions'];
            if (!plugin) throw new Error('Vim Motions is not loaded');
            Object.assign(plugin.settings, {
                neovimBinaryPath: bin,
                neovimConfigPath: cfg,
                neovimRpcEnabled: next,
            });
            await plugin.saveSettings();
            plugin.reloadFeatures();
        },
        enabled,
        TEST_CONFIG_PATH,
        WRAPPER,
    );
}

async function isConnected(): Promise<boolean> {
    return browser.executeObsidian(({ app }) => {
        const plugin = (
            app as unknown as {
                plugins: { plugins: Record<string, RpcPlugin> };
            }
        ).plugins.plugins['vim-motions'];
        return plugin?.getNeovimConnectionState().connected === true;
    });
}

describe('Neovim RPC connect/disconnect cycle', function () {
    this.timeout(900000);

    before(function () {
        requireRpcPrerequisites(this);
    });

    it('reports whether every cycle settles', async function () {
        await loadSingleFileWorkspace();

        const cycles: string[] = [];
        for (let i = 0; i < 12; i++) {
            let up = '?';
            let down = '?';
            try {
                await setRpc(true);
                await browser.waitUntil(async () => await isConnected(), {
                    timeout: 20000,
                    interval: 200,
                });
                up = 'U';
            } catch {
                up = '!';
            }
            try {
                await setRpc(false);
                await browser.waitUntil(async () => !(await isConnected()), {
                    timeout: 20000,
                    interval: 200,
                });
                down = 'D';
            } catch {
                down = '!';
            }
            cycles.push(`${up}${down}`);
            if (up === '!' || down === '!') break;
        }

        console.log(
            `RPCCYCLE ${JSON.stringify({
                cycles: cycles.join(' '),
                completed: cycles.length,
                settled: cycles.every((c) => c === 'UD'),
            })}`,
        );
    });
});
