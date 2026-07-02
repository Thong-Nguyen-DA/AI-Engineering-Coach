/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Cline session parser
 *
 * Data layout:
 *   ~/.cline/data/sessions/<session-id>/
 *     <session-id>.json          - Session metadata
 *     <session-id>.messages.json - Conversation messages with tokens, tools, thinking
 *
 * Session JSON structure:
 *   {
 *     version, session_id, source, pid, started_at, ended_at,
 *     exit_code, status, interactive, provider, model, cwd,
 *     workspace_root, enable_tools, enable_spawn, enable_teams,
 *     prompt, metadata, messages_path
 *   }
 *
 * Messages JSON structure:
 *   {
 *     version, updated_at, agent, sessionId,
 *     messages: [{ id, role, content[], ts, modelInfo?, metrics? }, ...],
 *     system_prompt
 *   }
 *
 * Message content blocks:
 *   { type: 'text', text: '...' }
 *   { type: 'thinking', thinking: '...' }
 *   { type: 'tool_use', id, name, input: {...} }
 *   { type: 'tool_result', tool_use_id, name, content, is_error? }
 */

import * as fs from 'fs';
import * as path from 'path';
import { Session, SessionRequest } from './types';
import { assertTrustedPath, readFileSafe, createRequest, createSession } from './parser-shared';
import { extractReasoningEffortFromModelId } from './helpers';

interface ClineSessionMeta {
  version: number;
  session_id: string;
  source: string;
  pid: number;
  started_at: string;
  ended_at?: string;
  exit_code?: number;
  status: string;
  interactive: boolean;
  provider: string;
  model: string;
  cwd: string;
  workspace_root: string;
  enable_tools: boolean;
  enable_spawn: boolean;
  enable_teams: boolean;
  prompt: string;
  metadata: {
    title: string;
    totalCost: number;
    aggregatedAgentsCost: number;
    usage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      totalCost: number;
    };
    aggregateUsage: {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      totalCost: number;
    };
  };
  messages_path: string;
}

interface ClineMessages {
  version: number;
  updated_at: string;
  agent: string;
  sessionId: string;
  messages: ClineMessage[];
  system_prompt: string;
}

interface ClineMessage {
  id: string;
  role: 'user' | 'assistant';
  content: ClineContentBlock[];
  ts: number;
  modelInfo?: {
    id: string;
    provider: string;
  };
  metrics?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

interface ClineContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result';
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | Array<Record<string, unknown>>;
  is_error?: boolean;
}

