// ====== Agent Loop ======
// Core agent loop: LLM ↔ Tool multi-turn interaction.
//
// Architecture follows OpenClaw's pi-embedded-runner pattern:
//   1. Build messages array with system prompt + history + user message
//   2. Call LLM with streaming + tool definitions
//   3. If LLM returns tool_calls → execute tools → append results → loop
//   4. If tool is dangerous → emit confirm_request → wait for user approval
//   5. If LLM returns text content → emit text_delta events
//   6. When LLM returns finish_reason=stop → emit done event
//   7. If context exceeds 80% of context window → compact (summarize old messages)

import { streamChatCompletion, type LLMClientConfig } from '../llm/client.js';
import type { LLMMessage, LLMToolDefinition, LLMStreamResult } from '../llm/types.js';
import { toolRegistry } from '../tools/index.js';
import type { ToolResult, ToolPermissionConfig } from '../tools/types.js';
import type { AgentRunConfig, AgentEventSender } from './types.js';
import type { ConfirmManager } from './confirm.js';
import type { StreamEvent } from '../types.js';
import { dataDir } from '../storage.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';


/**
 * Robustly parse tool call arguments from LLM output.
 * Handles common issues:
 *   - Markdown code block wrapping (```json ... ```)
 *   - Trailing commas in JSON
 *   - Single quotes instead of double quotes
 *   - Partial/truncated JSON
 */
function parseToolArgs(raw: string, toolName: string): Record<string, unknown> {
  if (!raw || raw.trim() === '' || raw.trim() === '{}') return {};

  let cleaned = raw.trim();

  // Strip markdown code block wrappers.
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();

  // Try direct parse first.
  try { return JSON.parse(cleaned); } catch { /* continue */ }

  // Fix trailing commas: ,} or ,]
  try {
    const fixed = cleaned.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(fixed);
  } catch { /* continue */ }

  // Fix single quotes → double quotes (crude but effective for simple cases).
  try {
    const singleToDouble = cleaned.replace(/'/g, '"');
    return JSON.parse(singleToDouble);
  } catch { /* continue */ }

  // Try extracting first JSON object from the string.
  try {
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) return JSON.parse(objMatch[0]);
  } catch { /* continue */ }

  // Give up — return empty and log for debugging.
  console.warn(`[agent] parseToolArgs: all attempts failed for ${toolName}: ${raw.slice(0, 200)}`);
  return {};
}

/** Aggregated usage across all LLM rounds in a single agent run. */
interface AggregatedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
}

/**
 * Estimate token count for a message.
 * ~4 chars per token for mixed CJK/English (conservative).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens in the messages array.
 */
function estimateMessagesTokens(messages: LLMMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      total += estimateTokens(m.content);
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === 'text') total += estimateTokens(block.text);
        else total += 100; // media blocks ~100 tokens
      }
    }
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        total += estimateTokens(tc.function.arguments) + estimateTokens(tc.function.name) + 20;
      }
    }
  }
  return total;
}

/**
 * Build the skills section for the system prompt.
 *
 * Two tiers:
 *   1. ALWAYS: list all installed skills (name + description) so the LLM
 *      can proactively match user requests to available skills.
 *   2. ACTIVE SKILL: if a specific skill is activated, inject its full
 *      SKILL.md content so the LLM has complete procedural knowledge.
 */
