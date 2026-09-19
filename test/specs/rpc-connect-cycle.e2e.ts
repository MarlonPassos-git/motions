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

// Spec-local in rpc-structural-nav rather than a shared helper, so it is
// duplicated here rather than imported. test/ sits outside the tsconfig
// include, so a bad import passes typecheck, lint and format alike and only
// fails when the spec actually runs.
async function useSourceProperties(): Promise<void> {
    await browser.executeObsidian(({ app }) => {
        (
            app.vault as unknown as {
                setConfig(key: string, value: unknown): void;
            }
        ).setConfig('propertiesInDocument', 'source');
    });
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

    // The bare cycle is clean 72 times out of 72 on the platform where the
    // full spec fails about four runs in six, so the cause is an interaction
    // with what the real hooks put around it. RPC_CYCLE_VARIANT selects how
    // much of that to add back, one element at a time, so the first variant
    // that fails names the interaction.
    const variant = process.env.RPC_CYCLE_VARIANT ?? 'bare';

    it('reports whether every cycle settles', async function () {
        await loadSingleFileWorkspace();

        const cycles: string[] = [];
        for (let i = 0; i < 12; i++) {
            if (variant === 'workspace' || variant === 'workspace+source') {
                await loadSingleFileWorkspace();
            }
            if (variant === 'workspace+source') {
                await useSourceProperties();
            }
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
                variant,
                cycles: cycles.join(' '),
                completed: cycles.length,
                settled: cycles.every((c) => c === 'UD'),
            })}`,
        );
    });
});
