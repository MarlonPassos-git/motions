import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const wdio = path.resolve('node_modules/.bin/wdio');
const args = ['run', './wdio.conf.mts', ...process.argv.slice(2)];
const onWayland =
    process.platform === 'linux' &&
    (Boolean(process.env.WAYLAND_DISPLAY) ||
        process.env.XDG_SESSION_TYPE === 'wayland');

/** @param {NodeJS.ProcessEnv} env */
function runWdio(env) {
    return new Promise((resolve, reject) => {
        const child = spawn(wdio, args, { env, stdio: 'inherit' });
        const interrupt = () => child.kill('SIGINT');
        const terminate = () => child.kill('SIGTERM');
        process.on('SIGINT', interrupt);
        process.on('SIGTERM', terminate);
        child.once('error', reject);
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
        let displayNumber;
        for (let attempt = 0; attempt < 10; attempt++) {
            const candidate = randomInt(100, 1000);
            if (
                !existsSync(`/tmp/.X11-unix/X${candidate}`) &&
                !existsSync(`/tmp/.X${candidate}-lock`)
            ) {
                displayNumber = candidate;
                break;
            }
        }
        if (displayNumber === undefined) {
            reject(new Error('No free isolated X display was found'));
            return;
        }
        const display = `:${displayNumber}`;
        const socket = `/tmp/.X11-unix/X${displayNumber}`;
        const child = spawn(
            binary,
            [
                display,
                '-screen',
                '0',
                '1280x1024x24',
                '+extension',
                'GLX',
                '-noreset',
            ],
            { stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(
            () => fail(new Error('Xvfb did not start within 15 seconds')),
            15000,
        );
        const poll = setInterval(() => {
            if (!existsSync(socket) || settled) return;
            settled = true;
            clearTimeout(timeout);
            clearInterval(poll);
            resolve({ child, display });
        }, 50);
        /** @param {Error} error */
        const fail = (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            clearInterval(poll);
            child.kill();
            reject(
                new Error(
                    `${error.message}${stderr ? `: ${stderr.trim()}` : ''}`,
                ),
            );
        };
        child.stderr.on('data', (chunk) => {
            stderr += String(chunk).slice(0, 2000);
        });
        child.once('error', fail);
        child.once('exit', (code) => {
            fail(new Error(`Xvfb exited with code ${code}`));
        });
    });
}

if (!onWayland) {
    process.exitCode = await runWdio(process.env);
} else {
    const runtimeDir = await mkdtemp(path.join(tmpdir(), 'motions-e2e-'));
    let xvfb;
    try {
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
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
            `Cannot run E2E tests on an isolated display: ${message}`,
        );
        console.error(
            'Install Xvfb or set MOTIONS_XVFB_BIN to its executable path.',
        );
        process.exitCode = 1;
    } finally {
        xvfb?.child.kill();
        await rm(runtimeDir, { recursive: true, force: true });
    }
}