// Too specific as tools can be added/removed.
const CLINE_WRITE_TOOLS = new Set(['write_to_file', 'replace_in_file', 'edit_file']);
const CLINE_READ_FILE_TOOLS = new Set(['read_file', 'view_file']);
const CLINE_READ_PATH_TOOLS = new Set(['list_files', 'glob', 'grep']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClineContentBlock(value: unknown): value is ClineContentBlock {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  if (
    value.type !== 'text' &&
    value.type !== 'thinking' &&
    value.type !== 'tool_use' &&
    value.type !== 'tool_result'
  ) {
    return false;
  }

  if (value.text !== undefined && typeof value.text !== 'string') return false;
  if (value.thinking !== undefined && typeof value.thinking !== 'string') return false;
  if (value.id !== undefined && typeof value.id !== 'string') return false;
  if (value.name !== undefined && typeof value.name !== 'string') return false;
  if (value.input !== undefined && value.input !== null && !isRecord(value.input)) return false;
  if (value.tool_use_id !== undefined && typeof value.tool_use_id !== 'string') return false;
  if (value.is_error !== undefined && typeof value.is_error !== 'boolean') return false;

  // Only validate `content` if it exists.
  // Most text/thinking/tool_use blocks do not have nested content.
  if (value.content !== undefined) {
    if (typeof value.content === 'string') return true;

    if (Array.isArray(value.content)) {
      return value.content.every(item => isRecord(item));
    }

    return false;
  }

  return true;
}

function isClineMessage(value: unknown): value is ClineMessage {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string') return false;
  if (value.role !== 'user' && value.role !== 'assistant') return false;
  if (!Array.isArray(value.content) || !value.content.every(isClineContentBlock)) return false;
  if (typeof value.ts !== 'number') return false;
  if (value.modelInfo !== undefined) {
    if (!isRecord(value.modelInfo) || typeof value.modelInfo.id !== 'string' || typeof value.modelInfo.provider !== 'string') {
      return false;
    }
  }
  if (value.metrics !== undefined) {
    if (
      !isRecord(value.metrics) ||
      (value.metrics.inputTokens !== undefined && typeof value.metrics.inputTokens !== 'number') ||
      (value.metrics.outputTokens !== undefined && typeof value.metrics.outputTokens !== 'number')
    ) {
      return false;
    }
  }
  return true;
}

function isClineSessionMeta(value: unknown): value is ClineSessionMeta {
  if (!isRecord(value)) return false;
  if (typeof value.session_id !== 'string') return false;
  if (typeof value.started_at !== 'string') return false;
  if (typeof value.cwd !== 'string') return false;
  if (typeof value.workspace_root !== 'string') return false;
  if (typeof value.model !== 'string') return false;
  if (typeof value.provider !== 'string') return false;
  if (typeof value.source !== 'string') return false;
  if (typeof value.messages_path !== 'string') return false;
  return true;
}

function isClineMessages(value: unknown): value is ClineMessages {
  if (!isRecord(value)) return false;
  if (typeof value.sessionId !== 'string') return false;
  if (typeof value.agent !== 'string') return false;
  if (!Array.isArray(value.messages) || !value.messages.every(isClineMessage)) return false;
  return true;
}

function parseClineSessionMeta(filePath: string): ClineSessionMeta | null {
  assertTrustedPath(filePath);
  const content = readFileSafe(filePath);
  if (!content) return null;
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isClineSessionMeta(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseClineMessages(filePath: string): ClineMessages | null {
  assertTrustedPath(filePath);
  const content = readFileSafe(filePath);
  if (!content) return null;
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isClineMessages(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getTimestamp(isoString: string): number | null {
  try {
    return new Date(isoString).getTime();
  } catch {
    return null;
  }
}

function getInputPath(input: Record<string, unknown> | undefined, key: string): string | null {
  const value = input?.[key];
  return typeof value === 'string' ? value : null;
}

function extractTextFromContent(content: ClineContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text' && block.text) parts.push(block.text);
  }
  return parts.join('\n').trim();
}

function extractThinkingFromContent(content: ClineContentBlock[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'thinking' && block.thinking) parts.push(block.thinking);
  }
  return parts.join('\n').trim();
}

function extractUserInputContext(text: string): string {
  const match = text.match(/^\s*<user_input\b[^>]*>([\s\S]*?)<\/user_input>\s*$/);
  return (match ? match[1] : text).trim();
}

function applyClineToolBlock(
  block: ClineContentBlock,
  data: { toolsUsed: string[]; editedFiles: string[]; referencedFiles: string[]; skillsUsed: string[] }
): void {
  if (block.type !== 'tool_use' || !block.name) return;

  data.toolsUsed.push(block.name);

  if (CLINE_WRITE_TOOLS.has(block.name)) {
    const filePath = getInputPath(block.input, 'path') || getInputPath(block.input, 'file_path');
    if (filePath) data.editedFiles.push(filePath);
    return;
  }

  if (CLINE_READ_FILE_TOOLS.has(block.name)) {
    const filePath = getInputPath(block.input, 'path') || getInputPath(block.input, 'file_path');
    if (filePath) data.referencedFiles.push(filePath);
    return;
  }

  if (CLINE_READ_PATH_TOOLS.has(block.name)) {
    const targetPath = getInputPath(block.input, 'path') || getInputPath(block.input, 'pattern');
    if (targetPath) data.referencedFiles.push(targetPath);
  }

  // Generic path extraction from arbitrary tool inputs
  if (block.input && typeof block.input === 'object') {
    const stack: unknown[] = [block.input];

    while (stack.length > 0) {
      const current = stack.pop();

      if (!current) continue;

      if (typeof current === 'string') {
        // Heuristic: treat strings that look like paths as referenced files
        if (
          current.includes('/') ||
          current.includes('\\') ||
          current.match(/\.[a-zA-Z0-9]+$/) // has file extension
        ) {
          data.referencedFiles.push(current);
        }
        continue;
      }

      if (Array.isArray(current)) {
        for (const item of current) stack.push(item);
        continue;
      }

      if (typeof current === 'object') {
        for (const value of Object.values(current as Record<string, unknown>)) {
          stack.push(value);
        }
      }
    }
  }
}

interface ClineAssistantData {
  nextIndex: number;
  lastTs: number | null;
  assistantTexts: string[];
  thinkingTexts: string[];
  toolsUsed: string[];
  editedFiles: string[];
  referencedFiles: string[];
  skillsUsed: string[];
  model: string;
  assistantCount: number;
}

function collectClineAssistantData(
  messages: ClineMessage[],
  startIndex: number,
  lastTs: number | null
): ClineAssistantData {
  const data: ClineAssistantData = {
    nextIndex: startIndex,
    lastTs,
    assistantTexts: [],
    thinkingTexts: [],
    toolsUsed: [],
    editedFiles: [],
    referencedFiles: [],
    skillsUsed: [],
    model: '',
    assistantCount: 0,
  };

  let i = startIndex;

  while (i < messages.length) {
    const msg = messages[i];

    // stop when next user message
    if (msg.role === 'user') break;

    if (msg.role === 'assistant') {
      data.assistantCount++;

      if (msg.ts && (!data.lastTs || msg.ts > data.lastTs)) {
        data.lastTs = msg.ts;
      }

      if (!data.model && msg.modelInfo?.id) {
        data.model = msg.modelInfo.id;
      }

      const text = extractTextFromContent(msg.content);
      if (text) data.assistantTexts.push(text);

      const thinking = extractThinkingFromContent(msg.content);
      if (thinking) data.thinkingTexts.push(thinking);

      for (const block of msg.content) {
        applyClineToolBlock(block, data);
      }
    }

    i++;
  }

  data.nextIndex = i;
  return data;
}

function buildClineSession(
  meta: ClineSessionMeta,
  messagesData: ClineMessages
): Session | null {
  const messages = messagesData.messages;
  if (!messages.length) return null;

  const requests: SessionRequest[] = [];

  let i = 0;
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  let requestIndex = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role !== 'user') {
      i++;
      continue;
    }

    const userText = extractTextFromContent(msg.content);
    if (!userText) {
      i++;
      continue;
    }

    if (!firstTs) firstTs = msg.ts;

    const assistantData = collectClineAssistantData(messages, i + 1, null);

    if (assistantData.lastTs) {
      lastTs = assistantData.lastTs;
    } else {
      lastTs = msg.ts;
    }

    const request = buildClineRequest(
      msg,
      assistantData,
      requestIndex++,
      messagesData.agent,
      meta
    );

    requests.push(request);

    i = assistantData.nextIndex;
  }

  if (requests.length === 0) return null;

  return createSession({
    sessionId: meta.session_id,
    workspaceId: `cline-${meta.session_id}`,
    workspaceName: meta.metadata?.title || meta.session_id,
    location: 'terminal',
    harness: 'Cline',
    creationDate: firstTs,
    lastMessageDate: lastTs,
    requests,
    workspaceRootPath: meta.cwd,
    launcherKind: meta.interactive ? 'interactive' : 'programmatic',
  });
}

function buildClineRequest(
  userMsg: ClineMessage,
  assistantData: ClineAssistantData,
  requestIndex: number,
  agentName: string,
  meta: ClineSessionMeta
): SessionRequest {
  const inputTokens = meta.metadata?.usage?.inputTokens ?? 0;
  const outputTokens = meta.metadata?.usage?.outputTokens ?? 0;
  const cacheReadTokens = meta.metadata?.usage?.cacheReadTokens ?? 0;
  const cacheWriteTokens = meta.metadata?.usage?.cacheWriteTokens ?? 0;
  const hasAnyTokens = inputTokens > 0 || outputTokens > 0;
  const uniqueRefs = [...new Set(assistantData.referencedFiles)];
  const skills = new Set(assistantData.skillsUsed);

  // Combine assistant text and thinking
  const responseParts = [...assistantData.assistantTexts, ...assistantData.thinkingTexts];

  return createRequest({
    requestId: userMsg.id || `cline-${requestIndex}`,
    timestamp: userMsg.ts,
    messageText: extractUserInputContext(extractTextFromContent(userMsg.content)),
    responseText: responseParts.join('\n'),
    agentName,
    agentMode: 'agent',
    modelId: assistantData.model,
    toolsUsed: assistantData.toolsUsed,
    editedFiles: [...new Set(assistantData.editedFiles)],
    referencedFiles: uniqueRefs,
    skillsUsed: [...skills],
    variableKinds: {},
    totalElapsed: assistantData.lastTs ? assistantData.lastTs - userMsg.ts : null,
    promptTokens: hasAnyTokens ? inputTokens : null,
    completionTokens: hasAnyTokens ? outputTokens : null,
    cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : null,
    cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : null,
    reasoningEffort: extractReasoningEffortFromModelId(assistantData.model),
  });
}

export function findClineDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const dirs: string[] = [];
  const sessionsDir = path.join(home, '.cline', 'data', 'sessions');
  if (fs.existsSync(sessionsDir)) dirs.push(sessionsDir);
  return dirs;
}