function buildSkillSection(activeSkill?: string): string {
  const skillsDir = path.join(dataDir(), 'skills');
  if (!fs.existsSync(skillsDir)) return '';

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const skillSummaries: string[] = [];
  let activeSkillContent = '';

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsDir, entry.name);
    const manifestPath = path.join(skillDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const name = manifest.name || entry.name;
      const desc = manifest.description || '';
      skillSummaries.push(`- **${name}**: ${desc}`);

      // If this is the active skill, load full SKILL.md.
      if (activeSkill && (name === activeSkill || entry.name === activeSkill)) {
        const skillMdPath = path.join(skillDir, 'SKILL.md');
        if (fs.existsSync(skillMdPath)) {
          activeSkillContent = fs.readFileSync(skillMdPath, 'utf-8');
        }
      }
    } catch { /* skip malformed */ }
  }

  if (skillSummaries.length === 0) return '';

  let section = `\n## Installed Skills\nThe following skills are available. When the user's request matches a skill's capability, you MUST use that skill (read its documentation below, then follow its instructions using bash_exec / file_write / file_read).\n${skillSummaries.join('\n')}\n`;

  // If a specific skill is activated, inject its full content.
  if (activeSkillContent) {
    section += `\n---\n\n## Active Skill: ${activeSkill}\nThe following is the complete skill documentation. Follow it precisely.\n\n${activeSkillContent}\n`;
  } else {
    section += `\nTo activate a skill and load its full documentation, the user can click the skill in the UI or mention it by name.\n`;
  }

  return section;
}

/**
 * Build the system prompt with dynamically discovered tools.
 * Strongly encourages using skill tools when available.
 */
function buildSystemPrompt(workdir: string, toolNames: string[], activeSkill?: string): string {
  const toolList = toolNames.map((t) => `- ${t}`).join('\n');

  // Check if there are non-builtin tools (skills).
  const builtinTools = ['file_read', 'file_write', 'bash_exec', 'update_plan', 'sessions_spawn', 'database_search', 'database_status', 'run_skill_script', 'save_note', 'create_task', 'update_task'];
  const skillTools = toolNames.filter((t) => !builtinTools.some((b) => t.startsWith(b + ':')));
  const skillSection = skillTools.length > 0
    ? `\n## Skill Tools (IMPORTANT)\nThe following tools were loaded from installed skills. YOU MUST actively use them when the user\'s request matches their capability:\n${skillTools.map((t) => `- ${t}`).join('\n')}\nWhen the user asks for something that a skill tool can handle, USE that tool immediately. Do NOT ask the user to confirm — just use it.\n`
    : '';

  // Build skill section (summaries + optional active skill full content).
  const skillSection2 = buildSkillSection(activeSkill);

  return `You are Chemycode, an AI assistant specialized in computational chemistry.
You can help with molecular dynamics, quantum chemistry, DFT calculations, force field parameterization,
trajectory analysis, and more.

You have access to the following tools:
${toolList}
${skillSection2}
When the user asks you to perform a task:
1. First, create a plan using update_plan to track your progress
2. Use tools to accomplish the task step by step
3. Update the plan as you complete steps
4. Report results clearly

Always explain what you're doing and why. If a task requires multiple steps, break them down.
For chemistry tasks, output files in standard formats (PDB, XYZ, MDP, etc.) when appropriate.

Important: When writing code or scripts, use file_write to create them, then bash_exec to run them.

For complex independent subtasks, use sessions_spawn to delegate work to a sub-agent.
Sub-agents run in isolated sessions and return their results when complete.

## Database Search (IMPORTANT)
You have access to a chemical paper database with 3518 paper chunks.
When the user asks about chemistry concepts, mechanisms, or technical details, ALWAYS use the database_search tool to find relevant literature FIRST.
Use the retrieved paper paragraphs as evidence and context for your response.
This is especially important for:
- Answering questions about chemical mechanisms or reactions
- Providing literature-backed explanations
- Finding specific technical parameters or methods
- Verifying chemical facts and concepts

## Tool Calling Rules
When you need to use a tool:
1. Call the tool with the correct parameters — do NOT make up results
2. If a tool returns an error, check your parameters and try again
3. For database_search: use it to find literature before answering chemistry questions
4. For file_write: always write complete, working code — never placeholder comments
5. For bash_exec: use it to run scripts, install packages, and verify results
6. You can call MULTIPLE tools in one response if they are independent
7. Always wait for tool results before proceeding to the next step

## Response Quality Rules
- ALWAYS provide complete, detailed responses. Never cut off mid-sentence or mid-explanation.
- When listing items, list ALL of them. Do not stop after 1-2 items.
- When explaining a concept, provide the full explanation with examples.
- If you need to provide multiple pieces of information, provide ALL of them in one response.
- Your response must be self-contained and complete — the user should not need to ask "and then?" or "what else?".
- **CRITICAL**: When you finish all tool calls and the task is done, you MUST end with a plain text message summarizing the results. Never end on a bare tool call. Never return empty content after tool calls — always explain what you found/did in a final text response to the user.

## CUDA / GPU Detection (IMPORTANT)
Before declaring CUDA unavailable, ALWAYS verify with these methods (in order):
1. python3 -c "import torch; print(torch.cuda.is_available())" — PyTorch CUDA
2. python3 -c "import numba; from numba import cuda; print(cuda.is_available())" — Numba CUDA
3. find / -name "libcudart*" 2>/dev/null | head -5 — CUDA runtime library
4. ls /usr/local/cuda*/lib64/ 2>/dev/null — CUDA toolkit installation
5. echo $CUDA_HOME, $LD_LIBRARY_PATH, $PATH — Environment variables
Only after ALL of the above fail, conclude CUDA is unavailable. Do NOT rely on nvidia-smi alone — it may not be in PATH even when CUDA is functional.

## Filesystem Information
- Current working directory: ${workdir}
- User home directory: ${os.homedir()}
- Desktop path (Windows): ${path.join(os.homedir(), 'Desktop')}
- Skills directory: ${path.join(dataDir(), 'skills')}  ← skill 文件都在这里，用 bash_exec 的 ls/find 时从这个路径开始
- Use ABSOLUTE paths when creating files on the user's desktop or home directory.
- On Windows, use backslashes or forward slashes (both work with bash_exec).

## IMPORTANT: Skill File Access
When a skill is activated, its files are located at: ${path.join(dataDir(), 'skills', '<skill-name>/')}.
To list skill files: ls "${path.join(dataDir(), 'skills', '<skill-name>')}"
To read SKILL.md: file_read with path "${path.join(dataDir(), 'skills', '<skill-name>', 'SKILL.md')}"
The system prompt already contains the full SKILL.md content when a skill is activated — you do NOT need to read it again.

## Memory Folder (IMPORTANT)
Each session has a locked workspace at: ${workdir}
A memory folder is auto-created at: ${workdir}/.chemycode-memory/
- notes.md — LLM-recorded test notes and observations
- history.log — chronological log of all actions
- README.md — explains the memory folder structure
**YOU MUST call save_note after completing each significant test or step.** Record what you did, what worked, what failed, and any observations. The user will review these notes to track test history. Do not skip this — the user relies on these notes to review your work.`;
}

