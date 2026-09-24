import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { App } from 'obsidian';
import type { VimMotionsSettings } from '../../src/settings';

vi.mock('../../src/workspace/navigation', () => ({
    executeCommand: vi.fn(),
}));
vi.mock('../../src/ui/global-ex-command', () => ({
    executeGlobalExCommand: vi.fn(),
}));
vi.mock('../../src/ui/hint-mode', () => ({
    isHintModeActive: () => false,
}));

import { GlobalKeyHandler } from '../../src/workspace/global-key-handler';
import { GlobalMappingRegistry } from '../../src/workspace/global-mapping-registry';
import { observeKeys } from '../../src/workspace/key-observer';
import { executeCommand } from '../../src/workspace/navigation';

type KeydownListener = (e: Partial<KeyboardEvent>) => void;

let capturedListener: KeydownListener | null = null;
let pointerListener: ((e: Partial<PointerEvent>) => void) | null = null;
let focusListener: ((e: Partial<FocusEvent>) => void) | null = null;
let activeViewType = 'graph';
let focusedElement: Element | null = null;
let targetInsideExplorer = true;
let settings: VimMotionsSettings;

class MockKeyboardEvent {
    type: string;
    key: string;
    code: string;
    bubbles: boolean;
    cancelable: boolean;

    constructor(
        type: string,
        init: {
            key?: string;
            code?: string;
            bubbles?: boolean;
            cancelable?: boolean;
        },
    ) {
        this.type = type;
        this.key = init.key ?? '';
        this.code = init.code ?? '';
        this.bubbles = init.bubbles ?? false;
        this.cancelable = init.cancelable ?? false;
    }
}

function makeMockDoc(): Document {
    return {
        addEventListener: (type: string, listener: KeydownListener) => {
            if (type === 'keydown') capturedListener = listener;
            if (type === 'pointerdown') pointerListener = listener;
            if (type === 'focusin') focusListener = listener;
        },
        removeEventListener: () => {},
        get activeElement() {
            return focusedElement;
        },
        querySelector: () => null,
        defaultView: {
            KeyboardEvent: MockKeyboardEvent,
        },
    } as unknown as Document;
}

function makeApp(mockDoc: Document): App {
    return {
        workspace: {
            containerEl: { ownerDocument: mockDoc },
            activeLeaf: {
                view: { getViewType: () => activeViewType },
            },
            getLeavesOfType: (type: string) =>
                type === activeViewType
                    ? [
                          {
                              view: {
                                  containerEl: {
                                      contains: () => targetInsideExplorer,
                                  },
                              },
                          },
                      ]
                    : [],
            getMostRecentLeaf: () => ({
                view: { getViewType: () => activeViewType },
            }),
            on: () => ({ id: 'ref' }),
            offref: () => {},
        },
        commands: { commands: {} },
    } as unknown as App;
}

function makeSettings(): VimMotionsSettings {
    return {
        enableWorkspaceNav: true,
        workspaceNavViewTypes: '',
    } as VimMotionsSettings;
}

function fakeKeyEvent(
    key: string,
    opts?: Record<string, unknown>,
): Partial<KeyboardEvent> {
    return {
        key,
        isComposing: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false,
        shiftKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        stopImmediatePropagation: vi.fn(),
        ...opts,
    };
}

function pressKey(
    key: string,
    opts?: Record<string, unknown>,
): Partial<KeyboardEvent> {
    const event = fakeKeyEvent(key, opts);
    capturedListener!(event);
    return event;
}