export function parseClineSessions(
  sessionsDir: string
): { sessions: Session[]; workspaceId: string; workspaceName: string }[] {
  const results: { sessions: Session[]; workspaceId: string; workspaceName: string }[] = [];

  let sessionDirs: fs.Dirent[];

  try {
    sessionDirs = fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter(e => e.isDirectory());
  } catch {
    return results;
  }

  for (const dir of sessionDirs) {
    const id = dir.name;
    const sessionPath = path.join(sessionsDir, id);

    const metaPath = path.join(sessionPath, `${id}.json`);
    const messagesPath = path.join(sessionPath, `${id}.messages.json`);

    const meta = parseClineSessionMeta(metaPath);
    const messages = parseClineMessages(messagesPath);

    if (!meta || !messages) continue;

    const session = buildClineSession(meta, messages);
    if (!session) continue;

    results.push({
      sessions: [session],
      workspaceId: `cline-${id}`,
      workspaceName: id,
    });
  }

  return results;
}

export async function parseClineSessionsAsync(
  sessionsDir: string,
  onSession?: (idx: number, total: number, name: string) => void
): Promise<{ sessions: Session[]; workspaceId: string; workspaceName: string }[]> {
  const results: { sessions: Session[]; workspaceId: string; workspaceName: string }[] = [];

  let sessionDirs: string[];
  try {
    sessionDirs = (await fs.promises.readdir(sessionsDir, { withFileTypes: true }))
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch {
    return results;
  }

  for (let i = 0; i < sessionDirs.length; i++) {
    const dirName = sessionDirs[i];
    const workspaceName = dirName;

    if (onSession) onSession(i + 1, sessionDirs.length, workspaceName);

    const sessionPath = path.join(sessionsDir, dirName);
    const metaPath = path.join(sessionPath, `${dirName}.json`);
    const messagesPath = path.join(sessionPath, `${dirName}.messages.json`);

    const meta = parseClineSessionMeta(metaPath);
    const messages = parseClineMessages(messagesPath);

    if (!meta || !messages) continue;

    const workspaceId = `cline-${dirName}`;
    const wsName = path.basename(meta.workspace_root || meta.cwd || dirName);

    const requests: SessionRequest[] = [];
    let requestIndex = 0;

    for (let j = 0; j < messages.messages.length; j++) {
      const msg = messages.messages[j];
      if (msg.role !== 'user') continue;

      // Skip tool_result-only user messages (no real user input)
      if (!extractTextFromContent(msg.content)) continue;

      const assistantData = collectClineAssistantData(messages.messages, j + 1, null);
      const request = buildClineRequest(msg, assistantData, requestIndex++, messages.agent, meta);
      requests.push(request);
      j = assistantData.nextIndex - 1;
    }

    if (requests.length === 0) continue;

    const session = createSession({
      sessionId: meta.session_id,
      workspaceId,
      workspaceName: wsName,
      location: 'terminal',
      harness: 'Cline',
      creationDate: getTimestamp(meta.started_at),
      lastMessageDate: meta.ended_at ? getTimestamp(meta.ended_at) : (requests.length > 0 ? requests[requests.length - 1].timestamp : null),
      requests,
      hasDevcontainer: false,
      workspaceRootPath: meta.workspace_root || meta.cwd || undefined,
      launcherKind: meta.interactive ? 'interactive' : 'programmatic',
      entrypoint: meta.source,
    });

    results.push({ sessions: [session], workspaceId, workspaceName: wsName });

    if (i % 5 === 0) await new Promise<void>(r => setTimeout(r, 0));
  }

  return results;
}