/**
 * Run the agent loop for a single user message.
 */
export async function runAgentLoop(
  config: AgentRunConfig,
  sendEvent: AgentEventSender,
): Promise<{ content: string; usage: AggregatedUsage; generatedFiles: Array<{ name: string; path: string; type: string }> }> {
  const {
    llm,
    userMessage,
    messageId,
    workdir,
    userId,
    sessionId,
    history = [],
    attachments = [],
    confirmManager,
    signal,
    toolPermissions,
    contextWindow = 128_000,
  } = config;

  // 80% of context window for compaction trigger.
  const compactionThreshold = Math.floor(contextWindow * 0.8);

  // Get tool definitions, filtered by permissions.
  const tools: LLMToolDefinition[] = toolRegistry.getLLMToolsFiltered(toolPermissions);

  // Build system prompt with dynamically discovered tool names.
  const toolNames = tools.map((t) => `${t.function.name}: ${t.function.description}`);
  const systemPromptContent = buildSystemPrompt(workdir, toolNames, config.activeSkill);
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPromptContent },
  ];

  // Add workspace context if different from default.
  if (workdir !== process.cwd()) {
    messages.push({ role: 'system', content: `IMPORTANT: The user has specified the working directory as: ${workdir}. All file operations MUST use this directory as the base path. Use absolute paths starting with this directory.` });
  }

  // Add conversation history.
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add user message with attachment info.
  const uploadDir = path.join(dataDir(), 'uploads');
  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
  const VIDEO_EXTS = new Set(['.mp4', '.webm', '.avi', '.mov', '.mkv']);

  if (attachments.length > 0) {
    const contentBlocks: import('../llm/types.js').ContentBlock[] = [];
    const textParts: string[] = [userMessage];

    for (const fid of attachments) {
      const filePath = path.join(uploadDir, fid);
      const ext = path.extname(fid).toLowerCase();

      if (IMAGE_EXTS.has(ext)) {
        try {
          const buf = fs.readFileSync(filePath);
          const b64 = buf.toString('base64');
          const mime = ext === '.png' ? 'image/png'
            : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
            : ext === '.gif' ? 'image/gif'
            : ext === '.webp' ? 'image/webp'
            : ext === '.svg' ? 'image/svg+xml'
            : 'image/png';
          contentBlocks.push({
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${b64}` },
          });
        } catch {
          textParts.push(`[Image file: ${filePath}]`);
        }
      } else if (VIDEO_EXTS.has(ext)) {
        contentBlocks.push({
          type: 'video_url',
          video_url: { url: `file://${filePath}` },
        });
      } else {
        textParts.push(`[Attached file: ${filePath}]`);
      }
    }

    if (contentBlocks.length > 0) {
      contentBlocks.unshift({ type: 'text', text: textParts.join('\n') });
      messages.push({ role: 'user', content: contentBlocks });
    } else {
      messages.push({ role: 'user', content: textParts.join('\n') });
    }
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  let finalContent = '';
  const aggregatedUsage: AggregatedUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: 0 };
  const MAX_EMPTY_RETRIES = 10; // More retries to ensure final text is always delivered.
  const MAX_AUTO_CONTINUE = Infinity; // No limit — keep going until the task is done.
  let emptyRetryCount = 0;
  let continueCount = 0;
  // Track files generated during this agent run.
  const generatedFiles: Array<{ name: string; path: string; type: string }> = [];
  // Accumulate content across auto-continue iterations (for persistence).
  let accumulatedContent = '';

  // Agent loop: LLM → tool_calls → execute → LLM → ...
  while (true) {

    // Token-based compaction: if estimated tokens > 80% of context window.
    const estimatedTokens = estimateMessagesTokens(messages);
    if (estimatedTokens > compactionThreshold) {
      console.log(`[agent] context tokens ~${estimatedTokens} > ${compactionThreshold} (80% of ${contextWindow}), compacting...`);
      await compactMessages(messages, llm, sendEvent, messageId, signal);
    }

    let result: LLMStreamResult;
    try {
      result = await streamChatCompletion(
        llm,
        messages,
        tools,
        {
          onTextDelta: (delta, accumulated) => {
            sendEvent({
              type: 'text_delta',
              messageId,
              delta,
              index: accumulated.length - delta.length,
              topic: 'chat',
            } as StreamEvent);
          },
          onToolCallDelta: (_index, _id, _name, _argsDelta) => {
            // Partial tool call events — wait for full assembly.
          },
          onError: (error) => {
            sendEvent({
              type: 'error',
              code: 'LLM_ERROR',
              message: error.message,
              retryable: false,
              topic: 'chat',
            } as StreamEvent);
          },
          onUsage: (usage) => {
            aggregatedUsage.promptTokens += usage.promptTokens;
            aggregatedUsage.completionTokens += usage.completionTokens;
            aggregatedUsage.totalTokens += usage.totalTokens;
            aggregatedUsage.reasoningTokens += usage.reasoningTokens ?? 0;
          },
          onThinkingDelta: (delta, accumulated) => {
            sendEvent({
              type: 'thinking',
              messageId,
              content: delta,
              topic: 'chat',
            } as StreamEvent);
          },
        },
        signal,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendEvent({
        type: 'error',
        code: 'LLM_ERROR',
        message: msg,
        retryable: false,
        topic: 'chat',
      } as StreamEvent);
      return { content: finalContent, usage: aggregatedUsage, generatedFiles };
    }

    // If no tool calls, we're done.
    if (result.finishReason !== 'tool_calls' || result.toolCalls.length === 0) {
      finalContent = result.content;
      // Accumulate content across auto-continue iterations for full persistence.
      accumulatedContent += finalContent;

      // If LLM returned empty content, retry with a nudge.
      if (!finalContent && !result.thinking && result.toolCalls.length === 0 && result.finishReason === 'stop') {
        if (emptyRetryCount < MAX_EMPTY_RETRIES) {
          emptyRetryCount++;
          console.warn(`[agent] LLM returned empty content, retry ${emptyRetryCount}/${MAX_EMPTY_RETRIES}...`);
          sendEvent({
            type: 'thinking',
            messageId,
            content: `模型未返回内容，正在重试 (${emptyRetryCount}/${MAX_EMPTY_RETRIES})...`,
            topic: 'chat',
          } as StreamEvent);
          messages.push({ role: 'user', content: '你还没有向用户发送任何文字消息。请立即输出一段完整的文字回复，总结你刚才做了什么、结果如何、有哪些发现。这是必须的，不能省略。' });
          continue;
        }
        console.warn(`[agent] LLM returned empty content after ${MAX_EMPTY_RETRIES} retries, giving up.`);
        finalContent = '(模型未返回内容，请重试)';
        accumulatedContent = finalContent;
      }

      // Auto-continue when response was truncated by max_tokens.
      if (result.finishReason === 'length' || result.finishReason === 'max_tokens') {
        if (continueCount < MAX_AUTO_CONTINUE) {
          continueCount++;
          console.warn(`[agent] Response truncated (finish_reason=${result.finishReason}), auto-continuing #${continueCount}...`);
          sendEvent({
            type: 'thinking',
            messageId,
            content: `回复被截断，正在自动续写 (${continueCount}次)...`,
            topic: 'chat',
          } as StreamEvent);
          // Add the partial content as assistant message and ask to continue.
          messages.push({ role: 'assistant', content: finalContent || '' });
          messages.push({ role: 'user', content: '请继续完成回复，从上次中断的地方继续。不要重复已经说过的内容。' });
          continue;
        }
        // After max auto-continue rounds, notify user they can manually continue.
        sendEvent({
          type: 'error',
          code: 'MAX_TOKENS',
          message: `回复已自动续写 ${continueCount} 次后结束。如果内容不完整，请发送“继续”以继续生成。`,
          retryable: true,
          topic: 'chat',
        } as StreamEvent);
      }
      // Use accumulated content for persistence (covers all auto-continue iterations).
      finalContent = accumulatedContent;
      break;
    }

    // Append assistant message with tool calls.
    let assistantContent = result.content || null;
    if (result.thinking && assistantContent) {
      assistantContent = `<think>${result.thinking}</think>\n${assistantContent}`;
    } else if (result.thinking) {
      assistantContent = `<think>${result.thinking}</think>`;
    }
    messages.push({
      role: 'assistant',
      content: assistantContent,
      tool_calls: result.toolCalls,
    });

    // Execute each tool call.
    for (const toolCall of result.toolCalls) {
      const toolName = toolCall.function.name;
      let toolParams: Record<string, unknown>;
      try {
        toolParams = parseToolArgs(toolCall.function.arguments, toolName);
      } catch {
        console.warn(`[agent] Failed to parse tool args for ${toolName}: ${toolCall.function.arguments}`);
        toolParams = {};
        sendEvent({
          type: 'thinking',
          messageId,
          content: `工具参数解析失败，使用空参数执行 ${toolName}`,
          topic: 'chat',
        } as StreamEvent);
      }

      sendEvent({
        type: 'tool_call_start',
        toolCallId: toolCall.id,
        toolName,
        args: toolParams,
        messageId,
        topic: 'chat',
      } as StreamEvent);

      sendEvent({
        type: 'tool_call_update',
        toolCallId: toolCall.id,
        status: 'running',
        topic: 'chat',
      } as StreamEvent);

      // Check if tool is dangerous and requires confirmation.
      const tool = toolRegistry.get(toolName);
      if (tool?.definition.dangerous && confirmManager) {
        const accepted = await confirmManager.requestConfirmation(
          `工具「${toolName}」请求执行：\n${JSON.stringify(toolParams, null, 2).slice(0, 500)}`,
          [
            { id: 'accept', label: '允许执行' },
            { id: 'reject', label: '拒绝', destructive: true },
          ],
          sendEvent,
          messageId,
        );

        if (!accepted) {
          const rejectMsg = `User rejected the execution of tool "${toolName}". Ask the user what they'd like to do instead.`;
          sendEvent({
            type: 'tool_call_end',
            toolCallId: toolCall.id,
            result: 'User rejected this tool execution.',
            error: 'rejected',
            topic: 'chat',
          } as StreamEvent);

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: rejectMsg,
          });
          continue;
        }
      }

      // Execute the tool.
      const toolResult: ToolResult = await toolRegistry.execute(
        toolName,
        toolParams,
        { workdir, userId, sessionId, signal, sendEvent },
        toolPermissions,
      );

      sendEvent({
        type: 'tool_call_end',
        toolCallId: toolCall.id,
        result: toolResult.content,
        error: toolResult.success ? undefined : toolResult.content,
        topic: 'chat',
      } as StreamEvent);

      // Track generated files.
      if (toolName === 'file_write' && toolResult.success) {
        const filePath = String(toolParams.path || '');
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : '';
        generatedFiles.push({ name: fileName, path: filePath, type: ext });
      }
      if (toolName === 'bash_exec' && toolResult.success) {
        const output = toolResult.content || '';
        const filePatterns = output.matchAll(/(?:created?|written?|saved?|output|generated?)\s+(?:file\s+)?["']?([^"'\s]+\.[a-zA-Z]{2,5})["']?/gi);
        for (const match of filePatterns) {
          const fPath = match[1];
          const fName = fPath.split(/[/\\]/).pop() || fPath;
          const ext = fName.split('.').pop()?.toLowerCase() || '';
          if (!generatedFiles.some((f) => f.path === fPath)) {
            generatedFiles.push({ name: fName, path: fPath, type: ext });
          }
        }
      }

      // Feed result back to LLM with clear success/failure indicator.
      const toolFeedback = toolResult.success
        ? toolResult.content
        : `[ERROR] Tool '${toolName}' failed: ${toolResult.content}\nPlease check the parameters and try again, or use a different approach.`;

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name: toolName,
        content: toolFeedback,
      });
    }

    // Loop continues: LLM will process tool results and respond.
  }

  return { content: finalContent, usage: aggregatedUsage, generatedFiles };
}