describe('GlobalKeyHandler', () => {
    let registry: GlobalMappingRegistry;
    let handler: GlobalKeyHandler;

    beforeEach(() => {
        vi.useFakeTimers();
        capturedListener = null;
        pointerListener = null;
        focusListener = () => {};
        activeViewType = 'graph';
        focusedElement = null;
        targetInsideExplorer = true;
        const mockDoc = makeMockDoc();
        const app = makeApp(mockDoc);
        settings = makeSettings();
        registry = new GlobalMappingRegistry();
        handler = new GlobalKeyHandler(app, settings, null, registry);
        handler.install();
    });

    afterEach(() => {
        handler.destroy();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    describe('file explorer navigation', () => {
        it.each([
            ['h', 'ArrowLeft'],
            ['j', 'ArrowDown'],
            ['k', 'ArrowUp'],
            ['l', 'ArrowRight'],
        ])('translates %s to %s for the active file explorer', (key, arrow) => {
            activeViewType = 'file-explorer';
            const dispatchEvent = vi.fn(
                (_event: Partial<KeyboardEvent>) => true,
            );

            const event = pressKey(key, {
                target: { dispatchEvent },
            });
            const arrowEvent = dispatchEvent.mock.calls[0]?.[0];

            expect({
                prevented: vi.mocked(event.preventDefault!).mock.calls.length,
                stopped: vi.mocked(event.stopImmediatePropagation!).mock.calls
                    .length,
                dispatched: dispatchEvent.mock.calls.length,
                arrowEvent,
            }).toEqual({
                prevented: 1,
                stopped: 1,
                dispatched: 1,
                arrowEvent: {
                    type: 'keydown',
                    key: arrow,
                    code: arrow,
                    bubbles: true,
                    cancelable: true,
                },
            });
        });

        it('does not report the translated arrow as a physical key', () => {
            activeViewType = 'file-explorer';
            const observedKeys: string[] = [];
            const stopObserving = observeKeys((key) => observedKeys.push(key));
            const dispatchEvent = vi.fn((event: Partial<KeyboardEvent>) => {
                capturedListener!(event);
                return true;
            });

            pressKey('j', { target: { dispatchEvent } });
            stopObserving();

            expect({
                observedKeys,
                dispatched: dispatchEvent.mock.calls.length,
            }).toEqual({ observedKeys: ['j'], dispatched: 1 });
        });

        const blockedContexts: Array<
            [
                string,
                {
                    settingsEnabled?: boolean;
                    event?: Record<string, unknown>;
                    focused?: Partial<HTMLElement>;
                    viewType?: string;
                },
            ]
        > = [
            ['workspace navigation is disabled', { settingsEnabled: false }],
            ['a modifier is pressed', { event: { ctrlKey: true } }],
            [
                'a text input is focused',
                {
                    focused: {
                        tagName: 'INPUT',
                        closest: () => null,
                        isContentEditable: false,
                    },
                },
            ],
            ['another view is active', { viewType: 'markdown' }],
            ['the key target is outside the explorer', {}],
            [
                'a contenteditable rename control is focused',
                {
                    focused: {
                        tagName: 'DIV',
                        closest: () => null,
                        isContentEditable: true,
                    },
                },
            ],
        ];

        it.each(blockedContexts)(
            'leaves h/j/k/l alone when %s',
            (_name, context) => {
                activeViewType = context.viewType ?? 'file-explorer';
                targetInsideExplorer =
                    _name !== 'the key target is outside the explorer';
                focusedElement = (context.focused ?? null) as Element | null;
                if (context.settingsEnabled === false) {
                    settings.enableWorkspaceNav = false;
                }
                const dispatchEvent = vi.fn(() => true);

                const event = pressKey('j', {
                    target: { dispatchEvent },
                    ...context.event,
                });

                expect({
                    prevented: vi.mocked(event.preventDefault!).mock.calls
                        .length,
                    stopped: vi.mocked(event.stopImmediatePropagation!).mock
                        .calls.length,
                    dispatched: dispatchEvent.mock.calls.length,
                }).toEqual({ prevented: 0, stopped: 0, dispatched: 0 });
            },
        );

        it('repeats j for a count in the file explorer', () => {
            activeViewType = 'file-explorer';
            const dispatchEvent = vi.fn(
                (_event: Partial<KeyboardEvent>) => true,
            );
            pressKey('3', { target: { dispatchEvent } });

            const event = pressKey('j', { target: { dispatchEvent } });

            expect(
                dispatchEvent.mock.calls.map(([arrow]) => arrow.key),
            ).toEqual(['ArrowDown', 'ArrowDown', 'ArrowDown']);
            expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
        });

        it('caps repeated explorer movement to avoid blocking the UI', () => {
            activeViewType = 'file-explorer';
            const dispatchEvent = vi.fn(
                (_event: Partial<KeyboardEvent>) => true,
            );
            for (const digit of '9999') {
                pressKey(digit, { target: { dispatchEvent } });
            }

            pressKey('j', { target: { dispatchEvent } });

            expect(dispatchEvent).toHaveBeenCalledTimes(100);
        });

        it('uses the last explorer interaction for body-targeted keys and clears it on an outside click', () => {
            activeViewType = 'file-explorer';
            const dispatchEvent = vi.fn(
                (_event: Partial<KeyboardEvent>) => true,
            );
            // The mocked containment result changes between these two targets.
            pointerListener!({ target: new EventTarget() });
            targetInsideExplorer = false;

            pressKey('j', { target: { dispatchEvent } });
            expect(dispatchEvent).toHaveBeenCalledOnce();

            pointerListener!({ target: new EventTarget() });
            pressKey('j', { target: { dispatchEvent } });
            expect(dispatchEvent).toHaveBeenCalledOnce();
        });

        it('stops explorer navigation when focus moves outside the tree', () => {
            activeViewType = 'file-explorer';
            const dispatchEvent = vi.fn(
                (_event: Partial<KeyboardEvent>) => true,
            );
            pointerListener!({ target: new EventTarget() });
            targetInsideExplorer = false;

            focusListener!({ target: new EventTarget() });
            pressKey('j', { target: { dispatchEvent } });

            expect(dispatchEvent).not.toHaveBeenCalled();
        });
    });

    describe('dispatch count for builtin actions', () => {
        it('passes count=0 when no count prefix typed', () => {
            let received = -1;
            registry.addMapping(
                'x',
                {
                    type: 'builtin',
                    fn: (_app, count) => {
                        received = count;
                    },
                },
                { source: 'default', gate: 'structural' },
            );

            pressKey('x');
            expect(received).toBe(0);
        });

        it('passes count=1 when "1" is typed before key', () => {
            let received = -1;
            registry.addMapping(
                'x',
                {
                    type: 'builtin',
                    fn: (_app, count) => {
                        received = count;
                    },
                },
                { source: 'default', gate: 'structural' },
            );

            pressKey('1');
            pressKey('x');
            expect(received).toBe(1);
        });

        it('passes count=3 when "3" is typed before key', () => {
            let received = -1;
            registry.addMapping(
                'x',
                {
                    type: 'builtin',
                    fn: (_app, count) => {
                        received = count;
                    },
                },
                { source: 'default', gate: 'structural' },
            );

            pressKey('3');
            pressKey('x');
            expect(received).toBe(3);
        });

        it('count resets after dispatch', () => {
            const received: number[] = [];
            registry.addMapping(
                'x',
                {
                    type: 'builtin',
                    fn: (_app, count) => {
                        received.push(count);
                    },
                },
                { source: 'default', gate: 'structural' },
            );

            pressKey('3');
            pressKey('x');
            pressKey('x');
            expect(received).toEqual([3, 0]);
        });
    });

    describe('dispatch count for obcommand actions', () => {
        it('executes obcommand once when no count prefix typed', () => {
            registry.addMapping(
                'x',
                {
                    type: 'obcommand',
                    commandId: 'workspace:next-tab',
                },
                { source: 'default', gate: 'structural' },
            );

            pressKey('x');
            expect(executeCommand).toHaveBeenCalledTimes(1);
        });

        it('repeats obcommand N times when count N is typed', () => {
            registry.addMapping(
                'x',
                {
                    type: 'obcommand',
                    commandId: 'workspace:next-tab',
                },
                { source: 'default', gate: 'structural' },
            );

            pressKey('3');
            pressKey('x');
            expect(executeCommand).toHaveBeenCalledTimes(3);
        });
    });

    describe('gt tab navigation (issue #97)', () => {
        it('gt without count triggers next-tab branch (count=0)', () => {
            let nextTabCalled = false;
            let nthTabCalled = false;
            registry.addMapping(
                'gt',
                {
                    type: 'builtin',
                    fn: (_app2, count) => {
                        if (count > 0) {
                            nthTabCalled = true;
                        } else {
                            nextTabCalled = true;
                        }
                    },
                },
                { source: 'default', gate: 'structural' },
            );

            pressKey('g');
            pressKey('t');

            expect(nextTabCalled).toBe(true);
            expect(nthTabCalled).toBe(false);
        });

        it('3gt triggers nth-tab branch with count=3', () => {
            let receivedCount = -1;
            registry.addMapping(
                'gt',
                {
                    type: 'builtin',
                    fn: (_app2, count) => {
                        receivedCount = count;
                    },
                },
                { source: 'default', gate: 'structural' },
            );

            pressKey('3');
            pressKey('g');
            pressKey('t');

            expect(receivedCount).toBe(3);
        });

        it('1gt triggers nth-tab branch with count=1', () => {
            let receivedCount = -1;
            registry.addMapping(
                'gt',
                {
                    type: 'builtin',
                    fn: (_app2, count) => {
                        receivedCount = count;
                    },
                },
                { source: 'default', gate: 'structural' },
            );

            pressKey('1');
            pressKey('g');
            pressKey('t');

            expect(receivedCount).toBe(1);
        });
    });

    describe('sequence timeout with partial matches (issue #97)', () => {
        it('keeps sequence alive while partial match exists', () => {
            registry.addMapping(
                '<C-w>h',
                { type: 'builtin', fn: () => {} },
                { source: 'default', gate: 'structural' },
            );
            registry.addMapping(
                '<C-w>j',
                { type: 'builtin', fn: () => {} },
                { source: 'default', gate: 'structural' },
            );

            let chordDismissed = false;
            handler.onGlobalChord = (chord) => {
                if (chord === '') chordDismissed = true;
            };

            pressKey('w', { ctrlKey: true });
            expect(chordDismissed).toBe(false);

            vi.advanceTimersByTime(1000);
            expect(chordDismissed).toBe(false);

            vi.advanceTimersByTime(1000);
            expect(chordDismissed).toBe(false);
        });

        it('still dispatches command after timeout restarts', () => {
            let called = false;
            registry.addMapping(
                '<C-w>h',
                {
                    type: 'builtin',
                    fn: () => {
                        called = true;
                    },
                },
                { source: 'default', gate: 'structural' },
            );
            registry.addMapping(
                '<C-w>j',
                { type: 'builtin', fn: () => {} },
                { source: 'default', gate: 'structural' },
            );

            pressKey('w', { ctrlKey: true });
            vi.advanceTimersByTime(1500);

            pressKey('h');
            expect(called).toBe(true);
        });

        it('resets count after timeout so next key has no count', () => {
            let received = -1;
            registry.addMapping(
                'x',
                {
                    type: 'builtin',
                    fn: (_app, count) => {
                        received = count;
                    },
                },
                { source: 'default', gate: 'structural' },
            );

            pressKey('5');
            vi.advanceTimersByTime(1000);

            pressKey('x');
            expect(received).toBe(0);
        });

        it('resets after exact match (no lingering timeout)', () => {
            let callCount = 0;
            registry.addMapping(
                'x',
                {
                    type: 'builtin',
                    fn: () => {
                        callCount++;
                    },
                },
                { source: 'default', gate: 'structural' },
            );

            pressKey('x');
            expect(callCount).toBe(1);

            vi.advanceTimersByTime(2000);
            expect(callCount).toBe(1);
        });
    });
});
