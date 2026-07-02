import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

import { parseClineSessions } from './parser-cline';

type ClineToolResultItem = {
  query: string;
  result: string;
  success: boolean;
};

type ClineContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | {
      type: 'tool_use';
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      name: string;
      content: ClineToolResultItem[];
      is_error?: boolean;
    };

type ClineFixtureMessage = {
  id: string;
  role: 'user' | 'assistant';
  ts: number;
  content: ClineContentBlock[];
  metrics?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  modelInfo?: {
    id: string;
    provider: string;
  };
};

/**
 * Helpers to build realistic Cline session fixtures
 */

function makeSessionMeta(sessionId: string, messagesPath: string) {
  return {
    version: 1,
    session_id: sessionId,
    source: 'cline',
    pid: 123,
    started_at: '2025-06-15T10:00:00Z',
    status: 'completed',
    interactive: true,
    provider: 'openai',
    model: 'gpt-4',
    cwd: '/Users/me/project',
    workspace_root: '/Users/me/project',
    enable_tools: true,
    enable_spawn: false,
    enable_teams: false,
    prompt: '',
    metadata: {
      title: 'test',
      totalCost: 0,
      aggregatedAgentsCost: 0,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCost: 0,
      },
      aggregateUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCost: 0,
      },
    },
    messages_path: messagesPath,
  };
}

function makeUserMessage(text: string, ts: number): ClineFixtureMessage {
  return {
    id: `u-${ts}`,
    role: 'user',
    ts,
    content: [{ type: 'text', text }],
  };
}

function makeAssistantMessage(
  text: string,
  ts: number,
  toolBlocks: ClineContentBlock[] = [],
  metrics?: { inputTokens?: number; outputTokens?: number }
): ClineFixtureMessage {
  return {
    id: `a-${ts}`,
    role: 'assistant',
    ts,
    content: [
      { type: 'text', text },
      ...toolBlocks,
    ],
    metrics,
    modelInfo: {
      id: 'gpt-4',
      provider: 'openai',
    },
  };
}

function toolUse(
  name: string,
  input: Record<string, unknown>
): ClineContentBlock {
  return {
    type: 'tool_use',
    name,
    input,
  };
}

function structuredToolResult(
  name: string,
  toolUseId: string,
  content: ClineToolResultItem[]
): ClineContentBlock {
  return {
    type: 'tool_result',
    tool_use_id: toolUseId,
    name,
    content,
  };
}

/**
 * Build a temp Cline session directory
 */