/**
 * Compact messages when context gets too long.
 * Strategy:
 *   1. Split old messages into conversation (user/assistant) and tool results.
 *   2. Summarize ONLY conversation messages.
 *   3. Preserve ALL tool results verbatim (never summarized, never truncated).
 *   4. Reassemble: summary + preserved tool results + recent messages.
 *
 * This guarantees retrieved information (DB search, skill script output)
 * stays in context in full.
 */
async function compactMessages(
  messages: LLMMessage[],
  llm: LLMClientConfig,
  sendEvent: AgentEventSender,
  messageId: string,
  signal?: AbortSignal,
): Promise<void> {
  const KEEP_COUNT = 10;
  const systemMsg = messages[0];
  const oldMessages = messages.slice(1, -KEEP_COUNT);
  const recentMessages = messages.slice(-KEEP_COUNT);

  if (oldMessages.length <= 2) return;

  // Send prominent compaction notification to frontend.
  sendEvent({
    type: 'status',
    status: 'running',
    message: `上下文较长（~${estimateMessagesTokens(messages)} tokens），正在压缩 ${oldMessages.length} 条历史消息...`,
    topic: 'chat',
  } as StreamEvent);

  sendEvent({
    type: 'thinking',
    messageId,
    content: `⚠️ 上下文压缩中：${oldMessages.length} 条消息将被摘要化，工具结果将完整保留。`,
    topic: 'chat',
  } as StreamEvent);

  // --- Step 1: Separate tool results from conversation ---
  const preservedToolResults: LLMMessage[] = [];
  const conversationMessages: LLMMessage[] = [];

  for (const m of oldMessages) {
    if (m.role === 'tool') {
      // Tool results: preserve verbatim, never touch.
      preservedToolResults.push(m);
    } else {
      conversationMessages.push(m);
    }
  }

  // --- Step 2: Summarize conversation messages in chunks ---
  let conversationSummary = '';

  if (conversationMessages.length > 0) {
    const CHUNK_SIZE = 10;
    const chunks: LLMMessage[][] = [];
    for (let i = 0; i < conversationMessages.length; i += CHUNK_SIZE) {
      chunks.push(conversationMessages.slice(i, i + CHUNK_SIZE));
    }

    const chunkSummaries: string[] = [];

    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];

      const formatted = chunk
        .filter((m) => m.role !== 'system')
        .map((m) => {
          let textContent: string;
          if (typeof m.content === 'string') {
            textContent = m.content;
          } else if (Array.isArray(m.content)) {
            textContent = m.content.map((block) => {
              if (block.type === 'text') return block.text;
              if (block.type === 'image_url') return '[Image]';
              if (block.type === 'video_url') return '[Video]';
              return '[Media]';
            }).join(' ');
          } else {
            textContent = '';
          }

          if (m.role === 'assistant' && m.tool_calls) {
            return `[Assistant]: ${textContent || ''} [called ${m.tool_calls.map((t) => t.function.name).join(', ')}]`;
          }
          return `[${m.role}]: ${textContent}`;
        })
        .join('\n');

      try {
        const result = await streamChatCompletion(
          { ...llm, model: llm.model },
          [
            {
              role: 'system',
              content:
                'You are a message compressor. Summarize the following conversation chunk concisely. ' +
                'Preserve key facts, decisions, file paths, and technical details. ' +
                'Output only the summary, no preamble.',
            },
            { role: 'user', content: formatted },
          ],
          [],
          {},
          signal,
        );

        chunkSummaries.push(result.content);
      } catch (e) {
        console.warn(`[agent] compaction chunk ${ci} failed, keeping raw:`, e);
        chunkSummaries.push(formatted);
      }
    }

    conversationSummary = chunkSummaries.join('\n\n');
  }

  // --- Step 3: Reassemble ---
  //   system + [summary] + [preserved tool results] + recent messages
  const compactedParts: LLMMessage[] = [systemMsg];

  if (conversationSummary) {
    compactedParts.push({
      role: 'user',
      content: `[上下文已压缩 — ${conversationMessages.length} 条对话消息已摘要化，${preservedToolResults.length} 条工具结果完整保留]\n\n${conversationSummary}`,
    });
  }

  // Add preserved tool results verbatim.
  for (const tr of preservedToolResults) {
    compactedParts.push(tr);
  }

  // Add recent messages.
  compactedParts.push(...recentMessages);

  // Replace messages array in-place.
  messages.splice(0, messages.length, ...compactedParts);

  // Send compaction complete notification.
  sendEvent({
    type: 'status',
    status: 'running',
    message: `上下文压缩完成。保留 ${preservedToolResults.length} 条工具结果 + 最近 ${recentMessages.length} 条消息。`,
    topic: 'chat',
  } as StreamEvent);

  sendEvent({
    type: 'thinking',
    messageId,
    content: `✅ 压缩完成：${conversationMessages.length} 条对话摘要化，${preservedToolResults.length} 条工具结果（含论文检索）完整保留。`,
    topic: 'chat',
  } as StreamEvent);

  console.log(`[agent] compacted: ${conversationMessages.length} conversation msgs summarized, ${preservedToolResults.length} tool results preserved, ~${estimateMessagesTokens(messages)} tokens remaining`);
}
