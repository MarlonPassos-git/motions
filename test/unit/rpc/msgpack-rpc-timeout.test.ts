import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MsgpackRpcClient } from '../../../src/rpc/msgpack-rpc';

function makeStreams() {
    let listener: ((data: Uint8Array) => void) | null = null;
    const written: Uint8Array[] = [];
    return {
        written,
        emit: (data: Uint8Array) => listener?.(data),
        input: {
            write: (data: Uint8Array) => {
                written.push(data);
                return true;
            },
        },
        output: {
            on: (_event: 'data', fn: (data: Uint8Array) => void) => {
                listener = fn;
            },
            removeListener: () => {
                listener = null;
            },
        },
    };
}

describe('MsgpackRpcClient request timeout', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('rejects a request Neovim never answers instead of pending forever', async () => {
        const streams = makeStreams();
        const client = new MsgpackRpcClient(streams.input, streams.output);

        const pending = client.request('nvim_input', ['gqq']);
        const settled = vi.fn();
        pending.then(settled, settled);

        await vi.advanceTimersByTimeAsync(29000);
        expect(settled).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(2000);

        await expect(pending).rejects.toThrow(
            /Neovim RPC request timed out after 30000ms: nvim_input/,
        );
    });

    it('does not reject a request that is answered in time', async () => {
        const streams = makeStreams();
        const client = new MsgpackRpcClient(streams.input, streams.output);

        const pending = client.request('nvim_get_mode', []);

        // [type=1 response, id=1, error=nil, result="ok"], encoded by hand so the
        // test does not depend on the encoder it is checking the decoder against.
        streams.emit(
            new Uint8Array([0x94, 0x01, 0x01, 0xc0, 0xa2, 0x6f, 0x6b]),
        );

        await expect(pending).resolves.toBe('ok');

        await vi.advanceTimersByTimeAsync(60000);
        await expect(pending).resolves.toBe('ok');
    });
});
