// ====== Tool Registry ======
// Central registry for all tools. Follows OpenClaw's ToolPlan pattern:
// tools register themselves, the agent loop queries available tools,
// and dispatches execution to the registered handler.
//
// Reference: openclaw-tools-src/tools/index.ts + agents/pi-tools/pi-tools.ts

import type { ToolDefinition, ToolExecuteFn, ToolExecutionContext, ToolResult, ToolPermissionConfig } from './types.js';
import type { LLMToolDefinition } from '../llm/types.js';

interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolExecuteFn;
}

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, execute: ToolExecuteFn): void {
    this.tools.set(definition.name, { definition, execute });
    console.log(`[tools] registered: ${definition.name}`);
  }

  /** Get all tool definitions as LLM-compatible tool definitions. */
  getLLMTools(): LLMToolDefinition[] {
    return this.getLLMToolsFiltered();
  }

  /**
   * Get LLM tool definitions, filtered by permission config.
   * If no config is provided, returns all tools (default open).
   */
  getLLMToolsFiltered(permissions?: ToolPermissionConfig): LLMToolDefinition[] {
    const allTools = Array.from(this.tools.values());

    // No permissions → all tools available.
    if (!permissions) {
      return allTools.map((t) => this.toLLMDefinition(t));
    }

    return allTools
      .filter((t) => this.isAllowed(t.definition.name, permissions))
      .map((t) => this.toLLMDefinition(t));
  }

  /**
   * Check if a tool is allowed by the permission config.
   * Rules:
   *   - deny takes precedence: if the tool is in deny → blocked
   *   - if allow is set: tool must be in allow to be available
   *   - if neither is set: all tools allowed
   */
  isAllowed(toolName: string, permissions?: ToolPermissionConfig): boolean {
    if (!permissions) return true;

    const { allow, deny } = permissions;

    // Deny takes precedence.
    if (deny && deny.includes(toolName)) return false;

    // If allow list is set, tool must be in it.
    if (allow && allow.length > 0) return allow.includes(toolName);

    // Default: allowed.
    return true;
  }

  private toLLMDefinition(t: RegisteredTool): LLMToolDefinition {
    return {
      type: 'function' as const,
      function: {
        name: t.definition.name,
        description: t.definition.description,
        parameters: t.definition.parameters,
      },
    };
  }

  /** Get a tool by name. */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /** Execute a tool by name with the given parameters. */
  async execute(
    name: string,
    params: Record<string, unknown>,
    context: ToolExecutionContext,
    permissions?: ToolPermissionConfig,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: `Tool "${name}" not found. Available tools: ${Array.from(this.tools.keys()).join(', ')}`,
        success: false,
      };
    }

    // Check permissions before execution.
    if (permissions && !this.isAllowed(name, permissions)) {
      return {
        content: `Tool "${name}" is not permitted. Check your tool permission configuration.`,
        success: false,
        details: { denied: true, toolName: name },
      };
    }

    try {
      // Validate required parameters.
      const required = tool.definition.parameters.required || [];
      for (const key of required) {
        if (params[key] === undefined || params[key] === null) {
          return {
            content: `Missing required parameter: ${key}`,
            success: false,
          };
        }
      }

      return await tool.execute(params, context);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: `Tool "${name}" execution error: ${msg}`,
        success: false,
      };
    }
  }

  /** List all registered tool names. */
  list(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Unregister a tool by name. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }
}

export const toolRegistry = new ToolRegistry();