function withClineSession(
  sessionId: string,
  messages: ClineFixtureMessage[],
  run: (sessionsDir: string) => void
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-parser-test-'));
  const sessionsDir = path.join(root, 'sessions');
  const sessionDir = path.join(sessionsDir, sessionId);

  fs.mkdirSync(sessionDir, { recursive: true });

  const metaPath = path.join(sessionDir, `${sessionId}.json`);
  const messagesPath = path.join(sessionDir, `${sessionId}.messages.json`);

  fs.writeFileSync(metaPath, JSON.stringify(makeSessionMeta(sessionId, messagesPath), null, 2));
  fs.writeFileSync(
    messagesPath,
    JSON.stringify({
      version: 1,
      updated_at: new Date().toISOString(),
      agent: 'cline',
      sessionId,
      system_prompt: '',
      messages,
    }),
    'utf-8'
  );

  try {
    run(sessionsDir);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const assistantWithThinking: ClineFixtureMessage = {
  id: 'a-2',
  role: 'assistant',
  ts: 2,
  content: [
    { type: 'text', text: 'answer' },
    { type: 'thinking', thinking: 'internal reasoning' },
  ],
};

describe('parseClineSessions', () => {
  it('creates a single request from user → assistant sequence', () => {
    withClineSession(
      'sess-1',
      [
        makeUserMessage('hello', 1),
        makeAssistantMessage('hi there', 2, [], {
          inputTokens: 10,
          outputTokens: 5,
        }),
      ],
      (sessionsDir) => {
        const result = parseClineSessions(sessionsDir);

        expect(result).toHaveLength(1);
        const session = result[0].sessions[0];

        expect(session.requests).toHaveLength(1);
        expect(session.requests[0].messageText).toContain('hello');
        expect(session.requests[0].responseText).toContain('hi there');
      }
    );
  });

  it('extracts toolsUsed from tool_use blocks', () => {
    withClineSession(
      'sess-2',
      [
        makeUserMessage('read a file', 1),
        makeAssistantMessage('reading...', 2, [
          toolUse('read_file', { path: '/tmp/a.txt' }),
        ]),
      ],
      (sessionsDir) => {
        const session = parseClineSessions(sessionsDir)[0].sessions[0];

        expect(session.requests[0].toolsUsed).toContain('read_file');
      }
    );
  });

  it('extracts editedFiles from write tools', () => {
    withClineSession(
      'sess-3',
      [
        makeUserMessage('write file', 1),
        makeAssistantMessage('done', 2, [
          toolUse('write_to_file', { path: '/tmp/out.txt' }),
        ]),
      ],
      (sessionsDir) => {
        const session = parseClineSessions(sessionsDir)[0].sessions[0];

        expect(session.requests[0].editedFiles).toContain('/tmp/out.txt');
      }
    );
  });

  it('extracts referencedFiles from read tools', () => {
    withClineSession(
      'sess-4',
      [
        makeUserMessage('open file', 1),
        makeAssistantMessage('ok', 2, [
          toolUse('read_file', { path: '/tmp/input.txt' }),
        ]),
      ],
      (sessionsDir) => {
        const session = parseClineSessions(sessionsDir)[0].sessions[0];

        expect(session.requests[0].referencedFiles).toContain('/tmp/input.txt');
      }
    );
  });

  it('combines assistant text + thinking into responseText', () => {
    withClineSession(
      'sess-5',
      [
        makeUserMessage('question', 1),
        assistantWithThinking,
      ],
      (sessionsDir) => {
        const session = parseClineSessions(sessionsDir)[0].sessions[0];

        expect(session.requests[0].responseText).toContain('answer');
        expect(session.requests[0].responseText).toContain('internal reasoning');
      }
    );
  });

  it('deduplicates referencedFiles', () => {
    withClineSession(
      'sess-6',
      [
        makeUserMessage('inspect', 1),
        makeAssistantMessage('ok', 2, [
          toolUse('read_file', { path: '/tmp/file.txt' }),
          toolUse('read_file', { path: '/tmp/file.txt' }),
        ]),
      ],
      (sessionsDir) => {
        const session = parseClineSessions(sessionsDir)[0].sessions[0];

        const refs = session.requests[0].referencedFiles;
        expect(refs.length).toBe(1);
      }
    );
  });

  it('handles missing assistant (no tokens)', () => {
    withClineSession(
      'sess-7',
      [
        makeUserMessage('no response case', 1),
        // no assistant
      ],
      (sessionsDir) => {
        const session = parseClineSessions(sessionsDir)[0].sessions[0];

        expect(session.requests).toHaveLength(1);
        expect(session.requests[0].promptTokens).toBeNull();
        expect(session.requests[0].completionTokens).toBeNull();
      }
    );
  });

  it('accepts structured tool_result content arrays from command-style tools', () => {
    withClineSession(
      'sess-8',
      [
        makeUserMessage('Explore the current directory', 1),
        makeAssistantMessage('listing files...', 2, [
          toolUse('run_commands', {
            commands: [
              {
                command: 'ls',
                args: ['-la'],
              },
            ],
          }),
        ]),
        {
          id: 'tool-result-3',
          role: 'user',
          ts: 3,
          content: [
            structuredToolResult('run_commands', 'call-run-commands-1', [
              {
                query: 'ls -la',
                result: 'total 0\ndrwxr-xr-x  project\n-rw-r--r--  package.json\n',
                success: true,
              },
            ]),
          ],
        },
      ],
      (sessionsDir) => {
        const result = parseClineSessions(sessionsDir);

        expect(result).toHaveLength(1);
        const session = result[0].sessions[0];

        expect(session.requests).toHaveLength(1);
        expect(session.requests[0].messageText).toBe('Explore the current directory');
        expect(session.requests[0].toolsUsed).toContain('run_commands');
      }
    );
  });
});
