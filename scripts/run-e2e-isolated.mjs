import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const wdio = path.resolve('node_modules/@wdio/cli/bin/wdio.js');
const args = ['run', './wdio.conf.mts', ...process.argv.slice(2)];
const onWayland =
    process.platform === 'linux' &&
    (Boolean(process.env.WAYLAND_DISPLAY) ||
        process.env.XDG_SESSION_TYPE === 'wayland');

/** @param {NodeJS.ProcessEnv} env */
function runWdio(env) {
    return new Promise((resolve, reject) => {
        if (!existsSync(wdio)) {
            reject(
                new Error(`WDIO CLI not found at ${wdio}; run npm ci first`),
            );
            return;
        }
        const child = spawn(process.execPath, [wdio, ...args], {
            env,
            stdio: 'inherit',
        });
        const interrupt = () => child.kill('SIGINT');
        const terminate = () => child.kill('SIGTERM');
        process.on('SIGINT', interrupt);
        process.on('SIGTERM', terminate);
        child.once('error', (error) => {
            process.off('SIGINT', interrupt);
            process.off('SIGTERM', terminate);
            reject(error);
        });
        child.once('close', (code, signal) => {
            process.off('SIGINT', interrupt);
            process.off('SIGTERM', terminate);
            resolve(signal ? 1 : (code ?? 1));
        });
    });
}

function startXvfb() {
    return new Promise((resolve, reject) => {
        const cachedBinary = path.resolve('.obsidian-cache/tools/Xvfb');
        const binary =
            process.env.MOTIONS_XVFB_BIN ||
            (existsSync(cachedBinary) ? cachedBinary : 'Xvfb');
        const child = spawn(
            binary,
            [
                '-displayfd',
                '3',
                '-screen',
                '0',
                '1280x1024x24',
                '+extension',
                'GLX',
                '-noreset',
            ],
            { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] },
        );
        let stderr = '';
        let displayOutput = '';
        let settled = false;
        const timeout = setTimeout(
            () => fail(new Error('Xvfb did not start within 15 seconds')),
            15000,
        );
        /** @param {Error} error */
        const fail = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            child.kill();
            reject(
                new Error(
                    `${error.message}${stderr ? `: ${stderr.trim()}` : ''}`,
                ),
            );
        };
        if (!child.stderr || !child.stdio[3]) {
            fail(new Error('Xvfb display pipe could not be opened'));
            return;
        }
        child.stderr.on('data', (chunk) => {
            if (stderr.length < 2000) {
                stderr += String(chunk).slice(0, 2000 - stderr.length);
            }
        });
        child.stdio[3].on('data', (chunk) => {
            displayOutput += String(chunk);
            if (!displayOutput.includes('\n') || settled) return;
            const displayNumber = displayOutput.trim();
            if (!/^\d+$/.test(displayNumber)) {
                fail(
                    new Error(
                        `Xvfb returned invalid display: ${displayNumber}`,
                    ),
                );
                return;
            }
            settled = true;
            clearTimeout(timeout);
            resolve({ child, display: `:${displayNumber}` });
        });
        child.once('error', fail);
        child.once('exit', (code) => {
            fail(new Error(`Xvfb exited with code ${code}`));
        });
    });
}

let runtimeDir;
let xvfb;
try {
    if (onWayland) {
        runtimeDir = await mkdtemp(path.join(tmpdir(), 'motions-e2e-'));
        xvfb = await startXvfb();
        const env = { ...process.env };
        delete env.WAYLAND_DISPLAY;
        delete env.WAYLAND_SOCKET;
        delete env.HYPRLAND_INSTANCE_SIGNATURE;
        delete env.HYPRLAND_CMD;
        delete env.XDG_BACKEND;
        delete env.DBUS_SESSION_BUS_ADDRESS;
        env.DISPLAY = xvfb.display;
        env.XDG_RUNTIME_DIR = runtimeDir;
        env.XDG_SESSION_TYPE = 'x11';
        env.ELECTRON_OZONE_PLATFORM_HINT = 'x11';
        env.GDK_BACKEND = 'x11';
        env.QT_QPA_PLATFORM = 'xcb';
        console.log(`Running E2E tests on isolated X display ${xvfb.display}`);
        process.exitCode = await runWdio(env);
    } else {
        process.exitCode = await runWdio(process.env);
    }
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Cannot run E2E tests: ${message}`);
    if (onWayland) {
        console.error(
            'Install Xvfb or set MOTIONS_XVFB_BIN to its executable path.',
        );
    }
    process.exitCode = 1;
} finally {
    xvfb?.child.kill();
    if (runtimeDir) await rm(runtimeDir, { recursive: true, force: true });
}
